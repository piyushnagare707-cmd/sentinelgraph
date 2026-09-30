// Shared domain types (safe to import from client and server).

export type NodeKind = "eoa" | "contract" | "unknown";

export interface AddressInfo {
  hash: string;
  isContract: boolean;
  isScam: boolean;
  isVerified: boolean;
  name: string | null;
  creator: string | null;
  creationTx: string | null;
  reputation: string | null;
  tags: string[];
}

export interface TokenRef {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  type: string;
}

export interface RawTransfer {
  txHash: string;
  blockNumber: number;
  timestamp: string;
  logIndex: number;
  from: string;
  to: string;
  value: string;
  token: TokenRef;
  fromIsContract: boolean;
  toIsContract: boolean;
  fromName: string | null;
  toName: string | null;
}

export interface RawTx {
  hash: string;
  blockNumber: number;
  timestamp: string;
  from: string;
  to: string | null;
  value: string;
  method: string | null;
  rawInput: string;
  fromIsContract: boolean;
  toIsContract: boolean;
  fromName: string | null;
  toName: string | null;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string | null;
  firstSeenBlock: number | null;
  txCount: number;
  isScam: boolean;
  isVerified: boolean;
  isTarget: boolean;
  creator: string | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  value: string;
  token: TokenRef | null;
  txHash: string;
  timestamp: string;
  blockNumber: number;
  logIndex: number;
}

export interface TransferGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type HeuristicKey =
  | "fanAsymmetry"
  | "ageRisk"
  | "honeypotTax"
  | "deployerReuse"
  | "approvalRisk";

export type ScoreBreakdown = Record<HeuristicKey, number>;

export interface HeuristicDetail {
  key: HeuristicKey;
  value: number;
  max: number;
  summary: string;
  evidence: string[];
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
  details: HeuristicDetail[];
}

export interface SuspiciousPath {
  nodes: string[];
  reason: string;
  risk: number;
}

export interface DecodedApproval {
  owner: string;
  spender: string;
  amountHex: string;
  unlimited: boolean;
  txHash: string;
}

export interface LatencyRecord {
  fetch: number;
  score: number;
  verdict: number;
  total: number;
}

export interface AnalyzeResult {
  address: string;
  hops: 1 | 2;
  graph: TransferGraph;
  score: number;
  breakdown: ScoreBreakdown;
  details: HeuristicDetail[];
  paths: string[][];
  pathMeta: SuspiciousPath[];
  nodeRisks: Record<string, number>;
  latency: { fetch: number; score: number; total: number };
  counts: { transfers: number; transactions: number; approvals: number };
}

export type VerdictMode = "clear" | "suspicious" | "high-risk" | "insufficient-evidence";
export type NextBestAction = "block" | "monitor" | "request-evidence";

export interface Verdict {
  verdict: VerdictMode;
  score: number;
  confidence: number;
  reasons: string[];
  evidencePath: string[];
  nextBestAction: NextBestAction;
}

export type VerdictSource = "llm" | "local" | "fallback";

// ---------------------------------------------------------------------------
// NDJSON wire contracts (POST /api/analyze, POST /api/verdict)
// ---------------------------------------------------------------------------

export type StageName = "fetching" | "graph" | "scoring";

export type AnalyzeEvent =
  | { type: "stage"; stage: StageName }
  | { type: "progress"; transfers: number; transactions: number }
  | { type: "result"; data: AnalyzeResult }
  | { type: "error"; code: string; message: string };

export type VerdictEvent =
  | { type: "model"; model: string }
  | { type: "token"; text: string }
  | { type: "retry"; reason: string }
  | {
      type: "done";
      verdict: Verdict;
      source: VerdictSource;
      model: string | null;
      attempts: number;
      latencyMs: number;
    }
  | { type: "error"; code: string; message: string };
