# Microphone accuracy model

The optional microphone model is [Systran/faster-whisper-medium](https://huggingface.co/Systran/faster-whisper-medium), a CTranslate2 conversion of [OpenAI Whisper medium](https://huggingface.co/openai/whisper-medium). Upstream identifies its license as MIT. The existing Whisper license is retained alongside this notice.

Pinned revision: `08e178d48790749d25932bbc082711ddcfdfbc4f`. The exact four files, lengths and SHA-256 digests are in `shared/microphone-model.json`; model.bin is 1,527,906,378 bytes. These are pretrained model data, not remote Python code. BACKSEAT loads them locally with CPU/int8. The game-output sound worker continues to use the separate small model.

Installation verifies all hashes before publication. A built package includes the installed microphone model in the speech payload manifest. Runtime selection does not download anything or upload audio.
