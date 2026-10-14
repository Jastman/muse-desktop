import { app, dialog, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { UpdateStatus } from '../shared/protocol'

type NativeStatus = Pick<UpdateStatus, 'canCheck' | 'automaticChecks'>
type Sparkle = {
  initialize(): NativeStatus
  status(): NativeStatus
  check(): NativeStatus
  setAutomaticChecks(enabled: boolean): NativeStatus
  setBusy(busy: boolean): NativeStatus
}
type ReleaseAsset = { name: string; browser_download_url: string }

const RELEASES_API = 'https://api.github.com/repos/robzilla1738/muse-desktop/releases/latest'
const RELEASES_URL = 'https://github.com/robzilla1738/muse-desktop/releases/latest'
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000

let sparkle: Sparkle | undefined
let releaseUpdater = false
let automaticChecks = false
let checking = false
let busy = false
let statusMessage: string | undefined
let dailyTimer: ReturnType<typeof setInterval> | undefined
let unavailable =
  'Updates are available in the packaged Mac app, Windows installer, and Linux release builds. Development builds use your local source.'

export function compareVersions(current: string, candidate: string): number {
  const clean = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
  const a = clean(current)
  const b = clean(candidate)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] || 0) - (a[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function selectReleaseAsset(
  assets: ReleaseAsset[],
  platform: string,
  arch: string,
): string | undefined {
  const valid = assets.filter(
    (asset) =>
      typeof asset.name === 'string' &&
      typeof asset.browser_download_url === 'string' &&
      asset.browser_download_url.startsWith('https://github.com/robzilla1738/muse-desktop/'),
  )
  const archToken = arch === 'arm64' ? 'arm64' : 'x64'
  if (platform === 'win32') {
    return (
      valid.find((a) => a.name.includes(archToken) && a.name.endsWith('.exe'))
        ?.browser_download_url ||
      valid.find((a) => a.name.endsWith('.exe'))?.browser_download_url ||
      valid.find(
        (a) => a.name.includes('win') && a.name.includes(archToken) && a.name.endsWith('.zip'),
      )?.browser_download_url
    )
  }
  if (platform === 'linux') {
    return (
      valid.find((a) => a.name.includes(archToken) && a.name.endsWith('.AppImage'))
        ?.browser_download_url ||
      valid.find(
        (a) =>
          a.name.includes(archToken) && (a.name.endsWith('.tar.gz') || a.name.endsWith('.deb')),
      )?.browser_download_url
    )
  }
  return undefined
}

function updaterStatePath() {
  return join(app.getPath('userData'), 'updater.json')
}

function loadUpdaterPreference() {
  try {
    const raw = JSON.parse(readFileSync(updaterStatePath(), 'utf8')) as {
      automaticChecks?: unknown
    }
    return Boolean(raw.automaticChecks)
  } catch {
    return false
  }
}

function saveUpdaterPreference(enabled: boolean) {
  try {
    writeFileSync(updaterStatePath(), JSON.stringify({ automaticChecks: enabled }), {
      mode: 0o600,
    })
  } catch {
    // Non-fatal if userData is read-only.
  }
}

function scheduleDailyChecks() {
  if (dailyTimer) clearInterval(dailyTimer)
  dailyTimer = undefined
  if (!automaticChecks) return
  dailyTimer = setInterval(() => {
    if (!busy && !checking) void runReleaseCheck(false)
  }, DAILY_INTERVAL_MS)
  dailyTimer.unref?.()
}

async function runReleaseCheck(interactive: boolean): Promise<UpdateStatus> {
  if (busy) {
    if (interactive) throw new Error('Finish the active Muse turn before checking for updates.')
    return updateStatus()
  }
  if (checking) return updateStatus()
  checking = true
  statusMessage = 'Checking GitHub for updates…'
  try {
    const response = await fetch(RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Muse-Desktop/${app.getVersion()}`,
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`)
    const release = (await response.json()) as {
      tag_name?: string
      html_url?: string
      assets?: ReleaseAsset[]
    }
    const latestTag = release.tag_name || ''
    if (!latestTag) throw new Error('Could not read the latest release version.')
    const latestVersion = latestTag.replace(/^v/i, '')
    if (compareVersions(app.getVersion(), latestVersion) > 0) {
      const downloadUrl =
        selectReleaseAsset(release.assets || [], process.platform, process.arch) ||
        (release.html_url?.startsWith('https://github.com/robzilla1738/muse-desktop/')
          ? release.html_url
          : RELEASES_URL)
      statusMessage = `Muse Desktop ${latestVersion} is available.`
      const { response: button } = await dialog.showMessageBox({
        type: 'info',
        title: 'Update available',
        message: `Muse Desktop ${latestVersion} is available.`,
        detail: `You are currently using version ${app.getVersion()}. Would you like to download the update from GitHub Releases?`,
        buttons: ['Download update', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (button === 0) await shell.openExternal(downloadUrl)
    } else {
      statusMessage = `Muse Desktop ${app.getVersion()} is up to date.`
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    statusMessage = `Could not check for updates: ${text}`
    if (interactive) throw new Error(statusMessage)
  } finally {
    checking = false
  }
  return updateStatus()
}

export function initializeUpdates() {
  if (!app.isPackaged) return
  if (process.platform === 'darwin') {
    try {
      const bridge = createRequire(import.meta.url)(
        join(process.resourcesPath, 'sparkle.node'),
      ) as Sparkle
      bridge.initialize()
      sparkle = bridge
    } catch (error) {
      unavailable = `The updater could not start: ${error instanceof Error ? error.message : String(error)}`
    }
    return
  }
  releaseUpdater = true
  automaticChecks = loadUpdaterPreference()
  scheduleDailyChecks()
  if (automaticChecks) {
    setTimeout(() => {
      if (!busy && !checking) void runReleaseCheck(false)
    }, 5000).unref?.()
  }
}

export function updateStatus(): UpdateStatus {
  if (sparkle) return { available: true, ...sparkle.status() }
  if (releaseUpdater) {
    return {
      available: true,
      canCheck: !busy && !checking,
      automaticChecks,
      message: statusMessage,
    }
  }
  return { available: false, canCheck: false, automaticChecks: false, message: unavailable }
}

export function checkForUpdates() {
  if (sparkle) {
    sparkle.check()
    return updateStatus()
  }
  if (releaseUpdater) return runReleaseCheck(true)
  throw new Error(unavailable)
}

export function setAutomaticUpdateChecks(enabled: boolean) {
  if (sparkle) {
    sparkle.setAutomaticChecks(enabled)
    return updateStatus()
  }
  if (releaseUpdater) {
    automaticChecks = enabled
    saveUpdaterPreference(enabled)
    scheduleDailyChecks()
    return updateStatus()
  }
  throw new Error(unavailable)
}

export function setUpdaterBusy(isBusy: boolean) {
  busy = isBusy
  sparkle?.setBusy(isBusy)
}
