import { NextResponse } from "next/server";
import { approvePersona } from "@/lib/services";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  try {
    const { personaId } = await params;
    const payload = await request.json();
    const persona = await approvePersona(personaId, payload);

    return NextResponse.json({
      persona,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to approve persona.",
      },
      { status: 400 },
    );
  }
}
