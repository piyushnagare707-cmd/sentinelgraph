import type { HeuristicInput } from "./index";
import type { HeuristicDetail } from "../types";

/**
 * ⑤ Approval-to-unlimited — 0..weight
 * Decoded from approve() calldata already present in the fetched tx list
 * (zero extra RPC calls). Unlimited = amount >= config threshold.
 * Approvals to labeled/known spenders are discounted — approving Uniswap is
 * normal; approving an unknown contract with max uint256 is not.
 */
export function runApprovalRisk(input: HeuristicInput): HeuristicDetail {
  const weight = input.weights.approvalRisk;
  const p = input.params;

  const unlimited = input.approvals.filter((a) => a.unlimited);
  if (unlimited.length === 0) {
    const anyApprovals = input.approvals.length;
    return {
      key: "approvalRisk",
      value: 0,
      max: weight,
      summary:
        anyApprovals > 0
          ? `${anyApprovals} approval(s) found, none unlimited`
          : "No approve() calls in the analyzed transaction window",
      evidence: [],
    };
  }

  const nodeById = new Map(input.graph.nodes.map((n) => [n.id, n]));
  const knownCount = unlimited.filter((a) => {
    const node = nodeById.get(a.spender.toLowerCase());
    return node?.label != null || node?.isVerified === true;
  }).length;

  const base = Math.min(unlimited.length, p.approvalBaseCap) / p.approvalBaseCap;
  const allKnown = knownCount === unlimited.length;
  const factor = knownCount > 0 && allKnown ? p.knownSpenderLabelFactor : 1;
  const value = Math.round(weight * base * factor);

  const sample = unlimited[0];
  const knownNote = knownCount > 0 ? `${knownCount} to labeled spenders (discounted)` : "all to unlabeled spenders";

  return {
    key: "approvalRisk",
    value,
    max: weight,
    summary: `${unlimited.length} unlimited approval(s) — ${knownNote}`,
    evidence: [sample.txHash, sample.owner, `spender=${sample.spender}`],
  };
}
