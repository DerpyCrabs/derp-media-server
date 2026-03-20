import type { Component } from 'solid-js'
import AlertCircle from 'lucide-solid/icons/alert-circle'
import Archive from 'lucide-solid/icons/archive'
import Bell from 'lucide-solid/icons/bell'
import Bookmark from 'lucide-solid/icons/bookmark'
import Book from 'lucide-solid/icons/book'
import CheckCircle from 'lucide-solid/icons/check-circle'
import Code from 'lucide-solid/icons/code'
import Crown from 'lucide-solid/icons/crown'
import Download from 'lucide-solid/icons/download'
import FileText from 'lucide-solid/icons/file-text'
import Film from 'lucide-solid/icons/film'
import Flag from 'lucide-solid/icons/flag'
import FolderHeart from 'lucide-solid/icons/folder-heart'
import Folder from 'lucide-solid/icons/folder'
import Heart from 'lucide-solid/icons/heart'
import Image from 'lucide-solid/icons/image'
import Info from 'lucide-solid/icons/info'
import KeyRound from 'lucide-solid/icons/key-round'
import KeySquare from 'lucide-solid/icons/key-square'
import Music from 'lucide-solid/icons/music'
import Package from 'lucide-solid/icons/package'
import Pin from 'lucide-solid/icons/pin'
import Sparkles from 'lucide-solid/icons/sparkles'
import Star from 'lucide-solid/icons/star'
import Upload from 'lucide-solid/icons/upload'
import Zap from 'lucide-solid/icons/zap'

export type SolidIconEntry = { name: string; Icon: Component<{ class?: string; size?: number }> }

/** Same icon names as `lib/icon-utils` AVAILABLE_ICONS (server stores these strings). */
export const SOLID_AVAILABLE_ICONS: SolidIconEntry[] = [
  { name: 'Heart', Icon: Heart },
  { name: 'Star', Icon: Star },
  { name: 'Bookmark', Icon: Bookmark },
  { name: 'Folder', Icon: Folder },
  { name: 'FolderHeart', Icon: FolderHeart },
  { name: 'Music', Icon: Music },
  { name: 'Film', Icon: Film },
  { name: 'Image', Icon: Image },
  { name: 'FileText', Icon: FileText },
  { name: 'Book', Icon: Book },
  { name: 'Code', Icon: Code },
  { name: 'Package', Icon: Package },
  { name: 'Download', Icon: Download },
  { name: 'Upload', Icon: Upload },
  { name: 'Archive', Icon: Archive },
  { name: 'Pin', Icon: Pin },
  { name: 'Flag', Icon: Flag },
  { name: 'Bell', Icon: Bell },
  { name: 'AlertCircle', Icon: AlertCircle },
  { name: 'CheckCircle', Icon: CheckCircle },
  { name: 'Info', Icon: Info },
  { name: 'Sparkles', Icon: Sparkles },
  { name: 'Zap', Icon: Zap },
  { name: 'Crown', Icon: Crown },
  { name: 'KeySquare', Icon: KeySquare },
  { name: 'KeyRound', Icon: KeyRound },
]

export function getSolidIconComponent(
  iconName: string,
): Component<{ class?: string; size?: number }> | null {
  const entry = SOLID_AVAILABLE_ICONS.find((i) => i.name === iconName)
  return entry?.Icon ?? null
}
