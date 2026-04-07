// iaGO-OS — Safety Guard hook
// Event: PreToolUse, Matcher: Bash|Edit|Write|MultiEdit
// Blocks destructive commands, detects secrets, catches injection attempts.

import { readInput } from "./lib/stdin.mjs";
import { isDisabled } from "./lib/flags.mjs";
import { basename } from "path";

if (isDisabled("safety-guard")) process.exit(0);

// === Destructive Command Patterns (Bash only) ===
const DESTRUCTIVE_PATTERNS = [
  { re: /rm\s+-[a-zA-Z]*r[a-zA-Z]*f\b.*(?:\/\s*$|\/\*|\.\.\/)/, msg: "rm -rf on root/parent", allow: /(?:node_modules|dist|\.next|build|coverage|\.iago\/state)/ },
  { re: /rm\s+-[a-zA-Z]*r[a-zA-Z]*f\b.*\s+\/(?:usr|etc|home|var|tmp|boot|sys|proc|Windows|Users|Program)/, msg: "rm -rf system directory" },
  { re: /git\s+push\s+.*--force(?!-with-lease)(?:\s|$)/, msg: "git push --force (use --force-with-lease)" },
  { re: /git\s+push\s+.*(?:origin|upstream)\s+(?:main|master)\s*.*--force/, msg: "force push to main/master" },
  { re: /git\s+(?:reset\s+--hard|clean\s+-[a-zA-Z]*f[a-zA-Z]*d)/, msg: "git reset --hard or clean -fd" },
  { re: /(?:DROP|TRUNCATE)\s+(?:TABLE|DATABASE|SCHEMA)/i, msg: "SQL destructive operation", allow: /migrat/i },
  { re: /(?:mkfs|(?:^|\s)format\s+[A-Za-z]:|fdisk|dd\s+if=)/, msg: "disk format/write" },
  { re: /chmod\s+(?:777|a\+rwx)/, msg: "world-writable permissions" },
  { re: />\s*\/dev\/sd[a-z]/, msg: "direct block device write" },
  { re: /curl\s+.*\|\s*(?:ba)?sh/, msg: "pipe-to-shell" },
  { re: /(?:shutdown|reboot|halt|init\s+[06])\b/, msg: "system power command" },
  { re: /npm\s+publish(?:\s|$)/, msg: "npm publish", warn: true },
  { re: /git\s+branch\s+-[dD]\s+(?:main|master)/, msg: "delete main/master branch" },
];

// === Secret Detection Patterns ===
const SECRET_PATTERNS = [
  { re: /AKIA[0-9A-Z]{16}/, msg: "AWS Access Key ID", scope: "both" },
  { re: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*\S{20,}/, msg: "AWS Secret Key", scope: "both" },
  { re: /ghp_[A-Za-z0-9]{36}/, msg: "GitHub PAT", scope: "both" },
  { re: /gho_[A-Za-z0-9]{36}/, msg: "GitHub OAuth Token", scope: "both" },
  { re: /ghs_[A-Za-z0-9]{36}/, msg: "GitHub Server Token", scope: "both" },
  { re: /github_pat_[A-Za-z0-9_]{82}/, msg: "GitHub Fine-grained PAT", scope: "both" },
  { re: /sk-ant-[A-Za-z0-9-]{80,}/, msg: "Anthropic API Key", scope: "both" },
  { re: /sk-[A-Za-z0-9]{48,}/, msg: "OpenAI API Key", scope: "both" },
  { re: /sk_(?:live|test)_[A-Za-z0-9]{24,}/, msg: "Stripe Secret Key", scope: "both" },
  { re: /pk_live_[A-Za-z0-9]{24,}/, msg: "Stripe Live Publishable Key", scope: "both" },
  { re: /xox[bpoas]-[A-Za-z0-9-]{10,}/, msg: "Slack Token", scope: "both" },
  { re: /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH)?\s*PRIVATE\s+KEY-----/, msg: "Private Key", scope: "both" },
  { re: /(?:password|passwd|pwd)\s*[=:]\s*['"][^'"]{8,}['"]/, msg: "Hardcoded password", scope: "writes" },
  { re: /(?:secret|token|api_key|apikey|auth_token)\s*[=:]\s*['"][A-Za-z0-9+/=_\-]{16,}['"]/, msg: "Generic secret", scope: "writes" },
  { re: /(?:mongodb(?:\+srv)?:\/\/)[^\s'"]+:[^\s'"]+@/, msg: "MongoDB connection string", scope: "both" },
  { re: /(?:postgres(?:ql)?:\/\/)[^\s'"]+:[^\s'"]+@/, msg: "PostgreSQL connection string", scope: "both" },
  { re: /(?:mysql:\/\/)[^\s'"]+:[^\s'"]+@/, msg: "MySQL connection string", scope: "both" },
];

// === Injection Detection Patterns ===
const INJECTION_PATTERNS = [
  { re: /<system>|<\|im_start\|>|\[INST\]|<\|system\|>/, msg: "prompt injection marker" },
  { re: /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i, msg: "classic injection phrasing" },
];

const CONFIG_EXTENSIONS = new Set([".md", ".txt", ".yaml", ".yml", ".json"]);
const TEST_PATTERNS = [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /__tests__\//];
const EXEMPT_FILES = [".env.example", ".env.template"];

function isTestFile(filePath) {
  return TEST_PATTERNS.some((p) => p.test(filePath));
}

function isExemptFile(filePath) {
  const name = basename(filePath);
  return EXEMPT_FILES.includes(name);
}

function isConfigFile(filePath) {
  const ext = filePath.substring(filePath.lastIndexOf("."));
  return CONFIG_EXTENSIONS.has(ext);
}

function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*");
}

async function main() {
  const input = await readInput();
  const toolName = input.tool_name;

  // === Bash: destructive command check ===
  if (toolName === "Bash") {
    const command = input.tool_input?.command || "";

    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.re.test(command)) {
        if (pattern.allow && pattern.allow.test(command)) continue;

        if (pattern.warn) {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: `iaGO WARNING: ${pattern.msg}`,
          }));
          process.exit(0);
        }

        process.stdout.write(JSON.stringify({
          decision: "block",
          reason: `iaGO: Blocked — ${pattern.msg}`,
        }));
        process.exit(2);
      }
    }

    // Secret detection in Bash commands (scope: "both" only)
    for (const secret of SECRET_PATTERNS) {
      if (secret.scope !== "both") continue;
      if (secret.re.test(command)) {
        process.stdout.write(JSON.stringify({
          decision: "block",
          reason: `iaGO: Possible ${secret.msg} in Bash command. Use environment variables instead.`,
        }));
        process.exit(2);
      }
    }
  }

  // === Edit/Write/MultiEdit: secret + injection detection ===
  if (["Edit", "Write", "MultiEdit"].includes(toolName)) {
    const filePath = input.tool_input?.file_path || "";
    const content = input.tool_input?.new_string || input.tool_input?.content || "";

    // Path traversal check
    if (/\.\.[/\\]/.test(filePath)) {
      process.stdout.write(JSON.stringify({
        decision: "block",
        reason: `iaGO: Blocked — path traversal detected in "${filePath}"`,
      }));
      process.exit(2);
    }

    // Skip test files and exempt files for secret detection
    if (!isTestFile(filePath) && !isExemptFile(filePath)) {
      // Secret detection
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (isCommentLine(lines[i])) continue;

        for (const secret of SECRET_PATTERNS) {
          if (secret.re.test(lines[i])) {
            // Skip pk_test_ Stripe keys
            if (/pk_test_/.test(lines[i])) continue;

            process.stdout.write(JSON.stringify({
              decision: "block",
              reason: `iaGO: Possible ${secret.msg} detected on line ${i + 1}. Use environment variables instead.`,
            }));
            process.exit(2);
          }
        }
      }
    }

    // Injection detection (config/doc files only)
    if (isConfigFile(filePath)) {
      for (const inj of INJECTION_PATTERNS) {
        if (inj.re.test(content)) {
          process.stdout.write(JSON.stringify({
            decision: "block",
            reason: `iaGO: Blocked — ${inj.msg} detected in "${basename(filePath)}"`,
          }));
          process.exit(2);
        }
      }

      // Base64 payload check (>500 chars)
      const base64Match = content.match(/[A-Za-z0-9+/=]{500,}/);
      if (base64Match) {
        process.stdout.write(JSON.stringify({
          decision: "block",
          reason: `iaGO: Blocked — large encoded payload (${base64Match[0].length} chars) in "${basename(filePath)}"`,
        }));
        process.exit(2);
      }
    }
  }
}

main().catch((err) => { process.stderr.write("iaGO hook crash: " + (err?.message || "unknown") + "\n"); process.exit(2); });
