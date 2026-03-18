# Environment Variables Checklist

Set these in Vercel Dashboard → Settings → Environment Variables for **Production** and **Preview** environments.

## Required - Core Infrastructure

| Variable                        | Description                                            | Required |
| ------------------------------- | ------------------------------------------------------ | -------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL (e.g., `https://xxx.supabase.co`) | ✅ Yes   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key                          | ✅ Yes   |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase service role key (server-side only)           | ✅ Yes   |

## Required - LLM Provider (at least one)

| Variable            | Description              | Required     |
| ------------------- | ------------------------ | ------------ |
| `GEMINI_API_KEY`    | Google Gemini API key    | One of these |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key | One of these |
| `OPENAI_API_KEY`    | OpenAI API key           | One of these |

## Optional - LLM Configuration

| Variable          | Description          | Default                    |
| ----------------- | -------------------- | -------------------------- |
| `GEMINI_MODEL`    | Gemini model name    | `gemini-2.5-flash`         |
| `ANTHROPIC_MODEL` | Anthropic model name | `claude-sonnet-4-20250514` |
| `OPENAI_MODEL`    | OpenAI model name    | `gpt-4.1-mini`             |

## Required - Voice (Hume)

| Variable          | Description        | Required           |
| ----------------- | ------------------ | ------------------ |
| `HUME_API_KEY`    | Hume AI API key    | ✅ Yes (for voice) |
| `HUME_SECRET_KEY` | Hume AI secret key | ✅ Yes (for voice) |

## Optional - Voice Configuration

| Variable                | Description                                         | Default               |
| ----------------------- | --------------------------------------------------- | --------------------- |
| `HUME_ACCESS_TOKEN`     | Pre-generated access token (alternative to API key) | -                     |
| `HUME_DEFAULT_VOICE_ID` | Default voice ID for personas                       | -                     |
| `HUME_VOICE_PROVIDER`   | Voice provider type                                 | `CUSTOM_VOICE`        |
| `HUME_EVI_HOST`         | Hume EVI hostname                                   | `api.hume.ai`         |
| `HUME_API_BASE_URL`     | Hume API base URL                                   | `https://api.hume.ai` |

## Premium - Voice Cloning (Hume Enterprise)

| Variable                  | Description                               | Required     |
| ------------------------- | ----------------------------------------- | ------------ |
| `HUME_ENTERPRISE_API_KEY` | Hume Enterprise API key for voice cloning | Premium only |

> **Setup Instructions:**
>
> 1. Contact Hume AI sales to obtain Enterprise account access
> 2. Generate an Enterprise API key from the Hume dashboard
> 3. Add `HUME_ENTERPRISE_API_KEY` to Vercel environment variables
> 4. Voice cloning will be available for premium users only

## Optional - Transcription

| Variable           | Description                              | Required |
| ------------------ | ---------------------------------------- | -------- |
| `DEEPGRAM_API_KEY` | Deepgram API key for audio transcription | Optional |

## Optional - Background Jobs (Inngest)

| Variable            | Description                           | Required |
| ------------------- | ------------------------------------- | -------- |
| `INNGEST_EVENT_KEY` | Inngest event key for background jobs | Optional |

## Optional - Error Monitoring (Sentry)

| Variable                 | Description                       | Required |
| ------------------------ | --------------------------------- | -------- |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN for error tracking     | Optional |
| `SENTRY_ORG`             | Sentry organization slug          | Optional |
| `SENTRY_PROJECT`         | Sentry project slug               | Optional |
| `SENTRY_AUTH_TOKEN`      | Sentry auth token for source maps | Optional |

## Optional - Cron/Scheduled Jobs

| Variable      | Description                                   | Required |
| ------------- | --------------------------------------------- | -------- |
| `CRON_SECRET` | Secret for authenticating cron endpoint calls | Optional |

## Optional - Supabase Storage

| Variable                       | Description                  | Default             |
| ------------------------------ | ---------------------------- | ------------------- |
| `SUPABASE_RUNTIME_STORE_TABLE` | Table name for runtime store | `runtime_store`     |
| `SUPABASE_RUNTIME_STORE_KEY`   | Default store key            | `default`           |
| `SUPABASE_STORAGE_BUCKET`      | Storage bucket name          | `limerence-uploads` |

## Optional - Logging

| Variable         | Description                          | Default                      |
| ---------------- | ------------------------------------ | ---------------------------- |
| `SOUL_LOG_LEVEL` | Log level (debug, info, warn, error) | `info` (prod), `debug` (dev) |

## Local Development Only

| Variable             | Description                     |
| -------------------- | ------------------------------- |
| `PERSONA_STORE_FILE` | Path to local JSON store file   |
| `PERSONA_UPLOAD_DIR` | Path to local uploads directory |

---

## Quick Setup for Vercel

1. Go to [Vercel Dashboard](https://vercel.com) → Your Project → Settings → Environment Variables

2. Add these **minimum required** variables:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   GEMINI_API_KEY=your-gemini-key  (or ANTHROPIC_API_KEY or OPENAI_API_KEY)
   HUME_API_KEY=your-hume-key
   HUME_SECRET_KEY=your-hume-secret
   ```

3. For error monitoring, add:

   ```
   NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
   ```

4. For background jobs, add:

   ```
   INNGEST_EVENT_KEY=your-inngest-key
   ```

5. Select environments: **Production** ✅ and **Preview** ✅

6. Redeploy after adding variables.
