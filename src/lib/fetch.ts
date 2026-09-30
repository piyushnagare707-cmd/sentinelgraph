import { AppError } from "./errors";
import { cacheGet, cacheSet } from "./cache";
import {
  BsAddressInfoSchema,
  BsTokenTransferItemSchema,
  BsTransactionItemSchema,
  listSchema,
  normalizeAddress,
} from "./schemas";
import type { AddressInfo, DecodedApproval, RawTransfer, RawTx } from "./types";

const BLOCKSCOUT = () => process.env.BLOCKSCOUT_API || "https://base-sepolia.blockscout.com";
const RPC_URL = () => process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org";

const FETCH_TIMEOUT_MS = 15_000;

export const APPROVE_SELECTOR = "0x095ea7b3";

// ---------------------------------------------------------------------------
// low-level helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function blockscoutJson(path: string): Promise<unknown> {
  const url = `${BLOCKSCOUT()}${path}`;
  let lastError: AppError | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (res.status === 404) throw new AppError("not-found", "Address not found on this chain");
      if (res.status === 429) {
        lastError = new AppError("rate-limited", "Blockscout rate limit hit");
        await sleep(700);
        continue;
      }
      if (res.status >= 500) {
        lastError = new AppError("upstream-error", `Blockscout ${res.status}`);
        continue;
      }
      if (!res.ok) throw new AppError("upstream-error", `Blockscout ${res.status}`);
      return await res.json();
    } catch (e) {
      if (e instanceof AppError) throw e;
      lastError =
        e instanceof Error && e.name === "TimeoutError"
          ? new AppError("timeout", "Blockscout request timed out")
          : new AppError("upstream-error", e instanceof Error ? e.message : "network error");
    }
  }
  throw lastError ?? new AppError("upstream-error", "Blockscout unreachable");
}

function parseOrDrift<T>(data: unknown, schema: { safeParse(d: unknown): { success: boolean; data?: T; error?: { issues: unknown[] } } }): T {
  const res = schema.safeParse(data);
  if (!res.success || res.data === undefined) {
    const issue = JSON.stringify((res as { error?: { issues: unknown[] } }).error?.issues?.[0] ?? {});
    throw new AppError("upstream-error", `Blockscout response failed schema check: ${issue}`);
  }
  return res.data;
}

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

export async function rpcCall<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  let lastError: AppError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(RPC_URL(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.status === 429) {
        lastError = new AppError("rate-limited", "RPC rate limit hit");
        await sleep(700);
        continue;
      }
      const body = (await res.json()) as { result?: T; error?: { message?: string } };
      if (body.error) throw new AppError("upstream-error", body.error.message ?? "RPC error");
      if (body.result === undefined || body.result === null) {
        throw new AppError("upstream-error", "RPC returned empty result");
      }
      return body.result;
    } catch (e) {
      if (e instanceof AppError) throw e;
      lastError =
        e instanceof Error && e.name === "TimeoutError"
          ? new AppError("timeout", "RPC request timed out")
          : new AppError("upstream-error", e instanceof Error ? e.message : "network error");
    }
  }
  throw lastError ?? new AppError("upstream-error", "RPC unreachable");
}

export async function fetchHeadBlock(): Promise<number> {
  const hex = await rpcCall<string>("eth_blockNumber");
  return Number.parseInt(hex, 16);
}

// ---------------------------------------------------------------------------
// Blockscout resources (each cached 15 min — see config/heuristics.json)
// ---------------------------------------------------------------------------

const TTL = () => 15 * 60 * 1000;

export async function fetchAddressInfo(address: string): Promise<AddressInfo> {
  const addr = normalizeAddress(address);
  const key = `info:${addr}`;
  const cached = cacheGet<AddressInfo>(key);
  if (cached) return cached;

  const raw = await blockscoutJson(`/api/v2/addresses/${addr}`);
  const info = parseOrDrift(raw, BsAddressInfoSchema);
  const tags = (info.metadata?.tags ?? []).flatMap((t) => (t.name ? [t.name] : []));

  const out: AddressInfo = {
    hash: info.hash.toLowerCase(),
    isContract: info.is_contract === true,
    isScam: info.is_scam === true,
    isVerified: info.is_verified === true,
    name: info.name ?? tags[0] ?? null,
    creator: info.creator_address_hash ? info.creator_address_hash.toLowerCase() : null,
    creationTx: info.creation_transaction_hash ?? null,
    reputation: info.reputation ?? null,
    tags,
  };
  cacheSet(key, out, TTL());
  return out;
}

export interface FetchProgress {
  transfers: number;
  transactions: number;
}

type ProgressFn = (p: FetchProgress) => void;

async function fetchTokenTransferPages(
  addr: string,
  max: number,
  onProgress?: ProgressFn,
  seen = 0,
): Promise<RawTransfer[]> {
  const schema = listSchema(BsTokenTransferItemSchema);
  const out: RawTransfer[] = [];
  let path = `/api/v2/addresses/${addr}/token-transfers${qs({ type: "ERC-20" })}`;
  let pages = 0;

  while (path && out.length + seen < max && pages < 6) {
    const key = `transfers:${addr}:${path}`;
    let data = cacheGet<unknown>(key);
    if (data === undefined) {
      data = await blockscoutJson(path);
      cacheSet(key, data, TTL());
    }
    const page = parseOrDrift(data, schema);
    for (const item of page.items) {
      if (out.length + seen >= max) break;
      if (!item.token) continue; // defensive: non-standard transfer rows
      out.push({
        txHash: item.transaction_hash,
        blockNumber: item.block_number,
        timestamp: item.timestamp,
        logIndex: item.log_index ?? 0,
        from: item.from.hash.toLowerCase(),
        to: item.to.hash.toLowerCase(),
        value: item.total?.value ?? "0",
        token: {
          address: item.token.address_hash.toLowerCase(),
          symbol: item.token.symbol ?? null,
          name: item.token.name ?? null,
          decimals: item.token.decimals !== null && item.token.decimals !== undefined ? Number(item.token.decimals) : null,
          type: item.token.type ?? item.token_type ?? "ERC-20",
        },
        fromIsContract: item.from.is_contract === true,
        toIsContract: item.to.is_contract === true,
        fromName: item.from.name ?? null,
        toName: item.to.name ?? null,
      });
    }
    onProgress?.({ transfers: out.length + seen, transactions: 0 });
    const next = page.next_page_params;
    path =
      next && Object.keys(next).length > 0
        ? `/api/v2/addresses/${addr}/token-transfers${qs({ ...next, type: "ERC-20" })}`
        : "";
    pages++;
  }
  return out;
}

async function fetchTxPages(
  addr: string,
  max: number,
  onProgress?: ProgressFn,
  seen = 0,
): Promise<RawTx[]> {
  const schema = listSchema(BsTransactionItemSchema);
  const out: RawTx[] = [];
  let path = `/api/v2/addresses/${addr}/transactions`;
  let pages = 0;

  while (path && out.length + seen < max && pages < 4) {
    const key = `txs:${addr}:${path}`;
    let data = cacheGet<unknown>(key);
    if (data === undefined) {
      data = await blockscoutJson(path);
      cacheSet(key, data, TTL());
    }
    const page = parseOrDrift(data, schema);
    for (const item of page.items) {
      if (out.length + seen >= max) break;
      out.push({
        hash: item.hash,
        blockNumber: item.block_number,
        timestamp: item.timestamp,
        from: item.from.hash.toLowerCase(),
        to: item.to?.hash ? item.to.hash.toLowerCase() : null,
        value: item.value ?? "0",
        method: item.method ?? null,
        rawInput: item.raw_input ?? "0x",
        fromIsContract: item.from.is_contract === true,
        toIsContract: item.to?.is_contract === true,
        fromName: item.from.name ?? null,
        toName: item.to?.name ?? null,
      });
    }
    onProgress?.({ transfers: 0, transactions: out.length + seen });
    const next = page.next_page_params;
    path = next && Object.keys(next).length > 0 ? `/api/v2/addresses/${addr}/transactions${qs(next)}` : "";
    pages++;
  }
  return out;
}

export interface AddressBundle {
  info: AddressInfo | null;
  transfers: RawTransfer[];
  txs: RawTx[];
}

export async function fetchAddressBundle(
  address: string,
  opts: { maxTransfers: number; maxTx: number; withInfo?: boolean; onProgress?: ProgressFn; progressOffset?: number },
): Promise<AddressBundle> {
  const addr = normalizeAddress(address);
  const offset = opts.progressOffset ?? 0;
  const mergeProgress: ProgressFn = (p) =>
    opts.onProgress?.({ transfers: p.transfers + offset, transactions: p.transactions + offset });

  const [info, transfers, txs] = await Promise.all([
    opts.withInfo === false
      ? Promise.resolve(null)
      : fetchAddressInfo(addr).catch((e) => {
          if (e instanceof AppError && e.code === "not-found") return null;
          throw e;
        }),
    fetchTokenTransferPages(addr, opts.maxTransfers, mergeProgress),
    fetchTxPages(addr, opts.maxTx, mergeProgress),
  ]);

  return { info, transfers, txs };
}

// ---------------------------------------------------------------------------
// Approvals — decoded straight from the raw tx input (no extra RPC calls)
// ---------------------------------------------------------------------------

function decodeApproveInput(rawInput: string, owner: string, txHash: string): DecodedApproval | null {
  const hex = rawInput.startsWith("0x") ? rawInput.slice(2) : rawInput;
  if (hex.toLowerCase().startsWith(APPROVE_SELECTOR.slice(2)) && hex.length >= 8 + 64 + 64) {
    const spenderWord = hex.slice(8 + 24, 8 + 64); // last 20 bytes of word 1
    const amountWord = hex.slice(8 + 64, 8 + 128);
    const spender = `0x${spenderWord.toLowerCase()}`;
    return {
      owner: owner.toLowerCase(),
      spender,
      amountHex: `0x${amountWord.toLowerCase()}`,
      unlimited: false, // filled by caller against config threshold
      txHash,
    };
  }
  return null;
}

export function extractApprovals(txs: RawTx[], unlimitedMinHex: string): DecodedApproval[] {
  const min = BigInt(unlimitedMinHex);
  const out: DecodedApproval[] = [];
  for (const tx of txs) {
    const methodLooksLikeApprove =
      (tx.method ?? "").toLowerCase().startsWith("approve") ||
      tx.rawInput.toLowerCase().startsWith(APPROVE_SELECTOR);
    if (!methodLooksLikeApprove) continue;
    const decoded = decodeApproveInput(tx.rawInput, tx.from, tx.hash);
    if (!decoded) continue;
    try {
      decoded.unlimited = BigInt(decoded.amountHex) >= min;
    } catch {
      decoded.unlimited = false;
    }
    out.push(decoded);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Convenience for tests/fixtures
// ---------------------------------------------------------------------------

export async function fetchTransfersPage(address: string, limit = 50): Promise<RawTransfer[]> {
  return fetchTokenTransferPages(normalizeAddress(address), limit);
}
