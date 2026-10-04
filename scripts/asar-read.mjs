#!/usr/bin/env node
// Read files out of the DeepSeek Harness app.asar archive.
// Usage:
//   node scripts/asar-read.mjs list <substring>
//   node scripts/asar-read.mjs cat <exact/path-or-suffix>
import fs from 'node:fs'

const ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
const buf = fs.readFileSync(ASAR)
const headerSize = buf.readUInt32LE(4)

let header = null
for (const off of [16, 8, 24, 32]) {
  const raw = buf.subarray(off, off + headerSize)
  const nul = raw.indexOf(0)
  const jsonStr = raw.subarray(0, nul === -1 ? raw.length : nul).toString('utf8')
  try {
    const parsed = JSON.parse(jsonStr)
    if (parsed.files) {
      header = parsed
      break
    }
  } catch {
    /* try next offset */
  }
}
if (!header) {
  console.error('failed to parse asar header')
  process.exit(1)
}

const headerEnd = 8 + headerSize
const files = header.files

function walk(node, prefix, out) {
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) walk(child, prefix + '/' + name, out)
    return
  }
  if (typeof node.offset === 'string' && node.size) out.push({ path: prefix, size: node.size, offset: Number(node.offset) })
}

function collectAll() {
  const out = []
  for (const [name, child] of Object.entries(files)) walk(child, name, out)
  return out
}

const cmd = process.argv[2]
if (cmd === 'list') {
  const needle = (process.argv[3] || '').toLowerCase()
  const out = collectAll()
  const matches = out.filter((f) => f.path.toLowerCase().includes(needle))
  for (const f of matches) console.log(f.path)
  console.error(`\n# ${matches.length} matches for "${needle}" (scanned ${out.length} files)`)
} else if (cmd === 'cat') {
  const want = process.argv[3]
  const out = collectAll()
  const found = out.find((f) => f.path === want || f.path.endsWith(want))
  if (!found) {
    console.error(`not found: ${want}`)
    process.exit(1)
  }
  const start = headerEnd + found.offset
  process.stdout.write(buf.subarray(start, start + found.size))
} else {
  console.error('usage: asar-read.mjs list <substring> | cat <path>')
  process.exit(2)
}
