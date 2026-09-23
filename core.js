(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.LyricsCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

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

  return {
    normalizeVideoTitle,
    parseArtistTitle,
    rankSuggestions,
    sanitizeLyrics
  };
});
