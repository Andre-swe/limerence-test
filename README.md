# Limerence

Limerence is a call-first personal-memory persona product. It lets someone create an AI persona with personality, memory, and voice — then talk to that persona live and continue the relationship asynchronously through messages, voice notes, and image sharing.

## ✨ What It Is

Limerence is organized around **two user-facing scenes**:

- **Call**: a quiet live surface for synchronous presence
- **Messages**: a single async thread for text, voice notes, and user-shared images

Inside **Call**, a session can start in one of three modes:

- `voice`
- `screen`
- `camera`

All three use **Hume EVI** for the actual live voice experience. Screen and camera modes add a separate visual-perception loop so the soul can absorb context without turning the call into a visible transcript.

## 🧠 Core Ideas

Limerence is built around three layered ideas:

- **Hume is the live voice layer**  
  Hume EVI handles low-latency live speech, turn-taking, interruption, and expressive voice output.

- **Gemini is the reasoning and perception sidecar**  
  Gemini is the default structured reasoning provider for text-side behavior, user-state inference, and visual observations when images or live visual frames are involved.

  The provider layer uses direct API calls with timeout protection and structured failure logging.

- **The OpenSouls-inspired kernel is the mind**  
  The local soul runtime carries personality constitution, relationship memory, user state, active mental process, open loops, and scheduled internal events between interactions.

The point of the architecture is to keep:

- stable personality
- relationship-specific memory
- momentary user state
- active process
- channel rendering

separate from each other, so the same soul can behave consistently across calls and messages.

## 🗂️ Project Structure

These are the folders that matter most:

- [`app/`](app)  
  Next.js App Router pages and API routes.

- [`components/`](components)  
  UI surfaces for the call scene, messages scene, persona creation, and shared controls.

- [`lib/`](lib)  
  The product’s runtime core: orchestration, providers, Hume session setup, soul kernel, persistence, types, and helpers.

- [`data/`](data)  
  File-backed demo persistence, including the seeded local store.

- [`public/uploads/`](public/uploads)  
  Uploaded voice samples, generated reply audio, and user-shared image assets during local development.

- [`worker/`](worker)
  Small Node entrypoints for running due heartbeats.

- [`tests/`](tests)  
  Vitest coverage for persona workflows, soul behavior, live session building, and multimodal flows.

- [`supabase/`](supabase)
  Supabase schema, migrations, and configuration for the shared runtime store.

- [`vendor/opensouls-main/`](vendor/opensouls-main)  
  Vendored reference material. This repo is **not** used as a runtime dependency; it is kept here for architecture study and future cross-checking.

## 🔮 Future

- **Live video calls** — FaceTime-style face-to-face conversations with real-time avatar generation. Breakthroughs in real-time face synthesis (ByteDance, etc.) are making this viable. The persona would have a face, expressions, and visual presence during live calls — not just a voice.
- **Persona initiative** — personas reaching out on their own with texts, memes, images, and voice notes based on their internal emotional state
- **Phased Supabase normalization** — per-table storage for messages, claims, and episodes
- **Voice creation mode split** — source-material cloning vs text-designed synthetic voices

## 🔐 Authentication

Limerence uses **Supabase Auth** for user authentication. Each user owns their own personas — no more shared "user-demo" accounts.

### Auth Features

- **Email + Password** sign-up and sign-in
- **Magic Link** passwordless authentication
- **Session management** via secure HTTP-only cookies
- **Persona ownership** — users can only access personas they created

### Auth Flow

1. Unauthenticated users are redirected to `/login`
2. Users can sign up with email+password or request a magic link
3. After authentication, users are redirected to the home page
4. The home page shows only personas owned by the logged-in user
5. All `/api/personas/*` routes verify ownership before allowing access

### Auth Files

- [`app/login/page.tsx`](app/login/page.tsx) — Login/signup UI with email+password and magic link options
- [`app/auth/callback/route.ts`](app/auth/callback/route.ts) — OAuth/magic link callback handler
- [`app/api/auth/sign-up/route.ts`](app/api/auth/sign-up/route.ts) — Sign up endpoint
- [`app/api/auth/sign-in/route.ts`](app/api/auth/sign-in/route.ts) — Sign in endpoint
- [`app/api/auth/sign-out/route.ts`](app/api/auth/sign-out/route.ts) — Sign out endpoint
- [`app/api/auth/magic-link/route.ts`](app/api/auth/magic-link/route.ts) — Magic link endpoint
- [`lib/auth.ts`](lib/auth.ts) — Auth helpers for verifying persona ownership
- [`lib/supabase-browser.ts`](lib/supabase-browser.ts) — Browser Supabase client
- [`lib/supabase-server.ts`](lib/supabase-server.ts) — Server Supabase client
- [`middleware.ts`](middleware.ts) — Auth middleware for page and API protection

### Required Environment Variables for Auth

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

Find these in your Supabase dashboard under **Settings → API**:

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Persona Ownership

Every persona has a `userId` field that links it to its creator. The middleware:

1. Validates the user's session via Supabase Auth
2. Passes the `user.id` to API routes via the `x-user-id` header
3. Each persona route calls `verifyPersonaOwnership()` to confirm the user owns the persona
4. Returns **401** if not authenticated, **403** if not the owner, **404** if persona not found

## 🚀 Getting Started

### 1. Install dependencies

This repo currently uses **npm** as the package manager of record because it ships with [`package-lock.json`](package-lock.json).

```bash
npm install
```

### 2. Useful local tools

These are helpful for development, but not all of them are fully wired into the product yet:

- `ffmpeg` for audio inspection and cleanup
- `cloudflared` for exposing local webhook endpoints
- `uv` for lightweight Python scripts and experiments

### 3. Start the app

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

### 4. Useful project commands

```bash
npm run dev
npm run build
npm run lint
npm run verify
npm run test
npm run check:supabase
npm run worker:heartbeat
```

For a fast architectural/debugging map, see [`docs/repo-overpass.md`](docs/repo-overpass.md).

### 5. Runtime data

Limerence now supports two persistence modes:

- **Shared Supabase runtime**  
  When `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured, the app uses a shared runtime-store row in Supabase plus Supabase Storage for uploaded files.
- **Local file fallback**  
  Without Supabase runtime configuration, personas, messages, observations, and feedback live in [`data/demo-store.json`](data/demo-store.json), and uploads are written to [`public/uploads/`](public/uploads).

For tests, the seed store is reset programmatically through [`resetStoreForTests()`](lib/store.ts), and the test environment stays on the local file store even if Supabase env vars exist locally.

### 6. Shared Supabase setup

If you want two developers to share the same personas, messages, soul state, and uploads:

1. Create a Supabase project.
2. Prefer the CLI path:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
npm run supabase:push
```

If you do not want to use the CLI, run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor instead. The same schema also lives in the migration file at [`supabase/migrations/20260313150000_initial_runtime_store.sql`](supabase/migrations/20260313150000_initial_runtime_store.sql). 3. Copy [`.env.example`](.env.example) to `.env.local`. 4. Fill in at minimum:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (recommended to keep aligned with the project, even though the current runtime is server-driven)
- `SUPABASE_RUNTIME_STORE_KEY`

5. Make sure both developers use the **same**:
   - Supabase project
   - `SUPABASE_RUNTIME_STORE_KEY`
   - `SUPABASE_STORAGE_BUCKET` if you override the default
6. Run:

```bash
npm run check:supabase
```

Expected result:

- the bucket should exist
- the runtime row may be missing before first app boot

On first write, Limerence seeds the shared runtime row automatically.

If `supabase` is installed but this shell says `command not found`, restart the terminal or make sure the CLI binary is on your `PATH` before running `npm run supabase:push`.

## 🔐 Environment Variables

All integrations degrade toward local fallbacks when possible. Missing variables do **not** necessarily break the app, but they do reduce capability.

### 🔑 Hume live/session configuration

- `HUME_API_KEY`  
  Enables Hume REST voice features such as stored playback synthesis and Hume-backed starting voices.

- `HUME_SECRET_KEY`  
  Used with `HUME_API_KEY` to fetch a live EVI access token if you are not supplying one directly.

- `HUME_ACCESS_TOKEN`  
  Optional reusable token for live calls. If present, Limerence uses it instead of fetching one with `HUME_API_KEY` + `HUME_SECRET_KEY`.

- `HUME_EVI_HOST`  
  Optional override for the Hume EVI host. Defaults to `api.hume.ai`.

- `HUME_DEFAULT_VOICE_ID`  
  Optional default voice or character ID used when a persona does not already have a Hume voice attached.

- `HUME_VOICE_PROVIDER`  
  Optional override for Hume TTS voice provider selection. Used by stored playback synthesis.

- `HUME_API_BASE_URL`  
  Optional override for Hume’s REST base URL for TTS/file synthesis calls.

For live Hume calls, the app needs either:

- `HUME_ACCESS_TOKEN`
- or `HUME_API_KEY` + `HUME_SECRET_KEY`

### 🧠 Optional reasoning providers

Reasoning provider precedence is:

1. `GEMINI_API_KEY`
2. `ANTHROPIC_API_KEY`
3. `OPENAI_API_KEY`
4. mock fallback

Variables:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

If none are set, the app still works using the local mock reasoning path and the soul runtime.

### 🎧 Optional transcription

- `DEEPGRAM_API_KEY`  
  Enables Deepgram transcription for uploaded voice notes and audio files. Without it, transcription falls back to a mock text description.

### 📦 Shared storage / Supabase

These enable the shared runtime so multiple collaborators can point at the same personas, messages, observations, and uploaded media:

- `NEXT_PUBLIC_SUPABASE_URL`  
  **Required for auth.** The Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`  
  **Required for auth.** The anon/public key from Supabase dashboard.
- `SUPABASE_SERVICE_ROLE_KEY`  
  Required for server-side runtime store operations.
- `SUPABASE_RUNTIME_STORE_TABLE`  
  Optional override. Defaults to `runtime_store`.
- `SUPABASE_RUNTIME_STORE_KEY`  
  Optional shared workspace key. Defaults to `default`.
- `SUPABASE_STORAGE_BUCKET`  
  Optional override for the shared upload bucket. Defaults to `limerence-uploads`.

When the required server variables are present, [`lib/store.ts`](lib/store.ts) switches from the local JSON store to the Supabase-backed runtime store and writes uploads to Supabase Storage.

### 📈 Optional observability / background tooling

- `SENTRY_DSN`
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`

`INNGEST_EVENT_KEY` enables the near-term background execution path for live shadow cognition and internal scheduled events. If it is omitted, the repo falls back to local polling-based execution in development. `SENTRY_DSN` remains optional and is not yet fully wired end to end.

### 🧰 Local prototype overrides

- `PERSONA_STORE_FILE`  
  Overrides the default file-backed store location. If omitted, Limerence uses `data/demo-store.json`.

- `PERSONA_UPLOAD_DIR`  
  Overrides where uploaded/generated local assets are written. If omitted, Limerence uses `public/uploads`.

### Example `.env.local`

```bash
# Hume
HUME_API_KEY=your-hume-api-key
HUME_SECRET_KEY=your-hume-secret
HUME_ACCESS_TOKEN=
HUME_EVI_HOST=
HUME_DEFAULT_VOICE_ID=
HUME_VOICE_PROVIDER=
HUME_API_BASE_URL=

# Reasoning
GEMINI_API_KEY=
GEMINI_MODEL=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
OPENAI_API_KEY=
OPENAI_MODEL=

# Transcription
DEEPGRAM_API_KEY=

# Supabase (required for auth)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Future observability / background hooks
SENTRY_DSN=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# Local prototype overrides
PERSONA_STORE_FILE=
PERSONA_UPLOAD_DIR=
SUPABASE_RUNTIME_STORE_TABLE=
SUPABASE_RUNTIME_STORE_KEY=
SUPABASE_STORAGE_BUCKET=
```

## 🎙️ Voice + Live Session Architecture

### Live calls

Live session bootstrap is built in [`lib/hume-evi.ts`](lib/hume-evi.ts).

At session start, Limerence:

1. loads the persona’s messages and feedback
2. builds a soul snapshot from current memory/process state
3. generates a Hume system prompt and persistent context
4. creates a Hume live session payload with:
   - a custom session id
   - context text
   - system prompt
   - soul metadata
   - the current live mode (`voice`, `screen`, or `camera`)

The live UI is rendered by [`components/conversation-panel.tsx`](components/conversation-panel.tsx).

### Stored playback

Stored reply playback is handled through the voice provider layer in [`lib/providers.ts`](lib/providers.ts).

- If Hume is configured and a usable voice ID exists, stored assistant audio can be synthesized and written to `public/uploads`
- If not, the app falls back to a non-audio mock path

There is **no browser TTS fallback** for ready voices.

### Voice shaping status

⚠️ **Current status:** self-serve custom voice shaping is still a mock path in the product.

What is real today:

- recording samples in the create flow
- uploading voice material
- attaching that material to a persona
- using existing Hume voice/character IDs directly
- using starting house voices

What is not yet self-serve in this repo:

- end-user in-app Hume clone creation from raw uploaded samples

## 🧠 Soul Runtime / Memory Architecture

The soul runtime lives primarily in:

- [`lib/services.ts`](lib/services.ts)
- [`lib/soul-kernel.ts`](lib/soul-kernel.ts)
- [`lib/mind-runtime.ts`](lib/mind-runtime.ts)
- [`lib/soul-harness.ts`](lib/soul-harness.ts)
- [`lib/soul-runtime.ts`](lib/soul-runtime.ts)

### Runtime layers

- **UI layer**  
  Next.js pages and components in [`app/`](app) and [`components/`](components).

- **Service layer**
  [`lib/services.ts`](lib/services.ts) is the orchestration entrypoint for persona creation, messages, live transcript persistence, visual observations, feedback, and heartbeat runs.

- **Provider layer**  
  [`lib/providers.ts`](lib/providers.ts) chooses reasoning, transcription, and voice adapters based on configured env vars.

- **Live voice layer**  
  [`lib/hume-evi.ts`](lib/hume-evi.ts) builds Hume session payloads from soul state.

- **Soul layer**  
  [`lib/soul-kernel.ts`](lib/soul-kernel.ts), [`lib/mind-runtime.ts`](lib/mind-runtime.ts), [`lib/soul-harness.ts`](lib/soul-harness.ts), and [`lib/soul-runtime.ts`](lib/soul-runtime.ts) decide what the persona is carrying and how it should respond.

- **Persistence layer**  
  [`lib/store.ts`](lib/store.ts) now uses a shared Supabase runtime store when configured and falls back to [`data/demo-store.json`](data/demo-store.json) locally. [`supabase/schema.sql`](supabase/schema.sql) includes the runtime store table and shared uploads bucket setup.

### What the soul tracks

The runtime models:

- personality constitution
- relationship model
- user-state snapshots
- working memory
- episodic / relationship / boundary / repair / ritual memory
- open loops
- scheduled internal perceptions
- active mental process

### Process families

The kernel currently includes explicit process definitions such as:

- `arrival`
- `attunement`
- `comfort`
- `celebration`
- `play`
- `memory_recall`
- `repair`
- `boundary_negotiation`
- `follow_through`
- `silence_holding`
- `grief_presence`
- `practical_guidance`
- `reengagement`
- `protective_check_in`

### End-to-end flow

At a high level, the runtime behaves like this:

1. **Perception enters**  
   A text message, live transcript turn, shared image, or live visual observation reaches [`lib/services.ts`](lib/services.ts).

2. **User state is inferred**  
   The provider layer or heuristic layer produces a `UserStateSnapshot`.

3. **Soul state is rebuilt**  
   The mind runtime updates working memory, recent user states, open loops, and memory regions.

4. **Harness context is generated**  
   The soul harness turns the current mind into session-ready context, system prompt material, and process framing.

5. **Reply or follow-through is decided**  
   Text replies, voice-note decisions, and heartbeat decisions all use the soul state rather than acting as stateless completions.

This is the main architectural idea behind Limerence: the soul is the continuity layer across all channels.

## 🖼️ Multimodal Perception

Limerence now supports **visual sidecar perception** in two places:

- explicit user-shared images in **Messages**
- passive visual input during **screen** or **camera** live calls

### Call-side perception

During `screen` or `camera` sessions:

- the browser captures compressed frames
- those frames are posted to [`/api/personas/[personaId]/live/perception`](app/api/personas/%5BpersonaId%5D/live/perception/route.ts)
- the reasoning provider turns them into **distilled observations**
- those observations update soul state and live context

Important behavior:

- Hume remains the actual live voice runtime
- Gemini is the perception sidecar
- passive observations are **not shown** in the visible message thread
- raw live frames are **not persisted**
- only derived observations and memory effects are stored

### Message-side perception

When a user explicitly sends images in Messages:

- the image asset itself is stored and visible in the thread
- a derived observation is also generated for the soul
- later replies can be grounded in what was shared

This lets async messaging carry visual context forward without turning the product into a visible “analysis log.”

## 💬 Messages, Voice Notes, and Media

The async thread is rendered by [`components/messages-panel.tsx`](components/messages-panel.tsx).

Messages can currently include:

- text
- uploaded voice notes
- user-shared images
- assistant text replies
- assistant voice-note replies

Visible thread behavior:

- explicit user media stays visible
- live-call transcript content does **not** reappear there
- system messages are hidden from the user-facing thread

This is the main separation in the product:

- **Call** is for live presence
- **Messages** is for asynchronous continuity

## 🧭 Product Surfaces

### Pages

- [`/`](app/page.tsx)  
  Home screen for choosing a persona or creating a new one.

- [`/create`](app/create/page.tsx)  
  Persona creation flow with identity, memory, voice material, and safety attestation.

- [`/personas/[personaId]`](app/personas/%5BpersonaId%5D/page.tsx)  
  Call scene.

- [`/personas/[personaId]/messages`](app/personas/%5BpersonaId%5D/messages/page.tsx)  
  Async messages scene.

- [`/review`](app/review/page.tsx)  
  Legacy route that redirects back home.

- [`/settings`](app/settings/page.tsx)  
  “How it works” and prototype notes.

### API routes

- [`POST /api/auth/sign-up`](app/api/auth/sign-up/route.ts)  
  Create a new user account.

- [`POST /api/auth/sign-in`](app/api/auth/sign-in/route.ts)  
  Sign in with email and password.

- [`POST /api/auth/sign-out`](app/api/auth/sign-out/route.ts)  
  Sign out the current user.

- [`POST /api/auth/magic-link`](app/api/auth/magic-link/route.ts)  
  Send a magic link for passwordless sign-in.

- [`POST /api/personas`](app/api/personas/route.ts)  
  Create a persona from form data. Requires authentication.

- [`POST /api/personas/[personaId]/feedback`](app/api/personas/%5BpersonaId%5D/feedback/route.ts)  
  Save message-level feedback.

- [`POST /api/personas/[personaId]/heartbeat`](app/api/personas/%5BpersonaId%5D/heartbeat/route.ts)  
  Run one heartbeat decision manually.

- [`GET/POST /api/personas/[personaId]/live`](app/api/personas/%5BpersonaId%5D/live/route.ts)  
  Bootstrap a live Hume session.

- [`POST /api/personas/[personaId]/live/messages`](app/api/personas/%5BpersonaId%5D/live/messages/route.ts)  
  Persist live transcript turns for soul learning.

- [`POST /api/personas/[personaId]/live/perception`](app/api/personas/%5BpersonaId%5D/live/perception/route.ts)  
  Process screen/camera visual observations.

- [`POST /api/personas/[personaId]/messages`](app/api/personas/%5BpersonaId%5D/messages/route.ts)  
  Send text, voice-note, and image-based async messages.

- [`POST /api/personas/[personaId]/messages/[messageId]/audio`](app/api/personas/%5BpersonaId%5D/messages/%5BmessageId%5D/audio/route.ts)  
  Synthesize stored assistant audio for a message.

## 🧪 Testing

The test suite lives in [`tests/persona-workflows.test.ts`](tests/persona-workflows.test.ts).

It currently covers:

- persona creation
- preference learning
- heartbeat behavior
- live transcript state updates
- OpenSouls-style soul frame generation
- personality differentiation across constitutions
- multimodal image and live visual perception flows
- Hume live session construction

Run the suite with:

```bash
npm run test
```

Recommended local checks before sharing changes:

```bash
npm run lint
npm run test
npm run build
```

## 🛠️ How To Work In This Repo

If you are onboarding into the codebase, these are the quickest anchors:

- start at [`app/page.tsx`](app/page.tsx) for the top-level product feel
- look at [`components/conversation-panel.tsx`](components/conversation-panel.tsx) for the live call surface
- look at [`components/messages-panel.tsx`](components/messages-panel.tsx) for the async thread
- use [`lib/services.ts`](lib/services.ts) as the orchestration entrypoint
- follow live voice setup through [`lib/hume-evi.ts`](lib/hume-evi.ts)
- follow soul logic through the `lib/soul-*` and `lib/mind-runtime.ts` files
- use [`lib/store.ts`](lib/store.ts) to understand local persistence and test resets

Worker entrypoints:

- [`worker/heartbeat.ts`](worker/heartbeat.ts)

Target production schema:

- [`supabase/schema.sql`](supabase/schema.sql)

## Production Architecture

Limerance is built around one principle: **persona minds are persistent processes, not request-response artifacts.** The web and mobile UIs are connection layers into something that's already running.

### System topology

```
[Browser / Mobile App]
        │
        ▼
[Vercel — Web Layer]              Auth, SSR, static assets, thin API proxy
        │  REST + SSE
        ▼
[Mind Server (Kubernetes)]        Persona processes, heartbeat loops, soul turns
        │
   ┌────┼────────────┐
   ▼    ▼            ▼
[Supabase]  [Redis]  [LLM Providers]
Persistence  State    Reasoning
             Pub/Sub
```

Hume EVI connects directly from the browser for live voice. The mind server provisions sessions and pushes context updates via SSE.

### Process model

Each persona runs as a `PersonaProcess` — a long-lived async class instance on the Node event loop, managed by a `PersonaSupervisor`.

- **Boot**: Load persona + messages from Supabase into memory. Start heartbeat timer. Resume pending internal events.
- **Heartbeat loop**: Each process runs its own timer chain. Interval is dynamically computed by the circadian scheduling system. No external cron.
- **Internal events**: Awakenings, open-loop follow-ups, and shadow turns execute via in-process `setTimeout` — zero-latency, no external job queue.
- **Sleep/wake**: Idle personas checkpoint to Supabase and release memory. Wake on incoming message or heartbeat due.
- **Crash recovery**: Supervisor detects dead processes and reboots from last persisted state.

Lifecycle: `booting → running → sleeping → (wake) → running`

### State management

**In-memory primary, write-behind to Supabase.**

- `mindState` lives in memory. Flushed to Supabase every ~5s when dirty, plus immediately on SIGTERM.
- Messages are written to Supabase immediately — users need to see them in the UI.
- Single-writer guarantee: the mind server is the only writer for persona cognitive state. The web layer sends commands (messages, feedback), never writes mindState directly.
- Crash data loss window: ≤5s of cognitive state. Messages are never lost.

### Communication

| Channel | Protocol | Purpose |
|---------|----------|---------|
| Commands | REST | Send message, give feedback, start live session |
| Real-time updates | SSE | New messages, heartbeat output, soul process transitions, live context |
| Live voice | WebSocket (Hume direct) | Browser ↔ Hume EVI, mind server provisions and pushes context via SSE |

SSE replaces the current 3-second polling. Web layer API routes become thin auth-check proxies to the mind server.

### Infrastructure stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Orchestration | **Kubernetes (AWS EKS or GCP GKE)** | Auto-scaling, rolling deploys, pod-per-persona partitioning, self-healing |
| Real-time state | **Redis (ElastiCache / Memorystore)** | Shared state across pods, pub/sub for SSE fan-out, survives pod restarts |
| Persistence | **Supabase (PostgreSQL)** | Durable store for personas, messages, observations. Migrate to Aurora if outgrown. |
| Auth | **Supabase Auth** | User authentication, session management, JWT validation |
| CDN / Edge | **CloudFront or Cloud CDN + Vercel** | Global latency for static assets + API edge caching |
| Observability | **Datadog or Grafana Cloud** | APM, distributed tracing, structured logging, alerting, dashboards |
| CI/CD | **GitHub Actions + ArgoCD** | GitOps deploys to Kubernetes |
| Secrets | **AWS Secrets Manager / GCP Secret Manager** | Rotation, audit trails, IAM-scoped access |
| HTTP framework | **Fastify** | Mind server API — fast, TypeScript-native, mature plugin ecosystem |

### Scaling path

| Phase | Model | Capacity |
|-------|-------|----------|
| Launch | Single pod, all personas | ~1K personas with sleep/wake (~500MB) |
| Growth | Partitioned by personaId across N pods | ~10K+ personas |
| Scale | Actor model with coordinator, pod autoscaling | Tens of thousands |

### Failure modes

| Failure | Impact | Recovery |
|---------|--------|----------|
| Pod crash | ≤5s mindState loss | Kubernetes auto-restart, reboot from Supabase |
| Memory pressure | Aggressive sleep of idle personas | Eviction by oldest `lastActiveAt` |
| LLM outage | Circuit breaker pauses heartbeats | Retry after 5 min backoff |
| Supabase down | Reads fine (in-memory), writes queued | Exponential backoff, local queue |
| Network partition | SSE drops, clients auto-reconnect | Mind server continues autonomously |

### Observability

- **Structured logging**: Every soul turn, heartbeat, and internal event logs with `personaId`, `process`, `durationMs`, and `provider` via pino.
- **Metrics** (Prometheus): `personas_active`, `personas_sleeping`, `soul_turn_duration_ms`, `flush_lag_ms`, `sse_connections`, `llm_call_duration_ms`, `memory_rss_bytes`.
- **Health endpoint**: `/health` returns persona counts, memory usage, flush status, last heartbeat run.
- **Admin endpoint**: `/admin/personas` returns per-persona lifecycle state, next heartbeat, active connections, flush lag.

### Zero-downtime deploys

1. SIGTERM → flush all dirty state to Supabase, complete in-flight LLM calls (30s timeout).
2. Drain SSE connections (clients auto-reconnect to new pod).
3. New pod boots personas on-demand — first request triggers load from Supabase.
4. Kubernetes rolling deploy ensures old pod drains before termination.

### Migration phases

| Phase | Scope | Key outcome |
|-------|-------|-------------|
| **0 — Prep** | Extract `PersonaProcess` class from existing code. All current tests pass. | Clean abstraction boundary |
| **1 — MVP** | Kubernetes pod running heartbeats + internal events via in-process timers. Web layer still handles messages directly. | Autonomous persona behavior without cron |
| **2 — Messages** | Move `sendPersonaMessage` to mind server. Web layer becomes proxy. Add SSE. | Real-time delivery, no polling |
| **3 — Live** | Move live session management to mind server. Shadow turns in-process. | Full cognitive pipeline on mind server |
| **4 — Cleanup** | Remove Inngest, cron endpoint, local fallback queues. Vercel is pure web layer. | Clean separation of concerns |
| **5 — Ops** | Datadog integration, admin dashboard, load testing, autoscaling policies. | Production readiness |

### Key insight

The soul engine (`executeSoulTurn`) is already stateless and parameterized — it takes a persona and perception and returns a result. It doesn't care whether it runs in a serverless function or a persistent process. The migration is about **where and when** the engine is called, not rewriting the engine.

## Product Direction

Limerence should evolve from **someone you can talk to** into **a presence that notices, remembers, and occasionally does meaningful things.**

- Personas should develop **needs, rhythms, and initiative** — not act as passive endpoints for user input.
- Proactive behavior should include **personality-aligned actions**: images, songs, voice notes, reminders, curated recommendations, or saved carts for user approval.
- Proactive actions should be grounded in confirmed memory claims, relationship rituals, open loops, and user-authorized action policies.
- Personas may eventually have a **social mode** — user-consented personas interacting asynchronously through direct threads, small groups, or shared boards. If built, it must remain opt-in, consent-bounded, personality-consistent, and auditable through the same memory and trace systems.

## Notes for Collaborators

- Treat the soul runtime as the continuity layer of the product. The voice model can change; the mind architecture should remain coherent.
- Keep the OpenSouls repo vendored as reference material unless there is a deliberate decision to adopt runtime pieces from it.
- Keep the README honest. If a dependency is installed but not truly wired, say so.
