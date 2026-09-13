# Portable Windows Korean Speech Runtime

A self-contained, portable Windows **x64** runtime for local Korean speech-to-text
(faster-whisper `small`, CPU / int8). It bundles an official Python embeddable, the
pinned binary dependencies, and the resolved Whisper model snapshot so it can be shipped
inside the Electron app as `resources/speech` with **no Python install** on the target PC.

- Builder: [`scripts/prepare-speech-runtime.ps1`](../scripts/prepare-speech-runtime.ps1)
- Pinned deps: [`scripts/speech-requirements.txt`](../scripts/speech-requirements.txt)
- Worker (copied separately by the app packager): `scripts/speech_worker.py`

> Scope note: this document and the builder cover **runtime assembly only**. Main-process
> / server integration and the final packager are implemented separately by the app.

---

## Runtime layout

Each build produces a fresh, timestamped folder `artifacts/speech-runtime-<yyyyMMdd-HHmmss>`:

```
speech-runtime-<timestamp>/
├─ python/
│  ├─ python.exe                 # CPython 3.13.15 embeddable (amd64)
│  ├─ python313.zip, *.pyd, *.dll
│  ├─ python313._pth             # relative paths only + `import site`
│  └─ Lib/site-packages/         # pinned wheels + *.dist-info (licenses/metadata)
├─ model/
│  ├─ config.json
│  ├─ model.bin                  # CT2 int8 weights
│  ├─ tokenizer.json
│  └─ vocabulary.txt
├─ manifest.json                 # provenance, versions, SHA256 manifest
└─ BUILD-LOG.txt                 # short build summary (no developer paths)
```

The app packager copies this folder as `resources/speech` and drops
`scripts/speech_worker.py` alongside it (the worker resolves the model at
`../.models` today; the packager wires it to `model/` in its own integration).

Approximate size: **~724 MB** (python ~260 MB incl. site-packages ~240 MB, model ~464 MB).

### `python313._pth`

```
python313.zip
.
Lib\site-packages

# Enable site so pip-installed wheels and their bundled DLLs load correctly.
import site
```

Only runtime-relative directories, no developer paths. `import site` is required so that
site-packages is added to `sys.path` and the wheels that ship bundled native DLLs
(`av.libs`, `numpy.libs`, `ctranslate2`, `onnxruntime`, `hf_xet`) can load via their
`os.add_dll_directory` init hooks.

---

## Provenance & pinned versions

### Python

| Field | Value |
|-------|-------|
| Version | **3.13.15** (official embeddable, amd64) |
| URL | `https://www.python.org/ftp/python/3.13.15/python-3.13.15-embeddable-amd64.zip` |
| Size | 11,010,501 bytes |
| SHA256 | `791ada5e20aba24524f8d939cdeb069976d632a699fe5cb65274b23f4545e68a` |

The SHA256 is **published by python.org itself** in the release SPDX SBOM
(`…embeddable-amd64.zip.spdx.json`, CPython package checksum). The builder:

1. Downloads the zip and computes its SHA256.
2. Fails hard unless it equals the pinned constant (before any extraction).
3. Additionally re-downloads the vendor SBOM at build time and cross-checks that
   `SBOM == pinned == download` (`sbomVerified: true` in the manifest).

### Dependencies (from `scripts/speech-requirements.txt`)

Captured from the project's dev venv `pip freeze` (2026-09-13) and installed into the
runtime with wheels only (`--only-binary=:all: --no-compile --target Lib\site-packages`).
The dev venv is **never copied** — it is used solely to resolve/download wheels.

```
anyio==4.15.1      av==18.1.0            certifi==2026.7.22   click==8.5.0
colorama==0.4.6    ctranslate2==4.8.2    faster-whisper==1.2.1 filelock==3.32.6
flatbuffers==25.12.19  fsspec==2026.7.0  h11==0.16.0          hf-xet==1.6.0
httpcore==1.0.9    httpx==0.28.1         huggingface_hub==1.31.0  idna==3.19
numpy==2.5.3       onnxruntime==1.30.0   packaging==26.3      protobuf==7.36.1
PyYAML==6.0.3      tokenizers==0.23.2    tqdm==4.70.1         typing_extensions==4.16.0
```

24 distributions total; each `*.dist-info` (license + metadata) is retained in
site-packages.

**ABI note:** wheels are resolved by the dev venv interpreter (**CPython 3.13.7**,
`cp313-win_amd64`) and are ABI-compatible with the **3.13.15** embeddable runtime — both
are CPython 3.13, same `cp313` wheel tag. The builder enforces that the resolver is a
3.13.x interpreter.

### Model

| Field | Value |
|-------|-------|
| Repo | `Systran/faster-whisper-small` |
| Snapshot | `536b0662742c02347bc0e980a01041f333bce120` |
| Compute | `device=cpu, compute_type=int8` |

Only the resolved snapshot files are copied — never `.locks/`, `blobs/`, `refs/`,
`trees/`, `CACHEDIR.TAG`, or any user/token/settings files. Per-file SHA256 is recorded
in `manifest.json`:

| File | Bytes | SHA256 |
|------|-------|--------|
| config.json | 2,370 | `b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828` |
| model.bin | 483,546,902 | `3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671` |
| tokenizer.json | 2,203,239 | `fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab` |
| vocabulary.txt | 459,861 | `34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913` |

---

## Building

Prerequisites on the build machine:

- Windows **PowerShell 5.1** (the script also runs under WSL via `powershell.exe` interop).
- The project dev venv at `.venv\Scripts\python.exe` (CPython 3.13.x) — used only to
  resolve wheels.
- The local model cache `.models\models--Systran--faster-whisper-small`.
- Network access to `python.org` and PyPI.

```powershell
# From the repo root (Windows):
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prepare-speech-runtime.ps1
```

From WSL:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'G:\dev\ai\00_game_backseat\scripts\prepare-speech-runtime.ps1'
```

Useful parameters (all optional, safe defaults):

| Param | Default | Purpose |
|-------|---------|---------|
| `-OutputName` | `speech-runtime-<timestamp>` | Output folder name (must start with `speech-runtime-`). |
| `-VenvPython` | `.venv\Scripts\python.exe` | Wheel-resolver interpreter (read-only). |
| `-RequirementsPath` | `scripts\speech-requirements.txt` | Pinned deps. |
| `-ModelSource` | `.models\models--Systran--faster-whisper-small` | Model cache. |
| `-TestAudio` | `artifacts\korean-fixture.wav` | Synthetic fixture for the smoke test. |
| `-SkipTest` | (off) | Build without running the smoke test. |

### Safety behaviors

- **Refuses to write outside** the repo `artifacts` directory, and rejects any
  `-OutputName` not matching `^speech-runtime-[A-Za-z0-9._-]+$`.
- **Refuses to overwrite / never recursively deletes** an existing output path — pick a
  new name instead. The only cleanup it performs is removing its own throwaway download
  staging dir under `%TEMP%`.
- Uses the dev venv **read-only**; performs no user/global pip installs and never touches
  `.env`, `.venv` contents, tokens, or global config.
- Strips the pip-generated `bin\` console-script launchers from site-packages, because
  their `.exe` shebangs embed the builder interpreter path (a developer path the runtime
  never uses).

### Environment quirk handled

Some trimmed PowerShell 5.1 setups (observed on the build host) are missing the
`Get-FileHash` and `Expand-Archive` cmdlets. The builder therefore hashes with
`System.Security.Cryptography.SHA256` and extracts with
`System.IO.Compression.ZipFile` directly, so it works on both stock and trimmed hosts.

---

## Verification / tests run

The builder runs a smoke test **using the assembled embeddable `python.exe`** (not the
dev venv) and appends commands + results to
[`artifacts/claude-runtime-test.log`](../artifacts/claude-runtime-test.log). It:

1. Imports `numpy`, `av`, `ctranslate2`, `faster_whisper`.
2. Creates `WhisperModel(<model abs path>, device="cpu", compute_type="int8", local_files_only=True)`.
3. Transcribes the synthetic Korean fixture `artifacts/korean-fixture.wav`.

Latest run (`speech-runtime-20260913-044949`):

- Interpreter: `3.13.15 … [MSC v.1944 64 bit (AMD64)]` (embeddable, **not** dev venv).
- `numpy 2.5.3 · av 18.1.0 · ctranslate2 4.8.2 · faster_whisper 1.2.1`.
- Model load ≈ 1.2 s; transcribe ≈ 2.6 s; `detected_language: ko`.
- Text: `안녕하세요 여러분 오늘은 게임을 하지 않고 편하게 이야기 하려고 해요 오늘 정말 신나는 일이 있었어요`
  (42 Hangul chars; matches the reference fixture output).

An independent check (invoking the embeddable `python.exe` directly, outside the build
script) confirmed `sys.executable` is the runtime's python, site-packages is on
`sys.path`, and `.venv` is **not** referenced.

No microphones and no network model/API calls are used — only the local synthetic
fixture and local model files.

---

## Licensing & acceptance caveats

- The bundled third-party wheels and the `Systran/faster-whisper-small` model each retain
  their **own upstream licenses**. Assembling this runtime asserts **no redistribution
  rights**; confirm each component's license before distributing the app.
- The runtime has been verified to import and transcribe **on the dev PC only**. This is
  **not** a clean-Windows acceptance test — validate on a fresh Windows x64 machine with
  no Python before shipping. (In particular, some wheels may require the Microsoft Visual
  C++ runtime; verify on a clean host.)
