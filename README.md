# Media Server

> Mostly vibe-coded; treat it as a personal tool, not a hardened product.

Self-hosted media library with a **Solid.js** + Vite web UI and a **Rust/Axum** server. Browse, play, and edit files; workspaces with multi-pane layout; knowledge-base folders with search and Obsidian-style markdown. Changes propagate to open tabs via **SSE**.

## Features (high level)

- Workspaces: snap zones, viewers (image, video, PDF, text), audio player, and persisted layouts.
- Knowledge bases: full-text search, recent files, `![[image]]` from `images/`.
- File ops in editable folders: upload, move/copy, rename, delete, inline text edit; grid/list, thumbnails (FFmpeg optional), drag-and-drop.

## Quick start

**Needs:** [Rust](https://www.rust-lang.org/tools/install) and [Bun](https://bun.sh). **Optional:** FFmpeg for video thumbnails, audio-only video playback and tests.

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
| `hermes`            |                    | Optional Hermes gateway, profile, and filesystem integration                |

`dataPath` is config-file only and contains app-created settings, stats, mounts, search index,
thumbnails, and optimized image variants. It defaults to `app-data` next to the config file.
On first startup with the default path, legacy data beside the config and legacy caches in the
working directory are migrated automatically.

File search is enabled by default and stores its rebuildable SQLite index under
`<dataPath>/search-index`. The index uses bounded background reconciliation on every platform and
best-effort recursive watchers on local Windows/macOS roots. Linux and network roots use polling so
large libraries do not consume per-directory watcher limits.

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

Hermes chat is optional. Reader AI is disabled because current Hermes sessions cannot enforce a
no-tools policy for untrusted document content.

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

Additional media roots can be added without restarting from **Settings → Media directories**.
They are persisted in `mounts.json` under `dataPath` and are always read only. Runtime roots
appear alongside configured `mediaDirs`. Their names and server paths can be changed from the
settings dialog.

## Production

```bash
bun run build
bun run start
```

Listens on `0.0.0.0` by default.

## Development

- Typecheck: `bun run tsgo`
- Lint: `bun run lint-errors`
- E2E: `bun run test` (single worker) or `bun run test:batch` (CI-style batches)
- Unit: `bun run test:unit`

## Stack

Rust, Axum, Solid.js, Vite, TanStack Query (Solid), Tailwind CSS v4, Bun, TypeScript, Playwright, oxlint / oxfmt.

## License

MIT
