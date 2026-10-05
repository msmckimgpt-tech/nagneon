# Reads only inert, bounded JSON from the delivered archive; never runs a candidate.
function Get-NagneonFileDigest([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
}
function Assert-NagneonSafeInteger($Value, [long]$Minimum) {
    if (($Value -isnot [int] -and $Value -isnot [long] -and $Value -isnot [double] -and $Value -isnot [decimal]) -or
        $Value -lt $Minimum -or $Value -gt 9007199254740991 -or [Math]::Truncate([double]$Value) -ne $Value) {
        throw 'Invalid record reader number. Preserve the existing profile and package.'
    }
}
function Assert-NagneonVersionString($Value) {
    if ($Value -isnot [string] -or $Value -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid application version. Reapply a verified package.' }
    foreach ($part in $Value.Split('.')) {
        $number = 0L
        if (-not [long]::TryParse($part,[ref]$number) -or $number -gt 2147483647) { throw 'Invalid application version. Reapply a verified package.' }
    }
}
function Read-NagneonArchiveJson([string]$Archive, [string]$Name) {
    $stream = [IO.File]::OpenRead($Archive)
    $reader = New-Object IO.BinaryReader($stream)
    try {
        if ($stream.Length -lt 16 -or $reader.ReadUInt32() -ne 4) { throw 'Invalid application archive header.' }
        $headerSize = [long]$reader.ReadUInt32()
        if ($headerSize -lt 8 -or $headerSize -gt 16777216 -or $headerSize -gt $stream.Length - 8) { throw 'Invalid application archive header size.' }
        if ($reader.ReadUInt32() -ne $headerSize - 4) { throw 'Invalid application archive header payload.' }
        $jsonSize = [long]$reader.ReadUInt32()
        if ($jsonSize -lt 2 -or $jsonSize -gt $headerSize - 8 -or (8 + 4 * [Math]::Ceiling($jsonSize / 4)) -ne $headerSize) { throw 'Invalid application archive JSON bounds.' }
        $encoding = New-Object Text.UTF8Encoding($false,$true)
        $bytes = $reader.ReadBytes([int]$jsonSize)
        if ($bytes.Length -ne $jsonSize) { throw 'Incomplete application archive header.' }
        $headerJson = $encoding.GetString($bytes)
        if (-not $headerJson.TrimStart().StartsWith('{')) { throw 'Application archive header must be an object.' }
        $node = $headerJson | ConvertFrom-Json
        foreach ($part in $Name.Split('/')) {
            if ($node.PSObject.Properties['link'] -or $node.unpacked -or -not $node.files) { throw 'Application capability must be packed inside its archive.' }
            $property = @($node.files.PSObject.Properties | Where-Object { $_.Name -ceq $part })
            if ($property.Count -ne 1) { throw "Application archive entry is missing: $Name" }
            $node = $property[0].Value
        }
        if ($node.PSObject.Properties['link'] -or $node.unpacked -or $node.files -or $node.offset -isnot [string] -or $node.offset -notmatch '^\d+$') { throw 'Invalid packed application capability entry.' }
        Assert-NagneonSafeInteger $node.size 0
        $offset = 0L
        if ($node.size -gt 1048576 -or -not [long]::TryParse($node.offset,[ref]$offset) -or $offset -gt $stream.Length - 8 - $headerSize - $node.size) { throw 'Invalid application capability bounds.' }
        $stream.Position = 8 + $headerSize + $offset
        $bytes = $reader.ReadBytes([int]$node.size)
        if ($bytes.Length -ne $node.size) { throw 'Incomplete application capability.' }
        $valueJson = $encoding.GetString($bytes)
        if (-not $valueJson.TrimStart().StartsWith('{')) { throw 'Application capability must be a JSON object.' }
        return ($valueJson | ConvertFrom-Json)
    } finally { $reader.Dispose(); $stream.Dispose() }
}
function Get-NagneonPackageCapabilities([string]$PackageFolder, [string]$ExpectedVersion, [string]$ExpectedReceiptSha256) {
    $receiptFile = Join-Path $PackageFolder 'nagneon-package.json'
    $exe = Join-Path $PackageFolder 'Nagneon.exe'
    $archive = Join-Path $PackageFolder 'resources/app.asar'
    foreach ($file in @($receiptFile,$exe,$archive)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or ((Get-Item -LiteralPath $file -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Package reader capability is missing or linked. Rebuild a verified package; existing records were not changed.'
        }
    }
    if ((Get-Item -LiteralPath $receiptFile).Length -gt 65536) { throw 'Package reader capability is too large.' }
    $receiptSha256 = Get-NagneonFileDigest $receiptFile
    if ($ExpectedReceiptSha256 -and ($ExpectedReceiptSha256 -cnotmatch '^[a-f0-9]{64}$' -or $receiptSha256 -cne $ExpectedReceiptSha256)) { throw 'Package capability identity changed.' }
    $receiptJson = Get-Content -LiteralPath $receiptFile -Raw -Encoding UTF8
    if (-not $receiptJson.TrimStart().StartsWith('{')) { throw 'Package capability must be a JSON object.' }
    $receipt = $receiptJson | ConvertFrom-Json
    if ($receipt.schema -cne 'nagneon.package-capabilities/1' -or ((@($receipt.PSObject.Properties.Name | Sort-Object) -join '|') -cne 'appVersion|asarSha256|exeSha256|profileReader|schema') -or
        $receipt.exeSha256 -cnotmatch '^[a-f0-9]{64}$' -or $receipt.asarSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid package reader capability.' }
    Assert-NagneonSafeInteger $receipt.profileReader 1
    Assert-NagneonVersionString $receipt.appVersion
    if ((Get-NagneonFileDigest $exe) -cne $receipt.exeSha256 -or (Get-NagneonFileDigest $archive) -cne $receipt.asarSha256) { throw 'Package executable or archive hash mismatch.' }
    $embedded = Read-NagneonArchiveJson $archive 'shared/profile-reader.json'
    if ($embedded.schema -cne 'nagneon.profile-reader/1' -or ((@($embedded.PSObject.Properties.Name | Sort-Object) -join '|') -cne 'reader|schema')) { throw 'Invalid embedded profile reader capability.' }
    Assert-NagneonSafeInteger $embedded.reader 1
    if ($receipt.profileReader -ne $embedded.reader) { throw 'Package reader differs from its embedded runtime capability.' }
    $app = Read-NagneonArchiveJson $archive 'package.json'
    if (-not @($app.PSObject.Properties | Where-Object { $_.Name -ceq 'version' }).Count) { throw 'Missing embedded application version.' }
    Assert-NagneonVersionString $app.version
    $exeVersion = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
    if ($exeVersion -notmatch '^(\d+\.\d+\.\d+)(?:\.0)?$') { throw 'Cannot identify the packaged executable version.' }
    $exeVersion = $Matches[1]
    if ($app.version -cne $receipt.appVersion -or $exeVersion -cne $receipt.appVersion -or ($ExpectedVersion -and $ExpectedVersion -cne $receipt.appVersion)) { throw 'Package application versions differ.' }
    return [pscustomobject]@{appVersion=$receipt.appVersion;profileReader=[long]$receipt.profileReader;exeSha256=$receipt.exeSha256;asarSha256=$receipt.asarSha256;receiptSha256=$receiptSha256}
}
