import { NextResponse } from "next/server";
import { runDueHeartbeats } from "@/lib/services";

export const runtime = "nodejs";

/** Cron-style endpoint that runs all due persona heartbeats. */
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

    return NextResponse.json({
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to run due heartbeats.",
      },
      { status: 500 },
    );
  }
}
