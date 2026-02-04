param(
  [string]$Root = (Resolve-Path ".")
)

$excludePattern = '\\(sb|ncsitebuilder|nc_assets|MF Marketing|cgi-bin)\\'

$files = Get-ChildItem -Path $Root -Recurse -Filter *.html | Where-Object {
  $_.FullName -notmatch $excludePattern
}

$pattern = '(?i)(href|src)\s*=\s*["'']([^"'']+)["'']'
$missing = @()

foreach ($file in $files) {
  $content = Get-Content $file.FullName -Raw
  if ([string]::IsNullOrEmpty($content)) { continue }
  $matches = [regex]::Matches($content, $pattern)
  foreach ($match in $matches) {
    $url = $match.Groups[2].Value
    if ($url -match '^(https?:|mailto:|tel:|#|javascript:)' ) { continue }
    if ($url.StartsWith("//")) { continue }
    $url = $url.Split('#')[0].Split('?')[0]
    if ([string]::IsNullOrWhiteSpace($url)) { continue }

    if ($url.StartsWith("/")) {
      $target = Join-Path $Root $url.TrimStart("/")
    } else {
      $target = Join-Path $file.DirectoryName $url
    }

    if ($url.EndsWith("/")) {
      $target = Join-Path $target "index.html"
    }

    if (-not (Test-Path $target)) {
      $missing += [pscustomobject]@{
        File     = $file.FullName
        Link     = $match.Groups[2].Value
        Resolved = $target
      }
    }
  }
}

if ($missing.Count -eq 0) {
  Write-Host "No broken local links found."
  exit 0
}

$missing | Sort-Object File, Link | Format-Table -AutoSize
exit 1
