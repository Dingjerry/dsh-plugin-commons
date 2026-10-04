import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
};
/**
 * Sidebar entry glyph: a puzzle piece over a grid (a "commons" of plugins).
 *
 * Renders a bare `<svg>` and never a button: `sidebar.panellist` entries are
 * rendered inside the sidebar's own `<button>`, so an interactive wrapper here
 * would nest a control inside a control.
 */
export function PluginCommonsIcon({ size = 16, active = false, className }) {
    return (_jsxs("svg", { width: size, height: size, viewBox: "0 0 20 20", className: className, strokeWidth: active ? 1.8 : 1.6, ...stroke, "aria-hidden": "true", focusable: "false", children: [_jsx("rect", { x: "2.5", y: "2.5", width: "15", height: "15", rx: "3" }), _jsx("path", { d: "M8 2.5V5a1.6 1.6 0 0 0 3.2 0V2.5", fill: active ? 'currentColor' : 'none', fillOpacity: active ? 0.16 : 0 }), _jsx("path", { d: "M8 17.5V15a1.6 1.6 0 0 1 3.2 0v2.5" }), _jsx("circle", { cx: "10", cy: "10", r: "2.2" }), _jsx("path", { d: "M10 7.8V4.6M10 12.2v3.2M7.8 10H4.6M12.2 10h3.2" })] }));
}
//# sourceMappingURL=icons.js.map