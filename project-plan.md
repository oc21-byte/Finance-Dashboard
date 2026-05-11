# Finance Dashboard — Project Plan

Local personal finance dashboard. React + Vite frontend, lightweight Express backend, all data in a single `data/db.json` file. No database, no cloud, runs entirely on localhost.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite (port 5173) |
| Styling | Tailwind CSS — **light mode** |
| Charts | Recharts |
| Server state | TanStack Query v5 (`useQuery` / `useMutation`) |
| CSV parsing | papaparse (client-side) |
| Dates | dayjs, stored as `YYYY-MM-DD` strings |
| Backend | Express (port 3001) |
| Storage | `data/db.json` (flat JSON, synchronous read/write) |
| LLM | Claude API via Anthropic SDK — **Haiku** model |

---

## Running the app

```bash
cd ~/Desktop/finance-dashboard
npm run dev        # starts Vite (5173) + Express (3001) concurrently
```

Vite proxies `/api/*` → `http://localhost:3001` so there are no CORS issues.

---

## Architecture decisions (locked in)

| Concern | Decision |
|---|---|
| Server state | TanStack Query — `useQuery`/`useMutation` everywhere, no raw `useEffect` fetches |
| External APIs | **Always through Express** — Yahoo Finance and Claude API never called from React |
| CSV parsing | papaparse in the browser; rows batch-posted to Express |
| Categories | Fixed enum (see below); free-form falls to "Other" |
| CSV sign convention | Positive = expense; `invertAmounts: true` toggle per source |
| Forms | Plain React controlled components |
| Dates | dayjs; `YYYY-MM-DD` in storage |

---

## Category enum

Lives in `src/constants/categories.js`:

```
Food & Dining, Transport, Housing, Entertainment,
Health, Shopping, Income, Transfer, Other
```

Each category has a matching color in `CATEGORY_COLORS`.

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
      "category": "Food & Dining",
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
      "source": "Capital One",
      "type": "expense"
    }
  ],
  "holdings": [
    {
      "id": "uuid",
      "ticker": "AAPL",
      "shares": 10,
      "purchasePrice": 150.00,
      "purchaseDate": "YYYY-MM-DD"
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

**Amount sign convention:** expenses are negative (`-45.00`), income is positive (`+3200.00`). `transaction.type` is always stored (`"income"` or `"expense"`), never computed on the fly.

---

## Express API routes (`server/index.js`, port 3001)

| Method | Path | Description |
|---|---|---|
| GET | `/api/transactions` | list all |
| POST | `/api/transactions` | create one (server assigns uuid) |
| POST | `/api/transactions/batch` | create many from CSV import |
| PUT | `/api/transactions/:id` | update |
| DELETE | `/api/transactions/:id` | delete |
| GET | `/api/holdings` | list all |
| POST | `/api/holdings` | create |
| PUT | `/api/holdings/:id` | update |
| DELETE | `/api/holdings/:id` | delete |
| GET | `/api/goals` | list all |
| POST | `/api/goals` | create |
| PUT | `/api/goals/:id` | update |
| DELETE | `/api/goals/:id` | delete |
| GET | `/api/settings` | get settings object |
| PUT | `/api/settings` | merge-update settings |
| GET | `/api/credit-card-transactions` | list all CC transactions |
| POST | `/api/credit-card-transactions` | create one CC transaction |
| POST | `/api/credit-card-transactions/batch` | batch import from CC CSV/PDF |
| PUT | `/api/credit-card-transactions/:id` | update CC transaction |
| DELETE | `/api/credit-card-transactions/:id` | delete CC transaction |
| GET | `/api/prices?tickers=AAPL,TSLA` | **(Step 4)** Express fetches Yahoo Finance, returns `{ AAPL: 213.45, ... }` |
| POST | `/api/llm/insights` | **(Step 6)** Express calls Claude Haiku, returns 3 insights |
| POST | `/api/llm/goal-analysis` | **(Step 6)** Express calls Claude Haiku for goal timeline |

---

## File structure

```
finance-dashboard/
├── data/
│   └── db.json
├── server/
│   └── index.js              Express server
├── src/
│   ├── api/
│   │   └── client.js         fetch wrapper — only calls /api/*
│   ├── constants/
│   │   └── categories.js     CATEGORIES array + CATEGORY_COLORS map
│   ├── utils/
│   │   └── csvHelpers.js     parseAmount, detectSource, processCSVRows, parsePdfToTableData
│   ├── components/
│   │   ├── Layout.jsx         top nav (5 tabs + gear icon)
│   │   ├── CsvMappingModal.jsx  column mapping modal
│   │   └── AddTransactionModal.jsx
│   ├── pages/
│   │   ├── Dashboard.jsx      (Step 3)
│   │   ├── Finances.jsx       ✅ complete — bank statements, income + expenses
│   │   ├── SpendAnalyzer.jsx  ✅ complete — CC statements, spending analytics
│   │   ├── Investments.jsx    (Step 4)
│   │   ├── Goals.jsx          (Step 5)
│   │   └── Settings.jsx       (Step 6)
│   ├── App.jsx               tab state → renders active page
│   ├── main.jsx              QueryClientProvider wraps App
│   └── index.css             Tailwind directives
├── index.html
├── package.json
├── vite.config.js            proxy /api → localhost:3001
├── tailwind.config.js
└── postcss.config.js
```

---

## Build steps — status

| Step | Description | Status |
|---|---|---|
| 1 | Scaffold: Vite + React + Tailwind + Express + db.json schema + shell nav | ✅ Done |
| 2a | Finances tab (was Expenses): bank statement CSV/PDF upload, transaction list, income vs expense charts | ✅ Done |
| 2b | Spend Analyzer tab: CC statement upload, monthly spend chart, category chart, top merchants, search | ✅ Done |
| 3 | Dashboard: net worth snapshot, monthly cash flow chart, goal progress bars, LLM insights placeholder | 🔲 Next |
| 4 | Investments tab: manual holdings entry, Yahoo Finance price fetch (via Express), gain/loss per holding | 🔲 |
| 5 | Goals tab: create goal, progress bar, LLM-estimated timeline | 🔲 |
| 6 | LLM integration: Settings page for API key, Claude Haiku insights on Dashboard, goal analysis on Goals | 🔲 |

---

## Step 2b — Spend Analyzer

`src/pages/SpendAnalyzer.jsx` — reads/writes `credit_card_transactions` collection (separate from bank `transactions`).

**Data flow:** Upload CC CSV/PDF → `detectSource(headers, csvSources, 'credit_card')` → `processCSVRows` → `POST /api/credit-card-transactions/batch`.

**Sections:**
1. **Monthly spend chart** — last 6 months, total CC spend per month (`BarChart`, single red bar)
2. **Spending by category** — horizontal `BarChart`, same styling as Finances
3. **Top merchants** — top 10 by total spend, with proportional progress bars
4. **Transaction list + search** — search by description, delete per row

**Period filter** at top of page filters both category chart and top merchants (not the monthly trend chart, which always shows last 6 months).

**Key difference from Finances:** CC transactions are all expenses (`processCSVRows` filters out credits/payments for `statementType: 'credit_card'`). No income concept in this tab.

**Query key:** `['credit_card_transactions']` — completely independent from `['transactions']`.

---

## Step 3 — Dashboard (next)

Build the Dashboard tab at `src/pages/Dashboard.jsx`.

**Sections:**
1. **Net worth snapshot** — sum of all positive transactions minus sum of all expenses (or manual entry); show as a hero number
2. **Monthly net cash flow chart** — bar or line chart, last 6 months, `income - |expenses|` per month. Use the same `buildMonthlyData` pattern from Expenses.jsx.
3. **Goal progress bars** — for each goal in `db.json`, show name, `currentAmount / targetAmount` progress bar, and target date
4. **LLM insights panel** — 3 insight cards. In Step 3 these are stubbed ("Connect your Claude API key in Settings to enable insights"). Wired up for real in Step 6.

**Data sources:** `useQuery(['transactions'])` (bank transactions only), `useQuery(['goals'])`. The Dashboard uses bank transactions for cash flow — CC transactions live in `['credit_card_transactions']` and are not used here.

**Charts:** Recharts `BarChart` or `LineChart` for cash flow. Same styling conventions as Expenses charts (gray grid, no axis lines, rounded bars).

---

## Step 4 — Investments

Build `src/pages/Investments.jsx`.

**Features:**
- Manual entry form: ticker, shares, purchase price, purchase date
- On page load, call `GET /api/prices?tickers=AAPL,TSLA,...` (comma-separated list of all held tickers)
- Express fetches `https://query1.finance.yahoo.com/v8/finance/chart/{ticker}` for each ticker and returns `{ [ticker]: currentPrice }` — **never called from React directly**
- Table shows: ticker, shares, purchase price, current price, gain/loss $, gain/loss %, total value
- Color gains green, losses red
- Total portfolio value shown as summary at top

---

## Step 5 — Goals

Build `src/pages/Goals.jsx`.

**Features:**
- Create goal: name, target amount, target date, optional monthly savings amount
- Each goal shows a progress bar (`currentAmount / targetAmount`)
- "Add funds" button to increment `currentAmount`
- LLM timeline estimate card (stubbed in Step 5, wired in Step 6): "At $X/month, you'll reach your goal in ~N months"
- Delete goal

---

## Step 6 — LLM integration

**Settings page** (`src/pages/Settings.jsx`):
- Text input for Claude API key, saved to `settings.claudeApiKey` via `PUT /api/settings`
- Key is stored in `db.json`, never sent to the frontend after save (show masked)

**Dashboard insights** (`POST /api/llm/insights`):
- Express builds a JSON payload: last 30 days of transactions (grouped by category) + goal summaries
- Sends to Claude Haiku with a prompt asking for 3 short insights (spending patterns, goal progress, anomalies)
- Returns `{ insights: ["...", "...", "..."] }`
- Dashboard renders these in 3 cards

**Goal analysis** (`POST /api/llm/goal-analysis`):
- Payload: goal name, target amount, current amount, monthly savings, target date
- Claude Haiku returns estimated timeline and top 2 expense categories to cut
- Shown below each goal's progress bar

**Model:** `claude-haiku-4-5-20251001`
**SDK:** `@anthropic-ai/sdk` installed in Step 6, used only in `server/index.js`

---

## Key conventions to follow in new context

- All API calls from React go through `src/api/client.js` which calls `/api/*` only
- All external calls (Yahoo Finance, Claude) are made inside `server/index.js`
- Use `useQuery` / `useMutation` from TanStack Query — no raw `useEffect` for data fetching
- After any mutation, call `queryClient.invalidateQueries({ queryKey: ['...'] })`
- Amounts: expenses negative, income positive; `type` field always stored
- Dates: always `YYYY-MM-DD` strings, use `dayjs` for display/math
- No new npm packages without good reason — prefer what's already installed
