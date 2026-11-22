param(
    [string]$Gradle = (Join-Path $PSScriptRoot 'gradlew.bat'),
    [string]$GoogleServices
)

$ErrorActionPreference = 'Stop'
$keyTool = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin/keytool.exe' } else { (Get-Command keytool.exe).Source }
$privateDir = Join-Path $env:LOCALAPPDATA 'PipiPhone\AndroidSigning'
$keyFile = Join-Path $privateDir 'sideload.p12'
$passwordFile = Join-Path $privateDir 'sideload.password.xml'
$oldFile = $env:PIPI_ANDROID_KEYSTORE
$oldPassword = $env:PIPI_ANDROID_KEY_PASSWORD
Push-Location $PSScriptRoot
try {
    if ((Test-Path $keyFile) -and !(Test-Path $passwordFile)) {
        throw 'The saved signing key needs its original password. Restore its password file before building.'
    }
    if (!(Test-Path $passwordFile)) {
        $null = New-Item -ItemType Directory -Path $privateDir -Force
        $bytes = New-Object byte[] 40
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $password = ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force
        $password | Export-Clixml -LiteralPath $passwordFile
    }
    $secure = Import-Clixml -LiteralPath $passwordFile
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:PIPI_ANDROID_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $env:PIPI_ANDROID_KEYSTORE = $keyFile
    if (!(Test-Path $keyFile)) {
        & $keyTool -genkeypair -keystore $keyFile -storetype PKCS12 -alias pipi-phone -keyalg RSA -keysize 3072 -validity 10000 -storepass:env PIPI_ANDROID_KEY_PASSWORD -keypass:env PIPI_ANDROID_KEY_PASSWORD -dname 'CN=Pipi Phone Android Sideload' -noprompt
        if ($LASTEXITCODE -ne 0) { throw 'Unable to create the sideload signing key.' }
    }
    $buildArgs = @('--console', 'plain', ':app:assemblePreview')
    if ($GoogleServices) {
        $configFile = (Resolve-Path -LiteralPath $GoogleServices).Path
        $buildArgs += @('-PpipiFcm=true', "-PpipiGoogleServices=$configFile")
    }
    & $Gradle @buildArgs
    if ($LASTEXITCODE -ne 0) { throw 'The Android build failed.' }
    $outputDir = if ($GoogleServices) { 'app/build-fcm/outputs/apk/preview' } else { 'app/build/outputs/apk/preview' }
    $metadata = Get-Content -Raw -LiteralPath (Join-Path $outputDir 'output-metadata.json') | ConvertFrom-Json
    $apk = $metadata.elements[0]
    $assetPrefix = if ($GoogleServices) { 'pipi-phone-custom-push' } else { 'pipi-phone-android' }
    $assetName = "$assetPrefix-$($apk.versionName)-$($apk.versionCode).apk"
    $releaseDir = Join-Path (Split-Path $outputDir) 'release-assets'
    $null = New-Item -ItemType Directory -Path $releaseDir -Force
    Copy-Item -LiteralPath (Join-Path $outputDir $apk.outputFile) -Destination (Join-Path $releaseDir $assetName)
    Write-Host "Signed APK: $(Join-Path $releaseDir $assetName)"
} finally {
    $env:PIPI_ANDROID_KEYSTORE = $oldFile
    $env:PIPI_ANDROID_KEY_PASSWORD = $oldPassword
    Pop-Location
}
