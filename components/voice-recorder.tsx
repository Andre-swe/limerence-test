"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

export function VoiceRecorder({
  onRecorded,
  onError,
  disabled = false,
}: {
  onRecorded: (file: File) => Promise<void> | void;
  onError?: (message: string) => void;
  disabled?: boolean;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return (
    <button
      type="button"
      onClick={async () => {
        if (disabled || isUploading) {
          return;
        }

        if (isRecording) {
          recorderRef.current?.stop();
          setIsRecording(false);
          return;
        }

        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;
          const recorder = new MediaRecorder(stream);
          recorderRef.current = recorder;
          chunksRef.current = [];

          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunksRef.current.push(event.data);
            }
          };

          recorder.onstop = async () => {
            setIsUploading(true);
            try {
              const blob = new Blob(chunksRef.current, { type: "audio/webm" });
              const file = new File([blob], `voice-note-${Date.now()}.webm`, {
                type: "audio/webm",
              });
              await onRecorded(file);
            } catch (error) {
              onError?.(
                error instanceof Error ? error.message : "Unable to process the recorded audio.",
              );
            } finally {
              streamRef.current?.getTracks().forEach((track) => track.stop());
              streamRef.current = null;
              setIsUploading(false);
            }
          };

          recorder.start();
          setIsRecording(true);
        } catch (error) {
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          setIsRecording(false);
          onError?.(
            error instanceof Error ? error.message : "Microphone access was not available.",
          );
        }
      }}
      className={`inline-flex h-12 w-12 items-center justify-center rounded-full border ${
        isRecording
          ? "border-[rgba(122,63,58,0.2)] bg-[rgba(122,63,58,0.12)] text-[var(--danger)]"
          : "border-[var(--border)] bg-[rgba(255,255,255,0.82)] text-[var(--sage-deep)]"
      }`}
      aria-label={isRecording ? "Stop recording" : "Record voice note"}
      disabled={disabled || isUploading}
    >
      {isRecording ? (
        <Square className="h-4 w-4 fill-current" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </button>
  );
}
