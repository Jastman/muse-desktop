import { Fragment, useEffect, useState } from 'react'
import {
  ArrowUpRight,
  ChevronsDown,
  FileSearch,
  TextSearch,
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
import { Dialog, projectName, sessionTitle } from './Primitives'

const SESSION_PAGE = 50
type Command = {
  id: string
  group: string
  title: string
  subtitle: string
  icon: typeof Search
  shortcut: string
  action: () => void
  keepOpen?: boolean
}

export function CommandMenu({
  platform = 'darwin',
  sessions,
  onSession,
  onNew,
  onOpen,
  onSettings,
  onTheme,
  onClose,
  onSearchHistory,
  onFind,
  hasMoreSessions = false,
  onLoadMoreSessions,
}: {
  platform?: string
  sessions: MuseSession[]
  onSession: (id: string) => void
  onNew: () => void
  onOpen: () => void
  onSettings: () => void
  onTheme: (theme: Theme) => void
  onClose: () => void
  onSearchHistory: (query: string) => void
  onFind?: () => void
  hasMoreSessions?: boolean
  onLoadMoreSessions?: () => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [visibleSessions, setVisibleSessions] = useState(SESSION_PAGE)
  const modKey = platform === 'darwin' ? '⌘' : 'Ctrl'
  const needle = query.trim().toLowerCase()
  const matches = (title: string, subtitle: string) =>
    `${title} ${subtitle}`.toLowerCase().includes(needle)
  const matchingSessions = sessions.filter((session) =>
    matches(
      sessionTitle(session),
      session.workspaceRoot ? projectName(session.workspaceRoot) : 'Conversation',
    ),
  )
  const hiddenSessions = Math.max(0, matchingSessions.length - visibleSessions)
  const commands: Command[] = [
    ...(needle
      ? [
          {
            id: 'search-history',
            group: 'Search',
            title: `Search messages for “${query.trim()}”`,
            subtitle: 'Full-text search across indexed conversation history',
            icon: TextSearch,
            shortcut: `${modKey} ⇧ F`,
            action: () => onSearchHistory(query.trim()),
            keepOpen: false,
          },
        ]
      : []),
    {
      id: 'new',
      group: 'Actions',
      title: 'New conversation',
      subtitle: 'Start a conversation',
      icon: Plus,
      shortcut: `${modKey} N`,
      action: onNew,
    },
    {
      id: 'open',
      group: 'Actions',
      title: 'Open project',
      subtitle: platform === 'darwin' ? 'Choose a folder on your Mac' : 'Choose a project folder',
      icon: FolderOpen,
      shortcut: `${modKey} O`,
      action: onOpen,
    },
    {
      id: 'settings',
      group: 'Actions',
      title: 'Open settings',
      subtitle: 'Appearance and Muse Code connection',
      icon: Settings2,
      shortcut: `${modKey} ,`,
      action: onSettings,
    },
    {
      id: 'history-search',
      group: 'Actions',
      title: 'Search message history',
      subtitle: 'Find text inside past conversations',
      icon: TextSearch,
      shortcut: `${modKey} ⇧ F`,
      action: () => onSearchHistory(''),
    },
    ...(onFind
      ? [
          {
            id: 'find',
            group: 'Actions',
            title: 'Find in conversation',
            subtitle: 'Search the open conversation',
            icon: FileSearch,
            shortcut: `${modKey} F`,
            action: onFind,
          },
        ]
      : []),
    ...matchingSessions.slice(0, visibleSessions).map((session) => ({
      id: session.sessionId,
      group: 'Conversations',
      title: sessionTitle(session),
      subtitle: session.workspaceRoot ? projectName(session.workspaceRoot) : 'Conversation',
      icon: MessageSquare,
      shortcut: '',
      action: () => onSession(session.sessionId),
    })),
    ...(hiddenSessions
      ? [
          {
            id: 'more-sessions',
            group: 'Conversations',
            title: `Show ${Math.min(SESSION_PAGE, hiddenSessions)} more of ${hiddenSessions} matching conversations`,
            subtitle: 'Titles and project names',
            icon: ChevronsDown,
            shortcut: '',
            action: () => setVisibleSessions((count) => count + SESSION_PAGE),
            keepOpen: true,
          },
        ]
      : hasMoreSessions && onLoadMoreSessions
        ? [
            {
              id: 'older-sessions',
              group: 'Conversations',
              title: 'Load older conversations',
              subtitle: 'Fetch the next page from Muse Code',
              icon: ChevronsDown,
              shortcut: '',
              action: onLoadMoreSessions,
              keepOpen: true,
            },
          ]
        : []),
    {
      id: 'muse',
      group: 'Themes',
      title: 'Switch to Muse',
      subtitle: 'Electric blue',
      icon: Palette,
      shortcut: '',
      action: () => onTheme('muse'),
    },
    {
      id: 'daylight',
      group: 'Themes',
      title: 'Switch to Daylight',
      subtitle: 'Warm and light',
      icon: Sun,
      shortcut: '',
      action: () => onTheme('daylight'),
    },
    {
      id: 'moonlight',
      group: 'Themes',
      title: 'Switch to Moonlight',
      subtitle: 'Soft and dark',
      icon: Moon,
      shortcut: '',
      action: () => onTheme('moonlight'),
    },
    {
      id: 'grove',
      group: 'Themes',
      title: 'Switch to Grove',
      subtitle: 'Natural green',
      icon: Leaf,
      shortcut: '',
      action: () => onTheme('grove'),
    },
    {
      id: 'plush',
      group: 'Themes',
      title: 'Switch to Plush',
      subtitle: 'Blue mascot close-up',
      icon: Smile,
      shortcut: '',
      action: () => onTheme('plush'),
    },
  ].filter(
    (entry) =>
      entry.group === 'Conversations' ||
      entry.group === 'Search' ||
      matches(entry.title, entry.subtitle),
  )
  useEffect(() => {
    const active = commands[selected]
    if (active) {
      document.getElementById(`cmd-item-${active.id}`)?.scrollIntoView({ block: 'nearest' })
    }
  }, [selected, commands])
  const invoke = (index: number) => {
    const command = commands[index]
    if (!command) return
    if (!command.keepOpen) onClose()
    command.action()
  }
  return (
    <Dialog title="Search" onClose={onClose} className="command-dialog">
      <div className="command-search">
        <Search size={19} />
        <input
          autoFocus
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-autocomplete="list"
          aria-activedescendant={
            commands[selected] ? `cmd-item-${commands[selected].id}` : undefined
          }
          aria-label="Search commands and conversations"
          placeholder="Search commands and conversation titles…"
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
            setVisibleSessions(SESSION_PAGE)
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
            if (event.key === 'Home' && event.ctrlKey) setSelected(0)
            if (event.key === 'End' && event.ctrlKey) setSelected(commands.length - 1)
            if (event.key === 'Enter') {
              event.preventDefault()
              invoke(selected)
            }
          }}
        />
      </div>
      <div className="command-results" id="command-results" role="listbox" aria-label="Results">
        {commands.map((command, i) => (
          <Fragment key={command.id}>
            {(i === 0 || commands[i - 1].group !== command.group) && (
              <div className="command-group-heading" role="presentation">
                {command.group}
              </div>
            )}
            <button
              id={`cmd-item-${command.id}`}
              role="option"
              aria-selected={i === selected}
              tabIndex={-1}
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
          </Fragment>
        ))}
        {!commands.length && (
          <div className="command-empty" role="status">
            No matches. Try a project or conversation name.
          </div>
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
