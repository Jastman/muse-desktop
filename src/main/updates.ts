import { app } from 'electron'
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

let sparkle: Sparkle | undefined
let unavailable =
  'Updates are available in the packaged Mac app. Development builds use your local source.'

export function initializeUpdates() {
  if (!app.isPackaged || process.platform !== 'darwin') return
  try {
    const bridge = createRequire(import.meta.url)(
      join(process.resourcesPath, 'sparkle.node'),
    ) as Sparkle
    bridge.initialize()
    sparkle = bridge
  } catch (error) {
    unavailable = `The updater could not start: ${error instanceof Error ? error.message : String(error)}`
  }
}

export function updateStatus(): UpdateStatus {
  if (!sparkle)
    return { available: false, canCheck: false, automaticChecks: false, message: unavailable }
  return { available: true, ...sparkle.status() }
}

export function checkForUpdates() {
  if (!sparkle) throw new Error(unavailable)
  sparkle.check()
  return updateStatus()
}

export function setAutomaticUpdateChecks(enabled: boolean) {
  if (!sparkle) throw new Error(unavailable)
  sparkle.setAutomaticChecks(enabled)
  return updateStatus()
}

export function setUpdaterBusy(busy: boolean) {
  sparkle?.setBusy(busy)
}
