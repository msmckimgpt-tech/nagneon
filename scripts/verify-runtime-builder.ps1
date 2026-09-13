$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'prepare-speech-runtime.ps1'
$parseTokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Builder parse failed' }
$function = $ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Remove-OwnedTree'}, $true)
if (-not $function) { throw 'Missing scoped cleanup function' }
. ([scriptblock]::Create($function.Extent.Text))
$boundary = Join-Path ([System.IO.Path]::GetTempPath()) ('backseat-builder-test-' + [Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $boundary)
$owned = Join-Path $boundary 'bin'; [void](New-Item -ItemType Directory -Path $owned)
$unrelated = Join-Path $boundary 'preserve'; [void](New-Item -ItemType Directory -Path $unrelated)
[System.IO.File]::WriteAllText((Join-Path $owned 'test.txt'),'owned')
[System.IO.File]::WriteAllText((Join-Path $unrelated 'test.txt'),'preserve')
$checks = @()
try {
    $denied = $false
    try { Remove-OwnedTree $boundary $boundary '.*' } catch { $denied = $true }
    if (-not $denied -or -not (Test-Path -LiteralPath $owned)) { throw 'Root boundary was not preserved' }
    $checks += 'boundary root is rejected'
    $denied = $false
    try { Remove-OwnedTree $unrelated $boundary '^(bin|Scripts)$' } catch { $denied = $true }
    if (-not $denied -or [System.IO.File]::ReadAllText((Join-Path $unrelated 'test.txt')) -ne 'preserve') { throw 'Unrelated target was not preserved' }
    $checks += 'unrelated sibling is preserved'
    $denied = $false
    try { Remove-OwnedTree $owned (Join-Path $boundary 'different-root') '^(bin|Scripts)$' } catch { $denied = $true }
    if (-not $denied) { throw 'Wrong boundary accepted' }
    $checks += 'target outside specified boundary is rejected'
    Remove-OwnedTree $owned $boundary '^(bin|Scripts)$'
    if ((Test-Path -LiteralPath $owned) -or -not (Test-Path -LiteralPath $unrelated)) { throw 'Owned cleanup failed' }
    $checks += 'only exact owned tree is removed'
    @{passed=$true;checks=$checks} | ConvertTo-Json
} finally {
    # Same checked helper; exact generated test directory under OS temp only.
    Remove-OwnedTree $boundary ([System.IO.Path]::GetTempPath()) '^backseat-builder-test-[0-9a-f]{32}$'
}
