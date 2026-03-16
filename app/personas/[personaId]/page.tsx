import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ConversationPanel } from "@/components/conversation-panel";
import { DebugPanel } from "@/components/debug-panel";
import { LogoMark } from "@/components/logo-mark";
import { createClient } from "@/lib/supabase-server";
import { getPersonaForUser } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function PersonaDetailPage({
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

  return (
    <div className="app-shell min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <main className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-start justify-between gap-4 pb-2 pt-2">
          <div className="space-y-4">
            <LogoMark />
            <Link
              href="/"
              className="link-warm inline-flex items-center gap-2 text-sm font-medium text-[var(--sage)]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/personas/${persona.id}/messages`}
              className="btn-pill"
            >
              Messages
            </Link>
          </div>
        </header>

        <ConversationPanel
          personaId={persona.id}
          personaName={persona.name}
          personaStatus={persona.status}
        />
        <DebugPanel personaId={persona.id} />
      </main>
    </div>
  );
}
