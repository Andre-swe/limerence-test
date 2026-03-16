import { runHeartbeatWorker } from "@/lib/worker-runtime";

export async function main() {
  const result = await runHeartbeatWorker();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );
}

void main();
