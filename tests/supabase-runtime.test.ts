import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSupabaseRuntimeConfig,
  getSupabaseStatus,
} from "@/lib/supabase";

const originalNodeEnv = process.env.NODE_ENV;
const originalEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_RUNTIME_STORE_TABLE: process.env.SUPABASE_RUNTIME_STORE_TABLE,
  SUPABASE_RUNTIME_STORE_KEY: process.env.SUPABASE_RUNTIME_STORE_KEY,
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET,
};

describe("supabase runtime config", () => {
  afterEach(() => {
    vi.stubEnv("NODE_ENV", originalNodeEnv ?? "test");
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnv.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_RUNTIME_STORE_TABLE = originalEnv.SUPABASE_RUNTIME_STORE_TABLE;
    process.env.SUPABASE_RUNTIME_STORE_KEY = originalEnv.SUPABASE_RUNTIME_STORE_KEY;
    process.env.SUPABASE_STORAGE_BUCKET = originalEnv.SUPABASE_STORAGE_BUCKET;
  });

  it("disables the shared runtime store in test mode", () => {
    vi.stubEnv("NODE_ENV", "test");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

    expect(getSupabaseRuntimeConfig("user-1")).toBeNull();
    expect(getSupabaseStatus().runtimeStoreConfigured).toBe(false);
  });

  it("builds a runtime config with user-store isolation outside test mode", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SUPABASE_RUNTIME_STORE_TABLE = "runtime_store_custom";
    process.env.SUPABASE_RUNTIME_STORE_KEY = "default-store";
    process.env.SUPABASE_STORAGE_BUCKET = "uploads-custom";

    expect(getSupabaseRuntimeConfig("user-42")).toEqual({
      url: "https://supabase.test",
      serviceRoleKey: "service-role",
      table: "runtime_store_custom",
      key: "user-42",
      bucket: "uploads-custom",
    });
  });

  it("reports env-level Supabase status with defaults when optional vars are unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    delete process.env.SUPABASE_RUNTIME_STORE_TABLE;
    delete process.env.SUPABASE_RUNTIME_STORE_KEY;
    delete process.env.SUPABASE_STORAGE_BUCKET;

    expect(getSupabaseStatus()).toEqual({
      urlConfigured: true,
      anonKeyConfigured: true,
      serviceRoleConfigured: true,
      runtimeStoreConfigured: true,
      runtimeStoreTable: "runtime_store",
      runtimeStoreKey: "default",
      storageBucket: "limerence-uploads",
    });
  });
});
