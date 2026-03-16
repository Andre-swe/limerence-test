import { createHmac, timingSafeEqual } from "node:crypto";
import type { Persona } from "@/lib/types";

type TelegramBindablePersona = Pick<Persona, "id" | "userId">;

const TELEGRAM_BIND_CODE_TTL_MS = 15 * 60 * 1000;
const TELEGRAM_BIND_FUTURE_SKEW_MS = 60 * 1000;

export const telegramBindCodeLifetimeMinutes = Math.floor(
  TELEGRAM_BIND_CODE_TTL_MS / 60_000,
);

function resolveTelegramBindSecret() {
  return (
    process.env.TELEGRAM_BIND_SECRET?.trim() ||
    process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "development-telegram-bind-secret"
  );
}

function bindCodeTimestampToken(issuedAtMs: number) {
  return Math.floor(issuedAtMs / 1000).toString(36);
}

function bindCodeSignature(persona: TelegramBindablePersona, timestampToken: string) {
  return createHmac("sha256", resolveTelegramBindSecret())
    .update(`${persona.id}:${persona.userId}:${timestampToken}`)
    .digest("base64url")
    .slice(0, 24);
}

function parseTimestampToken(token: string) {
  if (!/^[0-9a-z]+$/.test(token)) {
    return null;
  }

  const issuedAtSeconds = Number.parseInt(token, 36);
  if (!Number.isFinite(issuedAtSeconds)) {
    return null;
  }

  return issuedAtSeconds * 1000;
}

export function buildTelegramBindCode(
  persona: TelegramBindablePersona,
  issuedAtMs = Date.now(),
) {
  const timestampToken = bindCodeTimestampToken(issuedAtMs);
  return `${timestampToken}.${bindCodeSignature(persona, timestampToken)}`;
}

export function buildTelegramBindCommand(
  persona: TelegramBindablePersona,
  issuedAtMs = Date.now(),
) {
  return `/bind ${persona.id} ${buildTelegramBindCode(persona, issuedAtMs)}`;
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
  nowMs = Date.now(),
) {
  const normalized = candidate?.trim() ?? "";
  const match = normalized.match(/^([0-9a-z]+)\.([A-Za-z0-9_-]+)$/);

  if (!match) {
    return false;
  }

  const issuedAtMs = parseTimestampToken(match[1]);
  if (issuedAtMs === null) {
    return false;
  }

  const ageMs = nowMs - issuedAtMs;
  if (ageMs < -TELEGRAM_BIND_FUTURE_SKEW_MS || ageMs > TELEGRAM_BIND_CODE_TTL_MS) {
    return false;
  }

  const expected = buildTelegramBindCode(persona, issuedAtMs);

  if (normalized.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(normalized), Buffer.from(expected));
}
