# SentinelGraph

**Paste a Base Sepolia address → watch its transfer graph assemble live → get a deterministic 0–100 risk score from five auditable heuristics → read an LLM verdict that is *forced to cite the exact graph path* behind its claim.**

Built from PRD `HH_Goa_PRD_01_SentinelGraph`. No wallet, no signup, no API keys for the graph itself — the only optional secret is an OpenRouter/OpenAI key for the LLM verdict (the app degrades to a deterministic local verdict without one).

---

## Quickstart

```bash
npm install
cp .env.example .env.local   # optional: add OPENROUTER_API_KEY for LLM verdicts
npm run dev                  # http://localhost:3000
```

Production:

```bash
npm run build
npm run start
```

## What it does

1. **Fetch** — Blockscout (`/api/v2`) for address info, token transfers and txs; Base Sepolia RPC for the head block. Retries with backoff, a 15-minute memory+file cache, and NDJSON progress events while pages stream in.
2. **Graph** — builds a bounded transfer graph (≤60 nodes, ≤120 edges), prunes dust, links deployers, and optionally walks 2 hops from up to 8 seeds.
3. **Score** — five deterministic heuristics, weights summing to 100, all tunable in [`config/heuristics.json`](config/heuristics.json):

   | Heuristic | Default weight | Signal |
   |---|---|---|
   | Fan-out asymmetry | 25 | sink/funnel degree imbalance |
   | Account age risk | 20 | fresh target + recent counterparties (tiered) |
   | Honeypot / tax pattern | 25 | asymmetric tax-like skim legs |
   | Deployer reuse | 15 | shared contract deployer cluster |
   | Approval risk | 15 | unlimited ERC-20 approvals decoded from calldata |

4. **Paths** — BFS from the target to high-risk nodes produces deterministic *suspicious paths* (risk desc, length asc, lexicographic tie-break).
5. **Verdict** — an LLM (streamed, temperature 0) must return a schema-valid verdict whose `evidencePath` references **only nodes that exist in the graph**. Invalid output → one corrective retry → deterministic local fallback. The user always gets a valid verdict.
6. **UI** — landing page, live progress rail, score gauge, verdict panel with confidence + next-best-action, interactive evidence graph (dagre layout, cited path highlighted), node drawer, streaming reasoning panel, latency strip with p95.

## The five screens (PRD §6)

| Route | What you see |
|---|---|
| `/` | Address bar, demo addresses, how-it-works, heuristic cards |
| `/{address}` | Progress rail while analyzing → verdict panel, evidence graph, heuristic accordion, suspicious paths, reasoning stream, latency |

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | dev server (Turbopack) |
| `npm run build` / `npm start` | production build / serve |
| `npm run lint` | ESLint (Next + React hooks rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit suite |
| `npm run coverage` | coverage with thresholds (80/80/70/80 on the deterministic core) |
| `npm run smoke` | live e2e against a running server (analyze + verdict + pages) |

Live smoke (after `npm start`):

```bash
npm run smoke                                    # default demo address
npm run smoke -- http://localhost:3000 0xYour…   # custom target
```

## Environment

`.env.example` documents every variable. Highlights:

| Var | Required? | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | optional | LLM verdicts via OpenRouter (recommended) |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | optional | alternative OpenAI-compatible endpoint |
| `VERDICT_MODEL` | optional | pin/override the model chain |
| `VERDICT_MODE` | optional | `auto` (default) \| `llm` (force LLM) \| `local` (force deterministic) |

Without any key the verdict engine falls back to `localVerdict` — fully deterministic, same schema, same guardrails.

> ⚠️ Never commit `.env.local`. Rotate any key that has ever been pasted into a shared file.

## Architecture (short version)

```
browser ── POST /api/analyze ──> NDJSON: stage → progress* → result | error
         ── POST /api/verdict ──> NDJSON: model? → token* → (retry → token*) → done | error
```

- **NDJSON, not SSE** — one newline-delimited stream per phase; trivial to consume with `fetch` + `ReadableStream`, proxy-friendly (`X-Accel-Buffering: no`).
- **Guardrails in `validateVerdict`** (`src/lib/schemas.ts`): JSON extract → Zod schema → every `evidencePath` node must exist in the graph → accusation requires a non-empty path → `insufficient-evidence` forbids paths and demands `request-evidence`.
- **Deterministic fallback**: `src/lib/ai/local.ts` builds the same schema from the score + top path without any model call.

Full details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · decisions & trade-offs: [`docs/DECISIONS.md`](docs/DECISIONS.md) · recorded demo run: [`docs/DEMO.md`](docs/DEMO.md)

## Testing strategy

- **Unit (Vitest, 105 tests)** — schemas against *recorded* Blockscout fixtures (schema-drift guard in CI), graph building, all five heuristics + tie-breaks, scoring, BFS paths, local verdict, guardrails, formatting.
- **Coverage thresholds** apply to the auditable deterministic core; network/orchestration layers (`fetch`, `pipeline`, `cache`, LLM transport) are excluded from unit thresholds and verified end-to-end instead.
- **Live e2e** — `npm run smoke` drives both streaming APIs against a real server (real Blockscout, real RPC, real LLM when keyed).

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui (Base UI) · Zod 4 · @xyflow/react + dagre · Vercel AI SDK · Vitest 5 · GitHub Actions.

## Project layout

```
config/heuristics.json   auditable weights & params (change → app + tests follow)
src/lib/                 deterministic core: fetch, graph, heur/, score, path, schemas, ai/
src/app/api/             /analyze + /verdict NDJSON routes
src/components/          AnalysisView, EvidenceGraph, VerdictPanel, ProgressRail, …
test/                    unit suite + recorded fixtures
scripts/smoke.mjs        live e2e driver
docs/                    ARCHITECTURE, DEMO, DECISIONS
```

## License

MIT — see [LICENSE](LICENSE). Data © [Blockscout](https://base-sepolia.blockscout.com) / Base Sepolia RPC.
