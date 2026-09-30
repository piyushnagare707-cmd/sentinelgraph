"use client";

import { Activity, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMs } from "@/lib/format";

export interface LatencyMeterProps {
  fetch: number | null;
  score: number | null;
  verdict: number | null;
  total: number | null;
  p95: number | null;
  live?: boolean;
}

function Chip({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs ${
        accent ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-muted/40 text-muted-foreground"
      }`}
    >
      <span className="font-sans text-[10px] uppercase tracking-wide">{label}</span>
      {value}
    </span>
  );
}

export function LatencyMeter({ fetch, score, verdict, total, p95, live = false }: LatencyMeterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Latency breakdown">
      <Chip label="fetch" value={fetch == null ? "…" : formatMs(fetch)} />
      <Chip label="score" value={score == null ? "…" : formatMs(score)} />
      <Chip label="verdict" value={verdict == null ? "…" : formatMs(verdict)} />
      <Chip label="total" value={total == null ? "…" : formatMs(total)} accent />
      {p95 != null && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Activity className="size-3" /> p95 {formatMs(p95)}
        </span>
      )}
      {live && (
        <Badge variant="outline" className="gap-1 font-mono text-[10px]">
          <Cpu className="size-3" /> live
        </Badge>
      )}
    </div>
  );
}
