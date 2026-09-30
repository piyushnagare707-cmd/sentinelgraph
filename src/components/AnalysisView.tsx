"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertOctagon, GitBranch, RotateCcw } from "lucide-react";
import { AddressBar } from "@/components/AddressBar";
import { EvidenceGraph } from "@/components/EvidenceGraph";
import { HeuristicDetails } from "@/components/HeuristicDetails";
import { LatencyMeter } from "@/components/LatencyMeter";
import { NodeDrawer } from "@/components/NodeDrawer";
import { ProgressRail } from "@/components/ProgressRail";
import { ReasoningStream } from "@/components/ReasoningStream";
import { VerdictPanel } from "@/components/VerdictPanel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { loadP95Latency, pushLatencySample, pushRecentAddress } from "@/lib/client-storage";
import { ERROR_HINTS, shortAddr, TONE_TEXT } from "@/lib/format";
import type {
  AnalyzeEvent,
  AnalyzeResult,
  StageName,
  Verdict,
  VerdictEvent,
  VerdictSource,
} from "@/lib/types";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
type Phase = "analyzing" | "verdict" | "done" | "error";

class StreamError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function* readNdjson<T>(res: Response): AsyncGenerator<T> {
  const reader = res.body?.getReader();
  if (!reader) throw new StreamError("internal", "Response has no body");
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) yield JSON.parse(line) as T;
      }
    }
    const tail = buf.trim();
    if (tail) yield JSON.parse(tail) as T;
  } finally {
    reader.releaseLock();
  }
}

async function raiseHttpError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  throw new StreamError(body?.error ?? "internal", body?.message ?? `${fallback} (HTTP ${res.status})`);
}

export function AnalysisView({ address }: { address: string }) {
  const valid = ADDRESS_RE.test(address);
  const [hops, setHops] = useState<1 | 2>(1);
  const [runId, setRunId] = useState(0);

  const [phase, setPhase] = useState<Phase>(valid ? "analyzing" : "error");
  const [stage, setStage] = useState<StageName | null>(null);
  const [progress, setProgress] = useState({ transfers: 0, transactions: 0 });
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    valid ? null : { code: "invalid-address", message: `"${address}" is not a valid 0x address.` },
  );

  const [vText, setVText] = useState("");
  const [vModel, setVModel] = useState<string | null>(null);
  const [vRetry, setVRetry] = useState<string | null>(null);
  const [vDone, setVDone] = useState<{
    verdict: Verdict;
    source: VerdictSource;
    model: string | null;
    attempts: number;
  } | null>(null);
  const [vError, setVError] = useState<string | null>(null);
  const [verdictMs, setVerdictMs] = useState<number | null>(null);
  const [e2e, setE2e] = useState<number | null>(null);
  const [p95, setP95] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Render-phase reset: when the run identity (address | hops | retry) changes,
  // drop stale results before effects run (React's documented pattern).
  const runKey = `${address.toLowerCase()}|${hops}|${runId}`;
  const [seenRunKey, setSeenRunKey] = useState(runKey);
  if (seenRunKey !== runKey) {
    setSeenRunKey(runKey);
    setPhase("analyzing");
    setStage(null);
    setProgress({ transfers: 0, transactions: 0 });
    setResult(null);
    setError(valid ? null : { code: "invalid-address", message: `"${address}" is not a valid 0x address.` });
    setVText("");
    setVModel(null);
    setVRetry(null);
    setVDone(null);
    setVError(null);
    setVerdictMs(null);
    setE2e(null);
    setSelectedId(null);
  }

  useEffect(() => {
    // localStorage only exists in the browser; sync once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setP95(loadP95Latency());
  }, []);

  useEffect(() => {
    if (!valid) return;
    const ac = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, hops }),
          signal: ac.signal,
        });
        if (!res.ok) await raiseHttpError(res, "Analyze request failed");

        let analyzed: AnalyzeResult | null = null;
        for await (const ev of readNdjson<AnalyzeEvent>(res)) {
          if (cancelled) return;
          if (ev.type === "stage") setStage(ev.stage);
          else if (ev.type === "progress") setProgress({ transfers: ev.transfers, transactions: ev.transactions });
          else if (ev.type === "error") throw new StreamError(ev.code, ev.message);
          else if (ev.type === "result") {
            analyzed = ev.data;
            setResult(ev.data);
          }
        }
        if (!analyzed) throw new StreamError("internal", "Stream ended without a result");
        if (cancelled) return;

        pushRecentAddress(address);
        setPhase("verdict");
        await runVerdict(analyzed, ac.signal);
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        const code = e instanceof StreamError ? e.code : "internal";
        const message = e instanceof Error ? e.message : "Unexpected error";
        setError({ code, message });
        setPhase("error");
      }
    })();

    async function runVerdict(ar: AnalyzeResult, signal: AbortSignal): Promise<void> {
      let gotDone = false;
      try {
        const res = await fetch("/api/verdict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address,
            score: ar.score,
            breakdown: ar.breakdown,
            details: ar.details,
            paths: ar.paths,
            pathMeta: ar.pathMeta,
            nodes: ar.graph.nodes.map((n) => ({ id: n.id, label: n.label })),
          }),
          signal,
        });
        if (!res.ok) await raiseHttpError(res, "Verdict request failed");

        for await (const ev of readNdjson<VerdictEvent>(res)) {
          if (cancelled) return;
          if (ev.type === "model") setVModel(ev.model);
          else if (ev.type === "token") setVText((t) => t + ev.text);
          else if (ev.type === "retry") setVRetry(ev.reason);
          else if (ev.type === "error") setVError(`${ev.code}: ${ev.message}`);
          else if (ev.type === "done") {
            gotDone = true;
            setVDone({ verdict: ev.verdict, source: ev.source, model: ev.model, attempts: ev.attempts });
            setVerdictMs(ev.latencyMs);
            const total = Math.max(ar.latency.total, ar.latency.fetch + ar.latency.score) + ev.latencyMs;
            setE2e(total);
            pushLatencySample(total);
            setP95(loadP95Latency());
          }
        }
        if (!gotDone) {
          setVError((prev) => prev ?? "Verdict stream closed before a verdict arrived — showing no LLM output.");
        }
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        setVError(e instanceof Error ? e.message : "Verdict request failed");
      } finally {
        if (!cancelled) setPhase((p) => (p === "verdict" ? "done" : p));
      }
    }

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [address, hops, runId, valid]);

  const nodeById = selectedId ? (result?.graph.nodes.find((n) => n.id === selectedId) ?? null) : null;
  const edgesForNode =
    result && selectedId
      ? result.graph.edges.filter(
          (e) => e.from.toLowerCase() === selectedId.toLowerCase() || e.to.toLowerCase() === selectedId.toLowerCase(),
        )
      : [];

  if (!valid || (phase === "error" && error)) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-16">
        <Card className="mx-auto max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-risk-high">
              <AlertOctagon className="size-5" />
              Analysis failed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{ERROR_HINTS[error?.code ?? ""] ?? error?.message}</p>
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
              {error?.code ?? "internal"} — {error?.message ?? "unknown"}
            </p>
            <div className="flex gap-2">
              {valid && (
                <Button onClick={() => setRunId((r) => r + 1)} className="gap-1.5">
                  <RotateCcw className="size-4" /> Retry
                </Button>
              )}
              <Link href="/" className={buttonVariants({ variant: "outline" })}>
                Try another address
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const showResult = result !== null;
  const highlightPath = vDone?.verdict.evidencePath ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16">
      <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <AddressBar compact />
        </div>
        <div className="flex items-center gap-1 self-start rounded-lg border border-border bg-muted/30 p-1 text-xs">
          {([1, 2] as const).map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHops(h)}
              aria-pressed={hops === h}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                hops === h ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {h} hop{h > 1 ? "s" : ""}
            </button>
          ))}
        </div>
      </div>
      {hops === 2 && (
        <p className="-mt-1 mb-3 text-xs text-muted-foreground">
          2-hop analysis seeds from up to 8 counterparties — slower, broader graph.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {showResult ? (
            <VerdictPanel
              verdict={vDone?.verdict ?? null}
              source={vDone?.source ?? null}
              model={vDone?.model ?? vModel}
              attempts={vDone?.attempts ?? null}
              score={result.score}
              streaming={phase === "verdict"}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Verdict</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <GitBranch className="size-4 text-primary" />
                Evidence graph
              </CardTitle>
              {showResult && (
                <span className="font-mono text-xs text-muted-foreground">
                  {result.graph.nodes.length} nodes · {result.graph.edges.length} edges · {hops}-hop
                </span>
              )}
            </CardHeader>
            <CardContent>
              {showResult ? (
                <EvidenceGraph
                  graph={result.graph}
                  nodeRisks={result.nodeRisks}
                  evidencePath={highlightPath}
                  onOpenNode={setSelectedId}
                />
              ) : (
                <div className="space-y-3">
                  <Skeleton className="h-[440px] w-full" />
                  <p className="text-center text-xs text-muted-foreground">assembling graph…</p>
                </div>
              )}
            </CardContent>
          </Card>

          {showResult && result.details.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Heuristic breakdown (auditable weights)</CardTitle>
              </CardHeader>
              <CardContent>
                <HeuristicDetails details={result.details} />
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Pipeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ProgressRail phase={phase} stage={stage} progress={progress} />
            </CardContent>
          </Card>

          <ReasoningStream text={vText} model={vModel} retry={vRetry} streaming={phase === "verdict"} error={vError} />

          {showResult && result.pathMeta.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Deterministic suspicious paths</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.pathMeta.slice(0, 5).map((p, i) => (
                  <div key={i} className="rounded-md border border-border bg-muted/20 p-2.5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{p.reason}</span>
                      <span
                        className="rounded px-1.5 font-mono text-[10px] font-semibold"
                        style={{
                          color: TONE_TEXT[p.risk >= 70 ? "high" : p.risk >= 40 ? "warn" : "clear"],
                        }}
                      >
                        risk {p.risk}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 font-mono text-[11px]">
                      {p.nodes.map((n, j) => (
                        <span key={`${n}-${j}`} className="flex items-center gap-1">
                          {j > 0 && <span className="text-muted-foreground">→</span>}
                          <span title={n} className="rounded bg-background/60 px-1">
                            {shortAddr(n, 6, 4)}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {result.pathMeta.length > 5 && (
                  <p className="text-xs text-muted-foreground">+{result.pathMeta.length - 5} more paths (bounded by maxEdges)</p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Latency</CardTitle>
            </CardHeader>
            <CardContent>
              <LatencyMeter
                fetch={result?.latency.fetch ?? null}
                score={result?.latency.score ?? null}
                verdict={verdictMs}
                total={e2e ?? (phase === "done" ? result?.latency.total ?? null : null)}
                p95={p95}
                live={phase !== "done"}
              />
            </CardContent>
          </Card>
        </aside>
      </div>

      <NodeDrawer
        node={nodeById}
        risk={selectedId ? result?.nodeRisks[selectedId] ?? 0 : 0}
        edges={edgesForNode}
        targetId={result?.address ?? address}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
