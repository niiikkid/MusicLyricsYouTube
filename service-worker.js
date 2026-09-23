importScripts('core.js');

const LYRICS_OVH_API_ROOT = 'https://api.lyrics.ovh';
const LRCLIB_API_ROOT = 'https://lrclib.net/api';
const LRCLIB_CLIENT =
  'MusicLyricsYouTube v1.1.0 (https://github.com/niiikkid/MusicLyricsYouTube)';
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

async function fetchJson(url, headers = {}) {
  const timeout = timeoutSignal(12000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      signal: timeout.signal
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } finally {
    timeout.cancel();
  }
}

async function requestLyricsOvh(artist, title) {
  const url =
    `${LYRICS_OVH_API_ROOT}/v1/${encodeURIComponent(artist)}/` +
    encodeURIComponent(title);
  const response = await fetchJson(url);

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`lyrics-api-${response.status}`);
  }

  const lyrics = LyricsCore.sanitizeLyrics(response.data?.lyrics);
  if (lyrics.length < 20) return null;

  return { artist, title, lyrics, source: 'lyrics.ovh' };
}

async function requestSuggestionsOvh(query) {
  const response = await fetchJson(
    `${LYRICS_OVH_API_ROOT}/suggest/${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error(`suggest-api-${response.status}`);
  }

  return Array.isArray(response.data?.data) ? response.data.data : [];
}

async function findLyricsOvh(query) {
  const candidates = [];
  const parsed = LyricsCore.parseArtistTitle(query);
  if (parsed) candidates.push(parsed);

  if (parsed) {
    const exact = await requestLyricsOvh(parsed.artist, parsed.title);
    if (exact) return exact;
  }

  const suggestions = await requestSuggestionsOvh(query);
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
    const found = await requestLyricsOvh(candidate.artist, candidate.title);
    if (found) return found;
  }

  return null;
}

function lyricsCandidateKey(artist, title) {
  return `${artist.toLocaleLowerCase()}\n${title.toLocaleLowerCase()}`;
}

async function findLyricsLrclib(query) {
  const parsed = LyricsCore.parseArtistTitle(query);
  const params = new URLSearchParams();
  if (parsed) {
    params.set('track_name', parsed.title);
    params.set('artist_name', parsed.artist);
  } else {
    params.set('q', query);
  }

  const response = await fetchJson(`${LRCLIB_API_ROOT}/search?${params}`, {
    'Lrclib-Client': LRCLIB_CLIENT
  });
  if (!response.ok) {
    throw new Error(`lrclib-api-${response.status}`);
  }

  const candidatesByKey = new Map();
  for (const item of Array.isArray(response.data) ? response.data : []) {
    const artist = String(item?.artistName || '').trim();
    const title = String(item?.trackName || '').trim();
    const lyrics = LyricsCore.sanitizeLyrics(item?.plainLyrics);
    if (!artist || !title || lyrics.length < 20) continue;

    const key = lyricsCandidateKey(artist, title);
    if (!candidatesByKey.has(key)) {
      candidatesByKey.set(key, { artist, title, lyrics, source: 'LRCLIB' });
    }
  }

  const suggestions = [...candidatesByKey.values()].map((candidate) => ({
    artist: { name: candidate.artist },
    title_short: candidate.title
  }));
  const best = LyricsCore.rankSuggestions(query, suggestions)[0];
  if (!best) return null;

  return candidatesByKey.get(lyricsCandidateKey(best.artist, best.title)) || null;
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

  const providerErrors = [];
  const found = await LyricsCore.findLyricsWithProviders(
    query,
    [findLyricsOvh, findLyricsLrclib],
    (error) => providerErrors.push(error)
  );

  if (found) {
    const result = { ok: true, ...found };
    resultCache.set(cacheKey, result);
    return result;
  }

  for (const error of providerErrors) {
    console.warn('Lyrics provider failed:', error);
  }

  if (providerErrors.length === 2) {
    if (providerErrors.some((error) => error?.name === 'AbortError')) {
      return { ok: false, error: 'Сервисы долго не отвечают. Попробуйте ещё раз.' };
    }
    return { ok: false, error: 'Не удалось связаться с сервисами текстов.' };
  }

  return {
    ok: false,
    error: 'Текст не найден. Попробуйте ввести «исполнитель — песня» вручную.'
  };
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
