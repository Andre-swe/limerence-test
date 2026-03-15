import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type RuntimeStoreConfig = {
  url: string;
  serviceRoleKey: string;
  table: string;
  key: string;
  bucket: string;
};

let adminClient: SupabaseClient | null = null;

/** Check which Supabase features are configured via environment variables. */
export function getSupabaseStatus() {
  const urlConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKeyConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const serviceRoleConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const runtimeStoreConfigured =
    process.env.NODE_ENV !== "test" && urlConfigured && serviceRoleConfigured;

  return {
    urlConfigured,
    anonKeyConfigured,
    serviceRoleConfigured,
    runtimeStoreConfigured,
    runtimeStoreTable:
      process.env.SUPABASE_RUNTIME_STORE_TABLE ?? "runtime_store",
    runtimeStoreKey: process.env.SUPABASE_RUNTIME_STORE_KEY ?? "default",
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "limerence-uploads",
  };
}

/** Return the runtime store config if Supabase is configured, null otherwise.
 * If userId is provided, it becomes the store key (per-user isolation).
 * Otherwise falls back to env var or "default".
 */
export function getSupabaseRuntimeConfig(
  userId?: string,
): RuntimeStoreConfig | null {
  if (process.env.NODE_ENV === "test") {
    return null;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    return null;
  }

  // Use userId as the key for per-user store isolation
  const key =
    userId || process.env.SUPABASE_RUNTIME_STORE_KEY?.trim() || "default";

  return {
    url,
    serviceRoleKey,
    table: process.env.SUPABASE_RUNTIME_STORE_TABLE?.trim() || "runtime_store",
    key,
    bucket: process.env.SUPABASE_STORAGE_BUCKET?.trim() || "limerence-uploads",
  };
}

/** Get or create a Supabase admin client (service role). Returns null if not configured. */
export function getSupabaseAdminClient() {
  const config = getSupabaseRuntimeConfig();

  if (!config) {
    return null;
  }

  if (!adminClient) {
    adminClient = createClient(config.url, config.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return adminClient;
}
