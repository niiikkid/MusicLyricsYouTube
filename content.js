(() => {
  'use strict';

  if (globalThis.__youtubeLyricsInjected) return;
  globalThis.__youtubeLyricsInjected = true;

  const HOST_ID = 'youtube-lyrics-local-host';
  let host = null;
  let shadow = null;
  let panel = null;
  let queryInput = null;
  let statusNode = null;
  let resultNode = null;
  let songNode = null;
  let lyricsNode = null;
  let copyButton = null;
  let visible = false;
  let loading = false;
  let lastVideoKey = '';
  let lastLoadedQuery = '';
  let navigationTimer = null;
  let requestSerial = 0;

  const STYLE = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .panel {
      pointer-events: auto;
      position: fixed;
      top: 76px;
      right: 20px;
      width: min(390px, calc(100vw - 32px));
      height: min(720px, calc(100vh - 96px));
      display: grid;
      grid-template-rows: auto auto auto minmax(0, 1fr) auto;
      overflow: hidden;
      color: #f4f4f5;
      background: rgba(10, 10, 11, 0.97);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 18px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.58);
      backdrop-filter: blur(18px);
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 14px 10px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.09);
    }
    .mark {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      flex: 0 0 auto;
      border-radius: 9px;
      color: #09090b;
      background: #f4f4f5;
      font-weight: 900;
      font-size: 15px;
      letter-spacing: -0.04em;
    }
    .heading { min-width: 0; flex: 1; }
    .eyebrow {
      color: #a1a1aa;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .title {
      margin-top: 1px;
      overflow: hidden;
      color: #fafafa;
      font-size: 15px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    button, input { font: inherit; }
    button { cursor: pointer; }
    .icon-button {
      width: 32px;
      height: 32px;
      padding: 0;
      color: #d4d4d8;
      background: transparent;
      border: 0;
      border-radius: 9px;
      font-size: 22px;
      line-height: 1;
    }
    .icon-button:hover { background: rgba(255, 255, 255, 0.09); }
    .search {
      display: flex;
      gap: 8px;
      padding: 12px 14px;
    }
    .search input {
      min-width: 0;
      flex: 1;
      padding: 10px 12px;
      color: #fafafa;
      background: #18181b;
      border: 1px solid #3f3f46;
      border-radius: 10px;
      outline: none;
    }
    .search input:focus { border-color: #a1a1aa; }
    .search button, .copy {
      padding: 9px 12px;
      color: #09090b;
      background: #f4f4f5;
      border: 0;
      border-radius: 10px;
      font-weight: 750;
    }
    .search button:disabled { cursor: wait; opacity: 0.55; }
    .status {
      min-height: 28px;
      padding: 0 16px 9px;
      color: #a1a1aa;
      font-size: 12px;
    }
    .status.error { color: #fca5a5; }
    .result {
      min-height: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .song {
      padding: 13px 16px 9px;
      color: #fafafa;
      font-size: 13px;
      font-weight: 750;
    }
    .lyrics {
      min-height: 0;
      margin: 0;
      padding: 0 18px 24px 16px;
      overflow: auto;
      color: #e4e4e7;
      white-space: pre-wrap;
      font: 15px/1.68 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      scrollbar-color: #52525b transparent;
      scrollbar-width: thin;
    }
    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      color: #71717a;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 11px;
    }
    .copy {
      padding: 7px 10px;
      color: #e4e4e7;
      background: #27272a;
      font-size: 12px;
    }
    .copy:hover { background: #3f3f46; }
    @media (max-width: 620px) {
      .panel {
        top: 64px;
        right: 8px;
        width: calc(100vw - 16px);
        height: calc(100vh - 72px);
        border-radius: 14px;
      }
    }
  `;

  function textFrom(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value = element?.getAttribute('content') || element?.textContent;
      if (value && value.trim()) return value.trim();
    }
    return '';
  }

  function cleanArtist(value) {
    return String(value || '')
      .replace(/\s+-\s+Topic\s*$/i, '')
      .replace(/VEVO\s*$/i, '')
      .trim();
  }

  function detectSongQuery() {
    const title = LyricsCore.normalizeVideoTitle(
      textFrom([
        'ytmusic-player-bar .title',
        'h1.ytd-watch-metadata yt-formatted-string',
        '#title h1 yt-formatted-string',
        'meta[name="title"]'
      ]) || document.title
    );

    if (!title) return '';
    if (LyricsCore.parseArtistTitle(title)) return title;

    const artist = cleanArtist(
      textFrom([
        'ytmusic-player-bar .subtitle a',
        'ytd-video-owner-renderer #channel-name a',
        'ytd-watch-metadata ytd-channel-name a'
      ])
    );

    return artist ? `${artist} - ${title}` : title;
  }

  function videoKey() {
    const url = new URL(location.href);
    return url.searchParams.get('v') || `${url.pathname}|${document.title}`;
  }

  function buildPanel() {
    if (host?.isConnected && panel) return;

    const staleHost = document.getElementById(HOST_ID);
    if (staleHost) staleHost.remove();

    host = document.createElement('div');
    host.id = HOST_ID;
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${STYLE}</style>
      <section class="panel" hidden aria-label="Текст песни">
        <header class="header">
          <div class="mark">L</div>
          <div class="heading">
            <div class="eyebrow">YouTube Lyrics</div>
            <div class="title">Текст текущей песни</div>
          </div>
          <button class="icon-button close" type="button" title="Закрыть" aria-label="Закрыть">×</button>
        </header>
        <form class="search">
          <input type="text" maxlength="180" autocomplete="off" aria-label="Исполнитель и песня" placeholder="Исполнитель — песня">
          <button type="submit">Найти</button>
        </form>
        <div class="status" role="status"></div>
        <div class="result" hidden>
          <div class="song"></div>
          <pre class="lyrics"></pre>
        </div>
        <footer class="footer">
          <span>Источник: lyrics.ovh</span>
          <button class="copy" type="button" hidden>Копировать</button>
        </footer>
      </section>
    `;

    (document.body || document.documentElement).appendChild(host);

    panel = shadow.querySelector('.panel');
    queryInput = shadow.querySelector('input');
    statusNode = shadow.querySelector('.status');
    resultNode = shadow.querySelector('.result');
    songNode = shadow.querySelector('.song');
    lyricsNode = shadow.querySelector('.lyrics');
    copyButton = shadow.querySelector('.copy');

    shadow.querySelector('.close').addEventListener('click', hidePanel);
    shadow.querySelector('.search').addEventListener('submit', (event) => {
      event.preventDefault();
      search(queryInput.value, true);
    });
    copyButton.addEventListener('click', copyLyrics);
  }

  function setLoading(nextLoading) {
    loading = nextLoading;
    const button = shadow.querySelector('.search button');
    button.disabled = nextLoading;
    button.textContent = nextLoading ? 'Ищу…' : 'Найти';
  }

  function setStatus(message, isError = false) {
    statusNode.textContent = message;
    statusNode.classList.toggle('error', isError);
  }

  async function search(rawQuery, force = false) {
    const query = LyricsCore.normalizeVideoTitle(rawQuery);
    if (!query) {
      setStatus('Введите исполнителя и название песни.', true);
      return;
    }
    if (!force && query === lastLoadedQuery && lyricsNode.textContent) return;

    const requestId = ++requestSerial;
    queryInput.value = query;
    lastLoadedQuery = query;
    setLoading(true);
    setStatus('Ищу подходящую песню…');
    resultNode.hidden = true;
    songNode.textContent = '';
    lyricsNode.textContent = '';
    copyButton.hidden = true;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'youtube-lyrics:search',
        query
      });

      if (requestId !== requestSerial) return;

      if (!response?.ok) {
        setStatus(response?.error || 'Текст не найден.', true);
        return;
      }

      songNode.textContent = `${response.artist} — ${response.title}`;
      lyricsNode.textContent = response.lyrics;
      lyricsNode.scrollTop = 0;
      resultNode.hidden = false;
      copyButton.hidden = false;
      setStatus('');
    } catch (error) {
      if (requestId !== requestSerial) return;
      console.error('YouTube Lyrics:', error);
      setStatus('Расширение было обновлено. Обновите страницу YouTube.', true);
    } finally {
      if (requestId === requestSerial) setLoading(false);
    }
  }

  async function copyLyrics() {
    const text = lyricsNode.textContent;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = 'Скопировано';
      setTimeout(() => {
        copyButton.textContent = 'Копировать';
      }, 1400);
    } catch {
      setStatus('Не удалось скопировать текст.', true);
    }
  }

  function moveIntoFullscreen() {
    if (!host) return;
    const target = document.fullscreenElement || document.body || document.documentElement;
    if (target && host.parentNode !== target) target.appendChild(host);
  }

  function showPanel() {
    buildPanel();
    visible = true;
    panel.hidden = false;
    moveIntoFullscreen();

    const key = videoKey();
    const query = detectSongQuery();
    if (query) queryInput.value = query;

    const videoChanged = key !== lastVideoKey;
    if (videoChanged || !lyricsNode.textContent) {
      lastVideoKey = key;
      search(query, videoChanged);
    }
  }

  function hidePanel() {
    if (!panel) return;
    visible = false;
    panel.hidden = true;
  }

  function togglePanel() {
    buildPanel();
    if (visible) hidePanel();
    else showPanel();
  }

  function handleNavigation() {
    clearTimeout(navigationTimer);
    navigationTimer = setTimeout(() => {
      if (!visible) return;
      const key = videoKey();
      if (key === lastVideoKey) return;

      lastVideoKey = key;
      lastLoadedQuery = '';
      lyricsNode.textContent = '';
      const query = detectSongQuery();
      queryInput.value = query;
      search(query, true);
    }, 700);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'youtube-lyrics:ping') {
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'youtube-lyrics:toggle') {
      togglePanel();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  document.addEventListener('yt-navigate-finish', handleNavigation, true);
  document.addEventListener('fullscreenchange', moveIntoFullscreen);
  window.addEventListener('popstate', handleNavigation);
})();
