import { useState } from 'react'
import {
  ArrowUpRight,
  FolderOpen,
  Leaf,
  MessageSquare,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  Palette,
  Smile,
} from 'lucide-react'
import type { MuseSession, Theme } from '../../../shared/protocol'
import { Dialog, sessionTitle } from './Primitives'

export function CommandMenu({
  sessions,
  onSession,
  onNew,
  onOpen,
  onSettings,
  onTheme,
  onClose,
}: {
  sessions: MuseSession[]
  onSession: (id: string) => void
  onNew: () => void
  onOpen: () => void
  onSettings: () => void
  onTheme: (theme: Theme) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const commands = [
    {
      id: 'new',
      title: 'New conversation',
      subtitle: 'Start a conversation',
      icon: Plus,
      shortcut: '⌘ N',
      action: onNew,
    },
    {
      id: 'open',
      title: 'Open project',
      subtitle: 'Choose a folder on your Mac',
      icon: FolderOpen,
      shortcut: '⌘ O',
      action: onOpen,
    },
    {
      id: 'settings',
      title: 'Open settings',
      subtitle: 'Appearance and Muse Code connection',
      icon: Settings2,
      shortcut: '⌘ ,',
      action: onSettings,
    },
    {
      id: 'muse',
      title: 'Switch to Muse',
      subtitle: 'Electric blue',
      icon: Palette,
      shortcut: '',
      action: () => onTheme('muse'),
    },
    {
      id: 'daylight',
      title: 'Switch to Daylight',
      subtitle: 'Warm and light',
      icon: Sun,
      shortcut: '',
      action: () => onTheme('daylight'),
    },
    {
      id: 'moonlight',
      title: 'Switch to Moonlight',
      subtitle: 'Soft and dark',
      icon: Moon,
      shortcut: '',
      action: () => onTheme('moonlight'),
    },
    {
      id: 'grove',
      title: 'Switch to Grove',
      subtitle: 'Natural green',
      icon: Leaf,
      shortcut: '',
      action: () => onTheme('grove'),
    },
    {
      id: 'plush',
      title: 'Switch to Plush',
      subtitle: 'Blue mascot close-up',
      icon: Smile,
      shortcut: '',
      action: () => onTheme('plush'),
    },
    ...sessions.map((session) => ({
      id: session.sessionId,
      title: sessionTitle(session),
      subtitle: session.workspaceRoot?.split('/').at(-1) || 'Conversation',
      icon: MessageSquare,
      shortcut: '',
      action: () => onSession(session.sessionId),
    })),
  ]
    .filter((entry) =>
      `${entry.title} ${entry.subtitle}`.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 30)
  const invoke = (index: number) => {
    const command = commands[index]
    if (command) {
      onClose()
      command.action()
    }
  }
  return (
    <Dialog title="Search" onClose={onClose} className="command-dialog">
      <div className="command-search">
        <Search size={19} />
        <input
          autoFocus
          value={query}
          aria-label="Search commands and conversations"
          placeholder="Search commands and conversations…"
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSelected((value) => Math.min(value + 1, commands.length - 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSelected((value) => Math.max(0, value - 1))
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              invoke(selected)
            }
          }}
        />
      </div>
      <div className="command-results">
        {commands.map((command, i) => (
          <button
            key={command.id}
            className={i === selected ? 'selected' : ''}
            onClick={() => invoke(i)}
            onMouseEnter={() => setSelected(i)}
          >
            <command.icon size={17} />
            <span>
              <strong>{command.title}</strong>
              <small>{command.subtitle}</small>
            </span>
            {command.shortcut ? <kbd>{command.shortcut}</kbd> : <ArrowUpRight size={14} />}
          </button>
        ))}
        {!commands.length && (
          <div className="command-empty">No matches. Try a project or conversation name.</div>
        )}
      </div>
      <footer>
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Navigate
        </span>
        <span>
          <kbd>↵</kbd> Open
        </span>
        <span>
          <kbd>esc</kbd> Close
        </span>
      </footer>
    </Dialog>
  )
}
