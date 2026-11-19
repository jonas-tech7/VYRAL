// Runs the Next.js dev server and the background worker together.
//   npm run dev:all
import { spawn } from "node:child_process";

const procs = [
  spawn("npx", ["next", "dev"], { stdio: "inherit", shell: process.platform === "win32" }),
  spawn("npx", ["tsx", "src/worker/index.ts"], { stdio: "inherit", shell: process.platform === "win32" }),
];

const stop = () => {
  for (const p of procs) p.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => code && code !== 0 && stop());
