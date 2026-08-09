# Infinite Canvas Workspace Specification

## Status

Accepted product specification for first implementation. Canvas is an admin-only experiment beside the existing tiled workspace. It does not replace, import, or mutate workspace layouts.

## Goal

Test whether stable two-dimensional placement improves project discoverability, separation of concerns, and spatial recall for daily knowledge and media work.

## Route and ownership

- Canvas lives at `/canvas` and is reachable directly by URL.
- Route is admin-only. Share routes cannot use canvas or admin-only APIs.
- Canvas starts blank.
- Files and reusable browser/viewer/editor components are shared with the existing application.
- Canvas windows, camera, geometry, and history are isolated from workspace state.
- Canvases are named, versioned, stored immediately in browser `localStorage`, and synchronized to
  admin-only server storage when online.

## World and camera

- Canvas is an unbounded two-dimensional world with stable world coordinates.
- Middle-button or Space drag pans. Two-finger/plain wheel pans canvas background; `Ctrl+wheel`
  zooms around cursor. Embedded readers retain native scrolling. Zoom is capped at 100%, so
  workspace windows never render larger than their native size.
- Top bar contains canvas picker, breadcrumb, unified search, undo/redo, Fit All, zoom out, zoom percentage/reset, zoom in, and reset under overflow actions.
- `Ctrl+P` opens unified search and overrides browser Print only on `/canvas`.
- Search jumps, Fit All, breadcrumb navigation, and focus transitions animate unless reduced motion is requested.
- Desktop with mouse is supported. Touch/mobile/trackpad-specific interaction is outside first implementation.

## Semantic zoom

- Far zoom renders lightweight window summaries.
- Mid zoom renders window summaries over preserved live panes.
- Near zoom reveals live interactive components. Zoom never remounts window panes.
- A thumbnail click selects it. Double-click focuses it at readable scale.

## Grid and placement

- Window position and size are quantized to a fixed world grid.
- Adaptive dot grid is subtle at working zoom and hidden far out. It is temporarily suppressed during
  middle-button pan so camera movement remains compositor-only.
- Move/resize snaps to shared grid coordinates without alignment guide lines.
- New items begin near requested world point, then search nearby grid cells for a non-overlapping position.
- Existing windows never move to make space for a new item.

## Windows

- Browser and viewer content components are reused with canvas-native chrome.
- Windows can overlap. Clicking brings window to front.
- Chrome includes icon/title drag handle, close button, and edge/corner resize.
- Last resized size is remembered locally per window type (browser or viewer) and becomes
  default size for new windows of that type, including drag previews.
- Window menu: Focus, Open another copy, Close.
- No taskbar, minimize, fullscreen state, tab groups, multi-selection, lasso, or bare Delete shortcut.
- Camera focus replaces maximize/fullscreen.
- Closing removes canvas instance only and never deletes underlying content.

## Creation, opening, and drag

- Empty-canvas menu: Search library, Open file browser, Fit All, Reset View.
- Right-click world position is insertion anchor. Top-bar actions use viewport center.
- File opened from canvas browser appears beside browser and uses nearest free grid position.
- Opening or searching an already-open file jumps to existing window.
- Explicit `Open another copy` creates a duplicate.
- Dragging a file/folder row from canvas browser previews exact collision-resolved window position
  and size with cursor as requested window center, then creates viewer/browser at those bounds.
  Preview begins only after cursor reaches canvas space outside existing windows. Dragged items
  intentionally permit duplicates.
- Operating-system file drops are unsupported.
- Double-click and canvas paste create instant canvas notes. Notes can be promoted to Markdown
  documents in a configured writable directory. Explicit New document creates a file directly.
- Selecting text in a canvas document offers cited quote capture beside source. Reading position is
  restored locally per canvas and document.

## Unified search

Results are grouped in this order:

1. Open canvas windows: jump to window.
2. Canvas notes: jump to note.
3. Indexed library results: create browser/viewer using placement rules.

Existing indexed library search APIs remain source of file results. Sections are visually distinct.

## Context menus

- Canvas menus own empty canvas and window chrome.
- Right-click inside editor/browser/media content stays owned by content component or native browser behavior.

## Persistence and recovery

- Multiple named canvases can be created, renamed, switched, and deleted.
- Local writes never wait for network. Reconnect and periodic online sync merge records by timestamp
  and stable writer ID; deletion tombstones prevent deleted canvases from reappearing.
- Persist window definitions/paths, browser folders, bounds, z-order, and camera.
- Do not persist focus, menus, editor selection, scroll offsets, media playback position, or undo stack.
- Missing paths retain geometry and display unavailable state with Retry, Search replacement, and Remove actions where component/API detection permits.
- Canvas undo/redo covers create, close, move, and resize.
- `Ctrl+Z/Y` controls canvas only while canvas background/chrome owns focus; focused editors retain their own undo stack.
- Undo history may reset on reload.

## AI context

- AI actions always open source preflight showing selection or entire-canvas scope.
- Users can include, exclude, and order sources and edit instruction before context assembly.
- Text and PDF documents contribute extracted text within per-source and total limits.
- Relationships use item titles and optional labels in assembled context.

## Performance

No hard canvas item limits. Semantic zoom changes representation for usability without unmounting panes.
Middle-button pan updates one compositor transform per animation frame and commits camera state once on
release. Large directory listings retain their existing row virtualization and remeasure after remount.

## Acceptance checks

- `/canvas` loads blank without creating/changing normal workspace state.
- Reload restores active local canvas immediately; online sync restores and reconciles named canvases across devices.
- Move/resize quantize to grid; insertions avoid existing windows without moving them.
- Search jumps existing windows and creates new library windows correctly.
- Browser click and drag create adjacent/dropped canvas windows with defined duplicate behavior.
- Pan, cursor-centered zoom, Fit All, focus, breadcrumbs, semantic zoom, and undo/redo work.
- Pane DOM identity survives zoom and unrelated window operations; remounted virtual directories
  repopulate rows.
- Shared routes remain unchanged and cannot access canvas.
