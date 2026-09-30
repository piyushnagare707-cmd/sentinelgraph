import { adjacency, reverseAdjacency } from "./graph";
import type { HeuristicParams } from "./config";
import type { DecodedApproval, SuspiciousPath, TransferGraph } from "./types";

export interface NodeRisk {
  id: string;
  risk: number;
  signals: string[];
}

export interface PathFinding {
  paths: SuspiciousPath[];
  nodeRisks: Record<string, number>;
  nodeRiskDetails: NodeRisk[];
}

export interface RiskInput {
  graph: TransferGraph;
  target: string;
  headBlock: number | null;
  approvals: DecodedApproval[];
  params: HeuristicParams;
}

function fanAsymmetryOf(graph: TransferGraph, id: string, minDegree: number): number {
  let inn = 0;
  let out = 0;
  for (const e of graph.edges) {
    if (e.from === id) out++;
    if (e.to === id) inn++;
  }
  const total = inn + out;
  if (total < minDegree) return 0;
  return Math.abs(inn - out) / total;
}

/** Per-node risk composite used both for BFS seeds and for UI node tinting. */
export function computeNodeRisks(input: RiskInput): NodeRisk[] {
  const { graph, target, headBlock, approvals, params } = input;
  const creatorCount = new Map<string, number>();
  for (const n of graph.nodes) {
    if (n.creator) creatorCount.set(n.creator, (creatorCount.get(n.creator) ?? 0) + 1);
  }
  const unlimitedOwners = new Set(approvals.filter((a) => a.unlimited).map((a) => a.owner));

  const out: NodeRisk[] = [];
  for (const n of graph.nodes) {
    if (n.id === target) continue;
    const signals: string[] = [];
    let risk = 0;

    if (n.isScam) {
      risk = Math.max(risk, 1);
      signals.push("flagged as scam by the explorer");
    }

    if (n.firstSeenBlock !== null && headBlock !== null) {
      const since = headBlock - n.firstSeenBlock;
      if (since >= 0 && since <= params.recentCounterpartyWindowBlocks) {
        const r = 1 - since / params.recentCounterpartyWindowBlocks;
        if (r > 0.3) {
          risk = Math.max(risk, r);
          signals.push(`first seen only ${since.toLocaleString()} blocks ago`);
        }
      }
    }

    const asym = fanAsymmetryOf(graph, n.id, params.minFanDegree);
    if (asym >= 0.5) {
      risk = Math.max(risk, asym);
      signals.push(`one-sided flow (in/out asymmetry ${asym.toFixed(2)})`);
    }

    if (n.creator && (creatorCount.get(n.creator) ?? 0) >= 2) {
      risk = Math.max(risk, 0.6);
      signals.push(`shares deployer ${n.creator.slice(0, 10)}… with other contracts in this graph`);
    }

    if (unlimitedOwners.has(n.id)) {
      risk = Math.max(risk, 0.7);
      signals.push("issued unlimited (max uint256) token approvals");
    }

    out.push({ id: n.id, risk: Math.min(1, Number(risk.toFixed(3))), signals });
  }
  return out.sort((a, b) => b.risk - a.risk || a.id.localeCompare(b.id));
}

const SEED_THRESHOLD = 0.5;
const MAX_SEEDS = 6;
const MAX_PATHS = 5;
const MAX_PATH_NODES = 4;

function bfs(
  start: string,
  goal: string,
  adj: Map<string, { to: string }[]>,
  maxLen: number,
): string[] | null {
  if (start === goal) return [start];
  const prev = new Map<string, string>();
  const seen = new Set([start]);
  const queue: string[] = [start];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const hopsSoFar = pathLen(prev, cur, start);
    if (hopsSoFar >= maxLen - 1) continue;
    for (const { to } of adj.get(cur) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      prev.set(to, cur);
      if (to === goal) return rebuild(prev, start, goal);
      queue.push(to);
    }
  }
  return null;
}

function pathLen(prev: Map<string, string>, node: string, start: string): number {
  let len = 0;
  let cur = node;
  while (cur !== start && prev.has(cur)) {
    cur = prev.get(cur)!;
    len++;
  }
  return len;
}

function rebuild(prev: Map<string, string>, start: string, goal: string): string[] {
  const path = [goal];
  let cur = goal;
  while (cur !== start) {
    cur = prev.get(cur)!;
    path.push(cur);
  }
  return path.reverse();
}

/**
 * BFS path extraction (PRD §5): from the target, find shortest directed flows
 * that reach high-risk nodes; fall back to reverse flows (risk → target).
 * Deterministic ordering: risk desc, then length asc, then lexicographic.
 */
export function findSuspiciousPaths(graph: TransferGraph, target: string, risks: NodeRisk[]): PathFinding {
  const tgt = target.toLowerCase();
  const nodeRisks: Record<string, number> = {};
  for (const r of risks) nodeRisks[r.id] = r.risk;

  const fwd = adjacency(graph);
  const rev = reverseAdjacency(graph);

  const seeds = [...risks]
    .filter((r) => r.risk >= SEED_THRESHOLD)
    .sort((a, b) => b.risk - a.risk || a.id.localeCompare(b.id))
    .slice(0, MAX_SEEDS);

  const found: SuspiciousPath[] = [];
  const seenKeys = new Set<string>();

  for (const seed of seeds) {
    const forward = bfs(tgt, seed.id, fwd, MAX_PATH_NODES);
    const backward = forward ? null : bfs(seed.id, tgt, fwd, MAX_PATH_NODES);
    const viaRev = forward || backward ? null : bfs(tgt, seed.id, rev, MAX_PATH_NODES);

    let pathNodes: string[] | null = null;
    let directionNote = "";
    if (forward) {
      pathNodes = forward;
    } else if (backward) {
      pathNodes = backward;
      directionNote = " (flow moves toward the analyzed address)";
    } else if (viaRev) {
      pathNodes = viaRev;
      directionNote = " (reverse traversal of observed flow)";
    }
    if (!pathNodes) continue;

    const key = pathNodes.join(">");
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const signal = seed.signals[0] ?? "elevated composite risk";
    found.push({
      nodes: pathNodes,
      reason: `Flow reaches ${seed.id.slice(0, 8)}… which shows ${signal}${directionNote}`,
      risk: Number(seed.risk.toFixed(3)),
    });
  }

  found.sort((a, b) => b.risk - a.risk || a.nodes.length - b.nodes.length || a.nodes.join().localeCompare(b.nodes.join()));

  return { paths: found.slice(0, MAX_PATHS), nodeRisks, nodeRiskDetails: risks };
}
