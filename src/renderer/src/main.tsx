import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }
  render() {
    if (this.state.error)
      return (
        <div className="fatal-error">
          <img src="./icon.png" alt="Muse" />
          <h1>The workspace needs to reload.</h1>
          <p>
            The interface hit an unexpected problem. Your Muse conversations are still saved by the
            CLI.
          </p>
          <pre>{this.state.error}</pre>
          <button className="button primary" onClick={() => location.reload()}>
            Reopen the workspace
          </button>
        </div>
      )
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
