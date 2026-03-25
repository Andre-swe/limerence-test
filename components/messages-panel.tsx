"use client";

import { useRef, useState } from "react";
import { MessagesPanelComposer } from "@/components/messages-panel-composer";
import { MessagesPanelThread, type DisplayMessage } from "@/components/messages-panel-thread";
import { useOnboardingActions } from "@/components/onboarding";
import type { MessageAttachment, MessageEntry, PersonaStatus } from "@/lib/types";

type ConversationResponse = {
  messages: MessageEntry[];
  leftOnRead?: boolean;
  error?: string;
};

type MessagesPanelProps = {
  initialMessages: MessageEntry[];
  personaId: string;
  personaName: string;
  personaStatus: PersonaStatus;
};

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
  const deterministicJitter =
    (input.text.length + input.imageCount * 31 + (input.hasAudio ? 17 : 0)) % 260;

  return Math.min(1600, base + lengthWeight + modalityWeight + deterministicJitter);
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
  const [receiptKey, setReceiptKey] = useState(0);
  const [receiptPhase, setReceiptPhase] = useState<"sent" | "delivered" | "read" | "typing">(
    "sent",
  );
  const sendingRef = useRef(false);
  const isLocked = personaStatus !== "active";
  const { markMessageSent } = useOnboardingActions();

  async function submit(payload: { text?: string; file?: File; images?: File[] }) {
    if (isSending || sendingRef.current) {
      return;
    }
    sendingRef.current = true;

    const submitStartedAt = Date.now();
    const draftText = payload.text ?? "";
    const trimmedText = draftText.trim();
    const imageFiles = payload.images ?? [];
    const optimisticCreatedAt = new Date().toISOString();
    const optimisticUserId = `optimistic-user-${crypto.randomUUID()}`;
    const optimisticAudio = payload.file
      ? buildOptimisticAttachments([payload.file], "audio")
      : { attachments: [] as MessageAttachment[], dispose() {} };
    const optimisticImages =
      imageFiles.length > 0
        ? buildOptimisticAttachments(imageFiles, "image")
        : { attachments: [] as MessageAttachment[], dispose() {} };
    const optimisticBody =
      trimmedText ||
      (imageFiles.length > 0
        ? summarizeImageShare(imageFiles.length)
        : payload.file
          ? "Sent a voice note."
          : "");

    const optimisticUserMessage: DisplayMessage = {
      id: optimisticUserId,
      personaId,
      role: "user",
      kind: payload.file ? "audio" : imageFiles.length > 0 && !trimmedText ? "image" : "text",
      channel: "web",
      body: optimisticBody,
      attachments: [...optimisticAudio.attachments, ...optimisticImages.attachments],
      audioUrl: optimisticAudio.attachments[0]?.url,
      audioStatus: payload.file ? "ready" : "unavailable",
      createdAt: optimisticCreatedAt,
      delivery: {
        webInbox: true,
        attempts: 0,
      },
      optimistic: true,
    };

    setIsSending(true);
    setReceiptKey((key) => key + 1);
    setText("");
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

      if (data.leftOnRead) {
        setMessages(data.messages);
        optimisticAudio.dispose();
        optimisticImages.dispose();
        return;
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
      markMessageSent();
    } catch (error) {
      optimisticAudio.dispose();
      optimisticImages.dispose();
      setMessages((current) => current.filter((message) => message.id !== optimisticUserId));
      setText((current) => (current.trim() ? current : draftText));
      console.error(error);
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }

  return (
    <section className="soft-panel mx-auto flex max-w-3xl flex-col rounded-[36px] px-4 py-4 sm:px-5 sm:py-5">
      <MessagesPanelThread
        messages={messages}
        isSending={isSending}
        receiptPhase={receiptPhase}
        receiptKey={receiptKey}
        personaId={personaId}
        onReceiptPhaseChange={setReceiptPhase}
      />

      <MessagesPanelComposer
        personaName={personaName}
        text={text}
        setText={setText}
        isSending={isSending}
        isLocked={isLocked}
        submit={submit}
      />
    </section>
  );
}
