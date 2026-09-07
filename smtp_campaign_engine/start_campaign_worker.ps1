param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F-]{36}$')]
    [string]$CampaignId
)

$ErrorActionPreference = "Stop"
$CampaignId = ([guid]$CampaignId).ToString()
$projectDirectory = $PSScriptRoot
$pythonExecutable = Join-Path $projectDirectory ".venv\Scripts\python.exe"
$workerScript = Join-Path $projectDirectory "run_saved_campaign.py"
$stateDirectory = Join-Path $projectDirectory "campaign_state\$CampaignId"
$pidPath = Join-Path $stateDirectory "worker.pid"

if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    throw "Python environment not found: $pythonExecutable"
}

if (Test-Path -LiteralPath $pidPath) {
    $savedPid = [int](Get-Content -LiteralPath $pidPath -Raw)
    $running = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
    $isLegacyInvocation = $null -ne $running -and $running.CommandLine -notlike "*--campaign-id*"
    if ($null -ne $running -and $running.CommandLine -like "*run_saved_campaign.py*" -and ($running.CommandLine -like "*$CampaignId*" -or $isLegacyInvocation)) {
        Write-Output "Campaign worker $CampaignId is already running (PID $savedPid)."
        exit 0
    }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

Remove-Item -Path (Join-Path $stateDirectory "stopped.flag") -Force -ErrorAction SilentlyContinue

$process = Start-Process `
    -FilePath $pythonExecutable `
    -ArgumentList @("`"$workerScript`"", "--campaign-id", $CampaignId) `
    -WorkingDirectory $projectDirectory `
    -WindowStyle Hidden `
    -PassThru

Start-Sleep -Seconds 2
if ($process.HasExited) {
    throw "Campaign worker exited during startup. Check $stateDirectory\worker.log."
}

Write-Output "Campaign worker $CampaignId started in the background (PID $($process.Id))."
Write-Output "Log: $stateDirectory\worker.log"
Write-Output "Stop: .\stop_campaign_worker.ps1 -CampaignId $CampaignId"
