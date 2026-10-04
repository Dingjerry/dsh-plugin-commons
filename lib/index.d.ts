/**
 * DSH Plugin Commons — DeepSeek Harness host plugin.
 *
 * Adds the Plugin Commons catalogue to a DSH profile:
 *
 *   - `/api/plugin-commons/*` (status, plugins, categories, search, detail,
 *     refresh) served from the composition's Web server;
 *   - a GitHub-backed catalogue of every repository tagged `dsh-plugin`, seeded
 *     from a bounded snapshot and searchable live against the full corpus.
 *
 * Installation is pure HTTP + filesystem cache: no agent session is involved
 * and the tools registry is untouched.
 *
 * @module dsh-plugin-commons
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "plugin-commons";
/**
 * Required services.
 *
 * Empty on purpose: the plugin must *load* in every profile. The Web server is
 * looked up lazily and bound whenever it appears, so a headless profile keeps
 * the plugin inert instead of failing on a service key the composition never
 * provides.
 */
export declare const inject: string[];
/** User-facing configuration, all optional. */
export interface PluginConfig {
    /** GitHub personal access token for higher rate limits. */
    githubToken?: string;
    /** Snapshot time-to-live in hours (default 12). */
    cacheTtlHours?: number;
    /** Number of pages to pull for the seed catalogue (default 200, covering all 17k+ repos). */
    maxPages?: number;
    /** Page size for paginated search (default 100). */
    pageSize?: number;
}
/**
 * Activate the plugin.
 *
 * @param ctx - host plugin context.
 * @param config - plugin configuration (schema defaults already applied).
 */
export declare function apply(ctx: Context, config?: PluginConfig): void;
