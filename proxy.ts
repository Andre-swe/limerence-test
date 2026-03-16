import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { assertStartupEnvironment } from "@/lib/env";
import {
  applyHeaders,
  getCorsHeaders,
  isProtectedPage,
  isPublicPath,
} from "@/lib/proxy-config";

let startupValidated = false;

function ensureStartupEnvironment() {
  if (startupValidated) {
    return;
  }

  assertStartupEnvironment();
  startupValidated = true;
}

export async function proxy(request: NextRequest) {
  ensureStartupEnvironment();

  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  const pathname = request.nextUrl.pathname;

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  if (isPublicPath(pathname)) {
    return applyHeaders(NextResponse.next(), corsHeaders);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return applyHeaders(NextResponse.next(), corsHeaders);
  }

  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtectedPage(pathname) && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/login" && user) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!pathname.startsWith("/api/personas")) {
    return applyHeaders(response, corsHeaders);
  }

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized. Valid session required." },
      { status: 401, headers: corsHeaders },
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", user.id);

  return applyHeaders(
    NextResponse.next({
      request: { headers: requestHeaders },
    }),
    corsHeaders,
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
