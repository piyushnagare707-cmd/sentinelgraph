import rawConfig from "../../config/heuristics.json";

export interface HeuristicParams {
  maxTransfers: number;
  maxNativeTx: number;
  maxNodes: number;
  maxEdges: number;
  max2HopSeeds: number;
  deployerInfoFetchLimit: number;
  honeypotTaxThresholdPct: number;
  honeypotMaxTaxPct: number;
  honeypotMaxSideLegRatio: number;
  deployerReuseFullAt: number;
  unlimitedApprovalMinHex: string;
  approvalBaseCap: number;
  knownSpenderLabelFactor: number;
  ageTiers: { maxBlocks: number; score: number }[];
  recentCounterpartyWindowBlocks: number;
  recentCounterpartyWeight: number;
  minFanDegree: number;
  cacheTtlMs: number;
}

export type HeuristicWeights = Record<keyof typeof rawConfig.weights, number>;

export interface HeuristicsConfig {
  weights: HeuristicWeights;
  params: HeuristicParams;
}

export function loadHeuristicsConfig(): HeuristicsConfig {
  // JSON import is static so reviewers can audit config/heuristics.json directly.
  return rawConfig as unknown as HeuristicsConfig;
}

export const HEURISTIC_KEYS = [
  "fanAsymmetry",
  "ageRisk",
  "honeypotTax",
  "deployerReuse",
  "approvalRisk",
] as const;
