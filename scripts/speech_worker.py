"""Local Korean STT. JSONL input/output; model stays loaded between segments."""
import argparse
import base64
import json
import io
import os
import gc
from pathlib import Path
import sys
import time
import av
import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

class MicrophoneWhisper(WhisperModel):
    # faster-whisper 1.2.1 pads every encoder input to 3000 frames (30s).
    # CT2 4.8.2 supports shorter inputs. The bounded windows below include
    # all audio plus at least 1.5s padding; longer uploads keep the full path.
    encoder_frames = 3000

    def encode(self, features):
        return super().encode(features[..., :self.encoder_frames])


def encoder_window_frames(sample_count):
    # Normal capture stops at 6s, but delayed browser callbacks and imported
    # segments may be longer. Do not jump straight from 8s to 30s of work.
    if sample_count > 0:
        for seconds, frames in [(2.5, 400), (4.5, 600), (6.5, 800), (10.5, 1200), (14.5, 1600)]:
            if sample_count <= seconds * 16000:
                return frames
    return 3000


def recognize(model, samples):
    frames = encoder_window_frames(len(samples))
    options = dict(language='ko', beam_size=3, vad_filter=True, condition_on_previous_text=False)
    fallback = False
    try:
        model.encoder_frames = frames
        # A low-confidence short pass gets the original 30s context and the
        # original temperature fallback, rather than repeated short decodes.
        segments, info = model.transcribe(samples, **options, **({'temperature': 0.0} if frames < 3000 else {}))
        segments = list(segments)
        if frames < 3000 and ((not segments and info.duration_after_vad > .2) or any(
                s.avg_logprob < -1 or s.compression_ratio > 2.4 or s.no_speech_prob >= .65
                for s in segments)):
            fallback = True
            model.encoder_frames = 3000
            segments, info = model.transcribe(samples, **options)
            segments = list(segments)
        text = ' '.join(s.text.strip() for s in segments if s.no_speech_prob < .65)
        return text[:3000], {'encoderWindowMs': frames * 10, 'fallback': fallback,
                            'encoderPassesMs': [frames * 10] + ([30000] if fallback else [])}
    finally:
        model.encoder_frames = 3000

def voice_cues(path, text):
    """Acoustic descriptors, deliberately not an emotion/identity classifier."""
    frames = []
    with av.open(path) as container:
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
def process_job(model, job):
    started = time.perf_counter()
    audio = base64.b64decode(job['audio'], validate=True)
    samples = decode_audio(io.BytesIO(audio))
    decoded = time.perf_counter()
    text, policy = recognize(model, samples)
    recognized = time.perf_counter()
    # Descriptors are optional; their failure must not discard recognized speech.
    try:
        cues = voice_cues(io.BytesIO(audio), text)
    except Exception:
        cues = None
    finished = time.perf_counter()
    return {'id': job['id'], 'text': text, 'cues': cues,
            'timing': {**policy, 'decodeMs': round((decoded - started) * 1000),
                       'recognitionMs': round((recognized - decoded) * 1000),
                       'cuesMs': round((finished - recognized) * 1000),
                       'processingMs': round((finished - started) * 1000)}}


def serve(model, lines, emit, recover=None):
    for line in lines:
        job = {}
        try:
            job = json.loads(line)
            if not isinstance(job, dict):
                job = {}
                raise ValueError('Invalid job')
            try:
                result = process_job(model, job)
            except RuntimeError as error:
                if recover is None or not any(word in str(error).lower() for word in ('cuda', 'cublas', 'cudnn', 'out of memory')):
                    raise
                model = recover()
                recover = None
                result = process_job(model, job)
            emit(result)
        except Exception:
            # Job errors must not be mistaken for fatal model startup errors.
            emit({'id': job.get('id'), 'error': '로컬 음성 인식에 실패했습니다.'})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--download-only', action='store_true')
    parser.add_argument('--model-path', type=Path)
    parser.add_argument('--model-name', default='small')
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--device', choices=['gpu', 'cpu'], default='gpu')
    parser.add_argument('--gpu-library-path', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    # Keep directory handles alive for the lifetime of the worker. Never modify
    # the user's system PATH; packaged and development libraries are local.
    libraries = args.gpu_library_path or root / '.models' / 'gpu'
    bins = sorted(libraries.glob('nvidia/*/bin')) if args.device == 'gpu' else []
    handles = [os.add_dll_directory(str(p.resolve())) for p in bins] if os.name == 'nt' else []
    if bins:
        os.environ['PATH'] = os.pathsep.join(str(p.resolve()) for p in bins) + os.pathsep + os.environ.get('PATH', '')
    emit = lambda value: print(json.dumps(value, ensure_ascii=False), flush=True)
    active = [None]

    def load(device, fallback=False):
        if active[0] is not None:
            active[0].model.unload_model()
        active[0] = None
        gc.collect()
        model = MicrophoneWhisper(str(args.model_path) if args.model_path else 'small',
                                 device=device, compute_type='int8_float16' if device == 'cuda' else 'int8',
                                 download_root=None if args.model_path else str(root / '.models'),
                                 local_files_only=args.offline, cpu_threads=4)
        if device == 'cuda':
            # DLL loading is lazy. Readiness must mean actual GPU inference works.
            model.encoder_frames = 400
            model.encode(np.zeros((model.feature_extractor.mel_filters.shape[0], 400), dtype=np.float32))
            model.encoder_frames = 3000
        active[0] = model
        emit({'ready': True, 'model': args.model_name,
              'device': 'GPU / int8_float16' if device == 'cuda' else 'CPU / int8', 'fallback': fallback})
        return model

    if args.device == 'gpu' and not args.download_only:
        try:
            load('cuda')
        except Exception:
            load('cpu', fallback=True)
    else:
        load('cpu')
    if not args.download_only:
        serve(active[0], sys.stdin, emit,
              (lambda: load('cpu', fallback=True)) if args.device == 'gpu' and active[0].model.device == 'cuda' else None)


if __name__ == '__main__':
    main()
