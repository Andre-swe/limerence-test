import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type RuntimeStoreConfig = {
  url: string;
  serviceRoleKey: string;
  table: string;
  key: string;
  bucket: string;
};

let adminClient: SupabaseClient | null = null;

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
    runtimeStoreTable: process.env.SUPABASE_RUNTIME_STORE_TABLE ?? "runtime_store",
    runtimeStoreKey: process.env.SUPABASE_RUNTIME_STORE_KEY ?? "default",
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "limerence-uploads",
  };
}

export function getSupabaseRuntimeConfig(): RuntimeStoreConfig | null {
  if (process.env.NODE_ENV === "test") {
    return null;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    return null;
  }

  return {
    url,
    serviceRoleKey,
    table: process.env.SUPABASE_RUNTIME_STORE_TABLE?.trim() || "runtime_store",
    key: process.env.SUPABASE_RUNTIME_STORE_KEY?.trim() || "default",
    bucket: process.env.SUPABASE_STORAGE_BUCKET?.trim() || "limerence-uploads",
  };
}

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
