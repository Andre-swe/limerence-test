import type { NextResponse } from "next/server";

function normalizeOrigin(origin: string | undefined) {
  if (!origin) {
    return null;
  }

  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function isVercelPreviewOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

export const ALLOWED_ORIGINS = Array.from(
  new Set(
    [
      process.env.NODE_ENV !== "production" ? "http://localhost:3000" : null,
      process.env.NODE_ENV !== "production" ? "http://127.0.0.1:3000" : null,
      normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL),
      normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL),
      normalizeOrigin(
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
      ),
    ].filter((origin): origin is string => Boolean(origin)),
  ),
);

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;

  if (isVercelPreviewOrigin(origin)) {
    return true;
  }

  return ALLOWED_ORIGINS.includes(origin);
}

export const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/api/auth",
  "/api/linq",
  "/setup-password",
];

export const PROTECTED_PAGES = [
  "/create",
  "/personas",
  "/settings",
];

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin !== null && isAllowedOrigin(origin);
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
  if (pathname === "/") {
    return true;
  }

  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}

export function isProtectedPage(pathname: string) {
  return PROTECTED_PAGES.some(
    (path) => pathname === path || (path !== "/" && pathname.startsWith(path)),
  );
}
