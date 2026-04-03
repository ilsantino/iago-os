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

# --- Derive variables ---
$ClientId = ($Name.ToLower() -replace '[^a-z0-9-]', '' -replace '\s+', '-').Trim('-')
$CreatedDate = Get-Date -Format "yyyy-MM-dd"
$TemplateType = if ($Internal) { "internal-project" } else { "client-project" }
$TemplateDir = Join-Path $IagoRoot "templates" $TemplateType

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
Write-Host "[2/5] Copying hooks..." -ForegroundColor Yellow
$HooksSource = Join-Path $IagoRoot ".iago" "hooks"
if (Test-Path $HooksSource) {
    $HooksDest = Join-Path $Path ".iago" "hooks"
    New-Item -Path $HooksDest -ItemType Directory -Force | Out-Null
    Copy-Item -Path (Join-Path $HooksSource "*") -Destination $HooksDest -Recurse -Force
}

# --- Step 3: Replace variables and strip .template extension ---
Write-Host "[3/5] Replacing variables..." -ForegroundColor Yellow
Get-ChildItem -Path $Path -Filter "*.template" -Recurse -File | ForEach-Object {
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

# --- Step 4: Create .iago subdirectories ---
Write-Host "[4/5] Creating .iago subdirectories..." -ForegroundColor Yellow
$subdirs = @("context", "plans", "summaries", "reviews", "state", "state/sessions")
foreach ($dir in $subdirs) {
    New-Item -Path (Join-Path $Path ".iago" $dir) -ItemType Directory -Force | Out-Null
}

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
Write-Host "  /iago:init  # gather vision and set up roadmap"
