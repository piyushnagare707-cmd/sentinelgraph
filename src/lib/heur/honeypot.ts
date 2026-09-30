import type { HeuristicInput } from "./index";
import type { HeuristicDetail, RawTransfer } from "../types";

interface Group {
  txHash: string;
  token: string;
  legs: RawTransfer[];
}

function big(v: string): bigint {
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

/**
 * ③ Honeypot / fee-on-transfer tax — 0..weight
 * In one transaction a taxed token emits several Transfer legs for the same
 * token: the main leg plus a fee leg (sender-split or recipient-forward).
 * taxPct = feeLegs / mainLeg. Fires when tax > threshold (default 10%).
 * Runs on the RAW transfer list (pre-prune) so legs are never half-missing.
 */
export function runHoneypotTax(input: HeuristicInput): HeuristicDetail {
  const weight = input.weights.honeypotTax;
  const p = input.params;

  // how many distinct senders paid each address for each token (collector signal)
  const sendersByPayee = new Map<string, Set<string>>();
  for (const t of input.transfers) {
    const key = `${t.token.address}:${t.to}`;
    let s = sendersByPayee.get(key);
    if (!s) {
      s = new Set();
      sendersByPayee.set(key, s);
    }
    s.add(t.from);
  }

  const groups = new Map<string, Group>();
  for (const t of input.transfers) {
    const key = `${t.txHash}:${t.token.address}`;
    let g = groups.get(key);
    if (!g) {
      g = { txHash: t.txHash, token: t.token.address, legs: [] };
      groups.set(key, g);
    }
    g.legs.push(t);
  }

  let bestTaxPct = 0;
  let bestTx = "";
  let bestFee = "";

  for (const g of groups.values()) {
    if (g.legs.length < 2) continue;

    let main = g.legs[0];
    for (const leg of g.legs) if (big(leg.value) > big(main.value)) main = leg;
    const mainVal = big(main.value);
    if (mainVal === 0n) continue;

    let feeSum = 0n;
    for (const leg of g.legs) {
      if (leg === main) continue;
      const val = big(leg.value);
      if (val === 0n) continue;
      const ratio = Number(val) / Number(mainVal);
      if (ratio > p.honeypotMaxSideLegRatio) continue; // batch send, not a fee

      const senderSplit = leg.from === main.from; // A→B net + A→collector
      const recipientForward = leg.from === main.to; // A→B + B→collector
      const collectors = sendersByPayee.get(`${g.token}:${leg.to}`)?.size ?? 0;
      const isCollector = collectors >= 2; // payee accumulates from many senders
      const sameToken = leg.token.address === g.token;

      if (sameToken && (senderSplit || recipientForward || isCollector)) {
        feeSum += val;
      }
    }
    if (feeSum === 0n) continue;

    const taxPct = (Number(feeSum) / Number(mainVal)) * 100;
    if (taxPct > bestTaxPct) {
      bestTaxPct = taxPct;
      bestTx = g.txHash;
      const symbols = main.token.symbol ?? main.token.address.slice(0, 10);
      bestFee = `${taxPct.toFixed(1)}% ${symbols}`;
    }
  }

  if (bestTaxPct <= p.honeypotTaxThresholdPct) {
    return {
      key: "honeypotTax",
      value: 0,
      max: weight,
      summary:
        bestTaxPct > 0
          ? `Largest fee-on-transfer observed: ${bestTaxPct.toFixed(1)}% (≤ ${p.honeypotTaxThresholdPct}% threshold)`
          : `No fee-on-transfer pattern above ${p.honeypotTaxThresholdPct}%`,
      evidence: bestTx ? [bestTx] : [],
    };
  }

  const value = Math.round(weight * (Math.min(bestTaxPct, p.honeypotMaxTaxPct) / p.honeypotMaxTaxPct));
  return {
    key: "honeypotTax",
    value: Math.max(1, value),
    max: weight,
    summary: `Fee-on-transfer detected: ${bestFee} tax (threshold ${p.honeypotTaxThresholdPct}%)`,
    evidence: [bestTx, `taxPct=${bestTaxPct.toFixed(1)}`],
  };
}
