import type { View } from 'effectweb'
import * as AlertCircle from '@effectweb/lucide/icons/alert-circle'
import * as Archive from '@effectweb/lucide/icons/archive'
import * as Bell from '@effectweb/lucide/icons/bell'
import * as Bookmark from '@effectweb/lucide/icons/bookmark'
import * as Book from '@effectweb/lucide/icons/book'
import * as CheckCircle from '@effectweb/lucide/icons/check-circle'
import * as Code from '@effectweb/lucide/icons/code'
import * as Crown from '@effectweb/lucide/icons/crown'
import * as Download from '@effectweb/lucide/icons/download'
import * as FileText from '@effectweb/lucide/icons/file-text'
import * as Film from '@effectweb/lucide/icons/film'
import * as Flag from '@effectweb/lucide/icons/flag'
import * as FolderHeart from '@effectweb/lucide/icons/folder-heart'
import * as Folder from '@effectweb/lucide/icons/folder'
import * as Heart from '@effectweb/lucide/icons/heart'
import * as Image from '@effectweb/lucide/icons/image'
import * as Info from '@effectweb/lucide/icons/info'
import * as KeyRound from '@effectweb/lucide/icons/key-round'
import * as KeySquare from '@effectweb/lucide/icons/key-square'
import * as Music from '@effectweb/lucide/icons/music'
import * as Package from '@effectweb/lucide/icons/package'
import * as Pin from '@effectweb/lucide/icons/pin'
import * as Sparkles from '@effectweb/lucide/icons/sparkles'
import * as Star from '@effectweb/lucide/icons/star'
import * as Upload from '@effectweb/lucide/icons/upload'
import * as Zap from '@effectweb/lucide/icons/zap'

type IconProps = {
  class?: string
  size?: number
  style?: { color?: string }
  'stroke-width'?: string | number
}

type IconEntry = { name: string; Icon: View<IconProps, never> }

/** Curated names persisted server-side for custom folder icons. */
const icons = {
  Heart,
  Star,
  Bookmark,
  Folder,
  FolderHeart,
  Music,
  Film,
  Image,
  FileText,
  Book,
  Code,
  Package,
  Download,
  Upload,
  Archive,
  Pin,
  Flag,
  Bell,
  AlertCircle,
  CheckCircle,
  Info,
  Sparkles,
  Zap,
  Crown,
  KeySquare,
  KeyRound,
}

export const AVAILABLE_ICONS: IconEntry[] = Object.entries(icons).map(([name, icon]) => ({
  name,
  Icon: icon.default,
}))

export function getIconGeometry(iconName: string) {
  return Object.hasOwn(icons, iconName) ? icons[iconName as keyof typeof icons] : null
}

export function getIconComponent(iconName: string): View<IconProps, never> | null {
  return getIconGeometry(iconName)?.default ?? null
}
