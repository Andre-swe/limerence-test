"use client";

import { useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useRouter } from "next/navigation";

export function RunHeartbeatButton({
  endpoint,
  label,
}: {
  endpoint: string;
  label: string;
}) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={async () => {
          setIsRunning(true);
          setError(null);
          try {
            const response = await fetch(endpoint, { method: "POST" });
            if (!response.ok) {
              throw new Error(`Heartbeat request failed with status ${response.status}.`);
            }
            router.refresh();
          } catch {
            setError("Unable to run action. Try again.");
          } finally {
            setIsRunning(false);
          }
        }}
        className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.12)] px-4 py-2 text-sm font-medium text-white transition-transform hover:-translate-y-0.5"
      >
        <RefreshCcw className={`h-4 w-4 ${isRunning ? "animate-spin" : ""}`} />
        {isRunning ? "Running..." : label}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-[rgba(255,255,255,0.82)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
