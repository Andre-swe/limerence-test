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
            className="w-full rounded-2xl border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none"
          />
          <button
            type="button"
            disabled={isSubmitting || note.trim().length < 4}
            onClick={async () => {
              setIsSubmitting(true);
              try {
                await fetch(`/api/personas/${personaId}/feedback`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    messageId,
                    note,
                  }),
                });
                setNote("");
                setIsOpen(false);
              } finally {
                setIsSubmitting(false);
              }
            }}
            className="rounded-full bg-[var(--sage-deep)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Save feedback"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
