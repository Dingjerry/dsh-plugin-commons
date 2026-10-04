/**
 * DSH Plugin Commons, browser half.
 *
 * Two registrations, exactly the shape `@deepseek-ai/dsh-client-ui-plugin-manager`
 * uses for its own panel:
 *
 *   ctx.slots.inject('main', function* () { yield ctx.slots.register({ name: 'main', key: PANEL_ID, … }, Page) })
 *   ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order, label, … }, Icon))
 *
 * `slots.inject` waits for the declaring entry (the frame declares `main`, the
 * sidebar declares `sidebar.panellist`) and keeps the registration on this
 * plugin's fiber, so unloading the plugin removes both contributions.
 *
 * Selecting the panel is not done here: the sidebar renders each
 * `sidebar.panellist` entry inside its own `<button>` whose click calls
 * `selectPanel(id)`. Because our entry `id` equals the `main` registration key,
 * that call opens this panel.
 */
import { PluginCommonsPage } from "./PluginCommonsPage.js";
import { PluginCommonsIcon } from "./icons.js";
import { NS, en, zh } from "./locales.js";
/** Stable plugin name of the browser half. */
export const name = 'plugin-commons-client';
/** Services required before the registrations can be made. */
export const inject = ['slots', 'locale'];
/** Sidebar entry id and `main` slot key — the same value links the two. */
export const PANEL_ID = 'plugin-commons';
/** Register the sidebar entry and the panel it opens. */
export function apply(ctx) {
    const slots = ctx.slots;
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plugin-commons: dictionaries');
    const t = ctx.locale.bind(NS);
    // The generator form mirrors the plugin manager: the injected effect owns the
    // registration for as long as `main` is declared.
    slots.inject('main', function* () {
        yield slots.register({ name: 'main', key: PANEL_ID, locale: NS }, PluginCommonsPage);
    });
    // `order: 20` places the entry after the shipped panels, which use 0.
    slots.inject('sidebar.panellist', () => slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        // A thunk, so a locale switch relabels the row without re-registering it.
        label: () => t('panel'),
        locale: NS,
    }, PluginCommonsIcon));
}
//# sourceMappingURL=index.js.map