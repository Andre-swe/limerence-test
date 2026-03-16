import { beforeEach, describe, expect, it, vi } from "vitest";

const { flushPendingTelegramMessagesMock, runDueHeartbeatsMock } = vi.hoisted(() => ({
  flushPendingTelegramMessagesMock: vi.fn(),
  runDueHeartbeatsMock: vi.fn(),
}));

vi.mock("@/lib/services", () => ({
  flushPendingTelegramMessages: flushPendingTelegramMessagesMock,
  runDueHeartbeats: runDueHeartbeatsMock,
}));

import {
  runHeartbeatWorker,
  runTelegramWorker,
} from "@/lib/worker-runtime";

describe("worker runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runDueHeartbeatsMock.mockResolvedValue([{ personaId: "persona-1" }]);
    flushPendingTelegramMessagesMock.mockResolvedValue([{ messageId: "msg-1" }]);
  });

  it("runs heartbeat work and then flushes telegram deliveries", async () => {
    const result = await runHeartbeatWorker();

    expect(runDueHeartbeatsMock).toHaveBeenCalledTimes(1);
    expect(flushPendingTelegramMessagesMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      heartbeatResults: [{ personaId: "persona-1" }],
      telegramResults: [{ messageId: "msg-1" }],
    });
  });

  it("flushes telegram deliveries for the telegram worker", async () => {
    const result = await runTelegramWorker();

    expect(runDueHeartbeatsMock).not.toHaveBeenCalled();
    expect(flushPendingTelegramMessagesMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      results: [{ messageId: "msg-1" }],
    });
  });
});
