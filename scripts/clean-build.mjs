#!/usr/bin/env node

/**
 * clean-build.mjs — remove stale build output before a fresh build.
 *
 * Deletes `lib/` so `tsc` (host + client) and `tsdown` start from a clean
 * slate. Keeping it a script (rather than `rm -rf` in package.json) makes the
 * build work on Windows where `rm -rf` is unavailable.
 */

import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
rmSync(join(root, 'lib'), { recursive: true, force: true })
console.log('[clean-build] removed lib/')
