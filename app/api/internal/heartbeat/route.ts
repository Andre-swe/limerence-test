import { NextResponse } from "next/server";
import { flushPendingTelegramMessages, runDueHeartbeats } from "@/lib/services";

export const runtime = "nodejs";

/** Cron-style endpoint that runs all due persona heartbeats and flushes any pending Telegram outbound messages. */
export async function POST() {
  try {
    const results = await runDueHeartbeats();
    const telegram = await flushPendingTelegramMessages();

    return NextResponse.json({
      results,
      telegram,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to run due heartbeats.",
      },
      { status: 400 },
    );
  }
}
