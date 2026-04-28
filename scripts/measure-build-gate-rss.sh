#!/usr/bin/env bash
# Memory-pressure driver for the build gate. Runs `run_build_gate` against a
# target project while a PowerShell background sampler polls `Get-Process`
# for tsc/vite/node/npx workers and records PeakWorkingSet64.
#
# Usage:
#   IAGO_PARALLEL_BUILD=0 bash scripts/measure-build-gate-rss.sh clients/munet-web
#   IAGO_PARALLEL_BUILD=1 bash scripts/measure-build-gate-rss.sh clients/munet-web
#
# Output: a single block written to stdout, easy to paste under the Results
# table in .iago/runbooks/build-gate-memory-pressure.md.
#
# Windows-only by design — the sampler shells out to PowerShell. On other
# OSes wire your own ps-based sampler (left for future contributors).

set -uo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <project-dir>" >&2
  exit 2
fi

target="$1"
if [[ ! -d "$target" ]]; then
  echo "ERROR: target '$target' is not a directory" >&2
  exit 2
fi

if ! command -v powershell >/dev/null 2>&1; then
  echo "ERROR: powershell not on PATH — Windows-only driver" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib/build-gate.sh"

scratch=$(mktemp -d -t build-gate-rss.XXXXXX)
trap 'rm -rf "$scratch"' EXIT

PROJECT_DIR="$(cd "$target" && pwd)"
PIPELINE_TMP="$scratch"
HAS_TSCONFIG=false
HAS_VITE=false
[[ -f "$PROJECT_DIR/tsconfig.json" ]] && HAS_TSCONFIG=true
for ext in ts js mjs; do
  [[ -f "$PROJECT_DIR/vite.config.$ext" ]] && HAS_VITE=true && break
done
export PROJECT_DIR PIPELINE_TMP HAS_TSCONFIG HAS_VITE

mode="sequential"
[[ "${IAGO_PARALLEL_BUILD:-0}" == "1" ]] && mode="parallel"

# Capture pre-run free RAM.
free_before_mb=$(powershell -NoProfile -Command \
  '[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)')

sample_log="$scratch/samples.log"
sampler_done="$scratch/sampler.done"

# Start PowerShell sampler in background. Polls every 250 ms for the relevant
# process names and writes one line per sample with timestamp + per-proc RSS.
# Stops when $sampler_done exists. PIDs of pre-existing processes are recorded
# at start so we can exclude their RSS from the peak attribution.
powershell -NoProfile -Command "
  \$names = @('node','tsc','vite','npx')
  \$baseline = @{}
  foreach (\$p in Get-Process -Name \$names -ErrorAction SilentlyContinue) {
    \$baseline[\$p.Id] = \$true
  }
  while (-not (Test-Path '$sampler_done')) {
    \$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    \$totalNew = 0
    foreach (\$p in Get-Process -Name \$names -ErrorAction SilentlyContinue) {
      if (-not \$baseline.ContainsKey(\$p.Id)) {
        \$totalNew += \$p.WorkingSet64
      }
    }
    \$totalNewMB = [math]::Round(\$totalNew / 1MB)
    \$freeMB = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
    Add-Content -LiteralPath '$sample_log' -Value \"\$ts \$totalNewMB \$freeMB\"
    Start-Sleep -Milliseconds 250
  }
" >/dev/null 2>&1 &
sampler_pid=$!

# Run the gate.
gate_start_ms=$(date -u +%s%3N 2>/dev/null || echo 0)
gate_exit=0
run_build_gate || gate_exit=$?
gate_end_ms=$(date -u +%s%3N 2>/dev/null || echo 0)
wall_ms=$(( gate_end_ms - gate_start_ms ))

# Stop sampler.
: > "$sampler_done"
wait "$sampler_pid" 2>/dev/null || true

# Reduce samples to peak RSS (MB) and minimum free RAM (MB).
if [[ -s "$sample_log" ]]; then
  read -r peak_rss_mb min_free_mb < <(awk '
    NR == 1 || $2 > peak { peak = $2 }
    NR == 1 || $3 < minfree { minfree = $3 }
    END { printf "%d %d\n", peak, minfree }
  ' "$sample_log")
else
  peak_rss_mb=0
  min_free_mb=0
fi

oom="no"
# Heuristic: if free RAM dropped below 200 MB during the run, flag suspected
# pressure. Real OOM on Windows manifests as a process kill — surface that
# via gate_exit, since a killed worker fails the gate.
(( min_free_mb < 200 )) && oom="suspected (free RAM dropped to ${min_free_mb} MB)"
[[ $gate_exit -ne 0 ]] && oom="${oom} | gate_exit=${gate_exit}"

cat <<EOF
# Build-gate RSS measurement
date:           $(date -u +%Y-%m-%dT%H:%M:%SZ)
target:         $target
mode:           $mode
gate_exit:      $gate_exit
wall_ms:        $wall_ms
wall_s:         $(awk -v ms="$wall_ms" 'BEGIN{printf "%.1f", ms/1000}')
peak_rss_mb:    $peak_rss_mb
free_before_mb: $free_before_mb
min_free_mb:    $min_free_mb
oom:            $oom
samples_file:   $sample_log
EOF
