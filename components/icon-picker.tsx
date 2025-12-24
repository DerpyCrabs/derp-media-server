'use client'

import { AVAILABLE_ICONS } from '@/lib/icon-utils'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

interface IconPickerProps {
  selectedIcon: string | null
  onSelect: (iconName: string) => void
  onRemove: () => void
}

export function IconPicker({ selectedIcon, onSelect, onRemove }: IconPickerProps) {
  return (
    <div className='flex flex-col gap-4'>
      {/* Remove button */}
      <Button variant='outline' onClick={onRemove} className='w-full'>
        <X className='h-4 w-4 mr-2' />
        Remove Custom Icon
      </Button>

      {/* Icon grid */}
      <div className='grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2'>
        {AVAILABLE_ICONS.map(({ name, component: IconComponent }) => (
          <button
            key={name}
            onClick={() => onSelect(name)}
            className={`flex items-center justify-center p-3 rounded-lg border-2 transition-all hover:bg-muted/50 ${
              selectedIcon === name
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/50'
            }`}
            title={name}
          >
            <IconComponent className='h-6 w-6' />
          </button>
        ))}
      </div>
    </div>
  )
}
