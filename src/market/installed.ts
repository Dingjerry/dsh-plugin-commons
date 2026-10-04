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

import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { InstalledBundleRow, InstalledPlugin, PluginManagerLike } from '../types.ts'

/** A `repository` manifest field in any of the shapes npm publishes accept. */
type RepositoryField = string | { url?: unknown } | undefined | null

/** Hosts a repository URL may name; anything else is kept verbatim but lowercased. */
const HOST_ALIASES: Record<string, string> = {
  'www.github.com': 'github.com',
}

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
export function normalizeRepositoryUrl(value: RepositoryField): string | null {
  const raw = typeof value === 'string' ? value : typeof value?.url === 'string' ? value.url : ''
  let text = raw.trim()
  if (text === '') return null

  // `github:owner/repo`, `gitlab:owner/repo`, … (npm's hosted shorthand).
  const shorthand = /^(github|gitlab|bitbucket):(.+)$/i.exec(text)
  if (shorthand !== null) {
    const host = shorthand[1]?.toLowerCase()
    const rest = shorthand[2] ?? ''
    return finish(`https://${host ?? 'github.com'}/${rest}`)
  }

  text = text.replace(/^git\+/, '')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return finish(text)
  if (/^git@[^:]+:/i.test(text)) {
    const scp = /^git@([^:]+):(.+)$/i.exec(text)
    return scp === null ? null : finish(`https://${scp[1] ?? ''}/${scp[2] ?? ''}`)
  }
  // A bare `owner/repo` is the GitHub shorthand npm documents.
  if (/^[\w.-]+\/[\w.-]+$/.test(text)) return finish(`https://github.com/${text}`)
  return null
}

/** Strip `.git`, drop a trailing slash, and lowercase the host. */
function finish(url: string): string | null {
  let text = url.trim()
  if (text === '') return null
  text = text.replace(/\.git$/i, '').replace(/\/+$/, '')
  try {
    const parsed = new URL(text)
    const host = HOST_ALIASES[parsed.host.toLowerCase()] ?? parsed.host.toLowerCase()
    const pathname = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${host}${pathname}`.toLowerCase()
  } catch {
    return text.toLowerCase()
  }
}

/**
 * Read the `repository` field of one installed package.
 *
 * @param profileDir - absolute profile directory holding `node_modules`.
 * @param name - installed package name.
 * @returns the normalized repository URL, or `null` when unavailable.
 */
async function readPackageRepository(profileDir: string, name: string): Promise<string | null> {
  const manifestPath = path.join(profileDir, 'node_modules', name, 'package.json')
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    return normalizeRepositoryUrl((parsed as { repository?: RepositoryField }).repository)
  } catch {
    return null
  }
}

/** Narrow one `listBundles()` row to the fields the panel renders. */
function toInstalledPlugin(row: InstalledBundleRow, repository: string | null): InstalledPlugin {
  const blockedBy = row.readOnlyReason ?? row.error?.code ?? null
  return {
    name: row.name,
    version: typeof row.version === 'string' ? row.version : null,
    enabled: row.enabled === true,
    removable: row.removable === true,
    blockedBy,
    repository,
  }
}

/**
 * List the bundles installed in the profile, each with its repository.
 *
 * @param manager - the plugin-manager service, or `undefined` when the profile
 *   does not mount it.
 * @param profileDir - absolute profile directory, or `null` when unknown.
 * @returns installed plugins, repository-enriched when the directory is known.
 * @throws whatever `listBundles()` throws; the caller maps that to a response.
 */
export async function readInstalledPlugins(
  manager: PluginManagerLike | undefined,
  profileDir: string | null,
): Promise<InstalledPlugin[]> {
  if (manager === undefined) return []
  const rows = await manager.listBundles()
  const usable = rows.filter((row) => typeof row.name === 'string' && row.name !== '')
  if (profileDir === null) return usable.map((row) => toInstalledPlugin(row, null))
  const repositories = await Promise.all(
    usable.map(async (row) => readPackageRepository(profileDir, row.name)),
  )
  return usable.map((row, index) => toInstalledPlugin(row, repositories[index] ?? null))
}

/** True when the manager exists and can be reached at all. */
export function isManagementAvailable(manager: PluginManagerLike | undefined): boolean {
  return manager !== undefined
}
