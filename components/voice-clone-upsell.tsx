"use client";

import { Lock, Sparkles, Mic } from "lucide-react";

interface VoiceCloneUpsellProps {
  onUpgrade?: () => void;
  personaName?: string;
}

export function VoiceCloneUpsell({ onUpgrade, personaName }: VoiceCloneUpsellProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-gradient-to-br from-white to-[var(--sage-light)] p-6">
      {/* Decorative background */}
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[var(--accent)] opacity-5" />
      <div className="absolute -bottom-4 -left-4 h-24 w-24 rounded-full bg-[var(--accent)] opacity-5" />

      <div className="relative space-y-4">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-[var(--accent)] bg-opacity-10 p-3">
            <Mic className="h-6 w-6 text-[var(--accent)]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-[var(--sage-deep)]">
                Custom Voice Cloning
              </h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs font-medium text-white">
                <Sparkles className="h-3 w-3" />
                Premium
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--sage-muted)]">
              {personaName
                ? `Give ${personaName} their own unique voice`
                : "Create a custom voice for your persona"}
            </p>
          </div>
        </div>

        {/* Features */}
        <div className="space-y-2 rounded-lg bg-white bg-opacity-60 p-4">
          <div className="flex items-center gap-3 text-sm text-[var(--sage-deep)]">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100">
              <svg className="h-3 w-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            Clone any voice with 30-60 seconds of audio
          </div>
          <div className="flex items-center gap-3 text-sm text-[var(--sage-deep)]">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100">
              <svg className="h-3 w-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            Natural, expressive voice synthesis
          </div>
          <div className="flex items-center gap-3 text-sm text-[var(--sage-deep)]">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100">
              <svg className="h-3 w-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            Use in live calls and voice notes
          </div>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onUpgrade}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-3 font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            <Sparkles className="h-4 w-4" />
            Unlock Custom Voice
          </button>
        </div>

        <p className="text-center text-xs text-[var(--sage-muted)]">
          Upgrade to Premium to access voice cloning and more
        </p>
      </div>
    </div>
  );
}

interface VoiceCloneGateProps {
  isPremium: boolean;
  personaName?: string;
  onUpgrade?: () => void;
  children: React.ReactNode;
}

/**
 * Gate component that shows upsell for free users and renders children for premium users.
 */
export function VoiceCloneGate({
  isPremium,
  personaName,
  onUpgrade,
  children,
}: VoiceCloneGateProps) {
  if (!isPremium) {
    return <VoiceCloneUpsell personaName={personaName} onUpgrade={onUpgrade} />;
  }

  return <>{children}</>;
}

/**
 * Locked overlay for voice clone features in free tier.
 * Use this when you want to show a preview of the feature with a lock overlay.
 */
export function VoiceCloneLockedOverlay({
  onUpgrade,
}: {
  onUpgrade?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/80 backdrop-blur-sm">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--sage-light)]">
          <Lock className="h-6 w-6 text-[var(--sage-muted)]" />
        </div>
        <p className="mb-3 text-sm font-medium text-[var(--sage-deep)]">
          Premium Feature
        </p>
        <button
          type="button"
          onClick={onUpgrade}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
        >
          <Sparkles className="h-4 w-4" />
          Upgrade
        </button>
      </div>
    </div>
  );
}
