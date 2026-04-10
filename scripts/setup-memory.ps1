# setup-memory.ps1 — Windows PowerShell wrapper for memory stack setup
#
# Delegates to setup-memory.sh via Git Bash. If Git Bash is unavailable,
# provides manual instructions.
#
# Usage:
#   .\scripts\setup-memory.ps1              # Full install
#   .\scripts\setup-memory.ps1 -DryRun      # Preview without changes

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BashScript = Join-Path $ScriptDir "setup-memory.sh"

# Find Git Bash
$GitBashPaths = @(
    "C:\Program Files\Git\bin\bash.exe",
    "C:\Program Files (x86)\Git\bin\bash.exe",
    "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
)

$GitBash = $null
foreach ($path in $GitBashPaths) {
    if (Test-Path $path) {
        $GitBash = $path
        break
    }
}

if (-not $GitBash) {
    # Try PATH
    $GitBash = Get-Command bash -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}

if (-not $GitBash) {
    Write-Host ""
    Write-Host "Git Bash not found. Install Git for Windows from https://git-scm.com/" -ForegroundColor Red
    Write-Host ""
    Write-Host "Alternatively, run the setup manually:" -ForegroundColor Yellow
    Write-Host "  1. pip install mempalace graphifyy python-docx openpyxl"
    Write-Host "  2. Copy templates/memory/*.json to ~/.mempalace/"
    Write-Host "  3. Copy templates/memory/session-diary.py to ~/.claude/scripts/"
    Write-Host "  4. See docs/memory-stack.md for MCP server + hook registration"
    Write-Host ""
    exit 1
}

# Convert to Unix-style path for bash
$BashScriptUnix = $BashScript -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'
# Lowercase the drive letter for Git Bash compatibility
if ($BashScriptUnix -match '^/([A-Z])') {
    $BashScriptUnix = '/' + $Matches[1].ToLower() + $BashScriptUnix.Substring(2)
}

$BashArgs = @($BashScriptUnix)
if ($DryRun) {
    $BashArgs += "--dry-run"
}

Write-Host "Running setup via Git Bash..." -ForegroundColor Cyan
& $GitBash @Args
