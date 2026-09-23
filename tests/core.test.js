const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findLyricsWithProviders,
  normalizeVideoTitle,
  parseArtistTitle,
  rankSuggestions,
  sanitizeLyrics
} = require('../core.js');

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
