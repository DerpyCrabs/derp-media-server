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
- Canvas windows, frames, camera, geometry, and history are isolated from workspace state.
- Canvas state is versioned and stored only in browser `localStorage`.

## World and camera

- Canvas is an unbounded two-dimensional world with stable world coordinates.
- Middle-button drag pans. `Ctrl+wheel` zooms around cursor. Zoom is capped at 100%, so
  workspace windows never render larger than their native size.
- Top bar contains breadcrumb, unified search, undo/redo, Fit All, zoom out, zoom percentage/reset, zoom in, and reset under overflow actions.
- `Ctrl+P` opens unified search and overrides browser Print only on `/canvas`.
- Search jumps, Fit All, breadcrumb navigation, and focus transitions animate unless reduced motion is requested.
- Desktop with mouse is supported. Touch/mobile/trackpad-specific interaction is outside first implementation.

## Semantic zoom

- Far zoom renders frame title, color, window count, and lightweight window summaries.
- Mid zoom renders window summaries over preserved live panes.
- Near zoom reveals live interactive components. Zoom never remounts window panes.
- A thumbnail click selects it. Double-click focuses it at readable scale.
- No designated frame overview window exists.

## Grid and placement

- Window/frame position and size are quantized to a fixed world grid.
- Adaptive dot grid is subtle at working zoom and hidden far out. It is temporarily suppressed during
  middle-button pan so camera movement remains compositor-only.
- Move/resize snaps to shared grid coordinates without alignment guide lines.
- New items begin near requested world point, then search nearby grid cells for a non-overlapping position.
- Existing windows never move to make space for a new item.

## Frames

- Frames are named, colored, top-level project containers with stable IDs.
- Frame position and size are manual. Frame contents are never clipped.
- Frames have no focus/selection state. Resize hit areas are always available; header drag moves them.
- Top-level frames cannot overlap. Invalid move/resize previews are rejected and return to last valid bounds.
- Child window bounds are relative to parent frame. Moving a frame moves current children.
- After frame move/resize, fully enclosed top-level windows are captured without changing world position.
- Directly dragged window ownership is determined by whether window center is inside frame on drop.
- Frame resizing or direct window dragging releases children whose centers leave frame.
- Deleting a frame releases children at unchanged world positions. Files and windows remain.
- Frame menu: Focus, Rename, Change color, Resize to contents, Delete.
- Data model must leave a clean seam for true child canvases later; nested canvases are not implemented now.

## Windows

- Browser and viewer content components are reused with canvas-native chrome.
- Windows can overlap. Clicking brings window to front.
- Chrome includes icon/title drag handle, close button, and edge/corner resize.
- Last resized size is remembered locally per window type (browser or viewer) and becomes
  default size for new windows of that type, including drag previews.
- Window menu: Focus, Open another copy, Move to frame, Close.
- No taskbar, minimize, fullscreen state, tab groups, multi-selection, lasso, or bare Delete shortcut.
- Camera focus replaces maximize/fullscreen.
- Closing removes canvas instance only and never deletes underlying content.

## Creation, opening, and drag

- Empty-canvas menu: New frame, Search library, Open file browser, Fit All, Reset View.
- Right-click world position is insertion anchor. Top-bar actions use viewport center.
- File opened from canvas browser appears beside browser, inherits its frame, and uses nearest free grid position.
- Opening or searching an already-open file jumps to existing window.
- Explicit `Open another copy` creates a duplicate.
- Dragging a file/folder row from canvas browser previews exact collision-resolved window position
  and size with cursor as requested window center, then creates viewer/browser at those bounds.
  Preview begins only after cursor reaches canvas space outside existing windows. Dragged items
  intentionally permit duplicates.
- Operating-system file drops are unsupported.
- Notes are created through file browser. Canvas-native scratch notes are deferred.

## Unified search

Results are grouped in this order:

1. Open canvas windows: jump to window.
2. Frames: fit frame.
3. Indexed library results: create browser/viewer using placement rules.

Existing indexed library search APIs remain source of file results. Sections are visually distinct.

## Context menus

- Canvas menus own empty canvas, frame background/header, and window chrome.
- Right-click inside editor/browser/media content stays owned by content component or native browser behavior.

## Persistence and recovery

- Persist window definitions/paths, browser folders, bounds, z-order, parent frames, frame metadata, and camera.
- Do not persist focus, menus, editor selection, scroll offsets, media playback position, or undo stack.
- Missing paths retain geometry and display unavailable state with Retry, Search replacement, and Remove actions where component/API detection permits.
- Canvas undo/redo covers create, close, move, resize, reparent, and frame deletion.
- `Ctrl+Z/Y` controls canvas only while canvas background/chrome owns focus; focused editors retain their own undo stack.
- Undo history may reset on reload.

## Performance

No hard canvas item limits. Semantic zoom changes representation for usability without unmounting panes.
Middle-button pan updates one compositor transform per animation frame and commits camera state once on
release. Large directory listings retain their existing row virtualization and remeasure after remount.

## Acceptance checks

- `/canvas` loads blank without creating/changing normal workspace state.
- Reload restores local canvas map and camera.
- Frames reject overlap, carry children, capture enclosed windows, and release excluded windows.
- Move/resize quantize to grid; insertions avoid existing windows without moving them.
- Search jumps existing windows/frames and creates new library windows correctly.
- Browser click and drag create adjacent/dropped canvas windows with defined duplicate behavior.
- Pan, cursor-centered zoom, Fit All, focus, breadcrumbs, semantic zoom, and undo/redo work.
- Pane DOM identity survives zoom and unrelated window operations; remounted virtual directories
  repopulate rows.
- Shared routes remain unchanged and cannot access canvas.
