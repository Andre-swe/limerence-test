import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { MessagesPanel } from "@/components/messages-panel";
import { DebugPanel } from "@/components/debug-panel";
import { LogoMark } from "@/components/logo-mark";
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
