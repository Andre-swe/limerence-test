import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const rawNext = searchParams.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );

  let error = null;
  let data: { user: { created_at: string; identities?: Array<{ provider: string }> } | null } = { user: null };

  // Handle PKCE flow (code parameter)
  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code);
    error = result.error;
    data = result.data;
  }
  // Handle magic link / OTP flow (token_hash parameter)
  else if (token_hash && type) {
    const result = await supabase.auth.verifyOtp({ token_hash, type });
    error = result.error;
    data = result.data;
  }

  if (!error && data.user) {
    // Check if user has a password set by looking at identities
    // Users who signed up via magic link won't have a password identity yet
    const hasPasswordIdentity = data.user.identities?.some(
      (identity) => identity.provider === "email"
    );
    
    // Check if this is a new user (created recently, within last 5 minutes)
    const createdAt = new Date(data.user.created_at);
    const now = new Date();
    const isNewUser = (now.getTime() - createdAt.getTime()) < 5 * 60 * 1000;
    
    // If new user without password, redirect to setup password
    if (isNewUser || !hasPasswordIdentity) {
      return NextResponse.redirect(`${origin}/setup-password`);
    }
    
    return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
