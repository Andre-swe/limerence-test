import Link from "next/link";
import { Plus } from "lucide-react";
import { LogoMark } from "@/components/logo-mark";
import { PersonaListCard, PersonaListEmpty } from "@/components/persona-list-card";
import { UserMenu } from "@/components/user-menu";
import { createClient } from "@/lib/supabase-server";
import { getLastMessage, getUnreadCount, listPersonasForUser } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const personas = user ? await listPersonasForUser(user.id) : [];

  // Fetch last message and unread count for each persona
  const personasWithMeta = await Promise.all(
    personas.map(async (persona) => ({
      persona,
      lastMessage: await getLastMessage(persona.id),
      unreadCount: await getUnreadCount(persona.id),
    }))
  );

  // Sort by most recent activity
  personasWithMeta.sort((a, b) => {
    const aTime = a.lastMessage?.createdAt ?? a.persona.createdAt;
    const bTime = b.lastMessage?.createdAt ?? b.persona.createdAt;
    return bTime.localeCompare(aTime);
  });

  const hasPersonas = personasWithMeta.length > 0;

  return (
    <div className="app-shell min-h-screen px-4 py-6 text-[var(--foreground)] sm:px-6 lg:px-10">
      <main className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-2xl flex-col">
        <header className="flex items-center justify-between pb-8 pt-2">
          <LogoMark />
          <div className="flex items-center gap-5 text-sm text-[rgba(29,38,34,0.48)]">
            {hasPersonas && (
              <Link href="/create" className="link-warm">
                Create
              </Link>
            )}
            <Link href="/settings" className="link-warm">
              Settings
            </Link>
            {user && <UserMenu email={user.email ?? "User"} />}
          </div>
        </header>

        {hasPersonas ? (
          <>
            <section className="pb-6">
              <h1 className="text-2xl font-semibold text-[var(--sage-deep)]">
                Your Personas
              </h1>
              <p className="mt-1 text-sm text-[var(--sage-muted)]">
                {personasWithMeta.length} {personasWithMeta.length === 1 ? "persona" : "personas"}
              </p>
            </section>

            <section className="flex flex-col gap-3 pb-6">
              {personasWithMeta.map(({ persona, lastMessage, unreadCount }) => (
                <PersonaListCard
                  key={persona.id}
                  persona={persona}
                  lastMessage={lastMessage}
                  unreadCount={unreadCount}
                />
              ))}
            </section>

            {/* Add new persona - compact button */}
            <Link
              href="/create"
              className="flex items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] bg-white/50 p-4 text-[var(--sage-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--sage-light)]">
                <Plus className="h-5 w-5" />
              </div>
              <span className="text-sm font-medium">Add another persona</span>
            </Link>
          </>
        ) : (
          <section className="flex flex-1 items-center justify-center py-12">
            <PersonaListEmpty hasUser={!!user} />
          </section>
        )}

        <footer className="meta-quiet mx-auto mt-auto pb-4 pt-8 text-center">
          Built from voice, memory, and relationship history.
        </footer>
      </main>
    </div>
  );
}
