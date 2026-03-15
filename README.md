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

- [`app/`](/Users/syekel/Documents/limerance/app)  
  Next.js App Router pages and API routes.

- [`components/`](/Users/syekel/Documents/limerance/components)  
  UI surfaces for the call scene, messages scene, persona creation, and shared controls.

- [`lib/`](/Users/syekel/Documents/limerance/lib)  
  The product’s runtime core: orchestration, providers, Hume session setup, soul kernel, persistence, types, and helpers.

- [`data/`](/Users/syekel/Documents/limerance/data)  
  File-backed demo persistence, including the seeded local store.

- [`public/uploads/`](/Users/syekel/Documents/limerance/public/uploads)  
  Uploaded voice samples, generated reply audio, and user-shared image assets during local development.

- [`worker/`](/Users/syekel/Documents/limerance/worker)  
  Small Node entrypoints for running due heartbeats and flushing Telegram messages.

- [`tests/`](/Users/syekel/Documents/limerance/tests)  
  Vitest coverage for persona workflows, soul behavior, live session building, and multimodal flows.

- [`supabase/`](/Users/syekel/Documents/limerance/supabase)
  Supabase schema, migrations, and configuration for the shared runtime store.

- [`vendor/opensouls-main/`](/Users/syekel/Documents/limerance/vendor/opensouls-main)  
  Vendored reference material. This repo is **not** used as a runtime dependency; it is kept here for architecture study and future cross-checking.

## 🔮 Future

- **Live video calls** — FaceTime-style face-to-face conversations with real-time avatar generation. Breakthroughs in real-time face synthesis (ByteDance, etc.) are making this viable. The persona would have a face, expressions, and visual presence during live calls — not just a voice.
- **Persona initiative** — personas reaching out on their own with texts, memes, images, and voice notes based on their internal emotional state
- **Phased Supabase normalization** — per-table storage for messages, claims, and episodes
- **Voice creation mode split** — source-material cloning vs text-designed synthetic voices
- **Auth** — Supabase Auth or Clerk before external beta

## 🚀 Getting Started

### 1. Install dependencies

This repo currently uses **npm** as the package manager of record because it ships with [`package-lock.json`](/Users/syekel/Documents/limerance/package-lock.json).

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
npm run test
npm run check:supabase
npm run worker:heartbeat
npm run worker:telegram
```

### 5. Runtime data

Limerence now supports two persistence modes:

- **Shared Supabase runtime**  
  When `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured, the app uses a shared runtime-store row in Supabase plus Supabase Storage for uploaded files.
- **Local file fallback**  
  Without Supabase runtime configuration, personas, messages, observations, and feedback live in [`data/demo-store.json`](/Users/syekel/Documents/limerance/data/demo-store.json), and uploads are written to [`public/uploads/`](/Users/syekel/Documents/limerance/public/uploads).

For tests, the seed store is reset programmatically through [`resetStoreForTests()`](/Users/syekel/Documents/limerance/lib/store.ts), and the test environment stays on the local file store even if Supabase env vars exist locally.

### 6. Shared Supabase setup

If you want two developers to share the same personas, messages, soul state, and uploads:

1. Create a Supabase project.
2. Prefer the CLI path:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
npm run supabase:push
```

If you do not want to use the CLI, run [`supabase/schema.sql`](/Users/syekel/Documents/limerance/supabase/schema.sql) in the Supabase SQL editor instead. The same schema also lives in the migration file at [`supabase/migrations/20260313150000_initial_runtime_store.sql`](/Users/syekel/Documents/limerance/supabase/migrations/20260313150000_initial_runtime_store.sql).
3. Copy [`.env.example`](/Users/syekel/Documents/limerance/.env.example) to `.env.local`.
4. Fill in at minimum:
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
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`  
  Optional for the current server-driven runtime, but still useful to keep aligned with the project’s Supabase environment.
- `SUPABASE_RUNTIME_STORE_TABLE`  
  Optional override. Defaults to `runtime_store`.
- `SUPABASE_RUNTIME_STORE_KEY`  
  Optional shared workspace key. Defaults to `default`.
- `SUPABASE_STORAGE_BUCKET`  
  Optional override for the shared upload bucket. Defaults to `limerence-uploads`.

When the required server variables are present, [`lib/store.ts`](/Users/syekel/Documents/limerance/lib/store.ts) switches from the local JSON store to the Supabase-backed runtime store and writes uploads to Supabase Storage.

### 📲 Optional Telegram

- `TELEGRAM_BOT_TOKEN`  
  Enables Telegram binding, message delivery, and webhook handling.

Telegram is present in the codebase, but it is a **secondary integration**, not the core product experience.

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

# Telegram
TELEGRAM_BOT_TOKEN=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

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

Live session bootstrap is built in [`lib/hume-evi.ts`](/Users/syekel/Documents/limerance/lib/hume-evi.ts).

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

The live UI is rendered by [`components/conversation-panel.tsx`](/Users/syekel/Documents/limerance/components/conversation-panel.tsx).

### Stored playback

Stored reply playback is handled through the voice provider layer in [`lib/providers.ts`](/Users/syekel/Documents/limerance/lib/providers.ts).

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

- [`lib/services.ts`](/Users/syekel/Documents/limerance/lib/services.ts)
- [`lib/soul-kernel.ts`](/Users/syekel/Documents/limerance/lib/soul-kernel.ts)
- [`lib/mind-runtime.ts`](/Users/syekel/Documents/limerance/lib/mind-runtime.ts)
- [`lib/soul-harness.ts`](/Users/syekel/Documents/limerance/lib/soul-harness.ts)
- [`lib/soul-runtime.ts`](/Users/syekel/Documents/limerance/lib/soul-runtime.ts)

### Runtime layers

- **UI layer**  
  Next.js pages and components in [`app/`](/Users/syekel/Documents/limerance/app) and [`components/`](/Users/syekel/Documents/limerance/components).

- **Service layer**  
  [`lib/services.ts`](/Users/syekel/Documents/limerance/lib/services.ts) is the orchestration entrypoint for persona creation, messages, live transcript persistence, visual observations, feedback, heartbeat runs, and Telegram flushing.

- **Provider layer**  
  [`lib/providers.ts`](/Users/syekel/Documents/limerance/lib/providers.ts) chooses reasoning, transcription, and voice adapters based on configured env vars.

- **Live voice layer**  
  [`lib/hume-evi.ts`](/Users/syekel/Documents/limerance/lib/hume-evi.ts) builds Hume session payloads from soul state.

- **Soul layer**  
  [`lib/soul-kernel.ts`](/Users/syekel/Documents/limerance/lib/soul-kernel.ts), [`lib/mind-runtime.ts`](/Users/syekel/Documents/limerance/lib/mind-runtime.ts), [`lib/soul-harness.ts`](/Users/syekel/Documents/limerance/lib/soul-harness.ts), and [`lib/soul-runtime.ts`](/Users/syekel/Documents/limerance/lib/soul-runtime.ts) decide what the persona is carrying and how it should respond.

- **Persistence layer**  
  [`lib/store.ts`](/Users/syekel/Documents/limerance/lib/store.ts) now uses a shared Supabase runtime store when configured and falls back to [`data/demo-store.json`](/Users/syekel/Documents/limerance/data/demo-store.json) locally. [`supabase/schema.sql`](/Users/syekel/Documents/limerance/supabase/schema.sql) includes the runtime store table and shared uploads bucket setup.

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
   A text message, live transcript turn, shared image, or live visual observation reaches [`lib/services.ts`](/Users/syekel/Documents/limerance/lib/services.ts).

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
- those frames are posted to [`/api/personas/[personaId]/live/perception`](/Users/syekel/Documents/limerance/app/api/personas/%5BpersonaId%5D/live/perception/route.ts)
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

The async thread is rendered by [`components/messages-panel.tsx`](/Users/syekel/Documents/limerance/components/messages-panel.tsx).

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

- [`/`](/Users/syekel/Documents/limerance/app/page.tsx)  
  Home screen for choosing a persona or creating a new one.

- [`/create`](/Users/syekel/Documents/limerance/app/create/page.tsx)  
  Persona creation flow with identity, memory, voice material, and safety attestation.

- [`/personas/[personaId]`](/Users/syekel/Documents/limerance/app/personas/%5BpersonaId%5D/page.tsx)  
  Call scene.

- [`/personas/[personaId]/messages`](/Users/syekel/Documents/limerance/app/personas/%5BpersonaId%5D/messages/page.tsx)  
  Async messages scene.

- [`/review`](/Users/syekel/Documents/limerance/app/review/page.tsx)  
  Legacy route that redirects back home.

- [`/settings`](/Users/syekel/Documents/limerance/app/settings/page.tsx)  
  “How it works” and prototype notes.

### API routes

- [`POST /api/personas`](/Users/syekel/Documents/limerance/app/api/personas/route.ts)  
  Create a persona from form data.

- [`POST /api/personas/[personaId]/feedback`](/Users/syekel/Documents/limerance/app/api/personas/%5BpersonaId%5D/feedback/route.ts)  
  Save message-level feedback.

- [`POST /api/personas/[personaId]/heartbeat`](/Users/syekel/Documents/limerance/app/api/personas/%5BpersonaId%5D/heartbeat/route.ts)  
  Run one heartbeat decision manually.

- [`GET/POST /api/personas/[personaId]/live`](/Users/syekel/Documents/limerance/app/api/personas/%5BpersonaId%5D/live/route.ts)  
  Bootstrap a live Hume session.

- [`POST /api/personas/[personaId]/live/messages`](/Users/syekel/Documents/limerance/app/api/personas/%5BpersonaId%5D/live/messages/route.ts)  
  Persist live transcript turns for soul learning.

- [`POST /api/personas/[personaId]/live/perception`](/Users/syekel/Documents/limerance/app/api/personas/%5BpersonaId%5D/live/perception/route.ts)  
  Process screen/camera visual observations.

- [`POST /api/personas/[personaId]/messages`](/Users/syekel/Documents/limerance/app/api/personas/%5BpersonaId%5D/messages/route.ts)  
  Send text, voice-note, and image-based async messages.

- [`POST /api/personas/[personaId]/messages/[messageId]/audio`](/Users/syekel/Documents/limerance/app/api/personas/%5BpersonaId%5D/messages/%5BmessageId%5D/audio/route.ts)  
  Synthesize stored assistant audio for a message.

- [`POST /api/telegram/webhook`](/Users/syekel/Documents/limerance/app/api/telegram/webhook/route.ts)  
  Receive Telegram bot updates.

## 🧪 Testing

The test suite lives in [`tests/persona-workflows.test.ts`](/Users/syekel/Documents/limerance/tests/persona-workflows.test.ts).

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

- start at [`app/page.tsx`](/Users/syekel/Documents/limerance/app/page.tsx) for the top-level product feel
- look at [`components/conversation-panel.tsx`](/Users/syekel/Documents/limerance/components/conversation-panel.tsx) for the live call surface
- look at [`components/messages-panel.tsx`](/Users/syekel/Documents/limerance/components/messages-panel.tsx) for the async thread
- use [`lib/services.ts`](/Users/syekel/Documents/limerance/lib/services.ts) as the orchestration entrypoint
- follow live voice setup through [`lib/hume-evi.ts`](/Users/syekel/Documents/limerance/lib/hume-evi.ts)
- follow soul logic through the `lib/soul-*` and `lib/mind-runtime.ts` files
- use [`lib/store.ts`](/Users/syekel/Documents/limerance/lib/store.ts) to understand local persistence and test resets

Worker entrypoints:

- [`worker/heartbeat.ts`](/Users/syekel/Documents/limerance/worker/heartbeat.ts)
- [`worker/telegram.ts`](/Users/syekel/Documents/limerance/worker/telegram.ts)

Target production schema:

- [`supabase/schema.sql`](/Users/syekel/Documents/limerance/supabase/schema.sql)

## ⚠️ Current Limitations

⚠️ **Voice shaping is still partly mocked**  
Users can leave recordings and attach real voice material, but self-serve Hume clone creation is not available in this build.

⚠️ **Supabase is not the active persistence layer yet**  
The prototype still writes to the local file store and `public/uploads`.

⚠️ **Gemini visual perception is intentionally narrow**  
It currently acts as a sidecar for explicit images and sampled live visual frames. It is not yet a full realtime multimodal conversation engine.

⚠️ **Background execution is near-term, not final-form**  
Live shadow cognition now uses `Inngest` for execution when `INNGEST_EVENT_KEY` is configured, and the connected client still polls for session-frame delivery. If Inngest is not configured, local development falls back to polling-based queue advancement.

⚠️ **Telegram is legacy/secondary in product terms**  
It still works as an integration surface, but the core product direction is web/app call + messages, not chatbots as the primary experience.

## 🛣️ Near-Term Roadmap

Likely next steps for this codebase:

- move from Hume prompt/context bootstrapping toward a fuller Hume CLM bridge
- deepen multimodal soul state so text, voice, and visual context share one richer user-state model
- wire structured Gemini usage more cleanly through the installed AI SDK dependencies
- integrate observability and scheduled-event infrastructure more fully
- migrate from file-backed prototype persistence toward Supabase-backed storage and jobs
- move from `Inngest + polling` to the ideal end-state: independent queue execution with DB-backed or dedicated-worker draining, plus SSE/WebSocket delivery for live context updates

## 🔭 Longer-Term Direction

There is also a longer-term product direction that is intentionally **not** implemented yet, but should shape future architecture decisions:

- personas should develop **needs, rhythms, and initiative**, rather than acting as a passive dumping ground for user input
- proactive behavior should include **tasteful, personality-aligned actions** such as making images, songs, voice notes, reminders, curated gift ideas, or saved carts for user approval
- proactive actions should be grounded in:
  - confirmed memory claims
  - relationship rituals
  - open loops
  - user-authorized action policies
- personas may eventually have a **social mode**, where user-consented personas can interact asynchronously with each other through direct threads, small groups, or shared boards
- if that social mode is built, it should remain:
  - opt-in
  - bounded by user consent
  - personality-consistent
  - auditable through the same memory and trace systems

The guiding idea is that Limerence should evolve from **someone you can talk to** into **a presence that notices, remembers, and occasionally does meaningful things**.

## 💡 Notes For Collaborators

- Keep the README honest. If a dependency is installed but not truly wired, say so.
- Keep the OpenSouls repo vendored as reference material unless there is a deliberate decision to adopt runtime pieces from it.
- Treat the soul runtime as the continuity layer of the product. The voice model can change; the mind architecture is the thing that should remain coherent.
- Near-term live cognition is intentionally split:
  - execution: `Inngest`
  - delivery: polling through `/api/personas/[personaId]/live/context`
  The ideal end-state is queue execution fully independent of any active client, backed by a durable queue or worker, with push delivery instead of polling.
