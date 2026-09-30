"use client";

import { ArrowRight, Bot, ShieldCheck, ShieldAlert, ShieldQuestion, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { NEXT_ACTION_LABEL, VERDICT_LABEL, scoreTone, shortAddr, TONE_TEXT, toneClasses, verdictTone } from "@/lib/format";
import type { Verdict, VerdictSource } from "@/lib/types";

export interface VerdictPanelProps {
  verdict: Verdict | null;
  source: VerdictSource | null;
  model: string | null;
  attempts: number | null;
  score: number;
  streaming: boolean;
}

const ARC_LEN = Math.PI * 70; // r=70 semicircle

function ScoreGauge({ score, tone }: { score: number; tone: ReturnType<typeof scoreTone> }) {
  const color = TONE_TEXT[tone];
  return (
    <div className="relative w-44 shrink-0" aria-label={`Risk score ${score} of 100`}>
      <svg viewBox="0 0 180 108" className="w-full">
        <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke="var(--muted)" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M 20 90 A 70 70 0 0 1 160 90"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={ARC_LEN}
          strokeDashoffset={ARC_LEN * (1 - Math.min(100, Math.max(0, score)) / 100)}
          style={{ transition: "stroke-dashoffset 700ms ease" }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-4xl font-bold tabular-nums" style={{ color }}>
          {score}
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">/ 100 risk</div>
      </div>
    </div>
  );
}

function SourceBadge({ source, model, attempts }: { source: VerdictSource | null; model: string | null; attempts: number | null }) {
  if (!source) return null;
  const map = {
    llm: { icon: Bot, label: "LLM verdict", cls: "border-primary/40 bg-primary/10 text-primary" },
    local: { icon: ShieldQuestion, label: "Local fallback (deterministic)", cls: "border-risk-info/40 bg-risk-info/10 text-risk-info" },
    fallback: { icon: Wrench, label: "Emergency fallback", cls: "border-risk-warn/40 bg-risk-warn/10 text-risk-warn" },
  } as const;
  const m = map[source];
  const Icon = m.icon;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className={`gap-1 text-[10px] ${m.cls}`}>
        <Icon className="size-3" /> {m.label}
      </Badge>
      {model && (
        <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
          {model}
        </Badge>
      )}
      {attempts != null && attempts > 1 && (
        <Badge variant="outline" className="text-[10px] text-risk-warn">
          {attempts} attempts (1 retry)
        </Badge>
      )}
    </div>
  );
}

export function VerdictPanel({ verdict, source, model, attempts, score, streaming }: VerdictPanelProps) {
  const tone = scoreTone(score, verdict?.verdict);
  const color = TONE_TEXT[tone];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          {verdict?.verdict === "clear" ? (
            <ShieldCheck className="size-4 text-risk-clear" />
          ) : verdict ? (
            <ShieldAlert className="size-4" style={{ color }} />
          ) : (
            <ShieldQuestion className="size-4 text-muted-foreground" />
          )}
          Verdict
        </CardTitle>
        <SourceBadge source={source} model={model} attempts={attempts} />
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          <ScoreGauge score={score} tone={tone} />
          <div className="min-w-0 flex-1 space-y-3">
            {verdict ? (
              <span
                className={`inline-flex rounded-md border px-3 py-1.5 text-lg font-bold tracking-wide ${toneClasses(verdictTone(verdict.verdict))}`}
              >
                {VERDICT_LABEL[verdict.verdict] ?? verdict.verdict.toUpperCase()}
              </span>
            ) : (
              <Skeleton className="h-10 w-56" />
            )}

            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Confidence</span>
                <span className="font-mono">{verdict ? `${Math.round(verdict.confidence * 100)}%` : streaming ? "…" : "—"}</span>
              </div>
              <Progress value={verdict ? verdict.confidence * 100 : 0} aria-label="Verdict confidence" />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Next best action:</span>
              {verdict ? (
                <Badge className="font-semibold uppercase tracking-wide">
                  {NEXT_ACTION_LABEL[verdict.nextBestAction] ?? verdict.nextBestAction}
                </Badge>
              ) : (
                <Skeleton className="h-5 w-36" />
              )}
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">LLM score must match: {verdict ? verdict.score : "…"}</span>
            </div>
          </div>
        </div>

        {verdict && verdict.reasons.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reasons</h4>
            <ul className="space-y-1.5">
              {verdict.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <ArrowRight className="mt-0.5 size-3.5 shrink-0" style={{ color }} />
                  <span className="min-w-0">{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {verdict && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cited evidence path {verdict.evidencePath.length > 0 ? "" : "(none required)"}
            </h4>
            {verdict.evidencePath.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {verdict.evidencePath.map((addr, i) => (
                  <span key={`${addr}-${i}`} className="flex items-center gap-1.5">
                    {i > 0 && <ArrowRight className="size-3 text-muted-foreground" />}
                    <code
                      className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary"
                      title={addr}
                    >
                      {shortAddr(addr, 8, 6)}
                    </code>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No accusation was made, so no path is required.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
