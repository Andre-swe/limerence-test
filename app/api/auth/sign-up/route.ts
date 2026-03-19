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

  const rawOrigin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const refererOrigin = referer ? new URL(referer).origin : null;
  
  // Vercel provides the actual host in x-forwarded-host header
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  const vercelOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : null;
  
  // Use origin header, referer, Vercel forwarded host, or fall back to request URL
  let origin = rawOrigin;
  if (!origin || !isAllowedOrigin(origin)) {
    origin = refererOrigin && isAllowedOrigin(refererOrigin) 
      ? refererOrigin 
      : vercelOrigin && isAllowedOrigin(vercelOrigin)
        ? vercelOrigin
        : new URL(request.url).origin;
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
