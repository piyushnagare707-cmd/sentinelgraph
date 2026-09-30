// localStorage helpers (recent addresses, p95 latency). Client-only by nature.

const RECENT_KEY = "sentinelgraph:recent";
const LATENCY_KEY = "sentinelgraph:latency";
const MAX_RECENT = 6;
const MAX_LATENCY_SAMPLES = 20;

export function loadRecentAddresses(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentAddress(address: string): void {
  try {
    const next = [address, ...loadRecentAddresses().filter((a) => a !== address)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (private mode) — ignore
  }
}

export function pushLatencySample(totalMs: number): void {
  try {
    const raw = localStorage.getItem(LATENCY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const samples = Array.isArray(parsed)
      ? parsed.filter((n): n is number => typeof n === "number")
      : [];
    samples.push(totalMs);
    localStorage.setItem(LATENCY_KEY, JSON.stringify(samples.slice(-MAX_LATENCY_SAMPLES)));
  } catch {
    // ignore
  }
}

/** 95th percentile of recorded end-to-end latencies (ms), or null if <3 samples. */
export function loadP95Latency(): number | null {
  try {
    const raw = localStorage.getItem(LATENCY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return null;
    const samples = parsed.filter((n): n is number => typeof n === "number").sort((a, b) => a - b);
    if (samples.length < 3) return null;
    const idx = Math.min(samples.length - 1, Math.ceil(0.95 * samples.length) - 1);
    return samples[idx];
  } catch {
    return null;
  }
}
