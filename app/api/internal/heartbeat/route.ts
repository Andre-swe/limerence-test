import { NextResponse } from "next/server";
import { flushPendingTelegramMessages, runDueHeartbeats } from "@/lib/services";

export const runtime = "nodejs";

/** Cron-style endpoint that runs all due persona heartbeats and flushes any pending Telegram outbound messages. */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized. Valid CRON_SECRET required." },
      { status: 401 }
    );
  }

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
