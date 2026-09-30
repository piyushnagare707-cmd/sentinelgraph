import type { NextRequest } from "next/server";
import { analyze } from "@/lib/pipeline";
import { toAppError } from "@/lib/errors";
import { AnalyzeBodySchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function ndjson(res: unknown): Response {
  return new Response(res as BodyInit, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

function errorJson(code: string, message: string, status: number): Response {
  return Response.json({ error: code, message }, { status });
}

/**
 * POST /api/analyze
 * Streams NDJSON: stage → progress* → result | error  (PRD §7, §5 architecture "stream")
 */
export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorJson("invalid-address", "Request body must be JSON", 400);
  }

  const parsed = AnalyzeBodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorJson("invalid-address", "Expected { address: '0x…', hops: 1 | 2 }", 400);
  }

  const { address, hops } = parsed.data;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          closed = true;
        }
      };

      try {
        const result = await analyze(address, hops, {
          onStage: (stage) => send({ type: "stage", stage }),
          onProgress: (p) => send({ type: "progress", transfers: p.transfers, transactions: p.transactions }),
        });
        send({ type: "result", data: result });
      } catch (e) {
        const app = toAppError(e);
        send({ type: "error", code: app.code, message: app.message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by client
        }
      }
    },
    cancel() {
      // client disconnected — nothing to clean up (fetches are fire-and-forget)
    },
  });

  return ndjson(stream);
}
