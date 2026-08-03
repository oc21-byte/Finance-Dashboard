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
- Amounts: expenses negative, income positive. Bank txns carry a `type` (`income`/`expense`/`savings`). Card txns carry **no `type`** — the sign is the discriminator: negative is spending, positive is a credit and carries a `creditKind`.
- **Payments to a card are never stored.** They settle from the bank account, where they already
  appear as an expense, so importing them on the card side would double-count. `PAYMENT_RE` in
  `csvHelpers.js` drops them on every import path, and the extraction prompts are told to skip them.
- Claude key lives in `db.json` and is **never** returned. `GET/PUT /api/settings` strips it and returns `hasClaudeApiKey: boolean`.

## Models (easy to get wrong)

- `claude-haiku-4-5-20251001` — insights, categorize, all chat endpoints, budget-builder.
- `claude-sonnet-4-6` — column detection (`/api/llm/detect-columns`), row extraction
  (`/api/llm/extract-rows`), and the default for PDF Vision (`/api/parse-pdf-vision`).
- Vision's model is `settings.visionModel` (editable in Settings), so it can be pointed at a
  stronger model without a code change. `callLLM({ model })` overrides the tier outright.

## Where things live

| Area | File(s) |
|---|---|
| Tab routing / nav | `src/App.jsx`, `src/components/Layout.jsx` |
| API routes + all LLM/Yahoo calls | `server/index.js` |
| Client API surface | `src/api/client.js` |
| Import orchestration | `src/utils/importQueue.js` |
| Tabular parsing (CSV/XLSX) | `src/utils/csvHelpers.js` |
| PDF rasterize + Vision | `src/utils/pdfVision.js` |
| Import UI | `BulkImportReviewModal.jsx`, `CsvMappingModal.jsx` |
| Duplicate flagging | `src/utils/duplicates.js` |
| Failure diagnostics | `src/utils/diagnostics.js`, `ErrorBanner.jsx`, `ErrorBoundary.jsx` |
| Pages | `src/pages/{Dashboard,Finances,SpendAnalyzer,Investments,Goals,Settings}.jsx` |
| Categories + colors | `src/constants/categories.js` |

**Import pipeline:** both tabs accept **multiple files at once** (`.csv`, `.xlsx/.xlsm/.xlsb/.xls`,
`.pdf`). `runImportQueue()` processes them one at a time so one bad statement can't take down the
batch; failures land in a `skipped[]` list surfaced in the review modal. Per file,
`processStatementFile()` tries the cheapest reliable strategy first:

1. PDF → `parsePdfVision()` rasterizes to JPEG and posts **batches of 8 pages**. The statement
   period read from the first batch is threaded into later batches, since only page 1 prints it
   and later batches would otherwise guess the year wrong.
2. Citizens Bank CSV special case (bank only) → `parseCitizensBankCsv()`.
3. Saved mapping via `detectSource()` against `settings.csvSources` → `processCSVRows()`.
4. AI column detection (`/api/llm/detect-columns`) → `processCSVRows()`.
5. AI row extraction (`/api/llm/extract-rows`) — sends the raw grid as **text**, chunked, for
   multi-section or otherwise unmappable sheets. Spreadsheets are never rasterized.
6. Single-file uploads only: fall back to `CsvMappingModal` for manual mapping.

Everything lands in `BulkImportReviewModal` (per-file groups, editable source name, per-row
tick/removal, per-group "Remap" on Finances) before a single batch POST. Rows carry a `_rid` for
stable selection and a `duplicateOf` annotation; both are stripped on confirm and never persisted.

**Duplicate flagging** (`src/utils/duplicates.js`, client-side only, no endpoints). A pair matches
on amount to the cent plus agreeing descriptions (punctuation and 4+ digit reference numbers
stripped, then exact / prefix / ≥70% token overlap), and then on date:

- **same `source`** → dates must be the same day. A statement never lists one charge twice on
  different days, so a few days apart is a habitual repeat, not a duplicate.
- **different `source`** → within ±3 days, which is where a transaction-date PDF and a
  posting-date CSV of the same month disagree.

Two entry points: `annotateDuplicates(groups, existing)` pre-import (compares against stored rows
*and* earlier files in the same batch, then the modal unticks hits by default), and
`duplicateFlags(transactions)` post-import, which feeds the amber banner, the "Possible duplicates
only" chip, and the per-row badge on both tabs. Nothing is ever auto-deleted. "Not a duplicate"
persists `dupDismissed: true`; a set counts as resolved once **any** member is dismissed, so one
click clears a pair.

**Failure diagnostics:** any import error renders `ErrorBanner` with a **Copy diagnosis** button
producing a paste-ready report (context, server message + `errorId`, and a rolling trail of
recent API calls and import stages). `ApiError` from `src/api/client.js` carries the server's
message; server route errors are logged via `failure()` with a matching `errorId` and, for
JSON-parsing routes, the model's raw output. Reports never include API keys.

**Card credits** (cashback, refunds, rebates) are positive `credit_card_transactions` rows with a
`creditKind` of `cashback` / `refund` / `rebate` / `credit` (see `CREDIT_KINDS` in
`src/constants/categories.js`). The AI paths ask the model for the kind and fall back to
`classifyCreditKind(description)`; the mapping path always uses the classifier.

- **Spend Analyzer** treats them as money back, never spending: every chart, category total, top-
  merchant figure and the uncategorized count are built from **negatives only**, and credits get a
  "Credits & Refunds" card plus green `+` rows.
- **Finances** derives them **read-only** from the card ledger (never copied into `db.transactions`,
  which would leave two rows for one event). They appear as a Card Credits tile, chart series, and
  badged non-editable rows, and are kept **out** of Income and Net Cash unless
  `settings.countCardCreditsAsIncome` is on. Off by default because a credit shrinks the card bill,
  and that bill is already an expense on the bank side — counting it as income too double-counts it.
- The LLM context builders apply the same split, and say so in the prompt, so insights never report
  a refund as spending or add credits to income.

**Spend Analyzer insight memory:** the last generated insights and their follow-up chat live in
`db.json` under `spendInsights`, not in component state — switching tabs unmounts the page
(`<Page />` swaps in `App.jsx`), and a reload would lose them either way. `/api/llm/spend-insights`
writes the record (replacing any previous one, which resets the chat); `/api/llm/spend-chat`
appends the question and reply **only when the stored `period` matches the request**, so an
exchange never attaches to a set of insights that has since been replaced. Read and cleared via
`GET`/`DELETE /api/spend-insights` (`api.spendInsights`). The page reads it through
`useQuery(['spend-insights'])` and keeps only the draft input and the in-flight question local.

**Notable features:** Budget Builder (`BudgetBuilderModal` on Spend Analyzer →
`/api/llm/budget-builder`), net-worth history (Dashboard auto-snapshots on mount via
`/api/net-worth-snapshot`, charts `/api/net-worth-history`), holdings as purchase lots
(`holdings[].purchases[]` with weighted-average cost basis).

## db.json shape

```
transactions[]              bank txns: { id, date, description, amount, category, source, type }
credit_card_transactions[]  cc txns:   { id, date, description, amount, category, source }
                            positive rows also carry creditKind: cashback|refund|rebate|credit
                            both may carry dupDismissed: true ("not a duplicate", set by the user)
holdings[]                  { id, ticker, accountType, shares, purchasePrice, purchaseDate, purchases[] }
savings_accounts[]          { id, name, accountType, balance, apy }
goals[]                     { id, name, targetAmount, currentAmount, targetDate, monthlySavings }
netWorthHistory[]           { date, netWorth, breakdown:{cash,savings,portfolio} }
spendInsights               { period, insights[], messages[], generatedAt } — or null when cleared
settings                    { claudeApiKey, customCategories[], cashBalance, confirmedMonthlyIncome,
                              csvSources, visionModel, countCardCreditsAsIncome }
```

## Note

`project-plan.md` is the original design doc — it predates the current code and is partly
inaccurate (e.g. it describes pdfjs text-extraction PDF parsing, manual CSV mapping, and an
all-Haiku setup). Trust the code and this file over it.
