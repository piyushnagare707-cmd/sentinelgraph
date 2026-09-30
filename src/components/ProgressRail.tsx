"use client";

import { Check, LoaderCircle, XCircle } from "lucide-react";
import type { StageName } from "@/lib/pipeline";

export interface ProgressRailProps {
  phase: "analyzing" | "verdict" | "done" | "error";
  stage: StageName | null;
  progress: { transfers: number; transactions: number };
}

const STEPS: { key: StageName | "verdict"; label: string; sub: string }[] = [
  { key: "fetching", label: "Fetching on-chain data", sub: "Blockscout transfers, txs & address info" },
  { key: "graph", label: "Building transfer graph", sub: "Nodes, edges, deployer links" },
  { key: "scoring", label: "Scoring 5 heuristics", sub: "Auditable weights from config/heuristics.json" },
  { key: "verdict", label: "LLM verdict", sub: "Forced to cite an exact graph path" },
];

export function ProgressRail({ phase, stage, progress }: ProgressRailProps) {
  const currentIndex =
    phase === "analyzing" ? Math.max(0, STEPS.findIndex((s) => s.key === stage)) : phase === "verdict" ? 3 : -1;

  return (
    <ol className="space-y-4" aria-live="polite">
      {STEPS.map((step, i) => {
        const done = phase === "done" || i < currentIndex;
        const active = (phase === "analyzing" || phase === "verdict") && i === currentIndex;
        const failed = phase === "error" && i === currentIndex;
        return (
          <li key={step.key} className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border ${
                failed
                  ? "border-risk-high/50 bg-risk-high/10 text-risk-high"
                  : done
                    ? "border-risk-clear/50 bg-risk-clear/10 text-risk-clear"
                    : active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border bg-muted/40 text-muted-foreground/50"
              }`}
              aria-hidden
            >
              {failed ? (
                <XCircle className="size-4" />
              ) : done ? (
                <Check className="size-4" />
              ) : active ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <span className="size-1.5 rounded-full bg-current" />
              )}
            </span>
            <span className="min-w-0">
              <span
                className={`block text-sm font-medium ${
                  failed ? "text-risk-high" : done || active ? "text-foreground" : "text-muted-foreground/60"
                }`}
              >
                {step.label}
                {step.key === "fetching" && active && progress.transfers + progress.transactions > 0 && (
                  <span className="ml-2 font-mono text-xs text-primary">
                    {progress.transfers} transfers · {progress.transactions} txs
                  </span>
                )}
              </span>
              <span className="block text-xs text-muted-foreground">{step.sub}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
