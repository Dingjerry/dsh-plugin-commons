/**
 * In-memory plugin catalogue.
 *
 * Owns the list of repositories pulled from GitHub and answers list/search/
 * category/detail queries without touching the network. It is seeded once by
 * the host plugin (`setCatalog`) and read on every API request.
 */
import type { PaginatedResult, PluginCategory, PluginRepo } from '../types.ts';
/** Catalogue metadata exposed through the status endpoint. */
export interface CatalogMeta {
    ready: boolean;
    loading: boolean;
    error: string | null;
    total: number;
    fetchedAt: number | null;
    snapshotTotal: number;
}
/** Replace the catalogue contents (and mark it ready). */
export declare function setCatalog(items: PluginRepo[], snapshotTotal: number, fetchedAt: number): void;
/** Mark the catalogue as loading (used between a refresh request and its result). */
export declare function setLoading(): void;
/** Mark the catalogue as failed, preserving whatever items were already loaded. */
export declare function setError(message: string): void;
/** Current catalogue metadata. */
export declare function getMeta(): CatalogMeta;
/** True once a catalogue (from disk or network) has been loaded. */
export declare function isReady(): boolean;
/** List plugins with optional category filter, keyword filter, sorting and paging. */
export declare function listPlugins(options?: {
    page?: number;
    limit?: number;
    sort?: 'stars' | 'forks' | 'updated';
    category?: string;
    q?: string;
}): PaginatedResult<PluginRepo>;
/** Categories with live counts computed from the loaded catalogue. */
export declare function listCategories(): PluginCategory[];
/** Look up a single plugin by `owner/repo` full name. */
export declare function getPlugin(fullName: string): PluginRepo | null;
