import { MediaType } from '@/lib/types'
import { getIconComponent } from '@/lib/icon-utils'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import {
  Folder,
  Music,
  Video,
  Image as ImageIcon,
  FileQuestion,
  FileText,
  Star,
  Eye,
  Play,
  Pause,
  Book,
} from 'lucide-react'

interface UseFileIconProps {
  customIcons: Record<string, string>
  playingPath: string | null
  currentFile: string | null
  mediaPlayerIsPlaying: boolean
  mediaType: 'audio' | 'video' | null
}

export function useFileIcon({
  customIcons,
  playingPath,
  currentFile,
  mediaPlayerIsPlaying,
  mediaType,
}: UseFileIconProps) {
  const getIcon = (
    type: MediaType,
    filePath: string,
    isAudioFile: boolean = false,
    isVideoFile: boolean = false,
    isVirtual: boolean = false,
  ) => {
    // Determine color based on type
    const getColorClass = (mediaType: MediaType) => {
      switch (mediaType) {
        case MediaType.FOLDER:
          return 'text-blue-500'
        case MediaType.AUDIO:
          return 'text-purple-500'
        case MediaType.VIDEO:
          return 'text-red-500'
        case MediaType.IMAGE:
          return 'text-green-500'
        case MediaType.TEXT:
          return 'text-cyan-500'
        case MediaType.PDF:
          return 'text-orange-500'
        case MediaType.OTHER:
          return 'text-yellow-500'
        default:
          return 'text-yellow-500'
      }
    }

    // Check for virtual folder (Most Played)
    if (isVirtual && filePath === VIRTUAL_FOLDERS.MOST_PLAYED) {
      // Check for custom icon first
      const customIconName = customIcons[filePath]
      if (customIconName) {
        const CustomIcon = getIconComponent(customIconName)
        if (CustomIcon) {
          return <CustomIcon className='h-5 w-5 text-blue-500' />
        }
      }
      // Default icon for Most Played
      return <Eye className='h-5 w-5 text-blue-500' />
    }

    // Check for virtual folder (Favorites)
    if (isVirtual && filePath === VIRTUAL_FOLDERS.FAVORITES) {
      // Check for custom icon first
      const customIconName = customIcons[filePath]
      if (customIconName) {
        const CustomIcon = getIconComponent(customIconName)
        if (CustomIcon) {
          return <CustomIcon className='h-5 w-5 text-blue-500' />
        }
      }
      // Default icon for Favorites
      return <Star className='h-5 w-5 text-blue-500' />
    }

    // Check for custom icon first
    const customIconName = customIcons[filePath]
    if (customIconName) {
      const CustomIcon = getIconComponent(customIconName)
      if (CustomIcon) {
        return <CustomIcon className={`h-5 w-5 ${getColorClass(type)}`} />
      }
    }

    // Show play/pause icon only if this file is actually loaded in the media player
    // Check both the URL parameter AND the media player store to avoid flickering
    const isCurrentFile = playingPath === filePath && currentFile === filePath

    if (isCurrentFile && (isAudioFile || isVideoFile)) {
      const isActuallyPlaying =
        mediaPlayerIsPlaying &&
        ((isAudioFile && mediaType === 'audio') || (isVideoFile && mediaType === 'video'))

      if (isActuallyPlaying) {
        return <Play className='h-5 w-5 text-primary' />
      } else {
        return <Pause className='h-5 w-5 text-primary' />
      }
    }

    switch (type) {
      case MediaType.FOLDER:
        return <Folder className='h-5 w-5 text-blue-500' />
      case MediaType.AUDIO:
        return <Music className='h-5 w-5 text-purple-500' />
      case MediaType.VIDEO:
        return <Video className='h-5 w-5 text-red-500' />
      case MediaType.IMAGE:
        return <ImageIcon className='h-5 w-5 text-green-500' />
      case MediaType.TEXT:
        return <FileText className='h-5 w-5 text-cyan-500' />
      case MediaType.PDF:
        return <Book className='h-5 w-5 text-emerald-500' />
      case MediaType.OTHER:
        return <FileQuestion className='h-5 w-5 text-yellow-500' />
      default:
        return <FileQuestion className='h-5 w-5 text-yellow-500' />
    }
  }

  return { getIcon }
}
