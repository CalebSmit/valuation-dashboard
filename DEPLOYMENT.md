# Valuation Dashboard Deployment Guide

## Supported Modes

1. Local desktop development
2. Hosted deployment with backend-owned provider keys

## Environment Variables

Copy `.env.example` and provide values through your process manager, host, or shell:

- `VALUATION_DASHBOARD_BACKEND_HOST`
- `VALUATION_DASHBOARD_BACKEND_PORT`
- `VALUATION_DASHBOARD_FRONTEND_PORT`
- `VALUATION_DASHBOARD_ALLOWED_ORIGINS`
- `ANTHROPIC_API_KEY`
- `PERPLEXITY_API_KEY`
- `GEMINI_API_KEY`

## Local Verification

1. Run `VERIFY_DASHBOARD.bat`
2. Start the backend with `py -m uvicorn main:app --host 127.0.0.1 --port 8000`
3. Start the frontend with `npm run dev`

## Production Notes

1. Set `VALUATION_DASHBOARD_ALLOWED_ORIGINS` to the full list of frontend origins.
2. Prefer backend-owned provider keys for shared or hosted usage.
3. Run frontend tests and production build before every release.
4. Confirm `/api/health` returns status `ok` before exposing the frontend.
