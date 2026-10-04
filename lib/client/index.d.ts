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
import type { Context as ClientContext } from '@deepseek-ai/cordis';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        /** Global panel icon rows of the sidebar. */
        'sidebar.panellist': {
            kind: 'list';
            scope: 'root';
            owner: {
                size: number;
                active: boolean;
            };
        };
    }
}
/** Stable plugin name of the browser half. */
export declare const name = "plugin-commons-client";
/** Services required before the registrations can be made. */
export declare const inject: string[];
/** Sidebar entry id and `main` slot key — the same value links the two. */
export declare const PANEL_ID = "plugin-commons";
/** Register the sidebar entry and the panel it opens. */
export declare function apply(ctx: ClientContext): void;
