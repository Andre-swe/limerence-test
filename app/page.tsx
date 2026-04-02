import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";

const heroMetrics = [
  {
    label: "Channel",
    value: "Real iMessage",
    detail: "Text, reactions, read receipts, typing, voice memos.",
  },
  {
    label: "Product shape",
    value: "Persistent companion",
    detail: "A branded presence that remembers the fan and keeps the thread alive.",
  },
  {
    label: "Business model",
    value: "Recurring membership",
    detail: "Premium monthly companion subscriptions for creator audiences.",
  },
];

const flagshipFormats = [
  {
    eyebrow: "Premium intimacy",
    title: "Romantic companions for creators with parasocial demand",
    audience: "OnlyFans, Instagram, and creator brands built around closeness, fantasy, and attention.",
    pricing: "$100–150/month per subscriber, tuned to creator demand.",
    bullets: [
      "Persistent one-to-one iMessage relationship with memory, callbacks, and creator-specific tone.",
      "Voice memo moments for high-intimacy beats instead of generic text-only automation.",
      "Age-gated, opt-in, disclosed, and creator-configured from day one.",
    ],
    accent:
      "from-[rgba(194,141,122,0.22)] via-[rgba(255,255,255,0.74)] to-[rgba(246,230,225,0.92)]",
  },
  {
    eyebrow: "Consistency at scale",
    title: "Affirmation and accountability companions for self-improvement creators",
    audience: "Coaches, habit builders, wellness creators, and productivity educators.",
    pricing: "$30–40/month per subscriber.",
    bullets: [
      "Daily encouragement, check-ins, routine support, and follow-through across the full week.",
      "Tone locked to the creator: warm coach, direct push, calm encourager, or disciplined mentor.",
      "Structured to feel personal without forcing the creator to personally manage hundreds of threads.",
    ],
    accent:
      "from-[rgba(174,194,160,0.22)] via-[rgba(255,255,255,0.74)] to-[rgba(233,240,224,0.94)]",
  },
];

const operatingModel = [
  {
    step: "01",
    title: "Model the creator properly",
    description:
      "We build the companion around the creator’s tone, boundaries, signature phrases, routines, and voice style instead of shipping a generic assistant.",
  },
  {
    step: "02",
    title: "Launch a paid fan offer",
    description:
      "Fans opt into a premium iMessage membership that promises closeness, continuity, and a real-feeling thread rather than sporadic broadcasts.",
  },
  {
    step: "03",
    title: "Run the relationship layer",
    description:
      "Limerence handles memory, timing, follow-ups, voice memo moments, and creator-safe operating rules across the entire conversation lifecycle.",
  },
  {
    step: "04",
    title: "Keep the creator in control",
    description:
      "We keep guardrails, review flows, and offer tuning in an operator layer so the creator decides how intimate, direct, or structured the experience should be.",
  },
];

const promisePoints = [
  "Not broadcast SMS. Each subscriber gets a persistent thread with memory.",
  "Not a faceless chatbot. Each companion is designed around a specific creator voice.",
  "Not limited to text. Voice notes, timing, and emotional continuity are part of the product.",
  "Not a pure SaaS widget. This is a managed creator-companion agency with product infrastructure underneath it.",
];

const guardrails = [
  "Romantic experiences are age-gated, opt-in, and explicitly disclosed as AI-mediated.",
  "Creator-specific boundaries and forbidden topics are hard-coded into operations, not left to vibes.",
  "We prioritize healthy recurring engagement over fake urgency, manipulative finance claims, or unsafe roleplay sprawl.",
  "Every offer is structured as a branded membership product, not a deceptive impersonation layer.",
];

export default function Home() {
  return (
    <div className="app-shell min-h-screen px-4 py-6 text-[var(--foreground)] sm:px-6 lg:px-10">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 pb-10">
        <section className="paper-panel overflow-hidden rounded-[34px] border border-[var(--border)] px-5 py-5 sm:px-7 lg:px-10 lg:py-8">
          <div className="flex flex-col gap-8">
            <header className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <LogoMark />
              <nav className="flex flex-wrap items-center gap-4 text-sm text-[rgba(29,38,34,0.56)]">
                <a href="#formats" className="link-warm">
                  Formats
                </a>
                <a href="#model" className="link-warm">
                  Model
                </a>
                <a href="#guardrails" className="link-warm">
                  Guardrails
                </a>
                <Link href="/login" className="link-warm">
                  Operator login
                </Link>
              </nav>
            </header>

            <div className="grid gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-stretch">
              <div className="flex flex-col justify-between gap-8">
                <div>
                  <p className="eyebrow">Influencer iMessage Companion Agency</p>
                  <h1 className="serif-title mt-5 max-w-4xl text-[3.05rem] leading-[0.94] tracking-[-0.04em] text-[var(--sage-deep)] sm:text-[4.5rem]">
                    We build persistent iMessage companions for creator brands.
                  </h1>
                  <p className="mt-6 max-w-2xl text-base leading-8 text-[rgba(29,38,34,0.72)] sm:text-lg">
                    Limerence turns creator voice into a 24-hour relationship product: premium
                    romantic companions for intimacy-driven audiences, and affirmation /
                    accountability companions for self-improvement communities. The channel is
                    native iMessage. The product is recurring revenue. The experience is designed
                    to feel continuous, personal, and creator-specific.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href="#formats"
                    className="inline-flex min-h-12 items-center rounded-full bg-[var(--sage-deep)] px-6 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
                  >
                    See the flagship formats
                  </a>
                  <a
                    href="#model"
                    className="inline-flex min-h-12 items-center rounded-full border border-[rgba(29,38,34,0.12)] bg-white/75 px-6 text-sm font-semibold text-[var(--sage-deep)] transition-transform hover:-translate-y-0.5"
                  >
                    How the business works
                  </a>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {heroMetrics.map((metric) => (
                    <article
                      key={metric.label}
                      className="rounded-[24px] border border-[rgba(29,38,34,0.08)] bg-[rgba(255,255,255,0.72)] p-4 shadow-[0_16px_40px_rgba(91,103,94,0.08)]"
                    >
                      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-[var(--sage)]">
                        {metric.label}
                      </p>
                      <p className="mt-3 text-lg font-semibold text-[var(--sage-deep)]">
                        {metric.value}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[rgba(29,38,34,0.62)]">
                        {metric.detail}
                      </p>
                    </article>
                  ))}
                </div>
              </div>

              <section className="relative overflow-hidden rounded-[30px] border border-[rgba(29,38,34,0.08)] bg-[linear-gradient(160deg,rgba(255,255,255,0.88),rgba(245,240,233,0.86))] p-5 shadow-[0_28px_72px_rgba(122,136,128,0.10)]">
                <div className="absolute inset-x-8 top-0 h-32 rounded-full bg-[radial-gradient(circle,rgba(190,160,108,0.18),transparent_68%)] blur-2xl" />
                <div className="relative flex h-full flex-col gap-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="eyebrow">What we actually sell</p>
                      <h2 className="mt-2 text-2xl font-semibold text-[var(--sage-deep)]">
                        A premium relationship layer for creators
                      </h2>
                    </div>
                    <span className="rounded-full border border-[rgba(29,38,34,0.08)] bg-white/80 px-3 py-1 text-xs font-medium text-[var(--sage-deep)]">
                      Managed by Limerence
                    </span>
                  </div>

                  <div className="grid gap-3">
                    <MessageMock
                      role="brand"
                      label="Creator companion"
                      body="good morning. i know you said today matters. want me to stay on you until it’s done?"
                    />
                    <MessageMock
                      role="fan"
                      label="Subscriber"
                      body="yeah. i need that. text me again in an hour if i disappear."
                    />
                    <MessageMock
                      role="brand"
                      label="Creator companion"
                      body="done. no disappearing. i’ll be back in an hour and i’ll remember exactly where we left it."
                    />
                  </div>

                  <div className="grid gap-3 pt-1 sm:grid-cols-2">
                    <MiniOfferCard
                      title="Romance"
                      detail="High-intimacy, premium creator memberships with memory and voice-note moments."
                    />
                    <MiniOfferCard
                      title="Accountability"
                      detail="Daily check-ins, routines, affirmations, and momentum for fans who want structure."
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>
        </section>

        <section
          id="formats"
          className="grid gap-5 rounded-[34px] border border-[var(--border)] bg-[rgba(255,255,255,0.56)] px-5 py-6 shadow-[0_24px_70px_rgba(122,136,128,0.08)] sm:px-7 lg:px-10"
        >
          <div className="max-w-3xl">
            <p className="eyebrow">Flagship Formats</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-[var(--sage-deep)] sm:text-4xl">
              Two offers. Two price points. One underlying product thesis.
            </h2>
            <p className="mt-4 text-base leading-8 text-[rgba(29,38,34,0.66)]">
              We are not trying to be everything for every creator. The first version of the
              company is built around the two clearest recurring-revenue products in companion
              messaging: intimacy and consistency.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {flagshipFormats.map((format) => (
              <article
                key={format.title}
                className={`overflow-hidden rounded-[30px] border border-[rgba(29,38,34,0.08)] bg-gradient-to-br ${format.accent} p-6 shadow-[0_24px_60px_rgba(122,136,128,0.08)]`}
              >
                <p className="eyebrow">{format.eyebrow}</p>
                <h3 className="mt-4 max-w-xl text-2xl font-semibold leading-tight text-[var(--sage-deep)]">
                  {format.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[rgba(29,38,34,0.7)]">
                  {format.audience}
                </p>
                <div className="mt-5 rounded-2xl border border-[rgba(29,38,34,0.08)] bg-white/70 px-4 py-3">
                  <p className="text-[0.7rem] uppercase tracking-[0.18em] text-[var(--sage)]">
                    Membership range
                  </p>
                  <p className="mt-2 text-xl font-semibold text-[var(--sage-deep)]">
                    {format.pricing}
                  </p>
                </div>
                <div className="mt-5 grid gap-3">
                  {format.bullets.map((bullet) => (
                    <div
                      key={bullet}
                      className="rounded-2xl border border-[rgba(29,38,34,0.08)] bg-white/64 px-4 py-3 text-sm leading-7 text-[rgba(29,38,34,0.72)]"
                    >
                      {bullet}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section
          id="model"
          className="grid gap-6 rounded-[34px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(251,250,244,0.94),rgba(246,244,238,0.92))] px-5 py-6 shadow-[0_24px_70px_rgba(122,136,128,0.08)] sm:px-7 lg:px-10"
        >
          <div className="max-w-3xl">
            <p className="eyebrow">Business Model</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-[var(--sage-deep)] sm:text-4xl">
              We run the companion product layer so creators can sell it.
            </h2>
            <p className="mt-4 text-base leading-8 text-[rgba(29,38,34,0.66)]">
              The creator brings demand, identity, and audience trust. Limerence builds the
              productized relationship: the companion persona, the iMessage infrastructure, the
              continuity, the timing, and the operational rules that keep the whole thing coherent.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {operatingModel.map((item) => (
              <article
                key={item.step}
                className="rounded-[28px] border border-[rgba(29,38,34,0.08)] bg-white/76 p-5 shadow-[0_18px_48px_rgba(122,136,128,0.08)]"
              >
                <p className="text-xs font-semibold tracking-[0.24em] text-[var(--sage)]">
                  {item.step}
                </p>
                <h3 className="mt-4 text-lg font-semibold text-[var(--sage-deep)]">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[rgba(29,38,34,0.68)]">
                  {item.description}
                </p>
              </article>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
            <article className="rounded-[30px] border border-[rgba(29,38,34,0.08)] bg-white/74 p-6">
              <p className="eyebrow">Why it lands</p>
              <h3 className="mt-4 text-2xl font-semibold text-[var(--sage-deep)]">
                Fans are not paying for a message. They are paying for continuity.
              </h3>
              <div className="mt-5 grid gap-3">
                {promisePoints.map((point) => (
                  <div
                    key={point}
                    className="rounded-2xl border border-[rgba(29,38,34,0.08)] bg-[rgba(247,244,239,0.78)] px-4 py-3 text-sm leading-7 text-[rgba(29,38,34,0.72)]"
                  >
                    {point}
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-[30px] border border-[rgba(29,38,34,0.08)] bg-[rgba(75,85,67,0.96)] p-6 text-white shadow-[0_24px_60px_rgba(59,68,61,0.26)]">
              <p className="eyebrow text-[rgba(232,235,223,0.72)]">Positioning</p>
              <h3 className="mt-4 text-2xl font-semibold">
                We are not rebuilding social media. We are monetizing the inbox.
              </h3>
              <p className="mt-4 text-sm leading-7 text-[rgba(239,242,233,0.82)]">
                The strongest version of Limerence is an agency-backed product company: we help
                creators launch premium subscription companions inside the most intimate digital
                channel they already understand. iMessage gives the thread legitimacy. Memory gives
                it continuity. Voice gives it presence.
              </p>
              <div className="mt-6 rounded-[24px] border border-white/10 bg-white/8 p-4">
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-[rgba(232,235,223,0.64)]">
                  Short version
                </p>
                <p className="mt-3 text-lg leading-8 text-[rgba(247,248,243,0.94)]">
                  Limerence builds creator-branded iMessage companions that can stay with a fan all
                  day, every day, without collapsing into generic chatbot sludge.
                </p>
              </div>
            </article>
          </div>
        </section>

        <section
          id="guardrails"
          className="grid gap-6 rounded-[34px] border border-[var(--border)] bg-[rgba(255,255,255,0.58)] px-5 py-6 shadow-[0_24px_70px_rgba(122,136,128,0.08)] sm:px-7 lg:px-10"
        >
          <div className="max-w-3xl">
            <p className="eyebrow">Guardrails</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-[var(--sage-deep)] sm:text-4xl">
              The product gets stronger when the rules are explicit.
            </h2>
            <p className="mt-4 text-base leading-8 text-[rgba(29,38,34,0.66)]">
              Especially for romance, the offer only works long term if the boundaries are clear.
              Opt-in, age gating, disclosure, and creator-specific operating constraints are part of
              the business model, not an afterthought.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {guardrails.map((item) => (
              <article
                key={item}
                className="rounded-[26px] border border-[rgba(29,38,34,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.78),rgba(248,246,240,0.82))] p-5 shadow-[0_18px_44px_rgba(122,136,128,0.08)]"
              >
                <p className="text-sm leading-7 text-[rgba(29,38,34,0.72)]">{item}</p>
              </article>
            ))}
          </div>

          <article className="rounded-[30px] border border-[rgba(29,38,34,0.08)] bg-[linear-gradient(140deg,rgba(223,228,209,0.58),rgba(255,255,255,0.8))] p-6">
            <p className="eyebrow">Where we start</p>
            <h3 className="mt-4 text-2xl font-semibold text-[var(--sage-deep)]">
              Two offers first. Everything else later.
            </h3>
            <p className="mt-4 max-w-4xl text-base leading-8 text-[rgba(29,38,34,0.66)]">
              The first version of the company is deliberately narrow: romance for premium
              intimacy-driven audiences, and affirmation / accountability for creator brands built
              around improvement, routine, and self-belief. Those are the clearest products, the
              clearest price anchors, and the fastest route to learning what fans actually pay to
              keep in their inbox.
            </p>
          </article>
        </section>
      </main>
    </div>
  );
}

function MessageMock(input: {
  role: "brand" | "fan";
  label: string;
  body: string;
}) {
  const isBrand = input.role === "brand";

  return (
    <div className={`flex ${isBrand ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[88%] rounded-[24px] px-4 py-3 shadow-[0_12px_28px_rgba(91,103,94,0.08)] ${
          isBrand
            ? "bg-[rgba(238,242,228,0.96)] text-[var(--sage-deep)]"
            : "bg-[rgba(255,255,255,0.94)] text-[rgba(29,38,34,0.82)]"
        }`}
      >
        <p className="text-[0.68rem] uppercase tracking-[0.18em] text-[rgba(75,85,67,0.56)]">
          {input.label}
        </p>
        <p className="mt-2 text-sm leading-7">{input.body}</p>
      </div>
    </div>
  );
}

function MiniOfferCard(input: { title: string; detail: string }) {
  return (
    <article className="rounded-[22px] border border-[rgba(29,38,34,0.08)] bg-white/74 p-4">
      <p className="text-sm font-semibold text-[var(--sage-deep)]">{input.title}</p>
      <p className="mt-2 text-sm leading-6 text-[rgba(29,38,34,0.66)]">{input.detail}</p>
    </article>
  );
}
