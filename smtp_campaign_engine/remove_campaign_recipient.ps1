param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F-]{36}$')]
    [string]$CampaignId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[^@\s]+@[^@\s]+\.[^@\s]+$')]
    [string]$Email,

    [string]$Reason = "Removed manually"
)

$ErrorActionPreference = "Stop"
$pythonExecutable = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    throw "Python environment not found: $pythonExecutable"
}

$normalizedCampaignId = ([guid]$CampaignId).ToString()

& $pythonExecutable `
    (Join-Path $PSScriptRoot "manage_campaign.py") `
    remove-recipient `
    --campaign-id $normalizedCampaignId `
    --email $Email `
    --reason $Reason
