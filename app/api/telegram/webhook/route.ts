import { NextResponse } from "next/server";
import { processTelegramWebhook } from "@/lib/services";

export const runtime = "nodejs";

/** Receives an inbound Telegram Bot API update and routes it to the bound persona for processing. */
export async function POST(request: Request) {
  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!webhookSecret || secretHeader !== webhookSecret) {
    return NextResponse.json(
      { error: "Unauthorized. Invalid webhook secret." },
      { status: 401 }
    );
  }

  try {
    const payload = await request.json();
    const result = await processTelegramWebhook(payload);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to process Telegram update.",
      },
      { status: 400 },
    );
  }
}
