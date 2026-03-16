import { beforeEach, describe, expect, it } from "vitest";
import {
  appendMessages,
  resetStoreForTests,
  updateMessage,
} from "@/lib/store";

describe("store regressions", () => {
  beforeEach(async () => {
    await resetStoreForTests();
  });

  it("rejects invalid message updates", async () => {
    await appendMessages([
      {
        id: "msg-validation-1",
        personaId: "persona-mom",
        role: "assistant",
        kind: "text",
        channel: "web",
        body: "Still here.",
        attachments: [],
        audioStatus: "unavailable",
        createdAt: "2026-03-16T15:00:00.000Z",
        delivery: {
          webInbox: true,
          attempts: 0,
        },
      },
    ]);

    await expect(
      updateMessage("msg-validation-1", () => ({ id: "broken" } as never)),
    ).rejects.toThrow();
  });
});
