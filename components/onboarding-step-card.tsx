"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight } from "lucide-react";
import type { OnboardingStepDefinition } from "@/components/onboarding";

type OnboardingStepCardProps = {
  step: OnboardingStepDefinition;
  index: number;
  isCompleted: boolean;
  isCurrent: boolean;
  personaId?: string;
};

export function OnboardingStepCard({
  step,
  index,
  isCompleted,
  isCurrent,
  personaId,
}: OnboardingStepCardProps) {
  const router = useRouter();
  const Icon = step.icon;

  const href = (() => {
    if (step.href) return step.href;
    if (!personaId) return null;

    if (step.id === "send-message") {
      return `/personas/${personaId}/messages`;
    }
    if (step.id === "make-call") {
      return `/personas/${personaId}`;
    }
    return null;
  })();

  const isDisabled = !href && !step.href;

  return (
    <div
      className={`relative flex items-start gap-4 rounded-2xl border p-4 transition-all ${
        isCompleted
          ? "border-[var(--sage-soft)] bg-[var(--sage-soft)]/30"
          : isCurrent
            ? "border-[var(--sage)] bg-white shadow-sm"
            : "border-[var(--border)] bg-white/50"
      }`}
    >
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
          isCompleted
            ? "bg-[var(--sage-deep)] text-white"
            : isCurrent
              ? "bg-[var(--sage-soft)] text-[var(--sage-deep)]"
              : "bg-[var(--paper-strong)] text-[var(--sage)]"
        }`}
      >
        {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : <span className="text-sm font-semibold">{index + 1}</span>}
      </div>

      <div className="flex-1 space-y-1">
        <h3
          className={`font-semibold ${
            isCompleted ? "text-[var(--sage)]" : "text-[var(--sage-deep)]"
          }`}
        >
          {step.title}
        </h3>
        <p className="text-sm text-[var(--sage)]">{step.description}</p>

        {!isCompleted && isCurrent && (
          <div className="pt-2">
            {href ? (
              <Link href={href} className="btn-solid inline-flex items-center gap-1.5 text-sm">
                {step.action}
                <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <button
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  if (isCompleted) return;
                  if (href) {
                    router.push(href);
                  }
                }}
                className="btn-pill inline-flex items-center gap-1.5 text-sm opacity-50"
              >
                {step.id === "send-message" || step.id === "make-call"
                  ? "Create a persona first"
                  : step.action}
              </button>
            )}
          </div>
        )}
      </div>

      <Icon
        className={`h-5 w-5 flex-shrink-0 ${
          isCompleted
            ? "text-[var(--sage)]"
            : isCurrent
              ? "text-[var(--sage-deep)]"
              : "text-[var(--sage-soft)]"
        }`}
      />
    </div>
  );
}
