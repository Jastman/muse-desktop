import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { ProjectFile } from '../shared/protocol'

export async function resolveProjectPath(project: string, path: string) {
  const root = await realpath(project)
  const target = await realpath(resolve(root, path))
  const fromRoot = relative(root, target)
  if (fromRoot === '..' || /^\.\.[/\\]/.test(fromRoot) || isAbsolute(fromRoot))
    throw new Error('This path is outside the selected project.')
  return { root, target }
}

export async function listProjectFiles(project: string, directory: string): Promise<ProjectFile[]> {
  const { root, target } = await resolveProjectPath(project, directory)
  const entries = await readdir(target, { withFileTypes: true })
  return entries
    .filter(
      (entry) =>
        !['.git', 'node_modules', '.DS_Store'].includes(entry.name) && !entry.isSymbolicLink(),
    )
    .map((entry) => ({
      name: entry.name,
      path: relative(root, join(target, entry.name)).replaceAll('\\', '/'),
      directory: entry.isDirectory(),
    }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
}

export async function readProjectFile(project: string, path: string) {
  const { target } = await resolveProjectPath(project, path)
  const info = await stat(target)
  if (!info.isFile()) throw new Error('Choose a file to preview.')
  if (info.size > 512 * 1024)
    throw new Error('This file is larger than the 512 KB preview limit. Open it in your editor.')
  const content = await readFile(target)
  if (content.includes(0)) throw new Error('This is a binary file. Open it from Finder to view it.')
  return content.toString('utf8')
}
