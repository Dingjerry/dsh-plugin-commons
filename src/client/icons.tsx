/**
 * Inline SVG icon set for the Plugin Commons panel.
 *
 * Drawn as stroked `currentColor` SVG so the icon inherits its parent's
 * token-driven color and stays correct in both themes.
 */

/** Props shared by every icon. */
export interface PluginCommonsIconProps {
  size?: number
  className?: string
}

/** Props of the sidebar entry glyph, which the shell marks as selected. */
export interface PluginCommonsPanelIconProps extends PluginCommonsIconProps {
  active?: boolean
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/**
 * Sidebar entry glyph: a puzzle piece over a grid (a "commons" of plugins).
 *
 * Renders a bare `<svg>` and never a button: `sidebar.panellist` entries are
 * rendered inside the sidebar's own `<button>`, so an interactive wrapper here
 * would nest a control inside a control.
 */
export function PluginCommonsIcon({ size = 16, active = false, className }: PluginCommonsPanelIconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      className={className}
      strokeWidth={active ? 1.8 : 1.6}
      {...stroke}
      aria-hidden="true"
      focusable="false"
    >
      {/* Outer rounded square (the board). */}
      <rect x="2.5" y="2.5" width="15" height="15" rx="3" />
      {/* Puzzle knob on top and its notch on the bottom. */}
      <path d="M8 2.5V5a1.6 1.6 0 0 0 3.2 0V2.5" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.16 : 0} />
      <path d="M8 17.5V15a1.6 1.6 0 0 1 3.2 0v2.5" />
      {/* Center node with connections. */}
      <circle cx="10" cy="10" r="2.2" />
      <path d="M10 7.8V4.6M10 12.2v3.2M7.8 10H4.6M12.2 10h3.2" />
    </svg>
  )
}
