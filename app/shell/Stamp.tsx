type StampVariant = 'stonkz' | 'red' | 'amber'

export function Stamp({
  children,
  variant = 'stonkz',
}: {
  children: string
  variant?: StampVariant
}) {
  return <span className={`stamp stamp-${variant}`}>{children}</span>
}
