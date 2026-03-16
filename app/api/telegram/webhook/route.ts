import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processTelegramWebhook } from "@/lib/services";

export const runtime = "nodejs";

function safeSecretMatch(a: string, b: string) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Receives an inbound Telegram Bot API update and routes it to the bound persona for processing. */
export async function POST(request: Request) {
  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!webhookSecret || !safeSecretMatch(secretHeader, webhookSecret)) {
    return NextResponse.json(
      { error: "Unauthorized. Invalid webhook secret." },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Record<string, unknown>).update_id !== "number"
  ) {
    return NextResponse.json(
      { error: "Missing or invalid update_id." },
      { status: 400 },
    );
  }

  try {
    const result = await processTelegramWebhook(payload as Parameters<typeof processTelegramWebhook>[0]);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to process Telegram update.",
      },
      { status: 500 },
    );
  }
}
