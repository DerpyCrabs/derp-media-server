import { view, type JSX } from 'effectweb'
export const SettingRow = view<{ label: string; children: JSX.Element }>((props) => (
  <div class='grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 py-2'>
    <span class='text-sm'>{props.label}</span>
    <div class='min-w-0'>{props.children}</div>
  </div>
))
