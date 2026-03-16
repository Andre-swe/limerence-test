"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="app-shell flex min-h-screen flex-col items-center justify-center px-4 py-6 text-[var(--foreground)]">
      <div className="w-full max-w-sm text-center">
        <h1 className="serif-title text-3xl text-[var(--sage-deep)]">
          Something went wrong
        </h1>
        <p className="meta-quiet mt-3">
          {error.message || "An unexpected error occurred. Please try again."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="btn-solid mt-6"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
