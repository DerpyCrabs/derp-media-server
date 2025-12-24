'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconPicker } from '@/components/icon-picker'
import { getIconComponent } from '@/lib/icon-utils'

interface IconEditorDialogProps {
  isOpen: boolean
  onClose: () => void
  fileName: string
  currentIcon: string | null
  onSave: (iconName: string | null) => void
}

export function IconEditorDialog({
  isOpen,
  onClose,
  fileName,
  currentIcon,
  onSave,
}: IconEditorDialogProps) {
  const [selectedIcon, setSelectedIcon] = useState<string | null>(currentIcon)

  // Update selected icon when currentIcon changes
  useEffect(() => {
    setSelectedIcon(currentIcon)
  }, [currentIcon])

  const handleSave = () => {
    onSave(selectedIcon)
    onClose()
  }

  const handleRemove = () => {
    setSelectedIcon(null)
    onSave(null)
    onClose()
  }

  // Memoize the icon component to avoid recreating during render
  const SelectedIconComponent = useMemo(
    () => (selectedIcon ? getIconComponent(selectedIcon) : null),
    [selectedIcon],
  )

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className='max-w-2xl max-h-[90vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Set Custom Icon</DialogTitle>
          <DialogDescription>
            Choose an icon for <span className='font-semibold'>{fileName}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Preview */}
        <div className='flex items-center gap-3 p-4 rounded-lg bg-muted/30 border'>
          <div className='flex items-center justify-center w-12 h-12 rounded-lg bg-background border'>
            {SelectedIconComponent ? (
              <SelectedIconComponent className='h-6 w-6 text-primary' />
            ) : (
              <span className='text-xs text-muted-foreground'>None</span>
            )}
          </div>
          <div className='flex-1'>
            <p className='text-sm font-medium'>{fileName}</p>
            <p className='text-xs text-muted-foreground'>
              {selectedIcon ? `Icon: ${selectedIcon}` : 'No custom icon'}
            </p>
          </div>
        </div>

        {/* Icon picker */}
        <IconPicker
          selectedIcon={selectedIcon}
          onSelect={setSelectedIcon}
          onRemove={handleRemove}
        />

        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={selectedIcon === currentIcon}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
