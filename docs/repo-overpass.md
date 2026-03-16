# Repo Overpass

## Purpose

This repo is already functionally broad: a Next.js app surface, a local/supabase-backed runtime store, live-call orchestration, scheduled persona behavior, and a Telegram bridge. This document is the fast map for debugging and safe change-making.

## Subsystems

### App Router and UI

- `app/` contains the page shells and API routes.
- `components/` contains the user-facing panels and controls.
- `components/conversation-panel.tsx` is now mostly the live-call shell and rendering surface.
- `components/use-conversation-panel-live.ts` owns live session polling, visual capture lifecycle, and connection cleanup.

### Runtime orchestration

- `lib/services.ts` remains the public orchestration facade used by routes, workers, and workflow tests.
- `lib/services/assets.ts` owns message/file asset construction helpers.
- `lib/services/persona.ts` owns persona assembly from onboarding material.
- `lib/services/messaging.ts` owns stored reply synthesis.
- `lib/services/feedback.ts` owns feedback persistence and memory correction.
- `lib/services/telegram.ts` owns outbound Telegram delivery.
- The remaining `lib/services.ts` body is still the main home for live-session cognition, heartbeats, and cross-cutting orchestration.

### Core cognition and providers

- `lib/soul-engine.ts`, `lib/soul-runtime.ts`, `lib/mind-runtime.ts`, and `lib/memory-v2.ts` hold the cognition pipeline, memory shaping, and scheduled internal-event logic.
- `lib/providers.ts` abstracts reasoning, transcription, and voice backends.
- `lib/store.ts` is the persistence seam across local file mode and shared Supabase runtime mode.

### Background entrypoints

- `worker/heartbeat.ts` and `worker/telegram.ts` are the Node entrypoints for autonomous work.
- `app/api/internal/heartbeat/route.ts` is the cron-style API entrypoint for running both due heartbeats and Telegram delivery.

## Critical Invariants

- `lib/services.ts` is the stable public facade. Routes and workers should keep importing from there even when implementation moves into internal modules.
- Live transcript ingestion must be idempotent by Hume event id. Duplicate events should not produce duplicate stored messages or duplicate learning.
- Hitting the daily heartbeat cap still needs to advance `lastHeartbeatAt` and `nextHeartbeatAt`; otherwise due personas get re-evaluated continuously.
- Unexpected live disconnects must stop any active screen/camera tracks and clear polling/capture intervals.
- Mid-call context updates must only send compact overlay updates; bootstrap session settings remain the source of truth for initial system prompt and voice.

## Debug Entry Points

- UI/live session bugs:
  - `components/conversation-panel.tsx`
  - `components/use-conversation-panel-live.ts`
  - `app/api/personas/[personaId]/live*`
- Runtime/message bugs:
  - `lib/services.ts`
  - `lib/soul-engine.ts`
  - `lib/memory-v2.ts`
- Store/runtime bugs:
  - `lib/store.ts`
  - `lib/supabase.ts`
  - `app/api/health/store/route.ts`
- Autonomous delivery bugs:
  - `lib/services/telegram.ts`
  - `app/api/internal/heartbeat/route.ts`
  - `app/api/telegram/webhook/route.ts`

## Verification Matrix

- `npm run lint`
  - static hygiene for app, services, tests, and scripts
- `npm run typecheck`
  - compile-time safety across App Router, test code, and internal modules
- `npm run test`
  - route tests, workflow tests, UI component tests, page smoke tests, and regression coverage
- `npm run build`
  - production Next.js build validity
- `npm run verify`
  - clean-state repo check: lint, typecheck, tests, and a fresh build

## Recent Hardening Coverage

- `tests/conversation-panel.test.tsx`
  - live context polling
  - unexpected disconnect cleanup
  - visual perception error handling
- `tests/app-pages-smoke.test.tsx`
  - home, create, and settings render smoke coverage
- `tests/login-page.test.tsx`
  - login mode rendering/toggling
- `tests/service-regressions.test.ts`
  - heartbeat rescheduling under outbound caps
  - live transcript deduplication
  - due-heartbeat filtering by `nextHeartbeatAt`
