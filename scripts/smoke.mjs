// Live smoke test: POST /api/analyze + /api/verdict against a running server.
// Usage: node scripts/smoke.mjs [baseURL] [address]
const BASE = process.argv[2] ?? "http://localhost:3000";
const ADDR = process.argv[3] ?? "0xFaEc9cDC3Ef75713b48f46057B98BA04885e3391";

async function consumeNdjson(res, onLine) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no response body");
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) await onLine(JSON.parse(line));
    }
  }
  if (buf.trim()) await onLine(JSON.parse(buf.trim()));
}

const t0 = Date.now();
console.log(`ANALYZE ${ADDR} @ ${BASE}`);
const res = await fetch(`${BASE}/api/analyze`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: ADDR, hops: 1 }),
});
if (!res.ok) {
  console.error("analyze HTTP", res.status, await res.text());
  process.exit(1);
}
let result = null;
await consumeNdjson(res, (ev) => {
  if (ev.type === "stage") console.log("  stage:", ev.stage);
  else if (ev.type === "progress") console.log("  progress:", JSON.stringify(ev));
  else if (ev.type === "error") {
    console.error("  stream error:", ev);
    process.exit(1);
  } else if (ev.type === "result") {
    result = ev.data;
    console.log(
      `  result: score=${ev.data.score} nodes=${ev.data.graph.nodes.length} edges=${ev.data.graph.edges.length} paths=${ev.data.pathMeta.length} latency=${JSON.stringify(ev.data.latency)}`,
    );
  }
});
if (!result) {
  console.error("no result event received");
  process.exit(1);
}

console.log("VERDICT");
const res2 = await fetch(`${BASE}/api/verdict`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    address: result.address,
    score: result.score,
    breakdown: result.breakdown,
    details: result.details,
    paths: result.paths,
    pathMeta: result.pathMeta,
    nodes: result.graph.nodes.map((n) => ({ id: n.id, label: n.label })),
  }),
});
if (!res2.ok) {
  console.error("verdict HTTP", res2.status, await res2.text());
  process.exit(1);
}
let done = null;
let tokens = 0;
await consumeNdjson(res2, (ev) => {
  if (ev.type === "model") console.log("  model:", ev.model);
  else if (ev.type === "token") tokens++;
  else if (ev.type === "retry") console.log("  retry:", ev.reason);
  else if (ev.type === "error") console.error("  stream error:", ev);
  else if (ev.type === "done") done = ev;
});
console.log("  streamed token events:", tokens);
if (!done) {
  console.error("no done event received");
  process.exit(1);
}
console.log(
  "  verdict:",
  JSON.stringify(
    {
      verdict: done.verdict.verdict,
      score: done.verdict.score,
      confidence: done.verdict.confidence,
      evidencePath: done.verdict.evidencePath,
      nextBestAction: done.verdict.nextBestAction,
      source: done.source,
      model: done.model,
      attempts: done.attempts,
      latencyMs: done.latencyMs,
    },
    null,
    1,
  ),
);
console.log("  reasons:", done.verdict.reasons);
const total = Date.now() - t0;
console.log(`E2E total: ${total}ms ${total <= 25000 ? "(within 25s budget)" : "(OVER 25s BUDGET)"}`);

for (const path of ["/", `/${ADDR}`]) {
  const page = await fetch(`${BASE}${path}`);
  console.log(`page ${path} -> ${page.status}`);
}
