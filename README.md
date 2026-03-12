# KeepTrack

A desktop app to track your TV shows and movies.

![KeepTrack](assets/icon.png)

## Features

- **Track shows & movies** — season, episode, watch time, rating, status
- **VLC integration** — auto-creates and updates cards when you play media
- **TMDB integration** — auto-fetches posters and episode/runtime metadata
- **Progress bars** — episodes watched vs total, or time watched vs runtime
- **System tray** — minimizes to tray, keeps running in the background
- **Search & filter** — by name, and by status (Watching / Finished / Wishlist)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [VLC media player](https://www.videolan.org/) (optional, for auto-tracking)
- A free [TMDB API key](https://www.themoviedb.org/settings/api) (optional, for posters)

### Install & Run

```bash
npm install
npm start
```

### Build Portable EXE

> Requires Developer Mode enabled in Windows Settings, or run terminal as Administrator.

```bash
npm run build
# output: dist/KeepTrack.exe
```

## VLC Setup

1. Open VLC → **Tools → Preferences → Show All**
2. Go to **Interface → Main interfaces** → check **Web**
3. Go to **Interface → Main interfaces → Lua** → set a password
4. Restart VLC
5. In KeepTrack Settings, set Host: `localhost`, Port: `8080`, Password: your password

Once connected, playing any video file will automatically create or update the matching card.

## TMDB Setup

1. Create a free account at [themoviedb.org](https://www.themoviedb.org/)
2. Go to **Settings → API** and copy your API key
3. Paste it into KeepTrack **Settings → TMDB API Key**

Posters and episode counts / movie runtimes will be fetched automatically when adding cards.

## License

ISC
