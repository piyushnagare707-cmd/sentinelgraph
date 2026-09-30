# Demo script & recorded run

## Running the demo

```bash
npm install
cp .env.example .env.local      # add OPENROUTER_API_KEY for LLM verdicts (optional)
npm run dev                     # or: npm run build && npm start
```

Open <http://localhost:3000> and either paste any Base Sepolia address or click a demo chip:

| Address | Why it demos well |
|---|---|
| `0xFaEc9cDC3Ef75713b48f46057B98BA04885e3391` | busy EOA — full progress rail, rich graph |
| `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | USDC `FiatTokenProxy` contract — deployer-reuse angle, verified labels |
| `0x1c26B1021CaFC79055422aE3e7409F431F5224Ad` | second wallet — compare verdicts side by side |

## 90-second walkthrough

1. **Landing** — paste address (or click a demo chip). Optionally flip `1 hop` / `2 hops` on the results page.
2. **Progress rail** — watch `Fetching on-chain data` (live transfer/tx counts) → `Building transfer graph` → `Scoring 5 heuristics` → `LLM verdict`. The graph and score gauge appear *before* the verdict finishes.
3. **Verdict panel** — score gauge (colored by verdict), verdict chip, confidence bar, reasons, **cited evidence path** (`0xabc… → 0xdef…`), next-best-action badge, and provenance (`LLM verdict · model · attempts`).
4. **Evidence graph** — click any node for the drawer (risk, stats, all touching transfers, Blockscout link). When the verdict arrives, its cited path lights up amber with animated edges; uncited nodes dim.
5. **Reasoning stream** — raw model tokens as they stream; if the guardrail rejects an answer you'll see the amber `Schema guardrail rejected the first answer — retrying…` notice.
6. **Suspicious paths** — the *deterministic* BFS paths with reason + risk (independent of any LLM).
7. **Latency strip** — fetch / score / verdict / total chips + rolling p95 from previous runs.

## Automated smoke test

With a server running (`npm start` or `npm run dev`):

```bash
npm run smoke                                    # default demo address
npm run smoke -- http://localhost:3000 0xYour…   # any address
```

Drives `POST /api/analyze` and `POST /api/verdict` over the real streaming protocols and hits both pages.

## Recorded run (2026-09-30, `npm start`, default demo address)

```
ANALYZE 0xFaEc9cDC3Ef75713b48f46057B98BA04885e3391
  stage: fetching
  progress: {"transfers":50,…} … {"transfers":200,…} + tx batches to 100
  stage: graph
  stage: scoring
  result: score=37 nodes=58 edges=70 paths=5
          latency={"fetch":3910,"score":24,"total":3935}
VERDICT
  model: openrouter/free
  retry: no JSON object found in response          ← guardrail fired on attempt 1
  model: openrouter/free                            ← corrective retry succeeded
  verdict: suspicious · score 37 (matches deterministic) · confidence 0.9
           evidencePath: [0xfaec…3391 → 0xf1c3…096d]
           nextBestAction: monitor · source llm · attempts 2 · 12450 ms
  reasons: "Strong fan asymmetry 0.91 with 67 outgoing transfers"
           "High age risk with 57 recent counterparties"
           "Flows to multiple very new addresses including 0xf1c3c6… seen only 79 blocks ago"
E2E total: 16702ms (within 25s budget)
page /                       -> 200
page /0xFaEc…3391            -> 200
```

Notable: this run exercised the **full guardrail path live** — first LLM answer wasn't JSON, was rejected with a precise reason, the corrective retry produced a schema-valid verdict whose evidence path contains only real graph nodes.

Re-runs vary: free-tier model latency lands anywhere in **12–20 s** (budget 25 s), and occasionally both attempts come back empty/invalid — the ladder then finishes with `source: "fallback"` and a labeled deterministic verdict in the stream (two token events), which is exactly the designed degradation.

### Expected without an LLM key

The verdict stream emits tokens containing the local verdict JSON and finishes with `source: "local"` — everything else is identical. Force it with `VERDICT_MODE=local`.
