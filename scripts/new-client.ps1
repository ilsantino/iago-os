# iaGO-OS — Scaffold a new client project from template
# Usage: .\scripts\new-client.ps1 -Name "Acme Corp" -Project "dashboard" -Path ..\acme-dashboard
#        .\scripts\new-client.ps1 -Name "iaGO" -Project "internal-tool" -Path ..\internal-tool -Internal

param(
    [Parameter(Mandatory=$true)]
    [string]$Name,

    [Parameter(Mandatory=$true)]
    [string]$Project,

    [Parameter(Mandatory=$true)]
    [string]$Path,

    [string]$Stack = "React 19 + Vite + TS + Tailwind 4 + ShadCN + AWS Amplify Gen 2",

    [switch]$Internal
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$IagoRoot = Split-Path -Parent $ScriptDir

# `Join-Path a b c` needs -AdditionalChildPath, which is PowerShell 6+. Santiago's
# primary shell is Windows PowerShell 5.1, where it fails with "A positional
# parameter cannot be found" before the script does anything at all. Fold instead.
function Join-Segments {
    param([Parameter(Mandatory = $true)][string[]]$Segments)
    $joined = $Segments[0]
    foreach ($segment in $Segments[1..($Segments.Count - 1)]) {
        $joined = Join-Path $joined $segment
    }
    return $joined
}

# --- Derive variables ---
$ClientId = ($Name.ToLower() -replace '[^a-z0-9-]', '' -replace '\s+', '-').Trim('-')
$CreatedDate = Get-Date -Format "yyyy-MM-dd"
$TemplateType = if ($Internal) { "internal-project" } else { "client-project" }
$TemplateDir = Join-Segments $IagoRoot, "templates", $TemplateType

# --- Pre-flight checks ---
if (Test-Path $Path) {
    Write-Error "Target directory already exists: $Path`nRemove it first or choose a different path."
    exit 1
}

if (-not (Test-Path $TemplateDir)) {
    Write-Error "Template not found: $TemplateDir"
    exit 1
}

Write-Host "=== iaGO New Client ===" -ForegroundColor Cyan
Write-Host "  Client:   $Name ($ClientId)"
Write-Host "  Project:  $Project"
Write-Host "  Template: $TemplateType"
Write-Host "  Target:   $Path"
Write-Host "  Stack:    $Stack"
Write-Host ""

# --- Step 1: Copy template ---
Write-Host "[1/5] Copying template..." -ForegroundColor Yellow
Copy-Item -Path $TemplateDir -Destination $Path -Recurse -Force

# --- Step 2: Copy hooks from iaGO-OS ---
# Destination is `_config/hooks/`, per the workspace schema (§2): `hooks/` at
# `.iago/` root is a banned directory. `.claude/settings.json.template` points at
# the same path. The source moves under `_config/` in P3; both are accepted so
# this script keeps working either side of that move.
Write-Host "[2/5] Copying hooks..." -ForegroundColor Yellow
$HooksSource = $null
foreach ($candidate in @((Join-Segments $IagoRoot, ".iago", "_config", "hooks"),
                         (Join-Segments $IagoRoot, ".iago", "hooks"))) {
    if (Test-Path $candidate) { $HooksSource = $candidate; break }
}
if ($HooksSource) {
    $HooksDest = Join-Segments $Path, ".iago", "_config", "hooks"
    New-Item -Path $HooksDest -ItemType Directory -Force | Out-Null
    Copy-Item -Path (Join-Path $HooksSource "*") -Destination $HooksDest -Recurse -Force
}

# --- Step 3: Replace variables and strip .template extension ---
Write-Host "[3/5] Replacing variables..." -ForegroundColor Yellow
Get-ChildItem -Path $Path -Filter "*.template" -Recurse -File -Force | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $content = $content -replace '\{\{CLIENT_NAME\}\}', $Name
    $content = $content -replace '\{\{PROJECT_NAME\}\}', $Project
    $content = $content -replace '\{\{CLIENT_ID\}\}', $ClientId
    $content = $content -replace '\{\{CREATED_DATE\}\}', $CreatedDate
    $content = $content -replace '\{\{TECH_STACK\}\}', $Stack

    $destPath = $_.FullName -replace '\.template$', ''
    Set-Content -Path $destPath -Value $content -NoNewline
    Remove-Item $_.FullName
}

# --- Step 4: Verify the emitted .iago/ against the schema ---
# This step used to create the tree, and created three directories the schema
# bans (`context/`, `reviews/`, top-level `learnings/`). The template is now the
# single source of the tree — every directory below ships a real seed file, never
# a `.gitkeep` (a zero-byte file the linter reports). So this step asserts instead
# of creating: a missing directory means the template regressed, and scaffolding a
# non-conforming workspace silently is worse than failing here.
Write-Host "[4/5] Verifying .iago/ schema..." -ForegroundColor Yellow
$schemaDirs = @(
    "_config/runbooks", "_config/context", "_config/decisions",
    "_config/learnings", "_config/prompts",
    "plans", "research", "summaries", "state"
)
$missing = @()
foreach ($dir in $schemaDirs) {
    if (-not (Test-Path (Join-Segments $Path, ".iago", $dir))) { $missing += $dir }
}
if ($missing.Count -gt 0) {
    Write-Error ("Template emitted a non-conforming .iago/ - missing: {0}. " -f ($missing -join ", ") +
                 "Fix templates/$TemplateType/.iago/ - each directory needs a real seed file.")
    exit 1
}
# A .gitkeep copied in from the hooks source is a zero-byte file the linter
# reports (W004); the seed files make it redundant.
Get-ChildItem -Path (Join-Path $Path ".iago") -Filter ".gitkeep" -Recurse -File -Force |
    Remove-Item -Force

# --- Step 5: Init git ---
Write-Host "[5/5] Initializing git..." -ForegroundColor Yellow
Push-Location $Path
git init -q
git add -A
git commit -q -m "chore: scaffold $Project from iaGO $TemplateType template"
Pop-Location

# --- Summary ---
Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host "  Directory: $(Resolve-Path $Path)"
Write-Host "  Template:  $TemplateType"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  cd $Path"
Write-Host "  claude  # start Claude Code"
Write-Host "  /iago-init  # gather vision and set up roadmap"
