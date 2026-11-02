# Media Server

> Mostly vibe-coded; treat it as a personal tool, not a hardened product.

Self-hosted media library with a **Effect + EffectWeb** + Vite web UI and a **Rust/Axum** server. Browse, play, and edit files; workspaces with multi-pane layout; knowledge-base folders with search and Obsidian-style markdown. Changes propagate to open tabs via **SSE**.

## Features (high level)

- Workspaces: snap zones, viewers (image, video, PDF, text), audio player, and persisted layouts.
- Video: shared app controls, two subtitle tracks, audio-track selection, saved speed and language preferences, optional compatibility conversion.
- Music: save the player queue as a playlist, add songs from track/album menus, reorder and rename saved lists. Open **Playlists** from **Your music** or the player’s **Up next** panel; ordinary saved queues also work without AI or a music index. Native audio windows follow playlist order. Missing files stay visible and stale edits from another tab are rejected.
- Knowledge bases: full-text search, recent files, `![[image]]` from `images/`.
- File ops in editable folders: upload, move/copy, rename, delete, inline text edit; grid/list, thumbnails (FFmpeg optional), drag-and-drop.

## Quick start

**Needs:** [Rust](https://www.rust-lang.org/tools/install) and [Bun](https://bun.sh). **Optional:** FFmpeg and ffprobe for video thumbnails, track selection, subtitles, compatibility playback, audio-only video playback and tests.

The frontend uses published EffectWeb packages pinned together to `0.15.0`, with Effect `4.1.0`. A local EffectWeb checkout is not required.

```bash
bun install
```

Create `config.jsonc` (JSON with comments; falls back to `config.json`):

```jsonc
{ "mediaDir": "/path/to/your/media", "editableFolders": ["notes", "documents"] }
```

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Configuration

Path: `CONFIG_PATH` or `--config-path=...`. Options can also be set via environment variables (and `.env`).

| Config              | Env                | Purpose                                                                                    |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `desktopMode`       | —                  | Optional computer navigation and Linux mounted locations (default `false`)                 |
| `mediaDir`          | `MEDIA_DIR`        | Media root for legacy/single-root configs                                                  |
| `port`              | `PORT`             | App port (`3000` by default; `0` assigns a free port); Workspace is served at `/workspace` |
| `mediaDirs`         |                    | Multiple named media roots, each with optional editable folders                            |
| `writeAccess`       | —                  | `editableFolders` (default) or `filesystem`                                                |
| `editableFolders`   | `EDITABLE_FOLDERS` | Comma-separated paths under single-root `mediaDir` where writes are allowed                |
| `fileSearch`        |                    | Persistent filename/path search index settings                                             |
| `imageOptimization` |                    | Responsive viewer variants and disk-cache settings                                         |
| `playback`          |                    | Video conversion permission, shared playback cache, and CPU thread limit                   |
| `mediaAi`           |                    | Optional recommendations and natural-language search                                       |
| `hermes`            |                    | Optional Hermes gateway, profile, and filesystem integration                               |

`dataPath` is config-file only and contains app-created settings, stats, search index,
thumbnails, and optimized image variants. It defaults to `app-data` next to the config file.
On first startup with the default path, legacy data beside the config and legacy caches in the
working directory are migrated automatically.

File search is enabled by default and stores its rebuildable SQLite index under
`<dataPath>/search-index`. The index uses bounded background reconciliation on every platform and
best-effort recursive watchers on local Windows/macOS roots. Linux and network roots use polling so
large libraries do not consume per-directory watcher limits.

For You and radio are available only with Media AI configured. The configured provider reviews
music in the background using file metadata, previous analysis, and the listening profile. Only
reviewed songs appear in recommendations, genre mixes, and albums. The initial HTML includes
cached music recommendations.
Results stay in place until **Refresh recommendations** is used. Page loads do not start AI work.
Album cards use embedded or folder artwork when available. Mix cards show artist examples from
the songs they will play. Genre mixes use prepared AI station selections, spread tracks across
artists, and avoid repeating the same artists and songs across cards. Open an album to inspect its tracks before playing it.

**Up next** in the main and workspace players supports reordering, removal, and shuffle. Explicit
music queues and their paused playback position survive reloads in the same tab. Browsing folders
preserves the playing queue.

Start radio from a track, artist, album, or genre mix. The configured AI selects and orders reviewed
songs in the background using the station context and listening history. Prepared station selections
are included in the initial HTML. Starting radio and advancing or refilling its queue use only that
local snapshot and never make recommendation or AI requests. **Continue with
radio** enables continuation immediately and preserves the current track, position, and queue.
Manually queued tracks play ahead of automatic suggestions. **Don’t recommend** excludes a track from recommendations.

Optional Last.fm genre and similar-artist lookups are configured in `config.jsonc`:

```jsonc
{ "music": { "lastFmApiKey": "your-api-key" } }
```

Artist and track names are sent to Last.fm; listening history is not uploaded. The key stays on the
server, results are cached for 30 days, and failed requests retry with backoff. Music recommendations
and radio work without this connection.

When Media AI is enabled, the model scores media in the background and stores those scores with
prepared previews and metadata. Refresh and scrolling use a local mix of those scores, likes,
playback history, and recent exposure. Time-of-day habits provide a small live adjustment without
another model call. A new library needs an initial ranking pass; existing cards remain available
while the background worker prepares more. With `mediaAi.paused`, an explicit refresh can still request a bounded reserve of ranked media,
while page loads and idle catalog analysis stay paused.

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
{ "playback": { "allowVideoTranscoding": false, "maxCacheSize": "10GiB", "threads": 4 } }
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
{ "hermes": { "gatewayUrl": "http://127.0.0.1:4000", "profile": "default" } }
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

### Optional desktop mode

The ordinary media library and workspace remain the default. Set `desktopMode` to `true`
to add a compact **Places** menu with Home, existing XDG user folders and mounted Linux
filesystems. Places refresh when opened; this browses already mounted storage and does not
mount, unmount or eject devices. Absolute paths and `~` work in **Files → Go to location**.
All locations refer to the computer running the server.

With `mediaDir` or `mediaDirs`, desktop navigation stays inside those configured roots.
On Linux and macOS, omitting both opens `/` instead of the working directory:

```jsonc
{ "desktopMode": true, "writeAccess": "filesystem" }
```

`writeAccess` is independent: omit it for read-only browsing unless `editableFolders` grants
access. With `filesystem`, operations use the server account's OS permissions. This configuration
exposes the files readable by that account to clients of this personal server.
When desktop mode browses a filesystem root, recursive filename indexing is disabled by default;
configure `fileSearch.enabled` explicitly to override it. Folder filtering works without an index.
An existing media root can be retained for an indexed library without enabling computer-wide access.

On a Linux server, desktop mode also enables the system **Trash**. Ordinary file deletion moves
items to the Freedesktop trash; **Places → Trash** lists deleted items from configured media roots
and restores them to their original folder. Restore respects current write permissions and never
replaces an existing file. If the original folder is gone, recreate it first. The list includes
items deleted by other desktop applications from those same roots. It checks the home trash and
applicable mounted local filesystems, without probing automounts or network mounts.
**Shift+Delete** still requests permanent deletion with confirmation. This mode does not change
permanent deletion through the existing `/api/files/delete` API. Restoring recovers file contents;
previous application metadata such as favorites and reading positions is not restored.

### Everyday file browsing

Common features work in both modes, including the web client on macOS:

- Favorite folders appear in **Places** for quick navigation from any window. Use the existing
  **Favorite/Unfavorite** context action; shortcuts follow renames and disappear when deleted.
  Folders with the same name show their paths. This uses the same favorites as the library.

- **Ctrl/Cmd+F** filters filenames in the current folder. The filter appears only when requested,
  ignores case, and closes with Escape. It filters loaded entries in virtual collections.
- **Ctrl+H** shows hidden files and folders; this preference survives navigation and reloads.
  Temporary `.derp-` operation files stay hidden.
- **Arrow keys**, **Home** and **End** move keyboard focus through files, including large virtualized
  folders. Hold **Shift** to extend or shrink a selection, including **Shift+Home/End**.
  **Enter** opens the focused item; **Alt+Up** opens the parent folder. Folder navigation
  returns focus to the listing, so nested and empty folders remain usable without a mouse.
- Workspace file browsers have independent **Back/Forward** history, including split panes.
  Use the arrow buttons or **Alt+Left/Right**; navigation does not change other windows.
- **F2** renames the focused file with its basename selected, preserving the extension.
  **Ctrl/Cmd+Shift+N** creates a folder; **F5** refreshes the current folder.
- **Ctrl/Cmd+L** or **F6** edits the path in the breadcrumb bar. **Ctrl/Cmd+C/X/V** copies, cuts and pastes;
  **Delete** asks before deletion (system Trash in Linux desktop mode, permanent otherwise);
  **Alt+Enter** shows properties.
- Display options include sorting by **Modified** and **Type**. The file actions menu shows selection actions
  when items are selected, and an activity indicator remains visible while operations run or
  need a conflict decision.

The text viewer recognizes common Linux configuration files, TOML/JSONC, systemd units and
extensionless files such as Makefile and Dockerfile. **Open as text** handles unrecognized UTF-8
files; binary files and files larger than 16 MiB are rejected with an explanation.

Favorite folder shortcuts follow the purpose of [Finder Favorites](https://support.apple.com/en-euro/guide/mac-help/mchl83c9e8b8/27/mac/27)
and [GNOME folder bookmarks](https://teams.pages.gitlab.gnome.org/websites/help.gnome.org/gnome-help/files-browse.html).

### Documents and media viewers

These improvements are shared by the library, workspace, web and native clients; they do not
require desktop mode.

- **Images:** zoomed images can be dragged or scrolled to inspect every edge. Scroll changes
  images only in Fit mode. **1** shows original pixels at 100%, **0** restores Fit, **+/-** zoom,
  and **R** rotates. Ctrl+wheel zooms. Manual zoom loads the original image for accurate detail;
  Fit continues using responsive image variants. Rotation in the viewer is a viewing adjustment.
  **Edit image** opens a separate crop/rotate/flip/resize mode with undo/redo. Crop by dragging,
  moving the selection or its corner handles, or enter exact pixel bounds after Select all.
  Save a PNG/JPEG copy into an editable folder. Browser mode also offers a download. Existing files are never replaced;
  exported copies contain the visible still image without original metadata. Editing is limited
  to 40 megapixels and 16,384 pixels per side.
- **Plain text and configuration files:** the editor supports undo/redo, **Find** / **Ctrl/Cmd+F**
  with replacement, **Go to line** / **Ctrl/Cmd+G**, and a **Wrap lines** toggle. Configuration
  files have line numbers and a monospace font. Existing save, autosave and conflict handling
  remain in charge of writes; read-only mode preserves an editable file's unsaved draft.
  **Save as** (Ctrl/Cmd+Shift+S) writes the current text to a new file; Browser downloads include unsaved text and are hidden in desktop mode. Browser-local IndexedDB backups offer Restore unsaved changes in the document menu when the same file is reopened.
  Restored drafts require an explicit save, and a changed server file remains protected by version
  checks. Each open view has its own backup. These backups stay in that browser profile, are not
  synced to other devices, and are lost if browser site data is cleared.
  Original line endings, including mixed endings, are retained through edits and undo.
  Markdown documents also support **Ctrl/Cmd+F** search and replacement when editable.
- **Code and configuration files:** syntax highlighting loads on demand for JSON, TOML, YAML, INI, shell, Python, Rust, C/C++, JavaScript/TypeScript, HTML/CSS/XML and SQL. File names and executable shebangs select the language automatically. The language button opens editor options for indentation, wrapping and line numbers; its tooltip shows cursor position and line endings. Existing indentation and line endings are preserved. Display choices are remembered in this browser; language and indentation overrides apply to the current document. Code blocks can be folded from the gutter. Highlighting is disabled above 2 MiB; text viewing and saving support files up to 16 MiB. These controls follow [Kate’s per-document language and indentation settings](https://docs.kde.org/stable_kf6/en/kate/katepart/tools-menu.html).
- **PDF, EPUB and FB2:** the magnifying glass or **Ctrl/Cmd+F** searches the document, including
  pages and chapters not currently rendered. Enter/Shift+Enter and the arrow buttons move through
  matches; Escape closes search before closing the document. Search highlights
  matches in browsers supporting the CSS Custom Highlight API. PDF search requires embedded text;
  it does not OCR scanned pages. Results are limited to the first 10,000 matches, indicated by `+`.
- **Audio:** playback speed is available in the desktop library player, workspace audio controls,
  and canvas audio viewer. The focused canvas player also supports Space/K for play/pause,
  Left/Right for five-second seeking, J/L for ten-second seeking, and M for mute.
- **Sleep timer:** the audio playback menu, Up next panel and video playback settings offer 5–60 minute presets, a custom delay (up to 24 hours), or the end of the current item. The timer pauses playback before repeat or queue advancement. Timed delays continue while paused and across tracks; manually selecting another track cancels an end-of-item timer. The timer belongs to this player session and is cleared by closing/reloading it. This follows [Spotify’s sleep timer workflow](https://newsroom.spotify.com/2022-08-02/how-to-make-spotifys-sleep-timer-part-of-any-bedtime-routine/).
- **Video:** Each subtitle track has an **Open subtitle file…** button for local SRT/WebVTT files, including UTF-8 and BOM-marked UTF-16. These files stay in the current viewer session and are never uploaded; up to eight files (4 MiB and 50,000 cues each) can be loaded, selected or turned off. Loading a broken file preserves the previous track. This follows the explicit subtitle-file workflow in [VLC](https://docs.videolan.me/vlc-user/desktop/3.0/en/basic/subtitles.html) and [mpv](https://mpv.io/manual/stable/#command-interface-sub-add).

PDF links work directly on the page: internal and named destinations navigate within the reader without changing its zoom; external links open separately. Image-region selection temporarily disables links so dragging a region does not open one.

PDFs protected by a password prompt for it when opened; passwords are not remembered.

When a text file changes elsewhere while you have unsaved edits, **Review changes…** opens the server version beside your editable draft. Transfer individual changed blocks, edit, undo/redo, or use the entire server version. Changes stay in your draft when the comparison closes. **Use reviewed version** adopts the reviewed server revision as the save baseline; automatic saving stays paused until you explicitly save. A newer server revision requires another review, and the save still checks the revision atomically. Comparison preserves BOM and existing line endings, including copied blocks, and is limited to 2 million characters per side. This follows [VS Code's compare-with-saved workflow](https://github.com/microsoft/vscode-docs/blob/main/docs/editing/codebasics.md#compare-files), using a lazily loaded CodeMirror merge view.

The image viewer's **Image actions** menu contains Copy image; browser mode also offers Download. **Ctrl/Cmd+C** copies PNG pixels, including the current viewing rotation, for pasting into other apps. Clipboard access requires HTTPS or the native client. Copying preserves original resolution and does not modify the original. Images up to 40 megapixels / 16,384 pixels per side and 64 MiB are supported. Animated images produce a still image.

Image edits are backed up in the current browser profile, including the source image bytes. Reopening Edit image offers to restore a draft after a reload or a closed workspace window, even if the original file has since changed. Saving a server copy, completing a native export or explicitly discarding edits removes that view’s backup. Browser downloads retain the backup, including after closing the editor, because their completion cannot be confirmed. Storage failures are shown in the editor; drafts are local to the browser and may be removed when browser data is cleared.

Image editing follows [Gwenview](https://docs.kde.org/stable_kf6/en/gwenview/gwenview/image_operations.html)
and [Preview](https://support.apple.com/guide/preview/crop-resize-or-rotate-an-image-prvw2015/mac).
Draft recovery follows the session-oriented approach of
[GNOME Text Editor](https://help.gnome.org/gnome-text-editor/basics-draft-folder.html) and
[VS Code Hot Exit](https://code.visualstudio.com/docs/editing/codebasics#_hot-exit).
Viewer interactions are informed by [GNOME Image Viewer](https://help.gnome.org/loupe/viewing-images.html),
[Evince document search](https://help.gnome.org/evince/finding.html),
[gedit search and editing shortcuts](https://help.gnome.org/users/gedit/stable/gedit-shortcut-keys.html.ar),
and [VLC playback and subtitle controls](https://docs.videolan.me/vlc-user/en/support/faq/faqwindows.html).

Playlist interactions follow the existing player queue and contextual song actions, as in [GNOME Music](https://help.gnome.org/gnome-music/index.html) and [Elisa](https://docs.kde.org/stable5/en/elisa/elisa/elisa.pdf). Playlist changes affect saved lists, not music files; repeated additions keep each file once. Large lists show 100 songs at a time with **Show more songs**; search selections survive filtering and paging.

Ogg files follow the [Xiph format profiles](https://wiki.xiph.org/MIME_Types_and_File_Extensions): `.ogg`, `.oga` and `.opus` open as audio, while `.ogv` opens as video. Existing search indexes and prepared library entries are reclassified without deleting listening history or favorites. Legacy Theora videos named `.ogg` should use `.ogv` so the intended viewer is selected.

Reading notes live in the existing **Contents / Notes** sidebar for PDFs, books and image-page readers. **Ctrl/Cmd+B** opens notes; **Ctrl/Cmd+Alt+B** bookmarks the current location. Select document text and choose **Save quote** to keep a passage with your own comment. Notes can be edited, filtered, deleted and exported as Markdown without modifying the original document. Unfinished notes have a browser-local recovery copy; saved notes follow file renames. After a document is replaced, earlier notes remain readable and exportable, with their outdated navigation disabled. Concurrent edits are checked before saving. This follows [calibre's selection and annotation workflow](https://github.com/kovidgoyal/calibre/blob/master/manual/viewer.rst); notes belong to this server's library rather than being embedded PDF annotations.

Open an archive in the file manager and select an entry to view it without extracting it to your library. Text has syntax highlighting and search; images have fit/actual-size views; PDFs have selectable text, page navigation and zoom. Small audio/video files use the shared playback controls and stop on close. Opening an entry follows [Ark's read-only preview workflow](https://docs.kde.org/stable_kf6/en/ark/ark/ark-work-files.html). Browser mode can download the open entry; desktop mode uses extraction. Preview limits are 32 MiB per file, 2 MiB for inline UTF-8 text, and a 512 MiB scan budget for TAR streams; larger files can still be extracted normally. HTML/SVG show source text, and encrypted PDFs can be downloaded for the full document reader.

CSV and TSV files open as tables with a row filter, sortable column headings, and a **Table view** option in Document actions. **Table options** controls the separator and whether the first row supplies headings. Sort and filter affect only the view; values remain text, including leading zeroes, dates, and formula-looking strings. Click a cell to inspect or edit its complete value; changes use the existing save, conflict and draft-recovery mechanisms. Cell edits preserve the rest of the source, including BOM, quoting and mixed line endings. Arrow keys, Home/End and Page Up/Down navigate cells; Ctrl/Cmd+Home/End reaches the first/last cell, F2 opens its value, and Ctrl/Cmd+C copies a focused cell. Large tables parse in a worker and render only visible rows/columns, with a preview limit of 100,000 records, 250,000 cells and 512 columns; the full source remains available in Text. Separator/quote handling follows [RFC 4180](https://www.rfc-editor.org/info/rfc4180/), with explicit import controls inspired by [LibreOffice Text Import](https://help.libreoffice.org/latest/en-US/text/shared/00/00000208.html); this viewer does not evaluate formulas or infer data types.

### Filesystem write permissions

Set `writeAccess` to `"filesystem"` to allow file operations according to the OS permissions of the account running the server:

```json
{ "mediaDir": "/path/to/your/media", "writeAccess": "filesystem" }
```

This also applies to every root in `mediaDirs`. Remove `editableFolders` from both the top level and all `mediaDirs` entries, and unset `EDITABLE_FOLDERS`; combining any of them (even an empty list) with filesystem mode is a startup error. Omitting `writeAccess`, or setting it to `"editableFolders"`, keeps the existing allowlist behavior.

In filesystem mode the UI offers write actions throughout the configured media roots. The OS checks each actual operation, including file permissions, directory permissions, and ACLs; denied operations return HTTP 403. A read-only file can still be renamed or deleted if the OS permits changes to its parent directory. Media-root boundaries and symlink escape protections still apply.

## Desktop client

An optional Qt WebEngine client opens library folders, images, videos, text, PDFs and books in native
windows managed by your desktop. It includes a tray process, CLI opener, cross-app file copying,
and Arch packaging with a user systemd service. See [desktop setup and packaging](desktop/README.md).

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

Lint inherits the EffectWeb compiler preset and Effect TSGO correctness and antipattern
presets. Warnings fail the check, including unused lint suppressions. The `prepare`
script patches Oxlint with `@effect/tsgo`; keep its supported Oxlint and
`oxlint-tsgolint` versions aligned when updating dependencies.

The config permits `unknown` and untagged `Error` at library/UI boundaries, and
zero-argument Effect factories. Prefer tagged errors when callers need to distinguish
failures. Effect style suggestions are not enforced. The frontend additionally checks
floating/misused Promises, exhaustive switches, and consistent returns.

## Stack

Rust, Axum, Effect, EffectWeb, Vite, Tailwind CSS v4, Bun, TypeScript, Playwright, oxlint / oxfmt.

## License

MIT

**Reopen closed tab** (Ctrl/Cmd+Shift+T, or the tab context menu) restores the last closed tab or window group in desktop and canvas workspaces, including its tab order and layout. History is limited to 20 close operations per workspace in the current mounted workspace session; it is not stored across reloads. No extra toolbar button is added. Reopening restores the document location, not live playback or unsaved in-memory application state; existing local draft recovery remains available.

**Workspace commands** (Ctrl/Cmd+Shift+P, or F1) searches every open window/tab by title and path, including minimized windows and offscreen canvas documents. Enter activates the selected document and focuses its content; Escape restores the previous focus. The same list offers file search, new browsers, workspace switching, and actions for the active window. Canvas adds fit-all and 100% zoom. Commands respect pinned tabs and workspace ownership. Only 80 results render at once; searching still covers all windows. The entry and keyboard behavior follow [VS Code's command palette](https://code.visualstudio.com/docs/reference/default-keybindings).

DOCX and ODT open in a **read-only reading preview** with headings, lists, tables (including merged cells), embedded images and local section links. They share the reader's search, appearance, position, bookmarks and notes. In browser mode, **Download original** in reader settings keeps the source available for office editing or exact page layout. The preview reflows content; page breaks, headers/footers, comments, charts and embedded objects are not reproduced. DOCX footnotes/endnotes appear at the end. External images and embedded code are not loaded or executed. Password-protected, legacy `.doc` and macro-enabled `.docm` files are not supported. Parsing runs in a worker, limited to 64 MB compressed, 128 MB expanded, 16 MB per package entry, 8 MB per XML part and bounded XML depth/node count. Existing EPUB/FB2 downloads also have a streaming size limit. DOCX follows [Microsoft's WordprocessingML structure](https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document); both parsers are tested against actual python-docx and LibreOffice output. Native MIME registration includes DOCX/ODT, and search indexes repair their document classification on startup.
