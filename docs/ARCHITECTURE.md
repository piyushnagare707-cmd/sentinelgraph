# Architecture

SentinelGraph is a Next.js App Router application with a **pure deterministic core** (`src/lib`) and two **NDJSON streaming endpoints**. The LLM is deliberately quarantined behind schema guardrails: it may *describe* the graph, never *invent* it.

```
┌─────────────────────────── browser (React client) ───────────────────────────┐
│  AddressBar → /[addr] → AnalysisView                                        │
│    ├─ fetch /api/analyze  ── NDJSON: stage → progress* → result | error      │
│    ├─ fetch /api/verdict  ── NDJSON: model? → token* → retry? → done | error │
│    ├─ EvidenceGraph (@xyflow/react + dagre)  ← highlighted cited path        │
│    └─ VerdictPanel / ReasoningStream / ProgressRail / LatencyMeter           │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼───────────────────────────────────────┐
│  POST /api/analyze                     POST /api/verdict                    │
│    analyze(address, hops)                generateVerdict(req)                │
│      ├─ fetch.ts  (Blockscout+RPC)         ├─ buildUserPrompt (score+paths)  │
│      ├─ graph.ts  (build+prune)            ├─ streamText (temperature 0)     │
│      ├─ heur/*    (5 heuristics)           ├─ validateVerdict (guardrails)   │
│      ├─ score.ts  (Σ weights)              ├─ 1 corrective retry             │
│      └─ path.ts   (BFS paths)              └─ localVerdict (fallback)        │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 1. Data sources

| Source | Used for | Notes |
|---|---|---|
| `GET base-sepolia.blockscout.com/api/v2/addresses/{a}` | contract/EOA flag, deployer, tags | cached |
| `…/api/v2/addresses/{a}/token-transfers` | ERC-20/721 graph edges | **no `limit` param** (this Blockscout 400s on it — paginate via `next_page_params`) |
| `…/api/v2/addresses/{a}/transactions` | native txs, calldata for approvals | |
| `POST https://sepolia.base.org` | `eth_blockNumber`, `eth_getLogs` (deployer verification) | |

All upstream calls: timeout → retry with jittered backoff → `AppError` codes (`rate-limited`, `upstream-error`, `timeout`, `not-found`, …) mapped to HTTP status in the routes. Responses cached in memory + `.cache/` for `params.cacheTtlMs` (15 min).

**Schema-drift guard**: Blockscout response shapes are pinned as Zod schemas (`src/lib/schemas.ts`) and parsed against recorded fixtures in `test/fixtures/*.json` on every CI run — upstream shape changes break tests, not users.

## 2. Graph construction

- Nodes: every distinct address seen in transfers/txs, tagged `eoa | contract | unknown`, plus `firstSeenBlock`, scam/verified flags, deployer link.
- Edges: transfer events (`from → to`, value, token, tx, block, log index) and native txs.
- Bounds (from `config/heuristics.json`): `maxTransfers 200`, `maxNativeTx 100`, `maxNodes 60`, `maxEdges 120`.
- 2-hop mode: up to `max2HopSeeds 8` busiest counterparties are fetched and merged.
- Pruning keeps the target, high-degree nodes and recent activity; deterministic ordering everywhere (risk desc → length asc → id lexicographic).

## 3. Scoring

```
score = Σ min(weight_i, heuristic_i)   clamped to [0, 100]
```

Each heuristic (`src/lib/heur/*`) returns `{ key, value, max, summary, evidence[] }` — the UI renders exactly these strings, so the explanation a user reads *is* the code output. Weights and parameters live in `config/heuristics.json`; tests assert they sum to 100.

**Node risk + paths**: every node gets a risk from incident heuristics (`computeNodeRisks`), then BFS from the target to seeds ≥ `SEED_THRESHOLD` yields `SuspiciousPath[] { nodes, reason, risk }`. `AnalyzeResult.paths` is the `nodes` projection; `pathMeta` carries reason+risk.

## 4. Streaming contracts (NDJSON)

Both routes emit `application/x-ndjson; charset=utf-8`, one JSON object per line.

### `POST /api/analyze` — body `{ address, hops: 1|2 }`

```jsonl
{"type":"stage","stage":"fetching"}
{"type":"progress","transfers":50,"transactions":0}
{"type":"stage","graph"}
{"type":"stage","scoring"}
{"type":"result","data":{ ...AnalyzeResult }}
```
or `{"type":"error","code":"upstream-error","message":"…"}`.

### `POST /api/verdict` — body = score + breakdown + details + paths + pathMeta + nodes

```jsonl
{"type":"model","model":"openrouter/free"}
{"type":"token","text":"{\"verdict\"…"}
{"type":"retry","reason":"no JSON object found in response"}   ← optional, once
{"type":"done","verdict":{…},"source":"llm","model":"…","attempts":2,"latencyMs":12450}
```
or `{"type":"error", …}`. **`done` is guaranteed in practice**: LLM → one corrective retry → `localVerdict` (`source: "local"`) or `fallback`.

Why NDJSON instead of SSE: one request → one flat stream; trivial client parser; survives proxy buffering; events are already discrete JSON objects.

## 5. Verdict guardrails (the PRD's core promise)

`validateVerdict(text, ctx)` runs in order:

1. `extractJson` — tolerate prose around/reasoning before the JSON object.
2. Zod `VerdictSchema` — `verdict ∈ {clear, suspicious, high-risk, insufficient-evidence}`, integer `score`, `confidence ∈ [0,1]`, 1–5 reasons, `evidencePath[]`, `nextBestAction ∈ {block, monitor, request-evidence}`.
3. **Path ⊆ graph** — every `evidencePath` node must exist in the analyzed graph (lowercased). Invented addresses are rejected.
4. **No path, no accusation** — `suspicious`/`high-risk` require a non-empty `evidencePath` (`clear` may cite one optionally).
5. **Insufficient-evidence strictness** — must have empty path *and* `request-evidence`.
6. Score sanity: accusation with `score < 20` or the word "fraud" below 20 is rejected.

Failure flow: `retry` event with the precise reason → one corrective re-ask (same model, temperature 0) → if still invalid or transport fails, hop models (`openrouter/free` → `nvidia/nemotron-3-super-120b-a12b:free` → `inclusionai/ling-3.0-flash-sante:free`) → final fallback `localVerdict`.

The prompt explicitly lists the **allowed** evidence addresses (the graph nodes), which is what makes hallucinated paths fail fast.

## 6. Determinism & testability

- Pure functions for everything after I/O: `graph`, `heur/*`, `score`, `path`, `local.ts`, `validateVerdict`.
- Config object threaded explicitly (`loadHeuristicsConfig()`), tests inject fixtures.
- Vitest coverage thresholds (80/80/70/80) apply to that core; `fetch/pipeline/cache/ai-transport/client-storage` are excluded from unit thresholds because they're covered by `scripts/smoke.mjs` against live services.

## 7. Latency budget (PRD §5: ≤ 25 s)

| Phase | Budget | Measured (demo wallet, warm) |
|---|---|---|
| fetch (Blockscout+RPC, cached?) | ~15 s | 3.91 s |
| graph + score | ~100 ms | 24 ms |
| verdict (LLM incl. retry) | ~10 s | 12.45 s |
| **end-to-end** | **25 s** | **16.7 s** |

`OVERALL_BUDGET_MS = 45 s` guards the verdict engine; per-call `STREAM_TIMEOUT_MS = 30 s`. The UI shows fetch/score/verdict/total chips plus a rolling p95 from `localStorage`.

## 8. Security & privacy notes

- Addresses are public chain data; nothing else is collected. No analytics.
- API keys live only in server env (`.env.local`, gitignored); the browser only ever talks to same-origin `/api/*`.
- No logging of addresses in the LLM path (prompt built in-memory, nothing written).
- `.env*` ignored by git; `.env.example` contains placeholders only.
- External links (`Blockscout`) use `rel="noreferrer"`.
