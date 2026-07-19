param(
  [Parameter(Mandatory = $true)]
  [string] $Message,

  [string] $EnvFile = ".env.telegram"
)

$ErrorActionPreference = "Stop"

function Import-EnvFile {
  param([string] $Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) {
      return
    }

    $parts = $line.Split("=", 2)
    if ($parts.Count -ne 2) {
      return
    }

    $name = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"')
    if ($name.Length -gt 0) {
      Set-Item -Path "env:$name" -Value $value
    }
  }
}

Import-EnvFile -Path $EnvFile

if (-not $env:TELEGRAM_BOT_TOKEN) {
  throw "TELEGRAM_BOT_TOKEN is missing. Add it to $EnvFile or set it as an environment variable."
}

if (-not $env:TELEGRAM_CHAT_ID) {
  throw "TELEGRAM_CHAT_ID is missing. Run scripts/telegram-updates.ps1 after sending /start to the bot."
}

$uri = "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)/sendMessage"
$body = @{
  chat_id = $env:TELEGRAM_CHAT_ID
  text = $Message
  disable_web_page_preview = $true
}

$response = Invoke-RestMethod -Method Post -Uri $uri -Body $body

if (-not $response.ok) {
  throw "Telegram sendMessage failed."
}

Write-Output "Telegram message sent."

