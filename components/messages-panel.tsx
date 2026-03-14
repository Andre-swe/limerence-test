"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, SendHorizontal } from "lucide-react";
import { FeedbackButton } from "@/components/feedback-button";
import { VoiceRecorder } from "@/components/voice-recorder";
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
          key={index}
          className="typing-dot h-2 w-2 rounded-full bg-[rgba(75,85,67,0.62)]"
          style={{ animationDelay: `${index * 140}ms` }}
        />
      ))}
    </div>
  );
}

/**
 * Receipt lifecycle that mirrors how a real person receives a message:
 * Sent → Delivered (1-2s) → Read (2-4s more) → persona decides to type.
 *
 * The "typing" phase renders as a separate assistant bubble at the bottom
 * of the thread. The receipt text appears under the user's last message.
 * This component only controls the receipt text — the parent checks
 * the phase to decide when to show the typing bubble.
 */
/**
 * Tracks the Sent → Delivered → Read → Typing receipt lifecycle.
 * Each receipt state advances via a separate timer. Resets when
 * the sendKey changes (new message sent).
 */
function ReceiptLifecycle({
  onPhaseChange,
}: {
  onPhaseChange: (phase: "sent" | "delivered" | "read" | "typing") => void;
}) {
  useEffect(() => {
    onPhaseChange("sent");

    const deliveredDelay = 800 + Math.random() * 1200;
    const readDelay = deliveredDelay + 1500 + Math.random() * 2500;
    const typingDelay = readDelay + 1000 + Math.random() * 2000;

    const t1 = setTimeout(() => onPhaseChange("delivered"), deliveredDelay);
    const t2 = setTimeout(() => onPhaseChange("read"), readDelay);
    const t3 = setTimeout(() => onPhaseChange("typing"), typingDelay);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // onPhaseChange is stable (from parent useState setter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

function ReceiptText({ phase }: { phase: "sent" | "delivered" | "read" | "typing" }) {
  const label = phase === "sent" ? "Sent" : phase === "delivered" ? "Delivered" : "Read";
  return (
    <p className="mt-1 pr-1 text-right text-[10px] tracking-wide text-[rgba(29,38,34,0.34)]">
      {label}
    </p>
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

function bodyIsJustImagePlaceholder(message: MessageEntry) {
  return (
    message.kind === "image" &&
    /^shared( \d+)? images?\.$/i.test(message.body.trim())
  );
}

function imageAttachments(message: MessageEntry) {
  return message.attachments.filter((attachment) => attachment.type === "image");
}

/** Returns true if two messages are more than 5 minutes apart. */
function isTimeGap(a: string, b: string) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) > 5 * 60 * 1000;
}

/** Format a timestamp as a short time like "7:42 PM" or include the date if older than today. */
function shortTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return formatDateTime(iso);
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
  const [sendKey, setSendKey] = useState(0);
  const [receiptPhase, setReceiptPhase] = useState<"sent" | "delivered" | "read" | "typing">("sent");
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

    setIsSending(true);
    setSendKey((k) => k + 1);
    setText("");
    // Only add the user message — the typing indicator appears later via receipt phase
    setMessages((current) => [...current, optimisticUserMessage]);

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
        current.filter((message) => message.id !== optimisticUserId),
      );
      // Only restore original text if the user hasn't typed something new
      setText((current) => current.trim() ? current : draftText);
      console.error(error);
    } finally {
      setIsSending(false);
    }
  }

  const visible = visibleMessages(messages);
  // Find the last user message index for receipt placement
  const lastUserIndex = visible.reduce(
    (last, msg, i) => (msg.role === "user" ? i : last),
    -1,
  );
  // Check if the persona has "read" (replied after) the last user message
  const lastUserRead = lastUserIndex >= 0 && visible.slice(lastUserIndex + 1).some(
    (m) => m.role === "assistant" && !m.optimistic,
  );
  return (
    <section className="soft-panel mx-auto flex max-w-3xl flex-col rounded-[36px] px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex min-h-[32rem] flex-col">
        <div className="flex-1 space-y-0.5 pb-2">
          {visible.map((message, index) => {
            const images = imageAttachments(message);
            const showBody = message.body.trim().length > 0 && !bodyIsJustImagePlaceholder(message);
            const isUser = message.role === "user";
            const prev = visible[index - 1];
            const next = visible[index + 1];
            const sameSenderAsPrev = prev && prev.role === message.role;
            const sameSenderAsNext = next && next.role === message.role;
            const showTimeGap = !prev || isTimeGap(prev.createdAt, message.createdAt);
            const isLastUser = index === lastUserIndex;

            return (
              <div key={message.id}>
                {/* Time separator — only shown between messages >5min apart */}
                {showTimeGap ? (
                  <p className="py-3 text-center text-[11px] text-[rgba(29,38,34,0.36)]">
                    {shortTime(message.createdAt)}
                  </p>
                ) : null}

                <div
                  className={`flex ${isUser ? "justify-end" : "justify-start"} ${
                    sameSenderAsPrev && !showTimeGap ? "mt-0.5" : "mt-2"
                  }`}
                >
                  <article
                    className={`msg-bubble ${
                      isUser ? "msg-bubble-user" : "msg-bubble-assistant"
                    }`}
                    style={{
                      // Tighter corners between consecutive same-sender messages
                      borderTopLeftRadius: !isUser && sameSenderAsPrev && !showTimeGap ? "6px" : undefined,
                      borderTopRightRadius: isUser && sameSenderAsPrev && !showTimeGap ? "6px" : undefined,
                      borderBottomLeftRadius: !isUser && sameSenderAsNext ? "6px" : undefined,
                      borderBottomRightRadius: isUser && sameSenderAsNext ? "6px" : undefined,
                    }}
                  >
                    {showBody ? (
                      <p
                        className={`text-[0.9375rem] leading-relaxed ${
                          message.optimistic && !isUser ? "animate-pulse opacity-70" : ""
                        }`}
                      >
                        {message.body}
                      </p>
                    ) : null}
                    <AttachmentStrip attachments={images} />
                    <AudioStrip message={message} />
                  </article>
                </div>

                {/* Receipt — live phase when sending, static when settled */}
                {isLastUser ? (
                  isSending ? (
                    <ReceiptText phase={receiptPhase} />
                  ) : lastUserRead ? (
                    <p className="mt-1 pr-1 text-right text-[10px] tracking-wide text-[rgba(29,38,34,0.34)]">Read</p>
                  ) : null
                ) : null}

                {/* Feedback flag — only on real assistant messages */}
                {!isUser && !message.optimistic ? (
                  <div className="mt-0.5">
                    <FeedbackButton personaId={personaId} messageId={message.id} />
                  </div>
                ) : null}
              </div>
            );
          })}

          {/* Receipt lifecycle — remounted on each send via key. Drives the Sent → Delivered → Read → Typing flow. */}
          {isSending ? (
            <ReceiptLifecycle key={sendKey} onPhaseChange={setReceiptPhase} />
          ) : null}

          {/* Typing bubble — appears when the receipt phase reaches "typing" */}
          {isSending && receiptPhase === "typing" ? (
            <div className="mt-2 flex justify-start">
              <div className="msg-bubble msg-bubble-assistant">
                <TypingIndicator />
              </div>
            </div>
          ) : null}
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

              <VoiceRecorder
                disabled={isSending}
                onRecorded={async (file) => {
                  await submit({ file, text });
                }}
                onError={(message) => {
                  console.error("Voice recording error:", message);
                }}
              />

              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="btn-pill"
              >
                <ImagePlus className="h-4 w-4" />
                Image
              </button>


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
