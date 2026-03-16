type EnvironmentSource = Record<string, string | undefined>;

function optionalEnv(source: EnvironmentSource, name: string): string | undefined {
  const value = source[name]?.trim();
  return value || undefined;
}

export type StartupEnvironment = {
  isProduction: boolean;
  isDev: boolean;
  hasLLMProvider: boolean;
  supabaseConfigured: boolean;
};

export function getStartupEnvironment(
  source: EnvironmentSource = process.env,
  nodeEnv = process.env.NODE_ENV,
): StartupEnvironment {
  const isProduction = nodeEnv === "production";
  const isDev = nodeEnv === "development" || nodeEnv === "test";
  const hasGemini = Boolean(optionalEnv(source, "GEMINI_API_KEY"));
  const hasAnthropic = Boolean(optionalEnv(source, "ANTHROPIC_API_KEY"));
  const hasOpenAI = Boolean(optionalEnv(source, "OPENAI_API_KEY"));
  const supabaseUrl = optionalEnv(source, "NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = optionalEnv(source, "NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return {
    isProduction,
    isDev,
    hasLLMProvider: hasGemini || hasAnthropic || hasOpenAI,
    supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  };
}

export function assertStartupEnvironment(
  source: EnvironmentSource = process.env,
  nodeEnv = process.env.NODE_ENV,
) {
  const startup = getStartupEnvironment(source, nodeEnv);

  if (!startup.isProduction) {
    return startup;
  }

  if (!startup.hasLLMProvider) {
    throw new Error(
      "No LLM provider configured. Set at least one of: GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY",
    );
  }

  if (!startup.supabaseConfigured) {
    throw new Error(
      "Supabase is required in production. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  if (!optionalEnv(source, "SUPABASE_SERVICE_ROLE_KEY")) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required in production to enable per-user store isolation.",
    );
  }

  return startup;
}

export const env = getStartupEnvironment();
