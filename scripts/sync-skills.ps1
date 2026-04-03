# iaGO-OS — Sync skills, agents, and rules to a client project
# Usage: .\scripts\sync-skills.ps1 -Target ..\acme-dashboard
#        .\scripts\sync-skills.ps1 -Target ..\acme-dashboard -DryRun

param(
    [Parameter(Mandatory=$false)]
    [string]$Target,

    [switch]$Global,

    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$IagoRoot = Split-Path -Parent $ScriptDir

# --- Validate ---
if ($Global) {
    $Target = Join-Path $HOME ".claude"
    New-Item -Path $Target -ItemType Directory -Force | Out-Null
} elseif (-not $Target) {
    Write-Error "Either -Target or -Global is required"
    exit 1
} elseif (-not (Test-Path $Target)) {
    Write-Error "Target does not exist: $Target"
    exit 1
} else {
    $Target = Resolve-Path $Target
}

Write-Host "=== iaGO Sync Skills ===" -ForegroundColor Cyan
Write-Host "  Source: $IagoRoot"
Write-Host "  Target: $Target"
if ($Global) { Write-Host "  Mode:   GLOBAL (no hooks)" -ForegroundColor Magenta }
if ($DryRun) { Write-Host "  Mode:   DRY RUN" -ForegroundColor Yellow }
Write-Host ""

function Sync-Directory {
    param(
        [string]$Name,
        [string]$SrcBase,
        [string]$DstBase
    )

    $src = Join-Path $SrcBase $Name
    $dst = Join-Path $DstBase $Name

    if (-not (Test-Path $src)) {
        Write-Host "  Skip: $Name (source not found)"
        return
    }

    $srcFiles = Get-ChildItem -Path $src -Recurse -File
    $srcCount = $srcFiles.Count

    $dstCount = 0
    if (Test-Path $dst) {
        $dstCount = (Get-ChildItem -Path $dst -Recurse -File).Count
    }

    Write-Host "  ${Name}: $srcCount source files, $dstCount in target"

    if ($DryRun) {
        if (Test-Path $dst) {
            $srcFiles | ForEach-Object {
                $rel = $_.FullName.Substring($src.Length)
                $dstFile = Join-Path $dst $rel
                if (-not (Test-Path $dstFile)) {
                    Write-Host "    NEW: $rel" -ForegroundColor Green
                } else {
                    $srcHash = (Get-FileHash $_.FullName).Hash
                    $dstHash = (Get-FileHash $dstFile).Hash
                    if ($srcHash -ne $dstHash) {
                        Write-Host "    CHANGED: $rel" -ForegroundColor Yellow
                    }
                }
            }
        } else {
            Write-Host "    Would create $dst with $srcCount files"
        }
    } else {
        New-Item -Path $dst -ItemType Directory -Force | Out-Null
        Copy-Item -Path (Join-Path $src "*") -Destination $dst -Recurse -Force
        $newCount = (Get-ChildItem -Path $dst -Recurse -File).Count
        Write-Host "    Synced: $newCount files in target" -ForegroundColor Green
    }
}

# --- Execute ---
Write-Host "Syncing..." -ForegroundColor Yellow

# Sync .claude/ directories
$claudeSrc = Join-Path $IagoRoot ".claude"
if ($Global) {
    # Global mode: target IS ~/.claude/, so sync directly into it
    $claudeDst = $Target
} else {
    $claudeDst = Join-Path $Target ".claude"
}
Sync-Directory -Name "skills" -SrcBase $claudeSrc -DstBase $claudeDst
Sync-Directory -Name "agents" -SrcBase $claudeSrc -DstBase $claudeDst
Sync-Directory -Name "rules" -SrcBase $claudeSrc -DstBase $claudeDst

# Sync hooks (skip in global mode)
if (-not $Global) {
    $hooksSrc = Join-Path $IagoRoot ".iago" "hooks"
    $hooksDst = Join-Path $Target ".iago" "hooks"
    if (Test-Path $hooksSrc) {
        $srcCount = (Get-ChildItem -Path $hooksSrc -Recurse -File).Count
        $dstCount = 0
        if (Test-Path $hooksDst) {
            $dstCount = (Get-ChildItem -Path $hooksDst -Recurse -File).Count
        }
        Write-Host "  hooks: $srcCount source files, $dstCount in target"

        if (-not $DryRun) {
            New-Item -Path $hooksDst -ItemType Directory -Force | Out-Null
            Copy-Item -Path (Join-Path $hooksSrc "*") -Destination $hooksDst -Recurse -Force
            $newCount = (Get-ChildItem -Path $hooksDst -Recurse -File).Count
            Write-Host "    Synced: $newCount files in target" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  hooks: skipped (--global mode -- hooks require .iago/hooks/ in project)"
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
if ($DryRun) {
    Write-Host "No files were changed (dry run). Remove -DryRun to apply."
}
