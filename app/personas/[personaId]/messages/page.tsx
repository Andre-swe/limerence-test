import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { MessagesPanel } from "@/components/messages-panel";
import { DebugPanel } from "@/components/debug-panel";
import { LogoMark } from "@/components/logo-mark";
import { getPersona, listMessages } from "@/lib/store";
import { buildTelegramBindCommand } from "@/lib/telegram-bind";

export const dynamic = "force-dynamic";

export default async function PersonaMessagesPage({
  params,
}: {
  params: Promise<{ personaId: string }>;
}) {
  const { personaId } = await params;
  const persona = await getPersona(personaId);

  if (!persona) {
    notFound();
  }

  const messages = await listMessages(persona.id);
  const telegramBindCommand = process.env.TELEGRAM_BOT_TOKEN?.trim()
    ? buildTelegramBindCommand(persona)
    : null;

  return (
    <div className="app-shell min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <main className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-start justify-between gap-4 pb-2 pt-2">
          <div className="space-y-4">
            <LogoMark />
            <div className="space-y-3">
              <Link
                href={`/personas/${persona.id}`}
                className="link-warm inline-flex items-center gap-2 text-sm font-medium text-[var(--sage)]"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
              <h1 className="serif-title text-5xl text-[var(--sage-deep)] sm:text-6xl">
                {persona.name}
              </h1>
            </div>
          </div>

          <Link
            href={`/personas/${persona.id}`}
            className="btn-pill"
          >
            Call
          </Link>
        </header>

        {telegramBindCommand ? (
          <section className="rounded-[24px] border border-[var(--line)] bg-[rgba(255,255,255,0.72)] px-5 py-4">
            <p className="text-xs uppercase tracking-[0.22em] text-[rgba(29,38,34,0.45)]">
              Telegram connect
            </p>
            <p className="mt-2 text-sm text-[rgba(29,38,34,0.74)]">
              Use this secure command in Telegram to bind the chat to {persona.name}.
            </p>
            <code className="mt-3 block overflow-x-auto rounded-[16px] bg-[rgba(223,228,209,0.5)] px-3 py-3 text-sm text-[var(--sage-deep)]">
              {telegramBindCommand}
            </code>
          </section>
        ) : null}

        <MessagesPanel
          initialMessages={messages}
          personaId={persona.id}
          personaName={persona.name}
          personaStatus={persona.status}
        />
        <DebugPanel personaId={persona.id} />
      </main>
    </div>
  );
}
