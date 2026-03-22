"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageCircle, Mic, Volume2 } from "lucide-react";
import type { MessageEntry, Persona } from "@/lib/types";
import { formatRelative, getInitials } from "@/lib/utils";

interface PersonaListCardProps {
  persona: Persona;
  lastMessage: MessageEntry | null;
  unreadCount: number;
}

function isOnline(persona: Persona): boolean {
  // Consider "online" if last active within 5 minutes
  if (!persona.lastActiveAt) return false;
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  return new Date(persona.lastActiveAt).getTime() > fiveMinutesAgo;
}

function truncateMessage(text: string, maxLength: number = 60): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + "…";
}

export function PersonaListCard({ persona, lastMessage, unreadCount }: PersonaListCardProps) {
  const online = isOnline(persona);
  const hasUnread = unreadCount > 0;

  return (
    <Link
      href={`/personas/${persona.id}`}
      className={`group relative flex items-center gap-4 rounded-2xl border bg-white p-4 transition-all hover:border-[var(--accent)] hover:shadow-md ${
        hasUnread ? "border-[var(--accent)] border-opacity-50" : "border-[var(--border)]"
      }`}
    >
      {/* Avatar with online indicator */}
      <div className="relative flex-shrink-0">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(223,228,209,0.7)] text-base font-semibold text-[var(--sage-deep)]">
          {persona.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={persona.avatarUrl}
              alt={`${persona.name} avatar`}
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            getInitials(persona.name)
          )}
        </div>
        {/* Online/offline indicator */}
        <div
          className={`absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-white ${
            online ? "bg-green-500" : "bg-gray-300"
          }`}
          title={online ? "Active now" : "Offline"}
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-[var(--sage-deep)]">
              {persona.name}
            </h3>
            {persona.status === "draft" && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                Draft
              </span>
            )}
          </div>
          {lastMessage && (
            <span className="flex-shrink-0 text-xs text-[var(--sage-muted)]">
              {formatRelative(lastMessage.createdAt)}
            </span>
          )}
        </div>

        <p className="mt-0.5 text-sm text-[var(--sage-muted)]">{persona.relationship}</p>

        {/* Last message preview */}
        {lastMessage ? (
          <div className="mt-2 flex items-center gap-2">
            {lastMessage.kind === "audio" ? (
              <Volume2 className="h-3.5 w-3.5 flex-shrink-0 text-[var(--sage-muted)]" />
            ) : (
              <MessageCircle className="h-3.5 w-3.5 flex-shrink-0 text-[var(--sage-muted)]" />
            )}
            <p
              className={`truncate text-sm ${
                hasUnread && lastMessage.role === "assistant"
                  ? "font-medium text-[var(--sage-deep)]"
                  : "text-[var(--sage-muted)]"
              }`}
            >
              {lastMessage.role === "user" && "You: "}
              {lastMessage.kind === "audio"
                ? "Voice message"
                : truncateMessage(lastMessage.body)}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm italic text-[var(--sage-muted)]">
            No messages yet — start a conversation
          </p>
        )}
      </div>

      {/* Unread badge */}
      {hasUnread && (
        <div className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--accent)] px-2 text-xs font-semibold text-white">
          {unreadCount > 9 ? "9+" : unreadCount}
        </div>
      )}
    </Link>
  );
}

interface PersonaListEmptyProps {
  hasUser: boolean;
}

export function PersonaListEmpty({ hasUser }: PersonaListEmptyProps) {
  const [isCreatingTate, setIsCreatingTate] = useState(false);

  const handleCreateAndrewTate = async () => {
    setIsCreatingTate(true);
    try {
      const formData = new FormData();
      formData.append('name', 'Andrew Tate');
      formData.append('relationship', 'Mentor');
      formData.append('description', 'Andrew Tate is a former kickboxing world champion turned entrepreneur and self-improvement influencer. Known for his ultra-confident, no-nonsense approach to life, business, and masculinity. He speaks with absolute certainty, uses direct and often provocative language, and emphasizes personal responsibility, discipline, and financial success. His communication style is bold, unapologetic, and designed to challenge conventional thinking. He frequently uses metaphors from combat sports and chess, and has a distinctive way of breaking down complex topics into simple, actionable principles.');
      formData.append('starterVoiceId', 'aura-asteria-en');
      formData.append('heartbeatIntervalHours', '4');
      formData.append('preferredMode', 'voice_note');
      formData.append('attestedRights', 'on');
      formData.append('pastedText', 'Key Andrew Tate communication patterns:\n- Always speaks with absolute confidence and authority\n- Uses direct, sometimes harsh language to make points\n- Frequently references his kickboxing background and business success\n- Emphasizes personal responsibility and self-improvement\n- Challenges victim mentality and excuses\n- Uses metaphors from chess, combat sports, and business\n- Speaks in a rapid, energetic manner\n- Often asks rhetorical questions to make points\n- Uses phrases like "the matrix", "escape the matrix", "level up"\n- Emphasizes the importance of discipline, hard work, and financial freedom\n- Not afraid to be controversial or politically incorrect\n- Values loyalty, respect, and competence\n- Believes in traditional masculine values and roles');
      
      const response = await fetch('/api/personas', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to create persona');
      }

      const { personaId } = await response.json();
      window.location.href = `/personas/${personaId}`;
    } catch (error) {
      console.error('Error creating Andrew Tate persona:', error);
      setIsCreatingTate(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-white/50 px-6 py-12 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--sage-light)]">
        <Mic className="h-8 w-8 text-[var(--sage-muted)]" />
      </div>
      <h3 className="text-lg font-semibold text-[var(--sage-deep)]">
        {hasUser ? "No personas yet" : "Sign in to get started"}
      </h3>
      <p className="mt-2 max-w-sm text-sm text-[var(--sage-muted)]">
        {hasUser
          ? "Create your first persona to begin having conversations with someone you care about."
          : "Sign in to create personas and start meaningful conversations."}
      </p>
      {hasUser && (
        <div className="mt-6 flex gap-3">
          <button
            onClick={handleCreateAndrewTate}
            disabled={isCreatingTate}
            className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-black/90 disabled:opacity-50"
          >
            {isCreatingTate ? 'Creating...' : 'Talk to Andrew Tate'}
          </button>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            Create your own persona
          </Link>
        </div>
      )}
    </div>
  );
}
