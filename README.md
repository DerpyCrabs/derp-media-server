# Media Server

A modern Next.js-based media server with a beautiful web UI for browsing and playing your video and audio files.

## Features

- 🎵 **Audio Player** - Persistent audio player that stays active while browsing
- 🎬 **Video Player** - Minimizable video player with Picture-in-Picture support
- 📁 **File Browser** - Intuitive file explorer with breadcrumb navigation
- 🔄 **State Persistence** - URL-based state management (reload returns to same file/folder)
- 🎨 **Modern UI** - Built with shadcn/ui and Tailwind CSS
- 🚀 **React Server Components** - Direct file system access without API overhead
- 📱 **Responsive Design** - Works on desktop and mobile devices

## Supported Formats

**Video:** mp4, webm, ogg, mov, avi, mkv  
**Audio:** mp3, wav, ogg, m4a, flac, aac, opus

## Setup

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Configure media directory:**

   Set the `MEDIA_DIR` environment variable to point to your media folder:

   ```bash
   # Linux/Mac
   export MEDIA_DIR=/path/to/your/media

   # Windows (PowerShell)
   $env:MEDIA_DIR="C:\path\to\your\media"

   # Or create .env.local file:
   echo "MEDIA_DIR=/path/to/your/media" > .env.local
   ```

3. **Run the development server:**

   ```bash
   pnpm dev
   ```

4. **Open your browser:**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

### Navigation

- Click on folders to browse into them
- Use the breadcrumb navigation to go back up the folder tree
- Click on media files to play them

### Audio Player

- Appears at the bottom of the screen when playing audio
- Controls: Play/Pause, Skip forward/backward 10s, Volume, Seek bar
- Stays active while browsing folders

### Video Player

- Appears as an overlay when playing video
- Can be minimized to bottom-right corner
- Supports Picture-in-Picture mode
- Click X to close

### URL State

The application uses URL parameters to maintain state:

- `?dir=/path/to/folder` - Current directory
- `?playing=/path/to/file.mp3` - Currently playing file

This means:

- Refreshing the page returns to the same location
- You can bookmark specific folders or files
- Browser back/forward buttons work as expected

## Production

Build for production:

```bash
pnpm build
pnpm start
```

Make sure to set the `MEDIA_DIR` environment variable in your production environment.

## Security

- Path traversal protection prevents accessing files outside MEDIA_DIR
- Only configured media file types are served
- No authentication (intended for local/trusted network use)

## Technology Stack

- **Next.js 16** - React framework with App Router
- **React Server Components** - Direct server-side file system access
- **shadcn/ui** - Beautiful, accessible UI components
- **Tailwind CSS** - Utility-first styling
- **TypeScript** - Type-safe development
- **Lucide Icons** - Modern icon library

## License

MIT
