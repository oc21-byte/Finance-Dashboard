import { Component } from 'react'
import { buildReport, friendlyMessage, logEvent } from '../utils/diagnostics.js'
import ErrorBanner from './ErrorBanner.jsx'

// Turns a render crash into the same copyable banner used for import failures, so a blank
// screen still produces something pasteable.
export default class ErrorBoundary extends Component {
  state = { error: null, report: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    logEvent('render', friendlyMessage(error))
    this.setState({
      report: buildReport(error, { stage: 'render', componentStack: info?.componentStack }),
    })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="p-6">
        <ErrorBanner
          message={`This page failed to render: ${friendlyMessage(this.state.error)}`}
          report={this.state.report}
          onDismiss={() => this.setState({ error: null, report: null })}
        />
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Reload app
        </button>
      </div>
    )
  }
}
