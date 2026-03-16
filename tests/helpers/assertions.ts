import { expect } from "vitest";
import type {
  InternalScheduledEvent,
  MemoryClaim,
  Persona,
} from "@/lib/types";

export async function expectJsonError(
  response: Response,
  status: number,
  error?: string,
) {
  expect(response.status).toBe(status);
  const body = await response.json();
  if (error) {
    expect(body).toEqual(expect.objectContaining({ error }));
  }
  return body;
}

export async function expectJsonResponse<T = unknown>(
  response: Response,
  status = 200,
) {
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

export function expectClaimStatus(
  persona: Persona,
  claimId: string,
  status: MemoryClaim["status"],
) {
  const claim = persona.mindState.memoryClaims.find((entry) => entry.id === claimId);
  expect(claim?.status).toBe(status);
  return claim;
}

export function expectPendingEventStatus(
  persona: Persona,
  eventId: string,
  status: InternalScheduledEvent["status"],
) {
  const event = persona.mindState.pendingInternalEvents.find((entry) => entry.id === eventId);
  expect(event?.status).toBe(status);
  return event;
}
