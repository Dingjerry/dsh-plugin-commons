/**
 * GitHub data source for DSH Plugin Commons.
 *
 * Fetches the `dsh-plugin` topic from the GitHub Search API and persists a
 * snapshot to disk so the catalogue works offline and does not exhaust the
 * unauthenticated rate limit. The in-memory copy is owned by {@link catalog.ts};
 * this module is only concerned with the wire and the cache.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
/** Reduce a raw GitHub repo to the compact shape served by the API. */
function normalizeRepo(raw) {
    return {
        id: raw.id,
        name: raw.name,
        full_name: raw.full_name,
        description: raw.description,
        html_url: raw.html_url,
        homepage: raw.homepage,
        stars: raw.stargazers_count,
        forks: raw.forks_count,
        updated_at: raw.updated_at,
        created_at: raw.created_at,
        language: raw.language,
        topics: raw.topics ?? [],
        owner: {
            login: raw.owner.login,
            avatar_url: raw.owner.avatar_url,
            html_url: raw.owner.html_url,
        },
    };
}
const DEFAULTS = {
    githubApiUrl: 'https://api.github.com',
    cacheTtlMs: 12 * 60 * 60 * 1000,
    pageSize: 100,
    maxPages: 5,
};
let _config = null;
/** Configure the fetcher. Must be called before any other method. */
export function configureFetcher(config) {
    _config = {
        githubApiUrl: config.githubApiUrl ?? DEFAULTS.githubApiUrl,
        token: config.token,
        cacheDir: config.cacheDir,
        cacheTtlMs: config.cacheTtlMs ?? DEFAULTS.cacheTtlMs,
        pageSize: config.pageSize ?? DEFAULTS.pageSize,
        maxPages: config.maxPages ?? DEFAULTS.maxPages,
    };
}
/** True once {@link configureFetcher} has run. */
function config() {
    if (_config === null) {
        throw new Error('[plugin-commons] fetcher not configured');
    }
    return _config;
}
/** The persisted snapshot path for the configured cache directory. */
function snapshotPath() {
    return path.join(config().cacheDir, 'catalog-snapshot.json');
}
/**
 * Read a fresh-enough snapshot from disk, if one exists.
 * Returns `null` when the file is missing, unreadable, malformed, or stale.
 */
export function readSnapshot() {
    const cfg = config();
    try {
        const raw = fs.readFileSync(snapshotPath(), 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.items))
            return null;
        const age = Date.now() - parsed.fetchedAt;
        if (age > cfg.cacheTtlMs)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
/** Persist a snapshot atomically so a crash cannot leave a half-written file. */
export function writeSnapshot(snapshot) {
    const file = snapshotPath();
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(snapshot));
        fs.renameSync(tmp, file);
    }
    catch {
        // A failed cache write must not break the plugin; the in-memory copy is
        // still served for the lifetime of the process.
    }
}
/** Perform an authenticated GitHub API request, returning null on any failure. */
async function githubRequest(url) {
    const cfg = config();
    try {
        const headers = {
            'accept': 'application/vnd.github+json',
            'user-agent': 'dsh-plugin-commons',
        };
        if (cfg.token)
            headers['authorization'] = `Bearer ${cfg.token}`;
        const response = await fetch(url, { headers });
        if (!response.ok)
            return null;
        return (await response.json());
    }
    catch {
        return null;
    }
}
/** Delay helper used between paginated requests to respect the rate limit. */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Pull up to `maxPages` pages of the `dsh-plugin` topic, sorted by stars.
 * The seed catalogue is a bounded, best-effort snapshot: the full 17k+ list is
 * reachable through live search (`searchRemote`) rather than a full crawl.
 */
export async function fetchSnapshot() {
    const { githubApiUrl, pageSize, maxPages } = config();
    const all = [];
    let totalCount = 0;
    for (let page = 1; page <= maxPages; page++) {
        const q = encodeURIComponent('topic:dsh-plugin');
        const url = `${githubApiUrl}/search/repositories?q=${q}&sort=stars&order=desc&page=${page}&per_page=${pageSize}`;
        const response = await githubRequest(url);
        if (response === null || response.items.length === 0)
            break;
        totalCount = response.total_count;
        all.push(...response.items.map(normalizeRepo));
        if (response.items.length < pageSize)
            break;
        await sleep(1000);
    }
    return { fetchedAt: Date.now(), total_count: totalCount, items: all };
}
/**
 * Fetch (or reuse) the catalogue snapshot.
 *
 * A fresh disk snapshot is returned directly; otherwise it is fetched from the
 * network and re-persisted. This is the single entry point the catalog loader
 * uses at startup.
 */
export async function loadOrRefreshSnapshot() {
    const cached = readSnapshot();
    if (cached !== null)
        return cached;
    const fresh = await fetchSnapshot();
    if (fresh.items.length > 0)
        writeSnapshot(fresh);
    return fresh;
}
/** Live search against the GitHub API (full corpus, not just the snapshot). */
export async function searchRemote(keyword, limit) {
    const cfg = config();
    const q = encodeURIComponent(`topic:dsh-plugin ${keyword}`);
    const url = `${cfg.githubApiUrl}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${limit}`;
    const response = await githubRequest(url);
    return response?.items.map(normalizeRepo) ?? [];
}
/** Fetch a single repository by `owner/repo` full name. */
export async function fetchRepoDetail(fullName) {
    const cfg = config();
    const url = `${cfg.githubApiUrl}/repos/${fullName}`;
    const raw = await githubRequest(url);
    return raw === null ? null : normalizeRepo(raw);
}
/** Fetch the latest release tag for a repository. */
export async function fetchLatestVersion(fullName) {
    const cfg = config();
    const url = `${cfg.githubApiUrl}/repos/${fullName}/releases/latest`;
    return await githubRequest(url);
}
//# sourceMappingURL=fetcher.js.map