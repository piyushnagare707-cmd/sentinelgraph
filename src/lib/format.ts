// Small pure formatting helpers shared by server and client components.

export function shortAddr(addr: string, lead = 6, tail = 4): string {
  if (addr.length <= lead + tail + 1) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

/** BigInt-safe raw token units → human string (truncated to 4 significant decimals). */
export function formatTokenAmount(raw: string, decimals: number | null): string {
  try {
    const value = BigInt(raw);
    const d = decimals ?? 18;
    const negative = value < 0n;
    const abs = negative ? -value : value;
    const base = 10n ** BigInt(d);
    const whole = abs / base;
    const frac = abs % base;
    let out = whole.toString();
    if (frac > 0n && whole < 10n ** 12n) {
      const fracStr = frac.toString().padStart(d, "0").replace(/0+$/, "").slice(0, 4);
      if (fracStr) out += `.${fracStr}`;
    }
    return negative ? `-${out}` : out;
  } catch {
    return raw;
  }
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export type Tone = "clear" | "warn" | "high" | "info" | "muted";

const VERDICT_TONE: Record<string, Tone> = {
  clear: "clear",
  suspicious: "warn",
  "high-risk": "high",
  "insufficient-evidence": "muted",
};

export function verdictTone(verdict: string): Tone {
  return VERDICT_TONE[verdict] ?? "info";
}

/** Tailwind classes for a tone — used by badges, gauges, graph nodes. */
export function toneClasses(tone: Tone): string {
  switch (tone) {
    case "clear":
      return "text-risk-clear border-risk-clear/40 bg-risk-clear/10";
    case "warn":
      return "text-risk-warn border-risk-warn/40 bg-risk-warn/10";
    case "high":
      return "text-risk-high border-risk-high/40 bg-risk-high/10";
    case "info":
      return "text-risk-info border-risk-info/40 bg-risk-info/10";
    case "muted":
      return "text-muted-foreground border-border bg-muted/40";
  }
}

/** Score gauge hue follows the verdict when known, otherwise score bands. */
export function scoreTone(score: number, verdict?: string): Tone {
  if (verdict) return verdictTone(verdict);
  if (score >= 70) return "high";
  if (score >= 40) return "warn";
  return "clear";
}

export const TONE_TEXT: Record<Tone, string> = {
  clear: "var(--risk-clear)",
  warn: "var(--risk-warn)",
  high: "var(--risk-high)",
  info: "var(--risk-info)",
  muted: "var(--muted-foreground)",
};

export const VERDICT_LABEL: Record<string, string> = {
  clear: "CLEAR",
  suspicious: "SUSPICIOUS",
  "high-risk": "HIGH RISK",
  "insufficient-evidence": "INSUFFICIENT EVIDENCE",
};

export const NEXT_ACTION_LABEL: Record<string, string> = {
  block: "Block / reject interaction",
  monitor: "Monitor closely",
  "request-evidence": "Request more evidence",
};

export const ERROR_HINTS: Record<string, string> = {
  "invalid-address": "That doesn't look like a 0x address — check for typos.",
  "not-found": "No on-chain activity found for this address yet.",
  "rate-limited": "Upstream indexer is rate limiting us — wait a moment and retry.",
  "upstream-error": "Blockscout or the Base Sepolia RPC had a problem — retry shortly.",
  timeout: "Upstream request timed out — retry, or pick a less active address.",
  internal: "Something broke on our side — retry, and check server logs if it persists.",
};
