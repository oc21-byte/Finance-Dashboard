# Getting Started — A Step-by-Step Setup Guide

*For people who've never done this before — no tech experience needed.*

Welcome! This guide walks you through getting the Finance Dashboard running on your computer
for the very first time. Follow the steps in order and you'll be up and running in about 15
minutes.

---

## What you'll need

- A **Mac or Windows PC**
- An **internet connection** (just for the initial setup — the app itself works offline after that)
- About **15 minutes** of your time

---

## Part 1 — Install Node.js (the engine the app runs on)

The dashboard isn't a regular app you download from an app store. It's a web app that runs
locally, and it needs a small program called **Node.js** to power it. Think of Node.js as
the engine under the hood — you install it once and forget about it.

### On a Mac

1. Go to [nodejs.org](https://nodejs.org/) in your browser.
2. Click the big green button that says **"LTS"** (not "Current") — LTS means it's the
   stable, recommended version.
3. Open the downloaded file (it'll be something like `node-v20.x.x.pkg`) and follow the
   installer. Just click **Continue → Continue → Install** and enter your Mac password when
   asked.

### On Windows

1. Go to [nodejs.org](https://nodejs.org/) in your browser.
2. Click the **"LTS"** download button.
3. Open the `.msi` installer file and click through the wizard. Leave all the options at
   their defaults and click **Next → Next → Install**.

### Check that it worked

**Mac:** Open the **Terminal** app (search for "Terminal" with Spotlight — press ⌘ Space
and type "Terminal") and type this, then press Enter:

```
node --version
```

**Windows:** Open **Command Prompt** (press the Windows key, type "cmd", press Enter) and
type the same thing.

If you see something like `v20.11.0` printed back, you're good. If you see an error, try
restarting your computer and running it again.

---

## Part 2 — Get the app on your computer

You need to download the app's files. There are two ways — pick the one that sounds less
scary.

### Option A: GitHub Desktop (easier — recommended)

GitHub Desktop is a simple app for downloading and updating code projects without touching
the terminal.

1. Go to [desktop.github.com](https://desktop.github.com/) and click **Download for Mac**
   (or Windows). Install it like any normal app.
2. Open GitHub Desktop and sign in with a GitHub account. (If you don't have one, click
   **Create your free account** — it's free and takes two minutes.)
3. In the top menu, click **File → Clone Repository**.
4. Click the **URL** tab.
5. Paste in the address of the project (whoever shared this guide with you can give you the
   URL — it looks like `https://github.com/someone/finance-dashboard`).
6. Under **Local Path**, choose where on your computer you want to save the files — your
   Desktop or Documents folder works great.
7. Click **Clone**.

The app will download. You'll see a folder appear at the location you chose. That folder is
your app.

### Option B: Terminal / command line

If you're comfortable with a terminal, just run:

```bash
git clone https://github.com/oc21-byte/finance-dashboard.git
cd finance-dashboard
```

---

## Part 3 — Install the app's pieces

The app comes with a list of small code libraries it needs. You install them all with one
command. You only ever need to do this step once (and again after major updates).

**Mac:** Open **Terminal** and navigate to the app folder. The easiest way is to:
1. Open a new Terminal window.
2. Type `cd ` (with a space after it — don't press Enter yet).
3. Open Finder, find the folder you just cloned, and **drag the folder onto the Terminal window**.
   The path to the folder will appear automatically.
4. Now press **Enter**.

**Windows:** Open the folder in File Explorer, then click the address bar at the top, type
`cmd`, and press Enter. A Command Prompt window will open already pointing to that folder.

Now type this and press Enter:

```
npm install
```

You'll see a lot of text scroll by — this is completely normal. It's just downloading small
pieces of code the app needs. When it stops and you see a prompt (`$` on Mac, `>` on
Windows), it's done.

---

## Part 4 — Launch the app

Every time you want to use the app, you'll do this:

1. Open Terminal (Mac) or Command Prompt (Windows) inside the app folder (same way as Part 3).
2. Type this and press Enter:

```
npm run dev
```

3. You'll see some startup text. When you see something like:

```
  ➜  Local:   http://localhost:5173/
```

…the app is ready. Open your web browser and go to:

```
http://localhost:5173
```

That's it — the dashboard opens in your browser, just like any website.

> **Important:** Keep the Terminal / Command Prompt window open while you're using the app.
> The window is what's running everything. Close it and the app stops. When you're done for
> the day, you can close the window (or press **Ctrl + C** inside it first to stop cleanly).

> **VS Code users:** You can open an integrated terminal inside VS Code with `` Ctrl+` ``
> (backtick) and run `npm run dev` from there. The app stays running in that terminal panel.

---

## Part 5 — Get an AI key (pick one)

The dashboard's smartest features — automatically reading PDF statements, writing plain-English
insights about your spending, and building a personalized budget — use an AI service in the
background. You connect it with an "API key," which is just a password-like code that
identifies your account.

You only need **one** key. Pick whichever AI service you prefer.

---

### Option A: Claude (Anthropic) — *recommended for PDF reading*

Claude is Anthropic's AI. It's the best option for reading messy PDF bank statements.

**Step 1 — Create an account**
1. Go to [console.anthropic.com](https://console.anthropic.com/).
2. Click **Sign Up**, enter your email address, and verify it.
3. You'll land on the Anthropic Console dashboard.

**Step 2 — Create an API key**
1. In the left sidebar, click **API Keys**.
2. Click the **+ Create Key** button.
3. Give it a name (like "Finance Dashboard") and click **Create Key**.
4. A long code starting with `sk-ant-…` will appear. **Copy it now** — you won't be able
   to see it again after you close this window. Paste it somewhere temporary (like a Notes
   app) so you don't lose it.

**Step 3 — Add credits**
Anthropic charges tiny amounts per use (typically a fraction of a cent for most features —
see the [cost breakdown in the User Guide](USER_GUIDE.md#what-do-the-ai-features-cost)).
You need to add credits before it'll work:

1. In the left sidebar, click **Settings**, then **Billing**.
2. Click **Add credits**.
3. Enter $5 and a payment card. That $5 will last months of normal personal use.

**Step 4 — Add the key to the dashboard**
1. Open the dashboard in your browser (at `http://localhost:5173`).
2. Click **Settings** (the ⚙ gear icon, top-right).
3. Under **AI Provider**, make sure **Claude** is selected.
4. Find the **Claude API Key** field and paste your key.
5. Click **Save Key**.
6. You'll see a green **Configured ✓** badge. Done!

---

### Option B: ChatGPT (OpenAI)

OpenAI makes ChatGPT. If you already have an OpenAI account, this is the quickest option.

**Step 1 — Create an account**
1. Go to [platform.openai.com](https://platform.openai.com/).
2. Click **Sign Up** and follow the prompts to create an account.

**Step 2 — Create an API key**
1. Once logged in, click your profile icon (top-right) → **API Keys**, or go directly to
   [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. Click **+ Create new secret key**.
3. Give it a name and click **Create secret key**.
4. A code starting with `sk-…` will appear. **Copy it immediately** — it won't be shown again.

**Step 3 — Add credits**
1. In the left sidebar, click **Billing**.
2. Click **Add to credit balance**.
3. Enter $5 and a payment card. That covers months of personal use.

**Step 4 — Add the key to the dashboard**
1. Open the dashboard at `http://localhost:5173`.
2. Click **Settings** (⚙ top-right).
3. Under **AI Provider**, select **ChatGPT**.
4. Paste your key into the **OpenAI API Key** field.
5. Click **Save Key**.
6. You'll see a green **Configured ✓** badge. Done!

---

## Part 6 — Your first few minutes

The app is running and your AI key is in. Here's what to do next:

1. **Set your monthly income** — go to Settings and enter your usual take-home pay under
   **Monthly Income Baseline**. This helps the Budget Builder make sensible suggestions later.

2. **Upload your first bank statement** — go to the **Finances** tab and click
   **Upload Bank Statement**. Download a CSV export from your online banking and drop it in.
   The app will walk you through a one-time setup for that account, then it'll be instant
   on every future upload. (See [Step 2 of the User Guide](USER_GUIDE.md#step-2-get-your-money-data-in)
   for the full walkthrough.)

3. **Upload a credit card statement** — same idea, but on the **Spend Analyzer** tab.

4. **Check the Dashboard** — once you have some transactions in, the Dashboard will start
   showing your net worth trend, cash flow chart, and (if you set up an AI key) some written
   insights about your spending.

5. **Set some goals** — head to the **Goals** tab and try the Emergency Fund Calculator at
   the top. It uses your real spending to suggest a target automatically.

That's it — you're set up. Come back to the [User Guide](USER_GUIDE.md) any time you want
to dig deeper into a specific feature.

---

## Troubleshooting

**"Port 5173 is already in use"**
Another copy of the app is already running in a different terminal window. Find that window
and close it (or press Ctrl + C inside it), then run `npm run dev` again.

**"npm: command not found" (or "node is not recognized")**
Node.js didn't install correctly. Go back to Part 1, reinstall it, restart your computer,
and try again.

**"Error fetching stock prices"**
This is normal — the live stock price lookup occasionally fails. Refresh the page or wait
a minute and try again. It doesn't affect any other features.

**The app isn't saving my changes**
Make sure the Terminal window running `npm run dev` is still open. If you accidentally
closed it, just run `npm run dev` again — your data is safe in `data/db.json` and will
reload automatically.

**Something looks wrong after an update**
If the app behaves strangely after pulling new code, run `npm install` again (in case new
packages were added) and restart with `npm run dev`.

---

*Still stuck? Reach out to whoever shared this app with you — they'll be able to help.*
