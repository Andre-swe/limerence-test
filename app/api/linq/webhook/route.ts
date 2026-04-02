import { after, NextResponse } from "next/server";
import { linqInboundMessageWebhookSchema, verifyLinqWebhookSignature } from "@/lib/linq";
import { soulLogger } from "@/lib/soul-logger";
import { processLinqMessageWebhook } from "@/lib/services/linq";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.LINQ_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "LINQ_WEBHOOK_SECRET is not configured." },
      { status: 500 },
    );
  }

  const rawBody = await request.text();
  const timestamp = request.headers.get("x-webhook-timestamp");
  const signature = request.headers.get("x-webhook-signature");

  if (
    !verifyLinqWebhookSignature({
      rawBody,
      timestamp,
      signature,
      secret,
    })
  ) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = linqInboundMessageWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Unsupported Linq webhook payload.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  after(async () => {
    try {
      await processLinqMessageWebhook(parsed.data);
    } catch (error) {
      soulLogger.error(
        {
          eventType: parsed.data.event_type,
          eventId: parsed.data.event_id,
          traceId: parsed.data.trace_id,
          error,
        },
        "Failed to process Linq webhook",
      );
    }
  });

  return NextResponse.json({
    ok: true,
    accepted: true,
    eventType: parsed.data.event_type,
    eventId: parsed.data.event_id,
  });
}
