import { runDueHeartbeats } from "@/lib/services";

export async function runHeartbeatWorker() {
  const heartbeatResults = await runDueHeartbeats();

  return {
    heartbeatResults,
  };
}
