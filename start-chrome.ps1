$chromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$chromePath = $null
foreach ($p in $chromePaths) {
    if (Test-Path $p) { $chromePath = $p; break }
}

if (-not $chromePath) {
    Write-Error "Chrome not found at any expected location."
    exit 1
}

$userDataDir = "C:\AI\research-chrome"
$debugPort = 9333

Write-Host "Starting Chrome with remote debugging on port $debugPort..." -ForegroundColor Cyan
Write-Host "Profile: $userDataDir" -ForegroundColor Cyan
Write-Host "Chrome: $chromePath" -ForegroundColor Gray

Get-CimInstance Win32_Process -Filter "name like 'chrome%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "--remote-debugging-port=$debugPort" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Process -FilePath $chromePath -ArgumentList @(
    "--remote-debugging-port=$debugPort",
    "--user-data-dir=`"$userDataDir`"",
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window"
)

Write-Host "Chrome started. Verify at: http://localhost:$debugPort/json/version" -ForegroundColor Green
