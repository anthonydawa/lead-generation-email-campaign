param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F-]{36}$')]
    [string]$CampaignId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[^\s@]+@[^\s@]+\.[^\s@]+$')]
    [string]$Email,

    [string]$Reason = "Removed manually from this campaign"
)

$ErrorActionPreference = "Stop"
$CampaignId = ([guid]$CampaignId).ToString()
$Email = $Email.Trim().ToLowerInvariant()
$stateRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "campaign_state"))
$campaignDirectory = [System.IO.Path]::GetFullPath((Join-Path $stateRoot $CampaignId))

if (-not $campaignDirectory.StartsWith($stateRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Resolved campaign directory is outside the legacy campaign state folder."
}

$pidPath = Join-Path $campaignDirectory "worker.pid"
if (Test-Path -LiteralPath $pidPath) {
    $workerPid = [int](Get-Content -LiteralPath $pidPath -Raw)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $workerPid" -ErrorAction SilentlyContinue
    if ($null -ne $process -and $process.CommandLine -like "*run_saved_campaign.py*") {
        throw "Campaign worker $CampaignId is running (PID $workerPid). Stop it before changing recipient state."
    }
}

$recipientsPath = Join-Path $campaignDirectory "recipients.csv"
if (-not (Test-Path -LiteralPath $recipientsPath)) {
    throw "Recipient state was not found: $recipientsPath"
}

$rows = @(Import-Csv -LiteralPath $recipientsPath)
$matches = @($rows | Where-Object { $_.email.Trim().ToLowerInvariant() -eq $Email })
if ($matches.Count -eq 0) {
    throw "Recipient $Email was not found in campaign $CampaignId."
}
if ($matches.Count -gt 1) {
    throw "Recipient $Email appears more than once; no changes were made."
}

$recipient = $matches[0]
$previousStatus = $recipient.status
if ($previousStatus -in @("completed", "replied", "bounced", "unsubscribed", "skipped")) {
    Write-Output "Recipient $Email is already terminal with status '$previousStatus'. No change was needed."
    exit 0
}

$timestamp = [DateTimeOffset]::UtcNow
$backupPath = "$recipientsPath.$($timestamp.ToString('yyyyMMddTHHmmssZ')).bak"
Copy-Item -LiteralPath $recipientsPath -Destination $backupPath

$recipient.status = "skipped"
$recipient.next_send_at = ""
$recipient.retry_at = ""
$recipient.attempt_step = ""
$recipient.attempt_rfc_message_id = ""
$recipient.last_error = "Manually skipped: $Reason"
$recipient.updated_at = $timestamp.ToString("o")

$temporaryPath = "$recipientsPath.tmp"
$rows | Export-Csv -LiteralPath $temporaryPath -NoTypeInformation -Encoding UTF8
Move-Item -LiteralPath $temporaryPath -Destination $recipientsPath -Force

$eventsPath = Join-Path $campaignDirectory "events.csv"
$event = [pscustomobject]@{
    timestamp = $timestamp.ToString("o")
    event = "recipient_skipped"
    lead_id = $recipient.lead_id
    email = $recipient.email
    step = $recipient.current_step
    details = "$Reason (previous status: $previousStatus)"
}
$event | Export-Csv -LiteralPath $eventsPath -NoTypeInformation -Append -Encoding UTF8

Write-Output "Recipient $Email was marked skipped in campaign $CampaignId."
Write-Output "Backup: $backupPath"
Write-Output "Restart the campaign worker when ready."
