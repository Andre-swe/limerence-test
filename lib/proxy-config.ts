import type { NextResponse } from "next/server";

export const ALLOWED_ORIGINS = [
  "https://limerance.vercel.app",
  "http://localhost:3000",
];

export const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/api/auth",
];

export const PROTECTED_PAGES = [
  "/",
  "/create",
  "/personas",
  "/settings",
  "/review",
];

export function getCorsHeaders(origin: string | null) {
  const isAllowed = origin !== null && ALLOWED_ORIGINS.includes(origin);

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
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
