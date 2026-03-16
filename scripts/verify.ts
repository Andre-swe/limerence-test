import { rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

type Step = {
  label: string;
  command: string;
  args: string[];
  cleanNextBefore?: boolean;
};

const repoRoot = process.cwd();

const steps: Step[] = [
  { label: "lint", command: "npm", args: ["run", "lint"] },
  { label: "typecheck", command: "npm", args: ["run", "typecheck"] },
  { label: "test", command: "npm", args: ["run", "test"] },
  {
    label: "build",
    command: "npm",
    args: ["run", "build"],
    cleanNextBefore: true,
  },
];

async function cleanNextArtifacts() {
  // Force a clean build signal during verification so stale `.next` output
  // cannot hide regressions that would fail in CI or a fresh checkout. Retry a
  // few times because Next can leave transient handles while tearing down.
  await rm(path.join(repoRoot, ".next"), {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 200,
  });
}

async function runStep(step: Step) {
  if (step.cleanNextBefore) {
    await cleanNextArtifacts();
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: repoRoot,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `${step.label} terminated with signal ${signal}.`
            : `${step.label} failed with exit code ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}

async function main() {
  for (const step of steps) {
    console.log(`\n==> ${step.label}`);
    await runStep(step);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
