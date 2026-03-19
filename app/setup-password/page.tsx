"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";

export default function SetupPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validations = {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSymbol: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    passwordsMatch: password === confirmPassword && password.length > 0,
  };

  const allValid = Object.values(validations).every(Boolean);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!allValid) {
      setError("Please meet all password requirements.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error);
      
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const ValidationItem = ({ valid, text }: { valid: boolean; text: string }) => (
    <div className={`flex items-center gap-2 text-sm ${valid ? "text-green-600" : "text-[rgba(29,38,34,0.48)]"}`}>
      <span className={`flex h-4 w-4 items-center justify-center rounded-full text-xs ${valid ? "bg-green-100" : "bg-[rgba(29,38,34,0.08)]"}`}>
        {valid ? "✓" : "○"}
      </span>
      {text}
    </div>
  );

  return (
    <div className="app-shell flex min-h-screen flex-col items-center justify-center px-4 py-6 text-[var(--foreground)]">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block">
            <LogoMark />
          </Link>
          <h1 className="serif-title mt-6 text-3xl text-[var(--sage-deep)]">
            Set your password
          </h1>
          <p className="meta-quiet mt-2">
            Create a secure password for your account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
              className="w-full rounded-xl border border-[rgba(29,38,34,0.12)] bg-white px-4 py-3 text-[var(--foreground)] placeholder:text-[rgba(29,38,34,0.32)] focus:border-[var(--sage-deep)] focus:outline-none focus:ring-1 focus:ring-[var(--sage-deep)]"
              placeholder="Enter your password"
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="eyebrow mb-1.5 block">
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full rounded-xl border border-[rgba(29,38,34,0.12)] bg-white px-4 py-3 text-[var(--foreground)] placeholder:text-[rgba(29,38,34,0.32)] focus:border-[var(--sage-deep)] focus:outline-none focus:ring-1 focus:ring-[var(--sage-deep)]"
              placeholder="Confirm your password"
            />
          </div>

          <div className="space-y-2 rounded-xl bg-[rgba(29,38,34,0.04)] p-4">
            <p className="eyebrow mb-2 text-xs">Password requirements</p>
            <ValidationItem valid={validations.minLength} text="At least 8 characters" />
            <ValidationItem valid={validations.hasUppercase} text="Include uppercase letter" />
            <ValidationItem valid={validations.hasLowercase} text="Include lowercase letter" />
            <ValidationItem valid={validations.hasNumber} text="Include a number" />
            <ValidationItem valid={validations.hasSymbol} text="Include a symbol (!@#$%^&*)" />
            <ValidationItem valid={validations.passwordsMatch} text="Passwords match" />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !allValid}
            className="w-full rounded-xl bg-[var(--sage-deep)] px-4 py-3 font-medium text-white transition-colors hover:bg-[var(--sage-deep)]/90 disabled:opacity-50"
          >
            {loading ? "Setting up..." : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
