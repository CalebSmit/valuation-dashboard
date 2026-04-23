# Dashboard Quickstart

Use this if you want the browser-based valuation workflow.

## Before You Start

1. Generate `raw_data.xlsx` from the project root with `py main.py`.
2. Install backend dependencies in `valuation-dashboard/backend`.
3. Install frontend dependencies in `valuation-dashboard/frontend`.

## Fastest Launch

1. From `valuation-dashboard`, run `START_DASHBOARD.bat`.
2. Wait for the backend health check to pass.
3. Open `http://localhost:5173`.
4. Provide a browser API key only if the backend does not already have one configured.
5. Enter a ticker and click `ANALYZE`.

## Verification

- Run `VERIFY_DASHBOARD.bat` before release work.

## Deployment

- See `DEPLOYMENT.md` for environment variables and backend-owned provider keys.
