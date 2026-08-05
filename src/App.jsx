import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api/client.js'
import { logEvent, setContext } from './utils/diagnostics.js'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Layout from './components/Layout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Finances from './pages/Finances.jsx'
import SpendAnalyzer from './pages/SpendAnalyzer.jsx'
import Budget from './pages/Budget.jsx'
import Investments from './pages/Investments.jsx'
import Goals from './pages/Goals.jsx'
import Settings from './pages/Settings.jsx'

const PAGES = {
  dashboard: Dashboard,
  finances: Finances,
  'spend-analyzer': SpendAnalyzer,
  budget: Budget,
  investments: Investments,
  goals: Goals,
  settings: Settings,
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  // What one tab asked the next one to open on — currently only the Dashboard waterfall handing
  // Finances a date window to inspect. Kept here rather than in a store because it is a one-shot
  // message, not state: it is cleared the moment the user navigates anywhere else, so a tab never
  // reopens on a window the user has moved on from.
  const [handoff, setHandoff] = useState(null)
  const Page = PAGES[activeTab]

  function navigate(tab, payload = null) {
    setHandoff(payload)
    setActiveTab(tab)
  }

  const { data: demoStatus } = useQuery({
    queryKey: ['demo-mode'],
    queryFn: api.demoMode.get,
    staleTime: Infinity,
  })
  const demoMode = demoStatus?.demoMode ?? false

  // Shares the cache with every page's settings query; used only to stamp failure reports.
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })

  useEffect(() => {
    setContext({ tab: activeTab })
    logEvent('nav', `opened ${activeTab}`)
  }, [activeTab])

  useEffect(() => {
    if (!settings) return
    setContext({
      aiProvider: `${settings.aiProvider ?? 'claude'} (key configured: ${settings.aiProvider === 'openai' ? settings.hasOpenaiApiKey : settings.hasClaudeApiKey})`,
    })
  }, [settings])

  return (
    <Layout activeTab={activeTab} onTabChange={navigate} demoMode={demoMode}>
      <ErrorBoundary key={activeTab}>
        <Page onTabChange={navigate} demoMode={demoMode} handoff={handoff} />
      </ErrorBoundary>
    </Layout>
  )
}
