import type { NextRequest } from "next/server";
import { generateVerdict } from "@/lib/ai/verdict";
import { toAppError } from "@/lib/errors";
import { VerdictRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function errorJson(code: string, message: string, status: number): Response {
  return Response.json({ error: code, message }, { status });
}

/**
 * POST /api/verdict
 * Streams NDJSON: model? → token* → (retry → token*) → done | error
 * The final `done` payload always carries a schema-valid verdict:
 * LLM → corrective retry once → deterministic local fallback (PRD §5 guardrails).
 */
export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorJson("invalid-address", "Request body must be JSON", 400);
  }

  const parsed = VerdictRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return errorJson("invalid-address", "Malformed verdict request body", 400);
  }

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
        const outcome = await generateVerdict(parsed.data, {
          onToken: (text) => send({ type: "token", text }),
          onRetry: (reason) => send({ type: "retry", reason }),
          onModel: (model) => send({ type: "model", model }),
        });
        send({
          type: "done",
          verdict: outcome.verdict,
          source: outcome.source,
          model: outcome.model,
          attempts: outcome.attempts,
          latencyMs: outcome.latencyMs,
        });
      } catch (e) {
        const app = toAppError(e);
        send({ type: "error", code: app.code, message: app.message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // client already gone
        }
      }
    },
    cancel() {
      // client disconnected
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
