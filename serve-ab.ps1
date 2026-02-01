Param(
  [int]$Port = 8000,
  [string]$Root = (Get-Location).Path,
  [string]$VariantRoot = "ab",
  [int]$CookieDays = 30
)

$listener = [System.Net.HttpListener]::new()
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "Serving $Root at $prefix"
Write-Host "A/B variants from '$VariantRoot' (use ?ab=a or ?ab=b). Ctrl+C to stop."

$mime = @{
  ".html"="text/html"; ".css"="text/css"; ".js"="text/javascript"; ".mjs"="text/javascript";
  ".json"="application/json"; ".xml"="application/xml"; ".txt"="text/plain"; ".map"="application/json";
  ".png"="image/png"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"; ".gif"="image/gif"; ".webp"="image/webp";
  ".svg"="image/svg+xml"; ".ico"="image/x-icon"; ".pdf"="application/pdf";
  ".woff"="font/woff"; ".woff2"="font/woff2"; ".ttf"="font/ttf"; ".eot"="application/vnd.ms-fontobject";
  ".mp4"="video/mp4"; ".webm"="video/webm";
}

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $request = $ctx.Request
      $response = $ctx.Response

      $rawPath = $request.Url.AbsolutePath.TrimStart("/")
      $path = [System.Net.WebUtility]::UrlDecode($rawPath)
      if ([string]::IsNullOrWhiteSpace($path)) { $path = "index.html" }

      $variant = $null
      $queryVariant = $request.QueryString["ab"]
      if (-not $queryVariant) { $queryVariant = $request.QueryString["variant"] }
      if ($queryVariant) {
        $q = $queryVariant.ToLower()
        if ($q -eq "a" -or $q -eq "b") { $variant = $q }
      }

      if (-not $variant) {
        $cookie = $request.Cookies["ab_variant"]
        if ($cookie) {
          $c = $cookie.Value.ToLower()
          if ($c -eq "a" -or $c -eq "b") { $variant = $c }
        }
      }

      $setCookie = $false
      if (-not $variant) {
        $variant = (Get-Random -Minimum 0 -Maximum 2) -eq 0 ? "a" : "b"
        $setCookie = $true
      } elseif ($queryVariant) {
        $setCookie = $true
      }

      if ($setCookie) {
        $cookie = [System.Net.Cookie]::new("ab_variant", $variant, "/")
        $cookie.Expires = (Get-Date).AddDays($CookieDays)
        $response.Cookies.Add($cookie)
      }

      $file = Join-Path $Root $path
      if (Test-Path $file -PathType Container) { $file = Join-Path $file "index.html" }

      $variantFile = $null
      if ($variant) {
        $variantBase = Join-Path $Root (Join-Path $VariantRoot $variant)
        $candidate = Join-Path $variantBase $path
        if (Test-Path $candidate -PathType Container) { $candidate = Join-Path $candidate "index.html" }
        if (Test-Path $candidate -PathType Leaf) { $variantFile = $candidate }
      }

      if ($variantFile) { $file = $variantFile }

      $response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
      $response.Headers["Pragma"] = "no-cache"
      $response.Headers["X-AB-Variant"] = $variant

      if (Test-Path $file -PathType Leaf) {
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $contentType = $mime[$ext]
        if (-not $contentType) { $contentType = "application/octet-stream" }
        $response.ContentType = $contentType
        if ($request.HttpMethod -ne "HEAD") {
          $bytes = [IO.File]::ReadAllBytes($file)
          $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
      } else {
        $response.StatusCode = 404
        $response.ContentType = "text/plain"
        if ($request.HttpMethod -ne "HEAD") {
          $bytes = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
          $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
      }
    } catch {
      $ctx.Response.StatusCode = 500
    } finally {
      $ctx.Response.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
