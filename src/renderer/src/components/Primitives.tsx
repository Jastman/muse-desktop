import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { promptPreview } from '../message-text'

export function IconButton({
  label,
  children,
  onClick,
  active,
  disabled,
  className = '',
}: {
  label: string
  children: ReactNode
  onClick: () => void
  active?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function Dialog({
  title,
  children,
  onClose,
  className = '',
}: {
  title: string
  children: ReactNode
  onClose: () => void
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    return () => ref.current?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-label={title}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose()
        }
      }}
    >
      <header className="dialog-heading">
        <h2>{title}</h2>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      {children}
    </dialog>
  )
}

export function MuseMark({ size = 26 }: { size?: number }) {
  return (
    <img
      className="muse-mark"
      src="./muse-logo.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  )
}

export function projectName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path
}
export function cleanPromptText(value?: string) {
  return promptPreview(value)
}
export function sessionTitle(session: { name?: string; title?: string; firstUserPrompt?: string }) {
  const raw =
    cleanPromptText(session.name) ||
    cleanPromptText(session.title) ||
    cleanPromptText(session.firstUserPrompt)
  if (!raw) return 'Untitled conversation'
  return raw.length > 76 ? `${raw.slice(0, 76).trimEnd()}…` : raw
}
export function friendlyTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const minutes = (Date.now() - date.getTime()) / 60000
  if (minutes < 1) return 'Now'
  if (minutes < 60) return `${Math.floor(minutes)}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
