"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  BellOff,
  Loader2,
  LogOut,
  Mail,
  Shield,
  Trash2,
  User,
} from "lucide-react";

interface SettingsClientProps {
  user: {
    id: string;
    email: string;
  };
}

export function SettingsClient({ user }: SettingsClientProps) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Notification preferences (stored in localStorage for now)
  const [emailNotifications, setEmailNotifications] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("notifications_email") !== "false";
    }
    return true;
  });
  const [pushNotifications, setPushNotifications] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("notifications_push") !== "false";
    }
    return true;
  });

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (response.ok) {
        router.push("/login");
        router.refresh();
      } else {
        setError("Failed to log out. Please try again.");
      }
    } catch {
      setError("Failed to log out. Please try again.");
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE") return;

    setIsDeleting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/delete-account", {
        method: "DELETE",
      });
      if (response.ok) {
        router.push("/login?deleted=true");
      } else {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Failed to delete account. Please try again.");
      }
    } catch {
      setError("Failed to delete account. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleEmailNotifications = () => {
    const newValue = !emailNotifications;
    setEmailNotifications(newValue);
    localStorage.setItem("notifications_email", String(newValue));
  };

  const togglePushNotifications = () => {
    const newValue = !pushNotifications;
    setPushNotifications(newValue);
    localStorage.setItem("notifications_push", String(newValue));
  };

  return (
    <div className="app-shell min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <main className="mx-auto max-w-2xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between pb-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--sage-deep)]">Settings</h1>
            <p className="mt-1 text-sm text-[var(--sage-muted)]">
              Manage your account and preferences
            </p>
          </div>
          <Link href="/" className="btn-pill">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </header>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Account Section */}
        <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <div className="flex items-center gap-3 pb-4">
            <User className="h-5 w-5 text-[var(--sage)]" />
            <h2 className="text-lg font-semibold text-[var(--sage-deep)]">Account</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl bg-[var(--sage-light)] px-4 py-3">
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-[var(--sage-muted)]" />
                <div>
                  <p className="text-sm font-medium text-[var(--sage-deep)]">Email</p>
                  <p className="text-sm text-[var(--sage-muted)]">{user.email}</p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] px-4 py-3 text-left transition-colors hover:bg-[var(--sage-light)]"
            >
              <div className="flex items-center gap-3">
                <LogOut className="h-4 w-4 text-[var(--sage-muted)]" />
                <span className="text-sm font-medium text-[var(--sage-deep)]">Sign out</span>
              </div>
              {isLoggingOut && <Loader2 className="h-4 w-4 animate-spin text-[var(--sage-muted)]" />}
            </button>
          </div>
        </section>

        {/* Notifications Section */}
        <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <div className="flex items-center gap-3 pb-4">
            <Bell className="h-5 w-5 text-[var(--sage)]" />
            <h2 className="text-lg font-semibold text-[var(--sage-deep)]">Notifications</h2>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={toggleEmailNotifications}
              className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] px-4 py-3 text-left transition-colors hover:bg-[var(--sage-light)]"
            >
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-[var(--sage-muted)]" />
                <div>
                  <p className="text-sm font-medium text-[var(--sage-deep)]">Email notifications</p>
                  <p className="text-xs text-[var(--sage-muted)]">
                    Receive updates about your personas via email
                  </p>
                </div>
              </div>
              <div
                className={`flex h-6 w-11 items-center rounded-full px-1 transition-colors ${
                  emailNotifications ? "bg-[var(--accent)]" : "bg-gray-200"
                }`}
              >
                <div
                  className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    emailNotifications ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </div>
            </button>

            <button
              type="button"
              onClick={togglePushNotifications}
              className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] px-4 py-3 text-left transition-colors hover:bg-[var(--sage-light)]"
            >
              <div className="flex items-center gap-3">
                {pushNotifications ? (
                  <Bell className="h-4 w-4 text-[var(--sage-muted)]" />
                ) : (
                  <BellOff className="h-4 w-4 text-[var(--sage-muted)]" />
                )}
                <div>
                  <p className="text-sm font-medium text-[var(--sage-deep)]">Push notifications</p>
                  <p className="text-xs text-[var(--sage-muted)]">
                    Get notified when your personas send messages
                  </p>
                </div>
              </div>
              <div
                className={`flex h-6 w-11 items-center rounded-full px-1 transition-colors ${
                  pushNotifications ? "bg-[var(--accent)]" : "bg-gray-200"
                }`}
              >
                <div
                  className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    pushNotifications ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </div>
            </button>
          </div>
        </section>

        {/* Privacy Section */}
        <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <div className="flex items-center gap-3 pb-4">
            <Shield className="h-5 w-5 text-[var(--sage)]" />
            <h2 className="text-lg font-semibold text-[var(--sage-deep)]">Privacy</h2>
          </div>

          <div className="space-y-3 text-sm text-[var(--sage-muted)]">
            <p>
              Your conversations and persona data are stored securely and never shared with third
              parties. Voice recordings are only used to create your custom voice profiles.
            </p>
            <p>
              All AI interactions are clearly marked as synthetic. We do not use your data to train
              models without explicit consent.
            </p>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="rounded-2xl border border-red-200 bg-red-50 p-6">
          <div className="flex items-center gap-3 pb-4">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <h2 className="text-lg font-semibold text-red-700">Danger Zone</h2>
          </div>

          {!showDeleteConfirm ? (
            <div className="space-y-3">
              <p className="text-sm text-red-600">
                Deleting your account will permanently remove all your personas, conversations, and
                voice profiles. This action cannot be undone.
              </p>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-100"
              >
                <Trash2 className="h-4 w-4" />
                Delete my account
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-red-600">
                To confirm deletion, type <strong>DELETE</strong> below:
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="Type DELETE to confirm"
                className="w-full rounded-lg border border-red-300 px-4 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmText("");
                  }}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium text-[var(--sage-deep)] transition-colors hover:bg-[var(--sage-light)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={deleteConfirmText !== "DELETE" || isDeleting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {isDeleting ? "Deleting..." : "Delete permanently"}
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
