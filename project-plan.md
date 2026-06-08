# Finance Dashboard — Project Plan

Local personal finance dashboard. React + Vite frontend, lightweight Express backend, all data in a single `data/db.json` file. No database, no cloud, runs entirely on localhost.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18.3.1 + Vite |
| Styling | Tailwind CSS — **light mode** |
| Charts | Recharts 2.12.7 |
| Server state | TanStack Query v5 (`useQuery` / `useMutation`) |
| CSV parsing | papaparse 5.5.3 (client-side) |
| PDF parsing | pdfjs-dist 5.7.284 (client-side) |
| Dates | dayjs 1.11.20, stored as `YYYY-MM-DD` strings |
| Backend | Express 4.19.2 (port 3001) |
| Storage | `data/db.json` (flat JSON, synchronous read/write) |
| LLM | Claude API via `@anthropic-ai/sdk` 0.95.1 — **Haiku** model (`claude-haiku-4-5-20251001`) |
| IDs | uuid 14.0.0 (server-side only) |

Dev tooling: `concurrently` (run both servers), `nodemon` (auto-restart Express).

---

## Running the app

```bash
cd ~/Desktop/finance-dashboard
npm run dev        # starts Vite (5173) + Express (3001) concurrently
```

Vite proxies `/api/*` → `http://localhost:3001` so there are no CORS issues.

---

## Architecture decisions

| Concern | Decision |
|---|---|
| Server state | TanStack Query — `useQuery`/`useMutation` everywhere, no raw `useEffect` fetches |
| External APIs | **Always through Express** — Yahoo Finance and Claude API never called from React |
| CSV parsing | papaparse in the browser; rows batch-posted to Express |
| PDF parsing | pdfjs-dist in the browser; extracted rows batch-posted to Express |
| Spend categories | Fixed enum (11 items, see below) + user-defined custom categories stored in `settings.customCategories` |
| Finance categories | Separate fixed enum: Income, Expense, Savings (bank transactions only) |
| CSV sign convention | Positive = expense; `invertAmounts: true` toggle per source |
| Forms | Plain React controlled components |
| Dates | dayjs; `YYYY-MM-DD` in storage |
| API key security | `claudeApiKey` stored in `db.json`; Express **never** returns the raw key — returns `hasClaudeApiKey: boolean` instead |
| Net worth calc | Cash balance (manual) + savings account balances + portfolio (live prices, falls back to cost basis) |

---

## Category enums

### Finance categories (bank transactions) — `src/constants/categories.js`

```js
export const FINANCE_CATEGORIES = ['Income', 'Expense', 'Savings']

export const FINANCE_CATEGORY_COLORS = {
  'Income':  '#22c55e',
  'Expense': '#f87171',
  'Savings': '#14b8a6',
}
```

### Spend categories (credit card transactions) — `src/constants/categories.js`

```js
export const CATEGORIES = [
  'Food & Dining', 'Grocery', 'Transport', 'Housing', 'Entertainment',
  'Subscription', 'Health', 'Shopping', 'Income', 'Transfer', 'Other',
]

export const CATEGORY_COLORS = {
  'Food & Dining': '#f97316',
  'Grocery':       '#84cc16',
  'Transport':     '#3b82f6',
  'Housing':       '#8b5cf6',
  'Entertainment': '#ec4899',
  'Subscription':  '#6366f1',
  'Health':        '#10b981',
  'Shopping':      '#f59e0b',
  'Income':        '#22c55e',
  'Transfer':      '#6b7280',
  'Other':         '#94a3b8',
}
```

### Custom categories

User-defined categories are stored in `db.json` under `settings.customCategories` as `[{ name, color }]`. The LLM categorize endpoint merges built-in + custom into its valid set. The `CategoryManager` component manages these.

---

## db.json schema

```json
{
  "transactions": [
    {
      "id": "uuid",
      "date": "YYYY-MM-DD",
      "description": "string",
      "amount": -45.00,
      "category": "Expense",
      "source": "TD Bank",
      "type": "expense"
    }
  ],
  "credit_card_transactions": [
    {
      "id": "uuid",
      "date": "YYYY-MM-DD",
      "description": "string",
      "amount": -45.00,
      "category": "Food & Dining",
      "source": "Capital One"
    }
  ],
  "holdings": [
    {
      "id": "uuid",
      "ticker": "AAPL",
      "shares": 10,
      "purchasePrice": 150.00,
      "purchaseDate": "YYYY-MM-DD",
      "accountType": "TFSA"
    }
  ],
  "savings_accounts": [
    {
      "id": "uuid",
      "name": "EQ Bank HYSA",
      "accountType": "HYSA",
      "balance": 5000.00,
      "apy": 3.5
    }
  ],
  "goals": [
    {
      "id": "uuid",
      "name": "Emergency Fund",
      "targetAmount": 10000,
      "targetDate": "YYYY-MM-DD",
      "currentAmount": 0,
      "monthlySavings": 500
    }
  ],
  "settings": {
    "claudeApiKey": "",
    "customCategories": [
      { "name": "Pet Care", "color": "#f472b6" }
    ],
    "cashBalance": 0,
    "csvSources": {
      "TD Bank": {
        "date": "Date",
        "description": "Description",
        "debit": "Debit",
        "credit": "Credit",
        "splitDebitCredit": true
      },
      "BMO Harris": {
        "date": "Date",
        "description": "Description",
        "amount": "Amount",
        "splitDebitCredit": false,
        "invertAmounts": true
      },
      "Capital One": {
        "date": "Transaction Date",
        "description": "Description",
        "debit": "Debit",
        "credit": "Credit",
        "splitDebitCredit": true
      },
      "Discover": {
        "date": "Trans. Date",
        "description": "Description",
        "amount": "Amount",
        "splitDebitCredit": false,
        "invertAmounts": true
      }
    }
  }
}
```

**Amount sign convention:** expenses are negative (`-45.00`), income is positive (`+3200.00`). Bank transactions always have a `type` field (`"income"` | `"expense"` | `"savings"`). Credit card transactions are always expenses — no `type` field needed.

**Holdings `accountType` valid values:** `"TFSA"` | `"RRSP"` | `"FHSA"` | `"Non-Registered"` | `"Roth IRA"` | `"Traditional IRA"` | `"401(k)"` | `"Other"`

**Savings account `accountType` valid values:** `"HYSA"` | `"Regular Savings"` | `"Money Market"` | `"CD / GIC"` | `"Other"`

**`db.json` is auto-created** on first server start via `ensureDb()` if it doesn't exist.

---

## Express API routes (`server/index.js`, port 3001)

### Transactions (bank)

| Method | Path | Description |
|---|---|---|
| GET | `/api/transactions` | list all |
| POST | `/api/transactions` | create one (server assigns uuid) |
| POST | `/api/transactions/batch` | create many from CSV/PDF import |
| PUT | `/api/transactions/:id` | update |
| DELETE | `/api/transactions/:id` | delete |

### Credit card transactions

| Method | Path | Description |
|---|---|---|
| GET | `/api/credit-card-transactions` | list all |
| POST | `/api/credit-card-transactions` | create one |
| POST | `/api/credit-card-transactions/batch` | batch import |
| PUT | `/api/credit-card-transactions/:id` | update |
| DELETE | `/api/credit-card-transactions/:id` | delete |

### Holdings

| Method | Path | Description |
|---|---|---|
| GET | `/api/holdings` | list all |
| POST | `/api/holdings` | create |
| PUT | `/api/holdings/:id` | update |
| DELETE | `/api/holdings/:id` | delete |

### Savings accounts

| Method | Path | Description |
|---|---|---|
| GET | `/api/savings-accounts` | list all |
| POST | `/api/savings-accounts` | create |
| PUT | `/api/savings-accounts/:id` | update |
| DELETE | `/api/savings-accounts/:id` | delete |

### Goals

| Method | Path | Description |
|---|---|---|
| GET | `/api/goals` | list all |
| POST | `/api/goals` | create |
| PUT | `/api/goals/:id` | update |
| DELETE | `/api/goals/:id` | delete |

### Settings

| Method | Path | Description |
|---|---|---|
| GET | `/api/settings` | returns settings; `claudeApiKey` is stripped, replaced with `hasClaudeApiKey: boolean` |
| PUT | `/api/settings` | merge-update settings (same masking on response) |

### Custom categories

| Method | Path | Description |
|---|---|---|
| GET | `/api/categories` | list `settings.customCategories` |
| POST | `/api/categories` | create `{ name, color }` — 409 if name already exists |
| DELETE | `/api/categories/:name` | delete by name (URL-encoded) |

### Prices

| Method | Path | Description |
|---|---|---|
| GET | `/api/prices?tickers=AAPL,TSLA` | Express fetches Yahoo Finance for each ticker, returns `{ AAPL: 213.45, TSLA: null }` — null if fetch fails |

Yahoo Finance URL: `https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d`  
Price extracted from: `data.chart.result[0].meta.regularMarketPrice`

### LLM endpoints (all require `claudeApiKey` in db.json)

| Method | Path | Payload | Returns |
|---|---|---|---|
| POST | `/api/llm/insights` | `{}` | `{ insights: ["...", "...", "..."] }` — 3 insights from last 90 days of bank transactions + goals |
| POST | `/api/llm/categorize` | `{ transactions: [{ id, description }] }` | `{ categories: [{ id, category }] }` — categories from built-in + custom |
| POST | `/api/llm/spend-insights` | `{ period: "YYYY-MM" \| "all" }` | `{ insights: [{ title, body }, ...] }` — 3 structured insights on CC spend |
| POST | `/api/llm/spend-chat` | `{ period, messages: [{role, content}] }` | `{ reply: "..." }` — chat over CC spend data |
| POST | `/api/llm/dashboard-chat` | `{ messages: [{role, content}] }` | `{ reply: "..." }` — chat over full financial picture |
| POST | `/api/llm/goal-analysis` | `{ goalId: "uuid" }` | `{ analysis: "..." }` — 2–3 sentence timeline + spending advice |
| POST | `/api/llm/goal-chat` | `{ goalId, messages: [{role, content}] }` | `{ reply: "..." }` — chat about a specific goal |

All LLM calls use model `claude-haiku-4-5-20251001` via `@anthropic-ai/sdk`.

---

## File structure

```
finance-dashboard/
├── data/
│   └── db.json                     flat JSON database (auto-created)
├── server/
│   └── index.js                    Express server — all API routes + LLM calls
├── src/
│   ├── api/
│   │   └── client.js               fetch wrapper — all calls go through /api/*
│   ├── constants/
│   │   └── categories.js           FINANCE_CATEGORIES + CATEGORIES + color maps
│   ├── utils/
│   │   └── csvHelpers.js           parseAmount, detectSource, processCSVRows, parsePdfToTableData
│   ├── components/
│   │   ├── Layout.jsx              top nav (5 tabs + gear) + mobile bottom nav
│   │   ├── CsvMappingModal.jsx     column mapping modal for unknown CSV sources
│   │   ├── AddTransactionModal.jsx manual transaction entry modal
│   │   └── CategoryManager.jsx    create/delete custom spend categories with color picker
│   ├── pages/
│   │   ├── Dashboard.jsx           net worth, cash flow chart, goals, LLM insights, chat
│   │   ├── Finances.jsx            bank statements, income/expense/savings charts, transactions
│   │   ├── SpendAnalyzer.jsx       CC statements, spend charts, merchants, AI insights, chat
│   │   ├── Investments.jsx         holdings table, savings accounts, live prices, gain/loss
│   │   ├── Goals.jsx               goal CRUD, progress bars, AI analysis, chat
│   │   └── Settings.jsx            Claude API key management
│   ├── App.jsx                     tab state → renders active page
│   ├── main.jsx                    QueryClientProvider (staleTime: 30s, retry: 1) wraps App
│   └── index.css                   Tailwind directives
├── index.html
├── package.json
├── vite.config.js                  proxy /api → localhost:3001
├── tailwind.config.js              scans ./index.html + ./src/**/*.{js,jsx}
└── postcss.config.js               tailwindcss + autoprefixer
```

---

## Build steps — all complete

| Step | Description | Status |
|---|---|---|
| 1 | Scaffold: Vite + React + Tailwind + Express + db.json schema + shell nav | ✅ Done |
| 2a | Finances tab: bank statement CSV/PDF upload, transaction list, income/expense/savings charts | ✅ Done |
| 2b | Spend Analyzer tab: CC statement upload, monthly spend chart, category chart, top merchants, search | ✅ Done |
| 3 | Dashboard: net worth snapshot, monthly cash flow chart, goal progress bars, LLM insights, chat | ✅ Done |
| 4 | Investments tab: manual holdings entry, live Yahoo Finance prices, gain/loss table, savings accounts | ✅ Done |
| 5 | Goals tab: create/edit/delete goals, progress bars, AI timeline analysis, chat | ✅ Done |
| 6 | LLM integration: Settings page for API key, all Claude Haiku endpoints wired, chat on 3 pages | ✅ Done |

---

## Page details

### Layout (`src/components/Layout.jsx`)

- Top nav: "FinanceDash" brand + tab buttons (hidden on mobile) + gear icon → Settings
- Tabs: Dashboard, Finances, Spend Analyzer, Investments, Goals
- Mobile bottom nav: 5 icon buttons (Home, Finances, Spend, Invest, Goals) — shown only on small screens

### Dashboard (`src/pages/Dashboard.jsx`)

**Data fetched:** `['transactions']`, `['goals']`, `['holdings']`, `['savings-accounts']`, `['settings']`, `['prices', tickers]`

**Sections:**
1. **Stat cards** — Net Worth (cash + savings + portfolio), Cash Balance (editable inline via `PUT /api/settings` with `{ cashBalance }`), Portfolio Value
2. **Net worth donut chart** — breakdown by Cash, Savings, and each investment account type (TFSA, RRSP, etc.) using Recharts `PieChart`
3. **Cash flow bar chart** — last 6 months, income vs expenses from bank transactions, Recharts `BarChart`
4. **Goal progress bars** — each goal: name, progress bar (`currentAmount / targetAmount`), remaining amount
5. **AI insights panel** — 3 numbered insight cards from `POST /api/llm/insights`; shows prompt to configure API key if not set
6. **Dashboard chat** — conversation history in component state; messages sent to `POST /api/llm/dashboard-chat`

**Net worth formula:** `cashBalance + sum(savings_accounts[].balance) + sum(holdings[].shares * currentPrice)`, falling back to `purchasePrice` when live price unavailable.

### Finances (`src/pages/Finances.jsx`)

**Data fetched:** `['transactions']`, `['settings']`

**Sections:**
1. **Import** — file upload (CSV or PDF); auto-detects source from `settings.csvSources`; unknown source opens `CsvMappingModal`; parsed rows → `POST /api/transactions/batch`; if API key present, optionally calls `POST /api/llm/categorize` on import
2. **Monthly stacked bar chart** — last 6 months, stacked Income / Savings / Expense using `FINANCE_CATEGORY_COLORS`
3. **Transaction table** — filterable by month; inline category edit (dropdown); delete per row; "Add transaction" button opens `AddTransactionModal`

**CSV mapping fields:** `date`, `description`, `debit`+`credit` (split) or `amount` (single), optional `category`; `splitDebitCredit: boolean`, `invertAmounts: boolean`, `statementType: "bank" | "credit_card"`

### Spend Analyzer (`src/pages/SpendAnalyzer.jsx`)

**Data fetched:** `['credit_card_transactions']`, `['categories']`, `['settings']`

**Sections:**
1. **Import** — CSV or PDF; detects CC source; `processCSVRows` with `statementType: 'credit_card'` filters out credits/payments → `POST /api/credit-card-transactions/batch`; AI categorize on import if key configured
2. **Monthly spend chart** — last 6 months, stacked by source (card issuer), single red bars
3. **Spending by category chart** — horizontal `BarChart`, filtered by selected period
4. **Top merchants** — top 10 by total spend with proportional progress bars, filtered by period
5. **Transaction table** — search by description, filter by month, inline category edit, delete per row
6. **AI insights** — period selector (specific month or all-time) → `POST /api/llm/spend-insights`; returns `[{ title, body }]` × 3 cards
7. **Spend chat** — conversation per period; `POST /api/llm/spend-chat` with full message history
8. **Category manager** — `CategoryManager` component; add custom category (name + hex color picker); delete custom; shows built-in list read-only

**Period filter** applies to category chart, top merchants, AI insights, and chat — not to the monthly trend chart (always shows last 6 months).

### Investments (`src/pages/Investments.jsx`)

**Data fetched:** `['holdings']`, `['savings-accounts']`, `['prices', tickers]` (staleTime: 60s)

**Holdings section:**
- Add form: ticker, shares, purchase price, purchase date, account type (dropdown)
- Table columns: Ticker, Account Type, Shares, Purchase Price, Current Price (live), Cost Basis, Current Value, Gain/Loss $, Gain/Loss %
- Gains colored green, losses red
- Portfolio totals row: sum of cost basis, current value, total gain, total gain %
- Warning banner if Yahoo Finance returns null for any ticker

**Savings accounts section:**
- Add form: name, account type, balance, APY %
- Table: Name, Type, Balance, APY
- Edit / Delete per row

### Goals (`src/pages/Goals.jsx`)

**Data fetched:** `['goals']`, `['settings']`

**Sections:**
1. **Create goal form** — name, target amount, target date, optional monthly savings rate
2. **Goals list** — for each goal:
   - Progress bar: `currentAmount / targetAmount` (color: green ≥80%, yellow ≥40%, gray <40%)
   - "Add Funds" button → inline amount input → `PUT /api/goals/:id` with incremented `currentAmount`
   - Estimated timeline: `Math.ceil((targetAmount - currentAmount) / monthlySavings)` months shown as "~N months to go"
   - Edit: inline form for name, target, date, savings rate
   - Delete: removes goal
3. **AI analysis** — per-goal button → `POST /api/llm/goal-analysis` with `{ goalId }` → 2–3 sentence analysis card
4. **Goal chat** — per-goal chat; `POST /api/llm/goal-chat` with `{ goalId, messages }`; conversation history in component state

### Settings (`src/pages/Settings.jsx`)

**Data fetched:** `['settings']`

- Password input for Claude API key (`sk-ant-...`)
- Shows "Configured ✓" badge when `settings.hasClaudeApiKey === true`
- "Replace key" link to re-enable input when key already set
- Save → `PUT /api/settings` with `{ claudeApiKey }` → server stores raw key, returns masked response
- Toast on save

---

## Helper utilities (`src/utils/csvHelpers.js`)

| Function | Purpose |
|---|---|
| `parseAmount(str)` | Parses dollar strings: handles commas, parentheses for negatives, `CR` notation |
| `detectSource(headers, csvSources, typeFilter)` | Matches CSV column headers against saved mappings to auto-identify source; `typeFilter` is `'bank'` or `'credit_card'` |
| `processCSVRows(rows, mapping)` | Transforms raw CSV rows → transaction objects; handles split debit/credit or single amount; detects income vs expense vs savings sections in TD-style statements; validates dates; applies `invertAmounts` |
| `parsePdfToTableData(file)` | Uses `pdfjs-dist` to extract table rows from PDF statements; detects statement period (date range) from PDF text; handles multi-page PDFs; resolves year-boundary edge cases (Jan–Mar transactions in prior-December statement) |

---

## `src/api/client.js` — API client

All React data access goes through this object. Never call `/api/*` directly from components.

```js
api.transactions.{list, create, batch, update, remove}
api.creditCardTransactions.{list, create, batch, update, remove}
api.holdings.{list, create, update, remove}
api.savingsAccounts.{list, create, update, remove}
api.goals.{list, create, update, remove}
api.prices.get(tickersArray)
api.settings.{get, update}
api.categories.{list, create, remove}
api.llm.{insights, categorize, spendInsights, spendChat, dashboardChat, goalAnalysis, goalChat}
```

---

## Key conventions

- All API calls from React go through `src/api/client.js` which calls `/api/*` only
- All external calls (Yahoo Finance, Claude) are made inside `server/index.js`
- Use `useQuery` / `useMutation` from TanStack Query — no raw `useEffect` for data fetching
- After any mutation, call `queryClient.invalidateQueries({ queryKey: ['...'] })`
- Bank transaction amounts: expenses negative, income positive; `type` always stored (`"income"` | `"expense"` | `"savings"`)
- CC transactions: always negative amounts; no `type` field
- Dates: always `YYYY-MM-DD` strings; use `dayjs` for display/math
- IDs: always assigned server-side via `uuidv4()` — never sent from client
- No new npm packages without good reason — prefer what's already installed
