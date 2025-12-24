import {
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
  type LucideIcon,
} from 'lucide-react'
import { MediaType } from './types'

// Curated list of ~24 useful icons
export const AVAILABLE_ICONS = [
  { name: 'Heart', component: Heart },
  { name: 'Star', component: Star },
  { name: 'Bookmark', component: Bookmark },
  { name: 'Folder', component: Folder },
  { name: 'FolderHeart', component: FolderHeart },
  { name: 'Music', component: Music },
  { name: 'Film', component: Film },
  { name: 'Image', component: Image },
  { name: 'FileText', component: FileText },
  { name: 'Book', component: Book },
  { name: 'Code', component: Code },
  { name: 'Package', component: Package },
  { name: 'Download', component: Download },
  { name: 'Upload', component: Upload },
  { name: 'Archive', component: Archive },
  { name: 'Pin', component: Pin },
  { name: 'Flag', component: Flag },
  { name: 'Bell', component: Bell },
  { name: 'AlertCircle', component: AlertCircle },
  { name: 'CheckCircle', component: CheckCircle },
  { name: 'Info', component: Info },
  { name: 'Sparkles', component: Sparkles },
  { name: 'Zap', component: Zap },
  { name: 'Crown', component: Crown },
  { name: 'KeySquare', component: KeySquare },
  { name: 'KeyRound', component: KeyRound },
] as const

// Get icon component by name
export function getIconComponent(iconName: string): LucideIcon | null {
  const icon = AVAILABLE_ICONS.find((icon) => icon.name === iconName)
  return icon ? icon.component : null
}

// Get icon for a given path, checking custom icons first, then falling back to type-based defaults
export function getIconForPath(
  path: string,
  defaultType: MediaType,
  customIcons: Record<string, string>,
): LucideIcon | null {
  // Check if there's a custom icon set for this path
  const customIconName = customIcons[path]
  if (customIconName) {
    return getIconComponent(customIconName)
  }

  // No custom icon, return null to use default type-based icon
  return null
}
