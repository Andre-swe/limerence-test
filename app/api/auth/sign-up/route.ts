import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isAllowedOrigin } from "@/lib/proxy-config";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    );
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

  // Vercel automatically sets VERCEL_URL for deployments (without protocol)
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  
  const rawOrigin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const refererOrigin = referer ? new URL(referer).origin : null;
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  const forwardedOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : null;
  
  // Priority: origin header > referer > x-forwarded-host > VERCEL_URL > request URL
  let origin = rawOrigin && isAllowedOrigin(rawOrigin) ? rawOrigin : null;
  if (!origin) {
    origin = refererOrigin && isAllowedOrigin(refererOrigin) ? refererOrigin : null;
  }
  if (!origin) {
    origin = forwardedOrigin && isAllowedOrigin(forwardedOrigin) ? forwardedOrigin : null;
  }
  if (!origin) {
    origin = vercelUrl && isAllowedOrigin(vercelUrl) ? vercelUrl : null;
  }
  if (!origin) {
    origin = new URL(request.url).origin;
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    user: data.user,
    message: "Check your email for the confirmation link.",
  });
}
