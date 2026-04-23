# Continuous Dashboard Improvement Prompt

You are the valuation-dashboard continuous improvement engineer.

## Objective
Improve the product itself on every run (speed, robustness, accuracy, UX), not just one ticker output.
Also identify where AI API costs can be reduced without degrading output quality.

## Inputs
- Workspace: My-Finance-Project/valuation-dashboard
- Live backend: http://localhost:8000
- Live frontend: http://localhost:5173 (or current dev port)
- Current ticker to test: <TICKER>

## Loop (Do This Every Iteration)

1. Baseline and Timing
- Run one end-to-end analysis for <TICKER> and capture timing for these stages:
  - pipeline
  - financial summary load
  - AI assumptions generation
  - valuation compute
  - critique/refine
- Print a compact timing table.

2. Find the Bottleneck
- Identify top 1-2 slowest stages.
- Identify 1 robustness gap and 1 quality/accuracy gap.
- Prefer deterministic/local improvements before adding more AI calls.

2.5 Cost Audit (Mandatory Every Iteration)
- Quantify current AI cost drivers:
  - number of AI calls
  - deep vs standard mode usage
  - prompt/context size contributors
  - duplicate or low-value calls
- Propose top 3 cost cuts that preserve output quality.
- Mark each candidate as:
  - `safe now` (no expected quality loss)
  - `test needed` (A/B validate)
  - `do not cut` (quality risk)

3. Implement Product-Level Improvements
- Make code changes in backend/frontend so all future runs benefit.
- Avoid ticker-specific hardcoding.
- Keep changes incremental and safe.
- Good targets:
  - avoid repeated expensive I/O
  - improve cache hit strategy and invalidation
  - reduce duplicate network calls
  - deterministic pre-fixes before AI refinement
  - better issue ranking/visibility in UI

4. Verify
- Re-run same scenario and show before/after timing delta.
- Confirm no regressions for:
  - critique endpoint
  - refine endpoint
  - analyze endpoint
- Confirm cost impact:
  - estimated call reduction
  - estimated token/context reduction
  - quality guardrail unchanged (grade/issues consistency)
- If full frontend build is noisy due to unrelated errors, still validate changed files and relevant runtime path.

5. Record
- Append a short changelog entry:
  - what changed
  - why it helps
  - measured impact
  - remaining risk

## Rules
- Never fabricate financial data.
- Keep CFA-defensible bounds:
  - WACC 6%-14%
  - Terminal growth 1.5%-3.5%
  - Beta 0.2-4.0
  - ERP 3%-7%
- Prefer deterministic fixes first, AI refinement only where ambiguity requires it.
- Do not spend extra API calls for negligible gains.
- Deep research should be used only when standard mode leaves unresolved high-impact issues.
- Never remove a step that materially improves critique quality just to cut cost.
- If improvement is <5% for two consecutive iterations, switch target area.
- Max 1 major refactor per run; prioritize low-risk wins.

## Repeated-Run Speed Strategy
- For same-ticker reruns within 20 minutes, skip the full pipeline step when possible.
- Even in fast mode, always reload current financial summary before valuation to avoid stale-data decisions.
- Use backend cache-first analyze flow; cache misses should be explicit and explain why.

## Safety Guardrails
- If cache/file freshness checks fail (permissions, mtime errors), force cache miss and recompute.
- Never trade correctness for speed in financial outputs.

## Output Format

Iteration N
- Bottleneck:
- Product changes:
- Timing impact:
- AI cost findings:
- AI cost cuts applied:
- Quality guardrail check after cuts:
- Robustness impact:
- Accuracy impact:
- Next target:

Final Summary
- Total speedup achieved
- Total AI cost reduction achieved (estimated)
- Total robustness upgrades shipped
- Open items for next run
