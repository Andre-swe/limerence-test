"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronRight,
  MessageSquare,
  Phone,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";

// Onboarding steps definition
const ONBOARDING_STEPS = [
  {
    id: "create-persona",
    title: "Create your first persona",
    description: "Add someone you'd like to talk with. Give them a name, personality, and voice.",
    icon: UserPlus,
    action: "Create persona",
    href: "/create",
  },
  {
    id: "send-message",
    title: "Send your first message",
    description: "Start a conversation through text. Your persona will respond thoughtfully.",
    icon: MessageSquare,
    action: "Send a message",
    href: null, // Dynamic - goes to persona messages
  },
  {
    id: "make-call",
    title: "Make your first call",
    description: "Experience a live voice conversation. It feels surprisingly real.",
    icon: Phone,
    action: "Start a call",
    href: null, // Dynamic - goes to persona page
  },
] as const;

type OnboardingStep = (typeof ONBOARDING_STEPS)[number]["id"];

type OnboardingState = {
  dismissed: boolean;
  completedSteps: OnboardingStep[];
  currentStep: number;
};

const STORAGE_KEY = "limerence-onboarding";

function getStoredState(): OnboardingState {
  if (typeof window === "undefined") {
    return { dismissed: false, completedSteps: [], currentStep: 0 };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as OnboardingState;
    }
  } catch {
    // Ignore parse errors
  }

  return { dismissed: false, completedSteps: [], currentStep: 0 };
}

function saveState(state: OnboardingState) {
  if (typeof window === "undefined") return;
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

// Hook for managing onboarding state
export function useOnboarding() {
  // Initialize with stored state (lazy initializer runs once on client)
  const [state, setState] = useState<OnboardingState>(getStoredState);
  const [isHydrated, setIsHydrated] = useState(false);
  
  // Mark hydrated and persist changes
  useEffect(() => {
    setIsHydrated(true); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  // Persist state changes after hydration
  useEffect(() => {
    if (isHydrated) {
      saveState(state);
    }
  }, [state, isHydrated]);

  const completeStep = useCallback((stepId: OnboardingStep) => {
    setState((prev) => {
      if (prev.completedSteps.includes(stepId)) return prev;
      
      const newCompleted = [...prev.completedSteps, stepId];
      const stepIndex = ONBOARDING_STEPS.findIndex((s) => s.id === stepId);
      const nextStep = Math.min(stepIndex + 1, ONBOARDING_STEPS.length - 1);
      
      return {
        ...prev,
        completedSteps: newCompleted,
        currentStep: newCompleted.length >= ONBOARDING_STEPS.length ? -1 : nextStep,
      };
    });
  }, []);

  const dismiss = useCallback(() => {
    setState((prev) => ({ ...prev, dismissed: true }));
  }, []);

  const reset = useCallback(() => {
    setState({ dismissed: false, completedSteps: [], currentStep: 0 });
  }, []);

  const isComplete = state.completedSteps.length >= ONBOARDING_STEPS.length;
  const shouldShow = isHydrated && !state.dismissed && !isComplete;

  return {
    state,
    isHydrated,
    shouldShow,
    isComplete,
    completeStep,
    dismiss,
    reset,
    currentStepIndex: state.currentStep,
    completedSteps: state.completedSteps,
  };
}

// Progress indicator component
function OnboardingProgress({ 
  completedCount, 
  totalCount 
}: { 
  completedCount: number; 
  totalCount: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {Array.from({ length: totalCount }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 w-6 rounded-full transition-colors ${
              i < completedCount
                ? "bg-[var(--sage-deep)]"
                : "bg-[var(--sage-soft)]"
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-[var(--sage)]">
        {completedCount}/{totalCount}
      </span>
    </div>
  );
}

// Individual step card
function OnboardingStepCard({
  step,
  index,
  isCompleted,
  isCurrent,
  personaId,
}: {
  step: (typeof ONBOARDING_STEPS)[number];
  index: number;
  isCompleted: boolean;
  isCurrent: boolean;
  personaId?: string;
}) {
  const router = useRouter();
  const Icon = step.icon;

  const getHref = () => {
    if (step.href) return step.href;
    if (!personaId) return null;
    
    if (step.id === "send-message") {
      return `/personas/${personaId}/messages`;
    }
    if (step.id === "make-call") {
      return `/personas/${personaId}`;
    }
    return null;
  };

  const href = getHref();
  const isDisabled = !href && !step.href;

  const handleClick = () => {
    if (isCompleted) return;
    
    if (href) {
      router.push(href);
    }
  };

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
      {/* Step number / check */}
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
          isCompleted
            ? "bg-[var(--sage-deep)] text-white"
            : isCurrent
              ? "bg-[var(--sage-soft)] text-[var(--sage-deep)]"
              : "bg-[var(--paper-strong)] text-[var(--sage)]"
        }`}
      >
        {isCompleted ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <span className="text-sm font-semibold">{index + 1}</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 space-y-1">
        <h3
          className={`font-semibold ${
            isCompleted
              ? "text-[var(--sage)]"
              : "text-[var(--sage-deep)]"
          }`}
        >
          {step.title}
        </h3>
        <p className="text-sm text-[var(--sage)]">{step.description}</p>

        {/* Action button */}
        {!isCompleted && isCurrent && (
          <div className="pt-2">
            {href ? (
              <Link
                href={href}
                className="btn-solid inline-flex items-center gap-1.5 text-sm"
              >
                {step.action}
                <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <button
                type="button"
                disabled={isDisabled}
                onClick={handleClick}
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

      {/* Icon */}
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

// Main onboarding banner component
export function OnboardingBanner({
  personaId,
}: {
  personaId?: string;
}) {
  const {
    shouldShow,
    completedSteps,
    currentStepIndex,
    dismiss,
  } = useOnboarding();

  if (!shouldShow) return null;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-gradient-to-br from-white to-[var(--paper)] p-6 shadow-sm">
      {/* Dismiss button */}
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-4 top-4 rounded-full p-1.5 text-[var(--sage)] transition-colors hover:bg-[var(--sage-soft)] hover:text-[var(--sage-deep)]"
        aria-label="Dismiss onboarding"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Header */}
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--gold)]/20">
          <Sparkles className="h-5 w-5 text-[var(--gold)]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--sage-deep)]">
            Welcome to Limerence
          </h2>
          <p className="text-sm text-[var(--sage)]">
            Get started in 3 simple steps
          </p>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-4">
        <OnboardingProgress
          completedCount={completedSteps.length}
          totalCount={ONBOARDING_STEPS.length}
        />
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {ONBOARDING_STEPS.map((step, index) => (
          <OnboardingStepCard
            key={step.id}
            step={step}
            index={index}
            isCompleted={completedSteps.includes(step.id)}
            isCurrent={index === currentStepIndex}
            personaId={personaId}
          />
        ))}
      </div>

      {/* Skip link */}
      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={dismiss}
          className="text-sm text-[var(--sage)] underline-offset-2 hover:underline"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

// Compact inline onboarding hint
export function OnboardingHint({
  stepId,
  children,
  className = "",
}: {
  stepId: OnboardingStep;
  children: React.ReactNode;
  className?: string;
}) {
  const { shouldShow, completedSteps, currentStepIndex, completeStep } = useOnboarding();
  
  const stepIndex = ONBOARDING_STEPS.findIndex((s) => s.id === stepId);
  const isCurrentStep = stepIndex === currentStepIndex;
  const isCompleted = completedSteps.includes(stepId);

  if (!shouldShow || isCompleted || !isCurrentStep) return null;

  return (
    <div
      className={`flex items-center gap-2 rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/10 px-3 py-2 text-sm text-[var(--sage-deep)] ${className}`}
    >
      <Sparkles className="h-4 w-4 flex-shrink-0 text-[var(--gold)]" />
      <span>{children}</span>
      <button
        type="button"
        onClick={() => completeStep(stepId)}
        className="ml-auto text-xs text-[var(--sage)] hover:text-[var(--sage-deep)]"
      >
        Got it
      </button>
    </div>
  );
}

// Hook to mark steps complete from other components
export function useOnboardingActions() {
  const { completeStep, completedSteps, isComplete } = useOnboarding();

  const markPersonaCreated = useCallback(() => {
    completeStep("create-persona");
  }, [completeStep]);

  const markMessageSent = useCallback(() => {
    completeStep("send-message");
  }, [completeStep]);

  const markCallMade = useCallback(() => {
    completeStep("make-call");
  }, [completeStep]);

  return {
    markPersonaCreated,
    markMessageSent,
    markCallMade,
    completedSteps,
    isComplete,
  };
}
