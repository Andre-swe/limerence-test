import { getPersona } from "@/lib/store";

/**
 * Extracts the authenticated user ID from request headers.
 * Returns null if not authenticated (middleware should have blocked this).
 */
export function getAuthenticatedUserId(request: Request): string | null {
  return request.headers.get("x-user-id");
}

/**
 * Verifies that the authenticated user owns the specified persona.
 * Returns { authorized: true, persona } if ownership is confirmed.
 * Returns { authorized: false, error, status } if not authorized.
 */
export async function verifyPersonaOwnership(
  request: Request,
  personaId: string,
): Promise<
  | { authorized: true; persona: NonNullable<Awaited<ReturnType<typeof getPersona>>> }
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

  const persona = await getPersona(personaId);

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

  return { authorized: true, persona };
}
