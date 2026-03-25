"use client";

export function OnboardingProgress({
  completedCount,
  totalCount,
}: {
  completedCount: number;
  totalCount: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {Array.from({ length: totalCount }).map((_, index) => (
          <div
            key={index}
            className={`h-1.5 w-6 rounded-full transition-colors ${
              index < completedCount ? "bg-[var(--sage-deep)]" : "bg-[var(--sage-soft)]"
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
