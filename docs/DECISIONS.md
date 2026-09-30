# DECISIONS

Numbered trade-offs, in the order they mattered. Newest last.

## 1. Next.js 16.3.7 (PRD baseline said “Next 15”)
`create-next-app` now ships Next 16. Consequences accepted: async `params`/`searchParams` promises, `next lint` removed (script calls `eslint` directly), Turbopack build default. Breaking changes checked against `node_modules/next/dist/docs/`.

## 2. Tailwind v4 + shadcn/ui on **Base UI** (`style: base-nova`)
2026 shadcn defaults: no Radix, no `asChild` prop, `cn` from the `cn` package, CSS-first config in `globals.css`. Components used: button, input, card, badge, progress, skeleton, separator, accordion, sheet, tooltip. Links styled with `buttonVariants({...})` instead of `asChild`.

## 3. Dark-only “forensic” theme
PRD describes a console/terminal aesthetic. The `.dark` class is set on `<html>` in the layout; `:root` mirrors it so components never flip to a light palette. Custom tokens: `--risk-clear/warn/high/info` surfaced as `text-risk-*` utilities for verdict coloring.

## 4. NDJSON instead of SSE
Both streaming endpoints emit newline-delimited JSON. Rationale: each event is already a discrete JSON object (no `data:` framing); the client parser is ~20 lines over `fetch` + `ReadableStream`; NDJSON survives proxies that buffer EventSource; `X-Accel-Buffering: no` added anyway.

## 5. Two-phase UX: analyze first, verdict second
`/api/analyze` is pure determinism (no key needed) — the graph, score, paths and gauges render in ~4 s. `/api/verdict` then streams on top. Users see value before the LLM starts, and a dead LLM can never block the deterministic result.

## 6. LLM guardrail ladder (PRD §5, implemented literally)
`extractJson → Zod → path ⊆ graph → no-path-no-accusation → insufficient-evidence strictness → score sanity`. On failure: one corrective retry carrying the exact rejection reason → model hops (`openrouter/free` → `nvidia/nemotron-3-super-120b-a12b:free` → `inclusionai/ling-3.0-flash-sante:free`) → `localVerdict`. `done` is guaranteed; `source` tells the truth (`llm | local | fallback`).

## 7. Verdict engine config
`resolveEngine()` reads `VERDICT_MODE` (`auto|llm|local`), `OPENROUTER_API_KEY`, `OPENAI_API_KEY`/`OPENAI_BASE_URL`, `VERDICT_MODEL`. No keys → deterministic local verdict (still streamed, same schema). Temperature 0, `maxOutputTokens 700`.

## 8. Test keys never touch the repo
`.gitignore` has `.env*` + `!.env.example`. `.env.example` holds placeholders only. Any shared/test key belongs in `.env.local` (local) and should be rotated after use.

## 9. Blockscout realities (recorded fixtures, not docs)
- **`limit` query param is rejected** (400/422) on this instance → removed; pagination follows `next_page_params` only.
- Endpoint is `/api/v2/addresses/{a}/token-transfers`, **not** `/transfers` as the PRD wrote.
- `total.value` can be `null` in real transfer rows → schema is `nullish`, mapping defaults to `"0"`.
- `token` can be missing on odd rows → skipped defensively.
- Full response shapes pinned in `src/lib/schemas.ts`, parsed against `test/fixtures/*.json` in CI (**schema-drift guard**).

## 10. Coverage thresholds scoped to the deterministic core
Network/orchestration files (`fetch.ts`, `pipeline.ts`, `cache.ts`, `ai/verdict.ts`, `client-storage.ts`) are excluded from unit coverage thresholds — mocking HTTP would test the mock. They are covered by `scripts/smoke.mjs` against live services. The included core runs at ~96% stmts / ~87% branches with thresholds 80/80/70/80.

## 11. Layout algorithm: dagre, client-side
`@dagrejs/dagre` (maintained fork, ships its own types — `@types/dagre` removed) computes `LR` ranks in a `useMemo`; React Flow renders interactively (zoom/pan/click). Cited-path edges get `MarkerType.ArrowClosed` + animation; nodes dim outside the path when a verdict cites one.

## 12. State resets via render-phase adjustment
React 19 lint (`react-hooks/set-state-in-effect`) forbids synchronous `setState` in effects. `AnalysisView` keys off `address|hops|runId` and resets during render (documented React pattern). The two genuine `localStorage`-sync effects carry targeted `eslint-disable` comments with rationale.

## 13. Hops default 1, toggle in UI
`hops` schema defaults to 1 (fast path within budget); 2 hops seeds ≤ 8 counterparties and is labeled as slower/broader in the UI.

## 14. Latency honesty
Latency chips show real measured `fetch/score/verdict/total`; p95 comes from up to 20 samples in `localStorage` (≥3 samples required). No fake timers, no smoothing.
