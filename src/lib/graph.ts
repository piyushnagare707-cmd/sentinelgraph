import type { AddressInfo, GraphEdge, GraphNode, NodeKind, RawTransfer, RawTx, TransferGraph } from "./types";

export interface BuildGraphInput {
  target: string;
  transfers: RawTransfer[];
  txs: RawTx[];
  infos?: (AddressInfo | null | undefined)[];
}

interface NodeAccum {
  id: string;
  kind: NodeKind;
  label: string | null;
  firstSeenBlock: number | null;
  txs: Set<string>;
  isScam: boolean;
  isVerified: boolean;
  creator: string | null;
}

function betterKind(a: NodeKind, b: NodeKind): NodeKind {
  if (a === "contract" || b === "contract") return "contract";
  if (a === "eoa" || b === "eoa") return "eoa";
  return "unknown";
}

/**
 * Build the directed multigraph from raw chain data.
 * - transfers become token edges (ERC-20 multigraph per PRD §5)
 * - native value txs become native edges
 * - node stats (firstSeen, txCount, kind, label) merge from every source
 */
export function buildGraph(input: BuildGraphInput): TransferGraph {
  const target = input.target.toLowerCase();
  const nodes = new Map<string, NodeAccum>();
  const edges: GraphEdge[] = [];
  const seenEdgeKeys = new Set<string>();

  const ensure = (id: string): NodeAccum => {
    const key = id.toLowerCase();
    let n = nodes.get(key);
    if (!n) {
      n = {
        id: key,
        kind: "unknown",
        label: null,
        firstSeenBlock: null,
        txs: new Set(),
        isScam: false,
        isVerified: false,
        creator: null,
      };
      nodes.set(key, n);
    }
    return n;
  };

  const touch = (n: NodeAccum, block: number, txHash: string, kind?: NodeKind, label?: string | null, scam?: boolean, verified?: boolean) => {
    if (n.firstSeenBlock === null || block < n.firstSeenBlock) n.firstSeenBlock = block;
    n.txs.add(txHash);
    if (kind) n.kind = betterKind(n.kind, kind);
    if (label && !n.label) n.label = label;
    if (scam) n.isScam = true;
    if (verified) n.isVerified = true;
  };

  const addEdge = (e: GraphEdge): void => {
    const key = `${e.txHash}:${e.logIndex}:${e.from}:${e.to}:${e.token?.address ?? "native"}:${e.value}`;
    if (seenEdgeKeys.has(key)) return;
    seenEdgeKeys.add(key);
    edges.push(e);
  };

  for (const t of input.transfers) {
    const from = ensure(t.from);
    const to = ensure(t.to);
    touch(from, t.blockNumber, t.txHash, t.fromIsContract ? "contract" : "eoa", t.fromName);
    touch(to, t.blockNumber, t.txHash, t.toIsContract ? "contract" : "eoa", t.toName);
    if (t.from === t.to) continue;
    addEdge({
      from: t.from,
      to: t.to,
      value: t.value,
      token: t.token,
      txHash: t.txHash,
      timestamp: t.timestamp,
      blockNumber: t.blockNumber,
      logIndex: t.logIndex,
    });
  }

  for (const tx of input.txs) {
    const from = ensure(tx.from);
    touch(from, tx.blockNumber, tx.hash, tx.fromIsContract ? "contract" : "eoa", tx.fromName);
    if (tx.to) {
      const to = ensure(tx.to);
      touch(to, tx.blockNumber, tx.hash, tx.toIsContract ? "contract" : "eoa", tx.toName);
      const value = BigInt(tx.value || "0");
      if (value > 0n && tx.from !== tx.to) {
        addEdge({
          from: tx.from,
          to: tx.to,
          value: tx.value,
          token: null,
          txHash: tx.hash,
          timestamp: tx.timestamp,
          blockNumber: tx.blockNumber,
          logIndex: 0,
        });
      }
    }
  }

  for (const info of input.infos ?? []) {
    if (!info) continue;
    const n = ensure(info.hash);
    n.kind = betterKind(n.kind, info.isContract ? "contract" : "eoa");
    n.label = n.label ?? info.name;
    n.isScam = n.isScam || info.isScam;
    n.isVerified = n.isVerified || info.isVerified;
    n.creator = info.creator ?? n.creator;
    if (info.creator) ensure(info.creator);
  }

  const targetNode = ensure(target);
  targetNode.kind = targetNode.kind === "unknown" ? "unknown" : targetNode.kind;

  const graphNodes: GraphNode[] = [...nodes.values()].map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    firstSeenBlock: n.firstSeenBlock,
    txCount: n.txs.size,
    isScam: n.isScam,
    isVerified: n.isVerified,
    isTarget: n.id === target,
    creator: n.creator,
  }));

  return { nodes: graphNodes, edges };
}

function degreeMap(edges: GraphEdge[]): Map<string, number> {
  const d = new Map<string, number>();
  for (const e of edges) {
    d.set(e.from, (d.get(e.from) ?? 0) + 1);
    d.set(e.to, (d.get(e.to) ?? 0) + 1);
  }
  return d;
}

function edgeValueWei(e: GraphEdge): bigint {
  try {
    return BigInt(e.value || "0");
  } catch {
    return 0n;
  }
}

/**
 * Hard caps per PRD §12 (hairball mitigation):
 * keep the target + top nodes by importance, then top edge groups by
 * multiplicity and (same-token) value. Deterministic — no randomness.
 */
export function pruneGraph(graph: TransferGraph, target: string, maxNodes: number, maxEdges: number): TransferGraph {
  const tgt = target.toLowerCase();
  const deg = degreeMap(graph.edges);

  const ranked = [...graph.nodes]
    .filter((n) => n.id !== tgt)
    .sort((a, b) => {
      const score = (n: GraphNode) =>
        (deg.get(n.id) ?? 0) * 10 + Math.min(n.txCount, 100) + (n.label ? 5 : 0) + (n.creator ? 2 : 0);
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

  const keep = new Set<string>([tgt, ...ranked.slice(0, Math.max(0, maxNodes - 1)).map((n) => n.id)]);

  const keptEdges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to));

  // rank parallel edges: group by (from,to,token), order by count then value
  interface Group {
    key: string;
    count: number;
    value: bigint;
    edges: GraphEdge[];
  }
  const groups = new Map<string, Group>();
  for (const e of keptEdges) {
    const key = `${e.from}→${e.to}:${e.token?.address ?? "native"}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, count: 0, value: 0n, edges: [] };
      groups.set(key, g);
    }
    g.count++;
    g.value += edgeValueWei(e);
    g.edges.push(e);
  }

  const orderedGroups = [...groups.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (b.value !== a.value) return b.value > a.value ? 1 : -1;
    return a.key.localeCompare(b.key);
  });

  const finalEdges: GraphEdge[] = [];
  for (const g of orderedGroups) {
    for (const e of g.edges) {
      if (finalEdges.length >= maxEdges) break;
      finalEdges.push(e);
    }
    if (finalEdges.length >= maxEdges) break;
  }

  const used = new Set<string>();
  for (const e of finalEdges) {
    used.add(e.from);
    used.add(e.to);
  }
  used.add(tgt);

  const finalNodes = graph.nodes.filter((n) => used.has(n.id));
  return { nodes: finalNodes, edges: finalEdges };
}

export function nodeIndex(graph: TransferGraph): Map<string, GraphNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

/** Directed adjacency with the option to traverse both directions. */
export function adjacency(graph: TransferGraph): Map<string, { to: string; edge: GraphEdge }[]> {
  const adj = new Map<string, { to: string; edge: GraphEdge }[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push({ to: e.to, edge: e });
  }
  return adj;
}

export function reverseAdjacency(graph: TransferGraph): Map<string, { to: string; edge: GraphEdge }[]> {
  const adj = new Map<string, { to: string; edge: GraphEdge }[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.to)!.push({ to: e.from, edge: e });
  }
  return adj;
}
