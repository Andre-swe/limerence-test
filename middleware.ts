import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ALLOWED_ORIGINS = [
  "https://limerance.vercel.app",
  "http://localhost:3000",
];

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/api/auth",
];

function getCorsHeaders(origin: string | null) {
  const isAllowed = origin && ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}

export async function middleware(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  const pathname = request.nextUrl.pathname;

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  // Allow public paths without auth
  if (isPublicPath(pathname)) {
    const response = NextResponse.next();
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }

  // For non-API routes that need auth protection (pages)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase is not configured, allow access (dev mode without auth)
  if (!supabaseUrl || !supabaseAnonKey) {
    const response = NextResponse.next();
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }

  // Create Supabase client for session refresh
  let response = NextResponse.next({
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

  const { data: { user } } = await supabase.auth.getUser();

  // Protected pages: redirect to login if not authenticated
  const protectedPages = ["/", "/create", "/personas", "/settings", "/review"];
  const isProtectedPage = protectedPages.some(
    (path) => pathname === path || (path !== "/" && pathname.startsWith(path))
  );

  if (isProtectedPage && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect logged-in users away from login page
  if (pathname === "/login" && user) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // API routes that don't need persona auth (non-persona API routes)
  if (!pathname.startsWith("/api/personas")) {
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }

  // Persona API routes require authentication
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized. Valid session required." },
      { status: 401, headers: corsHeaders }
    );
  }

  // Pass authenticated user ID to route handlers
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", user.id);

  const authenticatedResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  Object.entries(corsHeaders).forEach(([key, value]) => {
    authenticatedResponse.headers.set(key, value);
  });

  return authenticatedResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
