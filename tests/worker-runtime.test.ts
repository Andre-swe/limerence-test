import { beforeEach, describe, expect, it, vi } from "vitest";

const { runDueHeartbeatsMock } = vi.hoisted(() => ({
  runDueHeartbeatsMock: vi.fn(),
}));

vi.mock("@/lib/services", () => ({
  runDueHeartbeats: runDueHeartbeatsMock,
}));

import {
  runHeartbeatWorker,
} from "@/lib/worker-runtime";

describe("worker runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runDueHeartbeatsMock.mockResolvedValue([{ personaId: "persona-1" }]);
  });

  it("runs heartbeat work", async () => {
    const result = await runHeartbeatWorker();

    expect(runDueHeartbeatsMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      heartbeatResults: [{ personaId: "persona-1" }],
    });
  });
});
