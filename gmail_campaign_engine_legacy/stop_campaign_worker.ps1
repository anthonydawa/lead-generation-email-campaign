param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F-]{36}$')]
    [string]$CampaignId
)

$ErrorActionPreference = "Stop"
$CampaignId = ([guid]$CampaignId).ToString()
$pidPath = Join-Path $PSScriptRoot "campaign_state\$CampaignId\worker.pid"

if (-not (Test-Path -LiteralPath $pidPath)) {
    Write-Output "No running worker was found for campaign $CampaignId."
    exit 0
}

$workerPid = [int](Get-Content -LiteralPath $pidPath -Raw)
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $workerPid" -ErrorAction SilentlyContinue
$isLegacyInvocation = $null -ne $process -and $process.CommandLine -notlike "*--campaign-id*"
if ($null -eq $process -or $process.CommandLine -notlike "*run_saved_campaign.py*" -or ($process.CommandLine -notlike "*$CampaignId*" -and -not $isLegacyInvocation)) {
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    Write-Output "The saved worker process is no longer running."
    exit 0
}

Stop-Process -Id $workerPid
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
New-Item -Path (Join-Path $PSScriptRoot "campaign_state\$CampaignId\stopped.flag") -ItemType File -Force | Out-Null
Write-Output "Campaign worker $CampaignId stopped. Its CSV state is preserved."
