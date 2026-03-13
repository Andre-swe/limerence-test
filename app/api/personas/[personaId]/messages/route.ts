import { NextResponse } from "next/server";
import { sendPersonaMessage } from "@/lib/services";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  try {
    const { personaId } = await params;
    const formData = await request.formData();
    const text = String(formData.get("text") ?? "").trim();
    const channel = String(formData.get("channel") ?? "web");
    const audio = formData.get("audio");
    const images = formData
      .getAll("images")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    const result = await sendPersonaMessage(personaId, {
      text,
      channel: channel === "telegram" ? "telegram" : "web",
      audioFile: audio instanceof File ? audio : null,
      images,
    });

    return NextResponse.json({
      persona: result.persona,
      messages: result.messages,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to send message.",
      },
      { status: 400 },
    );
  }
}
