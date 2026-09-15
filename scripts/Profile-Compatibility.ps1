function Assert-NagneonProfileCompatibility {
    param([Parameter(Mandatory=$true)][string]$Profile, [Parameter(Mandatory=$true)][string]$AppVersion)
    if ($AppVersion -notmatch '^(\d+)\.(\d+)\.(\d+)') { throw 'Cannot identify the application version. Reapply a verified package.' }
    $targetVersion = [version]($Matches[1] + '.' + $Matches[2] + '.' + $Matches[3])
    if ($targetVersion -ge [version]'0.1.4') { return }
    $worldFile = Join-Path $Profile 'data/world.json'
    if (-not (Test-Path -LiteralPath $worldFile -PathType Leaf)) { return }
    try { $world = Get-Content -LiteralPath $worldFile -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw 'Cannot confirm profile compatibility. Preserve the current data and use a separate backup copy for recovery.' }
    if (-not $world.settings -or -not ($world.settings.PSObject.Properties.Name -contains 'maxCalls') -or @($world.settings.personas).Count -gt 40) {
        throw 'This profile requires Nagneon 0.1.4 or later. Do not open it with an older app. For recovery, copy a pre-update backup into a separate profile; keep current records unchanged.'
    }
}
