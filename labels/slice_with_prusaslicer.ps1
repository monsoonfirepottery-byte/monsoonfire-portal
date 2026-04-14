param(
    [string]$PrusaSlicerPath = "C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer-console.exe",
    [string]$OutputRoot,
    [switch]$WithSupport = $true
)

$ErrorActionPreference = "Stop"
$LabelsRoot = Split-Path -Parent $PSCommandPath

if (-not $OutputRoot) {
    $OutputRoot = Join-Path $LabelsRoot "slices\prusaslicer_x1c_inspect"
}

function Get-RepoStylePath([string]$Path) {
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    if ($resolved.StartsWith($LabelsRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $suffix = $resolved.Substring($LabelsRoot.Length).TrimStart("\")
        return ("labels/" + ($suffix -replace "\\", "/"))
    }

    return ($resolved -replace "\\", "/")
}

if (-not (Test-Path -LiteralPath $PrusaSlicerPath)) {
    throw "PrusaSlicer console not found at $PrusaSlicerPath"
}

$jobs = @(
    @{ Name = "variant_A"; Input = (Join-Path $LabelsRoot "variant_A\variant_A.stl") },
    @{ Name = "variant_B_frame"; Input = (Join-Path $LabelsRoot "variant_B\variant_B_frame.stl") },
    @{ Name = "variant_B_insert"; Input = (Join-Path $LabelsRoot "variant_B\variant_B_insert.stl") },
    @{ Name = "variant_C"; Input = (Join-Path $LabelsRoot "variant_C\variant_C.stl") },
    @{ Name = "variant_D"; Input = (Join-Path $LabelsRoot "variant_D\variant_D.stl") }
)

$baseArgs = @(
    "--export-gcode",
    "--gcode-flavor", "marlin2",
    "--nozzle-diameter", "0.4",
    "--filament-diameter", "1.75",
    "--temperature", "220",
    "--first-layer-temperature", "220",
    "--bed-temperature", "55",
    "--first-layer-bed-temperature", "55",
    "--layer-height", "0.16",
    "--first-layer-height", "0.2",
    "--perimeters", "3",
    "--fill-density", "15%",
    "--fill-pattern", "gyroid",
    "--bed-shape", "0x0,256x0,256x256,0x256",
    "--max-print-height", "256",
    "--center", "128,128"
)

if ($WithSupport) {
    $baseArgs += @(
        "--support-material",
        "--support-material-auto",
        "--support-material-buildplate-only"
    )
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

$summary = New-Object System.Collections.Generic.List[object]

foreach ($job in $jobs) {
    if (-not (Test-Path -LiteralPath $job.Input)) {
        throw "Input STL not found: $($job.Input)"
    }

    $mode = if ($WithSupport) { "auto_support" } else { "no_support" }
    $jobDir = Join-Path $OutputRoot $job.Name
    New-Item -ItemType Directory -Force -Path $jobDir | Out-Null
    $gcodePath = Join-Path $jobDir "$mode.gcode"
    $args = @($baseArgs + @("--output", $gcodePath, $job.Input))

    & $PrusaSlicerPath @args
    if ($LASTEXITCODE -ne 0) {
        throw "PrusaSlicer failed for $($job.Name) with exit code $LASTEXITCODE"
    }

    $supportHits = (Select-String -Path $gcodePath -Pattern ";TYPE:Support material" -SimpleMatch).Count
    $item = Get-Item -LiteralPath $gcodePath

    $summary.Add([pscustomobject]@{
        name = $job.Name
        input = (Get-RepoStylePath $job.Input)
        output = (Get-RepoStylePath $gcodePath)
        mode = $mode
        bytes = $item.Length
        support_sections = $supportHits
        support_detected = ($supportHits -gt 0)
        last_write_time = $item.LastWriteTime.ToString("o")
    })
}

$summary | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $OutputRoot "slice_summary.json")
$summary | Format-Table -AutoSize
