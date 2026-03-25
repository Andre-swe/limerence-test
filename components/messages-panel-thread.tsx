"use client";

import Image from "next/image";
import { useEffect } from "react";
import { Check, CheckCheck } from "lucide-react";
import { FeedbackButton } from "@/components/feedback-button";
import { formatDateTime } from "@/lib/utils";
import type { MessageAttachment, MessageEntry } from "@/lib/types";

export type DisplayMessage = MessageEntry & {
  optimistic?: boolean;
};

type MessagesPanelThreadProps = {
  messages: DisplayMessage[];
  isSending: boolean;
  receiptPhase: "sent" | "delivered" | "read" | "typing";
  receiptKey: number;
  personaId: string;
  onReceiptPhaseChange: (phase: "sent" | "delivered" | "read" | "typing") => void;
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

function ReceiptIndicator({ phase }: { phase: "sent" | "delivered" | "read" | "typing" }) {
  return (
    <div className="mt-0.5 flex items-center justify-end gap-1 pr-0.5">
      {phase === "sent" ? (
        <Check className="h-3.5 w-3.5 text-[rgba(29,38,34,0.3)]" />
      ) : phase === "delivered" ? (
        <CheckCheck className="h-3.5 w-3.5 text-[rgba(29,38,34,0.3)]" />
      ) : (
        <CheckCheck className="h-3.5 w-3.5 text-[rgba(110,140,90,0.7)]" />
      )}
    </div>
  );
}

function bodyIsJustImagePlaceholder(message: MessageEntry) {
  return message.kind === "image" && /^shared( \d+)? images?\.$/i.test(message.body.trim());
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
        <figure
          key={attachment.id}
          className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[rgba(255,255,255,0.45)]"
        >
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

function visibleMessages(messages: DisplayMessage[]) {
  return messages.filter((message) => message.channel !== "live" && message.role !== "system");
}

export function MessagesPanelThread({
  messages,
  isSending,
  receiptPhase,
  receiptKey,
  personaId,
  onReceiptPhaseChange,
}: MessagesPanelThreadProps) {
  const visible = visibleMessages(messages);
  const lastUserIndex = visible.reduce(
    (last, msg, index) => (msg.role === "user" ? index : last),
    -1,
  );
  const lastUserRead =
    lastUserIndex >= 0 &&
    visible.slice(lastUserIndex + 1).some((message) => message.role === "assistant" && !message.optimistic);

  return (
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
                  className={`msg-bubble ${isUser ? "msg-bubble-user" : "msg-bubble-assistant"}`}
                  style={{
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

              {isLastUser ? (
                isSending ? (
                  <ReceiptIndicator phase={receiptPhase} />
                ) : lastUserRead ? (
                  <ReceiptIndicator phase="read" />
                ) : null
              ) : null}

              {!isUser && !message.optimistic ? (
                <div className="mt-0.5">
                  <FeedbackButton personaId={personaId} messageId={message.id} />
                </div>
              ) : null}
            </div>
          );
        })}

        {isSending ? (
          <ReceiptLifecycle key={receiptKey} onPhaseChange={onReceiptPhaseChange} />
        ) : null}

        {isSending && receiptPhase === "typing" ? (
          <div className="mt-2 flex justify-start">
            <div className="msg-bubble msg-bubble-assistant">
              <TypingIndicator />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
