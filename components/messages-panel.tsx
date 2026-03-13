"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { ImagePlus, Loader2, SendHorizontal, Upload } from "lucide-react";
import { FeedbackButton } from "@/components/feedback-button";
import { formatDateTime } from "@/lib/utils";
import type { MessageAttachment, MessageEntry, PersonaStatus } from "@/lib/types";

type ConversationResponse = {
  messages: MessageEntry[];
  error?: string;
};

type DisplayMessage = MessageEntry & {
  optimistic?: boolean;
};

type MessagesPanelProps = {
  initialMessages: MessageEntry[];
  personaId: string;
  personaName: string;
  personaStatus: PersonaStatus;
};

function TypingIndicator() {
  return (
    <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[rgba(111,123,105,0.08)] px-3 py-2">
      {[0, 1, 2].map((index) => (
        <span
          // Staggered bounce feels closer to iMessage than a pulse on the whole line.
          key={index}
          className="typing-dot h-2 w-2 rounded-full bg-[rgba(75,85,67,0.62)]"
          style={{ animationDelay: `${index * 140}ms` }}
        />
      ))}
    </div>
  );
}

function summarizeImageShare(count: number) {
  return count === 1 ? "Shared an image." : `Shared ${count} images.`;
}

function buildOptimisticAttachments(files: File[], type: "audio" | "image") {
  const urls: string[] = [];
  const attachments: MessageAttachment[] = files.map((file) => {
    const url = URL.createObjectURL(file);
    urls.push(url);
    return {
      id: `optimistic-${crypto.randomUUID()}`,
      type,
      url,
      fileName: file.name,
      originalName: file.name,
      mimeType: file.type || (type === "audio" ? "audio/webm" : "image/png"),
      size: file.size,
    };
  });

  return {
    attachments,
    dispose() {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    },
  };
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function revealFloorMs(input: {
  text: string;
  hasAudio: boolean;
  imageCount: number;
}) {
  const base = 900;
  const lengthWeight = Math.min(220, input.text.trim().length * 6);
  const modalityWeight = input.hasAudio ? 180 : input.imageCount > 0 ? 140 : 0;
  const deterministicJitter = (input.text.length + input.imageCount * 31 + (input.hasAudio ? 17 : 0)) % 260;

  return Math.min(1600, base + lengthWeight + modalityWeight + deterministicJitter);
}

function visibleMessages(messages: DisplayMessage[]) {
  return messages.filter((message) => message.channel !== "live" && message.role !== "system");
}

function channelLabel(message: MessageEntry) {
  if (message.role === "user") {
    return "You";
  }

  if (message.channel === "heartbeat") {
    return "Arrival";
  }

  if (message.kind === "audio") {
    return "Voice note";
  }

  if (message.kind === "image") {
    return "Image";
  }

  return "Message";
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
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const voiceInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const isLocked = personaStatus !== "active";

  async function submit(payload: { text?: string; file?: File; images?: File[] }) {
    if (isSending) {
      return;
    }

    const submitStartedAt = Date.now();
    const draftText = payload.text ?? "";
    const trimmedText = draftText.trim();
    const imageFiles = payload.images ?? [];
    const optimisticCreatedAt = new Date().toISOString();
    const optimisticUserId = `optimistic-user-${crypto.randomUUID()}`;
    const optimisticAssistantId = `optimistic-assistant-${crypto.randomUUID()}`;
    const optimisticAudio = payload.file
      ? buildOptimisticAttachments([payload.file], "audio")
      : { attachments: [] as MessageAttachment[], dispose() {} };
    const optimisticImages = imageFiles.length > 0
      ? buildOptimisticAttachments(imageFiles, "image")
      : { attachments: [] as MessageAttachment[], dispose() {} };
    const optimisticBody =
      trimmedText ||
      (imageFiles.length > 0 ? summarizeImageShare(imageFiles.length) : payload.file ? "Sent a voice note." : "");

    const optimisticUserMessage: DisplayMessage = {
      id: optimisticUserId,
      personaId,
      role: "user",
      kind:
        payload.file
          ? "audio"
          : imageFiles.length > 0 && !trimmedText
            ? "image"
            : "text",
      channel: "web",
      body: optimisticBody,
      attachments: [...optimisticAudio.attachments, ...optimisticImages.attachments],
      audioUrl: optimisticAudio.attachments[0]?.url,
      audioStatus: payload.file ? "ready" : "unavailable",
      createdAt: optimisticCreatedAt,
      delivery: {
        webInbox: true,
        telegramStatus: "not_requested",
        attempts: 0,
      },
      optimistic: true,
    };

    const optimisticAssistantMessage: DisplayMessage = {
      id: optimisticAssistantId,
      personaId,
      role: "assistant",
      kind: "text",
      channel: "web",
      body: "",
      attachments: [],
      audioStatus: "unavailable",
      createdAt: new Date(Date.now() + 1).toISOString(),
      delivery: {
        webInbox: true,
        telegramStatus: "not_requested",
        attempts: 0,
      },
      optimistic: true,
    };

    setIsSending(true);
    setText("");
    setMessages((current) => [...current, optimisticUserMessage, optimisticAssistantMessage]);

    try {
      const formData = new FormData();

      if (trimmedText) {
        formData.append("text", trimmedText);
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
      if (!response.ok) {
        throw new Error(data.error || "Unable to send message.");
      }

      const floor = revealFloorMs({
        text: trimmedText,
        hasAudio: Boolean(payload.file),
        imageCount: imageFiles.length,
      });
      const remaining = floor - (Date.now() - submitStartedAt);

      if (remaining > 0) {
        await wait(remaining);
      }

      setMessages(data.messages);
      optimisticAudio.dispose();
      optimisticImages.dispose();
    } catch (error) {
      optimisticAudio.dispose();
      optimisticImages.dispose();
      setMessages((current) =>
        current.filter(
          (message) => message.id !== optimisticUserId && message.id !== optimisticAssistantId,
        ),
      );
      setText((current) => current || draftText);
      console.error(error);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="soft-panel mx-auto flex max-w-3xl flex-col rounded-[36px] px-5 py-5 sm:px-6 sm:py-6">
      <div className="pb-4">
        <p className="eyebrow">Messages</p>
        <div className="divider-soft mt-4" />
      </div>

      <div className="mt-5 flex min-h-[28rem] flex-col">
        <div className="flex-1 space-y-3">
          {visibleMessages(messages).map((message) => {
            const images = imageAttachments(message);
            const showBody = message.body.trim().length > 0 && !bodyIsJustImagePlaceholder(message);

            return (
              <article
                key={message.id}
                className={`msg-bubble ${
                  message.role === "assistant"
                    ? "msg-bubble-assistant mr-auto"
                    : "msg-bubble-user ml-auto"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] opacity-60">
                    {message.role === "assistant" ? personaName : channelLabel(message)}
                  </p>
                  <p className="text-[11px] opacity-55">{formatDateTime(message.createdAt)}</p>
                </div>

                {showBody ? (
                  <p
                    className={`mt-3 text-sm leading-7 ${
                      message.optimistic && message.role === "assistant" ? "animate-pulse opacity-70" : ""
                    }`}
                  >
                    {message.body}
                  </p>
                ) : null}
                {message.optimistic && message.role === "assistant" && !showBody ? (
                  <TypingIndicator />
                ) : null}
                <AttachmentStrip attachments={images} />
                <AudioStrip message={message} />

                {message.role === "assistant" && !message.optimistic ? (
                  <div className="mt-4">
                    <FeedbackButton personaId={personaId} messageId={message.id} />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>

        {isLocked ? (
          <div className="mt-5 rounded-[24px] border border-[rgba(199,161,101,0.22)] bg-[rgba(199,161,101,0.12)] px-4 py-4 text-sm leading-6 text-[var(--sage-deep)]">
            This person is not available yet.
          </div>
        ) : (
          <div className="mt-6 border-t border-[var(--line)] pt-5">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              placeholder={`Message ${personaName}`}
              className="input-quiet w-full text-sm"
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={isSending || text.trim().length === 0}
                onClick={() => {
                  void submit({ text });
                }}
                className="btn-solid"
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
                className="btn-pill"
              >
                <Upload className="h-4 w-4" />
                Voice note
              </button>

              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="btn-pill"
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
      </div>
    </section>
  );
}
