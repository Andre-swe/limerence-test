import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { MessagesPanel } from "@/components/messages-panel";
import { DebugPanel } from "@/components/debug-panel";
import { createClient } from "@/lib/supabase-server";
import { getPersonaForUser, listMessages } from "@/lib/store";
import { withUserStore } from "@/lib/store-context";

export const dynamic = "force-dynamic";

export default async function PersonaMessagesPage({
  params,
}: {
  params: Promise<{ personaId: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { personaId } = await params;

  if (!user) {
    notFound();
  }

  const persona = await getPersonaForUser(user.id, personaId);

  if (!persona) {
    notFound();
  }

  const messages = await withUserStore(user.id, () => listMessages(persona.id));

  return (
    <div className="app-shell mobile-full-height flex flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-10">
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
        {/* Mobile-optimized header */}
        <header className="safe-area-top flex items-center justify-between gap-3 pb-3 sm:pb-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/personas/${persona.id}`}
              className="touch-target flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-[var(--sage)] sm:h-auto sm:w-auto sm:bg-transparent sm:p-0"
              aria-label="Back to persona"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-semibold text-[var(--sage-deep)] sm:text-2xl">
              {persona.name}
            </h1>
          </div>

          <Link
            href={`/personas/${persona.id}`}
            className="btn-pill touch-target"
          >
            Call
          </Link>
        </header>

        {/* Messages panel takes remaining space */}
        <div className="flex-1 overflow-hidden">
          <MessagesPanel
            initialMessages={messages}
            personaId={persona.id}
            personaName={persona.name}
            personaStatus={persona.status}
          />
        </div>

        {/* Debug panel hidden on mobile */}
        <div className="hidden sm:block">
          <DebugPanel personaId={persona.id} />
        </div>
      </main>
    </div>
  );
}
