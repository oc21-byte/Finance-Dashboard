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
- **The smart "AI" features are optional.** A few features (the helpful written insights,
  the chat, and the automatic reading of statements) need a one-time setup. Everything
  else works without it. We'll cover that setup below.

---

## Looking for something? Jump to…

- [Step 1: Get set up (do this once)](#step-1-get-set-up-do-this-once)
- [What do the AI features cost?](#what-do-the-ai-features-cost)
- [Step 2: Get your money data in](#step-2-get-your-money-data-in)
- [The Dashboard — your big-picture view](#the-dashboard--your-big-picture-view)
- [Finances — your bank account](#finances--your-bank-account)
- [Spend Analyzer — your credit card spending](#spend-analyzer--your-credit-card-spending)
- [Investments — your stocks and savings](#investments--your-stocks-and-savings)
- [Goals — what you're saving toward](#goals--what-youre-saving-toward)
- [Settings — your preferences](#settings--your-preferences)
- [Handy tips & good-to-knows](#handy-tips--good-to-knows)

---

## Step 1: Get set up (do this once)

**Why bother?** The dashboard works fine on its own, but a few of the nicest features —
plain-English insights about your spending, a chat you can ask money questions, and the
ability to *automatically read* your bank and credit card statements — need one quick
setup step.

**What you'll need:** A "Claude API key." Don't let the name scare you — it's just a
password-like code that lets the app use Anthropic's AI on your behalf. You get one from
your Anthropic account, and you paste it in once.

### Add your key

1. Click **Settings** (the little gear ⚙ icon, usually top-right).
2. Find the box labeled **Claude API Key**.
3. Paste your key into the field (it'll look something like `sk-ant-…`).
4. Click **Save Key**.
5. You'll see a green **Configured ✓** badge appear. That's it — you're done. 🎉

> **Is this safe?** Yes. Your key is stored only on your own computer and is never shown
> back on screen or shared with anyone else.

### Optional: tell it your monthly income

While you're in Settings, you can set your **Monthly Income Baseline** — basically your
usual take-home pay each month. This helps the Budget Builder (more on that later) make
better suggestions. Type the amount and click **Save**. You can skip this for now and add
it later.

---

## What do the AI features cost?

Short version: **almost nothing.** The AI features bill straight to your Anthropic
account, and for personal use you'll likely spend just a few cents a month — often less.

Here's how it works in plain terms. The AI charges by the amount of text it reads and
writes, measured in "tokens" (a token is roughly ¾ of a word). The app uses two different
AI models depending on the task — a fast, cheap one for most things, and a more capable one
for reading documents. You're never charged a subscription or a monthly minimum; you only
pay for what you actually use.

The table below shows what each feature roughly costs **per use**. These are estimates — your
real cost depends on how much data you have — but they're in the right ballpark.

| What you're doing | Roughly costs | Notes |
|---|---|---|
| **AI Insights** (Dashboard & Spend Analyzer) | a fraction of a cent | Reads a summary of your transactions |
| **Asking a follow-up in chat** | a fraction of a cent | Each message is tiny |
| **Goal analysis & goal chat** | a fraction of a cent | |
| **Re-categorize uncategorized** (AI) | a fraction of a cent | |
| **Budget Builder** | about 1 cent | Reads more data, so slightly more |
| **Auto-detecting a new CSV's columns** | about 1–2 cents | Happens once per new account, then it's free |
| **Reading a PDF statement** (Vision) | about 5–15 cents | The priciest one — it "looks at" each page like an image; longer statements cost a bit more |

> **Want to put a hard limit on it?** Anthropic lets you set a monthly spending cap and see
> your usage on their billing dashboard, so there are no surprises. If you mostly upload CSV
> files instead of PDFs, your costs stay especially tiny.

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
it for you. (This is one of the features that needs the Claude key from Step 1.)

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

Here's what you'll find:

- **Net Worth** — your total wealth (everything you own, like cash, savings, and
  investments). Green is good.
- **Cash Balance** — money on hand. See a little ✏️ pencil next to it? Click it, type your
  current cash, and save to keep it accurate.
- **Portfolio Value** — what your investments are worth right now, using live stock prices.
  (It may say *"Fetching…"* for a moment while it looks up prices.)
- **Net Worth Over Time** — a chart showing whether your wealth is trending up or down. It
  fills in as you use the app, so it may look empty at first — that's normal.
- **Net Worth Breakdown** — a colorful donut showing how your money is split between cash,
  savings, and different investment types.
- **Monthly Net Cash Flow** — bars for the last six months. Green means you earned more
  than you spent that month; red means you spent more.
- **Goal Progress** — a quick look at how close you are on each savings goal.

### Get AI insights (and ask questions)

If you set up your Claude key, scroll to the **AI Insights** card and click **Generate
Insights**. In a few seconds you'll get a few plain-English observations about your money
(like "You spent 35% of your budget on groceries this month").

Below that, there's a chat box. Type a real question — *"Where am I overspending?"* — and
press **Send** to get an answer. Want fresh insights later? Just click **Refresh**.

> No key set up yet? You'll see a note inviting you to add one in Settings. Everything
> else on the Dashboard still works.

---

## Finances — your bank account

**What it's for:** This tab is all about your **bank account** — your paycheck coming in,
your rent and bills going out, money you move to savings. It's the income-and-expenses side
of your life.

What you can do here:

- **See the big picture** — charts compare your income against your expenses over the last
  six months, with running totals on the side.
- **Add a transaction** — click **+ Add Transaction** for anything you want to enter by
  hand.
- **Upload a statement** — the **Upload Bank Statement** button (see [Step 2](#step-2-get-your-money-data-in)
  above).
- **Tidy up your transaction list** — the table at the bottom shows every transaction:
  - **Change a category** — click the colored category tag and pick a better one.
  - **Link a savings transfer to an account** — for money you moved to savings, click
    **+ Link account** to connect it to one of your savings accounts.
  - **Delete something** — click the **✕** on its row.
- **Filter the view** — use the dropdowns to show just one month, or just income, or just
  expenses, when the list gets long.

---

## Spend Analyzer — your credit card spending

**What it's for:** This is your **credit card** detective. It helps you see exactly where
your money goes — which stores, which categories — and lets you set spending limits so you
can rein things in.

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
  your Claude key).

### Set spending limits (budgets)

Once you set budget caps, a tracking table shows each category, your limit, what you've
spent in the last 30 days, and how much is left. The bar turns **yellow** as you approach
your limit and **red** if you go over — an easy visual gut-check. To change a limit, just
click the number and type a new one.

### Build a budget with help — the Budget Builder 🪄

**Why use it:** Not sure what your limits *should* be? The Budget Builder looks at your
actual spending and your goals, then suggests a sensible budget for you.

> **One thing first:** you need at least one goal set up (see the [Goals](#goals--what-youre-saving-toward)
> tab), and your uncategorized transactions should be cleaned up. The app will nudge you if
> either isn't ready.

1. Click the **Budget Builder** button (look for the sparkles ✨).
2. **Confirm your monthly income.** It'll pre-fill this from your Settings or from your
   recent deposits — adjust it if needed.
3. **Pick a pace:** **Aggressive 🔥** (save hard), **Balanced ⚖️**, or **Comfortable 😌**
   (easier on yourself).
4. **Mention any one-off expenses** to ignore, like "car repair $1,400 in March," so they
   don't throw off the plan. (Optional.)
5. Click **Generate My Budget** and wait a few seconds.
6. **Review the suggestions.** You'll see a recommended limit for each category, plus a
   short explanation of the reasoning. Tweak any number you don't like.
7. Happy with it? Click **Accept & Save Budget**. Your new limits now show up in the budget
   tracker above. Don't like it? Click **Start Over**.

### Insights and chat

Just like the Dashboard, there's a **Generate Insights** button and a chat box here too —
ask things like *"What should I cut to save more this month?"*

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

---

## Goals — what you're saving toward

**What it's for:** This is the motivating part — set a target (an emergency fund, a vacation,
a house down payment) and watch yourself get closer.

### Create a goal

1. Click **New Goal**.
2. Fill in:
   - **Goal name** — like "Emergency Fund."
   - **Target amount** — how much you want to save.
   - **Target date** — when you'd like to hit it.
   - **Monthly savings** — how much you plan to put toward it each month (optional, but it
     powers the timeline estimate).
3. Click **Create Goal**.

Each goal shows up as a card with a progress bar, the percentage you've reached, and — if
you entered a monthly amount — a friendly estimate like *"~12 months to go."*

### Keeping a goal updated

- **Added some money?** Type the amount in the **Add amount…** box on the card and click
  **Add Funds**. The progress bar jumps forward. 📈
- **Need to change something?** Click **Edit** to adjust the target or date, then **Save**.
- **Want advice?** Click **Get AI Analysis** for thoughts on your goal, and use the chat box
  to ask things like *"How can I reach this faster?"* (needs your Claude key).
- **Done with a goal?** Click **Delete** to remove it.

---

## Settings — your preferences

**What it's for:** A small control panel for the handful of things you set once and forget.

- **Claude API Key** — add or replace your AI key (see [Step 1](#step-1-get-set-up-do-this-once)).
  A green **Configured ✓** badge means you're good to go.
- **Monthly Income Baseline** — your usual take-home pay. The Budget Builder uses this to
  make smarter suggestions. Type it in and click **Save**.
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
- **When in doubt, just try it.** Almost everything can be deleted and re-done. Click around
  and get comfortable — it's your dashboard. 😊

---

*Happy budgeting!*
