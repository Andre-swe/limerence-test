"use client";

import { Loader2 } from "lucide-react";

interface ThinkingIndicatorProps {
  personaName?: string;
  variant?: "inline" | "bubble" | "overlay";
}

export function ThinkingIndicator({
  personaName = "Your persona",
  variant = "bubble",
}: ThinkingIndicatorProps) {
  if (variant === "inline") {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--sage-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{personaName} is thinking...</span>
      </div>
    );
  }

  if (variant === "overlay") {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 backdrop-blur-sm">
        <div className="rounded-2xl bg-white px-8 py-6 shadow-xl">
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div className="h-12 w-12 rounded-full bg-[var(--sage-light)]" />
              <Loader2 className="absolute inset-0 m-auto h-6 w-6 animate-spin text-[var(--accent)]" />
            </div>
            <p className="text-sm font-medium text-[var(--sage-deep)]">
              {personaName} is thinking...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Default: bubble variant (for chat)
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--sage-light)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--sage)]" />
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-[var(--sage-light)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--sage-muted)]">{personaName} is thinking</span>
          <span className="flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--sage-muted)] [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--sage-muted)] [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--sage-muted)] [animation-delay:300ms]" />
          </span>
        </div>
      </div>
    </div>
  );
}

interface ErrorMessageProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  variant?: "inline" | "card";
}

export function ErrorMessage({
  title = "Something went wrong",
  message,
  onRetry,
  variant = "card",
}: ErrorMessageProps) {
  if (variant === "inline") {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-red-600">{message}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="font-medium text-[var(--accent)] hover:underline"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4">
      <p className="font-medium text-red-800">{title}</p>
      <p className="mt-1 text-sm text-red-600">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg bg-red-100 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-200"
        >
          Try again
        </button>
      )}
    </div>
  );
}

// User-friendly error messages for common provider failures
export const friendlyErrors = {
  gemini: {
    title: "Gemini is taking a moment",
    message: "The AI is temporarily busy. Your message is safe — try again in a few seconds.",
  },
  hume: {
    title: "Voice service unavailable",
    message: "Hume voice services are temporarily down. Text messaging still works.",
  },
  network: {
    title: "Connection lost",
    message: "Check your internet connection and try again.",
  },
  timeout: {
    title: "Taking longer than expected",
    message: "The response is taking a while. You can wait or try again.",
  },
  rateLimit: {
    title: "Too many requests",
    message: "Please wait a moment before sending another message.",
  },
  unknown: {
    title: "Something went wrong",
    message: "An unexpected error occurred. Please try again.",
  },
};

export function parseErrorType(error: unknown): keyof typeof friendlyErrors {
  if (!error) return "unknown";
  
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  
  if (message.includes("gemini") || message.includes("google")) return "gemini";
  if (message.includes("hume") || message.includes("voice")) return "hume";
  if (message.includes("network") || message.includes("fetch")) return "network";
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("rate") || message.includes("429") || message.includes("too many")) return "rateLimit";
  
  return "unknown";
}
