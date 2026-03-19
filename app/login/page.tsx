"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";

type AuthMode = "sign-in" | "sign-up" | "magic-link";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === "magic-link") {
        const res = await fetch("/api/auth/magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setMessage(data.message);
      } else if (mode === "sign-up") {
        const res = await fetch("/api/auth/magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setMessage("Check your email for a link to create your account!");
      } else {
        const res = await fetch("/api/auth/sign-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell flex min-h-screen flex-col items-center justify-center px-4 py-6 text-[var(--foreground)]">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block">
            <LogoMark />
          </Link>
          <h1 className="serif-title mt-6 text-3xl text-[var(--sage-deep)]">
            {mode === "sign-up" ? "Create account" : "Welcome back"}
          </h1>
          <p className="meta-quiet mt-2">
            {mode === "magic-link"
              ? "We'll send you a magic link"
              : mode === "sign-up"
                ? "Sign up to create your personas"
                : "Sign in to continue"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="eyebrow mb-1.5 block">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-xl border border-[rgba(29,38,34,0.12)] bg-white px-4 py-3 text-[var(--foreground)] placeholder:text-[rgba(29,38,34,0.32)] focus:border-[var(--sage-deep)] focus:outline-none focus:ring-1 focus:ring-[var(--sage-deep)]"
              placeholder="you@example.com"
            />
          </div>

          {mode === "sign-in" && (
            <div>
              <label htmlFor="password" className="eyebrow mb-1.5 block">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full rounded-xl border border-[rgba(29,38,34,0.12)] bg-white px-4 py-3 text-[var(--foreground)] placeholder:text-[rgba(29,38,34,0.32)] focus:border-[var(--sage-deep)] focus:outline-none focus:ring-1 focus:ring-[var(--sage-deep)]"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          {message && (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[var(--sage-deep)] px-4 py-3 font-medium text-white transition-colors hover:bg-[var(--sage-deep)]/90 disabled:opacity-50"
          >
            {loading
              ? "Loading..."
              : mode === "magic-link"
                ? "Send magic link"
                : mode === "sign-up"
                  ? "Send sign-up link"
                  : "Sign in"}
          </button>
        </form>

        <div className="mt-6 space-y-3 text-center text-sm">
          {mode === "sign-in" && (
            <>
              <button
                onClick={() => setMode("magic-link")}
                className="link-warm block w-full"
              >
                Sign in with magic link instead
              </button>
              <p className="text-[rgba(29,38,34,0.48)]">
                Don&apos;t have an account?{" "}
                <button
                  onClick={() => setMode("sign-up")}
                  className="link-warm"
                >
                  Sign up
                </button>
              </p>
            </>
          )}

          {mode === "sign-up" && (
            <p className="text-[rgba(29,38,34,0.48)]">
              Already have an account?{" "}
              <button onClick={() => setMode("sign-in")} className="link-warm">
                Sign in
              </button>
            </p>
          )}

          {mode === "magic-link" && (
            <button
              onClick={() => setMode("sign-in")}
              className="link-warm block w-full"
            >
              Sign in with password instead
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
