# Media Server

> **Warning:** This project is 90% vibe coded. Proceed with caution and manage expectations accordingly.

A modern Next.js-based media server with a web UI for browsing, playing, and managing your media files. Supports authentication, share links, knowledge bases, and real-time sync across clients.

## Features

- **Authentication** - Optional password auth with session cookies, rate limiting, and admin domain restrictions
- **Share Links** - Share files and folders via token-based links with optional passcodes, upload quotas, and granular permissions
- **Knowledge Base** - Designate folders as knowledge bases with search, recent files, and Obsidian-style markdown support
- **File Management** - Upload, move, copy, rename, and delete files and folders
- **Drag & Drop** - Drop files to upload; drag files between folders to move them
- **Audio Player** - Persistent player that stays active while browsing
- **Video Player** - Minimizable video player with Picture-in-Picture support
- **Image Viewer** - Full-screen viewer with zoom, rotate, and keyboard navigation
- **Markdown Rendering** - GFM support, Obsidian `![[image]]` syntax, and code highlighting
- **File Browser** - Grid view with thumbnails or list view, breadcrumb navigation with folder menus
- **Text Editing** - Edit text files in editable folders, create new files and folders inline
- **Live Sync** - Server-Sent Events keep all connected clients in sync automatically
- **Search** - Full-text search within knowledge base folders
- **Modern UI** - Built with Base UI and Tailwind CSS, responsive on desktop and mobile

## Supported Formats

**Video:** mp4, webm, ogg, mov, avi, mkv
**Audio:** mp3, wav, ogg, m4a, flac, aac, opus
**Images:** jpg, jpeg, png, gif, webp, bmp, svg, ico
**Text:** txt, md, json, xml, csv, log, yaml, yml, ini, conf, sh, bat, ps1, js, ts, jsx, tsx, css, scss, html, py, java, c, cpp, h, cs, go, rs, php, rb, swift, kt, sql

## Setup

### Prerequisites

- **Node.js** 18+
- **pnpm**
- **FFmpeg** (optional, for video thumbnails in grid view)

### Installation

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Configure the server by editing `config.jsonc`:

   ```jsonc
   {
     "mediaDir": "/path/to/your/media",
     "editableFolders": ["notes", "documents"],
     // Optional: password auth
     "auth": {
       "enabled": true,
       "password": "your-secret",
       "adminAccessDomains": ["127.0.0.1"],
     },
   }
   ```

   See [Configuration](#configuration) for all options.

3. Run the server:

   ```bash
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## Configuration

Configuration lives in `config.jsonc` at the project root (JSONC supports comments and trailing commas). Every option can be overridden via environment variables or `.env`.

### Options

| Config Key                | Env Variable                | Description                                                                               |
| ------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| `mediaDir`                | `MEDIA_DIR`                 | Root directory for media files                                                            |
| `editableFolders`         | `EDITABLE_FOLDERS`          | Folders (relative to `mediaDir`) where file management is allowed. Comma-separated in env |
| `shareLinkDomain`         | `SHARE_LINK_DOMAIN`         | Base URL for share links (e.g. `share.example.com`). Defaults to the request origin       |
| `auth.enabled`            | `AUTH_ENABLED`              | Enable password authentication (`true` / `1`)                                             |
| `auth.password`           | `AUTH_PASSWORD`             | Password for login                                                                        |
| `auth.adminAccessDomains` | `AUTH_ADMIN_ACCESS_DOMAINS` | Restrict admin access to specific hostnames. Comma-separated in env                       |

The config file path itself can be changed with `CONFIG_PATH` env var or `--config-path` CLI argument. Falls back to `config.json` if `config.jsonc` is not found.

## Authentication

When auth is enabled, all routes except share links require a valid session. Sessions are cookie-based and last 7 days.

- **Login** is rate-limited to 10 attempts per IP per 15 minutes
- **Admin access domains** restrict which hostnames can access the admin UI and API. This lets you expose share links on a public domain while keeping admin access on a trusted network (e.g. `["127.0.0.1", "192.168.1.100"]`). When the list is empty, all hostnames are allowed.
- Share links are always accessible regardless of auth settings

## Share Links

Share files or folders via token-based URLs. Right-click a file or folder and select "Share" to create a link.

- **Passcode protection** - When auth is enabled, shares are automatically assigned a 6-character passcode
- **Editable shares** - Optionally allow recipients to upload, edit, rename, move, and delete files
- **Granular permissions** - Toggle upload, edit, and delete independently on editable shares
- **Upload quota** - Set a maximum upload size per share (default 2 GB)
- **Multiple shares** - Create multiple share links for the same file or folder with different settings
- Share URLs can include the passcode as a query parameter for one-click access

## Knowledge Base

Designate any folder as a knowledge base via the right-click context menu. Knowledge base folders get:

- **Search** - Full-text search across `.md` and `.txt` files with highlighted snippets
- **Recent files** - Dashboard showing the 10 most recently modified notes
- **Obsidian compatibility** - `![[image.png]]` syntax resolves images from an `images/` subdirectory
- **Markdown-first** - New files default to `.md` extension in knowledge base folders
- Knowledge base features are also available through share links for shared KB folders

## File Management

In editable folders:

- **Upload** files and folders via the toolbar button or by dragging them into the file list
- **Move** files by dragging them onto folders, or via right-click "Move to" dialog
- **Copy** files via right-click "Copy to" dialog
- **Create** new files and folders inline
- **Edit** text files directly in the browser
- **Delete** files and folders via the context menu

All changes broadcast via SSE so every connected client updates in real time.

## Production

```bash
pnpm build
pnpm start
```

The production server listens on `0.0.0.0` by default.

## Security

- Path traversal protection prevents accessing files outside `mediaDir`
- File editing restricted to `editableFolders`
- Optional password auth with scrypt hashing and timing-safe comparison
- Rate-limited login
- Admin domain restrictions for separating public share access from admin access
- Share links use independent passcode-based sessions

## Technology Stack

- **Next.js 16** - React framework with App Router
- **React 19** - Server and client components
- **Base UI** - Accessible UI primitives
- **Tailwind CSS** - Utility-first styling
- **TanStack Query** - Data fetching and cache invalidation
- **Zustand** - Client state management
- **TypeScript** - Type-safe development
- **oxlint** - Linting

## License

MIT
