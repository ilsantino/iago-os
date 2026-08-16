// iaGO-OS — Claude Code transcript JSONL reader
// Reads the transcript file, extracts token usage, decisions, and file modifications.

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function findTranscriptDir() {
  // Claude Code stores transcripts in ~/.claude/projects/<hash>/
  const claudeDir = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeDir)) return null;
  return claudeDir;
}

function findLatestTranscript() {
  const projectsDir = findTranscriptDir();
  if (!projectsDir) return null;

  try {
    const dirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(projectsDir, d.name));

    // Find most recent JSONL file across all project dirs
    let latest = null;
    let latestMtime = 0;

    for (const dir of dirs) {
      try {
        const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
        for (const f of files) {
          const fp = join(dir, f);
          const { mtimeMs } = statSync(fp);
          if (mtimeMs > latestMtime) {
            latestMtime = mtimeMs;
            latest = fp;
          }
        }
      } catch {
        // skip inaccessible dirs
      }
    }
    return latest;
  } catch {
    return null;
  }
}

// Real transcript lines wrap their blocks: {type:"assistant", message:{role, content:[...]}}.
// Reading a top-level `role` / `tool_name` / `content` matches nothing.
function* assistantBlocks(entries) {
  for (const entry of entries) {
    if (entry?.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && typeof block === "object") yield block;
    }
  }
}

export function readTranscript(path) {
  // `path` comes from the hook payload's transcript_path. The mtime scan below
  // is a fallback only: it takes the globally newest transcript, which during a
  // pipeline run is almost never the session that fired the hook.
  const filePath = path || findLatestTranscript();
  if (!filePath || !existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, "utf8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function getTokenUsage(path) {
  const entries = readTranscript(path);
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  for (const entry of entries) {
    const usage = entry.usage || entry.message?.usage;
    if (!usage) continue;
    inputTokens += usage.input_tokens || 0;
    outputTokens += usage.output_tokens || 0;
    cacheReadTokens += usage.cache_read_input_tokens || usage.cache_read_tokens || 0;
    cacheCreationTokens += usage.cache_creation_input_tokens || usage.cache_creation_tokens || 0;
  }

  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
}

const DECISION_MARKERS = [
  "decided", "choosing", "going with", "approach:",
  "verdict:", "we'll use", "picked", "selected",
];

export function extractDecisions(path) {
  const entries = readTranscript(path);
  const decisions = [];

  for (const block of assistantBlocks(entries)) {
    if (block.type !== "text") continue;
    const text = block.text || "";

    for (const sentence of text.split(/[.!?\n]+/)) {
      const lower = sentence.toLowerCase();
      if (DECISION_MARKERS.some((m) => lower.includes(m))) {
        const trimmed = sentence.trim();
        if (trimmed.length > 10 && trimmed.length < 200) {
          decisions.push(trimmed);
          if (decisions.length >= 10) return decisions;
        }
      }
    }
  }
  return decisions;
}

export function getFilesModified(path) {
  const entries = readTranscript(path);
  const files = new Set();

  const WRITERS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
  for (const block of assistantBlocks(entries)) {
    if (block.type !== "tool_use" || !WRITERS.has(block.name)) continue;
    const filePath = block.input?.file_path || block.input?.path;
    if (filePath) files.add(filePath);
  }
  return [...files];
}
