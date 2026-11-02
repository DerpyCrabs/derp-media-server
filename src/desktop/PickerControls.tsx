import { Input } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { Select } from '@/lib/ui/select'
import { Checkbox } from '@/lib/ui/checkbox'
import { view, list, observe } from 'effectweb'
import type { PickerRequest } from './bridge'
import type { Picker } from './picker-controller'

export const PickerControls = view<{ request: PickerRequest; picker: Picker; cancel: () => void }>(
  (props) =>
    observe(props.picker.source, (state) => {
      const request = props.request
      const saving = request.mode === 'SaveFile'
      const canAccept = saving
        ? !!state.name.trim()
        : request.directory || request.mode === 'SaveFiles' || state.selected.length > 0
      return (
        <form
          class='shrink-0 space-y-3 border-t border-border bg-background p-3'
          aria-label='File picker'
          onSubmit={(event) => {
            event.preventDefault()
            props.picker.accept()
          }}
        >
          {saving ? (
            <label class='flex items-center gap-3 text-sm'>
              <span>Name</span>
              <Input
                aria-label='File name'
                class='min-w-0 flex-1'
                value={state.name}
                onInput={(event) => props.picker.setName(event.currentTarget.value)}
              />
            </label>
          ) : null}
          {request.choices.length ? (
            <div class='flex flex-wrap items-center gap-3'>
              {list(
                request.choices,
                (choice) => choice.id,
                (choice) =>
                  choice.options.length ? (
                    <label class='flex min-w-0 items-center gap-2 text-sm'>
                      <span>{choice.label}</span>
                      <Select
                        aria-label={choice.label}
                        value={state.choices[choice.id] ?? ''}
                        options={choice.options.map((option) => ({
                          value: option.id,
                          label: option.label,
                        }))}
                        onValueChange={(value) => props.picker.setChoice(choice.id, value)}
                      />
                    </label>
                  ) : (
                    <label class='flex items-center gap-2 text-sm'>
                      <Checkbox
                        checked={state.choices[choice.id] === 'true'}
                        onCheckedChange={(checked) =>
                          props.picker.setChoice(choice.id, String(checked))
                        }
                      />
                      {choice.label}
                    </label>
                  ),
              )}
            </div>
          ) : null}
          <div class='flex flex-wrap items-center justify-end gap-2'>
            {request.filters.length > 1 ? (
              <div class='mr-auto flex w-full min-w-0 sm:w-64'>
                <Select
                  aria-label='File type'
                  value={String(state.filter)}
                  options={request.filters.map((item, index) => ({
                    value: String(index),
                    label: item.name,
                  }))}
                  onValueChange={(value) => props.picker.setFilter(Number(value))}
                />
              </div>
            ) : (
              <span class='mr-auto truncate text-sm text-muted-foreground'>
                {request.filters[0]?.name}
              </span>
            )}
            <Button variant='outline' type='button' onClick={props.cancel}>
              Cancel
            </Button>
            <Button type='submit' disabled={state.pending || !canAccept}>
              {request.acceptLabel ||
                (saving ? 'Save' : request.directory ? 'Select folder' : 'Open')}
            </Button>
          </div>
          {state.error ? (
            <p role='alert' class='text-sm text-destructive'>
              {state.error}
            </p>
          ) : null}
        </form>
      )
    }),
)
