const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculatePanelRect,
  findLyricsWithProviders,
  fitPanelRect,
  normalizeVideoTitle,
  parseArtistTitle,
  rankSuggestions,
  sanitizeLyrics
} = require('../core.js');

test('calculatePanelRect moves the panel and keeps it inside the viewport', () => {
  assert.deepEqual(
    calculatePanelRect(
      { left: 600, top: 70, width: 390, height: 600 },
      500,
      -100,
      'move',
      { width: 1000, height: 800 }
    ),
    { left: 602, top: 8, width: 390, height: 600 }
  );
});

test('calculatePanelRect resizes from every edge without crossing minimum size', () => {
  const viewport = { width: 1200, height: 900 };
  const start = { left: 400, top: 200, width: 390, height: 500 };

  assert.deepEqual(calculatePanelRect(start, -200, -400, 'nw', viewport), {
    left: 200,
    top: 8,
    width: 590,
    height: 692
  });
  assert.deepEqual(calculatePanelRect(start, -300, -400, 'se', viewport), {
    left: 400,
    top: 200,
    width: 300,
    height: 240
  });
});

test('fitPanelRect restores an oversized saved panel into the current viewport', () => {
  assert.deepEqual(
    fitPanelRect(
      { left: 900, top: 700, width: 700, height: 800 },
      { width: 1000, height: 700 }
    ),
    { left: 292, top: 8, width: 700, height: 684 }
  );
});

test('normalizeVideoTitle removes YouTube suffix and common video labels', () => {
  assert.equal(
    normalizeVideoTitle('The Weeknd - Blinding Lights (Official Video) - YouTube'),
    'The Weeknd - Blinding Lights'
  );
});

test('normalizeVideoTitle removes audio, lyrics and quality labels', () => {
  assert.equal(
    normalizeVideoTitle('Daft Punk - Get Lucky [Official Audio] (Lyrics) [4K]'),
    'Daft Punk - Get Lucky'
  );
});

test('normalizeVideoTitle removes a trailing unwrapped official-video label', () => {
  assert.equal(
    normalizeVideoTitle('Adele - Hello | Official Music Video'),
    'Adele - Hello'
  );
});

test('parseArtistTitle accepts common separators and keeps the song title intact', () => {
  assert.deepEqual(parseArtistTitle('Daft Punk — Get Lucky (feat. Pharrell Williams)'), {
    artist: 'Daft Punk',
    title: 'Get Lucky (feat. Pharrell Williams)'
  });
});

test('rankSuggestions favors the matching artist over a higher-ranked cover', () => {
  const ranked = rankSuggestions('The Weeknd - Blinding Lights', [
    {
      title: 'Blinding Lights',
      title_short: 'Blinding Lights',
      rank: 999999,
      artist: { name: 'Cover Masters' }
    },
    {
      title: 'Blinding Lights',
      title_short: 'Blinding Lights',
      rank: 100,
      artist: { name: 'The Weeknd' }
    }
  ]);

  assert.deepEqual(ranked[0], {
    artist: 'The Weeknd',
    title: 'Blinding Lights'
  });
});

test('sanitizeLyrics cleans technical whitespace and repairs a quote split across lines', () => {
  const raw = '\uFEFFFirst line  \r\nSecond\u00a0line\r\n\r\n\r\n"My, oh, my\r\nBaby, this my kind of night"\u200B';

  assert.equal(
    sanitizeLyrics(raw),
    'First line\nSecond line\n\n"My, oh, my Baby, this my kind of night"'
  );
});

test('findLyricsWithProviders keeps the configured provider order', async () => {
  const calls = [];
  const result = await findLyricsWithProviders('Artist - Song', [
    async () => {
      calls.push('primary');
      return { artist: 'Artist', title: 'Song', lyrics: 'Primary lyrics' };
    },
    async () => {
      calls.push('fallback');
      return { artist: 'Artist', title: 'Song', lyrics: 'Fallback lyrics' };
    }
  ]);

  assert.deepEqual(calls, ['primary']);
  assert.equal(result.lyrics, 'Primary lyrics');
});

test('findLyricsWithProviders continues after a provider error', async () => {
  const errors = [];
  const result = await findLyricsWithProviders(
    'Artist - Song',
    [
      async () => {
        throw new Error('primary unavailable');
      },
      async () => ({ artist: 'Artist', title: 'Song', lyrics: 'Fallback lyrics' })
    ],
    (error) => errors.push(error.message)
  );

  assert.deepEqual(errors, ['primary unavailable']);
  assert.equal(result.lyrics, 'Fallback lyrics');
});

test('findLyricsWithProviders continues when a provider has no result', async () => {
  const calls = [];
  const result = await findLyricsWithProviders('Artist - Song', [
    async () => {
      calls.push('primary');
      return null;
    },
    async () => {
      calls.push('fallback');
      return { artist: 'Artist', title: 'Song', lyrics: 'Fallback lyrics' };
    }
  ]);

  assert.deepEqual(calls, ['primary', 'fallback']);
  assert.equal(result.lyrics, 'Fallback lyrics');
});
