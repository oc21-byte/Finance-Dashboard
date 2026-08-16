# Finance Dashboard — Agent Guide

Local-only personal finance dashboard: React + Vite (`:5173`), Express (`:3001`), flat `data/db.json`.
Vite proxies `/api/*` to Express. `data/db.json` is git-ignored, auto-created by `ensureDb()`, and
backfilled when top-level keys are missing.

```bash
npm run dev      # frontend + backend
npm test         # deterministic unit/integration tests
npm run build    # production frontend build
```

This guide and the code are the source of truth. Two git-ignored working notes sit alongside it and
are **not** in a fresh clone: `PROGRESS.md` (work state, verification, and the design failures these
rules encode) and `project-plan.md` (original, partly outdated concept). Never move a rule into them.

## Non-negotiable architecture

**Boundaries**

- React data access goes through `src/api/client.js` and `/api/*`. Never fetch API routes directly in
  components; the sole exception is `parsePdfVision` in `csvHelpers.js`.
- Yahoo Finance and AI-provider calls happen only in `server/index.js`. Keys stay in `db.json`;
  settings endpoints return only `hasClaudeApiKey` / `hasOpenaiApiKey` flags.
- Use TanStack Query for server state. Never fetch in `useEffect`; invalidate affected keys after
  mutations.
- Never call `/api/shutdown` on unload. Only Close App in `Layout.jsx` stops Express, via
  `process.exit(0)`.

**Ledger semantics**

- Dates are `YYYY-MM-DD` via `dayjs`. The server assigns IDs with `uuidv4`.
- Expenses/outflows negative, income/credits positive.
- Card rows have no `type`. Positive card rows carry `creditKind` (`cashback`, `refund`, `rebate`,
  `credit`).
- Bank `type` is only `income` or `expense`. Savings and Investments are categories on expense rows,
  not types. Use the predicates in `src/constants/financeRules.js`; never rederive them.
- Savings and Investments are allocation, not spending: `expenses + saved + invested` is total money
  out, and `netCash` is income minus expenses only.
- Never store card payments in the card ledger — the bank-side settlement already records the expense.
  `PAYMENT_RE` and the extraction prompts strip them.

**Data lifecycle**

- Factory reset deep-copies `DEFAULT_DB`, wiping keys. The UI clears QueryClient and source-name local
  storage before reload.
- Upload-history records carry a `bank`, `credit_card`, or `investment` ledger. The two transaction
  ledgers store `transactionIds`; an investment record stores `target` (`holdings` | `savings`) and
  `recordIds` — purchase-lot ids, or the savings accounts that import created. Deleting one cascades
  only through its own ids; legacy records without ids remove only the log entry.

## AI models

- Fast (`claude-haiku-4-5-20251001` / `gpt-4o-mini`): insights, categorization, chat, Budget Builder.
- Smart (`claude-sonnet-4-6` / `gpt-4o`): column detection, row extraction.
- Vision defaults to the same pair but is editable per provider: `settings.visionModel` for Claude,
  `settings.openaiVisionModel` for OpenAI. Two keys, not one — the ids are not interchangeable, so a
  shared field would hand Anthropic a `gpt-` id the moment the provider changed.
- `callLLM({ model })` overrides the tier outright.
- `GET /api/models` lists what the current provider will actually serve, for the Settings dropdown.
  Keys stay server-side; the response is cached ~10 min per provider and dropped when a key is
  saved. No key, an unreachable provider or a rejected key all return `source: 'fallback'` with a
  short built-in list — never an empty list, and never an error. Filtering and labelling live in the
  pure `src/utils/modelCatalog.js`, so the dropdown can never offer a model the API would reject.

## Code map

| Area | Files |
|---|---|
| Routing/navigation | `src/App.jsx`, `src/components/Layout.jsx` |
| API routes, external calls | `server/index.js` |
| Client API | `src/api/client.js` |
| Import orchestration and parsing | `src/utils/importQueue.js`, `csvHelpers.js`, `pdfVision.js` |
| Import UI and duplicates | `BulkImportReviewModal.jsx`, `CsvMappingModal.jsx`, `src/utils/duplicates.js` |
| Diagnostics | `src/utils/diagnostics.js`, `ErrorBanner.jsx`, `ErrorBoundary.jsx` |
| Pages | `src/pages/*` |
| Categories and bank-flow rules | `src/constants/categories.js`, `financeRules.js` |
| Shared period/scope model, shared UI | `src/utils/period.js`, `src/components/shared/*` |
| Finances math/UI | `src/utils/finance*.js`, `src/components/finance/*` |
| Spend math/UI | `src/utils/spend*.js`, `recurring.js`, `src/components/spend/*` |
| Card rewards catalog | `src/constants/cardCatalog.js`, `src/utils/rewardsModel.js` |
| Dashboard math/UI | `src/utils/liquidNetWorth.js`, `{waterfall,netWorthChart}Model.js`, `src/components/dashboard/*` |
| Liquid-net-worth history | `server/netWorthHistory.js` |
| Budget math/UI | `src/utils/budgetModel.js`, `src/components/budget/*` |
| Investments math/UI | `src/utils/investmentsModel.js`, `statementReconcile.js`, `src/components/investments/*` |
| Goals math/UI | `src/utils/goalsModel.js`, `src/components/goals/*` |
| Settings UI, model catalog | `src/pages/Settings.jsx`, `src/components/settings/*`, `src/utils/modelCatalog.js` |
| Insight triads (one per tab) | `server/{spend,finance,dashboard,budget}{Analysis,InsightGeneration,Chat}.js` |
| Shared insight safeguards | `server/chatBinding.js`, `server/modelText.js` |
| Tests | `test/*.test.js` |

Pages orchestrate queries, mutations, import flow, and derivation chains. Visual math goes in
`src/utils`, deterministic insight math in `server/*Analysis.js`, new UI in a component directory —
not into a page.

**No tab uses a chart library.** Every chart is hand-built SVG or divs, geometry in a `*Model.js` under
`src/utils` (`financeChartModel.js`, `waterfallModel.js`, `netWorthChartModel.js`), only positioning in
the component. Reintroducing one would make a chart on one tab read as a different product from the
chart above it.

## Import and duplicate contracts

Both ledgers accept multiple CSV, Excel, and PDF files. `runImportQueue()` handles one file at a time
and reports failures in `skipped[]`. `processStatementFile()` tries, in order:

1. PDF Vision in eight-page batches, carrying the first batch's statement period forward.
2. Citizens Bank CSV parsing (bank only).
3. A saved source mapping.
4. AI column detection.
5. AI text-grid row extraction; spreadsheets are never rasterized.
6. Manual mapping for a single file.

All successful groups reach `BulkImportReviewModal` before one batch POST. `_rid` and `duplicateOf` are
review-only — strip them before persistence.

**A source name is never inherited from a previous import.** Both statement pages once fell back to
`localStorage` when the extractor returned no name, so a Savor statement imported after a Discover
one silently relabelled 69 transactions: the field looked answered, the name was plausible, and
nothing on screen said where it came from. A name now comes from the file or from nobody —
`BulkImportReviewModal` already refuses to confirm a group without one, and an empty field is
styled as needing an answer.

The vision pass returns `account`, the account identity printed on the page ("DISCOVER IT CARD
ENDING IN 6957"), carried across page-batches exactly like `statementPeriod`. It is **evidence,
shown verbatim in the review modal beside the name field**, never a name: the app calls a card
whatever the user calls it, and adopting the printed string would mint a new source on every
import. `matchSourceName` in `src/utils/sourceNaming.js` is the only thing allowed to turn it into
a suggestion, and it matches on the PRODUCT word — the last significant word of an existing source
name. Matching on every word fails real statements (issuers print "Savor Credit Card", not "Capital
One Savor"); matching on any word puts a Capital One *Venture* statement onto your Capital One
*Savor*. Two qualifying names returns null, because ambiguity is what caused the original bug. It
lives in its own dependency-free module because `importQueue.js` imports pdfjs and cannot be loaded
by `node --test`.

Duplicate matching uses amount, normalized description, and date; same-source rows must share a date,
different sources may differ by three days. `annotateDuplicates()` flags imports, `duplicateFlags()`
audits stored rows. Never auto-delete; a dismissed member resolves its set. Run stored-ledger detection
before period filtering so boundary-spanning pairs stay visible. Exposure counts only extra copies
(`N - 1`).

## Periods, scopes, and filters

- All four AI tabs use `src/utils/period.js`. Periods `7D`/`1M`/`3M`/`6M`/`1Y`/`YTD`/`All` anchor to
  the latest transaction date, not today. `resolvePeriod()` returns an explicit month list so empty
  months still render.
- Budget is the exception on controls: it has no period chips and no filters, because a plan is a
  monthly statement of intent rather than something you slice by date. Its window is whatever
  `buildMonthlyFinancials` averaged over, and its scope key is `buildScopeKey({ key: 'Budget',
  from: fin.windowFrom, to: fin.windowTo }, {})`.
- `FILTER_ORDER` and `FILTER_PREFIX` are append-only. `buildScopeKey()` values are persisted and
  compared as opaque strings — never reorder, rename, or parse them. Golden locks in
  `test/period.test.js`.
- Card filter kinds are categories/cards/merchants; bank kinds are accounts/flows/payees.
- A filter chip rescopes the whole page: KPIs, charts, breakdowns, table.
- Duplicate review clears period, type, filters, and search so matches cannot be hidden.

## Finance and spend behavior

- Card credits live only in `credit_card_transactions`. Finances derives read-only credit rows from
  that ledger; they count as income only under `settings.countCardCreditsAsIncome`.
- `buildDestinations()` groups allocation by destination kind plus name. Always render `Unassigned`;
  destination totals must equal saved plus invested.
- `payeeOf()` owns bank counterparty cleanup — masked-reference, card-payment, and Venmo rules stay
  there. Do not loosen the shared duplicate normalizer.
- The in/out chart uses one dollars-to-pixels scale for both directions. Income green, expense red, net
  dark. Only in/out bars are filterable.
- Spend charts use the stable palette in `src/components/spend/palette.js`. Build card colors from the
  whole ledger so filtering never recolors a card.
- Recurring detection reuses `normalizeDescription`, clusters similar amounts, fits skipped cadence as
  whole cycles, and drops series stale by more than 1.5× their cadence.
- Finance and Spend transaction tables stay separate. Share only generic behavior via `useTablePaging`,
  `ConfirmDeleteButton`, `TablePager`, `SortTh`.

**Shared layout.** Finances and Spend pin a condensed scope bar through `shared/PinnedScopeBar.jsx`,
which owns the sentinel, the fixed positioning, and `PINNED_BAR_H`; keep it `fixed` with constant
height, and supply only row content (`spend/ScopeHeader.jsx`, `finance/FinanceScopeBar.jsx`) after the
KPI row. All four AI tabs dock insights in a sticky `<aside>` inside an
`xl:grid-cols-[minmax(0,1fr)_320px]` grid with `items-start`, capped to the viewport and scrollable
only where sticky. Finances and Spend offset `top` by the demo banner plus `PINNED_BAR_H`; the
Dashboard and Budget have no pinned bar and offset by the banner alone.

**Card rewards catalog.** `CARD_CATALOG` in `src/constants/cardCatalog.js` is the only source of
issuer earn rates. `rewardsModel.js` scores them; rates do not live in components. A card's `id` is
persisted in `settings.cardRewards.wallet` and `.overrides` — rename the display name freely, never
the id. Add a card by copying an entry in that array (`fee`, `base`, `rates` keyed on app
`CATEGORIES`, `verified: 'YYYY-MM'`). User corrections belong in `overrides` so a catalog update
cannot clobber them.

**A card is still `t.source`.** The rewards work adds no card entity: `settings.cardRewards.wallet`
maps a source name to a catalog card, and the source name stays the free-text persistence contract
that `cardOf()`, `buildCardColors()`, the card filter chips and `csvSources` all key on. Never
rename or merge a source to make it match a catalog card.

A wallet entry has three link states, and collapsing any two is a bug. `catalog` is scored;
`unlisted` is a rewards card with no rates, counted in `coverage.scorable` but never scored, so the
earned total cannot silently understate itself; `none` is not a rewards card and leaves the view
entirely. A **missing** entry is a fourth thing — a question nobody has answered — which is why
clearing a link deletes the key rather than storing an empty value. `linkKindOf`, `walletEntryFor`
and `pickerValueFor` in `rewardsModel.js` own that shape; a bare `catalogId` still means `catalog`.

Linking happens in three places through one `CardPicker`: the Rewards wallet setup, the import
review modal (`wallet` prop, card ledger only — the picker is optional there and its value is held
until confirm, because the source name beside it is still being edited), and Add Transaction
(`sources` prop, card ledger only, where the card is required — a card row with no card can never
be attributed, coloured or scored). Both props are absent on Finances, which keeps its old
behaviour. There is **no vision autodetect of the card product**; the extraction prompt returns
transactions only, deliberately.

The rewards grid has exactly two editable kinds of cell, and both write a whole wallet entry
through `withSlot` / `withoutSlotFor` / `withQuarter` — pure transforms in `rewardsModel.js`, never
inline object spreads in a component. A chooser slot **moves** rather than duplicating (two slots on
one category does not pay their sum; the lower simply earns nothing), and clearing a rotating
quarter **deletes** the key, because an unrecorded quarter is an open question that scores at base,
not an answer meaning zero. A published rate is never editable here; correcting one is Phase 5's
separate, deliberate act, and a cell already carrying a correction offers no dropdown at all.

Three things live beside the wallet under `settings.cardRewards`, and all three exist to keep user
data out of `cardCatalog.js` so that file stays shipped-and-replaceable. `overrides` are corrected
rates, keyed by card id and applied last in `resolveCard`, so a catalog update can never clobber
one. `custom` holds user-authored cards under **`custom:`-prefixed ids** — the prefix is what makes
collision with a shipped id impossible however the catalog grows — resolved ahead of the catalog by
`cardById`, which every reader must use instead of `catalogCard` or a custom card silently reads as
stale. `region` is the browser's country filter, where `undefined` means "never chosen" and `null`
means "show everything".

`auditByCategory` is the only thing on the page reading real per-row attribution rather than
modelling. **Which card was best is a per-MONTH answer**, resolved alongside the earnings it is
compared against. Resolving it once at the window's last quarter — as it first did — makes a
multi-quarter window contradict itself: a rotating bonus covers Shopping in Q1 and Q2 but not Q3,
so judging the whole window against Q3 reports a tie (every bar solid, nothing misplaced) beside a
`leftBehind` total that correctly counted Q1 and Q2. A slice therefore carries `onBestSpend` /
`offBestSpend` rather than a boolean, and one card can legitimately be both. `bestVaries` gates the
"reach for X" line, because "Discover it pays 5% on Transport" is true in one quarter and false in
the next.

`buildCandidates` ranks cards you do NOT hold on `net` — the yearly gain after the annual fee —
never on the headline rate, and it leaves the losers in the list. A card that would cost you money
is as useful to know about as one that would pay, and dropping them would make the list read as an
endorsement. Everything it returns is annualized, so it carries the same short-window caution the
projection does: the caller suppresses the figures rather than printing a ranking built on a week.

`rotatingUsage` answers the question a long window otherwise buries: what each quarter's categories
were, how much eligible spend landed on the card, and how much fitted under a cap that reset four
times. Its `cap` is prorated to the months of that quarter the window actually covers — measuring a
one-month slice against the full $1,500 would report a miss that never existed. Its per-category `earned` and `optimal` must sum to `earnedActual` and `earnedOptimal`
over the same rows — a test pins that, and it is the only reason the audit can sit under the
headline without contradicting it. `leftBehind` counts **only spend on cards that resolve**: money
on an unlinked source has nowhere to be rerouted to, and folding it in would make "you used the
wrong card" and "you never told us what this card is" the same number. The second is reported as
`unattributedSpend` and, per category, as `unlinkedSpend`.

The grid's cleared-option label reads the **catalog's** published rate for that category, not the
resolved card's — the resolved card already has the current choice merged in, so a card that both
publishes a rate and lets you choose one (Customized Cash: 2% grocery *and* 3% on a pick) would
otherwise label its own cleared option with the base rate and understate itself.

## Dashboard behavior

- **Liquid net worth = cash + savings + investment accounts.** It excludes property, vehicles, private
  or corporate shares, and debts. Never label it "net worth" in UI copy or a prompt. The
  `netWorthHistory` key, `netWorth` field, `/api/net-worth-*` routes, and `['net-worth-history']` query
  key keep the old spelling as persisted contracts — renamed nowhere.
- **`buildDashboardAnalysis` values holdings in the home currency, like the cards do.** It must be
  handed `settings` and a price map carrying `__USDCAD`, and must pass `displayCurrency` / `usdCad`
  into `portfolioValueOf` and `buildComposition` — the same two functions `Dashboard.jsx` calls with
  the same two arguments. Dropping either one values a foreign portfolio at cost while the KPI strip
  beside it shows market, which is the exact disagreement that module exists to prevent.
- **Cash is not editable anywhere.** `cash(d) = closingBalance(newest statement ≤ d) + Σ rows since`.
  Users supply `settings.statementBalances` (`{ date, balance, source }`) and nothing else;
  `settings.cashBalance` is a derived cache, and a client that PUTs one is ignored.
- **Never persist a computed discrepancy, and never reconstruct history backwards from a current
  balance.** `statementChecks` derives on read. It is the app's ONLY external proof of ledger
  completeness — every other total is self-consistent by construction — so it names which statement's
  import is short. Do not weaken it.
- `server/netWorthHistory.js` owns the stored series. `POST /api/net-worth-rebuild` is guarded by
  `settings.netWorthHistoryVersion` against `HISTORY_VERSION` and is idempotent. `Dashboard.jsx`'s
  mount effect calls rebuild → snapshot → backfill **sequentially**; they read-modify-write one file
  and racing them loses a write.
- Investments are stored at **market** value with `portfolioCost` alongside, so
  `market = Δ(portfolio − portfolioCost)` is unrealised gain and a contribution can never read as
  performance. `basis` is `'market'` or `'cost'`; disclose a `'cost'` endpoint rather than quoting the
  market figure plainly.
- The change decomposition closes by construction:
  `end − start = (moneyIn − moneyOut) + market + reconciliation + other`. `reconciliation` splits into
  `lag` (past ledger coverage, expected) and `unexplained` (inside coverage, worth chasing). Never fold
  either into `market`, never merge them into one anonymous "Other".
- Sum flows over the window the **balances** describe — the pair of history points, not the requested
  range. A row in the boundary gap would otherwise count as a flow while its effect sat outside `end`.
- **Two anchors, on purpose.** The waterfall uses `PERIOD_KEYS` (transaction-anchored) because flows
  lag a statement cycle; the trend uses `TREND_PERIODS` (`6M`/`1Y`/`All`, calendar time) because a
  balance is current today regardless. Comment this at any new call site.
- The trend stack is **zero-based, always** — stacked area encodes quantity as thickness, so a
  truncated axis makes the bands lie. The waterfall may truncate; it encodes change as an offset.
- Donut slices filter the trend by **parent bucket** — history has three bands and no memory of account
  types, so every investment type maps to `portfolio`.
- Colours come from `src/components/dashboard/palette.js`. Card chrome stays on stock Tailwind; only
  data ink is tokenised. `TOTAL_FILL` keeps Total mode from borrowing a bucket's colour.

## Budget behavior

- **The Budget tab's subject is the PLAN**, not a ledger and not a balance: caps against six-month
  averages, how income divides, planned savings against target, goal funding.
- **Planned is not achieved.** `totalSavingsPlanned / income` is the *planned* rate and lives here.
  `savingsContributions / income` is the *achieved* rate and lives in Spend's Financial Pace. They
  are routinely far apart. Every label, prompt line, and chat reply says "planned" or "sets aside";
  a bare "savings rate" on this tab is a bug.
- `src/utils/budgetModel.js` owns the whole derivation chain and is imported by
  `server/budgetAnalysis.js`, so the rail and the KPI strip cannot disagree. `resolveSavingsTarget()`
  is the single implementation of the target ladder (explicit → rate → default), rate clamped 0–100.
- Savings-category caps (`Savings`, `Investments`, `Retirement`, `Emergency Fund`) are **allocation**:
  they feed `totalSavingsPlanned`, never `totalSpendingCaps`. A cap named after an active goal is
  funded by the goal row, not counted twice.
- With the default rate-derived target, planned savings *are* the target plus whatever goals add, so
  the plan cannot be short of itself. `planned_rate_below_target` only fires against an explicit
  target below the rate benchmark.
- `capPressure.overBy` sums **only over-cap rows**. It is not the difference between the caps total
  and the average-spend total, and both prompts name and note it so a generation cannot present it
  as one — a live generation did exactly that before the rename. Per-row `overBy` is supplied too,
  so no model ever has to subtract a cap from an average.
- The plan's staleness is a **fingerprint**, not a scope key: there are no chips here, so a stored
  generation goes stale when a cap, the income, or the target is edited. `budgetFingerprint()` and
  `staleBudgetInsightReason()` own that; the record carries its fingerprint.
- Demo mode disables every editor on this tab, not just the AI controls.

## Investments behavior

- **A statement is a snapshot, not a set of purchases.** It says what is HELD, not what was bought.
  An import reconciles: `src/utils/statementReconcile.js` produces an add / update / unchanged /
  remove plan, and re-uploading the same statement writes nothing. Never append statement positions
  as lots — the second monthly upload would double every position, and nothing in the data
  afterwards could tell the duplicate from a genuine second buy.
- **The named account is the whole scope.** Only holdings whose `accountType` matches are read or
  written, which is what makes naming the account in the review step load-bearing. The name is free
  text with `HOLDING_ACCOUNT_TYPES` as suggestions on both paths that create a holding — the add
  form and the import modal — so any registration is reachable by typing it. There is no region
  setting and no closed list. It is **set at creation and never editable afterwards**; a closed
  eight-option dropdown was why every holding ended up under the default.
- The holdings row carries ticker, account, shares, value, weight and gain, and nothing else.
  Purchase price, current price, dates, lot history and delete live in the expanded row — nine
  columns in a half-width card scrolled the ticker off the left edge. The Account column and the
  filter chips share one condition (`accountTypes.length > 1`) so they cannot disagree.
- Share counts are summed across lots, so they must render through `shares()` in
  `components/investments/format.js`. Raw, a holding reads `1.7135600000000002`.
- **A reconciled position keeps its earliest existing lot date**, and only falls back to the
  statement date when the app has never seen it. `holdingLotsAsOf()` includes a lot only when
  `purchaseDate <= asOf`, so re-dating would erase the position from every earlier history point.
- **A position collapses to one lot** at its average cost. The statement reports a position, not the
  trades behind it.
- **A missing cost basis stays null through the whole chain** — prompt, parser, and plan. The review
  step prefills the market value but leaves the row unconfirmed, and `applyReconcile` throws rather
  than writing a null. The disabled button is a courtesy; the throw is the guarantee. A cost copied
  from market value records a position as having made no gain, which the Dashboard's
  saved-versus-markets split would then inherit.
- **A removal is a proposal, unticked by default.** One statement need not cover a whole account, an
  unwanted removal cannot be undone by deleting the upload, and an unwanted keep costs one click.
- Savings reconcile matches on account name only, and an account the statement omits is left alone —
  a savings statement covers one account, so silence about the others says nothing. A statement with
  no printed rate keeps the stored APY rather than writing zero.
- Reconcile routes do one `readDb` → apply → `writeDb`. Never loop `POST /api/holdings` from the
  client; parallel writes to the flat file lose whichever landed first.
- `/api/parse-pdf-vision` branches on `statementType`: `bank`/`credit_card` read a ledger,
  `investment`/`savings` read a balance sheet. The positions prompt must keep telling the model to
  ignore the activity section — both tables are printed on the same page.

## Goals behavior

- The grid is a summary and the **detail panel below it is the whole goal** — one open at a time, in
  a fixed place. `selectedId` is `null`, a goal id, or `'new'`; editing is a flag on top of a
  selected goal, so cancelling lands back on it rather than on an empty page.
- **A linked goal's `currentAmount` is derived, not stored.** `computeGoalProgress` sums
  `sourceValue × percent` and ignores the stored figure, which is why Add Funds is hidden for linked
  goals and why links save on change rather than through the edit form.
- A source is capped at **100% across all goals**. `/api/goal-sources` reports `allocatedPct`
  including the goal being viewed, so a goal's own share is a subtraction — `allocationSegments()`
  owns it. `validateGoalLinks` re-checks on every write with the goal itself excluded.
- **Cash is counted once.** A goal linked to the `cash` source already holds that cash in its
  `currentAmount`, so `emergencyFund()` nets `linkedBreakdown`'s cash out before adding
  `settings.cashBalance`. Adding both was the original bug.
- The timeline here quotes the goal's **stated** `monthlySavings`. `goalProgress()` in
  `liquidNetWorth.js` prefers the rate visible in the ledger and feeds the Dashboard's goal card.
  Two rates, on purpose — a plan and an observation. Never merge them.
- Goal analysis and chat accept **either provider's** key, matching the server routes. Demo mode
  disables every editor and leaves AI available, as on Budget.

## Insight contracts

- Deterministic analysis owns totals, facts, classifications, rankings, statuses, and selections.
  Models write prose only, or classify a validated chat intent.
- The four catalogues are **disjoint by subject**: spend is the card ledger, finance the bank ledger,
  dashboard the balance, budget the plan. A user reading two tabs must not meet one finding under two
  headings.
- The four insight records are independent keys; refreshing one must not invalidate another's chat.
- Routes accept `{ period, from, to, filters, periodLabel }`, where `period` is the opaque scope key.
  Chat binds replies to the same `period`, `generatedAt`, and `analysisVersion` via `createChatBinding()`.
  Generation replaces the prior record and resets chat — surface stale scope, never show it as current.
- Panels are presentational. Chat state (`chatInput`, `chatLoading`, `pendingQuestion`, errors) lives in
  the page, and follow-ups post against the stored record's `period`, never the on-screen scope.
- Any threshold a catalogue knows about must reach the model **as evidence, with the comparison already
  made in JS** — given a hole, a generation will fill it. See `RUNWAY_COMFORTABLE` in
  `dashboardAnalysis.js`.
- Finance observations come from the fixed catalogue in `financeAnalysis.js`; the model supplies bodies
  only for selected keys, and an unexpected key rejects the response.
- Finance reuses `buildFinancialPace` and `fullMonthsWithData` from `spendAnalysis.js` — do not fork it.
  Finance scope matching is bank-only (`accounts`, `flows`, `payees`); never use card-side helpers.
- Spend Style uses the latest six calendar months of unfiltered card activity; Financial Pace uses up to
  six complete bank months; exploration uses the active range and filters.
- `buildDashboardAnalysis` imports `src/utils/liquidNetWorth.js` — the same module the cards render
  from — so agreement with the KPI strip is structural, not luck. It is pure: `asOf`, `prices`, `cash`
  are passed in, never read from a clock or the network.
- Dashboard chat's fact tier is a **lookup over computed figures, not a filter engine**. Per-transaction,
  merchant, and category questions are turned away toward Finances or Spend.
- Budget chat's fact tier is the same shape over the plan. Its allowlist has no `merchant`, `payee`, or
  `transaction` metric; balance questions go to the Dashboard, and "what did I actually save" goes to
  Spend's Financial Pace.
- `pace.savingsRate` is the **target** from settings, not an achievement. The achieved rate is
  `savingsContributions / income` and is the only one shown as a headline; label both where they meet.

## Stored data

```text
transactions[]              bank rows; optional allocation destination link
credit_card_transactions[]  card rows; positive rows include creditKind
holdings[]                  purchase lots with weighted-average cost basis
savings_accounts[]
goals[]
netWorthHistory[]           { date, netWorth, breakdown{cash,savings,portfolio}, portfolioCost, basis }
financeInsights             current finance generation + chat, or null
spendInsights               v2 current generation + chat; v1 remains readable, or null
dashboardInsights           current dashboard generation + chat, or null
budgetInsights              current budget generation + chat, plus its plan fingerprint, or null
uploadHistory[]             filename, source, ledger, importedAt; transactionIds for bank/card,
                            target + recordIds for investment
settings                    provider flags/config, budgets, mappings, per-provider vision models
                            (visionModel + openaiVisionModel), credit policy
                            plus cashOpeningBalance, statementBalances[], netWorthHistoryVersion,
                            categoryBudgets{}, confirmedMonthlyIncome, budgetSavingsTarget/Rate,
                            cardRewards { region, wallet, overrides }
```

Allocation links are `linkedSavingsAccountId` for Savings and the account-type label in
`linkedHoldingAccountType` for Investments; missing or dangling links resolve to `Unassigned`.

In `netWorthHistory[]`, `breakdown.portfolio` is **market** value and `portfolioCost` the cost basis at
that date — the difference is unrealised gain, which is what makes the saved-versus-markets split
honest. `basis` records whether prices were actually available. `settings.statementBalances` holds
bank-issued closing balances only; `source: 'typed'` marks pre-migration entries the UI labels
unverified.
