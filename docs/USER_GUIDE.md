# Your Finance Dashboard — A Friendly How-To Guide 💰

Welcome! This is your personal money dashboard. It lives right on your computer and helps
you see everything in one place: what you're spending, what you're saving, how your
investments are doing, and whether you're on track for your goals.

This guide walks you through it step by step, in plain English. No tech background needed.
Take it one section at a time — you don't have to read it all at once.

### A few things to know first

- **Everything stays on your computer.** Your financial information is saved in a single
  file on your own machine. It's never uploaded to the cloud or shared with anyone.
- **You can't really break anything.** If something looks wrong, you can almost always
  delete it and try again. Don't be afraid to click around.
- **The AI features are optional, but highly recommended.** Written insights, the chat
  assistant, automatic statement reading, and smart categorization all need a one-time
  API key setup — and they make the dashboard significantly more useful. Without them,
  you're manually entering and categorizing everything yourself. We'll cover the setup
  below; it only takes a minute.

---

## Looking for something? Jump to…

- [Step 1: Set up your AI key (do this once)](#step-1-set-up-your-ai-key-do-this-once)
- [What do the AI features cost?](#what-do-the-ai-features-cost)
- [Step 2: Get your money data in](#step-2-get-your-money-data-in)
- [The Dashboard — your big-picture view](#the-dashboard--your-big-picture-view)
- [Finances — your bank account](#finances--your-bank-account)
- [Spend Analyzer — your credit card spending](#spend-analyzer--your-credit-card-spending)
- [Budget — your spending limits & savings plan](#budget--your-spending-limits--savings-plan)
- [Investments — your stocks and savings](#investments--your-stocks-and-savings)
- [Goals — what you're saving toward](#goals--what-youre-saving-toward) *(emergency fund, linking accounts, growth projection)*
- [Settings — your preferences](#settings--your-preferences)
- [Handy tips & good-to-knows](#handy-tips--good-to-knows)

---

## Step 1: Set up your AI key (do this once)

**Why bother?** The dashboard works fine on its own, but a few of the nicest features —
plain-English insights about your spending, a chat you can ask money questions, and the
ability to *automatically read* your bank and credit card statements — need one quick
setup step.

**What you'll need:** An AI API key. Don't let the name scare you — it's just a
password-like code that lets the app use an AI service on your behalf. You get one from
either Anthropic (Claude) or OpenAI (ChatGPT), and you paste it in once. Pick whichever
you prefer; both work the same way inside the app.

### Option A: Claude (Anthropic)

1. Go to [console.anthropic.com](https://console.anthropic.com/) and create an account (or log in).
2. Go to **Settings → API Keys** → click **Create Key** → copy the key (it starts with `sk-ant-…`).
3. Add a few dollars of credits under **Settings → Billing → Add credits** — $5 lasts months for personal use.
4. In the dashboard: click **Settings** (top-right ⚙), set **AI Provider** to **Claude**, paste your key, and click **Save Key**.

### Option B: ChatGPT (OpenAI)

1. Go to [platform.openai.com](https://platform.openai.com/) and create an account (or log in).
2. Click your avatar → **API Keys** → **Create new secret key** → copy the key (it starts with `sk-…`).
3. Add credits under **Billing → Add to credit balance** — $5 is plenty.
4. In the dashboard: click **Settings**, set **AI Provider** to **ChatGPT**, paste your key, and click **Save Key**.

You'll see a green **Configured ✓** badge once your key is saved. That's it — you're done. 🎉

> **Is this safe?** Yes. Your key is stored only on your own computer and is never shown
> back on screen or shared with anyone else. You can switch providers at any time in Settings.

### Optional: tell it your monthly income

While you're in Settings, you can set your **Monthly Income Baseline** — basically your
usual take-home pay each month. This helps the Budget Builder make better suggestions.
Type the amount and click **Save**. You can skip this for now and add it later.

---

## What do the AI features cost?

Short version: **almost nothing.** The AI features bill straight to your Anthropic or
OpenAI account, and for personal use you'll likely spend just a few cents a month — often less.

Here's how it works in plain terms. The AI charges by the amount of text it reads and
writes, measured in "tokens" (a token is roughly ¾ of a word). The app uses two different
AI models depending on the task — a fast, cheap one for most things, and a more capable one
for reading documents. You're never charged a subscription or a monthly minimum; you only
pay for what you actually use.

The table below shows what each feature roughly costs **per use**. These are estimates — your
real cost depends on how much data you have — but they're in the right ballpark.

| What you're doing | Roughly costs | Notes |
|---|---|---|
| **AI Insights** (Dashboard, Finances & Spend Analyzer) | a fraction of a cent | All three calculate the numbers themselves and use AI only to word the result |
| **Asking a follow-up in chat** | a fraction of a cent | Guided choices are calculated directly; typed questions may use AI to understand what you asked |
| **Goal analysis & goal chat** | a fraction of a cent | |
| **Re-categorize uncategorized** (AI) | a fraction of a cent | |
| **Budget Builder** | about 1 cent | Reads more data, so slightly more |
| **Auto-detecting a new CSV's columns** | about 1–2 cents | Happens once per new account, then it's free |
| **Reading a PDF statement** (Vision) | about 5–15 cents | The priciest one — it "looks at" each page like an image; longer statements cost a bit more |

> **Want to put a hard limit on it?** Both Anthropic and OpenAI let you set a monthly
> spending cap and see your usage on their billing dashboard, so there are no surprises.
> If you mostly upload CSV files instead of PDFs, your costs stay especially tiny.

---

## Step 2: Get your money data in

**Why this matters:** The dashboard can only show you useful things once it knows about
your transactions. The easiest way to feed it your spending is to upload a statement from
your bank or credit card. You only have to teach it about each account once.

You can add data in three ways:

- **Upload a statement file** (the fast way — recommended)
- **Type transactions in by hand** (fine for one-offs)
- Let it **read a PDF statement automatically** using AI

### Uploading a statement file (CSV)

A **CSV** is just a spreadsheet file your bank lets you download — usually there's a
"Download" or "Export" button in your online banking, and you pick the CSV option.

1. Go to the **Finances** tab (for bank accounts) or **Spend Analyzer** tab (for credit
   cards).
2. Click the **Upload Bank Statement** button (or **Upload Credit Card Statement** on the
   Spend Analyzer tab).
3. Pick the CSV file you downloaded from your bank.

**What happens next depends on whether the app has seen this account before:**

**If it recognizes the account** (you've uploaded from it before), a little banner pops up
that says *"Recognized format: [your bank's name]"*.

- Click **Yes, use it** and your transactions import right away. Done!
- Click **No, remap** only if something changed and you want to set it up again.

**If it's a new account it hasn't seen**, it'll try to figure out the columns for you
automatically (you'll see *"Auto-detecting columns…"*). Then it shows you the transactions
it found so you can look them over before importing.

**If it needs your help matching things up**, a small setup window appears. Don't worry,
it's quick:

1. **Name this source** — give the account a friendly name like "Chase Checking" or
   "Amex Card." (You'll only do this once per account.)
2. **Point out the columns** — tell it which column has the **Date**, which has the
   **Description**, and which has the **Amount**.
   - If your bank puts deposits and withdrawals in *two separate columns*, flip on the
     split (Debit/Credit) option and pick both.
   - If your amounts look backwards (money out shows as a positive number), tick the
     **Invert amounts** box.
3. **Choose the type** — is this a **Bank / checking** account or a **Credit card**?
   (Bank accounts count deposits as income; credit cards only track spending.)
4. Click **Import**.

The app remembers your setup, so next time you upload from this account it'll be the quick
one-click experience. ✨

> **Want a head start?** On the Finances tab there's a **CSV Template** button that
> downloads a blank, correctly-formatted spreadsheet. Handy if you'd rather build a file
> by hand.

### Uploading a PDF statement (let the AI read it)

No spreadsheet available? No problem. If your bank only gives you a PDF, the app can read
it for you. (This is one of the features that needs an AI key from Step 1.)

1. Click the same **Upload Bank Statement** / **Upload Credit Card Statement** button.
2. Choose your PDF file.
3. You'll see *"analyzing with AI…"* while it reads the document — give it a few seconds.
4. A **Review** window opens showing every transaction it found, plus a quick summary of
   total income (green) and total spending (red).
5. Look it over. See a row that doesn't belong? Click the **✕** next to it to remove it.
6. Type a name for the account in the **Bank / source name** box.
7. Click **Import** and you're done.

> **If something looks wrong:** AI reads clean, table-style statements best. If it misses
> things or grabs the wrong numbers, just delete the bad rows before importing — or, if
> it's really off, cancel and try the CSV method instead.

### Typing a transaction by hand

Sometimes you just want to add one thing — a cash purchase, say. On either the **Finances**
or **Spend Analyzer** tab, click **+ Add Transaction**, fill in the date, description, and
amount, pick a category, and save. Quick and easy.

---

## The Dashboard — your big-picture view

**What it's for:** This is your home base — a single glance that answers "how am I doing?"
You don't *do* much here; you just *see* a lot.

### The four numbers at the top

- **Liquid net worth** — your cash, savings, and investment accounts added together. It's
  called *liquid* because it only counts money you could actually get at: property, vehicles,
  private or corporate shares, and debts are not included. Hover the ⓘ for that definition
  any time.
- **Cash** — money in your chequing account. You can't type this one in, and that's deliberate:
  it's the closing balance from your most recent statement plus every transaction since. The card
  tells you which statement it's good to and how many days are still pending. If you add a
  transaction by hand it moves straight away; otherwise it changes when you import your next
  statement.
- **Savings** and **Portfolio** — your savings accounts, and what your investments are worth
  right now at live prices. (Portfolio may say *"Fetching…"* for a moment.)

Each one shows how it's moved over the last 30 days.

### Where the change came from

This is the card worth slowing down for. It takes your liquid net worth at the start of a
period and walks you to where it is now, one step at a time:

**Start → Money in → Money out → Market → Today.**

The point is the split between the last two. **Money in / money out** is what *you* did.
**Market** is what stock prices did — and only that. If you paid $500 into an investment
account, that shows up as money you moved, never as investment performance.

Sometimes a sixth **Unaccounted** bar appears. That means your real bank balance and your
uploaded statements disagree. Click it and the card names each gap: the date, what the
statements expected, what your balance actually was, and how much is simply spending that
hasn't been imported yet. Click **Inspect in Finances** on any of them and you'll land on
the Finances tab already filtered to exactly those weeks.

The period buttons (**1M / 3M / 6M / 1Y / YTD / All**) scope *this card only* — the four
numbers above are always today's, and the chart below has its own range.

### Liquid net worth over time

A stacked chart: cash on the bottom, then savings, then investments, with the dark line
along the top being your total. Switch to **Total** if you'd rather see just the headline.

Its range buttons are **6M / 1Y / All** in ordinary calendar months, so it always runs up to
today — unlike the card above, which follows your statements. Hover anywhere to see all
three numbers on that date.

### What it's made of

A donut of where your money is sitting right now, with the total in the middle. Click any
slice and the chart beside it dims to just that part — click **Show all** to go back. It
fills in as you use the app, so both may look sparse at first. That's normal.

### Goal progress

Your next few goals by deadline, each with the rate it's *actually* being funded at — worked
out from your real transfers where it can, or from the monthly amount you set if there's
nothing to go on yet. It tells you when each one lands at that rate, and flags in amber
anything landing after the date you were aiming for. **View all →** takes you to the Goals
tab.

### Where the cash figure comes from

Every dollar of it traces back to something your bank printed. When you import a statement you'll
see two small optional fields — **the date it ended and its closing balance**. Fill them in and the
app immediately checks its own work: it adds up the previous statement's closing balance plus every
transaction since, and tells you whether it lands on the number you typed.

> ✓ *Reconciles with every transaction since Jun 13.*

If it doesn't, you'll see how far off it is before anything is saved:

> ⚠ *These rows come to $6,488.91, not $6,833.91 — a −$345.00 gap since Jun 13. A row may be
> missing from the parse, or one may be unticked below as a duplicate when it is not.*

That's worth taking seriously. It's the only check the app can make on whether an import was
complete — every other total just adds up the rows it has, so nothing else would ever notice a
missing one. You can still import anyway and sort it out later.

The balances you enter are listed under **Settings → Statement closing balances**, where you can
add older ones, correct a typo, or delete one. Each row says whether it reconciles.

### Get AI insights (and ask questions)

If you set up your AI key, click **Generate** on the **Dashboard Insights** card. In a few
seconds you'll get a plain-English summary and up to three observations about your balances —
what moved them, how long your cash would last, and anything that doesn't add up.

Every number in there is worked out by the app, not written by the AI. The AI only writes the
sentences around them, so what you read will always match the cards above it.

Below that you can ask a follow-up. There are three suggested questions to click, or type
your own — *"How long would my cash last?"*, *"What is unaccounted for?"* Questions about
individual transactions or shops belong on the Finances and Spend Analyzer tabs, and it'll
say so rather than guess.

Change the period on the card above and you'll see a note saying your insights cover a
different stretch, with a button to redo them. Follow-up answers stay with the period they
were generated for, so an answer never quietly switches out from under a question.

**Clear** throws the insights and the conversation away; **Refresh** replaces them.

> No key set up yet? You'll see a note inviting you to add one in Settings. Everything
> else on the Dashboard still works.

---

## Finances — your bank account

**What it's for:** This tab is all about your **bank account** — your paycheck coming in,
your rent and bills going out, money you move to savings. It's the income-and-expenses side
of your life.

What you can do here:

- **See the big picture** — charts compare your income against your expenses, with running
  totals on the side.
- **Change the time window** — use the period buttons (**7D / 1M / 3M / 6M / 1Y / YTD / All**)
  at the top to zoom in on a recent week or stretch out to your full history.
- **Add a transaction** — click **+ Add Transaction** for anything you want to enter by
  hand.
- **Upload a statement** — the **Upload Bank Statement** button (see [Step 2](#step-2-get-your-money-data-in)
  above).
- **Tidy up your transaction list** — the table at the bottom shows every transaction:
  - **Change a category** — click the colored category tag and pick a better one.
  - **Link a savings transfer to an account** — for money you moved to savings, click
    **+ Link account** to connect it to one of your savings accounts.
  - **Delete something** — click the **✕** on its row.
- **Filter the view** — use the dropdowns to show just one month, or filter by type:
  **Income**, **Expenses**, **Savings** (transactions categorized as Savings), or
  **Investments** (contributions to investment accounts).

---

## Spend Analyzer — your credit card spending

**What it's for:** This is your **credit card** detective. It helps you see exactly where
your money goes — which stores, which categories — and lets you dig into spending patterns.

### The basics

- **Upload your card statement** with the **Upload Credit Card Statement** button (same
  process as [Step 2](#step-2-get-your-money-data-in)).
- **Explore the charts** — see your spending broken down by card, by category, and a
  **Top Merchants** list showing where the most money went.
- **Search and sort** — use the search box to find a specific purchase, or click a column
  header to sort the list.

### Tidy up your categories

Good categories make everything else more useful. In the transaction table:

- Click any **category tag** to change it.
- Got transactions with no category? Click the **Uncategorized only** button to see just
  those, then fix them.
- In a hurry? Click **Re-categorize uncategorized** and the AI will sort them for you (needs
  your AI key).

### Insights and chat

With an AI key configured, click **Generate** to create two complementary views:

- **Spend Style** gives your recent card-purchase pattern a friendly archetype and four traits:
  whether you tend to revisit merchants or explore, concentrate on a few categories or spread
  spending around, spend steadily or around bigger moments, and favour everyday or larger-ticket
  purchases. It describes recent behaviour, not a permanent personality. The confidence label tells
  you how much history supports the result.
- **Financial Pace** compares average monthly income and bank expenses with your savings target.
  **On Track** means the available room meets that target, **Little Room** means there is some room
  but less than the target, and **Over Pace** means expenses are above income. If the app does not
  have enough complete bank history or reliable income, it says **Not Enough Data** instead of
  guessing.

Spend Style looks at up to the latest six months of unfiltered card activity, so changing a chart
filter does not change your profile. Financial Pace uses complete bank months and never adds card
purchases again—the bank ledger already includes card payments.

Under the two cards, choose a deeper look:

1. **Category patterns** — where spending is concentrated.
2. **Merchant habits** — repeat merchants and purchasing routines.
3. **Anomalies & opportunities** — unusual purchases and practical places to create more room.

Clicking a choice or typing **1**, **2**, or **3** gives the same result for the period and filters
saved with the insight. You can also ask your own question, such as *"How much did I spend on
groceries?"*, *"Compare April and May"*, or *"Why did I get this Spend Style?"* Exact amounts are
calculated from your local transactions, and each answer states the period it used. Advice questions
like *"What should I cut to save more?"* use the same calculated facts but allow a more interpretive
answer.

If you change the visible period or filters after generating, the card warns that exploration still
refers to the saved scope. Click **Re-analyze** to replace it, or **Clear** to remove the saved insight
and its conversation.

---

## Budget — your spending limits & savings plan

**What it's for:** This tab is your financial plan in one place. Set caps on what you spend
by category, see how you're tracking against those limits in real time, and set savings
targets alongside your spending — all on one screen.

### The strip at the top

Four figures, and everything below is a working of them:

- **Monthly income** — click **Edit** to confirm your take-home pay. Until you do, it's the
  average of your bank deposits over the last few complete months.
- **Spending caps** — what you've budgeted, next to what you actually average.
- **Savings planned** — goals, your general target, and any savings-category amounts.
- **Left to allocate** — income minus both, again shown budgeted next to actual.

Under the strip, a single bar shows how income divides three ways: capped spending, planned
savings, and whatever is left. If the plan commits more than comes in, the last segment turns
red and is labelled **Over budget**.

### Spending caps

The caps card lists each spending category with:

- **Cap** — click any amount to edit it. Categories with no cap show **Set cap**.
- **Avg** — what you actually spend per month, from your credit card history.
- **Cap vs avg** — a bar that turns **yellow** as you approach the cap and **red** past it.
- **% of income** next to each figure, so you can gut-check whether a category is taking a
  reasonable share of your pay.

### Savings & goals

Money you're *putting away* has its own card beside the caps:

- **Savings / Investment categories** (Savings, Investments, Retirement, Emergency Fund) take
  their detected figure from your *bank* transactions rather than card history, since those
  contributions never appear on a card statement.
- **Active goals** show what you've committed per month. Leave a goal's monthly amount unset
  and the app infers it from your bank history, marked *auto*.
- **General savings target** — the catch-all for savings not tied to a goal. It defaults to
  **15% of income** (marked *auto*). Click it to set a dollar amount, or clear the field to
  go back to the default rate.

**Detected from bank data** sits below and is read-only on purpose: it's what the ledger says
is already happening, as a check on the plan above it.

### Build a budget with help ✨

Not sure what your limits *should* be? Pick a pace — **Aggressive**, **Balanced**, or
**Comfortable** — and click **Generate with AI** in the page header.

Suggestions arrive **staged, not saved**. A banner appears explaining the reasoning, every
suggested figure is marked **AI**, and nothing touches your saved plan until you click
**Save AI budget**. You can edit any suggested number first — that revises the suggestion
rather than saving it. **Discard** throws the whole set away.

Savings-category amounts are replaced with what your bank actually shows, so a suggestion
can't contradict a transfer you already have running.

### Plan health — the insights rail

The rail on the right leads with your **planned savings rate**: the share of income the plan
intends to set aside, on a 0–100% track with your target marked as a tick. It's shown whether
or not you've generated anything.

> **Planned is not achieved.** This is what your plan *intends*. What you *actually* saved
> lives in the Spend Analyzer's Financial Pace. The two are often far apart, and the app never
> shows them under the same name.

Click **Generate** for a written read on where the plan strains, then ask follow-ups. Questions
about individual transactions or merchants are pointed at the Spend Analyzer, and balance
questions at the Dashboard — this tab only knows about the plan.

If you edit a cap, your income, or the target after generating, the rail says so and offers to
re-analyze. **Clear** removes the saved insight and its conversation.

---

## Investments — your stocks and savings

**What it's for:** Keep track of two things: your **investments** (stocks and funds) and
your **savings accounts** (like a high-yield savings account earning interest).

### Adding an investment

1. Click **+ Add Holding**.
2. Fill in:

   - **Ticker** — the stock's short symbol, like `AAPL` for Apple.
   - **Shares** — how many you own.
   - **Purchase Price** — what you paid per share.
   - **Purchase Date** — when you bought them.
   - **Account Type** — where it's held (a retirement account, a regular brokerage, etc.).

3. Click **Add Holding**.

The app fetches the *current* price automatically, so you can see your **gain or loss** at
a glance — green if you're up, red if you're down. Bought the same stock more than once?
Click the **"N buys"** label on its row to see each purchase separately.

> **Heads up:** Prices are pulled live from the internet. Once in a while a lookup fails and
> you'll see a small error — you can dismiss it and it'll usually work next time.

### Adding a savings account

Scroll down to **Savings Accounts** and click **+ Add Account**. Enter the account's name,
type, current balance, and its **APY** (the yearly interest rate it pays — your bank lists
this). The app then shows you how much interest you're earning each month and each year.
Need to update a balance later? Click the ✏️ pencil to edit it in place.

### Uploading a statement instead of typing it all in

If you hold fifteen positions, typing fifteen holdings is a bad afternoon. Click
**Upload Statement** and give it the PDF summary from your brokerage or bank.

1. Choose whether you're uploading **Investment holdings** or a **Savings account**.
2. Pick the PDF. The AI reads the page that lists what you *hold* — it deliberately ignores
   the buys, sells, dividends and fees in the activity section further down.
3. **Name the account.** Type whatever you call it — `TFSA`, `Roth IRA`, `401(k)`, `HSA`.
   Suggestions drop down as you type, and the name is remembered for next time. This matters:
   only holdings filed under that name are touched, so a statement for one account can never
   disturb another.
4. **Review what it found.** Every row is tagged **Add**, **Update**, **No change**, or
   **Remove**, and shows what's changing — `35 → 40` shares, say. Untick anything you don't want.
5. Click **Import**.

**Your statement is a snapshot, not a shopping list.** It says what you hold *today*, so
importing it makes the account *match* it rather than piling more shares on top. That means
uploading the same statement twice is completely safe — the second time, everything says
"No change" and nothing is written.

> **Positions the statement doesn't mention** are proposed for removal, but the tick box starts
> **off**. If your statement only covers part of an account, just leave them unticked and they
> stay put.

> **A missing cost basis turns the row amber.** Some statements (especially US ones) print what
> a position is worth but not what you paid for it. The app won't guess — a made-up cost would
> record the position as having made no gain, and that error would spread to your Dashboard.
> Type what you paid, or click **Use $X** to accept the market value. **Import** stays greyed
> out until every amber row is settled.

Savings statements work the same way, matched by account name. If your statement doesn't print
an interest rate, the app keeps the APY you already entered rather than wiping it to zero.

Every import is logged under **Settings → Upload History → Invest.**, where you can delete it.
Deleting removes what that import *wrote* — but be aware it can't bring back a position the
import replaced or removed at the time.

---

## Goals — what you're saving toward

**What it's for:** This is the motivating part — set a target (an emergency fund, a vacation,
a house down payment) and watch yourself get closer.

### How the page is laid out

Your goals sit in a grid, each as a small card with a **progress ring**, the percentage
you've reached, and one badge saying how it's funded — either the accounts it's linked to,
the monthly amount you've set, or "No monthly savings set" if it has neither.

**Click any card** to open its full detail underneath the grid: progress, funds, linked
accounts, and AI analysis. Only one goal is open at a time, always in the same place — click
the card again, or **Close ✕**, to collapse it.

### Emergency Fund

The banner across the top is a quick sanity check on whether you have enough set aside for a
rainy day. It isn't an ordinary goal, which is why it isn't in the grid with them: its target
is worked out for you rather than chosen.

- **Pick a coverage target** — 3, 6, 9, or 12 months of expenses. Most financial guidance
  suggests 3–6 months; pick what feels right for your situation. The target updates as you
  click, and the small print underneath says what it's based on — for example
  *"6 × $2,000.00/mo avg spend (Feb–Jul 2026)."*
- Progress combines your **"Emergency Fund" goal's balance** with **cash you haven't already
  earmarked to it**. Cash counts toward an emergency whether or not a goal names it — but a
  dollar is only ever counted once, so if the goal is linked directly to your cash balance
  you won't see it added twice.
- **Gap** — the shortfall between where you are and where you want to be.
- **Create Emergency Fund Goal** — if you don't have one yet, this creates it with the right
  target and your current cash balance as a head start.
- **Sync target** — if your goal's target is out of date (maybe your spending changed), a
  "Sync target → $X,XXX" button appears to update it in one click.

### Create a goal

1. Click **+ New Goal** (top right, or the dashed tile at the end of the grid).
2. Fill in:

   - **Goal name** — like "Emergency Fund."
   - **Target amount** — how much you want to save.
   - **Target date** — when you'd like to hit it.
   - **Monthly savings** — how much you plan to put toward it each month (optional, but it
     powers the timeline estimate). If you've been saving consistently, you'll see a
     suggestion like *"Your avg savings: $400/mo over 6 mo"* — click it to fill the field in.

3. Click **Create Goal**. The new goal opens straight away, ready to link accounts to.

### Linking accounts

Linking is the powerful bit: instead of adding funds by hand, the goal tracks money you
already have in a savings account, an investment account, or your cash balance.

Open a goal and find **Linked accounts — allocation** in its detail panel.

- Pick an account and enter the **percentage** of it that counts toward this goal (e.g. "50%
  of my High-Yield Savings"), then click **Add**. It saves immediately.
- Each linked account gets a bar showing how it's divided up — **this goal's** share, what
  **other goals** have claimed, and what's still **free**. An account is capped at 100% across
  all your goals, so two goals can never count the same dollar.
- **Remove** releases a link and frees that capacity back up.
- You can link accounts to a goal at any time, not just when creating it.

Once a goal is linked its amount comes from those accounts, so the **Add Funds** box
disappears — there's nothing to add by hand.

### Keeping a goal updated

- **Linked goal?** Nothing to do — progress updates automatically as your balances and
  investment prices change.
- **Unlinked goal?** Type the amount in the **Add amount…** box and click **Add Funds**.
- **Need to change something?** **Edit** adjusts the name, target, date and monthly savings.
  (Linked accounts are managed in their own card, not in this form.)
- **Want advice?** **Get AI Analysis** in the right-hand panel gives you thoughts on the goal,
  and the chat box below it takes follow-ups like *"How can I reach this faster?"* — it works
  with whichever AI provider you've set up in Settings.
- **Done with a goal?** **Delete** asks you to confirm first, and tells you how much progress
  you'd be discarding. Deleting a linked goal doesn't touch the accounts themselves.

### Growth projection

Goals can show an extra estimate in a dashed box:

> 📈 With growth (6% return + APY), you'd reach this in ~9 months

This is an optimistic "what if" that factors in compound growth — APY on savings, and an
assumed return on investments. It's shown separately from the plain timeline so you can
tell them apart. You can change the assumed investment return percentage in Settings.

---

## Settings — your preferences

**What it's for:** A small control panel for the handful of things you set once and forget.

The page has two columns: **AI & Automation** on the left — provider, key, and extraction
model — and **Data & Imports** on the right, where your statement balances and upload history
live. Each of those two right-hand cards scrolls inside itself, so the page stays the same
length no matter how many statements you've imported. Anywhere you see a small **ⓘ**, hover
or tab to it for the longer explanation.

- **AI Provider** — choose between **Claude** (Anthropic) and **ChatGPT** (OpenAI). Switching
  here changes which AI service the app uses for all features — insights, categorization, PDF
  parsing, and the Budget Builder.
- **API Key** — add or replace your key for the selected provider
  (see [Step 1](#step-1-set-up-your-ai-key-do-this-once)). A green **Configured ✓** badge
  means you're good to go.
- **Statement Extraction Model** — which model reads your scanned PDF statements. The list is
  pulled from your provider using your own key, so it only ever shows models your account can
  actually use, and it picks up new ones on its own. Your choice saves as soon as you pick it,
  and **Reset** puts back the default. Each provider remembers its own choice, so switching
  between Claude and ChatGPT doesn't lose it. The default is the right answer almost always —
  reach for a stronger model only if one particular statement keeps coming out wrong. (No key
  saved yet, or the app can't reach your provider? You'll see a short built-in list instead.)
- **Monthly Income Baseline** — your usual take-home pay. The Budget Builder uses this to
  make smarter suggestions. Type it in and click **Save**; leave it blank and save to go back
  to the average worked out from your CSVs.
- **Assumed Annual Investment Return** — the return rate used for the optimistic growth
  projection on linked goals. Defaults to **6%**. If your holdings are mostly conservative
  (bonds, cash-equivalent ETFs) you might lower it; if you're in aggressive growth funds
  you might raise it. Savings accounts always use their own APY regardless of this setting.
  Type a new percentage and click **Save**.
- **Default Savings Rate** — the percentage of your monthly income used as the automatic
  general savings target on the Budget page. Defaults to **15%**. For example, if your
  income is $5,000 and this is 15%, the Budget page's General Savings Target row will
  default to $750. You can override the dollar amount directly in the Budget table for a
  specific month without touching this setting — this just controls the starting default.
  Type a new percentage (0–100) and click **Save**.
- **Upload History** — one log with three tabs, one per place statements land: **Bank**
  (Finances), **Card** (Spend Analyzer), and **Invest.** (account summaries). The number beside
  each tab is how many imports it holds. If you want to re-import a statement or just keep
  things tidy, delete individual entries here. Deleting a bank or card entry also removes the
  transactions it brought in. Deleting an investment entry removes the holdings or savings
  accounts that import wrote — but it can't restore a position the import replaced, because
  that reconciled the account to the statement.
- **Saved CSV Sources** — a list of the bank and card accounts you've taught the app about.
  If an account's downloads change format and imports start looking off, delete it here and
  the app will re-learn it the next time you upload. You can remove them one at a time or
  clear them all.

---

## Handy tips & good-to-knows

- **Your data lives on your computer**, in a single file. If you ever want to keep a backup
  or move to a new computer, that one file is everything — copy it somewhere safe now and
  then.
- **Money in is positive, money out is negative.** You'll see income in green and spending
  in red throughout the app. That's just the convention — nothing to set up.
- **You can fix categories anywhere.** Wherever you see a colored category tag, you can click
  it to change it. Don't stress about getting them perfect on import — clean them up whenever.
- **The AI is powered by your own key.** Anything the AI features do uses the key you added,
  and your information stays on your machine. No surprises.
- **To stop the app**, click the **red stop icon** in the top-right corner of the nav bar
  (next to the Settings gear). A confirmation modal appears — click **Close App**, then
  **Close Tab** when it's done. No need to touch the terminal.
- **Want to show the app to someone without exposing your real data?** Ask whoever set it
  up to enable Demo Mode — it loads sample data and blocks any edits, so you can click
  through everything safely.
- **When in doubt, just try it.** Almost everything can be deleted and re-done. Click around
  and get comfortable — it's your dashboard. 😊

---

*Happy budgeting!*
