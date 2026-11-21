[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$testRoot = Join-Path $tempRoot ('FluxDown-package-test-' + [guid]::NewGuid().ToString('N'))
$testRoot = [System.IO.Path]::GetFullPath($testRoot)
if ((Split-Path -Parent $testRoot).TrimEnd('\') -ne $tempRoot.TrimEnd('\')) {
    throw "Fixture path is outside TEMP: $testRoot"
}

$outputDir = Join-Path $testRoot 'output'
$stagingDir = Join-Path $testRoot 'temp'
$fixtureScripts = Join-Path $testRoot 'scripts'
$fixtureApp = Join-Path $testRoot 'app'
$fixtureTools = Join-Path $testRoot 'tools\ffmpeg'
$version = '1.2.3'
$packageName = "FluxDown-Cloud-Extension-$version.zip"
$packagePath = Join-Path $outputDir $packageName
$checksumPath = "$packagePath.sha256"
$winPs = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$scriptPath = Join-Path $fixtureScripts 'package-release.ps1'
$previousTemp = $env:TEMP

function Invoke-TestPackage([string]$RequestedVersion, [string]$ExpectedError) {
    $ErrorActionPreference = 'Continue'
    $arguments = @('-NoProfile', '-File', $scriptPath, '-DesktopDir', $outputDir, '-SkipFfmpegCheck')
    if ($RequestedVersion) { $arguments += @('-Version', $RequestedVersion) }
    $messages = & $winPs @arguments 2>&1
    $exitCode = $LASTEXITCODE
    if ($ExpectedError) {
        if ($exitCode -eq 0 -or ($messages -join "`n") -notlike "*$ExpectedError*") {
            throw "Expected failure '$ExpectedError', got exit code ${exitCode}: $messages"
        }
    }
    elseif ($exitCode -ne 0) {
        throw "Packaging failed (exit ${exitCode}): $messages"
    }
}

try {
    New-Item -ItemType Directory -Path $fixtureScripts, $fixtureTools, $stagingDir -Force | Out-Null
    $env:TEMP = $stagingDir
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'package-release.ps1') -Destination $fixtureScripts
    foreach ($file in @('Get-ExtensionId.ps1', 'install-native-host.ps1', 'setup-for-friend.ps1', 'reinstall-native-host.ps1',
            'one-click.ps1', 'uninstall.ps1', 'release-launch.cmd', 'release-uninstall.cmd', 'release-readme-template.md')) {
        Set-Content -LiteralPath (Join-Path $fixtureScripts $file) -Value 'fixture' -Encoding ASCII
    }
    foreach ($file in @('ffmpeg.exe', 'ffprobe.exe')) {
        Set-Content -LiteralPath (Join-Path $fixtureTools $file) -Value 'fixture' -Encoding ASCII
    }
    foreach ($file in @('LICENSE', 'THIRD_PARTY_NOTICES.md')) {
        Set-Content -LiteralPath (Join-Path $testRoot $file) -Value 'fixture' -Encoding ASCII
    }
    foreach ($browser in @('edge', 'chrome')) {
        $buildDir = Join-Path $fixtureApp ".output\$browser-mv3"
        New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $buildDir 'background.js') -Value '/* com.fluxdown.cloud.nmh */' -Encoding ASCII
        Set-Content -LiteralPath (Join-Path $buildDir 'manifest.json') -Value ('{"version":"' + $version + '","manifest_version":3}') -Encoding ASCII
    }
    $sourceManifest = Join-Path $fixtureApp 'package.json'
    Set-Content -LiteralPath $sourceManifest -Value '{"version":"0.0.1"}' -Encoding ASCII
    Invoke-TestPackage '' 'source/build version mismatch'
    Set-Content -LiteralPath $sourceManifest -Value ('{"version":"' + $version + '"}') -Encoding ASCII
    Invoke-TestPackage "wrong-$version-name" 'does not match built manifest version'
    if (Test-Path -LiteralPath $outputDir) { throw 'Invalid versions created an output directory' }

    Invoke-TestPackage $version ''
    $publishedHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $publishedChecksum = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
    if ($publishedChecksum -cne "$publishedHash  $packageName") { throw 'Invalid checksum file' }

    Set-Content -LiteralPath (Join-Path $testRoot 'LICENSE') -Value 'updated fixture' -Encoding ASCII
    Invoke-TestPackage $version ''
    $replacementHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $replacementChecksum = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
    if ($replacementHash -eq $publishedHash -or $replacementChecksum -cne "$replacementHash  $packageName") {
        throw 'The updated package or checksum was not replaced'
    }

    [System.IO.File]::WriteAllText((Join-Path $testRoot 'LICENSE'), '')
    Invoke-TestPackage $version 'archive missing or empty: LICENSE'
    if ((Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash -ne $replacementHash -or
        (Get-Content -LiteralPath $checksumPath -Raw).Trim() -cne $replacementChecksum -or
        @(Get-ChildItem -LiteralPath $outputDir -File).Count -ne 2 -or
        @(Get-ChildItem -LiteralPath $stagingDir -Force).Count -ne 0) {
        throw 'A failed package attempt modified the previous output or left temporary files'
    }
    Write-Host 'Release package smoke test passed.'
}
finally {
    $env:TEMP = $previousTemp
    if (Test-Path -LiteralPath $testRoot -PathType Container) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
