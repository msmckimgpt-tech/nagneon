"""Local Korean STT. JSONL input/output; model stays loaded between segments."""
import argparse
import base64
import json
from pathlib import Path
import sys
import tempfile
import av
import numpy as np
from faster_whisper import WhisperModel

parser = argparse.ArgumentParser()
parser.add_argument('--download-only', action='store_true')
parser.add_argument('--model-path', type=Path)
parser.add_argument('--offline', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
model = WhisperModel(str(args.model_path) if args.model_path else 'small', device='cpu', compute_type='int8', download_root=None if args.model_path else str(root / '.models'), local_files_only=args.offline, cpu_threads=4)
print(json.dumps({'ready': True, 'model': 'small', 'device': 'cpu/int8'}), flush=True)
if args.download_only:
    sys.exit(0)

def voice_cues(path, text):
    """Acoustic descriptors, deliberately not an emotion/identity classifier."""
    frames = []
    with av.open(str(path)) as container:
        resampler = av.AudioResampler(format='flt', layout='mono', rate=8000)
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                frames.append(out.to_ndarray().flatten())
    if not frames:
        return None
    samples = np.concatenate(frames)
    duration = len(samples) / 8000
    rms = float(np.sqrt(np.mean(samples ** 2)))
    pitches = []
    for start in np.linspace(0, max(0, len(samples) - 400), min(45, len(samples) // 400), dtype=int):
        chunk = samples[start:start + 400]
        if len(chunk) < 400 or np.sqrt(np.mean(chunk ** 2)) < .012:
            continue
        chunk = (chunk - chunk.mean()) * np.hanning(len(chunk))
        corr = np.correlate(chunk, chunk, mode='full')[399:]
        lag = int(np.argmax(corr[16:115])) + 16
        if corr[0] > 0 and corr[lag] / corr[0] > .45:
            pitches.append(8000 / lag)
    db = round(20 * np.log10(max(rms, 1e-8)), 1)
    pitch = round(float(np.median(pitches)), 1) if pitches else None
    variation = round(float(np.std(pitches) / max(pitch, 1)), 2) if pitch else None
    rate = round(len(text.replace(' ', '')) / max(duration, .1), 1)
    return {'durationSeconds': round(duration, 1), 'volumeDb': db, 'pitchHz': pitch,
            'pitchVariation': variation, 'charactersPerSecond': rate,
            'delivery': ('큰 음량' if db > -20 else '작은 음량' if db < -36 else '보통 음량') + (' · 빠른 발화' if rate > 6 else '') + (' · 음높이 변화 큼' if variation and variation > .25 else ''),
            'confidence': 'low', 'caveat': '마이크 설정과 잡음의 영향을 받는 음성 단서이며 감정 판정이 아님'}
for line in sys.stdin:
    path = None
    try:
        job = json.loads(line)
        with tempfile.NamedTemporaryFile(prefix='backseat-audio-', suffix='.webm', delete=False) as file:
            path = Path(file.name)
            file.write(base64.b64decode(job['audio'], validate=True))
        segments, info = model.transcribe(str(path), language='ko', beam_size=1, vad_filter=True, condition_on_previous_text=False)
        text = ' '.join(s.text.strip() for s in segments if s.no_speech_prob < 0.65)
        print(json.dumps({'id': job['id'], 'text': text[:3000], 'cues': voice_cues(path, text)}, ensure_ascii=False), flush=True)
    except Exception:
        print(json.dumps({'error': '로컬 음성 인식에 실패했습니다.'}, ensure_ascii=False), flush=True)
    finally:
        if path is not None:
            path.unlink(missing_ok=True)
