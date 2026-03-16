import { randomUUID } from "node:crypto";
import { savePublicFile } from "@/lib/store";
import type { MessageAttachment, MessageEntry, StoredAsset } from "@/lib/types";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME_PREFIXES = [
  "image/",
  "audio/",
  "video/",
  "application/pdf",
];

function isAllowedMimeType(mimeType: string) {
  return ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

function validateUpload(file: File) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File "${file.name}" exceeds the 25 MB upload limit.`);
  }
  const mime = file.type || "application/octet-stream";
  if (!isAllowedMimeType(mime)) {
    throw new Error(`File type "${mime}" is not allowed.`);
  }
}

// Centralize persisted message shape so ids, timestamps, and attachment defaults
// stay consistent across the split service modules.
export function createMessage({
  personaId,
  role,
  kind,
  channel,
  body,
  attachments,
  userState,
  metadata,
  audioUrl,
  audioStatus,
  replyMode,
  delivery,
  createdAt,
}: Omit<MessageEntry, "id" | "createdAt" | "attachments"> & {
  attachments?: MessageEntry["attachments"];
  createdAt?: string;
}): MessageEntry {
  return {
    id: randomUUID(),
    personaId,
    role,
    kind,
    channel,
    body,
    attachments: attachments ?? [],
    userState,
    metadata,
    audioUrl,
    audioStatus,
    createdAt: createdAt ?? new Date().toISOString(),
    replyMode,
    delivery,
  };
}

export async function persistFileAsset(file: File, kind: StoredAsset["kind"]) {
  validateUpload(file);
  // Persona setup uploads and browser message uploads both flow through the
  // same store helper; normalize them once before they enter domain code.
  const buffer = Buffer.from(await file.arrayBuffer());
  const { fileName, url } = await savePublicFile(buffer, file.name, file.type);

  return {
    id: randomUUID(),
    kind,
    fileName,
    originalName: file.name,
    url,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  } satisfies StoredAsset;
}

export async function persistMessageAttachment(
  file: File,
  type: MessageAttachment["type"],
  options?: {
    extractedText?: string;
    visualSummary?: string;
  },
) {
  validateUpload(file);
  // Message attachments share the same storage backend as setup assets, but
  // keep extraction metadata alongside the file record for later reasoning.
  const buffer = Buffer.from(await file.arrayBuffer());
  const { fileName, url } = await savePublicFile(buffer, file.name, file.type);

  return {
    id: randomUUID(),
    type,
    fileName,
    originalName: file.name,
    url,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    extractedText: options?.extractedText,
    visualSummary: options?.visualSummary,
  } satisfies MessageAttachment;
}
