"use client";

import { useState } from "react";
import { Box, Check, Copy, Skull, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatTokenAmount, shortAddr, TONE_TEXT } from "@/lib/format";
import type { GraphEdge, GraphNode } from "@/lib/types";

export interface NodeDrawerProps {
  node: GraphNode | null;
  risk: number;
  edges: GraphEdge[];
  targetId: string;
  onClose: () => void;
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm ${mono ? "font-mono break-all" : "font-medium"}`}>{value}</div>
    </div>
  );
}

export function NodeDrawer({ node, risk, edges, targetId, onClose }: NodeDrawerProps) {
  const [copied, setCopied] = useState(false);

  if (!node) return null;

  const tone = risk >= 70 ? "high" : risk >= 40 ? "warn" : "clear";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(node.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {node.isScam ? (
              <Skull className="size-4 text-risk-high" />
            ) : node.kind === "contract" ? (
              <Box className="size-4 text-risk-info" />
            ) : (
              <UserRound className="size-4 text-muted-foreground" />
            )}
            Node details
          </SheetTitle>
          <SheetDescription className="font-mono break-all">{node.id}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copy} className="gap-1.5">
              {copied ? <Check className="size-3.5 text-risk-clear" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy address"}
            </Button>
            <a
              href={`https://base-sepolia.blockscout.com/address/${node.id}`}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              View on Blockscout ↗
            </a>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant={node.isTarget ? "default" : "outline"}>{node.isTarget ? "TARGET" : node.kind.toUpperCase()}</Badge>
            {node.isVerified && <Badge variant="outline" className="text-risk-clear">verified</Badge>}
            {node.isScam && <Badge variant="outline" className="text-risk-high">flagged scam</Badge>}
            {node.label && <Badge variant="outline">{node.label}</Badge>}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>Node risk (graph-wide contribution)</span>
              <span className="font-mono" style={{ color: TONE_TEXT[tone] }}>
                {Math.round(risk)}/100
              </span>
            </div>
            <Progress value={risk} aria-label="Node risk" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Stat label="Transactions in graph" value={String(node.txCount)} />
            <Stat label="First seen (block)" value={node.firstSeenBlock == null ? "—" : String(node.firstSeenBlock)} />
            <Stat label="Kind" value={node.kind} />
            <Stat label="Creator" value={node.creator ? shortAddr(node.creator, 10, 8) : "—"} mono />
          </div>

          <Separator />

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Transfers touching this node ({edges.length})
            </h4>
            {edges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No token transfers recorded.</p>
            ) : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {edges.map((e, i) => {
                  const outgoing = e.from.toLowerCase() === node.id.toLowerCase();
                  const other = outgoing ? e.to : e.from;
                  const onTarget = other.toLowerCase() === targetId.toLowerCase();
                  return (
                    <li
                      key={`${e.txHash}-${e.logIndex}-${i}`}
                      className="rounded-md border border-border bg-muted/20 px-2.5 py-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 font-mono">
                        <span className="truncate" title={other}>
                          {shortAddr(other, 8, 6)}
                        </span>
                        <span className="shrink-0 text-muted-foreground">{outgoing ? "→" : "←"}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-muted-foreground">
                        <span className="truncate">
                          {formatTokenAmount(e.value, e.token?.decimals ?? null)} {e.token?.symbol ?? "native"}
                        </span>
                        <span className="shrink-0">#{e.blockNumber}</span>
                      </div>
                      {onTarget && <span className="mt-0.5 inline-block text-[10px] text-primary">counterparty of target</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
