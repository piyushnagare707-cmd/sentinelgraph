import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tiny two-layer cache: in-memory Map in front of a file store.
 * PRD §12: file-based, 15-min TTL so a slow public RPC never kills a demo.
 * Failures never throw — cache is an optimization, not a dependency.
 */

interface Entry<T> {
  t: number;
  ttl: number;
  v: T;
}

const memory = new Map<string, Entry<unknown>>();

function cacheDir(): string {
  return join(process.cwd(), ".cache", "sentinelgraph");
}

function keyPath(key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  return join(cacheDir(), `${h}.json`);
}

export function cacheGet<T>(key: string): T | undefined {
  const now = Date.now();
  const mem = memory.get(key) as Entry<T> | undefined;
  if (mem && now - mem.t < mem.ttl) return mem.v;

  try {
    const raw = readFileSync(keyPath(key), "utf8");
    const entry = JSON.parse(raw) as Entry<T>;
    if (now - entry.t < entry.ttl) {
      memory.set(key, entry as Entry<unknown>);
      return entry.v;
    }
  } catch {
    // missing/corrupt/expired file — treat as miss
  }
  return undefined;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  const entry: Entry<T> = { t: Date.now(), ttl: ttlMs, v: value };
  memory.set(key, entry as Entry<unknown>);
  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(keyPath(key), JSON.stringify(entry), "utf8");
  } catch {
    // read-only fs etc. — memory layer still works
  }
}

/** Test helper. */
export function cacheClear(): void {
  memory.clear();
}
