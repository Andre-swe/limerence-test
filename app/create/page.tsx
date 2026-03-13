import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/logo-mark";
import { CreatePersonaForm } from "@/components/create-persona-form";

export const dynamic = "force-dynamic";

export default function CreatePersonaPage() {
  return (
    <div className="app-shell min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <main className="mx-auto max-w-5xl space-y-6">
        <header className="paper-panel rounded-[34px] px-6 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-4 text-center sm:text-left">
              <LogoMark />
              <div>
                <div className="inline-flex items-center rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.72)] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--sage)]">
                  Voice shaping preview
                </div>
                <p className="eyebrow mt-4">Create</p>
                <h1 className="serif-title mt-2 text-5xl text-[var(--sage-deep)] sm:text-6xl">
                  Add someone gently.
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-[rgba(29,38,34,0.62)]">
                  Start with presence, memory, and a starting voice. The custom clone path is kept
                  honest here: recordings are saved now, shaping comes later.
                </p>
              </div>
            </div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 self-start rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.72)] px-4 py-2 text-sm font-medium text-[var(--sage-deep)]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back home
            </Link>
          </div>
        </header>

        <CreatePersonaForm />
      </main>
    </div>
  );
}
