import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { getOwnedPersonaForUser } from "@/lib/auth";
import { updatePersonaSettings } from "@/lib/persona-settings";
import { withPersonaRoute } from "@/lib/persona-route";
import { createPersonaFromForm, resetServiceRuntimeStateForTests } from "@/lib/services";
import { planHeartbeatSoul } from "@/lib/soul-runtime";
import { getPersona, listMessages, resetStoreForTests, updatePersona } from "@/lib/store";
import { withUserStore } from "@/lib/store-context";

describe("persona auth and settings", () => {
  beforeEach(async () => {
    await resetServiceRuntimeStateForTests();
    await resetStoreForTests();
  });

  it("only loads a persona for its owning user", async () => {
    const ownedPersona = await getOwnedPersonaForUser("user-demo", "persona-mom");
    const hiddenPersona = await getOwnedPersonaForUser("someone-else", "persona-mom");

    expect(ownedPersona?.id).toBe("persona-mom");
    expect(hiddenPersona).toBeNull();
  });

  it("captures timezone during persona creation and rejects invalid values", async () => {
    const validFormData = new FormData();
    validFormData.append("name", "Nina");
    validFormData.append("relationship", "Aunt");
    validFormData.append("description", "Playful and observant.");
    validFormData.append("attestedRights", "on");
    validFormData.append("heartbeatIntervalHours", "4");
    validFormData.append("preferredMode", "mixed");
    validFormData.append("timezone", "America/Toronto");

    const persona = await createPersonaFromForm(validFormData, "test-user-id");
    expect(persona.timezone).toBe("America/Toronto");

    const invalidFormData = new FormData();
    invalidFormData.append("name", "Nina");
    invalidFormData.append("relationship", "Aunt");
    invalidFormData.append("description", "Playful and observant.");
    invalidFormData.append("attestedRights", "on");
    invalidFormData.append("timezone", "Mars/Olympus");

    await expect(createPersonaFromForm(invalidFormData, "test-user-id")).rejects.toThrow(
      "Invalid timezone.",
    );
  });

  it("persists persona settings updates for timezone and heartbeat defaults", async () => {
    await withUserStore("user-demo", () =>
      updatePersonaSettings("persona-mom", {
        timezone: "Asia/Tokyo",
        heartbeatIntervalHours: 6,
        quietHoursStart: 21,
        quietHoursEnd: 7,
        preferredMode: "text",
      }),
    );

    const persona = await withUserStore("user-demo", () => getPersona("persona-mom"));
    expect(persona?.timezone).toBe("Asia/Tokyo");
    expect(persona?.heartbeatPolicy.intervalHours).toBe(6);
    expect(persona?.heartbeatPolicy.quietHoursStart).toBe(21);
    expect(persona?.heartbeatPolicy.quietHoursEnd).toBe(7);
    expect(persona?.heartbeatPolicy.preferredMode).toBe("text");
  });

  it("respects quiet and work windows in the persona timezone when planning heartbeats", async () => {
    await updatePersona("persona-mom", (current) => ({
      ...current,
      timezone: "Asia/Tokyo",
      heartbeatPolicy: {
        ...current.heartbeatPolicy,
        quietHoursStart: 22,
        quietHoursEnd: 6,
        workHoursEnabled: true,
        workHoursStart: 9,
        workHoursEnd: 17,
        workDays: [0, 1, 2, 3, 4, 5, 6],
      },
    }));

    const persona = (await getPersona("persona-mom"))!;
    const messages = await listMessages("persona-mom");
    const plan = planHeartbeatSoul({
      persona,
      messages,
      feedbackNotes: [],
      now: new Date("2026-03-15T00:00:00.000Z"),
    });

    expect(plan.decision.action).toBe("SILENT");
    expect(plan.decision.reason).toContain("work-hours");
  });

  it("wraps persona routes with ownership checks and store scoping", async () => {
    const handler = withPersonaRoute(
      async ({ persona, userId }) => ({
        personaId: persona.id,
        userId,
      }),
      { errorMessage: "Unable to load persona." },
    );

    const allowedResponse = await handler(
      new Request("http://localhost/api/personas/persona-mom", {
        headers: {
          "x-user-id": "user-demo",
        },
      }),
      { params: Promise.resolve({ personaId: "persona-mom" }) },
    );
    const deniedResponse = await handler(
      new Request("http://localhost/api/personas/persona-mom", {
        headers: {
          "x-user-id": "someone-else",
        },
      }),
      { params: Promise.resolve({ personaId: "persona-mom" }) },
    );

    expect(allowedResponse.status).toBe(200);
    await expect(allowedResponse.json()).resolves.toMatchObject({
      personaId: "persona-mom",
      userId: "user-demo",
    });
    expect(deniedResponse.status).toBe(403);
  });
});

describe("repo hygiene", () => {
  it("removes stale duplicate component copies and the dead review page", () => {
    expect(
      existsSync("/Users/syekel/Documents/limerance/components/conversation-panel 2.tsx"),
    ).toBe(false);
    expect(
      existsSync("/Users/syekel/Documents/limerance/components/messages-panel 2.tsx"),
    ).toBe(false);
    expect(existsSync("/Users/syekel/Documents/limerance/app/review/page.tsx")).toBe(false);
  });
});
