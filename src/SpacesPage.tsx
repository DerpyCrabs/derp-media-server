import AppWindow from 'lucide-solid/icons/app-window'
import Map from 'lucide-solid/icons/map'

export function SpacesPage() {
  return (
    <main class='mx-auto w-full max-w-5xl p-4 pb-24 md:p-8' data-testid='spaces-page'>
      <div class='mb-6'>
        <p class='text-muted-foreground text-sm font-medium'>Spaces</p>
        <h1 class='text-3xl font-semibold tracking-tight'>Choose a working surface</h1>
        <p class='text-muted-foreground mt-2 max-w-2xl text-sm'>
          Open existing Workspace or Canvas. Saved state and legacy URLs stay unchanged.
        </p>
      </div>
      <div class='grid gap-4 sm:grid-cols-2'>
        <a
          href='/workspace'
          class='bg-card hover:bg-muted/50 flex min-h-32 items-start gap-4 rounded-xl border border-border p-5 transition-colors'
        >
          <AppWindow class='text-primary size-7 shrink-0' aria-hidden='true' />
          <span>
            <span class='block text-lg font-semibold'>Workspace</span>
            <span class='text-muted-foreground mt-1 block text-sm'>
              Windows, tabs, layouts, files, and Hermes sessions.
            </span>
          </span>
        </a>
        <a
          href='/canvas'
          class='bg-card hover:bg-muted/50 flex min-h-32 items-start gap-4 rounded-xl border border-border p-5 transition-colors'
        >
          <Map class='text-primary size-7 shrink-0' aria-hidden='true' />
          <span>
            <span class='block text-lg font-semibold'>Canvas</span>
            <span class='text-muted-foreground mt-1 block text-sm'>
              Spatial boards with existing saved canvases and media windows.
            </span>
          </span>
        </a>
      </div>
    </main>
  )
}
