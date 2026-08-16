# Finance Dashboard

This context describes the personal-finance language shared by the dashboard, its insights, and
its user-facing guidance.

## Language

**Bank Transaction**:
Money entering or leaving a bank account, including income, expenses, savings transfers, and
investment contributions.
_Avoid_: Cash transaction, account activity

**Card Purchase**:
A charge made on a credit card that represents spending.
_Avoid_: Card expense, negative card transaction

**Card Credit**:
Money returned on a credit card through cashback, a refund, rebate, or another credit; it reduces
what is owed and is not spending.
_Avoid_: Card income, negative spending

**Estimated Earned**:
What a card's published rates would have paid on the spending in the window on screen, scored month
by month. An observation about a period, never annualized, and always an estimate: it comes from
published rates, not from what an issuer actually credited.
_Avoid_: Cashback, rewards earned, cash back received

**Card Credit** is deliberately not the same thing, and the two are never added together. A Card
Credit is cashback already *redeemed* onto a statement; Estimated Earned is what the spending
*generated*. Counting both would count one dollar twice, so nothing on the Rewards view reads
`creditKind` rows at all.

**Optimal**:
What the same window's spending would have earned with every category on the best card held. A
comparison, over the same months and the same rows as Estimated Earned.
_Avoid_: Potential earnings, maximum cashback

**Left Behind**:
The distance between Estimated Earned and Optimal — money that a different card choice would have
earned, on spending that already happened. It counts only spend on cards that can be scored; money
on an unlinked card has nowhere it could have been rerouted to.
_Avoid_: Lost money, wasted rewards, missed cashback

**Yearly Projection**:
A forward estimate: average monthly spend per category at today's rates, times twelve. The only
rewards figure that extrapolates, and the only one a short window makes unreliable.
_Avoid_: Annual earnings, yearly cashback

**Wallet**:
The link between a card name on your statements and the card product it actually is. The statement
name stays what it always was; the wallet only says which product it refers to.
_Avoid_: Card list, accounts

**Bonus Category**:
A category a card pays more than its base rate on. When a bonus covers only part of a category — gas
within Transport, drugstores within Health — the rate is marked as an over-estimate rather than
being presented as covering the whole category.
_Avoid_: Reward category, multiplier

**Rotating Category**:
A bonus category that changes each quarter and applies only to that quarter. Which card is best for
a category is therefore an answer about a month, not about a window: the same card can be the right
choice in one quarter and the wrong one in the next.
_Avoid_: Bonus category (unqualified), quarterly reward

**Cap**:
A limit on the *spending* a bonus rate applies to, not on the reward paid. Spending past it earns
the same card's base rate. A quarterly cap is shared across every category that quarter covers.
_Avoid_: Reward limit, maximum cashback

**Correction**:
A rate a person has told the app is wrong, stored separately from the shipped card catalog so that
updating the catalog never overwrites it. Shown as theirs, never as published.
_Avoid_: Override, custom rate

**Spend Style**:
A recent-behaviour profile that describes recurring patterns in a person's card purchases without
claiming a permanent personality or psychological diagnosis.
_Avoid_: Spending personality, financial personality

**Trait**:
One evidence-backed dimension of a Spend Style, expressed as one of two descriptive poles.
_Avoid_: Score, diagnosis

**Archetype**:
The friendly name that summarizes the primary Spend Style traits.
_Avoid_: Personality type, financial identity

**Confidence**:
How much card-purchase history supports a Spend Style, expressed as High, Medium, or Early Read.
_Avoid_: Accuracy score, certainty

**Bank Payee**:
The counterparty a bank transaction was with, grouped from its description rather than from a
category. Venmo activity groups by the person's name, not by the acquirer location that varies per
row.
_Avoid_: Merchant, vendor, category

**Outflow**:
Money leaving a bank account, whether it was spent or set aside. Expenses, savings transfers and
investment contributions are all outflows.
_Avoid_: Spending, expenses (when transfers are included)

**Allocation**:
An outflow the person deliberately set aside — a savings transfer or an investment contribution. It
is money moved, never money spent or lost.
_Avoid_: Expense, spending, cost

**Financial Pace**:
A current comparison of average monthly income, bank expenses, headroom, and a savings target.
Computed once, from complete bank months only, and shown on both the Spend Analyzer and Finances.
_Avoid_: Financial health, money score

**Savings Rate**:
The share of monthly income that reached savings. The *achieved* rate is what actually went across;
the *target* rate is the benchmark from Settings. Always say which one is meant.
_Avoid_: Savings rate (unqualified), savings percentage

**Headroom**:
Average monthly income remaining after bank expenses and before comparison with the savings target.
_Avoid_: Savings, disposable income

**Savings Target**:
The monthly amount reserved as the benchmark for Financial Pace.
_Avoid_: Headroom, savings contribution

**Exploration Scope**:
The selected card-spending period and filters used for guided exploration and ordinary spending
questions.
_Avoid_: Spend Style period, Financial Pace period

**Guided Exploration**:
One of three optional deeper looks at category patterns, merchant habits, or anomalies and
opportunities.
_Avoid_: Core insight, personality trait
