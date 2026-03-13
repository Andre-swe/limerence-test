import { flushPendingTelegramMessages, runDueHeartbeats } from "@/lib/services";

async function main() {
  const heartbeatResults = await runDueHeartbeats();
  const telegramResults = await flushPendingTelegramMessages();

  console.log(
    JSON.stringify(
      {
        heartbeatResults,
        telegramResults,
      },
      null,
      2,
    ),
  );
}

void main();
