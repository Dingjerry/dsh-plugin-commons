/**
 * HTTP surface for DSH Plugin Commons.
 *
 * One `prefix` route (`/api/plugin-commons`) owns every endpoint the panel
 * needs. Every response is JSON with `Cache-Control: no-store`: the catalogue
 * changes when it is refreshed, and a stale browser cache would hide that.
 *
 * Security note: raw `webServer` routes do not inherit the Connection service's
 * Host/Origin fence. A browser-trust gate is therefore resolved per request and
 * evaluated before any work happens (see {@link RequestGate}).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginManagerLike, WebServerLike } from './types.ts';
/** Path prefix of the whole Plugin Commons API. */
export declare const ROUTE_PREFIX = "/api/plugin-commons";
/**
 * Browser-trust gate, structurally equal to the Connection service predicate.
 * `requestRejection` returns `boolean | 401 | 403 | undefined` on the real
 * service; both shapes are accepted so the envelope can carry the real status.
 */
export interface RequestGate {
    requestRejection(req: IncomingMessage, res: ServerResponse): boolean | number | undefined;
}
/** Resolves the gate for one request; `undefined` means there is no fence. */
export type RequestGateSource = () => RequestGate | undefined;
/** Dependencies handed in by `apply()`. */
export interface PluginCommonsRoutesDeps {
    /** Re-pull the catalogue from GitHub, then rebuild the in-memory index. */
    refresh: () => Promise<void>;
    /** Settles when the initial catalogue load has finished. */
    ready: () => Promise<void>;
    /** Resolves the plugin-manager service, or `undefined` where it is not mounted. */
    manager: () => PluginManagerLike | undefined;
    /** Resolves the profile directory the installed-scan reads, or `null`. */
    profileDir: () => string | null;
}
/**
 * Register the Plugin Commons prefix route.
 *
 * @returns the route disposer, yielded from `ctx.effect`.
 */
export declare function registerPluginCommonsRoutes(webServer: WebServerLike, gate: RequestGateSource, deps: PluginCommonsRoutesDeps): () => void;
/** True when the catalogue has finished its initial load. */
export declare function isCatalogueReady(): boolean;
