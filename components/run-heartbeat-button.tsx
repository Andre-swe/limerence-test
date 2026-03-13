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

  return (
    <button
      type="button"
      onClick={async () => {
        setIsRunning(true);
        try {
          await fetch(endpoint, { method: "POST" });
          router.refresh();
        } finally {
          setIsRunning(false);
        }
      }}
      className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.12)] px-4 py-2 text-sm font-medium text-white transition-transform hover:-translate-y-0.5"
    >
      <RefreshCcw className={`h-4 w-4 ${isRunning ? "animate-spin" : ""}`} />
      {isRunning ? "Running..." : label}
    </button>
  );
}
