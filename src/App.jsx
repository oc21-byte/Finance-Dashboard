import { useState } from 'react'
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

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      <Page onTabChange={setActiveTab} />
    </Layout>
  )
}
