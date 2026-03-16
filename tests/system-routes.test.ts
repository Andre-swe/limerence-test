import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectJsonError, expectJsonResponse } from "@/tests/helpers/assertions";

const {
  getAuthenticatedUserIdMock,
  getSupabaseRuntimeConfigMock,
  listPersonasMock,
  runDueHeartbeatsMock,
  serveMock,
  servedHandlers,
  withUserStoreMock,
} = vi.hoisted(() => {
  const servedHandlers = {
    GET: vi.fn(),
    POST: vi.fn(),
    PUT: vi.fn(),
  };

  return {
    getAuthenticatedUserIdMock: vi.fn(),
    getSupabaseRuntimeConfigMock: vi.fn(),
    listPersonasMock: vi.fn(),
    runDueHeartbeatsMock: vi.fn(),
    serveMock: vi.fn(() => servedHandlers),
    servedHandlers,
    withUserStoreMock: vi.fn((_userId: string, fn: () => unknown) => fn()),
  };
});

vi.mock("@/lib/auth", () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock("@/lib/store", () => ({
  listPersonas: listPersonasMock,
}));

vi.mock("@/lib/store-context", () => ({
  withUserStore: withUserStoreMock,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseRuntimeConfig: getSupabaseRuntimeConfigMock,
}));

vi.mock("@/lib/services", () => ({
  runDueHeartbeats: runDueHeartbeatsMock,
}));

vi.mock("inngest/next", () => ({
  serve: serveMock,
}));

vi.mock("@/lib/inngest", () => ({
  inngest: { id: "inngest-client" },
  inngestFunctions: ["handler-a", "handler-b"],
}));

import { GET as healthStoreGet } from "@/app/api/health/store/route";
import { POST as internalHeartbeatPost } from "@/app/api/internal/heartbeat/route";

describe("system routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockReturnValue("user-1");
    getSupabaseRuntimeConfigMock.mockReturnValue(null);
    runDueHeartbeatsMock.mockResolvedValue([{ personaId: "persona-1", action: "TEXT" }]);
    process.env.CRON_SECRET = "cron-secret";
  });

  it("rejects unauthenticated store health checks", async () => {
    getAuthenticatedUserIdMock.mockReturnValueOnce(null);

    const response = await healthStoreGet(new Request("http://localhost/api/health/store"));

    await expectJsonError(response, 401, "Unauthorized. Valid session required.");
  });

  it("returns aggregated store-health stats", async () => {
    listPersonasMock.mockResolvedValueOnce([
      {
        updatedAt: "2026-03-16T12:00:00.000Z",
        mindState: {
          memoryClaims: [{ id: "claim-1" }, { id: "claim-2" }],
          claimSources: [{ id: "source-1" }],
          episodes: [{ id: "episode-1" }],
        },
      },
      {
        updatedAt: "2026-03-16T13:00:00.000Z",
        mindState: {
          memoryClaims: [{ id: "claim-3" }],
          claimSources: [{ id: "source-2" }, { id: "source-3" }],
          episodes: [],
        },
      },
    ]);
    getSupabaseRuntimeConfigMock.mockReturnValueOnce({
      key: "user-1",
    });

    const response = await healthStoreGet(new Request("http://localhost/api/health/store"));

    const body = await expectJsonResponse<{
      status: string;
      storeType: string;
      personaCount: number;
      totalClaims: number;
      totalClaimSources: number;
      totalEpisodes: number;
      lastUpdatedAt: string;
    }>(response);
    expect(body.status).toBe("healthy");
    expect(body.storeType).toBe("supabase");
    expect(body.personaCount).toBe(2);
    expect(body.totalClaims).toBe(3);
    expect(body.totalClaimSources).toBe(3);
    expect(body.totalEpisodes).toBe(1);
    expect(body.lastUpdatedAt).toBe("2026-03-16T13:00:00.000Z");
  });

  it("returns an unhealthy status when store health throws", async () => {
    withUserStoreMock.mockImplementationOnce(() => {
      throw new Error("store unavailable");
    });

    const response = await healthStoreGet(new Request("http://localhost/api/health/store"));

    await expectJsonError(response, 500, "store unavailable");
  });

  it("rejects heartbeat runs without the cron secret", async () => {
    const response = await internalHeartbeatPost(
      new Request("http://localhost/api/internal/heartbeat", { method: "POST" }),
    );

    await expectJsonError(response, 401, "Unauthorized. Valid CRON_SECRET required.");
  });

  it("runs due heartbeats", async () => {
    const response = await internalHeartbeatPost(
      new Request("http://localhost/api/internal/heartbeat", {
        method: "POST",
        headers: {
          authorization: "Bearer cron-secret",
        },
      }),
    );

    const body = await expectJsonResponse<{
      results: Array<{ personaId: string }>;
    }>(response);
    expect(body.results[0]?.personaId).toBe("persona-1");
  });

  it("returns a 500 when heartbeat execution fails", async () => {
    runDueHeartbeatsMock.mockRejectedValueOnce(new Error("scheduler offline"));

    const response = await internalHeartbeatPost(
      new Request("http://localhost/api/internal/heartbeat", {
        method: "POST",
        headers: {
          authorization: "Bearer cron-secret",
        },
      }),
    );

    await expectJsonError(response, 500, "scheduler offline");
  });

  it("wires the Inngest route through serve()", async () => {
    vi.resetModules();
    const route = await import("@/app/api/inngest/route");

    expect(serveMock).toHaveBeenCalledWith({
      client: { id: "inngest-client" },
      functions: ["handler-a", "handler-b"],
    });
    expect(route.GET).toBe(servedHandlers.GET);
    expect(route.POST).toBe(servedHandlers.POST);
    expect(route.PUT).toBe(servedHandlers.PUT);
  });
});
