"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

interface UserMenuProps {
  email: string;
}

export function UserMenu({ email }: UserMenuProps) {
  const router = useRouter();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full bg-[rgba(223,228,209,0.6)] px-3 py-1.5 text-sm text-[var(--sage-deep)] transition-colors hover:bg-[rgba(223,228,209,0.9)]"
      >
        <User className="h-4 w-4" />
        <span className="max-w-[120px] truncate">{email}</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-20 mt-2 w-48 rounded-xl border border-[rgba(29,38,34,0.08)] bg-white p-1 shadow-lg">
            <button
              onClick={handleSignOut}
              disabled={loading}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[rgba(223,228,209,0.4)] disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" />
              {loading ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
