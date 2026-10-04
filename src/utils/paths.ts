/**
 * Path resolution utilities for DSH Plugin Commons.
 */

import * as path from 'node:path'

/**
 * Resolve the DSH home directory.
 * Falls back to the default $DSH_HOME or a user-writable location.
 */
export function resolveDshHome(): string {
  const envHome = process.env.DSH_HOME
  if (typeof envHome === 'string' && envHome.trim() !== '') {
    return envHome.trim()
  }
  // Default fallback
  const home = process.env.HOME || process.env.USERPROFILE || '.'
  return path.join(home, '.dsh')
}

/**
 * Resolve the profile directory this plugin is running inside.
 *
 * `DSH_PROFILE_DIR` is exported by the launcher for every profile process;
 * `$DSH_HOME/profiles/$DSH_PROFILE` is the documented fallback so the plugin
 * still finds the right tree when only the profile name is exported.
 *
 * @returns the absolute profile directory, or `null` when neither is available.
 */
export function resolveProfileDir(): string | null {
  const explicit = process.env.DSH_PROFILE_DIR
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
  const name = process.env.DSH_PROFILE
  if (typeof name === 'string' && name.trim() !== '') {
    return path.join(resolveDshHome(), 'profiles', name.trim())
  }
  return null
}

/**
 * Resolve the plugin data directory for storing cached plugin data.
 */
export function resolvePluginDataDir(dshHome: string): string {
  return path.join(dshHome, 'data', 'plugin-commons')
}

/**
 * Resolve the plugin cache directory for storing fetched GitHub data.
 */
export function resolvePluginCacheDir(dshHome: string): string {
  return path.join(dshHome, 'cache', 'plugin-commons', 'v1')
}
