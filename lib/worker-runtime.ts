import { flushPendingTelegramMessages, runDueHeartbeats } from "@/lib/services";

export async function runHeartbeatWorker() {
  const heartbeatResults = await runDueHeartbeats();
  const telegramResults = await flushPendingTelegramMessages();

  return {
    heartbeatResults,
    telegramResults,
  };
}

export async function runTelegramWorker() {
  const results = await flushPendingTelegramMessages();
  return { results };
}
