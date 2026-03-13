import { cn } from "@/lib/utils";
import type { PersonaStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: PersonaStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
        status === "active" && "bg-[rgba(111,123,105,0.14)] text-[var(--sage-deep)]",
        status === "draft" && "bg-[rgba(28,37,32,0.08)] text-[rgba(28,37,32,0.72)]",
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}
