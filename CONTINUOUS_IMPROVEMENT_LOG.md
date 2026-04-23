# Continuous Improvement Log

## 2026-04-01 Iteration 1
- What changed: `analyze` now checks same-day cache before enforcing API-key availability; cache-hit reruns can succeed without provider credentials. Added mtime-keyed in-process summary cache in `financial_summarizer` with thread-safe lock to reduce repeated extraction work.
- Why it helps: Improves robustness for repeated local reruns, prevents unnecessary API-gated failures, and reduces repeated heavy extraction overhead for unchanged `raw_data.xlsx`.
- Measured impact: `POST /api/analyze/AAPL` (deep mode, no key configured) moved from HTTP 400 to HTTP 200 cache-hit path with step `Found cached analysis from today`. `GET /api/financials/summary` warm average improved from ~2317 ms to ~2066 ms (~10.8% faster).
- Remaining risk: First-call summary latency remains high (~6.6s cold start), and valuation compute remains frontend-side so backend-only timing cannot fully isolate client compute costs.

## 2026-04-01 Iteration 2
- What changed: Added persisted summary cache in `financial_summarizer` keyed by `raw_data.xlsx` mtime+size with atomic writes (`os.replace`) and strict signature checks. Added refine short-circuit in `refine_engine` to skip paid AI refinement when unresolved issues are info-only after deterministic fixes.
- Why it helps: Summary extraction now reuses a safe on-disk cache across process restarts and reruns, while refine avoids low-value AI calls that do not materially change CFA-grade outcomes.
- Measured impact: In the same AAPL scenario, `GET /api/financials/summary` improved from 4.365s baseline to 2.801s warm post-change (~35.8% faster). `POST /api/refine` now returns rationale `Only info-level residual issues remain ... skipped AI refinement` for info-only issues, preventing unnecessary paid calls.
- Remaining risk: Cold-start extraction is still expensive on first read after data refresh, and current benchmark path could not directly measure frontend valuation compute time from backend-only scripts.
