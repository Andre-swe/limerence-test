import { runTelegramWorker } from "@/lib/worker-runtime";

export async function main() {
  const result = await runTelegramWorker();
  console.log(JSON.stringify(result, null, 2));
}

void main();
