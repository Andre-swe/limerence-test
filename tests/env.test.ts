import { describe, expect, it } from "vitest";
import {
  assertStartupEnvironment,
  getStartupEnvironment,
} from "@/lib/env";

describe("startup environment", () => {
  it("reports non-production environments without enforcing providers", () => {
    const startup = getStartupEnvironment({}, "test");

    expect(startup.isProduction).toBe(false);
    expect(startup.isDev).toBe(true);
    expect(startup.hasLLMProvider).toBe(false);
    expect(startup.supabaseConfigured).toBe(false);
  });

  it("throws in production when no LLM provider is configured", () => {
    expect(() =>
      assertStartupEnvironment(
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://supabase.test",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
        },
        "production",
      ),
    ).toThrow("No LLM provider configured");
  });

  it("throws in production when Supabase is not configured", () => {
    expect(() =>
      assertStartupEnvironment(
        {
          GEMINI_API_KEY: "gemini-test",
        },
        "production",
      ),
    ).toThrow("Supabase is required in production");
  });

  it("throws in production when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    expect(() =>
      assertStartupEnvironment(
        {
          OPENAI_API_KEY: "openai-test",
          NEXT_PUBLIC_SUPABASE_URL: "https://supabase.test",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
        },
        "production",
      ),
    ).toThrow("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("accepts a production environment with a provider, Supabase, and service role key", () => {
    const startup = assertStartupEnvironment(
      {
        OPENAI_API_KEY: "openai-test",
        NEXT_PUBLIC_SUPABASE_URL: "https://supabase.test",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
      },
      "production",
    );

    expect(startup).toEqual({
      isProduction: true,
      isDev: false,
      hasLLMProvider: true,
      supabaseConfigured: true,
    });
  });
});
