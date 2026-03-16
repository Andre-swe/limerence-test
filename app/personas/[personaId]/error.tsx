"use client";

import Link from "next/link";

export default function PersonaError({
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
          Unable to load persona
        </h1>
        <p className="meta-quiet mt-3">
          {error.message || "Something went wrong loading this persona."}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="btn-solid"
          >
            Try again
          </button>
          <Link href="/" className="link-warm text-sm">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
