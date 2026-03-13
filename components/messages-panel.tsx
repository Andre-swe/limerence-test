"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { ImagePlus, Loader2, SendHorizontal, Upload } from "lucide-react";
import { FeedbackButton } from "@/components/feedback-button";
import { formatDateTime } from "@/lib/utils";
import type { MessageAttachment, MessageEntry, PersonaStatus } from "@/lib/types";

type ConversationResponse = {
  messages: MessageEntry[];
};

type MessagesPanelProps = {
  initialMessages: MessageEntry[];
  personaId: string;
  personaName: string;
  personaStatus: PersonaStatus;
};

function visibleMessages(messages: MessageEntry[]) {
  return messages.filter((message) => message.channel !== "live" && message.role !== "system");
}

function channelLabel(message: MessageEntry) {
  if (message.channel === "heartbeat") {
    return "arrival";
  }

  if (message.kind === "audio") {
    return "voice note";
  }

  if (message.kind === "image") {
    return "image";
  }

  return "message";
}

function bodyIsJustImagePlaceholder(message: MessageEntry) {
  return (
    message.kind === "image" &&
    /^shared( \d+)? images?\.$/i.test(message.body.trim())
  );
}

function imageAttachments(message: MessageEntry) {
  return message.attachments.filter((attachment) => attachment.type === "image");
}

function audioAttachments(message: MessageEntry) {
  return message.attachments.filter((attachment) => attachment.type === "audio");
}

function AttachmentStrip({ attachments }: { attachments: MessageAttachment[] }) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 grid gap-3">
      {attachments.map((attachment) => (
        <figure key={attachment.id} className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[rgba(255,255,255,0.45)]">
          <Image
            src={attachment.url}
            alt={attachment.originalName}
            width={1200}
            height={900}
            className="block max-h-[22rem] w-full object-cover"
            unoptimized
          />
          {attachment.visualSummary ? (
            <figcaption className="px-3 py-2 text-xs leading-6 text-[rgba(29,38,34,0.56)]">
              {attachment.visualSummary}
            </figcaption>
          ) : null}
        </figure>
      ))}
    </div>
  );
}

function AudioStrip({ message }: { message: MessageEntry }) {
  const attachmentAudio = audioAttachments(message);
  const assistantAudio = message.audioUrl
    ? [
        {
          id: `${message.id}-generated`,
          url: message.audioUrl,
          originalName: "voice-note.mp3",
        },
      ]
    : [];
  const audioItems = attachmentAudio.length > 0 ? attachmentAudio : assistantAudio;

  if (audioItems.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {audioItems.map((attachment) => (
        <audio
          key={attachment.id}
          controls
          preload="none"
          src={attachment.url}
          className="w-full"
        />
      ))}
    </div>
  );
}

export function MessagesPanel({
  initialMessages,
  personaId,
  personaName,
  personaStatus,
}: MessagesPanelProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const voiceInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const isLocked = personaStatus !== "active";

  async function submit(payload: { text?: string; file?: File; images?: File[] }) {
    setIsSending(true);
    try {
      const formData = new FormData();

      if (payload.text) {
        formData.append("text", payload.text);
      }

      if (payload.file) {
        formData.append("audio", payload.file);
      }

      for (const image of payload.images ?? []) {
        formData.append("images", image);
      }

      formData.append("channel", "web");
      const response = await fetch(`/api/personas/${personaId}/messages`, {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as ConversationResponse;
      setMessages(data.messages);
      setText("");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="soft-panel mx-auto max-w-3xl rounded-[36px] px-5 py-5 sm:px-6 sm:py-6">
      <div className="border-b border-[var(--line)] pb-4">
        <p className="eyebrow">Messages</p>
        <h2 className="serif-title mt-2 text-4xl text-[var(--sage-deep)]">{personaName}</h2>
      </div>

      {isLocked ? (
        <div className="mt-5 rounded-[24px] border border-[rgba(199,161,101,0.22)] bg-[rgba(199,161,101,0.12)] px-4 py-4 text-sm leading-6 text-[var(--sage-deep)]">
          This person stays quiet until manual review is complete.
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            placeholder={`Message ${personaName}`}
            className="w-full rounded-[26px] border border-[var(--line)] bg-[rgba(255,255,255,0.84)] px-5 py-4 text-sm outline-none"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={isSending || text.trim().length === 0}
              onClick={() => {
                void submit({ text });
              }}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--sage-deep)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SendHorizontal className="h-4 w-4" />
              )}
              Send
            </button>

            <button
              type="button"
              onClick={() => voiceInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.82)] px-4 py-2.5 text-sm font-medium text-[var(--sage-deep)]"
            >
              <Upload className="h-4 w-4" />
              Voice note
            </button>

            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.82)] px-4 py-2.5 text-sm font-medium text-[var(--sage-deep)]"
            >
              <ImagePlus className="h-4 w-4" />
              Image
            </button>

            <input
              ref={voiceInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) {
                  await submit({ file, text });
                  event.target.value = "";
                }
              }}
            />

            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={async (event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length > 0) {
                  await submit({ images: files, text });
                  event.target.value = "";
                }
              }}
            />
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {visibleMessages(messages).map((message) => {
          const images = imageAttachments(message);
          const showBody = message.body.trim().length > 0 && !bodyIsJustImagePlaceholder(message);

          return (
            <article
              key={message.id}
              className={`max-w-[88%] rounded-[24px] px-4 py-4 ${
                message.role === "assistant"
                  ? "mr-auto bg-[rgba(255,255,255,0.86)] text-[var(--sage-deep)]"
                  : "ml-auto bg-[var(--sage-deep)] text-white"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <p className="text-[11px] uppercase tracking-[0.18em] opacity-60">
                  {message.role === "assistant" ? personaName : channelLabel(message)}
                </p>
                <p className="text-[11px] opacity-55">{formatDateTime(message.createdAt)}</p>
              </div>

              {showBody ? <p className="mt-3 text-sm leading-7">{message.body}</p> : null}
              <AttachmentStrip attachments={images} />
              <AudioStrip message={message} />

              {message.role === "assistant" ? (
                <div className="mt-4">
                  <FeedbackButton personaId={personaId} messageId={message.id} />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
