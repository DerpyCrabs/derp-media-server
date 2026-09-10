# Media Server

> Mostly vibe-coded; treat it as a personal tool, not a hardened product.

Self-hosted media library with a **Solid.js** + Vite web UI and a **Rust/Axum** server. Browse, play, and edit files; workspaces with multi-pane layout; knowledge-base folders with search and Obsidian-style markdown. Changes propagate to open tabs via **SSE**.

## Features (high level)

- Workspaces: snap zones, viewers (image, video, PDF, text), audio player, and persisted layouts.
- Video: shared app controls, two subtitle tracks, audio-track selection, saved speed and language preferences, and optional compatibility conversion.
- Knowledge bases: full-text search, recent files, `![[image]]` from `images/`.
- File ops in editable folders: upload, move/copy, rename, delete, inline text edit; grid/list, thumbnails (FFmpeg optional), drag-and-drop.

## Quick start

**Needs:** [Rust](https://www.rust-lang.org/tools/install) and [Bun](https://bun.sh). **Optional:** FFmpeg and ffprobe for video thumbnails, track selection, subtitles, compatibility playback, audio-only video playback and tests.

```bash
bun install
```

Create `config.jsonc` (JSON with comments; falls back to `config.json`):

```jsonc
{
  "mediaDir": "/path/to/your/media",
  "editableFolders": ["notes", "documents"],
}
```

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Configuration

Path: `CONFIG_PATH` or `--config-path=...`. Options can also be set via environment variables (and `.env`).

| Config              | Env                | Purpose                                                                     |
| ------------------- | ------------------ | --------------------------------------------------------------------------- |
| `mediaDir`          | `MEDIA_DIR`        | Media root for legacy/single-root configs                                   |
| `port`              | `PORT`             | App port; Workspace is served at `/workspace` (default `3000`)              |
| `mediaDirs`         |                    | Multiple named media roots, each with optional editable folders             |
| `editableFolders`   | `EDITABLE_FOLDERS` | Comma-separated paths under single-root `mediaDir` where writes are allowed |
| `fileSearch`        |                    | Persistent filename/path search index settings                              |
| `imageOptimization` |                    | Responsive viewer variants and disk-cache settings                          |
| `playback`          |                    | Video conversion permission, shared playback cache, and CPU thread limit    |
| `mediaAi`           |                    | Optional recommendations and natural-language search                        |
| `hermes`            |                    | Optional Hermes gateway, profile, and filesystem integration                |

`dataPath` is config-file only and contains app-created settings, stats, search index,
thumbnails, and optimized image variants. It defaults to `app-data` next to the config file.
On first startup with the default path, legacy data beside the config and legacy caches in the
working directory are migrated automatically.

File search is enabled by default and stores its rebuildable SQLite index under
`<dataPath>/search-index`. The index uses bounded background reconciliation on every platform and
best-effort recursive watchers on local Windows/macOS roots. Linux and network roots use polling so
large libraries do not consume per-directory watcher limits.

When Media AI is enabled, the model scores media in the background and stores those scores with
prepared previews and metadata. Refresh and scrolling use a local mix of those scores, likes,
playback history, and recent exposure. Time-of-day habits provide a small live adjustment without
another model call. A new library needs an initial ranking pass; existing cards remain available
while the background worker prepares more. With `mediaAi.paused`, opening or refreshing the feed
can still request a bounded reserve of ranked media, while idle catalog analysis stays paused.

```jsonc
{
  "fileSearch": {
    "enabled": true,
    "watchMode": "auto", // "auto" or "off"
    "maxRecursiveWatchers": 32,
    "maxFsConcurrency": 4,
    "reconcileDirectoriesPerSecond": 128,
  },
}
```

Image optimization is enabled by default for full-screen and workspace image viewers. Static
JPEG, PNG, and WebP files are converted on demand to responsive WebP variants. Widths, quality,
and cache size remain configurable; omitted fields use these defaults:

```jsonc
{
  "imageOptimization": {
    "enabled": true,
    "widths": [640, 1280, 1920, 2560, 3840],
    "quality": 82,
    "maxCacheSize": "10GiB",
  },
}
```

`maxCacheSize` accepts `KB`, `MB`, `GB`, `KiB`, `MiB`, and `GiB` suffixes case-insensitively.
Variants live under `<dataPath>/image-variants`; changing widths or quality creates distinct cache
entries. Generated thumbnails live under `<dataPath>/thumbnails`.

The workspace and media center use the same video controls. Controls and the cursor hide after
2.5 seconds while playing, including fullscreen; moving the pointer or tapping reveals them.
Pausing, opening settings, or using keyboard focus keeps controls visible. With the video focused,
Space/K toggles playback, arrows seek 5 seconds, J/L seek 10 seconds, F toggles fullscreen, and M
toggles mute.

Playback settings offer audio-track selection, primary and optional second subtitles, and speed
from 0.25× to 3×. Language preferences and per-video track/speed overrides are stored on the server
and synchronize across devices. New videos start at 1×. Embedded text subtitles and matching SRT,
VTT, ASS or SSA files beside the video or one folder below it are supported (for example,
`movie.en.srt` or `Subs/movie.ja.ass`). ASS/SSA display as plain text; bitmap subtitles such as PGS
and original ASS styling are unsupported.

These are the playback defaults in `config.jsonc`; restart the server after changing them:

```jsonc
{
  "playback": {
    "allowVideoTranscoding": false,
    "maxCacheSize": "10GiB",
    "threads": 4,
  },
}
```

Compatible originals play directly. Container remuxing, selected audio tracks, audio conversion,
and subtitle extraction work without enabling video conversion. Set `allowVideoTranscoding` to
`true` to allow incompatible video to be converted to H.264 while it plays. This requires FFmpeg
with libx264; HDR conversion also requires zscale and tonemap. Video conversion preserves the source
dimensions with no resolution ceiling or automatic downscaling. PQ/HLG HDR with BT.2020 primaries is
tone-mapped to BT.709 SDR when conversion is needed; unsupported dimensions or color information
produce an error.

Audio and video share a playback session that keeps requested seeks separate from media events.
Dragging previews a position and seeks on release. Compatibility streams use MediaSource with
original timestamps, the full timeline, and a bounded browser buffer; seeking outside that buffer
starts a stream at the requested position. Near the end, the player reads the remaining frames and
uses their actual duration when container metadata runs long.

One video conversion and up to two audio/remux/subtitle jobs can run at once. `threads` limits
FFmpeg decode, filter and video-encode threads (1–64). Processing begins on demand, and closing or
switching playback cancels its unfinished stream. Completed outputs are reused under
`<dataPath>/playback-cache`. Its shared `maxCacheSize` budget includes audio, subtitles, temporary
output, and legacy audio extracts; image caches have a separate budget. Unused outputs are evicted
oldest first, active transfers are protected, and playback reports an error if the output cannot
fit. Cancelled temporary output is deleted; stale temporary files are removed on startup.

Hermes chat and Reader AI are optional and use the configured Hermes gateway.

```jsonc
{
  "hermes": {
    "gatewayUrl": "http://127.0.0.1:4000",
    "profile": "default",
  },
}
```

Use `mediaDirs` when serving multiple media roots:

```jsonc
{
  "mediaDirs": [
    { "path": "D:/Media/Movies", "name": "Movies", "editableFolders": ["Incoming"] },
    { "path": "E:/Shows", "editableFolders": ["Downloads", "Notes"] },
  ],
}
```

When more than one media root is configured, the browser root shows each media directory
as a folder. Paths are prefixed by the root name, for example `Movies/Incoming`.
`name` is derived from the directory basename when possible, but must be set explicitly
if the basename is empty, duplicates another media root, or conflicts with a virtual
folder such as `Favorites` or `Most Played`.

## Production

```bash
bun run build
bun run start
```

Listens on `0.0.0.0` by default.

## Development

- Lint and typecheck: `bun run lint` (Oxlint `typeAware` + `typeCheck`)
- E2E: `bun run test` (single worker) or `bun run test:batch` (CI-style batches)
- Unit: `bun run test:unit`

## Stack

Rust, Axum, Solid.js, Vite, TanStack Query (Solid), Tailwind CSS v4, Bun, TypeScript, Playwright, oxlint / oxfmt.

## License

MIT
