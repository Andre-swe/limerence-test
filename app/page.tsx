import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";

const heroMetrics = [
  {
    label: "Channel",
    value: "Native iMessage",
    detail: "Text, read receipts, reactions, typing, and voice memo moments in one thread.",
  },
  {
    label: "Product shape",
    value: "Persistent membership",
    detail: "A creator-branded presence that remembers the fan and keeps continuity alive.",
  },
  {
    label: "Operating model",
    value: "Managed by Limerence",
    detail: "We handle the companion layer, creator tuning, and inbox operations behind the scenes.",
  },
];

const launchFormats = [
  {
    eyebrow: "Closer circles",
    title: "High-touch memberships for creators whose audience pays for presence",
    audience:
      "Subscription creators, personality-led brands, and communities built around closeness, access, and continuity.",
    bullets: [
      "Persistent one-to-one threads with memory, callbacks, and creator-specific tone.",
      "Voice note moments and natural follow-up timing instead of generic automation blasts.",
      "Structured for high-emotion fan relationships without turning the public site into a category label.",
    ],
    accent:
      "from-[rgba(194,141,122,0.22)] via-[rgba(255,255,255,0.74)] to-[rgba(246,230,225,0.92)]",
  },
  {
    eyebrow: "Daily rhythm",
    title: "Support memberships for creators built around consistency and momentum",
    audience:
      "Coaches, wellness creators, habit builders, and educational brands that win by staying present every day.",
    bullets: [
      "Check-ins, encouragement, reminders, and follow-through across the full week.",
      "Tone locked to the creator: calm, direct, warm, disciplined, or lightly pushy.",
      "Designed to feel personal at scale without forcing the creator to manually run hundreds of threads.",
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
    title: "Launch a private membership offer",
    description:
      "Fans opt into an ongoing iMessage experience that promises continuity, direct-feeling support, and a more personal thread than email or broadcast channels.",
  },
  {
    step: "03",
    title: "Run the relationship layer",
    description:
      "Limerence handles memory, timing, follow-ups, voice memo moments, and creator-safe operating rules across the full conversation lifecycle.",
  },
  {
    step: "04",
    title: "Keep the creator in control",
    description:
      "We keep guardrails, review flows, and offer tuning in an operator layer so the creator decides how direct, warm, or structured the experience should be.",
  },
];

const promisePoints = [
  "Not broadcast SMS. Each member gets a persistent thread with memory.",
  "Not a faceless chatbot. Each companion is designed around a specific creator voice.",
  "Not limited to text. Voice notes, timing, and emotional continuity are part of the product.",
  "Not a pure SaaS widget. This is a managed creator-companion agency with product infrastructure underneath it.",
];

const guardrails = [
  "Higher-intimacy programs are age-gated, opt-in, and clearly disclosed as AI-mediated from the start.",
  "Creator-specific boundaries and forbidden topics are enforced operationally, not left to improvisation.",
  "We optimize for durable member retention over manipulative urgency, unsafe roleplay sprawl, or deceptive impersonation.",
  "Commercial structure, audience fit, and program scope are discussed privately with each creator, not published as a menu.",
];

const mockups = [
  {
    contact: "Studio Access",
    subtitle: "Pinned membership thread",
    time: "9:41",
    messages: [
      {
        side: "incoming" as const,
        kind: "text" as const,
        body: "Morning. You said this week is about momentum, not perfection.",
      },
      {
        side: "outgoing" as const,
        kind: "text" as const,
        body: "I know. I already want to skip the workout.",
      },
      {
        side: "incoming" as const,
        kind: "text" as const,
        body: "Ten minutes counts. Start now and send me proof after.",
      },
      {
        side: "incoming" as const,
        kind: "audio" as const,
        label: "Voice note",
        meta: "0:18",
      },
      {
        side: "outgoing" as const,
        kind: "text" as const,
        body: "Deal. Checking back in 20.",
        status: "Read",
      },
    ],
  },
  {
    contact: "Private Circle",
    subtitle: "Quiet-hours access",
    time: "10:07",
    messages: [
      {
        side: "incoming" as const,
        kind: "text" as const,
        body: "You vanished after the livestream.",
      },
      {
        side: "outgoing" as const,
        kind: "text" as const,
        body: "Long day. Needed a minute.",
      },
      {
        side: "incoming" as const,
        kind: "text" as const,
        body: "Then give me five tonight. I kept your place.",
      },
      {
        side: "outgoing" as const,
        kind: "text" as const,
        body: "At 11?",
      },
      {
        side: "incoming" as const,
        kind: "typing" as const,
      },
    ],
  },
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

            <div className="grid gap-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-stretch">
              <div className="flex flex-col justify-between gap-8">
                <div>
                  <p className="eyebrow">Influencer iMessage Companion Agency</p>
                  <h1 className="serif-title mt-5 max-w-4xl text-[3.05rem] leading-[0.94] tracking-[-0.04em] text-[var(--sage-deep)] sm:text-[4.5rem]">
                    We build private iMessage membership products for creator brands.
                  </h1>
                  <p className="mt-6 max-w-2xl text-base leading-8 text-[rgba(29,38,34,0.72)] sm:text-lg">
                    Limerence turns creator voice into a 24-hour relationship layer for audiences
                    that pay for continuity, access, and personal-feeling support. The channel is
                    native iMessage. The experience is designed to feel lived-in, responsive, and
                    creator-specific without making the public site read like a pricing sheet or a
                    category confession.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href="#formats"
                    className="inline-flex min-h-12 items-center rounded-full bg-[var(--sage-deep)] px-6 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
                  >
                    See the launch formats
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
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="eyebrow">What the product looks like</p>
                      <h2 className="mt-2 text-2xl font-semibold text-[var(--sage-deep)]">
                        Real-looking threads, not abstract AI claims
                      </h2>
                    </div>
                    <span className="rounded-full border border-[rgba(29,38,34,0.08)] bg-white/80 px-3 py-1 text-xs font-medium text-[var(--sage-deep)]">
                      Built for pilots
                    </span>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {mockups.map((mockup) => (
                      <PhoneMockup key={mockup.contact} {...mockup} />
                    ))}
                  </div>

                  <div className="grid gap-3 pt-1 sm:grid-cols-3">
                    <SignalCard title="Memory in thread" detail="Callbacks, promises kept, and context that stays intact." />
                    <SignalCard title="Voice note moments" detail="Audio when text alone feels flat or too synthetic." />
                    <SignalCard title="Operator review" detail="Programs stay creator-safe behind the scenes." />
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
            <p className="eyebrow">Launch Formats</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-[var(--sage-deep)] sm:text-4xl">
              Two clear starting shapes. One underlying business thesis.
            </h2>
            <p className="mt-4 text-base leading-8 text-[rgba(29,38,34,0.66)]">
              We are not trying to be everything for every creator. The first version of the
              company is centered on the two clearest recurring companion products in messaging:
              closer-circle access and daily support. The commercials are scoped privately with
              each creator program, not posted as a public menu.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {launchFormats.map((format) => (
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
                    Public framing
                  </p>
                  <p className="mt-2 text-base leading-7 text-[var(--sage-deep)]">
                    The website stays broad. Specific packaging, audience fit, and commercial
                    structure are handled in private conversations.
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
                creators launch paid iMessage membership experiences inside the most intimate
                digital channel they already understand. iMessage gives the thread legitimacy.
                Memory gives it continuity. Voice gives it presence.
              </p>
              <div className="mt-6 rounded-[24px] border border-white/10 bg-white/8 p-4">
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-[rgba(232,235,223,0.64)]">
                  Short version
                </p>
                <p className="mt-3 text-lg leading-8 text-[rgba(247,248,243,0.94)]">
                  Limerence builds creator-branded iMessage companions that can stay with a member
                  all day, every day, without collapsing into generic chatbot sludge.
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
              High-touch messaging products only work long term if the boundaries are clear. Opt-in,
              disclosure, creator-specific operating constraints, and audience fit are part of the
              business model, not an afterthought.
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
              Private membership products first. Everything else later.
            </h3>
            <p className="mt-4 max-w-4xl text-base leading-8 text-[rgba(29,38,34,0.66)]">
              The first version of the company is deliberately narrow: creators whose business
              already benefits from repeat conversation, sustained attention, and personal-feeling
              support. That is the fastest route to learning what fans actually pay to keep in
              their inbox.
            </p>
          </article>
        </section>
      </main>
    </div>
  );
}

type MockMessage =
  | {
      side: "incoming" | "outgoing";
      kind: "text";
      body: string;
      status?: string;
    }
  | {
      side: "incoming" | "outgoing";
      kind: "audio";
      label: string;
      meta: string;
    }
  | {
      side: "incoming" | "outgoing";
      kind: "typing";
    };

function PhoneMockup(input: {
  contact: string;
  subtitle: string;
  time: string;
  messages: MockMessage[];
}) {
  return (
    <article className="rounded-[34px] bg-[linear-gradient(180deg,rgba(25,25,28,0.98),rgba(10,10,12,1))] p-[10px] shadow-[0_26px_60px_rgba(41,41,41,0.24)]">
      <div className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,#eef1f7,#f8f8fb)]">
        <div className="absolute left-1/2 top-2 h-6 w-28 -translate-x-1/2 rounded-full bg-[rgba(12,12,14,0.96)]" />

        <div className="px-4 pb-4 pt-3">
          <div className="flex items-center justify-between px-1 pt-5 text-[0.68rem] font-semibold tracking-[0.08em] text-[rgba(29,38,34,0.78)]">
            <span>{input.time}</span>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[rgba(29,38,34,0.44)]" />
              <span className="h-2 w-2 rounded-full bg-[rgba(29,38,34,0.56)]" />
              <span className="h-2 w-4 rounded-full bg-[rgba(29,38,34,0.72)]" />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3 border-b border-[rgba(29,38,34,0.08)] pb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(180deg,rgba(203,211,223,0.96),rgba(170,184,198,0.96))] text-sm font-semibold text-[rgba(29,38,34,0.82)]">
              {input.contact
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[rgba(29,38,34,0.88)]">
                {input.contact}
              </p>
              <p className="truncate text-[0.72rem] text-[rgba(29,38,34,0.52)]">
                {input.subtitle}
              </p>
            </div>
          </div>

          <div className="flex min-h-[305px] flex-col gap-2.5 px-1 py-4">
            {input.messages.map((message, index) => (
              <MessageBubble key={`${input.contact}-${index}`} message={message} />
            ))}
          </div>

          <div className="rounded-full border border-[rgba(29,38,34,0.08)] bg-white/88 px-4 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
            <div className="flex items-center justify-between gap-3 text-[0.76rem] text-[rgba(29,38,34,0.46)]">
              <span>iMessage</span>
              <div className="flex items-center gap-2">
                <span className="h-7 w-7 rounded-full border border-[rgba(29,38,34,0.08)] bg-[rgba(247,248,251,0.94)]" />
                <span className="h-7 w-7 rounded-full bg-[#0A84FF]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function MessageBubble({ message }: { message: MockMessage }) {
  const isOutgoing = message.side === "outgoing";

  if (message.kind === "typing") {
    return (
      <div className={`flex ${isOutgoing ? "justify-end" : "justify-start"}`}>
        <div className="rounded-[20px] bg-white px-4 py-3 shadow-[0_10px_24px_rgba(61,71,82,0.08)]">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[rgba(105,116,128,0.36)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[rgba(105,116,128,0.52)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[rgba(105,116,128,0.36)]" />
          </div>
        </div>
      </div>
    );
  }

  if (message.kind === "audio") {
    return (
      <div className={`flex ${isOutgoing ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[85%] rounded-[22px] px-4 py-3 shadow-[0_10px_24px_rgba(61,71,82,0.08)] ${
            isOutgoing ? "bg-[#0A84FF] text-white" : "bg-white text-[rgba(29,38,34,0.82)]"
          }`}
        >
          <div className="flex items-center gap-3">
            <span
              className={`h-8 w-8 rounded-full ${
                isOutgoing ? "bg-white/18" : "bg-[rgba(10,132,255,0.12)]"
              }`}
            />
            <div className="flex-1">
              <div
                className={`h-1.5 rounded-full ${
                  isOutgoing ? "bg-white/28" : "bg-[rgba(29,38,34,0.12)]"
                }`}
              />
              <p
                className={`mt-2 text-[0.72rem] ${
                  isOutgoing ? "text-white/78" : "text-[rgba(29,38,34,0.54)]"
                }`}
              >
                {message.label} · {message.meta}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isOutgoing ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%]">
        <div
          className={`rounded-[22px] px-4 py-3 shadow-[0_10px_24px_rgba(61,71,82,0.08)] ${
            isOutgoing ? "bg-[#0A84FF] text-white" : "bg-white text-[rgba(29,38,34,0.82)]"
          }`}
        >
          <p className="text-[0.9rem] leading-6">{message.body}</p>
        </div>
        {message.status ? (
          <p className="mt-1 px-2 text-right text-[0.64rem] font-medium uppercase tracking-[0.12em] text-[rgba(29,38,34,0.38)]">
            {message.status}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SignalCard(input: { title: string; detail: string }) {
  return (
    <article className="rounded-[22px] border border-[rgba(29,38,34,0.08)] bg-white/74 p-4">
      <p className="text-sm font-semibold text-[var(--sage-deep)]">{input.title}</p>
      <p className="mt-2 text-sm leading-6 text-[rgba(29,38,34,0.66)]">{input.detail}</p>
    </article>
  );
}
