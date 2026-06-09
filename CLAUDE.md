# Finance Dashboard — Working Guide

Local personal finance dashboard. React + Vite frontend (port 5173), Express backend (port
3001), all data in a flat `data/db.json` file. No database, no cloud — runs entirely on
localhost. Vite proxies `/api/*` → `:3001` (no CORS concerns).

```bash
npm run dev      # Vite + Express together (concurrently)
npm run build    # vite build → dist/
```

`data/db.json` is git-ignored and auto-created on first server start (`ensureDb()`), which also
backfills any missing top-level keys.

## Architecture rules (don't break these)

- **All** React data access goes through `src/api/client.js` (the `api` object) → `/api/*`. Never `fetch('/api/...')` directly from a component (one exception: `parsePdfVision` in `csvHelpers.js`).
- **All** external calls (Yahoo Finance prices, Claude API) happen **only** in `server/index.js`. The browser never holds the Claude key or hits a third party.
- Server state via TanStack Query (`useQuery`/`useMutation`) — no `useEffect` fetching. After a mutation, `invalidateQueries` the affected key.
- Dates are `YYYY-MM-DD` strings; use `dayjs`. IDs are assigned server-side (`uuidv4`) — never send one from the client.
- Amounts: expenses negative, income positive. Bank txns carry a `type` (`income`/`expense`/`savings`); credit-card txns are always negative, no `type`.
- Claude key lives in `db.json` and is **never** returned. `GET/PUT /api/settings` strips it and returns `hasClaudeApiKey: boolean`.

## Models (easy to get wrong)

- `claude-haiku-4-5-20251001` — insights, categorize, all chat endpoints, budget-builder.
- `claude-sonnet-4-6` — PDF Vision extraction (`/api/parse-pdf-vision`) and CSV column detection (`/api/llm/detect-columns`).

## Where things live

| Area | File(s) |
|---|---|
| Tab routing / nav | `src/App.jsx`, `src/components/Layout.jsx` |
| API routes + all LLM/Yahoo calls | `server/index.js` |
| Client API surface | `src/api/client.js` |
| Import pipeline | `src/utils/csvHelpers.js` (+ `CsvMappingModal.jsx`, `VisionReviewModal.jsx`) |
| Pages | `src/pages/{Dashboard,Finances,SpendAnalyzer,Investments,Goals,Settings}.jsx` |
| Categories + colors | `src/constants/categories.js` |

**Import pipeline:** CSV → `detectSource()` matches saved `settings.csvSources`; unknown
sources get AI-mapped via `/api/llm/detect-columns`, confirmed in `CsvMappingModal`, then
`processCSVRows()` → batch POST. PDF → `parsePdfVision()` rasterizes pages to JPEG, sends to
`/api/parse-pdf-vision` (Claude Vision), and rows are reviewed in `VisionReviewModal` before
import. `Finances` also has a Citizens Bank special-case CSV parser.

**Notable features:** Budget Builder (`BudgetBuilderModal` on Spend Analyzer →
`/api/llm/budget-builder`), net-worth history (Dashboard auto-snapshots on mount via
`/api/net-worth-snapshot`, charts `/api/net-worth-history`), holdings as purchase lots
(`holdings[].purchases[]` with weighted-average cost basis).

## db.json shape

```
transactions[]              bank txns: { id, date, description, amount, category, source, type }
credit_card_transactions[]  cc txns:   { id, date, description, amount, category, source }
holdings[]                  { id, ticker, accountType, shares, purchasePrice, purchaseDate, purchases[] }
savings_accounts[]          { id, name, accountType, balance, apy }
goals[]                     { id, name, targetAmount, currentAmount, targetDate, monthlySavings }
netWorthHistory[]           { date, netWorth, breakdown:{cash,savings,portfolio} }
settings                    { claudeApiKey, customCategories[], cashBalance, confirmedMonthlyIncome, csvSources }
```

## Note

`project-plan.md` is the original design doc — it predates the current code and is partly
inaccurate (e.g. it describes pdfjs text-extraction PDF parsing, manual CSV mapping, and an
all-Haiku setup). Trust the code and this file over it.
