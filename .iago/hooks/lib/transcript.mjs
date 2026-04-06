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

export function readTranscript(path) {
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

  for (const entry of entries) {
    if (entry.role !== "assistant" || !entry.content) continue;
    const text = typeof entry.content === "string"
      ? entry.content
      : Array.isArray(entry.content)
        ? entry.content.filter((b) => b.type === "text").map((b) => b.text).join(" ")
        : "";

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

  for (const entry of entries) {
    const toolInput = entry.tool_input || entry.message?.tool_input;
    if (!toolInput) continue;
    const filePath = toolInput.file_path || toolInput.path;
    if (filePath && (entry.tool_name === "Edit" || entry.tool_name === "Write" || entry.tool_name === "MultiEdit")) {
      files.add(filePath);
    }
  }
  return [...files];
}
