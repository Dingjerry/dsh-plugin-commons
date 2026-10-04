/**
 * Inline SVG icon set for the Plugin Commons panel.
 *
 * Drawn as stroked `currentColor` SVG so the icon inherits its parent's
 * token-driven color and stays correct in both themes.
 */
/** Props shared by every icon. */
export interface PluginCommonsIconProps {
    size?: number;
    className?: string;
}
/** Props of the sidebar entry glyph, which the shell marks as selected. */
export interface PluginCommonsPanelIconProps extends PluginCommonsIconProps {
    active?: boolean;
}
/**
 * Sidebar entry glyph: a puzzle piece over a grid (a "commons" of plugins).
 *
 * Renders a bare `<svg>` and never a button: `sidebar.panellist` entries are
 * rendered inside the sidebar's own `<button>`, so an interactive wrapper here
 * would nest a control inside a control.
 */
export declare function PluginCommonsIcon({ size, active, className }: PluginCommonsPanelIconProps): JSX.Element;
