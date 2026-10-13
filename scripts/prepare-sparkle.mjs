import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('..', import.meta.url))
export const config = JSON.parse(await readFile(new URL('./sparkle-config.json', import.meta.url)))

export async function prepareSparkle() {
  const directory = resolve(root, '.cache/sparkle', config.version)
  const archive = `${directory}.tar.xz`
  await mkdir(resolve(root, '.cache/sparkle'), { recursive: true })
  let bytes
  try {
    bytes = await readFile(archive)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const url = `https://github.com/sparkle-project/Sparkle/releases/download/${config.version}/Sparkle-${config.version}.tar.xz`
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`Sparkle download failed: HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha256').update(bytes).digest('hex') !== config.sha256) {
    throw new Error('Sparkle checksum mismatch. Remove .cache/sparkle and try again.')
  }
  await writeFile(archive, bytes)
  // Always extract the verified archive so a stale cache cannot supply different code.
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  execFileSync('/usr/bin/tar', ['-xJf', archive, '-C', directory])
  return directory
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Sparkle ${config.version}: ${await prepareSparkle()}`)
}
