import { getPersona } from "@/lib/store";
import { withUserStore } from "@/lib/store-context";

/**
 * Extracts the authenticated user ID from request headers.
 * Returns null if not authenticated (middleware should have blocked this).
 */
export function getAuthenticatedUserId(request: Request): string | null {
  return request.headers.get("x-user-id");
}

/**
 * Verifies that the authenticated user owns the specified persona.
 * Returns { authorized: true, persona, userId } if ownership is confirmed.
 * Returns { authorized: false, error, status } if not authorized.
 */
export async function verifyPersonaOwnership(
  request: Request,
  personaId: string,
): Promise<
  | { authorized: true; persona: NonNullable<Awaited<ReturnType<typeof getPersona>>>; userId: string }
  | { authorized: false; error: string; status: number }
> {
  const userId = getAuthenticatedUserId(request);

  if (!userId) {
    return {
      authorized: false,
      error: "Unauthorized. Valid session required.",
      status: 401,
    };
  }

  // Use the user's store context when fetching the persona
  const persona = await withUserStore(userId, () => getPersona(personaId));

  if (!persona) {
    return {
      authorized: false,
      error: "Persona not found.",
      status: 404,
    };
  }

  if (persona.userId !== userId) {
    return {
      authorized: false,
      error: "Forbidden. You do not own this persona.",
      status: 403,
    };
  }

  return { authorized: true, persona, userId };
}

/**
 * Wraps an async function to run within a user's store context.
 * Use this to ensure all store operations use the user's per-user store key.
 */
export function withUserContext<T>(
  request: Request,
  fn: (userId: string) => Promise<T>,
): Promise<T> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    throw new Error("Unauthorized. Valid session required.");
  }
  return withUserStore(userId, () => fn(userId));
}
