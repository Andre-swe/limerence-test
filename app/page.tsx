import Link from "next/link";
import { Plus } from "lucide-react";
import { LogoMark } from "@/components/logo-mark";
import { PersonaCard } from "@/components/persona-card";
import { UserMenu } from "@/components/user-menu";
import { createClient } from "@/lib/supabase-server";
import { listPersonas } from "@/lib/store";
import { withUserStore } from "@/lib/store-context";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  // Use per-user store when user is authenticated
  const personas = user
    ? await withUserStore(user.id, () => listPersonas())
    : await listPersonas();

  return (
    <div className="app-shell min-h-screen px-4 py-6 text-[var(--foreground)] sm:px-6 lg:px-10">
      <main className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col">
        <header className="flex items-center justify-between pb-10 pt-2">
          <LogoMark />
          <div className="flex items-center gap-5 text-sm text-[rgba(29,38,34,0.48)]">
            <Link href="/create" className="link-warm">
              Create
            </Link>
            <Link href="/settings" className="link-warm">
              How it works
            </Link>
            {user && <UserMenu email={user.email ?? "User"} />}
          </div>
        </header>

        <section className="pb-12 pt-6 text-center">
          <h1 className="serif-title text-5xl leading-[0.96] text-[var(--sage-deep)] sm:text-6xl">
            Choose someone.
          </h1>
          <p className="meta-quiet mx-auto mt-4 max-w-xl text-base leading-7">
            Speak live, or leave a quieter note.
          </p>
        </section>

        <section className="grid gap-4 pb-6 md:grid-cols-2 xl:grid-cols-3">
          {personas.map((persona) => (
            <PersonaCard key={persona.id} persona={persona} />
          ))}
          <Link
            href="/create"
            className="group soft-panel flex min-h-[220px] flex-col justify-between rounded-[36px] p-6 transition-transform hover:-translate-y-1"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-[rgba(223,228,209,0.88)] text-[var(--sage-deep)]">
              <Plus className="h-7 w-7" />
            </div>
            <div>
              <p className="eyebrow">Create</p>
              <h2 className="serif-title mt-3 text-4xl text-[var(--sage-deep)]">
                Add someone new.
              </h2>
            </div>
          </Link>
        </section>

        <footer className="meta-quiet mx-auto mt-8 pb-4 text-center">
          Built from voice, memory, and relationship history.
        </footer>
      </main>
    </div>
  );
}
