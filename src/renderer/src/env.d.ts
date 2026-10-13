import type { DesktopAPI } from '../../shared/protocol'
declare global {
  interface Window {
    muse: DesktopAPI
  }
}
