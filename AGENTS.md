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
- Never call `/api/shutdown` from `pagehide` / unload. Hard reload would kill Express (and often
  Vite). Shutdown is only via the explicit Close App button in `Layout.jsx`, which exits the
  Express process with `process.exit(0)` — not `process.kill(0)`.
- `POST /api/factory-reset` replaces `db.json` with a deep copy of `DEFAULT_DB` (wipes API keys
  too). Settings UI confirms first, then clears QueryClient + source-name localStorage and reloads.
- Finances bank imports write `uploadHistory` entries with `transactionIds` from the batch
  response. Spend Analyzer card imports do the same with `ledger: 'credit_card'`.
  `DELETE /api/upload-history/:id` removes those txs from the matching ledger and the history
  row. Legacy entries without IDs only clear the log.

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
| Spend Analyzer maths | `src/utils/{period,spendAggregations,recurring,spendChartModel}.js` |
| Spend Analyzer UI | `src/components/spend/*` |

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
6. Single-file uploads only: fall back to `CsvMappingModal` for manual mapping (`needsMapping` from
   `runImportQueue`). **Both tabs handle this** — Finances saves the mapped rows straight to the
   batch; Spend Analyzer routes them through `annotateDuplicates` into the review modal first.

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

## Spend Analyzer

The page is an orchestrator: queries, mutations, the import flow, the derivation chain, and layout.
All maths lives in `src/utils/`, all UI in `src/components/spend/`. Adding a chart means adding a
component there, not growing the page.

**The derivation chain.** Every number on the page hangs off these steps, in this order. This is
what lets one filter chip re-scope the whole page instead of each widget filtering for itself:

```
transactions   → periodRows   → scopedRows   → scopedSpend    KPIs + every chart
  (useQuery)      (date range)   (+ filters)    (negatives only)
                                     ├──────────→ creditSummary   Credits & Refunds
                                     └──────────→ filtered → sorted → TransactionTable
```

`duplicateFlags()` deliberately runs against **all** transactions, never `periodRows`, so a
duplicate straddling a period boundary still surfaces.

**Period model** (`src/utils/period.js`). A rolling range, not a single month:
`7D / 1M / 3M / 6M / 1Y / YTD / All`. `resolvePeriod(key, transactions)` anchors to the **latest
transaction date, not today** — anchoring to today gives a half-empty trailing month whenever the
statements lag. It returns `{ key, from, to, months[], label, monthCount }` where `months` is an
explicit `YYYY-MM` list, so a 6M view always draws 6 bars even where a month has no spend. Date
filtering is plain string comparison (`d >= from && d <= to`); that's why dates are stored
`YYYY-MM-DD`.

**Recurring detection** (`src/utils/recurring.js`). `detectRecurring(transactions, { activeTo })`
groups by `normalizeDescription` (reused from `duplicates.js` — don't write a second normalizer),
clusters by amount within each merchant (one `APPLE.COM/BILL` line hosts several plans), then fits
cadence by whole cycles so a skipped month reads as "two cycles" rather than disqualifying the
series. Min charges and amount tolerance vary per cadence on purpose: only semiannual and annual
may qualify on two charges, or a yearly renewal would need three years of statements to appear. A
series quiet for longer than 1.5× its own cadence counts as cancelled and is excluded.

**Colour is a contract** (`src/components/spend/palette.js`). A category or card owns exactly one
colour across the whole page — its donut slice, its bar segments, its row in "Where it went" or
"Cards". Nothing may assign colour per-chart, and `buildCardColors` must be called with the
**whole ledger's** sources, never the filtered set, or removing a chip would recolour the legend
you just read.

**Insight memory and scope.** The last generated insights and their follow-up chat live in
`db.json` under `spendInsights`, not in component state — switching tabs unmounts the page
(`<Page />` swaps in `App.jsx`), and a reload would lose them either way. Read and cleared via
`GET`/`DELETE /api/spend-insights` (`api.spendInsights`); the page reads it through
`useQuery(['spend-insights'])` and keeps only the draft input and the in-flight question local.

Both spend routes take `{ period, from, to, filters, periodLabel }`. **`period` is an opaque scope
key** (`buildScopeKey` → e.g. `6M|2026-02-01|2026-07-31|cat:Food & Dining`) encoding range *and*
filters; it is only ever compared for equality, never parsed. `buildSpendContextFromTransactions`
accepts either that `{from, to, filters}` object or a legacy `period` string (which keeps using
`startsWith`), so old stored records still read.

`/api/llm/spend-insights` writes the record, replacing any previous one and resetting the chat.
`/api/llm/spend-chat` answers against the **stored** scope rather than whatever is on screen, and
appends the exchange **only when the stored `period` matches the request** — so a reply never
attaches to insights that have since been re-scoped or replaced. The panel surfaces that mismatch
rather than letting stale analysis pass as current.

**Notable features:** Budget Builder (on the **Budget** tab → `/api/llm/budget-builder`),
net-worth history (Dashboard auto-snapshots on mount via
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
spendInsights               { period, periodLabel, scope, insights[], messages[], generatedAt }
                            or null when cleared. `period` is an opaque scope key (range +
                            filters), compared for equality only. `scope` is {from,to,filters}
                            for range-scoped records, null for legacy period-string ones.
uploadHistory[]             { id, filename, sourceName, transactionCount, transactionIds[],
                              ledger:'bank'|'credit_card', importedAt }
                              DELETE cascades on transactionIds into the matching ledger
                              (empty/missing IDs = history-only delete)
settings                    { claudeApiKey, customCategories[], cashBalance, confirmedMonthlyIncome,
                              csvSources, visionModel, countCardCreditsAsIncome }
```

## Note

`project-plan.md` is the original design doc — it predates the current code and is partly
inaccurate (e.g. it describes pdfjs text-extraction PDF parsing, manual CSV mapping, and an
all-Haiku setup). Trust the code and this file over it.
