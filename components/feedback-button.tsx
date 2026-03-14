"use client";

import { useState } from "react";
import { Flag } from "lucide-react";

export function FeedbackButton({
  personaId,
  messageId,
}: {
  personaId: string;
  messageId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-label="Correct this reply"
        title="Correct this reply"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] text-[var(--sage-deep)] transition hover:bg-[rgba(255,255,255,0.68)]"
      >
        <Flag className="h-3.5 w-3.5" />
      </button>
      {isOpen ? (
        <div className="mt-3 space-y-2 rounded-[18px] bg-[rgba(255,255,255,0.78)] p-3">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Describe what felt off."
            rows={3}
            className="input-quiet w-full text-sm"
          />
          <button
            type="button"
            disabled={isSubmitting || note.trim().length < 4}
            onClick={async () => {
              setIsSubmitting(true);
              try {
                const response = await fetch(`/api/personas/${personaId}/feedback`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    messageId,
                    note,
                  }),
                });
                if (!response.ok) {
                  throw new Error("Failed to save feedback.");
                }
                setNote("");
                setIsOpen(false);
              } catch {
                // Silently keep the form open so the user can retry.
              } finally {
                setIsSubmitting(false);
              }
            }}
            className="btn-solid text-xs"
          >
            {isSubmitting ? "Saving..." : "Save feedback"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
