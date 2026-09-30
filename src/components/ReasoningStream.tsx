"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Bot, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface ReasoningStreamProps {
  text: string;
  model: string | null;
  retry: string | null;
  streaming: boolean;
  error: string | null;
}

export function ReasoningStream({ text, model, retry, streaming, error }: ReasoningStreamProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Radio className={`size-4 ${streaming ? "animate-pulse text-primary" : "text-muted-foreground"}`} />
          Reasoning stream
        </CardTitle>
        <div className="flex items-center gap-2">
          {model && (
            <Badge variant="outline" className="gap-1 font-mono text-[10px]">
              <Bot className="size-3" /> {model}
            </Badge>
          )}
          {streaming && (
            <span className="flex items-center gap-1.5 text-xs text-primary">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              thinking
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {retry && (
          <p className="mb-2 flex items-start gap-1.5 rounded-md border border-risk-warn/40 bg-risk-warn/10 px-2 py-1.5 text-xs text-risk-warn">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Schema guardrail rejected the first answer — retrying once with a corrective prompt: {retry}
          </p>
        )}
        {error && (
          <p className="mb-2 rounded-md border border-risk-high/40 bg-risk-high/10 px-2 py-1.5 text-xs text-risk-high">
            {error}
          </p>
        )}
        <div
          ref={bodyRef}
          className={`max-h-72 min-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 p-3 font-mono text-xs leading-relaxed text-muted-foreground ${
            streaming ? "animate-cursor-blink" : ""
          }`}
          aria-live="polite"
        >
          {text || (streaming ? "connecting to model…" : "stream will appear here")}
        </div>
      </CardContent>
    </Card>
  );
}
