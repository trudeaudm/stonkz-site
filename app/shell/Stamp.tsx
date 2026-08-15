type StampVariant = 'stonkz' | 'not' | 'gen' | 'insta' | 'gone'

export function Stamp({
  children,
  variant = 'stonkz',
}: {
  children: string
  variant?: StampVariant
}) {
  return <span className={`stamp ${variant}`}>{children}</span>
}
