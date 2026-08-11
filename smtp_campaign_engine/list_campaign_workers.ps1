$ErrorActionPreference = "Stop"

$stateRoot = Join-Path $PSScriptRoot "campaign_state"
if (-not (Test-Path -LiteralPath $stateRoot)) {
    Write-Output "No campaign state folder exists yet."
    exit 0
}

$rows = foreach ($directory in Get-ChildItem -LiteralPath $stateRoot -Directory) {
    if ($directory.Name -eq "_mail_account") { continue }

    $pidPath = Join-Path $directory.FullName "worker.pid"
    $campaignPath = Join-Path $directory.FullName "campaign.csv"
    $recipientsPath = Join-Path $directory.FullName "recipients.csv"
    $workerPid = $null
    $running = $false
    if (Test-Path -LiteralPath $pidPath) {
        $workerPid = [int](Get-Content -LiteralPath $pidPath -Raw)
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $workerPid" -ErrorAction SilentlyContinue
        $isLegacyInvocation = $null -ne $process -and $process.CommandLine -notlike "*--campaign-id*"
        $running = $null -ne $process -and $process.CommandLine -like "*run_saved_campaign.py*" -and ($process.CommandLine -like "*$($directory.Name)*" -or $isLegacyInvocation)
    }

    $title = ""
    if (Test-Path -LiteralPath $campaignPath) {
        $title = (Import-Csv -LiteralPath $campaignPath | Select-Object -First 1).title
    }
    $recipients = @()
    if (Test-Path -LiteralPath $recipientsPath) {
        $recipients = @(Import-Csv -LiteralPath $recipientsPath)
    }

    [pscustomobject]@{
        CampaignId = $directory.Name
        Title = $title
        Running = $running
        PID = if ($running) { $workerPid } else { $null }
        Pending = @($recipients | Where-Object { $_.status -in @("pending", "scheduled", "sending") }).Count
        Completed = @($recipients | Where-Object { $_.status -in @("completed", "replied", "bounced", "unsubscribed", "skipped", "uncertain") }).Count
        Log = Join-Path $directory.FullName "worker.log"
    }
}

if (-not $rows) {
    Write-Output "No campaign workers have been created yet."
    exit 0
}

$rows | Format-Table -AutoSize
