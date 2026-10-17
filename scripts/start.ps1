<#
  GeoSales.ai - one-click start.

    start.cmd                       double-click from the repo root
    .\scripts\start.ps1             start everything (frontend is always restarted)
    .\scripts\start.ps1 -Clear      also clear the Metro bundler cache
    .\scripts\start.ps1 -NoPhoton   skip Photon (only needed to geocode new companies)
    .\scripts\start.ps1 -NoBrowser  don't open the browser at the end

  Order: Docker Desktop -> Postgres + API (docker compose) -> Photon -> Expo web.
#>
param(
    [switch]$Clear,
    [switch]$NoPhoton,
    [switch]$NoBrowser
)

# Native tools (docker, taskkill) write progress to stderr; failures are checked via exit codes instead.
$ErrorActionPreference = 'Continue'
$Root      = Split-Path -Parent $PSScriptRoot   # repo root (this file lives in scripts)
$RunDir    = Join-Path $Root '.run'
$PhotonDir = Join-Path $Root 'geocoder\photon_v1'
$MobileDir = Join-Path $Root 'mobile'
$ExpoPort  = 8081
New-Item -ItemType Directory -Force $RunDir | Out-Null

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "    $msg" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }

function Test-Url($url, $timeoutSec = 4) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec $timeoutSec | Out-Null; return $true } catch { return $false }
}

function Wait-Until($what, $seconds, [scriptblock]$check) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $check) { return $true }
        Start-Sleep -Seconds 2
        Write-Host '.' -NoNewline
    }
    Write-Host ''
    return $false
}

function Stop-PortListeners($port) {
    $pids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
              Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($procId in $pids) {
        if ($procId -and $procId -ne 0) {
            & taskkill.exe /PID $procId /T /F 2>$null | Out-Null
            Ok "stopped process $procId on port $port"
        }
    }
}

# -- 1. Docker Desktop -------------------------------------------------------
Step 'Docker'
$docker = (Get-Command docker -ErrorAction SilentlyContinue).Source
if (-not $docker) { Fail 'docker is not on PATH - install Docker Desktop.' }

& $docker info *> $null
if ($LASTEXITCODE -ne 0) {
    $desktop = @(
        "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe",
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $desktop) { Fail 'Docker Desktop is not running and its exe was not found.' }
    Warn 'Docker Desktop is not running - starting it'
    Start-Process $desktop
    $up = Wait-Until 'docker' 180 { & $docker info *> $null; $LASTEXITCODE -eq 0 }
    if (-not $up) { Fail 'Docker did not become ready within 3 minutes.' }
}
Ok 'Docker engine is ready'

# -- 2. Postgres + API -------------------------------------------------------
Step 'Database and API (docker compose)'
Push-Location $Root
& $docker compose up -d 2>&1 | ForEach-Object { Write-Host "    $_" }
Pop-Location
if ($LASTEXITCODE -ne 0) { Fail 'docker compose up failed (see output above).' }

$apiUp = Wait-Until 'api' 120 { Test-Url 'http://localhost:3000/health' }
if (-not $apiUp) { Fail 'API did not answer on http://localhost:3000/health - check: docker logs geosales_api' }
Ok 'API is up at http://localhost:3000'

# -- 3. Photon geocoder ------------------------------------------------------
if ($NoPhoton) {
    Step 'Photon (skipped)'
} else {
    Step 'Photon geocoder'
    if (Test-Url 'http://localhost:2322/api?q=mumbai&limit=1') {
        Ok 'already running on port 2322'
    } else {
        $java = (Get-Command java -ErrorAction SilentlyContinue).Source
        $jar  = Get-ChildItem $PhotonDir -Filter 'photon-*.jar' -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $java) {
            Warn 'java not found on PATH - Photon not started (map still works; geocoding new companies will not).'
        } elseif (-not $jar -or -not (Test-Path (Join-Path $PhotonDir 'photon_data'))) {
            Warn "Photon jar or photon_data missing in $PhotonDir - Photon not started."
        } else {
            Stop-PortListeners 2322
            $p = Start-Process -FilePath $java `
                -ArgumentList '-Xmx3G', '-jar', $jar.Name, 'serve', '-listen-ip', '0.0.0.0', '-listen-port', '2322' `
                -WorkingDirectory $PhotonDir -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput (Join-Path $RunDir 'photon.log') `
                -RedirectStandardError  (Join-Path $RunDir 'photon_err.log')
            Set-Content (Join-Path $RunDir 'photon.pid') $p.Id
            if (Wait-Until 'photon' 120 { Test-Url 'http://localhost:2322/api?q=mumbai&limit=1' }) {
                Ok "started (pid $($p.Id)), logs in .run\photon*.log"
            } else {
                Warn 'Photon did not answer within 2 minutes - see .run\photon_err.log'
            }
        }
    }
}

# -- 4. Frontend (always force-restarted) ------------------------------------
Step 'Frontend (Expo web)'
$pidFile = Join-Path $RunDir 'expo.pid'
if (Test-Path $pidFile) {
    $old = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
        & taskkill.exe /PID $old /T /F 2>$null | Out-Null
        Ok "closed previous Expo window (pid $old)"
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
}
foreach ($port in @($ExpoPort, 19000, 19001, 19006)) { Stop-PortListeners $port }
$freed = Wait-Until 'port' 20 { -not (Get-NetTCPConnection -LocalPort $ExpoPort -State Listen -ErrorAction SilentlyContinue) }
if (-not $freed) { Fail "Port $ExpoPort is still in use by another program." }

$expoArgs = 'npx expo start --web' + $(if ($Clear) { ' --clear' } else { '' })
$expo = Start-Process powershell -PassThru -ArgumentList @(
    '-NoExit', '-NoProfile', '-Command',
    "`$Host.UI.RawUI.WindowTitle = 'GeoSales - Expo'; Set-Location '$MobileDir'; $expoArgs"
)
Set-Content $pidFile $expo.Id

if (Wait-Until 'expo' 180 { Test-Url "http://localhost:$ExpoPort" }) {
    Ok "Expo is serving http://localhost:$ExpoPort (logs in the 'GeoSales - Expo' window)"
} else {
    Warn "Expo has not answered yet - watch the 'GeoSales - Expo' window."
}

# -- Done --------------------------------------------------------------------
Step 'Ready'
Write-Host '    App       http://localhost:8081'
Write-Host '    API       http://localhost:3000/health'
if (-not $NoPhoton) { Write-Host '    Photon    http://localhost:2322' }
if (-not $NoBrowser) { Start-Process "http://localhost:$ExpoPort" }
