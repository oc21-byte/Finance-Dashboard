# Finance Dashboard

A personal finance dashboard that runs entirely on your local machine. Track bank transactions, credit card spending, investments, savings goals, and net worth — all stored locally in a single JSON file with no cloud sync or third-party accounts required.

Built with React + Vite (frontend) and Express (backend), with optional Claude AI integration for transaction categorization and spending insights.

---

## Requirements

- [Node.js](https://nodejs.org/) v18 or later
- npm (comes with Node.js)
- A [Claude API key](https://console.anthropic.com/) from Anthropic (optional, but enables AI features)

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/oc21-byte/finance-dashboard.git
cd finance-dashboard
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the app

```bash
npm run dev
```

This starts both the frontend (port 5173) and backend (port 3001) together. Open your browser to:

```
http://localhost:5173
```

Your local data file (`data/db.json`) is created automatically on first run. It is git-ignored and stays on your machine only — it will never be committed or pushed.

---

## Getting updates

When new changes are pushed to the repository, pull them and reinstall dependencies in case any packages changed:

```bash
git pull
npm install
npm run dev
```

---

## Adding your Claude API key (optional)

AI features (transaction categorization, spending insights, budget builder, PDF statement parsing) require a Claude API key from Anthropic.

1. Get a key at [console.anthropic.com](https://console.anthropic.com/)
2. Go to the **Settings** tab inside the dashboard
3. Paste your key and save

The key is stored only in your local `data/db.json` and is never sent anywhere except directly to Anthropic's API from your machine.

---

## Data & privacy

All financial data lives in `data/db.json` on your computer. Nothing is synced to a server or cloud. The only outbound network requests are:

- **Anthropic API** — when you use AI features (requires your Claude API key)
- **Yahoo Finance** — to fetch live stock prices for your investment holdings

---

## Project structure

```
finance-dashboard/
├── src/              # React frontend
│   ├── pages/        # Dashboard, Finances, Investments, Goals, etc.
│   ├── components/   # Shared UI components
│   └── api/          # API client (all backend calls go through here)
├── server/
│   └── index.js      # Express backend + all API routes
├── data/
│   └── db.json       # Your local data (git-ignored)
└── package.json
```
