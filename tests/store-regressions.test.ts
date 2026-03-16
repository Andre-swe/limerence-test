import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_PROCESSED_TELEGRAM_UPDATES,
  appendMessages,
  hasProcessedTelegramUpdate,
  markTelegramUpdateProcessed,
  resetStoreForTests,
  updateMessage,
} from "@/lib/store";
import type { DataStore } from "@/lib/types";

const storeFile =
  process.env.PERSONA_STORE_FILE ?? path.join(process.cwd(), "data", "demo-store.json");

async function readCurrentStore() {
  return JSON.parse(await readFile(storeFile, "utf8")) as DataStore;
}

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
          telegramStatus: "not_requested",
          attempts: 0,
        },
      },
    ]);

    await expect(
      updateMessage("msg-validation-1", () => ({ id: "broken" } as never)),
    ).rejects.toThrow();
  });

  it("trims processed telegram update history to the configured cap", async () => {
    const seeded = await readCurrentStore();
    await resetStoreForTests({
      ...seeded,
      processedTelegramUpdates: Array.from(
        { length: MAX_PROCESSED_TELEGRAM_UPDATES },
        (_, index) => `update-${index}`,
      ),
    });

    await markTelegramUpdateProcessed("update-overflow");

    expect(await hasProcessedTelegramUpdate("update-0")).toBe(false);
    expect(await hasProcessedTelegramUpdate("update-overflow")).toBe(true);
  });
});
