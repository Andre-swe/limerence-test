import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const error_param = searchParams.get("error");
  const error_description = searchParams.get("error_description");
  const rawNext = searchParams.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  // If Supabase returned an error in the URL, redirect to login with that error
  if (error_param) {
    const errorMsg = error_description || error_param;
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(errorMsg)}`);
  }

  // If no code or token_hash, redirect to login
  if (!code && !token_hash) {
    return NextResponse.redirect(`${origin}/login?error=missing_auth_params`);
  }

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
  let data: { user: { created_at: string; identities?: Array<{ provider: string; identity_data?: { password_set?: boolean } }> | null; user_metadata?: { password_set?: boolean } } | null } = { user: null };

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

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  if (data.user) {
    // Check if user has set up a password using our custom metadata flag
    const hasPasswordSet = data.user.user_metadata?.password_set === true;
    
    // If user hasn't set a password yet, redirect to setup-password
    if (!hasPasswordSet) {
      return NextResponse.redirect(`${origin}/setup-password`);
    }
    
    return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
