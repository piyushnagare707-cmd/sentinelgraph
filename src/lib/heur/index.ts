import type { HeuristicParams, HeuristicWeights } from "../config";
import type { DecodedApproval, HeuristicDetail, RawTransfer, TransferGraph } from "../types";
import { runFanAsymmetry } from "./fanout";
import { runAgeRisk } from "./age";
import { runHoneypotTax } from "./honeypot";
import { runDeployerReuse } from "./deployer";
import { runApprovalRisk } from "./approval";

export interface HeuristicInput {
  graph: TransferGraph;
  /** RAW transfers (pre-prune) so tx groups are never half-missing. */
  transfers: RawTransfer[];
  target: string;
  headBlock: number | null;
  approvals: DecodedApproval[];
  weights: HeuristicWeights;
  params: HeuristicParams;
}

export const HEURISTIC_RUNNERS = {
  fanAsymmetry: runFanAsymmetry,
  ageRisk: runAgeRisk,
  honeypotTax: runHoneypotTax,
  deployerReuse: runDeployerReuse,
  approvalRisk: runApprovalRisk,
} as const;

export function runAllHeuristics(input: HeuristicInput): HeuristicDetail[] {
  return [
    runFanAsymmetry(input),
    runAgeRisk(input),
    runHoneypotTax(input),
    runDeployerReuse(input),
    runApprovalRisk(input),
  ];
}
