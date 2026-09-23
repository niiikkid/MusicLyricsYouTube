# MusicLyricsYouTube

A lightweight Chrome extension that shows lyrics for the current song directly on YouTube and YouTube Music.

## Features

- Detects the song from the current YouTube video.
- Shows lyrics in a clean floating panel without leaving the page.
- Lets you drag the panel by its header and resize it from any edge or corner.
- Remembers the panel position and size between page reloads.
- Updates automatically when YouTube opens the next video.
- Supports manual search when the detected artist or title is incorrect.
- Searches lyrics.ovh first, Genius second, and LRCLIB third.
- Cleans common video labels and minor formatting issues in lyric text.
- Lets you copy the full lyrics with one click.
- Works without an account or API key.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `MusicLyricsYouTube` folder.
6. Pin the extension to the Chrome toolbar.

If YouTube was already open during installation, reload the page once.

## Usage

1. Open a song on YouTube or YouTube Music.
2. Click the extension icon.
3. The lyrics panel will open and search for the current song.
4. If the result is incorrect, enter `Artist — Song` and click the search button.

Click the extension icon again to hide the panel.

### Keyboard shortcut

- macOS: `Command + Shift + L`
- Windows and Linux: `Ctrl + Shift + L`

## How it works

The extension uses Chrome Manifest V3 and runs only after you click its toolbar icon. It reads the current video title, searches lyrics.ovh first, then Genius, and finally LRCLIB. The lyrics.ovh service is itself an aggregator of several lyrics websites, while Genius and LRCLIB provide independent fallback catalogs.

The requested permissions are limited to the active tab, script injection, local panel-layout storage, and access to lyrics.ovh, Genius, and LRCLIB.

## Development

The project has no runtime package dependencies. Run the parser tests with:

```bash
npm test
```

## Credits and references

This project was built with these open-source projects as its main references:

- [NTag/lyrics.ovh](https://github.com/NTag/lyrics.ovh) — provides the public lyrics search API used by this extension.
- [Varal7/lyrics-chrome-extension](https://github.com/Varal7/lyrics-chrome-extension) — the original Chrome extension concept for displaying lyrics from YouTube videos.
- [Genius](https://genius.com/) — provides the second lyrics lookup source.
- [LRCLIB](https://lrclib.net/) — provides the independent fallback lyrics catalog.

MusicLyricsYouTube is an independent Manifest V3 implementation and is not affiliated with YouTube, Google, or the referenced projects.
