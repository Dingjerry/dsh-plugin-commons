/**
 * GitHub data source for DSH Plugin Commons.
 *
 * Fetches the `dsh-plugin` topic from the GitHub Search API and persists a
 * snapshot to disk so the catalogue works offline and does not exhaust the
 * unauthenticated rate limit. The in-memory copy is owned by {@link catalog.ts};
 * this module is only concerned with the wire and the cache.
 */
import type { PluginRepo } from '../types.ts';
/** Configuration for the fetcher, set once by `apply()`. */
export interface FetcherConfig {
    /** Base URL of the GitHub API (default: https://api.github.com). */
    githubApiUrl?: string;
    /** Optional personal access token for higher rate limits. */
    token?: string;
    /** Directory where the persisted snapshot lives. */
    cacheDir: string;
    /** Snapshot time-to-live in milliseconds (default: 12 hours). */
    cacheTtlMs?: number;
    /** Page size for paginated search (default: 100, GitHub max). */
    pageSize?: number;
    /** Maximum number of pages to pull for the seed catalogue (default: 5). */
    maxPages?: number;
}
/** Snapshot persisted to disk. */
export interface Snapshot {
    fetchedAt: number;
    total_count: number;
    items: PluginRepo[];
}
/** Configure the fetcher. Must be called before any other method. */
export declare function configureFetcher(config: FetcherConfig): void;
/**
 * Read a fresh-enough snapshot from disk, if one exists.
 * Returns `null` when the file is missing, unreadable, malformed, or stale.
 */
export declare function readSnapshot(): Snapshot | null;
/** Persist a snapshot atomically so a crash cannot leave a half-written file. */
export declare function writeSnapshot(snapshot: Snapshot): void;
/**
 * Pull up to `maxPages` pages of the `dsh-plugin` topic, sorted by stars.
 * The seed catalogue is a bounded, best-effort snapshot: the full 17k+ list is
 * reachable through live search (`searchRemote`) rather than a full crawl.
 */
export declare function fetchSnapshot(): Promise<Snapshot>;
/**
 * Fetch (or reuse) the catalogue snapshot.
 *
 * A fresh disk snapshot is returned directly; otherwise it is fetched from the
 * network and re-persisted. This is the single entry point the catalog loader
 * uses at startup.
 */
export declare function loadOrRefreshSnapshot(): Promise<Snapshot>;
/** Live search against the GitHub API (full corpus, not just the snapshot). */
export declare function searchRemote(keyword: string, limit: number): Promise<PluginRepo[]>;
/** Fetch a single repository by `owner/repo` full name. */
export declare function fetchRepoDetail(fullName: string): Promise<PluginRepo | null>;
