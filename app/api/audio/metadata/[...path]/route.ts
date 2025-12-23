import { NextRequest, NextResponse } from 'next/server'
import { parseFile } from 'music-metadata'
import { getFilePath } from '@/lib/file-system'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const resolvedParams = await params
    const filePath = resolvedParams.path.join('/')

    if (!filePath) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    // Get the full file path
    const fullPath = getFilePath(filePath)

    // Parse audio metadata
    const metadata = await parseFile(fullPath)

    // Extract cover art if available
    let coverArt: string | null = null
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const picture = metadata.common.picture[0]
      // Convert buffer to base64 data URL
      const base64 = Buffer.from(picture.data).toString('base64')
      coverArt = `data:${picture.format};base64,${base64}`
    }

    // Return the metadata
    return NextResponse.json({
      title: metadata.common.title || null,
      artist: metadata.common.artist || null,
      album: metadata.common.album || null,
      year: metadata.common.year || null,
      genre: metadata.common.genre || null,
      duration: metadata.format.duration || null,
      coverArt,
      trackNumber: metadata.common.track?.no || null,
      albumArtist: metadata.common.albumartist || null,
    })
  } catch (error) {
    console.error('Error reading audio metadata:', error)
    return NextResponse.json({ error: 'Failed to read audio metadata' }, { status: 500 })
  }
}
