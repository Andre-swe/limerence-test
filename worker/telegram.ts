import { flushPendingTelegramMessages } from "@/lib/services";

async function main() {
  const results = await flushPendingTelegramMessages();
  console.log(JSON.stringify({ results }, null, 2));
}

void main();
