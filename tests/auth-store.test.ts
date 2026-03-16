import { beforeEach, describe, expect, it } from "vitest";
import {
  verifyPersonaOwnership,
  withUserContext,
} from "@/lib/auth";
import { resetStoreForTests } from "@/lib/store";

describe("auth store integration", () => {
  beforeEach(async () => {
    await resetStoreForTests();
  });

  it("rejects ownership checks without x-user-id", async () => {
    const result = await verifyPersonaOwnership(
      new Request("http://localhost/api/personas/persona-mom"),
      "persona-mom",
    );

    expect(result).toEqual({
      authorized: false,
      error: "Unauthorized. Valid session required.",
      status: 401,
    });
  });

  it("authorizes owners for personas in the seeded store", async () => {
    const result = await verifyPersonaOwnership(
      new Request("http://localhost/api/personas/persona-mom", {
        headers: {
          "x-user-id": "user-demo",
        },
      }),
      "persona-mom",
    );

    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.userId).toBe("user-demo");
      expect(result.persona.id).toBe("persona-mom");
    }
  });

  it("returns a 403 when a different user owns the persona", async () => {
    const result = await verifyPersonaOwnership(
      new Request("http://localhost/api/personas/persona-mom", {
        headers: {
          "x-user-id": "user-other",
        },
      }),
      "persona-mom",
    );

    expect(result).toEqual({
      authorized: false,
      error: "Forbidden. You do not own this persona.",
      status: 403,
    });
  });

  it("returns a 404 when the persona does not exist", async () => {
    const result = await verifyPersonaOwnership(
      new Request("http://localhost/api/personas/missing", {
        headers: {
          "x-user-id": "user-demo",
        },
      }),
      "missing",
    );

    expect(result).toEqual({
      authorized: false,
      error: "Persona not found.",
      status: 404,
    });
  });

  it("runs user-context callbacks with the authenticated user id", async () => {
    const value = await withUserContext(
      new Request("http://localhost/api/personas/persona-mom", {
        headers: {
          "x-user-id": "user-demo",
        },
      }),
      async (userId) => `current:${userId}`,
    );

    expect(value).toBe("current:user-demo");
  });
});
