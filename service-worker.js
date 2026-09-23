importScripts('core.js');

const API_ROOT = 'https://api.lyrics.ovh';
const SUPPORTED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com'
]);
const resultCache = new Map();

function isSupportedYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && SUPPORTED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function showTemporaryActionError(tabId, title) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#e5484d' });
  await chrome.action.setBadgeText({ tabId, text: '!' });
  await chrome.action.setTitle({ tabId, title });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    chrome.action
      .setTitle({ tabId, title: 'Показать текст песни' })
      .catch(() => {});
  }, 3000);
}

async function toggleLyricsPanel(tab) {
  if (!tab.id || !isSupportedYouTubeUrl(tab.url)) {
    if (tab.id) {
      await showTemporaryActionError(tab.id, 'Откройте видео на YouTube');
    }
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'youtube-lyrics:toggle' });
    return;
  } catch {
    // The page has not received the extension script yet.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['core.js', 'content.js']
    });
    await chrome.tabs.sendMessage(tab.id, { type: 'youtube-lyrics:toggle' });
  } catch (error) {
    console.error('Could not inject YouTube Lyrics:', error);
    await showTemporaryActionError(tab.id, 'Обновите страницу YouTube и попробуйте снова');
  }
}

chrome.action.onClicked.addListener(toggleLyricsPanel);

function timeoutSignal(milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function fetchJson(url) {
  const timeout = timeoutSignal(12000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: timeout.signal
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } finally {
    timeout.cancel();
  }
}

async function requestLyrics(artist, title) {
  const url =
    `${API_ROOT}/v1/${encodeURIComponent(artist)}/` + encodeURIComponent(title);
  const response = await fetchJson(url);

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`lyrics-api-${response.status}`);
  }

  const lyrics = LyricsCore.sanitizeLyrics(response.data?.lyrics);
  if (lyrics.length < 20) return null;

  return { artist, title, lyrics };
}

async function requestSuggestions(query) {
  const response = await fetchJson(
    `${API_ROOT}/suggest/${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error(`suggest-api-${response.status}`);
  }

  return Array.isArray(response.data?.data) ? response.data.data : [];
}

async function findLyrics(rawQuery) {
  const query = LyricsCore.normalizeVideoTitle(rawQuery).slice(0, 180);
  if (query.length < 2) {
    return { ok: false, error: 'Не удалось определить название песни.' };
  }

  const cacheKey = query.toLocaleLowerCase();
  if (resultCache.has(cacheKey)) {
    return resultCache.get(cacheKey);
  }

  const candidates = [];
  const parsed = LyricsCore.parseArtistTitle(query);
  if (parsed) candidates.push(parsed);

  try {
    if (parsed) {
      const exact = await requestLyrics(parsed.artist, parsed.title);
      if (exact) {
        const result = { ok: true, ...exact };
        resultCache.set(cacheKey, result);
        return result;
      }
    }

    const suggestions = await requestSuggestions(query);
    for (const suggestion of LyricsCore.rankSuggestions(query, suggestions)) {
      const duplicate = candidates.some(
        (candidate) =>
          candidate.artist.toLocaleLowerCase() === suggestion.artist.toLocaleLowerCase() &&
          candidate.title.toLocaleLowerCase() === suggestion.title.toLocaleLowerCase()
      );
      if (!duplicate) candidates.push(suggestion);
      if (candidates.length >= 6) break;
    }

    for (const candidate of candidates.slice(parsed ? 1 : 0, 6)) {
      const found = await requestLyrics(candidate.artist, candidate.title);
      if (found) {
        const result = { ok: true, ...found };
        resultCache.set(cacheKey, result);
        return result;
      }
    }

    return {
      ok: false,
      error: 'Текст не найден. Попробуйте ввести «исполнитель — песня» вручную.'
    };
  } catch (error) {
    console.error('Lyrics lookup failed:', error);
    if (error?.name === 'AbortError') {
      return { ok: false, error: 'Сервис долго не отвечает. Попробуйте ещё раз.' };
    }
    return { ok: false, error: 'Не удалось связаться с lyrics.ovh.' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'youtube-lyrics:search') return false;
  if (!isSupportedYouTubeUrl(sender.tab?.url)) {
    sendResponse({ ok: false, error: 'Запрос разрешён только со страницы YouTube.' });
    return false;
  }

  findLyrics(String(message.query || ''))
    .then(sendResponse)
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: 'Неожиданная ошибка поиска.' });
    });
  return true;
});
