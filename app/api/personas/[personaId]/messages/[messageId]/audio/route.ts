import { NextResponse } from "next/server";
import { synthesizeStoredReply } from "@/lib/services";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ personaId: string; messageId: string }>;
  },
) {
  try {
    const { personaId, messageId } = await params;
    const message = await synthesizeStoredReply(personaId, messageId);

    return NextResponse.json({ message });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to synthesize audio.",
      },
      { status: 400 },
    );
  }
}
