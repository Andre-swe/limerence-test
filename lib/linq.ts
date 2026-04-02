import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const DEFAULT_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner";
export const DEFAULT_LINQ_WEBHOOK_VERSION = "2026-02-03";

const linqMessagePartSchema = z
  .object({
    type: z.string(),
    value: z.string().optional(),
    url: z.string().optional(),
    attachment_id: z.string().optional(),
  })
  .passthrough();

const linqHandleSchema = z
  .object({
    handle: z.string(),
    service: z.string().optional(),
    is_me: z.boolean().optional(),
  })
  .passthrough();

export const linqInboundMessageWebhookSchema = z
  .object({
    api_version: z.string(),
    webhook_version: z.string(),
    event_type: z.string(),
    event_id: z.string(),
    created_at: z.string(),
    trace_id: z.string(),
    partner_id: z.string(),
    data: z
      .object({
        id: z.string(),
        direction: z.enum(["inbound", "outbound"]).optional(),
        parts: z.array(linqMessagePartSchema).default([]),
        sent_at: z.string().optional(),
        chat: z
          .object({
            id: z.string(),
            is_group: z.boolean().optional(),
            owner_handle: linqHandleSchema.optional(),
          })
          .passthrough(),
        sender_handle: linqHandleSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type LinqInboundMessageWebhook = z.infer<typeof linqInboundMessageWebhookSchema>;
export type LinqMessagePart = z.infer<typeof linqMessagePartSchema>;

function optionalEnv(name: string, source: Record<string, string | undefined> = process.env) {
  const value = source[name]?.trim();
  return value || undefined;
}

export function getLinqApiBaseUrl(source: Record<string, string | undefined> = process.env) {
  return (optionalEnv("LINQ_API_BASE_URL", source) ?? DEFAULT_LINQ_API_BASE_URL).replace(/\/$/, "");
}

export function getLinqWebhookVersion(source: Record<string, string | undefined> = process.env) {
  return optionalEnv("LINQ_WEBHOOK_VERSION", source) ?? DEFAULT_LINQ_WEBHOOK_VERSION;
}

export function getPublicAppUrl(source: Record<string, string | undefined> = process.env) {
  return (
    optionalEnv("NEXT_PUBLIC_APP_URL", source) ??
    optionalEnv("NEXT_PUBLIC_SITE_URL", source) ??
    (optionalEnv("VERCEL_URL", source) ? `https://${optionalEnv("VERCEL_URL", source)}` : undefined)
  );
}

export function buildLinqWebhookUrl(source: Record<string, string | undefined> = process.env) {
  const publicUrl = getPublicAppUrl(source);
  if (!publicUrl) {
    return null;
  }

  const normalizedBase = publicUrl.replace(/\/$/, "");
  return `${normalizedBase}/api/linq/webhook?version=${getLinqWebhookVersion(source)}`;
}

export function parseLinqPhoneToPersonaMap(
  raw: string | undefined,
): Record<string, string> {
  if (!raw?.trim()) {
    return {};
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const [phoneNumber, personaId] = entry.split("=").map((part) => part.trim());
      if (phoneNumber && personaId) {
        acc[phoneNumber] = personaId;
      }
      return acc;
    }, {});
}

export function verifyLinqWebhookSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  toleranceSeconds?: number;
  now?: number;
}) {
  const { rawBody, timestamp, signature, secret } = input;
  const now = input.now ?? Date.now();
  const toleranceSeconds = input.toleranceSeconds ?? 300;

  if (!timestamp || !signature) {
    return false;
  }

  const parsedTimestamp = Number(timestamp);
  if (!Number.isFinite(parsedTimestamp)) {
    return false;
  }

  const ageSeconds = Math.abs(Math.floor(now / 1000) - parsedTimestamp);
  if (ageSeconds > toleranceSeconds) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  if (expected.length !== signature.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

export function extractLinqMessageText(parts: LinqMessagePart[]) {
  const textParts = parts
    .filter((part) => part.type === "text" && typeof part.value === "string")
    .map((part) => part.value?.trim() ?? "")
    .filter(Boolean);

  const linkParts = parts
    .filter((part) => part.type === "link")
    .map((part) => part.url?.trim() ?? part.value?.trim() ?? "")
    .filter(Boolean)
    .map((url) => `Shared link: ${url}`);

  const mediaCount = parts.filter((part) => part.type === "media").length;
  const attachmentCount = parts.filter((part) => part.attachment_id).length;

  const summaries = [...textParts, ...linkParts];
  if (mediaCount > 0) {
    summaries.push(mediaCount === 1 ? "Shared a media attachment." : `Shared ${mediaCount} media attachments.`);
  }
  if (attachmentCount > mediaCount) {
    summaries.push(
      attachmentCount === 1
        ? "Included one pre-uploaded attachment."
        : `Included ${attachmentCount} pre-uploaded attachments.`,
    );
  }

  return summaries.join("\n\n").trim();
}

export async function sendLinqTextMessage(input: {
  chatId: string;
  text: string;
  token?: string;
  apiBaseUrl?: string;
}) {
  const token = input.token ?? optionalEnv("LINQ_API_TOKEN");

  if (!token) {
    throw new Error("LINQ_API_TOKEN is not configured.");
  }

  const response = await fetch(
    `${input.apiBaseUrl ?? getLinqApiBaseUrl()}/v3/chats/${input.chatId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          parts: [{ type: "text", value: input.text }],
        },
      }),
    },
  );

  const responseText = await response.text();
  let responseJson: unknown = null;
  if (responseText) {
    try {
      responseJson = JSON.parse(responseText) as unknown;
    } catch {
      responseJson = responseText;
    }
  }

  if (!response.ok) {
    const detail =
      typeof responseJson === "string"
        ? responseJson
        : responseJson && typeof responseJson === "object" && "error" in responseJson
          ? String((responseJson as { error?: unknown }).error)
          : `HTTP ${response.status}`;
    throw new Error(`Linq send failed: ${detail}`);
  }

  return responseJson;
}
