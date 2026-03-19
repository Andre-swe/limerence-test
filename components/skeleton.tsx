"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[var(--sage-light)]",
        className
      )}
    />
  );
}

// Home page persona list skeleton
export function PersonaListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-2xl border border-[var(--border)] bg-white p-4"
        >
          {/* Avatar */}
          <Skeleton className="h-14 w-14 flex-shrink-0 rounded-full" />
          
          {/* Content */}
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Persona detail page skeleton
export function PersonaDetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Skeleton className="h-20 w-20 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>

      {/* Stats/Actions */}
      <div className="flex gap-3">
        <Skeleton className="h-10 w-24 rounded-full" />
        <Skeleton className="h-10 w-24 rounded-full" />
        <Skeleton className="h-10 w-24 rounded-full" />
      </div>

      {/* Content area */}
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  );
}

// Message list skeleton
export function MessageListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {Array.from({ length: count }).map((_, i) => {
        const isUser = i % 2 === 1;
        return (
          <div
            key={i}
            className={cn("flex gap-3", isUser && "flex-row-reverse")}
          >
            {!isUser && <Skeleton className="h-8 w-8 flex-shrink-0 rounded-full" />}
            <div
              className={cn(
                "space-y-2",
                isUser ? "items-end" : "items-start"
              )}
            >
              <Skeleton
                className={cn(
                  "h-16 rounded-2xl",
                  isUser
                    ? "w-48 rounded-tr-sm"
                    : "w-64 rounded-tl-sm"
                )}
              />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Single message skeleton (for loading new messages)
export function MessageSkeleton({ isUser = false }: { isUser?: boolean }) {
  return (
    <div className={cn("flex gap-3 py-2", isUser && "flex-row-reverse")}>
      {!isUser && <Skeleton className="h-8 w-8 flex-shrink-0 rounded-full" />}
      <div className="space-y-1">
        <Skeleton
          className={cn(
            "h-12 rounded-2xl",
            isUser ? "w-40 rounded-tr-sm" : "w-56 rounded-tl-sm"
          )}
        />
      </div>
    </div>
  );
}

// Call connection skeleton
export function CallConnectionSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      {/* Pulsing orb placeholder */}
      <div className="relative">
        <Skeleton className="h-32 w-32 rounded-full" />
        <div className="absolute inset-0 animate-ping rounded-full bg-[var(--sage-light)] opacity-50" />
      </div>
      
      {/* Status text */}
      <div className="mt-8 space-y-2 text-center">
        <Skeleton className="mx-auto h-5 w-32" />
        <Skeleton className="mx-auto h-4 w-48" />
      </div>

      {/* Control buttons placeholder */}
      <div className="mt-8 flex gap-3">
        <Skeleton className="h-12 w-24 rounded-full" />
        <Skeleton className="h-12 w-24 rounded-full" />
        <Skeleton className="h-12 w-24 rounded-full" />
      </div>
    </div>
  );
}

// Conversation panel skeleton (for the live call area)
export function ConversationPanelSkeleton() {
  return (
    <section className="paper-panel mx-auto max-w-3xl rounded-[42px] px-4 py-4 sm:px-6 sm:py-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-2 py-2">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-5 w-16" />
      </div>

      {/* Orb area */}
      <div className="mt-4 rounded-[34px] border border-[var(--line)] bg-[var(--call-surface)] px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto flex max-w-md flex-col items-center">
          <Skeleton className="h-32 w-32 rounded-full" />
          
          <div className="mt-8 flex gap-2">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-20 rounded-full" />
          </div>

          <div className="mt-8 flex gap-3">
            <Skeleton className="h-10 w-20 rounded-full" />
            <Skeleton className="h-10 w-28 rounded-full" />
            <Skeleton className="h-10 w-24 rounded-full" />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-4 rounded-[28px] border border-[var(--line)] bg-[var(--call-bar)] p-3">
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-14 rounded-2xl" />
        </div>
      </div>
    </section>
  );
}

// Settings page skeleton
export function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-20 rounded-full" />
      </div>

      {/* Sections */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <div className="flex items-center gap-3 pb-4">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-6 w-24" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Full page loading skeleton
export function PageLoadingSkeleton() {
  return (
    <div className="app-shell min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <main className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-8 pt-2">
          <Skeleton className="h-8 w-32" />
          <div className="flex items-center gap-5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </div>

        {/* Content */}
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-24" />
          <PersonaListSkeleton count={2} />
        </div>
      </main>
    </div>
  );
}
