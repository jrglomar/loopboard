#!/usr/bin/env node
/**
 * Run all dev services for the Loopboard in one terminal:
 *   - mcp-jira   HTTP bridge   → http://localhost:4001
 *   - mcp-github HTTP bridge   → http://localhost:4002
 *   - react-app  Vite dev      → http://localhost:5173
 *
 * Dependency-free (plain Node). Prefixes + colorizes each service's output,
 * and shuts the whole group down on Ctrl+C or if any service exits.
 *
 *   npm run dev:all
 *
 * The bridges read your repo-root / package .env (Jira + optional GitHub/AI keys).
 * For Copilot (stdio) servers, VS Code launches them from .vscode/mcp.json — they
 * are NOT started here (this script is for the dashboard + bridges).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

// Repo root = parent of this scripts/ dir (robust on Windows + POSIX).
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const reset = "\x1b[0m";
const services = [
  { name: "jira  ", color: "\x1b[36m", args: ["run", "dev:jira:http"], url: "http://localhost:4001/api/health" },
  { name: "github", color: "\x1b[35m", args: ["run", "dev:github:http"], url: "http://localhost:4002/api/health" },
  { name: "app   ", color: "\x1b[32m", args: ["run", "dev:app"], url: "http://localhost:5173" },
];

const children = [];
let shuttingDown = false;

function pipe(stream, name, color) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() !== "") console.log(`${color}[${name}]${reset} ${line}`);
    }
  });
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reason) console.log(`\n${reason} — stopping all services…`);
  for (const c of children) {
    if (c.exitCode === null && c.pid) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
      } else {
        c.kill("SIGTERM");
      }
    }
  }
  setTimeout(() => process.exit(0), 600);
}

console.log("Starting all services — jira:4001 · github:4002 · app:5173.  Press Ctrl+C to stop.\n");

for (const svc of services) {
  // shell:true so `npm` resolves on Windows; cwd is the repo root (this script lives in scripts/).
  const child = spawn("npm", svc.args, { shell: true, cwd: repoRoot });
  pipe(child.stdout, svc.name, svc.color);
  pipe(child.stderr, svc.name, svc.color);
  child.on("exit", (code) => {
    if (!shuttingDown) shutdown(`${svc.color}[${svc.name}]${reset} exited (code ${code})`);
  });
  children.push(child);
}

process.on("SIGINT", () => shutdown("Ctrl+C"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
