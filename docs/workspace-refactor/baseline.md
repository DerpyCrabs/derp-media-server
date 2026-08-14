# Workspace refactor behavior and capability baseline

This baseline records behavior before the workspace refactor. The source snapshot is `master` at
`3695a88`; `ea0acf3` adds only the roadmap. Workspace and Canvas are the reference desktop hosts.

Legend: **yes** means the workflow exists today, **partial** means the outcome exists with a known
surface-specific gap, and **host** means the behavior belongs to placement or chrome rather than to
the resource feature.

## Workflow matrix

| Workflow                                                          | Library `/`                                                      | Workspace `/workspace`                              | Canvas `/canvas`                              | Reader                                                  | Hermes                                       | Baseline coverage                                                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Direct navigation and refresh                                     | `dir`, `viewing`, `playing`, `audioOnly`, `reader`, `readerKind` | `dir`, `preset`, `ws`                               | route plus persisted active canvas            | query or embedded source                                | durable session ID in a window               | `navigation`, `url-state`, `workspace-layout-*`, `infinite-canvas`, `reader`, `hermes-chat`                                     |
| Browse folders and virtual folders                                | yes                                                              | yes                                                 | yes, inside spatial window                    | image-folder source                                     | desktop-only virtual tree today              | `navigation`, `workspace-controls`, `infinite-canvas`, `folder-virtualization`                                                  |
| Search files and note contents                                    | library palette and KB search                                    | global palette and KB search                        | combined window/library palette and KB search | selection actions, not discovery                        | no shared Library entry today                | `file-search-palette`, `knowledge-base`, `workspace-viewers`, `infinite-canvas`                                                 |
| Open image, text, PDF, book, and unsupported files                | modal/full-page placement                                        | pane/tab/window placement                           | spatial window placement                      | one `ReaderDialog` supports PDF, book, and image folder | session pane                                 | `image-viewer`, `text-editor`, `reader`, `workspace-viewers`, `infinite-canvas`                                                 |
| Play audio and video                                              | bottom audio bar and inline/floating video                       | taskbar audio and viewer video                      | per-window players                            | n/a                                                     | n/a                                          | `audio-player`, `video-player`, `video-audio-mode-switch`, `workspace-media-layout`, `infinite-canvas`                          |
| Create, edit, upload, paste, rename, move, and delete local files | yes in editable roots                                            | yes in editable roots                               | yes through browser windows                   | text edits and KB image paste                           | project/session mutations on desktop         | `editable-folders`, `upload`, `file-browser-misc`, `drag-drop`, `workspace-viewers`, `hermes-chat`                              |
| Persist user state                                                | settings and URL state                                           | local session draft plus server-backed presets/pins | local collection plus server record merge     | SQLite state/preferences and text recovery drafts       | only durable session window identity locally | `workspace-layout-*`, `workspace-named-layouts`, `canvas-persistence`, `infinite-canvas`, `reader`, `hermes-window-persistence` |
| Follow application-mediated path changes                          | active Library query naturally refetches                         | live windows, pins, and presets update              | every saved canvas updates                    | reader state paths update                               | opaque Hermes session IDs are unchanged      | `workspace-path-mutation`, Rust `path_metadata`, `canvas_persistence`, and `reader_state` tests                                 |

## Explorer and resource capability matrix

“Shared” means the capability belongs to the resource/provider and must eventually be available in
all applicable hosts. “Host-only” means the difference is intentional placement, geometry, or input
adaptation. A missing capability is not classified as host-only merely because a surface lacks it.

| Capability                                           | Library                      | Workspace                       | Canvas                    | Classification and current difference                                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------- | ------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browse, breadcrumbs, parent navigation               | yes; URL history             | yes; pane state                 | yes; pane state           | **Shared.** Browser back/forward is currently Library-only; desktop panes retain only current location.                                                                                         |
| List/grid view and fixed server ordering             | yes                          | yes                             | yes                       | **Shared.** View mode is persisted; no surface exposes user-selectable sorting.                                                                                                                 |
| Filename search                                      | yes                          | yes, global surface entry       | yes, combined palette     | **Shared**, with host-specific result placement.                                                                                                                                                |
| Knowledge-base search and recent notes               | yes                          | yes                             | yes                       | **Shared.**                                                                                                                                                                                     |
| Create file/folder                                   | yes                          | yes                             | yes                       | **Shared**, gated by editable-root/provider capability.                                                                                                                                         |
| Upload file/folder and OS drop                       | yes                          | yes                             | yes                       | **Shared**, with surface-specific drop overlays.                                                                                                                                                |
| Clipboard paste as new/replacement file              | yes                          | yes                             | yes                       | **Shared.**                                                                                                                                                                                     |
| Rename                                               | yes                          | yes                             | yes                       | **Shared.**                                                                                                                                                                                     |
| Move and drag-move                                   | yes                          | yes, including cross-window     | yes                       | **Shared**; cross-window drop targeting is host adaptation.                                                                                                                                     |
| Copy to another editable folder                      | yes                          | no                              | no                        | **Shared gap in Workspace/Canvas.**                                                                                                                                                             |
| Delete                                               | yes                          | yes                             | yes                       | **Shared.**                                                                                                                                                                                     |
| Download file/folder                                 | yes                          | yes                             | yes                       | **Shared.**                                                                                                                                                                                     |
| Favorite resource                                    | yes                          | no                              | no                        | **Shared gap in Workspace/Canvas.**                                                                                                                                                             |
| Set custom folder icon                               | yes                          | yes                             | yes                       | **Shared.**                                                                                                                                                                                     |
| Mark/unmark knowledge-base root                      | yes                          | yes                             | yes                       | **Shared.**                                                                                                                                                                                     |
| Visible view-count metadata                          | yes                          | no; opens still increment       | no; opens still increment | **Shared metadata gap in Workspace/Canvas.**                                                                                                                                                    |
| Open with Browser or Reader                          | yes                          | yes                             | yes                       | **Shared semantic choice**; placement is host-only.                                                                                                                                             |
| Image/text/PDF/book/unsupported rendering            | yes                          | yes                             | yes                       | **Shared outcome, duplicated implementations.** Reader content is already reused; image/text ownership is split.                                                                                |
| Text edit, save, conflict, draft recovery            | yes                          | partial                         | partial                   | **Shared gap.** Library owns autosave/read-only settings; desktop owns a separate manual-save controller.                                                                                       |
| Audio/video source, progress, queue, repeat          | yes                          | partial, separate taskbar store | partial, per-window state | **Shared state-machine gap.** Visual controls remain host-specific.                                                                                                                             |
| Favorites and Most Played virtual providers          | yes                          | yes                             | yes                       | **Shared.**                                                                                                                                                                                     |
| Hermes browse, pagination, detail, and actions       | no                           | yes                             | yes                       | **Shared provider gap in Library.** Includes create project/session, rename, branch, move to project, archive/restore/delete, export, copy ID, gateway folders, primary folder, and appearance. |
| Resource multi-selection                             | no                           | no                              | no                        | **Shared capability absent everywhere.** Canvas window selection is host geometry, not resource selection.                                                                                      |
| New browser tab/fullscreen/modal                     | yes                          | n/a                             | n/a                       | **Host-only Library placement.**                                                                                                                                                                |
| New tab/window, split/tile, pin to taskbar           | n/a                          | yes                             | no                        | **Host-only Workspace placement and geometry.**                                                                                                                                                 |
| New spatial window, pan/zoom, multi-window selection | n/a                          | no                              | yes                       | **Host-only Canvas placement and geometry.**                                                                                                                                                    |
| Long-press versus right-click menus                  | long-press and action button | right-click/long-press          | right-click/long-press    | **Host/input adaptation only; action availability remains shared.**                                                                                                                             |

## Persisted-state baseline

Representative fixtures live in `tests/fixtures/persisted-state/reference/` and are validated by
`tests/unit/persisted-state-fixtures.test.ts`.

| Fixture                  | Current owner and format                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.json`          | Legacy on-disk document keyed by library key; imported into SQLite `state_documents`. Includes view modes, favorites, knowledge bases, icons, text autosave, taskbar pins, and a named Workspace layout. |
| `workspace-layout.json`  | `workspace-state-ws-<id>` local-storage value and named-layout snapshot shape. Includes browser/viewer tabs, a split, semantic tiling, pins, open target, and durable Hermes window.                     |
| `canvas-collection.json` | `infinite-canvases-v1` local-storage collection. Its `canvases` records are also the payload persisted by `/api/canvases/sync`.                                                                          |
| `hermes-window.json`     | Durable local Hermes window definition. Only `sessionId`, `cwd`, and `readOnly` persist; draft IDs, messages, attachments, and in-flight state do not.                                                   |

Path identity remains configured-root plus normalized logical path. Existing mutation handlers update
Workspace windows/pins/presets, Canvas records, settings path maps, and Reader state after an
application-mediated move or delete. These tests are mandatory and must not be weakened:

- `tests/unit/workspace-path-mutation.test.ts`
- Rust tests in `server/path_metadata.rs`
- Rust tests in `server/canvas_persistence.rs`
- Rust tests in `server/reader_state.rs`

## Bundle baseline

Exact machine-readable measurements are in `bundle-baseline.json`. At baseline, Workspace
and Canvas have no independent chunks: both are statically imported by the root entry. Only
Markdown and Reader are dynamic entries.

Measurements use `bun run build:client` and Node `zlib.gzipSync` level 9, summing each file once.
The entry JavaScript is 762,953 raw bytes / 215,327 gzip bytes. Its eager static closure (entry,
main CSS, and fonts) is 1,018,225 raw bytes / 387,000 gzip bytes. Full `dist/client` is 3,618,304
raw bytes / 1,158,171 gzip bytes across 25 files.

## Audit omissions locked for later stages

- Library cannot browse or act on Hermes resources because `/api/files` exposes Hermes only for
  `surface=workspace`.
- Workspace and Canvas omit Library's Copy to, Favorite, and visible view-count capabilities.
- Workspace/Canvas text editing and every surface's playback state are separate owners.
- Four existing E2E specs were absent from `test:batch`; the batch now includes them and an exact manifest
  coverage test.
- Media byte-range behavior had no end-to-end regression test; the suite now includes an owner-only fixture
  covering full, bounded, open-ended, suffix, invalid, and out-of-bounds requests.
