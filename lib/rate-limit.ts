/**
 * Simple in-memory rate limiter with sliding window.
 * For production with multiple instances, use Vercel KV or Redis.
 */

interface RateLimitEntry {
  timestamps: number[];
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

// In-memory store (per-instance, resets on deploy)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupStaleEntries(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  
  const oneHourAgo = now - 60 * 60 * 1000;
  for (const [key, entry] of rateLimitStore.entries()) {
    // Remove entries with no recent activity
    if (entry.timestamps.every((ts) => ts < oneHourAgo)) {
      rateLimitStore.delete(key);
    }
  }
  lastCleanup = now;
}

/**
 * Check if a request should be rate limited.
 * Returns { allowed: true } or { allowed: false, retryAfter: seconds }.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): { allowed: true } | { allowed: false; retryAfter: number } {
  const now = Date.now();
  cleanupStaleEntries(now);

  const windowStart = now - config.windowMs;
  const entry = rateLimitStore.get(key) ?? { timestamps: [] };

  // Filter to only timestamps within the window
  const recentTimestamps = entry.timestamps.filter((ts) => ts > windowStart);

  if (recentTimestamps.length >= config.maxRequests) {
    // Calculate when the oldest request in window will expire
    const oldestInWindow = Math.min(...recentTimestamps);
    const retryAfterMs = oldestInWindow + config.windowMs - now;
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

    return { allowed: false, retryAfter: Math.max(1, retryAfterSeconds) };
  }

  // Allow request and record timestamp
  recentTimestamps.push(now);
  rateLimitStore.set(key, { timestamps: recentTimestamps });

  return { allowed: true };
}

// Pre-configured rate limiters
export const RATE_LIMITS = {
  // 30 messages per minute per user
  messages: {
    windowMs: 60 * 1000,
    maxRequests: 30,
  },
  // 5 live call initiations per hour per user
  liveCalls: {
    windowMs: 60 * 60 * 1000,
    maxRequests: 5,
  },
} as const;

/**
 * Build a rate limit key for a user action.
 */
export function rateLimitKey(userId: string, action: keyof typeof RATE_LIMITS): string {
  return `${action}:${userId}`;
}

/**
 * Create a 429 Too Many Requests response with Retry-After header.
 */
export function rateLimitResponse(retryAfter: number): Response {
  return new Response(
    JSON.stringify({
      error: "Too many requests. Please slow down.",
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
      },
    },
  );
}
