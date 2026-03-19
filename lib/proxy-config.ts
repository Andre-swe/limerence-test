import type { NextResponse } from "next/server";

export const ALLOWED_ORIGINS = [
  ...(process.env.NODE_ENV !== "production" ? ["http://localhost:3000"] : []),
];

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  
  // Allow any vercel.app subdomain for preview deployments
  if (origin.endsWith(".vercel.app")) return true;
  
  // Allow localhost in development
  if (process.env.NODE_ENV !== "production" && origin === "http://localhost:3000") {
    return true;
  }
  
  return ALLOWED_ORIGINS.includes(origin);
}

export const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/api/auth",
  "/setup-password",
];

export const PROTECTED_PAGES = [
  "/",
  "/create",
  "/personas",
  "/settings",
  "/review",
];

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin !== null && ALLOWED_ORIGINS.includes(origin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (isAllowed) {
    headers["Access-Control-Allow-Origin"] = origin!;
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

export function applyHeaders(
  response: NextResponse,
  headers: Record<string, string>,
) {
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}

export function isProtectedPage(pathname: string) {
  return PROTECTED_PAGES.some(
    (path) => pathname === path || (path !== "/" && pathname.startsWith(path)),
  );
}
