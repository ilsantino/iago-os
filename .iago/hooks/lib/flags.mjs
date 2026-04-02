// iaGO-OS — per-hook disable via IAGO_DISABLED_HOOKS env var
// Usage: IAGO_DISABLED_HOOKS=hook-id-1,hook-id-2

export function isDisabled(hookId) {
  const raw = process.env.IAGO_DISABLED_HOOKS;
  if (!raw) return false;
  return raw.split(",").map((s) => s.trim()).includes(hookId);
}
