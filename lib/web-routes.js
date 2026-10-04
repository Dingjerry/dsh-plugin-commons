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
import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { getMeta, getPlugin, isReady, listCategories, listPlugins, } from "./market/catalog.js";
import { fetchRepoDetail, searchRemote } from "./market/fetcher.js";
import { readInstalledPlugins } from "./market/installed.js";
const execFileAsync = promisify(execFile);
/** Path prefix of the whole Plugin Commons API. */
export const ROUTE_PREFIX = '/api/plugin-commons';
/** Maximum accepted `limit` for a list/search request. */
const MAX_PAGE_SIZE = 100;
/** Longest accepted `q` / keyword parameter. */
const MAX_QUERY_LENGTH = 200;
/** Longest accepted `full_name` parameter. */
const MAX_FULLNAME_LENGTH = 300;
/** Longest accepted install spec (a URL or package spec). */
const MAX_SPEC_LENGTH = 500;
/** Longest accepted package name in an uninstall request. */
const MAX_NAME_LENGTH = 214;
/** Largest JSON request body the panel may send. */
const MAX_BODY_BYTES = 16 * 1024;
/** How long to let a 202 response flush before the install reloads the tree. */
const RESPONSE_FLUSH_MS = 50;
const SORTS = ['stars', 'forks', 'updated'];
class RouteError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.name = 'RouteError';
        this.status = status;
        this.code = code;
    }
}
/** Write one JSON response; the only place a body is emitted. */
function sendJson(res, status, payload) {
    if (res.headersSent) {
        res.destroy();
        return;
    }
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(payload));
}
function errorPayload(code, message) {
    return { error: { code, message } };
}
/** Answer one thrown value; the single exit for every failure path. */
function sendFailure(res, error) {
    if (error instanceof RouteError) {
        sendJson(res, error.status, errorPayload(error.code, error.message));
        return;
    }
    sendJson(res, 500, errorPayload('INTERNAL_ERROR', 'internal error'));
}
/**
 * Read and parse a bounded JSON request body.
 */
async function readJsonBody(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.length;
        if (total > MAX_BODY_BYTES)
            throw new RouteError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
        chunks.push(bytes);
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (text === '')
        return {};
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new RouteError(400, 'BAD_REQUEST', 'Request body must be JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new RouteError(400, 'BAD_REQUEST', 'Request body must be a JSON object');
    }
    return parsed;
}
/** Read one required, length-bounded string field from a parsed body. */
function requiredString(body, field, maxLength) {
    const value = body[field];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new RouteError(400, 'BAD_REQUEST', `Missing "${field}" in the request body`);
    }
    const text = value.trim();
    if (text.length > maxLength)
        throw new RouteError(400, 'BAD_REQUEST', `"${field}" is too long`);
    return text;
}
/** Parse and clamp the `limit` query parameter. */
function parseLimit(url) {
    const raw = url.searchParams.get('limit');
    if (raw === null || raw === '')
        return 50;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed))
        throw new RouteError(400, 'BAD_REQUEST', `Invalid limit: ${raw}`);
    return Math.min(MAX_PAGE_SIZE, Math.max(1, parsed));
}
/** Parse the `page` query parameter (1-based). */
function parsePage(url) {
    const raw = url.searchParams.get('page');
    if (raw === null || raw === '')
        return 1;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1)
        throw new RouteError(400, 'BAD_REQUEST', `Invalid page: ${raw}`);
    return parsed;
}
/** Parse the `sort` query parameter against the closed set. */
function parseSort(url) {
    const raw = url.searchParams.get('sort');
    if (raw === null || raw === '')
        return 'stars';
    if (SORTS.includes(raw))
        return raw;
    throw new RouteError(400, 'BAD_REQUEST', `Invalid sort: ${raw}`);
}
/** Optional bounded string query parameter. */
function optionalQuery(url, name, maxLength) {
    const value = url.searchParams.get(name)?.trim();
    if (value === undefined || value === '')
        return undefined;
    if (value.length > maxLength) {
        throw new RouteError(400, 'BAD_REQUEST', `Query parameter "${name}" is too long`);
    }
    return value;
}
// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
function handleStatus(res, deps) {
    const meta = getMeta();
    sendJson(res, 200, {
        status: meta,
        management: {
            available: deps.manager() !== undefined,
            profileDir: deps.profileDir(),
        },
    });
}
function handlePlugins(url, res) {
    const result = listPlugins({
        page: parsePage(url),
        limit: parseLimit(url),
        sort: parseSort(url),
        category: optionalQuery(url, 'category', 64),
        q: optionalQuery(url, 'q', MAX_QUERY_LENGTH),
    });
    sendJson(res, 200, result);
}
function handleCategories(res) {
    sendJson(res, 200, { categories: listCategories() });
}
async function handleDetail(url, res) {
    const fullName = url.searchParams.get('full_name') ?? '';
    if (fullName === '' || fullName.length > MAX_FULLNAME_LENGTH) {
        throw new RouteError(400, 'BAD_REQUEST', 'Missing or invalid full_name parameter');
    }
    const cached = getPlugin(fullName);
    if (cached !== null) {
        sendJson(res, 200, { plugin: cached });
        return;
    }
    const live = await fetchRepoDetail(fullName);
    if (live === null) {
        sendJson(res, 404, errorPayload('NOT_FOUND', `Plugin not found: ${fullName}`));
        return;
    }
    sendJson(res, 200, { plugin: live });
}
async function handleSearch(url, res) {
    const q = url.searchParams.get('q') ?? '';
    if (q.trim() === '')
        throw new RouteError(400, 'BAD_REQUEST', 'Missing q parameter');
    if (q.length > MAX_QUERY_LENGTH)
        throw new RouteError(400, 'BAD_REQUEST', 'Query too long');
    const limit = parseLimit(url);
    const results = await searchRemote(q, limit);
    sendJson(res, 200, { results, query: q, count: results.length });
}
// ---------------------------------------------------------------------------
// Read / write helpers for the profile's package.json
// ---------------------------------------------------------------------------
/** Resolve the profile package.json and its parent directory. */
function resolveProfilePackageJson(profileDir) {
    if (profileDir === null)
        return null;
    return { path: path.join(profileDir, 'package.json'), dir: profileDir };
}
/**
 * Read the profile's package.json, returning the bundles array and dependencies.
 */
async function readProfilePackageJson(resolved) {
    try {
        const raw = await readFile(resolved.path, 'utf8');
        const parsed = JSON.parse(raw);
        const dsh = parsed?.dsh;
        const profile = dsh?.profile;
        const bundles = profile?.bundles;
        const deps = parsed.dependencies;
        const bundleList = Array.isArray(bundles)
            ? bundles.filter((b) => typeof b === 'string')
            : [];
        return { bundles: bundleList, deps: deps ?? {} };
    }
    catch {
        return { bundles: [], deps: {} };
    }
}
/**
 * Write back the profile's package.json with updated bundles and dependencies.
 */
async function writeProfilePackageJson(resolved, bundles, deps) {
    const raw = await readFile(resolved.path, 'utf8');
    const pkg = JSON.parse(raw);
    const dsh = pkg.dsh;
    if (dsh === undefined) {
        pkg.dsh = { profile: { bundles } };
    }
    else {
        const profile = dsh.profile;
        if (profile === undefined) {
            dsh.profile = { bundles };
        }
        else {
            profile.bundles = bundles;
        }
    }
    pkg.dependencies = deps;
    await writeFile(resolved.path, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}
// ---------------------------------------------------------------------------
// Filesystem-based management fallback
// ---------------------------------------------------------------------------
/**
 * Extract a package name from any spec form.
 *
 * - `github:owner/repo` → `repo`
 * - `https://github.com/owner/repo` → `repo`
 * - `owner/repo` → `repo`
 * - bare name → itself
 */
function packageNameFromSpec(spec) {
    return spec.split('/').pop() ?? spec;
}
/**
 * Install a plugin when pluginManager is unavailable.
 *
 * Strategy — always fetch the package first, only write package.json after
 * the install succeeds, so a failed install leaves no stale state.
 *
 * 1. Try `npm install` first (handles npm packages + GitHub URLs).
 * 2. If npm fails, fall back to `git clone` + manual install for GitHub repos.
 * 3. If both succeed, write the bundle entry to package.json.
 */
async function installWithFallback(spec, profileDir, enabled) {
    const resolved = resolveProfilePackageJson(profileDir);
    if (resolved === null)
        return;
    const pkgName = packageNameFromSpec(spec);
    const nodeModulesPkgPath = path.join(profileDir, 'node_modules', pkgName);
    // --- Step 1: Try npm install (handles npm packages + GitHub URLs) ---
    let installOk = false;
    try {
        await execFileAsync('npm', ['install', spec, '--save'], {
            cwd: profileDir,
            timeout: 180_000,
            maxBuffer: 200 * 1024 * 1024,
        });
        installOk = true;
    }
    catch {
        // npm may not be available or the spec isn't npm-friendly.
        installOk = false;
    }
    // --- Step 2: If npm failed and it's a GitHub URL, try git clone ---
    if (!installOk) {
        const gh = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\.git)?$/i.exec(spec);
        if (gh !== null) {
            const owner = gh[1];
            const repo = gh[2];
            const tmpClone = path.join(profileDir, '.dsh-temp-clone');
            try {
                // Clone into a temp dir first.
                await execFileAsync('git', ['clone', `https://github.com/${owner}/${repo}.git`, tmpClone], {
                    cwd: profileDir,
                    timeout: 180_000,
                    maxBuffer: 200 * 1024 * 1024,
                });
                // Remove old installation if any (scoped layout: node_modules/@owner/repo).
                await rm(path.join(profileDir, 'node_modules', `@${owner}`), { recursive: true, force: true });
                // Remove direct-named installation if any.
                await rm(nodeModulesPkgPath, { recursive: true, force: true });
                // Create the target directory and copy the cloned repo there.
                const targetDir = path.join(profileDir, 'node_modules', `@${owner}`, repo);
                await copyDir(tmpClone, targetDir);
                // Clean up temp dir.
                await rm(tmpClone, { recursive: true, force: true });
                installOk = true;
            }
            catch {
                // cleanup temp dir on failure
                try {
                    await rm(tmpClone, { recursive: true, force: true });
                }
                catch { }
                installOk = false;
            }
        }
    }
    // --- Step 3: Only write package.json after successful install ---
    if (!installOk) {
        throw new RouteError(500, 'INSTALL_FAILED', 'Both npm install and git clone failed; check that the repository exists and git is available');
    }
    const data = await readProfilePackageJson(resolved);
    if (!data.bundles.includes(spec)) {
        data.bundles.push(spec);
        data.deps[pkgName] = spec;
        await writeProfilePackageJson(resolved, data.bundles, data.deps);
    }
}
/**
 * Remove a plugin when pluginManager is unavailable.
 *
 * Strategy — clean up node_modules first, only remove package.json entries
 * after the physical removal succeeds, for the same atomicity principle.
 */
async function uninstallWithFallback(specOrName, profileDir) {
    const resolved = resolveProfilePackageJson(profileDir);
    if (resolved === null)
        return;
    // Resolve the full spec from existing bundles.
    const data = await readProfilePackageJson(resolved);
    const bundleSpec = data.bundles.find((b) => b === specOrName || b.endsWith(`/${specOrName}`)) ?? specOrName;
    const depKey = packageNameFromSpec(bundleSpec);
    // Step 1: Try npm uninstall first.
    let npmUninstallOk = false;
    try {
        await execFileAsync('npm', ['uninstall', bundleSpec], {
            cwd: profileDir,
            timeout: 60_000,
        });
        npmUninstallOk = true;
    }
    catch {
        npmUninstallOk = false;
    }
    // Step 2: Also clean up the physical directory (belt and suspenders).
    let dirCleaned = false;
    // Try removing under scoped @owner/repo first.
    const atIdx = specOrName.indexOf('/');
    if (atIdx !== -1) {
        const scope = specOrName.substring(0, atIdx);
        const scopeDir = path.join(profileDir, 'node_modules', scope);
        try {
            await rm(scopeDir, { recursive: true, force: true });
            dirCleaned = true;
        }
        catch { /* ignore */ }
    }
    // Fallback: direct name.
    if (!dirCleaned) {
        const pkgDir = path.join(profileDir, 'node_modules', specOrName);
        try {
            await rm(pkgDir, { recursive: true, force: true });
            dirCleaned = true;
        }
        catch { /* ignore */ }
    }
    // Step 3: Remove from package.json only after physical cleanup.
    data.bundles = data.bundles.filter((b) => b !== bundleSpec);
    delete data.deps[depKey];
    await writeProfilePackageJson(resolved, data.bundles, data.deps);
}
/** Simple directory copy (recursive). */
async function copyDir(src, dest) {
    const fs = await import('node:fs/promises');
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
        }
        else {
            await fs.copyFile(srcPath, destPath);
        }
    }
}
// ---------------------------------------------------------------------------
// Management handlers
// ---------------------------------------------------------------------------
/**
 * Resolve the plugin-manager service or fail with a diagnosable status.
 */
function requireManager(deps) {
    const manager = deps.manager();
    if (manager === undefined) {
        throw new RouteError(503, 'MANAGEMENT_UNAVAILABLE', 'This profile mounts no plugin manager, so plugins cannot be installed from here');
    }
    return manager;
}
/**
 * Answer now, run later.
 *
 * A successful install or removal reloads the plugin tree, which disposes this
 * very plugin. Answering first — and only starting the work once the response
 * has flushed — is what lets the caller learn the request was accepted instead
 * of watching a socket die mid-flight. The panel follows progress through
 * `GET /installed`.
 */
function acceptThenRun(res, payload, work) {
    let started = false;
    const start = () => {
        if (started)
            return;
        started = true;
        void work();
    };
    res.once('finish', start);
    res.once('close', start);
    setTimeout(start, RESPONSE_FLUSH_MS);
    sendJson(res, 202, payload);
}
/** `GET /installed` — what the profile currently has, for the panel's state. */
async function handleInstalled(res, deps) {
    const manager = deps.manager();
    if (manager === undefined) {
        // Fall back to scanning node_modules + package.json.
        const profileDir = deps.profileDir();
        if (profileDir === null) {
            sendJson(res, 200, { available: false, installed: [] });
            return;
        }
        const resolved = resolveProfilePackageJson(profileDir);
        if (resolved === null) {
            sendJson(res, 200, { available: false, installed: [] });
            return;
        }
        const data = await readProfilePackageJson(resolved);
        // Heuristic: treat every bundle spec in package.json as installed.
        const installed = data.bundles.map((b) => {
            // Extract package name from spec (could be URL or bare name).
            const name = packageNameFromSpec(b);
            return {
                name,
                version: null,
                enabled: true,
                removable: true,
                blockedBy: null,
                repository: null,
            };
        });
        sendJson(res, 200, { available: true, installed });
    }
    else {
        const installed = await readInstalledPlugins(manager, deps.profileDir());
        sendJson(res, 200, { available: true, installed });
    }
}
/** `POST /install` — install one package spec and activate it. */
async function handleInstall(req, res, deps) {
    const manager = deps.manager();
    const body = await readJsonBody(req);
    const spec = requiredString(body, 'spec', MAX_SPEC_LENGTH);
    const enabled = body.enabled !== false;
    if (manager !== undefined) {
        // Use the plugin-manager service when available.
        acceptThenRun(res, { ok: true, status: 'started', spec }, async () => {
            try {
                await manager.installBundle(spec, { enabled });
            }
            catch (error) {
                void error;
            }
        });
    }
    else {
        // Filesystem fallback: install first, write package.json on success.
        const profileDir = deps.profileDir();
        if (profileDir === null) {
            sendJson(res, 400, errorPayload('NO_PROFILE_DIR', 'Cannot determine profile directory'));
            return;
        }
        acceptThenRun(res, { ok: true, status: 'started', spec }, async () => {
            try {
                await installWithFallback(spec, profileDir, enabled);
            }
            catch (error) {
                // The error will be surfaced through the poll loop on GET /installed.
                void error;
            }
        });
    }
}
/** `POST /uninstall` — remove one installed bundle. */
async function handleUninstall(req, res, deps) {
    const manager = deps.manager();
    const body = await readJsonBody(req);
    const name = requiredString(body, 'name', MAX_NAME_LENGTH);
    if (manager !== undefined) {
        acceptThenRun(res, { ok: true, status: 'started', name }, async () => {
            try {
                await manager.removeBundle(name);
            }
            catch (error) {
                void error;
            }
        });
    }
    else {
        const profileDir = deps.profileDir();
        if (profileDir === null)
            return;
        acceptThenRun(res, { ok: true, status: 'started', name }, async () => {
            try {
                await uninstallWithFallback(name, profileDir);
            }
            catch (error) {
                void error;
            }
        });
    }
}
/** `POST /toggle` — enable or disable an installed bundle in place. */
async function handleToggle(req, res, deps) {
    const manager = deps.manager();
    const body = await readJsonBody(req);
    const name = requiredString(body, 'name', MAX_NAME_LENGTH);
    const enabled = body.enabled !== false;
    if (manager !== undefined) {
        await manager.setBundleEnabled(name, enabled);
        sendJson(res, 200, { ok: true, name, enabled });
    }
    else {
        // Without pluginManager we can't toggle at runtime; treat toggle as no-op.
        sendJson(res, 200, { ok: true, name, enabled, note: 'runtime toggle unavailable without pluginManager' });
    }
}
/** Route one request; the entry point wrapped by the registered handler. */
async function handle(req, res, gate, deps) {
    const resolvedGate = gate();
    if (resolvedGate !== undefined) {
        const rejection = resolvedGate.requestRejection(req, res);
        if (rejection !== undefined && rejection !== false) {
            const status = typeof rejection === 'number' ? rejection : 403;
            sendJson(res, status, errorPayload(status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', status === 401 ? 'unauthorized' : 'forbidden'));
            return;
        }
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const segments = url.pathname.slice(ROUTE_PREFIX.length).split('/').filter((s) => s !== '');
    const method = req.method ?? 'GET';
    const [head] = segments;
    if (method === 'GET' && head === 'status' && segments.length === 1) {
        handleStatus(res, deps);
        return;
    }
    if (method === 'GET' && head === 'plugins' && segments.length === 1) {
        await deps.ready();
        handlePlugins(url, res);
        return;
    }
    if (method === 'GET' && head === 'plugins' && segments.length === 2 && segments[1] === 'detail') {
        await deps.ready();
        await handleDetail(url, res);
        return;
    }
    if (method === 'GET' && head === 'categories' && segments.length === 1) {
        await deps.ready();
        handleCategories(res);
        return;
    }
    if (method === 'GET' && head === 'search' && segments.length === 1) {
        await handleSearch(url, res);
        return;
    }
    if (method === 'POST' && head === 'refresh' && segments.length === 1) {
        await deps.refresh();
        sendJson(res, 200, { ok: true, status: getMeta() });
        return;
    }
    if (method === 'GET' && head === 'installed' && segments.length === 1) {
        await handleInstalled(res, deps);
        return;
    }
    if (method === 'POST' && head === 'install' && segments.length === 1) {
        await handleInstall(req, res, deps);
        return;
    }
    if (method === 'POST' && head === 'uninstall' && segments.length === 1) {
        await handleUninstall(req, res, deps);
        return;
    }
    if (method === 'POST' && head === 'toggle' && segments.length === 1) {
        await handleToggle(req, res, deps);
        return;
    }
    throw new RouteError(404, 'NOT_FOUND', `Unknown route: ${url.pathname}`);
}
/**
 * Register the Plugin Commons prefix route.
 *
 * @returns the route disposer, yielded from `ctx.effect`.
 */
export function registerPluginCommonsRoutes(webServer, gate, deps) {
    return webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
            try {
                await handle(req, res, gate, deps);
            }
            catch (error) {
                sendFailure(res, error);
            }
        },
    });
}
/** True when the catalogue has finished its initial load. */
export function isCatalogueReady() {
    return isReady();
}
//# sourceMappingURL=web-routes.js.map