import Link from "next/link";
import { AddressBar } from "@/components/AddressBar";
import { DEMO_ADDRESSES } from "@/lib/demo";
import { shortAddr } from "@/lib/format";
import heuristicsConfig from "../../config/heuristics.json";

const HEURISTIC_CARDS: { key: keyof typeof heuristicsConfig.weights; title: string; blurb: string }[] = [
  {
    key: "fanAsymmetry",
    title: "Fan-out asymmetry",
    blurb: "Many inbound transfers, few outbound — a sink/funnel pattern rather than normal two-way wallet activity.",
  },
  {
    key: "ageRisk",
    title: "Account age risk",
    blurb: "Fresh addresses and recently-seen counterparties dominate the neighbourhood (tiered by block distance).",
  },
  {
    key: "honeypotTax",
    title: "Honeypot / tax pattern",
    blurb: "Asymmetric legs with a large tax-like skim match known honeypot drain structures.",
  },
  {
    key: "deployerReuse",
    title: "Deployer reuse",
    blurb: "The same deployer created other flagged contracts — shared infrastructure is a strong signal.",
  },
  {
    key: "approvalRisk",
    title: "Approval risk",
    blurb: "Unlimited ERC-20 approvals to unknown spenders, decoded straight from calldata.",
  },
];

const STEPS = [
  { n: "01", title: "Paste an address", body: "Any Base Sepolia address — EOA or contract. No wallet, no signup." },
  { n: "02", title: "Watch the graph build", body: "Live NDJSON stages stream while transfers, txs and deployer links assemble into a graph." },
  { n: "03", title: "5 auditable heuristics", body: "Deterministic 0–100 score from config/heuristics.json — change a weight, the app follows." },
  { n: "04", title: "Forced-citation verdict", body: "The LLM verdict must name an exact node path from the graph, or a guardrail rejects it." },
];

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative mx-auto w-full max-w-6xl px-4">
        <header className="flex items-center justify-between py-5">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="text-primary">◆</span> SentinelGraph
          </span>
          <a
            href="https://github.com"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            open source · MIT
          </a>
        </header>

        <section className="pb-16 pt-14 text-center">
          <p className="mb-4 inline-block rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-xs text-primary">
            Base Sepolia · Blockscout + RPC · zero API keys for the graph
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-glow-primary sm:text-6xl">
            See the risk hiding in a transfer graph.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
            Paste an address. Watch its on-chain graph assemble live, get a deterministic 0–100 score from five auditable
            heuristics, and read an LLM verdict that is <em className="not-italic text-foreground">forced to cite the exact graph path</em>{" "}
            behind its claim.
          </p>

          <div className="mx-auto mt-9 max-w-2xl text-left">
            <AddressBar />
          </div>

          <div className="mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
            {DEMO_ADDRESSES.map((d) => (
              <Link
                key={d.address}
                href={`/${d.address}`}
                title={d.blurb}
                className="group rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs transition-colors hover:border-primary/50 hover:bg-primary/10"
              >
                <span className="font-medium text-foreground">{d.label}</span>{" "}
                <span className="font-mono text-muted-foreground group-hover:text-primary">{shortAddr(d.address)}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="border-t border-border py-14">
          <h2 className="mb-8 text-center text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            How it works
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-xl border border-border bg-card/60 p-5 backdrop-blur">
                <div className="mb-3 font-mono text-xs text-primary">{s.n}</div>
                <h3 className="mb-1.5 font-semibold">{s.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border py-14">
          <h2 className="mb-2 text-center text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Five deterministic heuristics
          </h2>
          <p className="mb-8 text-center text-sm text-muted-foreground">
            Weights sum to 100 and live in <code className="font-mono text-primary">config/heuristics.json</code> — auditable, versioned, test-covered.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {HEURISTIC_CARDS.map((h) => (
              <div key={h.key} className="rounded-xl border border-border bg-card/60 p-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">{h.title}</h3>
                  <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
                    {heuristicsConfig.weights[h.key]}%
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{h.blurb}</p>
              </div>
            ))}
            <div className="rounded-xl border border-dashed border-border p-5">
              <h3 className="mb-2 font-semibold text-muted-foreground">Then: the verdict</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                An LLM turns score + evidence into <code className="font-mono text-xs">clear / suspicious / high-risk</code> with
                confidence, reasons, next-best-action — and an evidence path validated node-by-node against the graph.
                Invalid output → one corrective retry → deterministic local fallback. Always a schema-valid answer.
              </p>
            </div>
          </div>
        </section>

        <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
          <p>
            Built from PRD HH_Goa_PRD_01 · data:{" "}
            <a className="underline hover:text-foreground" href="https://base-sepolia.blockscout.com" target="_blank" rel="noreferrer">
              Blockscout
            </a>{" "}
            +{" "}
            <a className="underline hover:text-foreground" href="https://sepolia.base.org" target="_blank" rel="noreferrer">
              Base Sepolia RPC
            </a>{" "}
            · LLM via OpenRouter/OpenAI-compatible endpoint (optional)
          </p>
        </footer>
      </div>
    </main>
  );
}
