// iaGO-OS — Commit Quality hook
// Event: PreToolUse, Matcher: Bash
// Validates conventional commit messages and scans staged changes for secrets.

// Edge cases handled:
// - Commit message via -m flag (single or multiple -m)
// - Commit message via heredoc $(cat <<'EOF'...\nEOF)
// - Escaped newlines in JSON input (\\n vs real newlines)
// - Multi-line messages (subject extracted from first line)

import { readInput } from "./lib/stdin.mjs";
import { isDisabled } from "./lib/flags.mjs";
import { execSync } from "child_process";

if (isDisabled("commit-quality")) process.exit(0);

const CONVENTIONAL_RE = /^(feat|fix|refactor|docs|chore|research|build|test|ci|perf|style|revert)(\(.+\))?!?:\s/;
const MAX_SUBJECT_LENGTH = 72;

// Secret patterns (same as safety-guard, applied to staged diff)
const SECRET_PATTERNS = [
  { re: /AKIA[0-9A-Z]{16}/, msg: "AWS Access Key ID" },
  { re: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*\S{20,}/, msg: "AWS Secret Key" },
  { re: /ghp_[A-Za-z0-9]{36}/, msg: "GitHub PAT" },
  { re: /gho_[A-Za-z0-9]{36}/, msg: "GitHub OAuth Token" },
  { re: /ghs_[A-Za-z0-9]{36}/, msg: "GitHub Server Token" },
  { re: /github_pat_[A-Za-z0-9_]{82}/, msg: "GitHub Fine-grained PAT" },
  { re: /sk-ant-[A-Za-z0-9-]{80,}/, msg: "Anthropic API Key" },
  { re: /sk-[A-Za-z0-9]{48,}/, msg: "OpenAI API Key" },
  { re: /sk_(?:live|test)_[A-Za-z0-9]{24,}/, msg: "Stripe Secret Key" },
  { re: /pk_live_[A-Za-z0-9]{24,}/, msg: "Stripe Live Publishable Key" },
  { re: /xox[bpoas]-[A-Za-z0-9-]{10,}/, msg: "Slack Token" },
  { re: /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH)?\s*PRIVATE\s+KEY-----/, msg: "Private Key" },
  { re: /(?:mongodb(?:\+srv)?:\/\/)[^\s'"]+:[^\s'"]+@/, msg: "MongoDB connection string" },
  { re: /(?:postgres(?:ql)?:\/\/)[^\s'"]+:[^\s'"]+@/, msg: "PostgreSQL connection string" },
  { re: /(?:mysql:\/\/)[^\s'"]+:[^\s'"]+@/, msg: "MySQL connection string" },
];

function extractCommitMessage(command) {
  // Check heredoc FIRST: -m "$(cat <<'EOF'\n...\nEOF\n)" — real or JSON-escaped \n.
  // Must run before the -m branch because the -m regex would greedily swallow the
  // entire $(cat ...) block as the message, returning a non-conventional string.
  const heredoc = command.match(/\$\(cat\s+<<'?EOF'?\s*(?:\\n|\n)([\s\S]*?)(?:\\n|\n)\s*EOF/);
  if (heredoc) return heredoc[1].split(/\\n|\n/)[0].trim(); // First line = subject

  // Match plain -m "message" or -m 'message' (no heredoc)
  const mFlag = command.match(/-m\s+(?:"([^"]+)"|'([^']+)')/);
  if (mFlag) return mFlag[1] || mFlag[2];

  return null;
}

function getCurrentBranch() {
  try {
    return execSync("git branch --show-current", { encoding: "utf8", timeout: 2000 }).trim();
  } catch { return ""; }
}

async function main() {
  const input = await readInput();
  const command = input.tool_input?.command || "";

  // Only activate on git commit commands
  if (!/git\s+commit/.test(command)) process.exit(0);

  // === Commit message validation ===
  const message = extractCommitMessage(command);

  if (message) {
    const subject = message.split("\n")[0];

    // Conventional prefix
    if (!CONVENTIONAL_RE.test(subject)) {
      process.stdout.write(JSON.stringify({
        decision: "block",
        reason: "iaGO: Commit message must start with a conventional prefix (feat, fix, refactor, docs, chore, research, build, test, ci, perf, style, revert)",
      }));
      process.exit(2);
    }

    // Subject length
    if (subject.length > MAX_SUBJECT_LENGTH) {
      process.stdout.write(JSON.stringify({
        decision: "block",
        reason: `iaGO: Commit subject exceeds ${MAX_SUBJECT_LENGTH} characters (${subject.length} chars)`,
      }));
      process.exit(2);
    }

    // Non-empty description
    const afterPrefix = subject.replace(CONVENTIONAL_RE, "").trim();
    if (!afterPrefix) {
      process.stdout.write(JSON.stringify({
        decision: "block",
        reason: "iaGO: Commit message has no description after the prefix",
      }));
      process.exit(2);
    }

    // No WIP on main
    const branch = getCurrentBranch();
    if ((branch === "main" || branch === "master") && /^wip:/i.test(subject)) {
      process.stdout.write(JSON.stringify({
        decision: "block",
        reason: "iaGO: WIP commits not allowed on main/master",
      }));
      process.exit(2);
    }
  }

  // === Staged diff secret scan ===
  try {
    const diff = execSync("git diff --cached --no-color", {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 5 * 1024 * 1024,
    });

    const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));

    for (let i = 0; i < addedLines.length; i++) {
      const line = addedLines[i];

      // Skip test files in diff (check the --- / +++ headers)
      // Simple heuristic: skip lines that look like test content

      for (const secret of SECRET_PATTERNS) {
        if (secret.re.test(line)) {
          // Skip pk_test_ Stripe keys
          if (/pk_test_/.test(line)) continue;

          process.stdout.write(JSON.stringify({
            decision: "block",
            reason: `iaGO: Possible ${secret.msg} in staged changes`,
          }));
          process.exit(2);
        }
      }
    }

    // Console.log warning (non-blocking)
    const jsLines = addedLines.filter((l) => /console\.log\s*\(/.test(l));
    if (jsLines.length > 0) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: `iaGO: console.log found in staged changes (${jsLines.length} occurrence${jsLines.length > 1 ? "s" : ""})`,
      }));
    }
  } catch {
    // git diff failed — non-fatal
  }
}

main().catch(() => process.exit(0));
