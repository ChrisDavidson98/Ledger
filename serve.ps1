<#
  serve.ps1 — minimal static file server for local testing.

  Ledger uses ES modules and a service worker, neither of which work
  from a file:// URL. This needs nothing installed beyond Windows
  PowerShell itself.

  Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1
          powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8080
#>

param(
  [int]$Port = 8000,
  [string]$Root = $PSScriptRoot
)

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
  $listener.Start()
} catch {
  Write-Host "Could not bind port $Port. Try another: -Port 8080" -ForegroundColor Red
  exit 1
}

Write-Host "Ledger serving $Root" -ForegroundColor Green
Write-Host "  http://localhost:$Port/" -ForegroundColor Cyan
Write-Host "Ctrl+C to stop."

while ($listener.IsListening) {
  try {
    $context  = $listener.GetContext()
    $request  = $context.Request
    $response = $context.Response

    $rel = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }

    $full = Join-Path $Root $rel
    $resolvedRoot = [System.IO.Path]::GetFullPath($Root)
    $resolved = [System.IO.Path]::GetFullPath($full)

    # Refuse anything that escapes the served directory.
    if (-not $resolved.StartsWith($resolvedRoot)) {
      $response.StatusCode = 403
      $response.Close()
      continue
    }

    if (Test-Path $resolved -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($resolved)
      $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
      $type = $mime[$ext]
      if (-not $type) { $type = 'application/octet-stream' }

      $response.ContentType = $type
      $response.Headers.Add('Cache-Control', 'no-cache')
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host "200 $rel"
    } else {
      $response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("Not found: $rel")
      $response.OutputStream.Write($msg, 0, $msg.Length)
      Write-Host "404 $rel" -ForegroundColor DarkYellow
    }
    $response.Close()
  } catch {
    Write-Host "error: $_" -ForegroundColor Red
  }
}
