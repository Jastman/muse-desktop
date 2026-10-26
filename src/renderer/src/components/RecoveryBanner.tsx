import { useState } from 'react'
import type { PreferencesRecovery, PreferencesRecoveryAction } from '../../../shared/protocol'

const titles: Record<PreferencesRecovery['kind'], string> = {
  malformed: 'Preferences need attention',
  'invalid-fields': 'Some preferences were reset',
  unreadable: 'Preferences could not be opened',
  'newer-version': 'Preferences from a newer version',
}

/** Explicit, user-confirmed recovery for desktop preferences. Never touches CLI data. */
export function PreferencesRecoveryBanner({
  recovery,
  onAction,
}: {
  recovery: PreferencesRecovery
  onAction: (action: PreferencesRecoveryAction) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const run = (action: PreferencesRecoveryAction) => {
    setBusy(true)
    void onAction(action).finally(() => {
      setBusy(false)
      setConfirmReset(false)
    })
  }
  return (
    <section className="recovery-banner" role="alert" aria-labelledby="recovery-title">
      <div>
        <strong id="recovery-title">{titles[recovery.kind]}</strong>
        <p>{recovery.message}</p>
        {recovery.backupPath && (
          <p className="recovery-detail">Original copied to: {recovery.backupPath}</p>
        )}
        <p className="recovery-detail">
          Until you choose, changes you make apply to this session only and are not saved.
        </p>
      </div>
      {confirmReset ? (
        <div className="recovery-actions">
          <span>
            Reset replaces the preferences file with defaults. Pinned and archived conversations,
            trusted projects and appearance choices in Muse Desktop will be forgotten.
          </span>
          <button type="button" disabled={busy} onClick={() => run('reset')}>
            Reset preferences
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirmReset(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="recovery-actions">
          {recovery.canRestoreBackup && (
            <button type="button" disabled={busy} onClick={() => run('restore-backup')}>
              Restore last good backup
            </button>
          )}
          {(recovery.kind === 'invalid-fields' || recovery.kind === 'malformed') && (
            <button type="button" disabled={busy} onClick={() => run('keep-recovered')}>
              Save current settings
            </button>
          )}
          {recovery.kind === 'unreadable' && (
            <button type="button" disabled={busy} onClick={() => run('retry')}>
              Try again
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => setConfirmReset(true)}>
            Reset to defaults…
          </button>
        </div>
      )}
    </section>
  )
}
