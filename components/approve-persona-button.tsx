"use client";

import { useState } from "react";
import { CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";

export function ApprovePersonaButton({ personaId }: { personaId: string }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        setIsSubmitting(true);
        try {
          await fetch(`/api/personas/${personaId}/approval`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ approved: true }),
          });
          router.refresh();
        } finally {
          setIsSubmitting(false);
        }
      }}
      className="inline-flex items-center gap-2 rounded-full bg-[var(--sage-deep)] px-4 py-2 text-sm font-semibold text-white"
    >
      <CheckCheck className="h-4 w-4" />
      {isSubmitting ? "Approving..." : "Approve persona"}
    </button>
  );
}
