"use client";

import { OnboardingBanner } from "@/components/onboarding";

type HomeClientProps = {
  hasPersonas: boolean;
  firstPersonaId?: string;
};

export function HomeOnboarding({ hasPersonas, firstPersonaId }: HomeClientProps) {
  // Only show onboarding if user has no personas or is new
  if (hasPersonas) return null;

  return (
    <div className="mb-6">
      <OnboardingBanner personaId={firstPersonaId} />
    </div>
  );
}
