(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.LyricsCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function panelLimits(viewport, options = {}) {
    const margin = Math.max(0, Number(options.margin) || 8);
    const viewportWidth = Math.max(0, Number(viewport?.width) || 0);
    const viewportHeight = Math.max(0, Number(viewport?.height) || 0);
    const maximumWidth = Math.max(0, viewportWidth - margin * 2);
    const maximumHeight = Math.max(0, viewportHeight - margin * 2);

    return {
      margin,
      maximumWidth,
      maximumHeight,
      minimumWidth: Math.min(Math.max(0, Number(options.minWidth) || 300), maximumWidth),
      minimumHeight: Math.min(Math.max(0, Number(options.minHeight) || 240), maximumHeight)
    };
  }

  function fitPanelRect(rect, viewport, options = {}) {
    const limits = panelLimits(viewport, options);
    const width = clamp(
      Number(rect?.width) || limits.minimumWidth,
      limits.minimumWidth,
      limits.maximumWidth
    );
    const height = clamp(
      Number(rect?.height) || limits.minimumHeight,
      limits.minimumHeight,
      limits.maximumHeight
    );
    const maximumLeft = limits.margin + limits.maximumWidth - width;
    const maximumTop = limits.margin + limits.maximumHeight - height;

    return {
      left: clamp(Number(rect?.left) || limits.margin, limits.margin, maximumLeft),
      top: clamp(Number(rect?.top) || limits.margin, limits.margin, maximumTop),
      width,
      height
    };
  }

  function calculatePanelRect(
    startRect,
    deltaX,
    deltaY,
    direction,
    viewport,
    options = {}
  ) {
    const limits = panelLimits(viewport, options);
    const start = fitPanelRect(startRect, viewport, options);
    const dx = Number(deltaX) || 0;
    const dy = Number(deltaY) || 0;

    if (direction === 'move') {
      return fitPanelRect(
        { ...start, left: start.left + dx, top: start.top + dy },
        viewport,
        options
      );
    }

    const originalRight = start.left + start.width;
    const originalBottom = start.top + start.height;
    let left = start.left;
    let top = start.top;
    let right = originalRight;
    let bottom = originalBottom;

    if (direction.includes('w')) {
      left = clamp(
        start.left + dx,
        limits.margin,
        originalRight - limits.minimumWidth
      );
    }
    if (direction.includes('e')) {
      right = clamp(
        originalRight + dx,
        start.left + limits.minimumWidth,
        limits.margin + limits.maximumWidth
      );
    }
    if (direction.includes('n')) {
      top = clamp(
        start.top + dy,
        limits.margin,
        originalBottom - limits.minimumHeight
      );
    }
    if (direction.includes('s')) {
      bottom = clamp(
        originalBottom + dy,
        start.top + limits.minimumHeight,
        limits.margin + limits.maximumHeight
      );
    }

    return { left, top, width: right - left, height: bottom - top };
  }

  async function waitForChangedValue(readValue, previousValue, options = {}) {
    const attempts = Math.max(1, Number(options.attempts) || 20);
    const intervalMs = Math.max(0, Number(options.intervalMs) || 200);
    const wait =
      options.wait ||
      ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
    const previous = String(previousValue || '').trim();
    let latest = '';

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      latest = String((await readValue()) || '').trim();
      if (latest && latest !== previous) return latest;
      if (attempt < attempts - 1) await wait(intervalMs);
    }

    return '';
  }

  function normalizeVideoTitle(value) {
    return String(value || '')
      .replace(/\s+-\s+YouTube\s*$/i, '')
      .replace(
        /\s*[\[(]\s*(?:official\s+)?(?:(?:music|lyric|lyrics)\s+)?(?:video|audio|lyrics?|visuali[sz]er|4k|hd|hq)\s*[\])]/gi,
        ''
      )
      .replace(
        /\s*(?:\||-|–|—)\s*(?:official\s+)?(?:(?:music|lyric|lyrics)\s+)?(?:video|audio|lyrics?|visuali[sz]er|4k|hd|hq)\s*$/i,
        ''
      )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseArtistTitle(value) {
    const normalized = normalizeVideoTitle(value);
    const parts = normalized.split(/\s+(?:-|–|—|\||•)\s+/);

    if (parts.length < 2) {
      return null;
    }

    const artist = parts.shift().trim();
    const title = parts.join(' - ').trim();

    return artist && title ? { artist, title } : null;
  }

  function normalizeForMatch(value) {
    return normalizeVideoTitle(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function rankSuggestions(query, suggestions) {
    const parsed = parseArtistTitle(query);
    const queryText = normalizeForMatch(query);
    const queryTokens = new Set(queryText.split(' ').filter(Boolean));
    const seen = new Set();

    return (Array.isArray(suggestions) ? suggestions : [])
      .map((item) => {
        const artist = String(item?.artist?.name || '').trim();
        const title = String(item?.title_short || item?.title || '').trim();
        const artistText = normalizeForMatch(artist);
        const titleText = normalizeForMatch(title);
        const combined = `${artistText} ${titleText}`.trim();

        if (!artist || !title || !combined) {
          return null;
        }

        const key = `${artistText}\n${titleText}`;
        if (seen.has(key)) {
          return null;
        }
        seen.add(key);

        const candidateTokens = new Set(combined.split(' ').filter(Boolean));
        let overlap = 0;
        for (const token of queryTokens) {
          if (candidateTokens.has(token)) overlap += 1;
        }

        let score = queryTokens.size ? (overlap / queryTokens.size) * 100 : 0;

        if (combined === queryText) score += 100;
        else if (combined.includes(queryText) || queryText.includes(combined)) score += 50;

        if (parsed) {
          const expectedArtist = normalizeForMatch(parsed.artist);
          const expectedTitle = normalizeForMatch(parsed.title);

          if (artistText === expectedArtist) score += 120;
          else if (artistText.includes(expectedArtist) || expectedArtist.includes(artistText)) {
            score += 60;
          }

          if (titleText === expectedTitle) score += 160;
          else if (titleText.includes(expectedTitle) || expectedTitle.includes(titleText)) {
            score += 80;
          }
        }

        score += Math.min(6, Math.log10(Math.max(1, Number(item.rank) || 1)));

        return { artist, title, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .map(({ artist, title }) => ({ artist, title }));
  }

  function sanitizeLyrics(value) {
    const lines = String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, ''));
    const repaired = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const next = lines[index + 1];
      const quoteCount = (line.match(/"/g) || []).length;
      const nextQuoteCount = (next?.match(/"/g) || []).length;
      const hasOpenQuote =
        quoteCount % 2 === 1 && !/"\s*(?:\([^)]*\))?\s*$/.test(line);
      const nextClosesQuote =
        Boolean(next) && next.indexOf('"') > 0 && nextQuoteCount % 2 === 1;

      if (hasOpenQuote && nextClosesQuote) {
        repaired.push(`${line.trimEnd()} ${next.trimStart()}`);
        index += 1;
      } else {
        repaired.push(line);
      }
    }

    return repaired.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function findLyricsWithProviders(query, providers, onError = () => {}) {
    for (const provider of providers) {
      try {
        const result = await provider(query);
        if (result) return result;
      } catch (error) {
        onError(error);
      }
    }
    return null;
  }

  return {
    calculatePanelRect,
    findLyricsWithProviders,
    fitPanelRect,
    normalizeVideoTitle,
    parseArtistTitle,
    rankSuggestions,
    sanitizeLyrics,
    waitForChangedValue
  };
});
