"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  AccountSection,
  DangerZoneSection,
  NotificationsSection,
  PrivacySection,
} from "@/components/settings-client-sections";

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
      const response = await fetch("/api/auth/sign-out", { method: "POST" });
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

        <AccountSection email={user.email} isLoggingOut={isLoggingOut} onLogout={handleLogout} />

        <NotificationsSection
          emailNotifications={emailNotifications}
          pushNotifications={pushNotifications}
          onToggleEmailNotifications={toggleEmailNotifications}
          onTogglePushNotifications={togglePushNotifications}
        />

        <PrivacySection />

        <DangerZoneSection
          showDeleteConfirm={showDeleteConfirm}
          deleteConfirmText={deleteConfirmText}
          isDeleting={isDeleting}
          onBeginDelete={() => setShowDeleteConfirm(true)}
          onCancelDelete={() => {
            setShowDeleteConfirm(false);
            setDeleteConfirmText("");
          }}
          onDelete={handleDeleteAccount}
          onChangeDeleteConfirmText={setDeleteConfirmText}
        />
      </main>
    </div>
  );
}
