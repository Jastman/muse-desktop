import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export function execCli(
  path: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    timeout: number
    maxBuffer: number
    encoding?: BufferEncoding
    signal?: AbortSignal
  },
) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(path)) {
    return execute(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', path, ...args], options)
  }
  return execute(path, args, options)
}

export async function discoverCli(explicitPath = '') {
  const environment = { ...process.env }
  const isWindows = process.platform === 'win32'
  let shellWarning: string | undefined
  if (!isWindows) {
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
    try {
      const { stdout } = await execute(
        shell,
        ['-ilc', "printf '\\0MUSE_DESKTOP_ENV\\0'; (/usr/bin/env -0 || env -0)"],
        {
          timeout: 6000,
          maxBuffer: 1024 * 1024,
          encoding: 'utf8',
        },
      )
      const marker = '\0MUSE_DESKTOP_ENV\0'
      const start = stdout.lastIndexOf(marker)
      if (start >= 0) {
        for (const entry of stdout.slice(start + marker.length).split('\0')) {
          const equals = entry.indexOf('=')
          if (equals > 0) environment[entry.slice(0, equals)] = entry.slice(equals + 1)
        }
      }
    } catch {
      shellWarning = 'Your login shell did not respond. Using standard installation locations.'
    }
  }
  const directories = [
    ...new Set(
      [
        ...(environment.PATH || environment.Path || '').split(delimiter),
        join(homedir(), '.local', 'bin'),
        join(homedir(), '.muse', 'bin'),
        ...(isWindows
          ? [
              process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'muse') : '',
              process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Muse') : '',
              process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '',
            ]
          : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/snap/bin']),
      ].filter(Boolean),
    ),
  ]
  environment.PATH = directories.join(delimiter)
  if (isWindows) environment.Path = environment.PATH
  // Electron-only variables must not leak into the user's CLI or its tools.
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.NODE_OPTIONS
  const binaryNames = isWindows ? ['muse.exe', 'muse.cmd', 'muse'] : ['muse']
  const candidates = explicitPath
    ? [explicitPath]
    : directories.flatMap((directory) => binaryNames.map((name) => join(directory, name)))
  for (const path of candidates) {
    if (!isAbsolute(path)) continue
    try {
      await access(path, isWindows ? constants.F_OK : constants.X_OK)
      const { stdout } = await execCli(path, ['--version'], {
        env: environment,
        timeout: 6000,
        maxBuffer: 64 * 1024,
        encoding: 'utf8',
      })
      if (!/^Muse Code\s/m.test(stdout)) continue
      return {
        path,
        version: stdout.trim().replace(/^Muse Code\s+/, ''),
        environment,
        shellWarning,
      }
    } catch {
      // Other unrelated binaries named `muse` are not usable Muse Code installations.
    }
  }
  throw new Error(
    explicitPath
      ? 'This executable is not a working Muse Code installation. Choose the muse binary or clear the custom path.'
      : 'Muse Code was not found. Install the CLI, run muse login in Terminal, then reconnect.',
  )
}
