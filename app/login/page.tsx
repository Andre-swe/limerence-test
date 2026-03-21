"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";
import { createClient } from "@/lib/supabase-browser";

type AuthMode = "sign-in" | "sign-up" | "magic-link";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleOAuthSignIn = async (provider: "google" | "apple") => {
    setLoading(true);
    setError(null);
    
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  };

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

        <div className="space-y-3 mb-6">
          <button
            type="button"
            onClick={() => handleOAuthSignIn("google")}
            disabled={loading}
            className="w-full rounded-xl border border-[rgba(29,38,34,0.12)] bg-white px-4 py-3 font-medium text-[var(--foreground)] transition-colors hover:bg-[rgba(29,38,34,0.04)] disabled:opacity-50 flex items-center justify-center gap-3"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
          
          <button
            type="button"
            onClick={() => handleOAuthSignIn("apple")}
            disabled={loading}
            className="w-full rounded-xl border border-[rgba(29,38,34,0.12)] bg-black px-4 py-3 font-medium text-white transition-colors hover:bg-black/90 disabled:opacity-50 flex items-center justify-center gap-3"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
            </svg>
            Continue with Apple
          </button>
        </div>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[rgba(29,38,34,0.12)]"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-[var(--background)] px-4 text-[rgba(29,38,34,0.48)]">Or continue with email</span>
          </div>
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
