# Dashboard Quickstart

The dashboard is live at **[https://valuation-dashboard-f2f.pages.dev](https://valuation-dashboard-f2f.pages.dev)** — no installation required.

## Using the Live App

1. Open [https://valuation-dashboard-f2f.pages.dev](https://valuation-dashboard-f2f.pages.dev)
2. If you see a **"Connecting to server…"** banner, the backend is waking up from sleep (Render free tier). Wait ~30 seconds.
3. Click **Settings** and enter your **Anthropic API key** (required on first use)
4. Type a ticker symbol (e.g. `AAPL`, `NVDA`, `JPM`) and click **ANALYZE**
5. The AI agent runs for 30–90 seconds, then the full dashboard appears

## Local Development Setup

Only needed if you want to run the app on your own machine.

### Prerequisites
- Python 3.12+
- Node.js 18+
- An Anthropic API key

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/CalebSmit/valuation-dashboard.git
cd valuation-dashboard

# 2. Start the backend
cd backend
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# 3. Start the frontend (new terminal)
cd frontend
npm install
npm run dev
# → Open http://localhost:5173
```

On first load, click Settings and enter your API key. Then enter a ticker and click ANALYZE.

## Verification

```bash
cd frontend
npm run test   # unit tests
npm run build  # TypeScript + production build check
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for full Cloudflare Pages + Render setup.
