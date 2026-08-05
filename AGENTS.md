# Finance Dashboard — Agent Guide

Local-only personal finance dashboard: React + Vite (`:5173`), Express (`:3001`), and a flat
`data/db.json`. Vite proxies `/api/*` to Express. `data/db.json` is git-ignored, auto-created by
`ensureDb()`, and backfilled when top-level keys are missing.

```bash
npm run dev      # frontend + backend
npm test         # deterministic unit/integration tests
npm run build    # production frontend build
```

`project-plan.md` is the original, partly outdated design. Trust the code and this guide for current
behavior. See `PROGRESS.md` for current work and verification status.

## Non-negotiable architecture

- React data access goes through `src/api/client.js` and `/api/*`; do not fetch API routes directly
  in components. The sole existing exception is `parsePdfVision` in `csvHelpers.js`.
- Yahoo Finance and AI-provider calls happen only in `server/index.js`. Never expose credentials to
  the browser.
- Use TanStack Query for server state. Do not fetch in `useEffect`; invalidate affected query keys
  after mutations.
- Store dates as `YYYY-MM-DD` and use `dayjs`. The server assigns IDs with `uuidv4`.
- Expenses/outflows are negative; income/credits are positive.
- Card rows have no `type`. Positive card rows carry `creditKind` (`cashback`, `refund`, `rebate`,
  or `credit`).
- Bank `type` is only `income` or `expense`. Savings and Investments are categories on expense
  rows, not types. Use the predicates in `src/constants/financeRules.js`; never rederive them.
- Savings and Investments are allocation, not spending. `expenses + saved + invested` is total
  money out; `netCash` is income minus expenses and does not subtract allocation.
- Never store card payments in the card ledger. `PAYMENT_RE` and extraction prompts remove them;
  the bank-side settlement already records the expense.
- API keys remain in `db.json`. Settings endpoints return only `hasClaudeApiKey` and
  `hasOpenaiApiKey` flags.
- Never call `/api/shutdown` on unload. Only the Close App action in `Layout.jsx` may shut down
  Express, using `process.exit(0)`.
- Factory reset deep-copies `DEFAULT_DB`, including wiping keys. The UI clears QueryClient and
  source-name local storage before reload.
- Upload-history records include imported transaction IDs and a `bank` or `credit_card` ledger.
  Deleting a history record cascades only through those IDs; legacy records without IDs remove only
  the log entry.

## AI models

- Fast: `claude-haiku-4-5-20251001` or `gpt-4o-mini` for insights, categorization, chat, and Budget
  Builder.
- Smart/vision: `claude-sonnet-4-6` or `gpt-4o` for column detection, row extraction, and PDF
  Vision.
- PDF Vision uses editable `settings.visionModel`; `callLLM({ model })` overrides the tier.

## Code map

| Area | Files |
|---|---|
| Routing/navigation | `src/App.jsx`, `src/components/Layout.jsx` |
| API routes, external calls | `server/index.js` |
| Client API | `src/api/client.js` |
| Import orchestration | `src/utils/importQueue.js` |
| CSV/XLSX and PDF parsing | `src/utils/csvHelpers.js`, `src/utils/pdfVision.js` |
| Import UI | `BulkImportReviewModal.jsx`, `CsvMappingModal.jsx` |
| Duplicate handling | `src/utils/duplicates.js` |
| Diagnostics | `src/utils/diagnostics.js`, `ErrorBanner.jsx`, `ErrorBoundary.jsx` |
| Pages | `src/pages/*` |
| Categories and bank-flow rules | `src/constants/categories.js`, `src/constants/financeRules.js` |
| Shared period/scope model | `src/utils/period.js` |
| Finances math/UI | `src/utils/finance*.js`, `src/components/finance/*` |
| Spend math/UI | `src/utils/spend*.js`, `src/utils/recurring.js`, `src/components/spend/*` |
| Shared UI | `src/components/shared/*` |
| Spend insight triad | `server/spend{Analysis,InsightGeneration,Chat}.js` |
| Finance insight triad | `server/finance{Analysis,InsightGeneration,Chat}.js` |
| Shared insight safeguards | `server/chatBinding.js`, `server/modelText.js` |
| Tests | `test/*.test.js` |

Pages orchestrate queries, mutations, import flow, and derivation chains. Put visual math in
`src/utils`, deterministic insight math in `server/*Analysis.js`, and new UI in the relevant
component directory rather than growing a page.

## Import and duplicate contracts

Both ledgers accept multiple CSV, Excel, and PDF files. `runImportQueue()` handles files one at a
time and reports failures in `skipped[]`. `processStatementFile()` tries, in order:

1. PDF Vision in eight-page batches, carrying the first batch's statement period forward.
2. Citizens Bank CSV parsing (bank only).
3. A saved source mapping.
4. AI column detection.
5. AI text-grid row extraction; spreadsheets are never rasterized.
6. Manual mapping for a single file.

All successful groups reach `BulkImportReviewModal` before one batch POST. `_rid` and `duplicateOf`
are review-only fields and must be stripped before persistence.

Duplicate matching uses amount, normalized description, and date. Same-source rows must share a
date; different sources may differ by three days. `annotateDuplicates()` flags imports and
`duplicateFlags()` audits stored rows. Never auto-delete. A dismissed member resolves its set.
Run stored-ledger duplicate detection before period filtering so boundary-spanning pairs remain
visible. Exposure counts only extra copies (`N - 1`).

## Periods, scopes, and filters

- Both tabs use `src/utils/period.js`. Periods are `7D`, `1M`, `3M`, `6M`, `1Y`, `YTD`, and `All`,
  anchored to the latest transaction date rather than today.
- `resolvePeriod()` returns an explicit month list so empty months still render.
- `FILTER_ORDER` and `FILTER_PREFIX` are append-only. `buildScopeKey()` values are persisted and
  compared as opaque strings. Do not reorder, rename, or parse them. Golden locks live in
  `test/period.test.js`.
- Card filter kinds are categories/cards/merchants; bank kinds are accounts/flows/payees.
- A filter chip must rescope the whole page, including KPIs, charts, breakdowns, and table.
- Duplicate review clears period, type, filters, and search so matches cannot be hidden.

## Finance and spend behavior

- Card credits remain only in `credit_card_transactions`. Finances derives read-only credit rows
  from that ledger. They count as income only when `settings.countCardCreditsAsIncome` is enabled.
- `buildDestinations()` groups allocation by destination kind plus name. Always render `Unassigned`;
  destination totals must equal saved plus invested.
- `payeeOf()` owns bank counterparty cleanup. Keep masked-reference, card-payment, and Venmo rules
  there; do not loosen the shared duplicate normalizer.
- The Finances in/out chart uses one dollars-to-pixels scale for both directions. Income is green,
  expense red, and net dark. Only in/out bars are filterable.
- Spend charts use the stable palette in `src/components/spend/palette.js`. Build card colors from
  the whole ledger so filtering never recolors a card.
- Recurring detection reuses `normalizeDescription`, clusters similar amounts, fits skipped cadence
  as whole cycles, and excludes series stale by more than 1.5 times their cadence.
- Finance and Spend transaction tables remain separate. Share only generic behavior through
  `useTablePaging`, `ConfirmDeleteButton`, `TablePager`, and `SortTh`.
- Both tabs pin a condensed scope bar through `shared/PinnedScopeBar.jsx`, which owns the sentinel,
  the fixed positioning, and `PINNED_BAR_H`. Keep the bar `fixed` and its height constant; a sticky
  or self-measuring bar thrashes against its own sentinel. Tabs supply only the row content —
  `spend/ScopeHeader.jsx` and `finance/FinanceScopeBar.jsx` — rendered right after their KPI row.
- Both tabs dock their insights in a sticky `<aside>` inside an
  `xl:grid-cols-[minmax(0,1fr)_320px]` grid, capped to the viewport and scrollable only where it is
  sticky. Both offset `top` by the demo banner plus `PINNED_BAR_H`.

## Insight contracts

- Deterministic analysis owns totals, facts, classifications, rankings, statuses, and selections.
  Models write prose only or classify a validated chat intent.
- Finance reuses `buildFinancialPace` and `fullMonthsWithData` from `spendAnalysis.js`; do not fork
  that logic.
- Spend Style uses the latest six calendar months of unfiltered card activity. Financial Pace uses
  up to six complete bank months. Exploration uses the active range and filters.
- Spend and finance insight records are independent. Refreshing one must not invalidate the other.
- Finance scope matching is bank-only (`accounts`, `flows`, `payees`); do not use card-side scope
  helpers for it.
- Insight routes accept `{ period, from, to, filters, periodLabel }`. The stored `period` is the
  opaque scope key. Chat binds replies to the same `period`, `generatedAt`, and `analysisVersion`
  through the shared `createChatBinding()` helper.
- Generation replaces the prior record and resets chat. Surface stale scope instead of showing it
  as current.
- Finance observations come from the fixed catalogue in `financeAnalysis.js`; the model may supply
  bodies only for the selected keys, and any unexpected key rejects the response.
- `pace.savingsRate` is the **target** rate from settings, not an achievement. The achieved savings
  rate is `savingsContributions / income` and is the only one that may be shown as a headline;
  label both wherever they appear together.
- Insight panels are presentational. Chat state (`chatInput`, `chatLoading`, `pendingQuestion`,
  errors) lives in the page, and follow-ups post against the stored record's `period`, never the
  on-screen scope.

## Stored data

```text
transactions[]              bank rows; optional allocation destination link
credit_card_transactions[]  card rows; positive rows include creditKind
holdings[]                  purchase lots with weighted-average cost basis
savings_accounts[]
goals[]
netWorthHistory[]
financeInsights             current finance generation + chat, or null
spendInsights               v2 current generation + chat; v1 remains readable, or null
uploadHistory[]             filename, source, ledger, transactionIds, importedAt
settings                    provider flags/config, budgets, mappings, vision model, credit policy
```

Allocation links are `linkedSavingsAccountId` for Savings and the account-type label in
`linkedHoldingAccountType` for Investments. Missing or dangling links resolve to `Unassigned`.
