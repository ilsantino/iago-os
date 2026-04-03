# iaGO-OS — Usage Report
# Reads .iago/state/usage-log.jsonl from one or more project paths
# and produces a human-readable usage summary.
#
# Usage: .\scripts\usage-report.ps1 ..\acme-dashboard ..\beta-app
#        .\scripts\usage-report.ps1 .   (current project)

param(
    [Parameter(Mandatory=$true, Position=0, ValueFromRemainingArguments=$true)]
    [string[]]$Projects
)

$ErrorActionPreference = "Stop"

$allLines = @()
$projectsFound = 0

foreach ($project in $Projects) {
    $logFile = Join-Path $project ".iago" "state" "usage-log.jsonl"
    if (Test-Path $logFile) {
        $allLines += Get-Content $logFile -Encoding UTF8
        $projectsFound++
        Write-Host "  Found: $logFile"
    } else {
        Write-Host "  Skip: $logFile (not found)"
    }
}

if ($projectsFound -eq 0) {
    Write-Host ""
    Write-Host "No usage logs found. Run some iaGO skills first!"
    exit 0
}

Write-Host ""
Write-Host "=== iaGO Usage Report ===" -ForegroundColor Cyan
Write-Host "  Projects scanned: $projectsFound"
Write-Host ""

# Parse events
$events = @()
foreach ($line in $allLines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try {
        $events += ($line | ConvertFrom-Json)
    } catch { continue }
}

# Skill frequency
$skills = @{}
$events | Where-Object { $_.event -eq "skill_invoked" } | ForEach-Object {
    $name = $_.skill
    if ($skills.ContainsKey($name)) { $skills[$name]++ } else { $skills[$name] = 1 }
}

# Agent frequency
$agents = @{}
$events | Where-Object { $_.event -eq "agent_dispatched" } | ForEach-Object {
    $name = $_.agent
    if ($agents.ContainsKey($name)) { $agents[$name]++ } else { $agents[$name] = 1 }
}

# Session stats
$sessions = $events | Where-Object { $_.event -eq "session_end" }
$durations = $sessions | ForEach-Object { $_.duration_min }
$avgDuration = 0
if ($durations.Count -gt 0) {
    $avgDuration = [math]::Round(($durations | Measure-Object -Sum).Sum / $durations.Count)
}

# Common workflows
$workflows = @{}
foreach ($s in $sessions) {
    $skillList = @()
    if ($s.skills_used) { $skillList = $s.skills_used | Sort-Object }
    $key = $skillList -join " -> "
    if ($key) {
        if ($workflows.ContainsKey($key)) { $workflows[$key]++ } else { $workflows[$key] = 1 }
    }
}

# --- Output ---
Write-Host "--- Skill Frequency ---" -ForegroundColor Yellow
if ($skills.Count -eq 0) { Write-Host "  (no skill invocations recorded)" }
$skills.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
    Write-Host ("  {0,-35}{1} invocations" -f $_.Key, $_.Value)
}

Write-Host ""
Write-Host "--- Agent Frequency ---" -ForegroundColor Yellow
if ($agents.Count -eq 0) { Write-Host "  (no agent dispatches recorded)" }
$agents.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
    Write-Host ("  {0,-35}{1} dispatches" -f $_.Key, $_.Value)
}

Write-Host ""
Write-Host "--- Session Summary ---" -ForegroundColor Yellow
Write-Host "  Total sessions:        $($sessions.Count)"
Write-Host "  Avg duration (min):    $avgDuration"
Write-Host "  Total events:          $($events.Count)"

Write-Host ""
Write-Host "--- Common Workflows ---" -ForegroundColor Yellow
if ($workflows.Count -eq 0) { Write-Host "  (no completed sessions recorded)" }
$workflows.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 10 | ForEach-Object {
    Write-Host ("  [{0}x] {1}" -f $_.Value, $_.Key)
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
