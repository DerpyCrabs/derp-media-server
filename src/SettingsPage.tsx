import FolderCog from 'lucide-solid/icons/folder-cog'
import { createSignal } from 'solid-js'
import { MountsDialog } from './MountsDialog'
import { ThemeSwitcherMenuContent } from './ThemeSwitcherMenuContent'

export function SettingsPage() {
  const [mountsOpen, setMountsOpen] = createSignal(false)
  return (
    <main class='mx-auto w-full max-w-3xl p-4 pb-24 md:p-8' data-testid='settings-page'>
      <h1 class='text-3xl font-semibold tracking-tight'>Settings</h1>
      <div class='mt-6 grid gap-4 sm:grid-cols-2'>
        <section class='bg-card rounded-xl border border-border p-4'>
          <h2 class='mb-2 font-semibold'>Appearance</h2>
          <div role='menu' aria-label='Appearance settings'>
            <ThemeSwitcherMenuContent closeOnPick={false} ownerActions />
          </div>
        </section>
        <section class='bg-card rounded-xl border border-border p-4'>
          <h2 class='font-semibold'>Library</h2>
          <p class='text-muted-foreground mt-1 text-sm'>Manage current media directories.</p>
          <button
            type='button'
            class='hover:bg-muted mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium'
            onClick={() => setMountsOpen(true)}
          >
            <FolderCog class='size-4' aria-hidden='true' />
            Media directories
          </button>
        </section>
      </div>
      <MountsDialog open={mountsOpen()} onClose={() => setMountsOpen(false)} />
    </main>
  )
}
