import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export async function discoverCli(explicitPath = '') {
  const environment = { ...process.env }
  const shell = process.env.SHELL || '/bin/zsh'
  let shellWarning: string | undefined
  try {
    const { stdout } = await execute(
      shell,
      ['-ilc', "printf '\\0MUSE_DESKTOP_ENV\\0'; /usr/bin/env -0"],
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
  const directories = [
    ...new Set(
      [
        ...(environment.PATH || '').split(delimiter),
        join(homedir(), '.local/bin'),
        join(homedir(), '.muse/bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
      ].filter(Boolean),
    ),
  ]
  environment.PATH = directories.join(delimiter)
  // Electron-only variables must not leak into the user's CLI or its tools.
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.NODE_OPTIONS
  const candidates = explicitPath
    ? [explicitPath]
    : directories.map((directory) => join(directory, 'muse'))
  for (const path of candidates) {
    if (!isAbsolute(path)) continue
    try {
      await access(path, constants.X_OK)
      const { stdout } = await execute(path, ['--version'], {
        env: environment,
        timeout: 6000,
        maxBuffer: 64 * 1024,
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
