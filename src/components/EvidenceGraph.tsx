"use client";

import { useMemo } from "react";
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { Box, Skull, UserRound } from "lucide-react";
import { shortAddr, TONE_TEXT, type Tone } from "@/lib/format";
import type { GraphEdge, TransferGraph } from "@/lib/types";
import "@xyflow/react/dist/style.css";

type RiskData = {
  short: string;
  risk: number;
  isTarget: boolean;
  isContract: boolean;
  isScam: boolean;
  label: string | null;
  dimmed: boolean;
  highlighted: boolean;
};

type RiskNode = Node<RiskData, "risk">;

function riskTone(risk: number): Tone {
  if (risk >= 70) return "high";
  if (risk >= 40) return "warn";
  return "clear";
}

function RiskNode({ data, selected }: NodeProps<RiskNode>) {
  const tone = riskTone(data.risk);
  const ring = data.isTarget ? "var(--primary)" : TONE_TEXT[tone];
  return (
    <div
      className={`w-44 rounded-lg border bg-card px-3 py-2 shadow-lg transition-opacity ${
        data.dimmed ? "opacity-40" : "opacity-100"
      } ${data.isTarget ? "ring-2 ring-primary/60" : selected ? "ring-2 ring-foreground/40" : ""}`}
      style={{ borderColor: data.highlighted ? ring : "var(--border)" }}
      title={data.label ?? undefined}
    >
      <div className="flex items-center gap-1.5">
        {data.isScam ? (
          <Skull className="size-3.5 shrink-0 text-risk-high" />
        ) : data.isContract ? (
          <Box className="size-3.5 shrink-0 text-risk-info" />
        ) : (
          <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-mono text-xs" title={data.label ?? undefined}>
          {data.short}
        </span>
        <span
          className="ml-auto rounded px-1 font-mono text-[10px] font-semibold tabular-nums"
          style={{ color: TONE_TEXT[tone], background: `color-mix(in oklab, ${TONE_TEXT[tone]} 12%, transparent)` }}
        >
          {Math.round(data.risk)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1">
        {data.isTarget && (
          <span className="rounded bg-primary px-1 py-px text-[9px] font-bold tracking-wide text-primary-foreground">
            TARGET
          </span>
        )}
        {data.highlighted && (
          <span
            className="rounded px-1 py-px text-[9px] font-semibold tracking-wide"
            style={{ color: ring, background: `color-mix(in oklab, ${ring} 12%, transparent)` }}
          >
            CITED PATH
          </span>
        )}
        {data.label && <span className="truncate text-[9px] text-muted-foreground">{data.label}</span>}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { risk: RiskNode };

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function layoutNodes(graph: TransferGraph, positions: Map<string, { x: number; y: number }>) {
  return graph.nodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      type: "risk",
      position: pos,
      data: {
        short: shortAddr(n.id),
        risk: 0,
        isTarget: n.isTarget,
        isContract: n.kind === "contract",
        isScam: n.isScam,
        label: n.label,
        dimmed: false,
        highlighted: false,
      } satisfies RiskData,
      draggable: false,
    } satisfies RiskNode;
  });
}

export interface EvidenceGraphProps {
  graph: TransferGraph;
  nodeRisks: Record<string, number>;
  evidencePath: string[];
  onOpenNode: (id: string) => void;
}

export function EvidenceGraph({ graph, nodeRisks, evidencePath, onOpenNode }: EvidenceGraphProps) {
  const pathSet = useMemo(() => new Set(evidencePath.map((a) => a.toLowerCase())), [evidencePath]);
  const pathPairs = useMemo(() => {
    const s = new Set<string>();
    for (let i = 0; i + 1 < evidencePath.length; i++) {
      s.add(pairKey(evidencePath[i].toLowerCase(), evidencePath[i + 1].toLowerCase()));
    }
    return s;
  }, [evidencePath]);
  const hasPath = pathSet.size > 0;

  const { nodes, edges } = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 72, marginx: 24, marginy: 24 });
    for (const n of graph.nodes) g.setNode(n.id, { width: 176, height: 56 });
    for (const e of graph.edges) {
      if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to);
    }
    dagre.layout(g);

    const positions = new Map<string, { x: number; y: number }>();
    for (const id of g.nodes()) {
      const p = g.node(id) as { x: number; y: number };
      positions.set(id, { x: p.x - 88, y: p.y - 28 });
    }

    const rfNodes: RiskNode[] = layoutNodes(graph, positions).map((n) => {
      const id = n.id.toLowerCase();
      const highlighted = pathSet.has(id);
      return {
        ...n,
        data: {
          ...n.data,
          risk: nodeRisks[n.id] ?? nodeRisks[id] ?? 0,
          highlighted,
          dimmed: hasPath && !highlighted,
        },
      };
    });

    const rfEdges: Edge[] = graph.edges.map((e: GraphEdge, i) => {
      const onPath = pathPairs.has(pairKey(e.from.toLowerCase(), e.to.toLowerCase()));
      const edgeColor = onPath ? "var(--risk-warn)" : "color-mix(in oklab, var(--muted-foreground) 35%, transparent)";
      return {
        id: `e${i}-${e.txHash.slice(0, 10)}-${e.logIndex}`,
        source: e.from,
        target: e.to,
        animated: onPath,
        style: { stroke: edgeColor, strokeWidth: onPath ? 2.5 : 1.25 },
        label: onPath ? (e.token?.symbol ?? "native") : undefined,
        labelStyle: { fill: "var(--risk-warn)", fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: "var(--card)" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: edgeColor },
      } satisfies Edge;
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [graph, nodeRisks, pathSet, pathPairs, hasPath]);

  return (
    <div className="relative h-[440px] w-full overflow-hidden rounded-lg border border-border bg-background/60">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onOpenNode(node.id)}
        fitView
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background gap={22} color="color-mix(in oklab, var(--muted-foreground) 25%, transparent)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-2 rounded-md border border-border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm bg-primary" /> target
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm" style={{ background: "var(--risk-warn)" }} /> 40–69 risk
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm" style={{ background: "var(--risk-high)" }} /> 70+ risk
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm" style={{ background: "var(--risk-clear)" }} /> 0–39 risk
        </span>
        {hasPath && <span>· cited path highlighted — click a node for details</span>}
      </div>
    </div>
  );
}
