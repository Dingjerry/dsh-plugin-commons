/**
 * Path resolution utilities for DSH Plugin Commons.
 */
/**
 * Resolve the DSH home directory.
 * Falls back to the default $DSH_HOME or a user-writable location.
 */
export declare function resolveDshHome(): string;
/**
 * Resolve the profile directory this plugin is running inside.
 *
 * `DSH_PROFILE_DIR` is exported by the launcher for every profile process;
 * `$DSH_HOME/profiles/$DSH_PROFILE` is the documented fallback so the plugin
 * still finds the right tree when only the profile name is exported.
 *
 * @returns the absolute profile directory, or `null` when neither is available.
 */
export declare function resolveProfileDir(): string | null;
/**
 * Resolve the plugin data directory for storing cached plugin data.
 */
export declare function resolvePluginDataDir(dshHome: string): string;
/**
 * Resolve the plugin cache directory for storing fetched GitHub data.
 */
export declare function resolvePluginCacheDir(dshHome: string): string;
