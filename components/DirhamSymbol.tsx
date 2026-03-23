// Official UAE Dirham Symbol (U+20C3)
// Accepted by Unicode Technical Committee, scheduled for Unicode 18.0 (September 2026)
// SVG rendering used until system fonts support the codepoint natively
// Design per Central Bank of the UAE Dirham Currency Symbol Guideline v1.0

interface Props {
  size?: number | string
  color?: string
  style?: React.CSSProperties
}

export function DirhamSymbol({ size = '1em', color = 'currentColor', style }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 110 120"
      width={size}
      height={size}
      fill={color}
      aria-label="Dirham"
      role="img"
      style={{ display: 'inline-block', verticalAlign: '-0.1em', flexShrink: 0, ...style }}
    >
      {/* Vertical stem */}
      <rect x="18" y="0" width="14" height="120" rx="2" />
      {/* D curve body */}
      <path d="M32 8 Q96 8 96 60 Q96 112 32 112 L32 98 Q80 98 80 60 Q80 22 32 22 Z" />
      {/* Upper horizontal bar with pointed ends */}
      <path d="M4 42 L88 42 Q95 42 98 45 Q101 48 98 51 Q95 54 88 54 L4 54 Q0 54 0 48 Q0 42 4 42 Z" />
      {/* Lower horizontal bar with pointed ends */}
      <path d="M4 66 L88 66 Q95 66 98 69 Q101 72 98 75 Q95 78 88 78 L4 78 Q0 78 0 72 Q0 66 4 66 Z" />
    </svg>
  )
}

// Formatted dirham amount: DH symbol + space + number
// Per guidelines: symbol left of numeral, same height as text, with space between
export function fmt(amount: number, opts?: { decimals?: number; suffix?: string }): React.ReactNode {
  const { decimals = 0, suffix } = opts || {}
  const num = decimals > 0 ? amount.toFixed(decimals) : Math.round(amount).toLocaleString()
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2em' }}>
      <DirhamSymbol />
      <span>{num}{suffix || ''}</span>
    </span>
  )
}
