export function SnapPreview() {
  return (
    <div
      data-snap-preview
      className='pointer-events-none absolute rounded-sm border-2 border-blue-400/50 bg-blue-500/15 transition-all duration-150'
      style={{ display: 'none', zIndex: 99999 }}
    />
  )
}
