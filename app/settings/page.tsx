import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  CloudCog,
  Database,
  MessageCircleMore,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { LogoMark } from "@/components/logo-mark";
import { getProviderStatus } from "@/lib/providers";
import { getSupabaseStatus } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const providerStatus = getProviderStatus();
  const supabaseStatus = getSupabaseStatus();
  const providerRows = [
    `Reasoning: ${providerStatus.reasoning}`,
    `Transcription: ${providerStatus.transcription}`,
    `Voice: ${providerStatus.voice}`,
    "Live sessions run through Hume EVI with persona-specific prompt, context, and voice settings.",
  ];
  const storageRows = [
    `URL configured: ${supabaseStatus.urlConfigured}`,
    `Anon key configured: ${supabaseStatus.anonKeyConfigured}`,
    `Service role configured: ${supabaseStatus.serviceRoleConfigured}`,
    `Shared runtime store: ${supabaseStatus.runtimeStoreConfigured ? "enabled" : "local file fallback"}`,
    `Runtime table: ${supabaseStatus.runtimeStoreTable}`,
    `Upload bucket: ${supabaseStatus.storageBucket}`,
  ];

  return (
    <div className="app-shell min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <main className="mx-auto max-w-5xl space-y-6">
        <header className="paper-panel rounded-[30px] px-6 py-6 sm:px-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-4">
              <LogoMark />
              <div>
                <p className="eyebrow">About Limerence</p>
                <h1 className="serif-title mt-2 text-5xl text-[var(--sage-deep)]">
                  Call-first, quiet on the surface
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-[rgba(29,38,34,0.62)]">
                  Limerence is meant to feel like presence, not settings. Timing, boundaries, and
                  delivery style are learned inside the conversation itself, including plain
                  requests like &ldquo;don&apos;t text me while I&apos;m at work.&rdquo; Live calls
                  now use the same learned cues instead of turning into visible transcripts.
                </p>
              </div>
            </div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--sage-deep)]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back home
            </Link>
          </div>
        </header>

        <section className="grid gap-6 md:grid-cols-3">
          {[
            {
              icon: Sparkles,
              title: "Rhythm is learned",
              body: "There is no obvious heartbeat dashboard in the core experience. Limerence listens for ordinary signals like asking for more space, asking for more presence, or preferring text over voice.",
            },
            {
              icon: MessageCircleMore,
              title: "Calls stay live",
              body: "Live sessions are persisted for memory and learning, but they are not mirrored back as a call transcript. Written notes remain a separate, quieter surface.",
            },
            {
              icon: ShieldCheck,
              title: "Synthetic and private",
              body: "Every conversation stays marked as an AI recreation. Public sharing is blocked in this prototype, and deceased-person personas remain behind manual review before activation.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <section key={title} className="paper-panel rounded-[30px] px-6 py-6">
              <Icon className="h-5 w-5 text-[var(--sage)]" />
              <h2 className="serif-title mt-3 text-3xl text-[var(--sage-deep)]">{title}</h2>
              <p className="mt-4 text-sm leading-7 text-[rgba(29,38,34,0.68)]">{body}</p>
            </section>
          ))}
        </section>

        <section className="soft-panel rounded-[30px] px-6 py-6 sm:px-8">
          <p className="eyebrow">Prototype notes</p>
          <h2 className="serif-title mt-2 text-4xl text-[var(--sage-deep)]">
            The invisible machinery
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[rgba(29,38,34,0.62)]">
            The demo still runs on explicit provider adapters, storage, and legacy Telegram plumbing.
            Those details stay here instead of leaking into the main product surface.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: CloudCog,
                title: "Model adapters",
                rows: providerRows,
              },
              {
                icon: Database,
                title: "Memory layer",
                rows: storageRows,
              },
              {
                icon: Bot,
                title: "Telegram bridge",
                rows: [
                  "Set TELEGRAM_BOT_TOKEN",
                  "Point the webhook at /api/telegram/webhook",
                  "Use /bind <persona-id> to connect a chat",
                ],
              },
            ].map(({ icon: Icon, title, rows }) => (
              <section key={title} className="rounded-[24px] bg-[rgba(255,255,255,0.72)] px-5 py-5">
                <Icon className="h-5 w-5 text-[var(--sage)]" />
                <h3 className="mt-3 text-lg font-semibold text-[var(--sage-deep)]">{title}</h3>
                <div className="mt-4 space-y-2">
                  {rows.map((row) => (
                    <div
                      key={row}
                      className="rounded-[16px] border border-[var(--line)] bg-[rgba(255,255,255,0.74)] px-3 py-2 text-sm text-[var(--sage-deep)]"
                    >
                      {row}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-[rgba(29,38,34,0.6)]">
            With `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` configured, Limerence
            can use a shared Supabase runtime store and Supabase Storage so multiple collaborators
            see the same personas, messages, and uploads. With `HUME_API_KEY`,
            `HUME_SECRET_KEY`, and a Hume voice or character id configured, live calls run through
            Hume EVI and use the same shared persona memory for async playback.
          </p>
        </section>
      </main>
    </div>
  );
}
