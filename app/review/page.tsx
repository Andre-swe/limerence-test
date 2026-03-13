import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ApprovePersonaButton } from "@/components/approve-persona-button";
import { LogoMark } from "@/components/logo-mark";
import { listPendingReview } from "@/lib/store";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const pending = await listPendingReview();

  return (
    <div className="app-shell min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <main className="mx-auto max-w-5xl space-y-6">
        <header className="paper-panel rounded-[30px] px-6 py-6 sm:px-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-4">
              <LogoMark />
              <div>
                <p className="eyebrow">Manual review</p>
                <h1 className="serif-title mt-2 text-5xl text-[var(--sage-deep)]">
                  Sensitive persona approvals
                </h1>
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

        <section className="space-y-4">
          {pending.length === 0 ? (
            <div className="paper-panel rounded-[30px] px-6 py-6 text-sm leading-6 text-[rgba(28,37,32,0.72)]">
              No personas are waiting for review.
            </div>
          ) : (
            pending.map((persona) => (
              <article
                key={persona.id}
                className="paper-panel rounded-[30px] px-6 py-6"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <h2 className="serif-title text-3xl text-[var(--sage-deep)]">{persona.name}</h2>
                    <p className="text-sm leading-6 text-[rgba(28,37,32,0.72)]">
                      {persona.description}
                    </p>
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div className="rounded-[18px] bg-[rgba(255,255,255,0.78)] px-4 py-3">
                        <dt className="text-[rgba(28,37,32,0.5)]">Source</dt>
                        <dd className="mt-1 font-medium text-[var(--sage-deep)]">{persona.source}</dd>
                      </div>
                      <div className="rounded-[18px] bg-[rgba(255,255,255,0.78)] px-4 py-3">
                        <dt className="text-[rgba(28,37,32,0.5)]">Submitted</dt>
                        <dd className="mt-1 font-medium text-[var(--sage-deep)]">
                          {formatDateTime(persona.createdAt)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={`/personas/${persona.id}`}
                      className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--sage-deep)]"
                    >
                      Open profile
                    </Link>
                    <ApprovePersonaButton personaId={persona.id} />
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
