param(
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

$uri = "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)/getUpdates"
$response = Invoke-RestMethod -Method Get -Uri $uri

if (-not $response.ok) {
  throw "Telegram getUpdates failed."
}

if ($response.result.Count -eq 0) {
  Write-Output "No updates yet. Open Telegram, message the bot with /start, then run this again."
  return
}

$response.result | ForEach-Object {
  $message = $_.message
  if (-not $message) {
    return
  }

  [pscustomobject]@{
    UpdateId = $_.update_id
    ChatId = $message.chat.id
    ChatType = $message.chat.type
    From = $message.from.username
    Text = $message.text
    Date = $message.date
  }
}

