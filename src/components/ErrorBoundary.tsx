import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface State {
  failed: boolean
}

/**
 * Last-resort rendering guard (R1 / TT-08): an unexpected render failure
 * shows a recoverable screen instead of a blank body. It is NOT a substitute
 * for safe parsing upstream, and it never displays or logs error text —
 * messages can carry private record content.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    console.error('Render failure:', error.name)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="page" role="alert" style={{ padding: 24 }}>
        <h1 style={{ fontSize: 22 }}>Something went wrong showing this screen</h1>
        <p>Your timetable and records are untouched. Reloading returns to Today.</p>
        <div className="btn-row">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              window.location.hash = '#/today'
              window.location.reload()
            }}
          >
            Reload to Today
          </button>
        </div>
      </div>
    )
  }
}
