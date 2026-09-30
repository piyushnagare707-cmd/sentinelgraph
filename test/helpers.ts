import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHeuristicsConfig } from "@/lib/config";
import type { HeuristicInput } from "@/lib/heur";
import type {
  DecodedApproval,
  GraphNode,
  RawTransfer,
  RawTx,
  TokenRef,
  TransferGraph,
} from "@/lib/types";

const here = dirname(fileURLToPath(import.meta.url));

export function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
}

/** Deterministic fake address: 0x000…00n */
export function A(n: number): string {
  return `0x${n.toString(16).padStart(40, "0")}`;
}

export const TOKEN: TokenRef = {
  address: "0x" + "aa".repeat(20),
  symbol: "TKN",
  name: "Test Token",
  decimals: 18,
  type: "ERC-20",
};

let txCounter = 1;
export function txHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, "0")}`;
}

export function makeTransfer(o: {
  from: string;
  to: string;
  value?: string;
  block?: number;
  token?: TokenRef;
  hash?: string;
  logIndex?: number;
  fromContract?: boolean;
  toContract?: boolean;
  fromName?: string | null;
  toName?: string | null;
}): RawTransfer {
  return {
    txHash: o.hash ?? txHash(),
    blockNumber: o.block ?? 1_000_000,
    timestamp: "2026-01-01T00:00:00.000000Z",
    logIndex: o.logIndex ?? 0,
    from: o.from,
    to: o.to,
    value: o.value ?? "1000",
    token: o.token ?? TOKEN,
    fromIsContract: o.fromContract ?? false,
    toIsContract: o.toContract ?? false,
    fromName: o.fromName ?? null,
    toName: o.toName ?? null,
  };
}

export function makeTx(o: {
  from: string;
  to?: string | null;
  value?: string;
  block?: number;
  method?: string | null;
  rawInput?: string;
  hash?: string;
}): RawTx {
  return {
    hash: o.hash ?? txHash(),
    blockNumber: o.block ?? 1_000_000,
    timestamp: "2026-01-01T00:00:00.000000Z",
    from: o.from,
    to: o.to === undefined ? A(2) : o.to,
    value: o.value ?? "0",
    method: o.method ?? null,
    rawInput: o.rawInput ?? "0x",
    fromIsContract: false,
    toIsContract: false,
    fromName: null,
    toName: null,
  };
}

export function makeNode(o: Partial<GraphNode> & { id: string }): GraphNode {
  return {
    kind: "eoa",
    label: null,
    firstSeenBlock: 1_000_000,
    txCount: 1,
    isScam: false,
    isVerified: false,
    isTarget: false,
    creator: null,
    ...o,
  };
}

export function makeGraph(nodes: Partial<GraphNode>[], edges: TransferGraph["edges"]): TransferGraph {
  return { nodes: nodes.map((n) => makeNode({ ...n, id: n.id ?? A(99) })), edges };
}

export function makeInput(overrides: Partial<HeuristicInput> = {}): HeuristicInput {
  const cfg = loadHeuristicsConfig();
  return {
    graph: { nodes: [], edges: [] },
    transfers: [],
    target: A(1),
    headBlock: 2_000_000,
    approvals: [] as DecodedApproval[],
    weights: cfg.weights,
    params: cfg.params,
    ...overrides,
  };
}

/** Build approve(address,uint256) calldata. */
export function approveInput(spender: string, amount: bigint): string {
  const spenderWord = spender.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const amountWord = amount.toString(16).padStart(64, "0");
  return `0x095ea7b3${spenderWord}${amountWord}`;
}
