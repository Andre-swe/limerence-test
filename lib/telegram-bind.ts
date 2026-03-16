import { createHmac, timingSafeEqual } from "node:crypto";
import type { Persona } from "@/lib/types";

type TelegramBindablePersona = Pick<Persona, "id" | "userId">;

function resolveTelegramBindSecret() {
  return (
    process.env.TELEGRAM_BIND_SECRET?.trim() ||
    process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "development-telegram-bind-secret"
  );
}

export function buildTelegramBindCode(persona: TelegramBindablePersona) {
  return createHmac("sha256", resolveTelegramBindSecret())
    .update(`${persona.id}:${persona.userId}`)
    .digest("base64url")
    .slice(0, 24);
}

export function buildTelegramBindCommand(persona: TelegramBindablePersona) {
  return `/bind ${persona.id} ${buildTelegramBindCode(persona)}`;
}

export function parseTelegramBindCommand(text: string) {
  const match = text.trim().match(/^\/bind\s+(\S+?)(?:\s+(\S+))?$/);

  if (!match) {
    return null;
  }

  return {
    personaId: match[1],
    code: match[2]?.trim() ?? "",
  };
}

export function isTelegramBindCodeValid(
  persona: TelegramBindablePersona,
  candidate: string | undefined,
) {
  const normalized = candidate?.trim() ?? "";
  const expected = buildTelegramBindCode(persona);

  if (normalized.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(normalized), Buffer.from(expected));
}
