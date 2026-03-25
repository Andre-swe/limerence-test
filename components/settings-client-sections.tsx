"use client";

import { AlertTriangle, Bell, BellOff, Loader2, LogOut, Mail, Shield, Trash2, User } from "lucide-react";

type AccountSectionProps = {
  email: string;
  isLoggingOut: boolean;
  onLogout: () => void;
};

export function AccountSection({ email, isLoggingOut, onLogout }: AccountSectionProps) {
  return (
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
              <p className="text-sm text-[var(--sage-muted)]">{email}</p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
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
  );
}

type NotificationsSectionProps = {
  emailNotifications: boolean;
  pushNotifications: boolean;
  onToggleEmailNotifications: () => void;
  onTogglePushNotifications: () => void;
};

export function NotificationsSection({
  emailNotifications,
  pushNotifications,
  onToggleEmailNotifications,
  onTogglePushNotifications,
}: NotificationsSectionProps) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
      <div className="flex items-center gap-3 pb-4">
        <Bell className="h-5 w-5 text-[var(--sage)]" />
        <h2 className="text-lg font-semibold text-[var(--sage-deep)]">Notifications</h2>
      </div>

      <div className="space-y-3">
        <button
          type="button"
          onClick={onToggleEmailNotifications}
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
          onClick={onTogglePushNotifications}
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
  );
}

export function PrivacySection() {
  return (
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
  );
}

type DangerZoneSectionProps = {
  showDeleteConfirm: boolean;
  deleteConfirmText: string;
  isDeleting: boolean;
  onBeginDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onChangeDeleteConfirmText: (value: string) => void;
};

export function DangerZoneSection({
  showDeleteConfirm,
  deleteConfirmText,
  isDeleting,
  onBeginDelete,
  onCancelDelete,
  onDelete,
  onChangeDeleteConfirmText,
}: DangerZoneSectionProps) {
  return (
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
            onClick={onBeginDelete}
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
            onChange={(event) => onChangeDeleteConfirmText(event.target.value)}
            placeholder="Type DELETE to confirm"
            className="w-full rounded-lg border border-red-300 px-4 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancelDelete}
              className="flex-1 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium text-[var(--sage-deep)] transition-colors hover:bg-[var(--sage-light)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onDelete}
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
  );
}
