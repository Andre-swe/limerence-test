"use client";

import { type Dispatch, type SetStateAction, useRef } from "react";
import { ImagePlus, Loader2, SendHorizontal } from "lucide-react";
import { VoiceRecorder } from "@/components/voice-recorder";

type SubmitPayload = {
  text?: string;
  file?: File;
  images?: File[];
};

type MessagesPanelComposerProps = {
  personaName: string;
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  isSending: boolean;
  isLocked: boolean;
  submit: (payload: SubmitPayload) => Promise<void> | void;
};

export function MessagesPanelComposer({
  personaName,
  text,
  setText,
  isSending,
  isLocked,
  submit,
}: MessagesPanelComposerProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  if (isLocked) {
    return (
      <div className="mt-5 rounded-[24px] border border-[rgba(199,161,101,0.22)] bg-[rgba(199,161,101,0.12)] px-4 py-4 text-sm leading-6 text-[var(--sage-deep)]">
        This person is not available yet.
      </div>
    );
  }

  return (
    <div className="message-input-container mt-4 border-t border-[var(--line)] bg-[var(--background)] pt-4 sm:mt-6 sm:pt-5">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={2}
        placeholder={`Message ${personaName}`}
        className="input-quiet w-full text-base sm:text-sm"
        style={{ fontSize: "16px" }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-4 sm:gap-3">
        <button
          type="button"
          disabled={isSending || text.trim().length === 0}
          onClick={() => {
            void submit({ text });
          }}
          className="btn-solid touch-target flex-1 justify-center sm:flex-none"
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          <span className="sm:inline">Send</span>
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
          className="btn-pill touch-target"
        >
          <ImagePlus className="h-4 w-4" />
          <span className="hidden sm:inline">Image</span>
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
  );
}
