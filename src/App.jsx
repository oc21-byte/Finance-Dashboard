import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api/client.js'
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
  const Page = PAGES[activeTab]

  const { data: demoStatus } = useQuery({
    queryKey: ['demo-mode'],
    queryFn: api.demoMode.get,
    staleTime: Infinity,
  })
  const demoMode = demoStatus?.demoMode ?? false

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab} demoMode={demoMode}>
      <Page onTabChange={setActiveTab} demoMode={demoMode} />
    </Layout>
  )
}
