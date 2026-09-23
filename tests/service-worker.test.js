const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

function jsonResponse(data, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  );
}

function textResponse(data, status = 200) {
  return Promise.resolve(
    new Response(data, {
      status,
      headers: { 'content-type': 'text/html' }
    })
  );
}

function loadServiceWorker(fetchImpl) {
  const sandbox = {
    console,
    fetch: fetchImpl,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    chrome: {
      action: {
        onClicked: { addListener() {} },
        setBadgeBackgroundColor: async () => {},
        setBadgeText: async () => {},
        setTitle: async () => {}
      },
      tabs: { sendMessage: async () => {} },
      scripting: { executeScript: async () => {} },
      runtime: { onMessage: { addListener() {} } }
    }
  };
  const context = vm.createContext(sandbox);
  sandbox.importScripts = (...files) => {
    for (const file of files) {
      const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
      vm.runInContext(source, context, { filename: file });
    }
  };

  const workerSource = fs.readFileSync(
    path.join(projectRoot, 'service-worker.js'),
    'utf8'
  );
  vm.runInContext(workerSource, context, { filename: 'service-worker.js' });
  return context;
}

test('service worker falls back to LRCLIB after lyrics.ovh has no result', async () => {
  const requests = [];
  const worker = loadServiceWorker((url) => {
    const value = String(url);
    requests.push(value);

    if (value.includes('api.lyrics.ovh/v1/')) return jsonResponse({}, 404);
    if (value.includes('api.lyrics.ovh/suggest/')) return jsonResponse({ data: [] });
    if (value.includes('genius.com/api/search/song')) {
      return jsonResponse({ response: { sections: [] } });
    }
    if (value.includes('lrclib.net/api/search')) {
      return jsonResponse([
        {
          artistName: 'Coldplay',
          trackName: 'Yellow',
          plainLyrics: 'Look at the stars\nLook how they shine for you'
        }
      ]);
    }
    throw new Error(`Unexpected request: ${value}`);
  });

  const result = await worker.findLyrics('Coldplay - Yellow');

  assert.equal(result.ok, true);
  assert.equal(result.source, 'LRCLIB');
  assert.equal(result.artist, 'Coldplay');
  assert.equal(result.title, 'Yellow');
  assert.equal(requests.length, 4);
  assert.match(requests[0], /api\.lyrics\.ovh\/v1\//);
  assert.match(requests[1], /api\.lyrics\.ovh\/suggest\//);
  assert.match(requests[2], /genius\.com\/api\/search\/song/);
  assert.match(requests[3], /lrclib\.net\/api\/search/);
});

test('service worker tries Genius before LRCLIB', async () => {
  const requests = [];
  const worker = loadServiceWorker((url) => {
    const value = String(url);
    requests.push(value);

    if (value.includes('api.lyrics.ovh/v1/')) return jsonResponse({}, 404);
    if (value.includes('api.lyrics.ovh/suggest/')) return jsonResponse({ data: [] });
    if (value.includes('genius.com/api/search/song')) {
      return jsonResponse({
        response: {
          sections: [
            {
              hits: [
                {
                  type: 'song',
                  result: {
                    title: 'Well I Wonder',
                    primary_artist: { name: 'The Smiths' },
                    url: 'https://genius.com/The-smiths-well-i-wonder-lyrics'
                  }
                }
              ]
            }
          ]
        }
      });
    }
    if (value === 'https://genius.com/The-smiths-well-i-wonder-lyrics') {
      return textResponse(
        '<div data-lyrics-container="true">' +
          '<div data-exclude-from-selection="true">40 Contributors</div>' +
          '<span>[Verse 1]</span><br>' +
          'Well, I wonder, do you hear me when you sleep?<br>' +
          'I hoarsely cry (Why?)' +
          '</div>'
      );
    }
    if (value.includes('lrclib.net')) {
      throw new Error('LRCLIB must not run after a Genius result');
    }
    throw new Error(`Unexpected request: ${value}`);
  });

  const result = await worker.findLyrics('The Smiths - Well I Wonder');

  assert.equal(result.ok, true);
  assert.equal(result.source, 'Genius');
  assert.doesNotMatch(result.lyrics, /Contributors/);
  assert.match(result.lyrics, /I hoarsely cry \(Why\?\)/);
  assert.equal(requests.length, 4);
  assert.match(requests[2], /genius\.com\/api\/search\/song/);
  assert.equal(requests[3], 'https://genius.com/The-smiths-well-i-wonder-lyrics');
});