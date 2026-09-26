<#
.SYNOPSIS
    Assemble a portable Windows x64 Korean speech runtime for the Electron app.

.DESCRIPTION
    Builds a self-contained runtime under artifacts\speech-runtime-<timestamp> that can be
    copied verbatim as resources\speech. The runtime bundles:

        python\python.exe            official CPython 3.13.15 embeddable (amd64)
        python\Lib\site-packages\    pinned binary wheels (faster-whisper, av, numpy, ...)
        model\                        faster-whisper-small CT2 model snapshot files
        manifest.json                provenance, versions, and SHA256 manifest

    The script never mutates the developer environment. It only READS the dev venv
    (.venv\Scripts\python.exe, used purely to resolve/download wheels via pip --target),
    the pinned requirements, and the local model cache. It does NOT copy the dev venv,
    touch user data / tokens / global config, or recursively delete anything.

    PowerShell 5.1 compatible. Intended to be run on Windows (or via WSL interop).

.NOTES
    Parent copies scripts\speech_worker.py into the runtime separately.
#>
[CmdletBinding()]
param(
    # Directory that will receive the new speech-runtime-* folder (must be the repo artifacts dir).
    [string] $OutputRoot,
    # Explicit output folder name. Must start with 'speech-runtime-'. Defaults to a timestamp.
    [string] $OutputName,
    # Dev venv interpreter used ONLY to resolve/download wheels (never copied into the runtime).
    [string] $VenvPython,
    # Pinned requirements file.
    [string] $RequirementsPath,
    # HuggingFace-style model cache dir for faster-whisper-small.
    [string] $ModelSource,
    # Synthetic Korean audio fixture used by the smoke test (optional).
    [string] $TestAudio,
    # Skip the embeddable-runtime smoke test (build only).
    [switch] $SkipTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$ProgressPreference = 'SilentlyContinue'

# --- Pinned, vendor-verified provenance for the Python embeddable -----------------------
# Source : https://www.python.org/downloads/release/python-31315/
# File   : https://www.python.org/ftp/python/3.13.15/python-3.13.15-embeddable-amd64.zip
# SHA256 : published by python.org in the release SPDX SBOM (CPython package checksum)
#          https://www.python.org/ftp/python/3.13.15/python-3.13.15-embeddable-amd64.zip.spdx.json
$PythonVersion   = '3.13.15'
$EmbedUrl        = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embeddable-amd64.zip"
$EmbedSbomUrl    = "$EmbedUrl.spdx.json"
$EmbedSha256     = '791ADA5E20ABA24524F8D939CDEB069976D632A699FE5CB65274B23F4545E68A'
$EmbedSizeBytes  = 11010501

$RequiredModelFiles = @('config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt')
$StorageOwnerSchema = 'nagneon.storage-owner/1'
$SpeechRuntimeKeep = 2
$StorageOwnerFile = '.nagneon-storage.json'

# --- Resolve repo-relative defaults -----------------------------------------------------
$RepoRoot = Split-Path -Parent $PSScriptRoot
function Resolve-Default([string] $value, [string] $fallbackRelative) {
    if ([string]::IsNullOrWhiteSpace($value)) { return (Join-Path $RepoRoot $fallbackRelative) }
    if ([System.IO.Path]::IsPathRooted($value)) { return $value }
    return (Join-Path $RepoRoot $value)
}
$OutputRoot       = Resolve-Default $OutputRoot 'artifacts'
$VenvPython       = Resolve-Default $VenvPython '.venv\Scripts\python.exe'
$RequirementsPath = Resolve-Default $RequirementsPath 'scripts\speech-requirements.txt'
$ModelSource      = Resolve-Default $ModelSource '.models\models--Systran--faster-whisper-small'
if ([string]::IsNullOrWhiteSpace($TestAudio)) {
    $TestAudio = Join-Path $RepoRoot 'artifacts\korean-fixture.wav'
} elseif (-not [System.IO.Path]::IsPathRooted($TestAudio)) {
    $TestAudio = Join-Path $RepoRoot $TestAudio
}

function Write-Step([string] $message) { Write-Host "==> $message" }

# Use .NET APIs for hashing and zip extraction so the script does not depend on the
# Get-FileHash / Expand-Archive cmdlets (which are absent in some trimmed PS 5.1 setups).
function Get-Sha256Hex([string] $Path) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $fs = [System.IO.File]::OpenRead($Path)
        try { $bytes = $sha.ComputeHash($fs) } finally { $fs.Dispose() }
    } finally { $sha.Dispose() }
    return (([BitConverter]::ToString($bytes)) -replace '-', '')
}
function Expand-ZipTo([string] $ZipPath, [string] $DestDir) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
    [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $DestDir)
}
function Remove-OwnedTree([string] $TargetPath, [string] $BoundaryRoot, [string] $LeafPattern) {
    $targetFull = [System.IO.Path]::GetFullPath($TargetPath).TrimEnd('\')
    $boundaryFull = [System.IO.Path]::GetFullPath($BoundaryRoot).TrimEnd('\')
    if (([System.IO.Path]::GetDirectoryName($targetFull)) -ne $boundaryFull -or
        ([System.IO.Path]::GetFileName($targetFull)) -notmatch $LeafPattern) {
        throw "Refusing cleanup outside the verified owned directory: $targetFull"
    }
    if ((Get-Item -LiteralPath $targetFull -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "Refusing cleanup of a linked directory: $targetFull"
    }
    Remove-Item -LiteralPath $targetFull -Recurse -Force
}

# --- Preflight checks -------------------------------------------------------------------
Write-Step "prepare-speech-runtime :: Python embeddable $PythonVersion (win_amd64)"

if ($PSVersionTable.PSVersion.Major -lt 5) {
    throw "PowerShell 5.1+ required; found $($PSVersionTable.PSVersion)."
}
if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
    throw "Dev venv interpreter not found: $VenvPython (needed only to resolve wheels)."
}
if (-not (Test-Path -LiteralPath $RequirementsPath -PathType Leaf)) {
    throw "Requirements file not found: $RequirementsPath"
}
if (-not (Test-Path -LiteralPath $ModelSource -PathType Container)) {
    throw "Model source not found: $ModelSource"
}

# Confirm the resolver interpreter is CPython 3.13 (cp313 wheels are ABI-compatible with 3.13.15).
$builderVersionRaw = (& $VenvPython -c "import platform,sys;print(platform.python_version());print(sys.version.replace(chr(10),' '))") 2>&1
if ($LASTEXITCODE -ne 0) { throw "Failed to query dev venv interpreter: $builderVersionRaw" }
$builderVersion = ($builderVersionRaw | Select-Object -First 1).Trim()
if ($builderVersion -notmatch '^3\.13\.') {
    throw "Dev venv is Python $builderVersion; a CPython 3.13.x interpreter is required to resolve cp313 wheels for the 3.13.15 runtime."
}
Write-Step "Wheel resolver interpreter: CPython $builderVersion (cp313 ABI)"

# --- Compute + validate output path (reject unsafe / existing) --------------------------
$OutputRootFull = [System.IO.Path]::GetFullPath($OutputRoot)
$ArtifactsFull  = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot 'artifacts'))
if ($OutputRootFull.TrimEnd('\') -ne $ArtifactsFull.TrimEnd('\')) {
    throw "Refusing to write outside the repo artifacts dir. OutputRoot='$OutputRootFull', expected '$ArtifactsFull'."
}
if (-not (Test-Path -LiteralPath $OutputRootFull -PathType Container)) {
    throw "Output root does not exist: $OutputRootFull"
}

$ownedSpeechRuntimes = @()
$unfinishedSpeechRuntimes = @()
foreach ($candidate in (Get-ChildItem -LiteralPath $OutputRootFull -Directory -Filter 'speech-runtime-*' -ErrorAction Stop)) {
    if ($candidate.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { continue }
    $ownerPath = Join-Path $candidate.FullName $StorageOwnerFile
    if (-not (Test-Path -LiteralPath $ownerPath -PathType Leaf)) { continue }
    try {
        $owner = Get-Content -LiteralPath $ownerPath -Raw | ConvertFrom-Json
        if ($owner.schema -eq $StorageOwnerSchema -and $owner.kind -eq 'speech-runtime') {
            if ($owner.state -eq 'complete') { $ownedSpeechRuntimes += $candidate.FullName }
            else { $unfinishedSpeechRuntimes += $candidate.FullName }
        }
    } catch {
        # Unknown/corrupt legacy output is protected; never treat it as an owned cleanup slot.
    }
}
if ($unfinishedSpeechRuntimes.Count -gt 0) {
    throw "종료되지 않은 speech runtime 출력이 남아 있습니다. storage:preview에서 상태를 확인하고 명시 정리한 뒤 다시 시도하세요."
}
if ($ownedSpeechRuntimes.Count -ge $SpeechRuntimeKeep) {
    throw "검증된 speech runtime 후보 $SpeechRuntimeKeep 개를 이미 보존 중입니다. node scripts/storage-maintenance.mjs --reserve-speech-slot 로 미리보기 후 명시 정리하세요."
}

if ([string]::IsNullOrWhiteSpace($OutputName)) {
    $OutputName = 'speech-runtime-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
}
if ($OutputName -notmatch '^speech-runtime-[A-Za-z0-9._-]+$') {
    throw "Unsafe OutputName '$OutputName'. Must match ^speech-runtime-[A-Za-z0-9._-]+$."
}
$RuntimeDir = Join-Path $OutputRootFull $OutputName
if (Test-Path -LiteralPath $RuntimeDir) {
    throw "Output path already exists: $RuntimeDir. Refusing to overwrite or delete; choose a new -OutputName."
}

$PythonDir       = Join-Path $RuntimeDir 'python'
$SitePackagesDir = Join-Path $PythonDir  'Lib\site-packages'
$ModelDir        = Join-Path $RuntimeDir 'model'
$ManifestPath    = Join-Path $RuntimeDir 'manifest.json'
$BuildLogPath    = Join-Path $RuntimeDir 'BUILD-LOG.txt'

New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
$StorageOwnerPath = Join-Path $RuntimeDir $StorageOwnerFile
$storageOwner = [ordered]@{
    schema = $StorageOwnerSchema
    kind = 'speech-runtime'
    state = 'building'
    outputName = $OutputName
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
}
$storageOwner | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StorageOwnerPath -Encoding UTF8
New-Item -ItemType Directory -Path $ModelDir   -Force | Out-Null
# $PythonDir is created by the zip extraction; $SitePackagesDir by pip --target.
Write-Step "Output runtime dir: $RuntimeDir"

# Staging dir for the download (outside the runtime tree so the zip is not shipped).
$StagingDir = Join-Path ([System.IO.Path]::GetTempPath()) ("speech-runtime-dl-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null

$manifest = [ordered]@{}
try {
    # --- 1. Download + verify the Python embeddable ------------------------------------
    Write-Step "Downloading Python embeddable: $EmbedUrl"
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $zipPath = Join-Path $StagingDir "python-$PythonVersion-embeddable-amd64.zip"
    Invoke-WebRequest -Uri $EmbedUrl -OutFile $zipPath -UseBasicParsing

    $actualSize = (Get-Item -LiteralPath $zipPath).Length
    $actualHash = (Get-Sha256Hex $zipPath).ToUpperInvariant()
    Write-Step "Downloaded $actualSize bytes; SHA256=$actualHash"
    if ($actualHash -ne $EmbedSha256.ToUpperInvariant()) {
        throw "Python embeddable SHA256 mismatch. expected=$EmbedSha256 actual=$actualHash. Aborting before extraction."
    }
    if ($actualSize -ne $EmbedSizeBytes) {
        Write-Warning "Downloaded size $actualSize != expected $EmbedSizeBytes (hash matched; continuing)."
    }
    Write-Step "SHA256 matches pinned vendor value; download trusted."

    # Best-effort: re-verify against python.org's own published SBOM checksum at build time.
    $sbomVerified = $false
    $sbomHash = $null
    try {
        $sbomPath = Join-Path $StagingDir 'embed.spdx.json'
        Invoke-WebRequest -Uri $EmbedSbomUrl -OutFile $sbomPath -UseBasicParsing
        $sbom = Get-Content -LiteralPath $sbomPath -Raw | ConvertFrom-Json
        foreach ($pkg in $sbom.packages) {
            if ($pkg.name -eq 'CPython') {
                foreach ($c in $pkg.checksums) {
                    if ($c.algorithm -eq 'SHA256') { $sbomHash = $c.checksumValue.ToUpperInvariant() }
                }
            }
        }
        if ($sbomHash -and ($sbomHash -eq $EmbedSha256.ToUpperInvariant()) -and ($sbomHash -eq $actualHash)) {
            $sbomVerified = $true
            Write-Step "Vendor SBOM cross-check OK (python.org SPDX CPython SHA256 == pinned == download)."
        } else {
            Write-Warning "Vendor SBOM cross-check inconclusive (sbom=$sbomHash). Primary pinned-hash gate already passed."
        }
    } catch {
        Write-Warning "Could not fetch/parse vendor SBOM for cross-check: $($_.Exception.Message). Primary pinned-hash gate already passed."
    }

    Write-Step "Extracting embeddable into $PythonDir"
    Expand-ZipTo $zipPath $PythonDir
    New-Item -ItemType Directory -Path $SitePackagesDir -Force | Out-Null

    $embedPython = Join-Path $PythonDir 'python.exe'
    if (-not (Test-Path -LiteralPath $embedPython -PathType Leaf)) {
        throw "python.exe not found after extraction: $embedPython"
    }

    # --- 2. Configure ._pth : runtime-relative dirs only, enable site for wheel DLLs ---
    $pthFile = Get-ChildItem -LiteralPath $PythonDir -Filter 'python*._pth' -File | Select-Object -First 1
    if (-not $pthFile) { throw "Embeddable ._pth file not found in $PythonDir" }
    $pthContent = @(
        'python313.zip'
        '.'
        'Lib\site-packages'
        ''
        '# Enable site so pip-installed wheels and their bundled DLLs load correctly.'
        'import site'
    ) -join "`r`n"
    Set-Content -LiteralPath $pthFile.FullName -Value $pthContent -Encoding ASCII
    Write-Step "Wrote $($pthFile.Name) (relative paths only; import site enabled)"

    # --- 3. Install pinned wheels into the runtime site-packages -----------------------
    Write-Step "Installing pinned wheels via pip --target (wheels only, no user/global install)"
    & $VenvPython -m pip install `
        --no-cache-dir --no-input --disable-pip-version-check `
        --only-binary=:all: --no-compile `
        --target $SitePackagesDir `
        --requirement $RequirementsPath
    if ($LASTEXITCODE -ne 0) { throw "pip install --target failed (exit $LASTEXITCODE)." }

    # Verify the pinned versions actually landed (metadata retained by pip).
    $installedRaw = & $VenvPython -m pip list --path $SitePackagesDir --format=freeze 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Failed to enumerate installed packages: $installedRaw" }
    $installed = @()
    foreach ($line in ($installedRaw -split "`r?`n")) {
        $t = $line.Trim()
        if ($t -match '^[^#].+==.+$') { $installed += $t }
    }
    Write-Step "Installed $($installed.Count) distributions into site-packages"

    # pip --target emits console-script .exe launchers whose shebang embeds the BUILDER
    # interpreter path (a developer path). The runtime never invokes these, so strip them
    # to keep the runtime free of developer paths. Only known pip launcher dirs are removed.
    foreach ($launcherDir in @('bin', 'Scripts')) {
        $ld = Join-Path $SitePackagesDir $launcherDir
        if (Test-Path -LiteralPath $ld -PathType Container) {
            Remove-OwnedTree $ld $SitePackagesDir '^(bin|Scripts)$'
            Write-Step "Removed unused pip launcher dir: site-packages\$launcherDir"
        }
    }

    # --- 4. Copy the resolved model snapshot (no caches / locks / tokens) --------------
    $refsMainPath = Join-Path $ModelSource 'refs\main'
    if (-not (Test-Path -LiteralPath $refsMainPath -PathType Leaf)) {
        throw "Model refs\main not found: $refsMainPath"
    }
    $snapshotId = (Get-Content -LiteralPath $refsMainPath -Raw).Trim()
    if ($snapshotId -notmatch '^[0-9a-f]{40}$') { throw "Unexpected snapshot id '$snapshotId'." }
    $snapshotDir = Join-Path (Join-Path $ModelSource 'snapshots') $snapshotId
    if (-not (Test-Path -LiteralPath $snapshotDir -PathType Container)) {
        throw "Snapshot dir not found for id ${snapshotId}: $snapshotDir"
    }
    Write-Step "Copying model snapshot $snapshotId"

    $modelFilesManifest = @()
    foreach ($f in (Get-ChildItem -LiteralPath $snapshotDir -File)) {
        # Resolve through any symlink so we copy real content, never a cache/blob reference.
        $srcResolved = (Resolve-Path -LiteralPath $f.FullName).ProviderPath
        $dest = Join-Path $ModelDir $f.Name
        Copy-Item -LiteralPath $srcResolved -Destination $dest -Force
        $h = (Get-Sha256Hex $dest).ToLowerInvariant()
        $sz = (Get-Item -LiteralPath $dest).Length
        $modelFilesManifest += [ordered]@{ name = $f.Name; sha256 = $h; bytes = $sz }
        Write-Step "  model/$($f.Name)  $sz bytes"
    }
    foreach ($req in $RequiredModelFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $ModelDir $req) -PathType Leaf)) {
            throw "Required model file missing after copy: $req"
        }
    }
    # Validate config.json parses as JSON.
    try {
        Get-Content -LiteralPath (Join-Path $ModelDir 'config.json') -Raw | ConvertFrom-Json | Out-Null
    } catch {
        throw "model/config.json is not valid JSON: $($_.Exception.Message)"
    }
    Write-Step "Model files copied and verified ($($modelFilesManifest.Count) files)"

    # --- 5. Write manifest.json --------------------------------------------------------
    $manifest = [ordered]@{
        schema      = 'backseat.speech-runtime/1'
        generatedAt = (Get-Date).ToUniversalTime().ToString('o')
        generatedBy = 'scripts/prepare-speech-runtime.ps1'
        platform    = 'win_amd64'
        layout      = [ordered]@{
            python       = 'python/python.exe'
            sitePackages = 'python/Lib/site-packages'
            model        = 'model/'
            worker       = 'speech_worker.py (copied separately by parent)'
        }
        python = [ordered]@{
            version   = $PythonVersion
            kind      = 'official embeddable (amd64)'
            url       = $EmbedUrl
            sha256    = $EmbedSha256.ToLowerInvariant()
            bytes     = $EmbedSizeBytes
            sbomUrl   = $EmbedSbomUrl
            sbomVerified = $sbomVerified
            pthFile   = $pthFile.Name
            pthEntries = @('python313.zip', '.', 'Lib\site-packages', 'import site')
        }
        dependencies = [ordered]@{
            resolverInterpreter = "CPython $builderVersion (cp313-win_amd64)"
            requirementsFile    = (Split-Path -Leaf $RequirementsPath)
            installArgs         = '--only-binary=:all: --no-compile --target Lib/site-packages'
            installed           = $installed
        }
        model = [ordered]@{
            repo       = 'Systran/faster-whisper-small'
            snapshotId = $snapshotId
            computeHint = 'device=cpu, compute_type=int8'
            files      = $modelFilesManifest
        }
        notes = @(
            'Runtime is portable: copy this folder as resources/speech.',
            'Verified to import + transcribe on the dev PC only; not a clean-Windows acceptance test.',
            'Third-party wheels and the Whisper model retain their own upstream licenses; no redistribution rights are asserted here.'
        )
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
    Write-Step "Wrote manifest: $ManifestPath"

    # --- Build log inside the output dir ----------------------------------------------
    $buildLog = @()
    $buildLog += "Speech runtime build"
    $buildLog += "generatedAt : $($manifest.generatedAt)"
    # Record only the output folder name (not the absolute build path) so the shipped
    # runtime carries no developer paths and stays relocatable.
    $buildLog += "outputName  : $OutputName"
    $buildLog += "python      : $PythonVersion embeddable  sha256=$($EmbedSha256.ToLowerInvariant())  sbomVerified=$sbomVerified"
    $buildLog += "resolver    : CPython $builderVersion"
    $buildLog += "model       : Systran/faster-whisper-small @ $snapshotId"
    $buildLog += "packages    : $($installed.Count) distributions"
    ($buildLog -join "`r`n") | Set-Content -LiteralPath $BuildLogPath -Encoding UTF8

    # --- 6. Smoke test with the EMBEDDABLE runtime ------------------------------------
    if (-not $SkipTest) {
        Write-Step "Smoke-testing the assembled embeddable runtime"
        $testLog = Join-Path (Join-Path $RepoRoot 'artifacts') 'claude-runtime-test.log'
        $smokePy = Join-Path $StagingDir 'smoke_test.py'
        $smokeSource = @'
import json, os, sys, time
info = {"executable": sys.executable, "version": sys.version.replace("\n", " ")}
import numpy, av, ctranslate2, faster_whisper
info["numpy"] = numpy.__version__
info["av"] = av.__version__
info["ctranslate2"] = ctranslate2.__version__
info["faster_whisper"] = faster_whisper.__version__
from faster_whisper import WhisperModel
out_path = sys.argv[1]
model_dir = os.path.abspath(sys.argv[2])
info["model_dir"] = model_dir
t0 = time.time()
model = WhisperModel(model_dir, device="cpu", compute_type="int8", local_files_only=True)
info["model_load_seconds"] = round(time.time() - t0, 2)
audio = os.path.abspath(sys.argv[3]) if len(sys.argv) > 3 else None
if audio and os.path.exists(audio):
    info["audio"] = audio
    t1 = time.time()
    segments, meta = model.transcribe(audio, language="ko", beam_size=1,
                                      vad_filter=True, condition_on_previous_text=False)
    text = " ".join(s.text.strip() for s in segments if s.no_speech_prob < 0.65)
    info["transcribe_seconds"] = round(time.time() - t1, 2)
    info["detected_language"] = meta.language
    info["text"] = text
    # Confirm real Korean transcription without embedding non-ASCII in this source:
    # count characters in the Hangul Syllables block (U+AC00..U+D7A3) by codepoint.
    hangul = sum(1 for ch in text if 0xAC00 <= ord(ch) <= 0xD7A3)
    info["hangul_chars"] = hangul
    info["korean_ok"] = (meta.language == "ko") and (hangul >= 5)
else:
    info["audio"] = None
    info["korean_ok"] = False
payload = json.dumps(info, ensure_ascii=False, indent=2)
with open(out_path, "w", encoding="utf-8") as fh:
    fh.write(payload)
print(payload)
'@
        Set-Content -LiteralPath $smokePy -Value $smokeSource -Encoding UTF8

        $env:PYTHONUTF8 = '1'
        $env:PYTHONIOENCODING = 'utf-8'
        try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
        $jsonOut = Join-Path $StagingDir 'smoke_result.json'
        $audioArg = ''
        if (Test-Path -LiteralPath $TestAudio -PathType Leaf) { $audioArg = $TestAudio }
        else { Write-Warning "Test audio not found ($TestAudio); running import/model-load check only." }

        $cmdLine = "`"$embedPython`" -X utf8 -B `"$smokePy`" `"$jsonOut`" `"$ModelDir`" `"$audioArg`""
        Write-Step "Test command: $cmdLine"
        if ($audioArg) {
            & $embedPython -X utf8 -B $smokePy $jsonOut $ModelDir $audioArg 2>&1 | Write-Host
        } else {
            & $embedPython -X utf8 -B $smokePy $jsonOut $ModelDir 2>&1 | Write-Host
        }
        $testExit = $LASTEXITCODE
        # Read the child's result from the UTF-8 file it wrote, so the log preserves Korean
        # exactly (piped console output is subject to the OEM codepage and would corrupt it).
        if (Test-Path -LiteralPath $jsonOut -PathType Leaf) {
            $testOutText = [System.IO.File]::ReadAllText($jsonOut, [System.Text.Encoding]::UTF8)
        } else {
            $testOutText = '(smoke test wrote no result file)'
        }

        $stamp = (Get-Date).ToUniversalTime().ToString('o')
        $logBlock = @()
        $logBlock += "======================================================================"
        $logBlock += "[$stamp] prepare-speech-runtime smoke test"
        $logBlock += "runtime : $RuntimeDir"
        $logBlock += "command : $cmdLine"
        $logBlock += "exit    : $testExit"
        $logBlock += "--- output ---"
        $logBlock += $testOutText.TrimEnd()
        $logBlock += ""
        Add-Content -LiteralPath $testLog -Value (($logBlock -join "`r`n")) -Encoding UTF8

        if ($testExit -ne 0) {
            throw "Smoke test failed (exit $testExit). See $testLog"
        }
        if ($audioArg -and ($testOutText -notmatch '"korean_ok":\s*true')) {
            throw "Smoke test produced no valid Korean transcription. See $testLog"
        }
        Write-Step "Smoke test passed (logged to $testLog)"
    } else {
        Write-Step "Smoke test skipped (-SkipTest)."
    }

    # --- Done -------------------------------------------------------------------------
    $storageOwner['state'] = 'complete'
    $storageOwner['updatedAt'] = (Get-Date).ToUniversalTime().ToString('o')
    $storageOwner | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StorageOwnerPath -Encoding UTF8
    Write-Host ''
    Write-Step "SUCCESS"
    Write-Host  "Runtime : $RuntimeDir"
    Write-Host  "Python  : $PythonVersion embeddable (win_amd64)"
    Write-Host  "Model   : Systran/faster-whisper-small @ $snapshotId"
    Write-Host  "Deps    : $($installed.Count) pinned distributions in python\Lib\site-packages"
    Write-Host  "Manifest: $ManifestPath"
}
catch {
    if (Test-Path -LiteralPath $StorageOwnerPath -PathType Leaf) {
        $storageOwner['state'] = 'failed'
        $storageOwner['updatedAt'] = (Get-Date).ToUniversalTime().ToString('o')
        $storageOwner['detail'] = [string]$_.Exception.Message
        $storageOwner | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StorageOwnerPath -Encoding UTF8
    }
    throw
}
finally {
    # Remove only our own temp staging (single tree we created); never touch repo/user data.
    if (Test-Path -LiteralPath $StagingDir) {
        Remove-OwnedTree $StagingDir ([System.IO.Path]::GetTempPath()) '^speech-runtime-dl-[0-9a-f]{32}$'
    }
}
