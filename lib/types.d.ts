/**
 * Shared type definitions for DSH Plugin Commons.
 *
 * Everything here is structural and independent of DSH host packages, so the
 * plugin compiles against the public `@deepseek-ai/cordis` surface plus Node's
 * own `http` types without importing `@deepseek-ai/dsh-host-webserver`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/**
 * Structural view of the DSH web-server service (`webServer` / `httpServer`).
 *
 * The real service exposes `register({ kind, path, handler })` and returns a
 * disposer. We model only that entry point, mirroring the frozen contract used
 * by the reference `dsh-skills-hub` plugin.
 */
export interface WebServerLike {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
/**
 * A single repository from the GitHub `dsh-plugin` topic.
 * Only the fields the plugin UI needs are kept.
 */
export interface PluginRepo {
    id: number;
    name: string;
    full_name: string;
    description: string | null;
    html_url: string;
    homepage: string | null;
    stars: number;
    forks: number;
    updated_at: string;
    created_at: string;
    language: string | null;
    topics: string[];
    owner: {
        login: string;
        avatar_url: string;
        html_url: string;
    };
}
/**
 * Structural view of the DSH plugin-manager service (`pluginManager`).
 *
 * The service is owned by the management bundle and is therefore absent from
 * profiles that do not mount it (a headless profile, for instance), so the
 * plugin resolves it lazily and degrades to a read-only catalogue.
 */
export interface PluginManagerLike {
    /** Installed bundles with activation state, or the reason a row is unreadable. */
    listBundles(): Promise<InstalledBundleRow[]>;
    /** Install one package spec, then activate it when `enabled` is not false. */
    installBundle(spec: string, options?: {
        enabled?: boolean;
        requestId?: string;
    }): Promise<InstallOutcome>;
    /** Unload and remove one profile-owned bundle dependency. */
    removeBundle(name: string): Promise<RemoveOutcome>;
    /** Turn a bundle's patch layer on or off without removing the dependency. */
    setBundleEnabled(name: string, enabled: boolean): Promise<unknown>;
}
/** One row of `pluginManager.listBundles()`, narrowed to what the panel shows. */
export interface InstalledBundleRow {
    name: string;
    version?: string;
    description?: string;
    enabled: boolean;
    installed: boolean;
    removable: boolean;
    readOnlyReason?: string;
    error?: {
        code: string;
    };
}
/** Outcome shape of `pluginManager.installBundle()`. */
export interface InstallOutcome {
    changed?: boolean;
    application?: 'applied' | 'restart-required' | 'cancelled' | 'failed';
    error?: {
        code?: string;
        message?: string;
    };
    bundle?: string;
    target?: string;
}
/** Outcome shape of `pluginManager.removeBundle()`. */
export interface RemoveOutcome {
    changed?: boolean;
    application?: 'applied' | 'restart-required' | 'cancelled' | 'failed';
    error?: {
        code?: string;
        message?: string;
    };
}
/**
 * An installed plugin as the panel sees it: the bundle row plus the GitHub
 * repository its manifest points at, so a catalogue card can be matched to it.
 */
export interface InstalledPlugin {
    name: string;
    version: string | null;
    enabled: boolean;
    removable: boolean;
    /** `readOnlyReason` or `error.code` when the row is not manageable. */
    blockedBy: string | null;
    /** Normalized `https://github.com/owner/repo` from the package manifest. */
    repository: string | null;
}
/** A plugin category with its localized names and a live count. */
export interface PluginCategory {
    id: string;
    name: string;
    nameEn: string;
    count: number;
}
/** Paginated result shape returned by the list/search endpoints. */
export interface PaginatedResult<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
}
