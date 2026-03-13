import Link from "next/link";
import type { Persona } from "@/lib/types";
import { describePresence, formatRelative, getInitials } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";

export function PersonaCard({ persona }: { persona: Persona }) {
  return (
    <Link
      href={`/personas/${persona.id}`}
      className="group soft-panel flex min-h-[220px] flex-col justify-between rounded-[36px] p-6 transition-transform hover:-translate-y-1"
    >
      <div className="flex items-start gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-[rgba(223,228,209,0.7)] text-lg font-semibold text-[var(--sage-deep)]">
            {persona.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={persona.avatarUrl}
                alt={`${persona.name} avatar`}
                className="h-full w-full rounded-[24px] object-cover"
              />
            ) : (
              getInitials(persona.name)
            )}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-[1.9rem] font-semibold tracking-[-0.04em] text-[var(--sage-deep)]">
                {persona.name}
              </h3>
              <StatusBadge status={persona.status} />
            </div>
            <p className="mt-1 text-sm text-[rgba(28,37,32,0.52)]">{persona.relationship}</p>
          </div>
        </div>
      </div>

      <div className="mt-8 border-t border-[var(--line)] pt-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[rgba(28,37,32,0.42)]">
            Carrying
          </p>
          <p className="mt-2 text-sm text-[var(--sage-deep)]">
            {persona.mindState.openLoops[0]?.title ?? describePresence(persona.heartbeatPolicy)}
          </p>
        </div>
        <p className="mt-4 text-sm text-[rgba(28,37,32,0.44)]">{formatRelative(persona.updatedAt)}</p>
      </div>
    </Link>
  );
}
