// iaGO-OS — stdin JSON parser for Claude Code hooks
// Reads stdin up to 1MB, parses as JSON, returns the parsed object.

const MAX_BYTES = 1024 * 1024; // 1MB

export async function readInput() {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of process.stdin) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BYTES) break;
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
