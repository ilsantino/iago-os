#!/usr/bin/env node

// iaGO-OS — Console Gate
// Starts vite preview, navigates routes with Playwright, captures console errors/warnings.
// Exit 0 = clean, exit 1 = errors found (JSON array on stdout).
//
// Usage: node console-check.mjs --project-dir /path/to/project [--routes /path/to/routes.json]

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let projectDir = "";
let routesFile = "";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--project-dir" && args[i + 1]) projectDir = args[++i];
  if (args[i] === "--routes" && args[i + 1]) routesFile = args[++i];
}

if (!projectDir) {
  console.error("Usage: console-check.mjs --project-dir <dir> [--routes <file>]");
  process.exit(2);
}

// ── Noise filter ────────────────────────────────────────────────────
const BUILTIN_IGNORE = [
  "Download the React DevTools",
  "[HMR]",
  "favicon.ico",
  "[vite]",
  "the server is running in production mode",
  "Third-party cookie will be blocked",
  "DevTools failed to load",
];

const ignorePatterns = [...BUILTIN_IGNORE];
const ignoreFile = join(projectDir, ".iago", "console-ignore");
if (existsSync(ignoreFile)) {
  const lines = readFileSync(ignoreFile, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  ignorePatterns.push(...lines);
}

function isNoise(text) {
  return ignorePatterns.some((p) => text.includes(p));
}

// ── Routes ──────────────────────────────────────────────────────────
function loadRoutes() {
  if (routesFile && existsSync(routesFile)) {
    return JSON.parse(readFileSync(routesFile, "utf-8"));
  }
  const projectRoutes = join(projectDir, ".iago", "console-routes.json");
  if (existsSync(projectRoutes)) {
    return JSON.parse(readFileSync(projectRoutes, "utf-8"));
  }
  return ["/"];
}

const routes = loadRoutes();

// ── Check Playwright availability ───────────────────────────────────
try {
  execSync("npx playwright --version", { cwd: projectDir, stdio: "ignore" });
} catch {
  console.error("SKIP: Playwright not available in project");
  process.exit(0);
}

// ── Start vite preview ──────────────────────────────────────────────
const port = 4173 + Math.floor(Math.random() * 1000);
const preview = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], {
  cwd: projectDir,
  stdio: ["ignore", "pipe", "pipe"],
  shell: true,
});

let previewReady = false;
const baseUrl = `http://localhost:${port}`;

// Wait for vite preview to be ready
const readyPromise = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error("vite preview did not start within 15s"));
  }, 15_000);

  function checkOutput(data) {
    const text = data.toString();
    if (text.includes("Local:") || text.includes(`localhost:${port}`)) {
      previewReady = true;
      clearTimeout(timeout);
      resolve();
    }
  }

  preview.stdout.on("data", checkOutput);
  preview.stderr.on("data", checkOutput);
});

// ── Cleanup helper ──────────────────────────────────────────────────
function cleanup() {
  if (preview && !preview.killed) {
    preview.kill("SIGTERM");
    // On Windows, SIGTERM may not work — force kill after 2s
    setTimeout(() => {
      if (!preview.killed) {
        try { process.kill(preview.pid, "SIGKILL"); } catch { /* already dead */ }
      }
    }, 2000);
  }
}

process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

// ── Run checks ──────────────────────────────────────────────────────
async function run() {
  try {
    await readyPromise;
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    cleanup();
    process.exit(2);
  }

  // Dynamic import — Playwright is in the client project, not iaGO-OS
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    // Try project-local playwright
    try {
      ({ chromium } = await import(join(projectDir, "node_modules", "playwright", "index.mjs")));
    } catch {
      console.error("SKIP: Cannot import playwright");
      cleanup();
      process.exit(0);
    }
  }

  const browser = await chromium.launch({ headless: true });
  const errors = [];

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on("console", (msg) => {
      const type = msg.type();
      if (type !== "error" && type !== "warning") return;
      const text = msg.text();
      if (isNoise(text)) return;
      errors.push({ type, text, url: page.url(), route: currentRoute });
    });

    page.on("pageerror", (err) => {
      const text = err.message || String(err);
      if (isNoise(text)) return;
      errors.push({ type: "pageerror", text, url: page.url(), route: currentRoute });
    });

    let currentRoute = "/";

    for (const route of routes) {
      currentRoute = route;
      try {
        await page.goto(`${baseUrl}${route}`, {
          waitUntil: "networkidle",
          timeout: 15_000,
        });
        // Extra settle time for async React renders
        await page.waitForTimeout(1000);
      } catch (navErr) {
        errors.push({
          type: "navigation",
          text: `Failed to navigate to ${route}: ${navErr.message}`,
          url: `${baseUrl}${route}`,
          route,
        });
      }
    }
  } finally {
    await browser.close();
    cleanup();
  }

  if (errors.length > 0) {
    console.log(JSON.stringify(errors, null, 2));
    process.exit(1);
  }

  process.exit(0);
}

run();
