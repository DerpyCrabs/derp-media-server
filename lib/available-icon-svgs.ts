import AlertCircle from 'lucide-static/icons/alert-circle.svg?raw'
import Archive from 'lucide-static/icons/archive.svg?raw'
import Bell from 'lucide-static/icons/bell.svg?raw'
import Bookmark from 'lucide-static/icons/bookmark.svg?raw'
import Book from 'lucide-static/icons/book.svg?raw'
import CheckCircle from 'lucide-static/icons/check-circle.svg?raw'
import Code from 'lucide-static/icons/code.svg?raw'
import Crown from 'lucide-static/icons/crown.svg?raw'
import Download from 'lucide-static/icons/download.svg?raw'
import FileText from 'lucide-static/icons/file-text.svg?raw'
import Film from 'lucide-static/icons/film.svg?raw'
import Flag from 'lucide-static/icons/flag.svg?raw'
import FolderHeart from 'lucide-static/icons/folder-heart.svg?raw'
import Folder from 'lucide-static/icons/folder.svg?raw'
import Heart from 'lucide-static/icons/heart.svg?raw'
import Image from 'lucide-static/icons/image.svg?raw'
import Info from 'lucide-static/icons/info.svg?raw'
import KeyRound from 'lucide-static/icons/key-round.svg?raw'
import KeySquare from 'lucide-static/icons/key-square.svg?raw'
import Music from 'lucide-static/icons/music.svg?raw'
import Package from 'lucide-static/icons/package.svg?raw'
import Pin from 'lucide-static/icons/pin.svg?raw'
import Sparkles from 'lucide-static/icons/sparkles.svg?raw'
import Star from 'lucide-static/icons/star.svg?raw'
import Upload from 'lucide-static/icons/upload.svg?raw'
import Zap from 'lucide-static/icons/zap.svg?raw'

const AVAILABLE_ICON_SVGS: Record<string, string> = {
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

export function getAvailableIconSvg(iconName: string): string | null {
  return AVAILABLE_ICON_SVGS[iconName] ?? null
}
