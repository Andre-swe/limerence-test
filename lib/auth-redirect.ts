import { isAllowedOrigin } from "@/lib/proxy-config";

function safeOrigin(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function resolveAllowedAuthOrigin(request: Request) {
  const rawOrigin = request.headers.get("origin");
  const refererOrigin = safeOrigin(request.headers.get("referer"));
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  const forwardedOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : null;
  const vercelOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;

  const candidates = [rawOrigin, refererOrigin, forwardedOrigin, vercelOrigin];
  for (const candidate of candidates) {
    if (candidate && isAllowedOrigin(candidate)) {
      return candidate;
    }
  }

  return new URL(request.url).origin;
}
