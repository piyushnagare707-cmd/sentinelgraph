import type { HeuristicInput } from "./index";
import type { HeuristicDetail } from "../types";

/**
 * ② Address age — 0..weight
 * Primary: how recently the target was first seen (tiered, from config).
 * Secondary: share of graph counterparties first seen within a recent window.
 * firstSeen is the earliest block observed in our data window (PRD §12 limitation).
 */
export function runAgeRisk(input: HeuristicInput): HeuristicDetail {
  const weight = input.weights.ageRisk;
  const { params } = input;
  const head = input.headBlock;

  const targetNode = input.graph.nodes.find((n) => n.id === input.target);
  const firstSeen = targetNode?.firstSeenBlock ?? null;

  if (head === null) {
    return {
      key: "ageRisk",
      value: 0,
      max: weight,
      summary: "Chain head unknown — age risk not measurable",
      evidence: [],
    };
  }

  let tierScore = 0;
  let blocksSince: number | null = null;
  if (firstSeen !== null) {
    blocksSince = Math.max(0, head - firstSeen);
    for (const tier of params.ageTiers) {
      if (blocksSince <= tier.maxBlocks) {
        tierScore = tier.score;
        break;
      }
    }
  }

  const counterparties = input.graph.nodes.filter(
    (n) => n.id !== input.target && n.firstSeenBlock !== null,
  );
  let recentScore = 0;
  let recentCount = 0;
  if (counterparties.length > 0) {
    recentCount = counterparties.filter(
      (n) => head - (n.firstSeenBlock as number) <= params.recentCounterpartyWindowBlocks,
    ).length;
    recentScore = weight * params.recentCounterpartyWeight * (recentCount / counterparties.length);
  }

  const value = Math.round(Math.min(weight, Math.max(tierScore, recentScore)));

  const evidence: string[] = [];
  if (firstSeen !== null) evidence.push(`firstSeenBlock=${firstSeen}`);
  if (blocksSince !== null) evidence.push(`blocksSince=${blocksSince}`);
  if (counterparties.length > 0) evidence.push(`recentCounterparties=${recentCount}/${counterparties.length}`);

  const summary =
    firstSeen === null
      ? "First-seen block unknown; " +
        (counterparties.length > 0
          ? `${recentCount}/${counterparties.length} counterparties seen in the last ${params.recentCounterpartyWindowBlocks.toLocaleString()} blocks`
          : "no counterparty age data")
      : `First seen ${blocksSince!.toLocaleString()} blocks ago; ${recentCount}/${counterparties.length} counterparties are recent`;

  return { key: "ageRisk", value, max: weight, summary, evidence };
}
