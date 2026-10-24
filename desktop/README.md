# Desktop client (Linux / Hyprland)

The standalone Qt 6 WebEngine application uses native Wayland windows and Qt clipboard/drag-and-drop. It does not depend on Quickshell. Build dependencies on Arch: `qt6-webengine qt6-webchannel kwindowsystem cmake ninja gcc`.

The desktop client uses the existing local server, browser, viewers, readers and saved reader progress. Every browser, image/video viewer, text editor and reader uses the existing workspace presentation, edge to edge. It has no workspace membership or persisted window layout. Start an updated server built from this repository before opening files. The client does not start or package the server.

## Run from source

```
bun install
bun run build
# Start the production server separately, using your existing configuration.
bun run desktop
bun run desktop --tray
bun run desktop -- /absolute/path/to/library/book.pdf
```

`bun run desktop` builds the Qt shell with CMake; it does not rebuild or start the server. `bun run dev` also serves the desktop page. Every CLI file/directory argument opens a new native window, including repeated paths. Relative paths and local `file://` URIs are accepted. Use `--` before filenames starting with a dash. No arguments opens the library; `--tray` starts without a visible window. The tray's New browser window action always opens a new window. Close closes a window; Ctrl+Shift+T or the tray’s Reopen closed window action reopens it. Quit flushes documents and exits the resident process.

## Configuration

On first start, the app creates `$XDG_CONFIG_HOME/derp-media-server/desktop.json` (normally `~/.config/derp-media-server/desktop.json`):

```json
{ "port": 3000 }
```

Restart the tray process after changing the port. The connection is always to `127.0.0.1`. The server and client must share the same filesystem namespace; remote servers and container path mappings are not supported. Media roots and write permissions come from the server, so they do not need duplicating in desktop configuration. Browser data lives under `$XDG_STATE_HOME/derp-media-server/qt-desktop` (normally `~/.local/state/derp-media-server/qt-desktop`).

## Arch package

```
bun run package:arch
cd dist/arch
makepkg -si
```

The generated PKGBUILD uses a checksummed snapshot of the current desktop sources, including uncommitted changes. It builds with CMake and uses the system Qt libraries. It installs `derp-media-client`, its desktop entry and icon, a user service, and the FileChooser portal backend. It does not change your defaults or enable autostart automatically.

```
derp-media-client ~/Media
derp-media-client -- ~/Media/book.pdf ~/Media/movie.mkv
systemctl --user enable --now derp-media-client.service
```

Quit a manually started tray process before starting the service, so systemd owns the resident process. For a systemd-managed graphical session (including UWSM), the service follows `graphical-session.target`. For a standalone Hyprland session that does not start that target, add this to your Lua configuration instead:

```lua
hl.on("hyprland.start", function ()
  hl.exec_cmd("systemctl --user import-environment WAYLAND_DISPLAY DISPLAY XDG_CURRENT_DESKTOP && systemctl --user start derp-media-client.service")
end)
```

On older Hyprland configurations, use the same command with `exec-once =`.

A panel with a system tray, such as Waybar's tray module, shows the tray icon. The CLI works without a visible tray. Use `systemctl --user stop derp-media-client` to stop the service. The app intentionally stays resident after its last window closes, retaining one empty preloaded window for fast opening.

The application appears in Nautilus's Open With list for supported types. You can select it as default there or explicitly use:

```
xdg-mime default derp-media-client.desktop application/pdf
xdg-mime default derp-media-client.desktop inode/directory
```

A default applies to that MIME type everywhere. Paths outside the configured media roots are rejected with an explanation; they are not forwarded to another app.

## File exchange

- Right-click a file/folder and choose Copy, then paste in Nautilus. Ctrl+C also copies a focused file row. Existing Copy to… and Move to… operations remain available.
- Copy in Nautilus, then use Paste files or Ctrl+V in an editable folder. A Nautilus cut payload performs a move; originals are removed only after successful placement. Conflicts and cancellation are available in Files → Operations.
- Drag files/folders out to other applications, or into an editable folder to copy them. Native desktop drags are copies; Move to… performs internal moves.
- Dropping files onto a viewer opens each in a new window if it belongs to the library. Import outside files through a browser folder first.
- Existing names are not overwritten. Imports stop on the first error; files already copied remain. Empty directories are preserved. Symbolic links and special files are not imported.

PDF/book progress, existing settings, video controls, text editing, and server write restrictions are shared with the web app. No music-player window or audio file association is added.

## Validation

`bun run lint` checks frontend and desktop types. `bun run test:batch` runs the web/API regression suite. `bun run test:desktop` exercises actual Qt windows and Wayland portal dialogs, native clipboard formats, imports and reader progress using an isolated server and configuration; run it in a Hyprland session; it opens test windows and uses the clipboard. Direct Nautilus drag-and-drop still requires a manual interoperability check.

## File picker

The same resident process provides `org.freedesktop.impl.portal.FileChooser`. Picker windows extend the shared workspace browser with single/multiple file or folder selection, save names, filters, choices, and overwrite confirmation. Double-click opens a folder; Ctrl/Shift select multiple items. Save destinations must be editable media folders. The portal returns local file URIs to the requesting app.

To use it for portal requests, set this entry in `~/.config/xdg-desktop-portal/hyprland-portals.conf`, preserving your other preferences:

```ini
[preferred]
org.freedesktop.impl.portal.FileChooser=derp
```

Restart `xdg-desktop-portal.service` after changing the preference. Applications must use the FileChooser portal to reach this picker. Requests supplying a Wayland parent token are attached to that window through XDG Foreign. Window placement for requests without a parent is compositor-controlled.

### File tools and recovery

The Files button adds Ctrl/Cmd-click and Shift-click selection, Ctrl/Cmd+A, bulk copy/move/delete, copy/cut/paste, properties (including Unix permission bits), and an editable location dialog (Ctrl/Cmd+L). Ordinary clicks still open media. Hidden files are opt-in; internal operation staging files remain hidden. Operations show progress, cancellation, partial failures, and replace/skip/keep-both conflict choices with an apply-to-remaining option. Deletion is explicitly permanent.

Browse ZIP opens an archive without extracting it. Select entries to extract, or extract all; Create ZIP archives the selection. Archive paths and symbolic links are validated before extraction. ZIP is the supported archive format.

The native client adds Home, Downloads, Documents, and mounted devices that are inside configured media roots, Open terminal here (`xdg-terminal-exec`), and installed Open with applications (`gio`). These capabilities are not exposed in ordinary browsers. All destination writes still require the server’s `editableFolders` or configured filesystem write access. This does not grant access outside media roots.

External clipboard imports use cancellable staging and the same server conflict queue. Cut originals are removed only after successful placement and a check that the source did not change. Skipped, cancelled, or partially failed external moves retain originals and report this in Operations. Already completed destinations remain on cancellation. If the server disconnects during final placement, originals and staging are retained for inspection. Operations survive closing their browser window; Quit cancels native imports. Server operations remain available until the server restarts.

A connection panel offers retry while the server is unavailable. Existing windows retain their live editor state when reconnecting. To offer a Start server button, set `"serverService": "your-server.service"` in `~/.config/derp-media-server/desktop.json`; it starts that user systemd unit. This option does not install or configure a server service.

Native session restoration is off by default. Enable Restore windows on startup in the tray menu, or set `"restoreSession": true` in `desktop.json`. A normal launch then restores document/folder windows and geometry; explicit CLI paths and `--tray` retain their existing behavior. Session state is stored under `$XDG_STATE_HOME/derp-media-server/desktop-session.json` (default `~/.local/state`). This restores saved locations, not crash recovery for unsaved drafts.
