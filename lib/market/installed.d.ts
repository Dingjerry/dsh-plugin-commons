/**
 * Installed-plugin inventory for the Plugin Commons panel.
 *
 * The plugin-manager service owns installation; this module only *reads* what
 * is installed and enriches it with the GitHub repository each package
 * declares, so a catalogue card can be matched to the bundle it would install.
 *
 * Reading is deliberately tolerant: one unreadable manifest downgrades that
 * single row to "no repository" instead of failing the whole listing.
 *
 * @module dsh-plugin-commons/market/installed
 */
import type { InstalledPlugin, PluginManagerLike } from '../types.ts';
/** A `repository` manifest field in any of the shapes npm publishes accept. */
type RepositoryField = string | {
    url?: unknown;
} | undefined | null;
/**
 * Reduce any `repository` manifest value to a comparable `https://host/owner/repo`.
 *
 * Handles the four shapes npm accepts — a full URL, a `git+https:` URL, a
 * `github:owner/repo` shorthand, and a bare `owner/repo` — and strips the
 * `.git` suffix and any trailing slash so two spellings of one repository
 * compare equal.
 *
 * @param value - the raw `repository` field.
 * @returns the normalized URL, or `null` when the value names no repository.
 */
export declare function normalizeRepositoryUrl(value: RepositoryField): string | null;
/**
 * List the bundles installed in the profile, each with its repository.
 *
 * @param manager - the plugin-manager service, or `undefined` when the profile
 *   does not mount it.
 * @param profileDir - absolute profile directory, or `null` when unknown.
 * @returns installed plugins, repository-enriched when the directory is known.
 * @throws whatever `listBundles()` throws; the caller maps that to a response.
 */
export declare function readInstalledPlugins(manager: PluginManagerLike | undefined, profileDir: string | null): Promise<InstalledPlugin[]>;
/** True when the manager exists and can be reached at all. */
export declare function isManagementAvailable(manager: PluginManagerLike | undefined): boolean;
export {};
