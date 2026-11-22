$ErrorActionPreference = 'Stop'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixture = [IO.Path]::GetFullPath((Join-Path $tempRoot ('FluxDown-bridge-test-' + [guid]::NewGuid().ToString('N'))))
if ((Split-Path -Parent $fixture).TrimEnd('\') -ne $tempRoot.TrimEnd('\')) {
    throw 'Unexpected fixture path'
}
$oldLocalAppData = $env:LOCALAPPDATA
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$installer = Join-Path $PSScriptRoot 'install-native-host.ps1'
$relay = Join-Path $fixture 'fluxdown_nmh.exe'
$manifestDir = Join-Path $fixture 'FluxDownCloudExtension\nmh'
$manifest = Join-Path $manifestDir 'com.fluxdown.cloud.nmh.json'
$edge = 'a' * 32
$chrome = 'b' * 32
$custom = 'c' * 32

function Test-InstallPreview([string]$Browser, [string]$ExtensionId, [string[]]$Origins) {
    $result = & $powerShell -NoProfile -File $installer -RelayPath $relay -Browser $Browser -ExtensionId $ExtensionId -WhatIf
    if ($LASTEXITCODE -ne 0) { throw "$Browser registration preview failed" }
    $line = $result | Where-Object { $_ -like '*- allowed_origins:*' }
    if ($line -cne ('  - allowed_origins: ' + ($Origins -join ', '))) {
        throw "Unexpected allowlist for ${Browser}: $line"
    }
}

try {
    New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
    [IO.File]::WriteAllText($relay, 'fixture')
    $env:LOCALAPPDATA = $fixture
    Test-InstallPreview 'Edge' $edge @("chrome-extension://$edge/")
    if (Test-Path -LiteralPath $manifest) { throw 'Preview unexpectedly wrote a manifest' }

    $data = @{
        name = 'com.fluxdown.cloud.nmh'
        type = 'stdio'
        path = $relay
        allowed_origins = @("chrome-extension://$edge/", "chrome-extension://$custom/", "chrome-extension://$edge/")
    }
    Set-Content -LiteralPath $manifest -Encoding ASCII -Value ($data | ConvertTo-Json)
    $before = (Get-FileHash -LiteralPath $manifest).Hash
    Test-InstallPreview 'Chrome' $chrome @("chrome-extension://$edge/", "chrome-extension://$custom/", "chrome-extension://$chrome/")
    Test-InstallPreview 'Edge' $edge @("chrome-extension://$edge/", "chrome-extension://$custom/")
    if ((Get-FileHash -LiteralPath $manifest).Hash -ne $before) { throw 'Preview modified the manifest' }
    $data.allowed_origins = @('https://example.invalid/')
    Set-Content -LiteralPath $manifest -Encoding ASCII -Value ($data | ConvertTo-Json)
    $before = (Get-FileHash -LiteralPath $manifest).Hash
    $errorOutput = & {
        $ErrorActionPreference = 'Continue'
        & $powerShell -NoProfile -File $installer -RelayPath $relay -Browser Edge -ExtensionId $edge -WhatIf 2>&1
    }
    if ($LASTEXITCODE -eq 0 -or ($errorOutput -join ' ') -notmatch 'cannot preserve the existing bridge registration') {
        throw 'Malformed existing allowlist was not rejected'
    }
    if ((Get-FileHash -LiteralPath $manifest).Hash -ne $before) { throw 'Rejection modified the manifest' }
    Write-Host 'Native bridge compatibility test passed.'
    exit 0
}
finally {
    $env:LOCALAPPDATA = $oldLocalAppData
    if (Test-Path -LiteralPath $fixture -PathType Container) {
        Remove-Item -LiteralPath $fixture -Recurse -Force
    }
}
