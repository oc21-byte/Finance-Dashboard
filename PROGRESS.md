# Finance Dashboard — Progress

Last updated: 2026-08-05

This file tracks active implementation work. Durable rules belong in `AGENTS.md`; the original
product concept remains in `project-plan.md`, which is partly outdated.

## Finances parity and insight overhaul

Finances now follows the Spend Analyzer architecture while keeping the bank and card ledgers
semantically separate.

### Implemented

- Central bank-flow predicates in `src/constants/financeRules.js`; bank types remain only income or
  expense, while Savings and Investments are allocation categories.
- Shared period/filter controls and opaque scope keys across both tabs, with golden scope-key tests.
- Finances derivation chain: period rows, scoped rows, KPIs, chart, allocation/payee breakdowns, and
  a filtered transaction table.
- A finance component directory and utility modules, including the shared-scale in/out chart.
- Allocation destinations linked to savings accounts or holding account-type labels, including an
  explicit `Unassigned` residual.
- Bank payee normalization for reference blobs, issuer-qualified card payments, and Venmo names.
- Shared table primitives (`useTablePaging`, pager, sortable headers, and confirmation control)
  while retaining ledger-specific table components.
- Read-only card credits on Finances, governed by `countCardCreditsAsIncome`.
- A deterministic finance analysis/generation/chat triad stored separately from Spend insights.
- Shared model-output validation and chat-to-generation binding for both insight triads.
- Finance insight API/client wiring and deterministic tests.
- The docked Financial Pace rail on Finances, leading with the achieved savings rate against a
  target tick.
- A shared pinned scope bar (`src/components/shared/PinnedScopeBar.jsx`) driving the condensed bar on
  both tabs, with each tab supplying only its own row of headline numbers.

### Important implementation decisions

- `expenses + saved + invested` reconciles total outflow without double-counting; `netCash` does not
  subtract Savings or Investments.
- Finance destinations are keyed by destination kind and name. `Unassigned` is never hidden.
- The diverging chart uses one `pxPerDollar` scale. Its baseline is derived from maximum income and
  outflow, then clamped only when both directions contain data.
- The chart's `worst` month is computed for insight use but not annotated. Months without activity
  do not qualify; ties choose the earliest month.
- Finance observation selection is deterministic. The model writes only the body of each selected
  observation and an unexpected catalogue key fails generation.
- Finance chat accepts only bank-side scope vocabulary and cannot route card metrics into bank
  filters.
- Card credits appear under All types and under Income only when the income setting is enabled, so
  the table agrees with the KPIs.

### Files involved

- Server: `server/index.js`, both insight triads, `server/chatBinding.js`, `server/modelText.js`
- Client: `src/api/client.js`, `src/pages/Finances.jsx`, `src/pages/Dashboard.jsx`
- Finance: `src/components/finance/*`, `src/utils/financeAggregations.js`,
  `src/utils/financeChartModel.js`, `src/constants/financeRules.js`
- Shared UI/scope: `src/components/shared/*`, `src/utils/period.js`
- Supporting Spend changes: shared-component imports, paging behavior, duplicate handling, and
  shared financial-pace exports
- Tests: finance aggregation/chart/analysis/generation/chat tests and `test/period.test.js`

## Verification

Verified on 2026-08-05:

- `npm test` — 90 passed, 0 failed.
- `npm run build` — passed. Vite reports its existing large-chunk warning for the main and XLSX
  bundles; this is a performance follow-up, not a build failure.
- Finance insight generation and follow-up chat run live against a real key.

Record failures here rather than weakening golden values or architecture rules to make tests pass.

Still unexercised with a live key: PDF Vision import (`parsePdfVision`) and the two AI import
fallbacks, `/api/llm/detect-columns` and `/api/llm/extract-rows`.

## Deferred direction

Bank payee grouping is based on statement descriptions and is intentionally isolated in
`payeeOf()`. Real bank subcategories are the eventual stronger model; until then, avoid broadening
the shared duplicate normalizer because that can merge distinct charges.
