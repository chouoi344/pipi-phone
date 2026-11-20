param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'

try {
    $toolUrl = 'http://127.0.0.1:51337/'
    $existingPage = $null
    try {
        $existingPage = Invoke-WebRequest -Uri $toolUrl -UseBasicParsing -TimeoutSec 2
    } catch [System.Net.WebException] {
        # The issuer has not started yet.
    }

    if ($existingPage -and $existingPage.Content -notmatch '<title>水滴皮肤发码工具</title>') {
        throw '发码工具的端口已被其他程序占用。'
    }
    if (-not $existingPage) {
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        $nodePath = if ($nodeCommand) { $nodeCommand.Source } else {
            Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
        }
        if (-not (Test-Path -LiteralPath $nodePath)) {
            throw '没有找到 Node.js，请先安装 Node.js 24 或更新版本。'
        }
        $toolScript = Join-Path $PSScriptRoot 'waterdrop-issuer.cjs'
        $issuerFolder = Join-Path $env:USERPROFILE '.pipi-phone-issuer'
        if (-not (Test-Path -LiteralPath (Join-Path $issuerFolder 'waterdrop-v1.pem'))) {
            throw '缺少本机签发密钥，请恢复发码工具的密钥备份。'
        }
        $issuerProcess = Start-Process -FilePath $nodePath -ArgumentList ('"{0}"' -f $toolScript) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $issuerFolder 'issuer.stdout.log') -RedirectStandardError (Join-Path $issuerFolder 'issuer.stderr.log')
        $ready = $false
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            Start-Sleep -Milliseconds 200
            try {
                $response = Invoke-WebRequest -Uri $toolUrl -UseBasicParsing -TimeoutSec 1
                if ($response.Content -match '<title>水滴皮肤发码工具</title>') {
                    $ready = $true
                    break
                }
            } catch [System.Net.WebException] {
                if ($issuerProcess.HasExited) { break }
            }
        }
        if (-not $ready) {
            $startupError = Get-Content -LiteralPath (Join-Path $issuerFolder 'issuer.stderr.log') -Raw
            throw "发码工具启动失败。`n$startupError"
        }
    }
    if (-not $NoBrowser) { Start-Process $toolUrl }
} catch {
    if ($NoBrowser) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '水滴皮肤发码工具') | Out-Null
    exit 1
}
