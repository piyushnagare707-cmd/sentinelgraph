"use client";

import { CircleGauge } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import type { HeuristicDetail } from "@/lib/types";

const KEY_LABEL: Record<string, string> = {
  fanAsymmetry: "Fan-out asymmetry",
  ageRisk: "Account age risk",
  honeypotTax: "Honeypot tax pattern",
  deployerReuse: "Deployer reuse",
  approvalRisk: "Approval risk",
};

export function HeuristicDetails({ details }: { details: HeuristicDetail[] }) {
  if (details.length === 0) return null;
  return (
      <Accordion className="w-full">
      {details.map((d) => {
        const pct = d.max > 0 ? Math.round((d.value / d.max) * 100) : 0;
        return (
          <AccordionItem key={d.key} value={d.key}>
            <AccordionTrigger className="text-sm hover:no-underline">
              <span className="flex min-w-0 items-center gap-2">
                <CircleGauge className="size-4 shrink-0 text-primary" />
                <span className="truncate">{KEY_LABEL[d.key] ?? d.key}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {d.value}/{d.max}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <Progress value={pct} aria-label={`${KEY_LABEL[d.key] ?? d.key} contribution`} />
              <p className="text-sm text-muted-foreground">{d.summary}</p>
              {d.evidence.length > 0 && (
                <ul className="space-y-1.5">
                  {d.evidence.map((e, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="mt-1 size-1 shrink-0 rounded-full bg-primary" />
                      <span className="min-w-0 break-all">{e}</span>
                    </li>
                  ))}
                </ul>
              )}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
