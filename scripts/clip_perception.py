"""One cancellable, file-only clip visit. JSON stdin; no devices or downloads.

Frames and PCM stay in RAM. A parent-owned process enforces time/output bounds.
The inspector verifies the complete encoded source before perception starts.
"""
import argparse
import base64
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import sys
from fractions import Fraction

import av
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from clip_inspector import inspect, require, MAX_BYTES

MAX_INPUT = 57 * 1024 * 1024
MAX_FRAMES = 12


def jpeg(frame):
    scale = min(1, 640 / frame.width, 480 / frame.height)
    width = max(2, int(frame.width * scale) // 2 * 2)
    height = max(2, int(frame.height * scale) // 2 * 2)
    image = frame.reformat(width=width, height=height, format='yuvj420p')
    image.pts = 0
    image.time_base = Fraction(1, 25)
    codec = av.CodecContext.create('mjpeg', 'w')
    codec.width, codec.height = width, height
    codec.pix_fmt, codec.time_base = 'yuvj420p', Fraction(1, 25)
    codec.qmin, codec.qmax = 6, 6
    blob = b''.join(bytes(packet) for packet in [*codec.encode(image), *codec.encode(None)])
    require(0 < len(blob) <= 240000)
    return 'data:image/jpeg;base64,' + base64.b64encode(blob).decode('ascii')


def decode(source, focus_ms=None):
    blob = base64.b64decode(source['data'], validate=True)
    require(len(blob) <= MAX_BYTES)
    info = inspect(blob, source['kind'], source['hasAudio'], source['durationMs'])
    duration_ms = info['durationMs']
    frames = []
    if source['kind'] == 'video':
        targets = list(np.linspace(0, max(0, duration_ms - 100), 8))
        if focus_ms is not None:
            targets += [min(duration_ms - 1, max(0, focus_ms + offset)) for offset in [-1000, -300, 300, 1000]]
        targets = sorted(set(round(float(value), 3) for value in targets))[:MAX_FRAMES]
        with av.open(io.BytesIO(blob)) as container:
            for frame in container.decode(video=0):
                at = max(0, float(frame.pts * frame.time_base) * 1000)
                if targets and at >= targets[0]:
                    frames.append({'offsetMs': round(at, 3), 'image': jpeg(frame)})
                    while targets and at >= targets[0]:
                        targets.pop(0)
                if not targets:
                    break
        require(0 < len(frames) <= MAX_FRAMES)
    samples = None
    audio_start_ms = 0
    if source['hasAudio']:
        # Preserve timestamp gaps as silence instead of squeezing speech and
        # sounds onto a false timeline. WebM timestamps may start above zero.
        samples = np.zeros((2, math.ceil((duration_ms + 500) * 16)), dtype=np.float32)
        with av.open(io.BytesIO(blob)) as container:
            origin = None
            resampler = av.AudioResampler(format='fltp', layout='stereo', rate=16000)
            end = 0
            decoded_frames = list(container.decode(audio=0))
            require(len(decoded_frames) <= 10000)
            for frame in decoded_frames:
                if origin is None:
                    origin = float(frame.pts * frame.time_base)
                    audio_start_ms = max(0, origin * 1000)
                for converted in resampler.resample(frame):
                    values = converted.to_ndarray()
                    offset = max(0, round((float(converted.pts * converted.time_base) - origin) * 16000))
                    require(offset + values.shape[1] <= samples.shape[1] and np.isfinite(values).all())
                    samples[:, offset:offset + values.shape[1]] = values
                    end = max(end, offset + values.shape[1])
            for converted in resampler.resample(None):
                values = converted.to_ndarray()
                require(end + values.shape[1] <= samples.shape[1] and np.isfinite(values).all())
                samples[:, end:end + values.shape[1]] = values
                end += values.shape[1]
            require(0 < end <= 16000 * 46)
            samples = np.clip(samples[:, :end], -1, 1)
    return {'durationMs': duration_ms, 'frames': frames, 'audioStartMs': audio_start_ms}, samples


class AudioPerception:
    def __init__(self, sound_path, speech_path):
        self.sound_path, self.speech_path = sound_path, speech_path
        self.classifier, self.labels, self.speech = None, None, None

    def classes(self, samples):
        if self.classifier is None:
            import onnxruntime as ort
            root = Path(self.sound_path)
            weights, label_file = root / 'yamnet.onnx', root / 'yamnet_class_map.csv'
            require(hashlib.sha256(weights.read_bytes()).hexdigest() == 'd3835ffbbd4a1bb3e777f0ca217b5007907f5171dd5d17c4236b95b2af8f908e')
            label_bytes = label_file.read_bytes()
            require(hashlib.sha1(b'blob ' + str(len(label_bytes)).encode() + b'\0' + label_bytes).hexdigest() == '9c07d818a6fba1a31c2950732c2fe49a16687c5a')
            self.labels = list(csv.DictReader(io.StringIO(label_bytes.decode('utf-8'))))
            require(len(self.labels) == 521)
            options = ort.SessionOptions()
            options.intra_op_num_threads, options.inter_op_num_threads = 2, 1
            self.classifier = ort.InferenceSession(str(weights), sess_options=options, providers=['CPUExecutionProvider'])
        scores = self.classifier.run(['output_0'], {'waveform': samples})[0]
        require(scores.ndim == 2 and scores.shape[1] == 521 and np.isfinite(scores).all())
        means, peaks = scores.mean(axis=0), scores.max(axis=0)
        ranked = np.argsort(-(means * .6 + peaks * .4))
        classes = [{'label': self.labels[i]['display_name'], 'score': round(float(means[i]), 4),
                    'peak': round(float(peaks[i]), 4), 'offsetMs': min(round(int(np.argmax(scores[:, i])) * 480), round(len(samples) / 16))}
                   for i in ranked[:8] if means[i] >= .12 or peaks[i] >= .45]
        spoken = any(('Speech' in self.labels[i]['display_name'] or self.labels[i]['display_name'] in ['Conversation', 'Narration, monologue']) and peaks[i] >= .35 for i in range(521))
        return classes, spoken

    def hear(self, stereo, source):
        samples = stereo.mean(axis=0).astype(np.float32)
        rms = float(np.sqrt(np.mean(stereo ** 2)))
        db = round(float(20 * np.log10(max(rms, 1e-8))), 1)
        channel_rms = np.sqrt(np.mean(stereo ** 2, axis=1))
        balance = float((channel_rms[1] - channel_rms[0]) / max(float(channel_rms.sum()), 1e-8))
        result = {'durationMs': round(len(samples) / 16, 3), 'volumeDb': db, 'balance': round(balance, 3), 'silent': db < -55, 'classes': [], 'transcript': '', 'cues': None}
        if result['silent']:
            return result
        result['classes'], spoken = self.classes(samples)
        if source == 'microphone' or spoken:
            from speech_worker import MicrophoneWhisper, recognize, voice_cues
            if self.speech is None:
                self.speech = MicrophoneWhisper(str(self.speech_path), device='cpu', compute_type='int8', cpu_threads=2, local_files_only=True)
            if source == 'microphone':
                result['transcript'], _ = recognize(self.speech, samples)
                result['language'] = 'ko'
            else:
                segments, info = self.speech.transcribe(samples, beam_size=1, vad_filter=True, condition_on_previous_text=False)
                result['transcript'] = ' '.join(s.text.strip() for s in segments if s.no_speech_prob < .6)[:3000]
                result['language'] = info.language
            if source == 'microphone':
                import wave
                buffer = io.BytesIO()
                with wave.open(buffer, 'wb') as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(16000)
                    wav.writeframes((samples * 32767).astype('<i2').tobytes())
                try:
                    result['cues'] = voice_cues(io.BytesIO(buffer.getvalue()), result['transcript'])
                except Exception:
                    pass
        return result


def perceive(job, sound_path, speech_path):
    require(isinstance(job, dict) and isinstance(job.get('sources'), list) and 1 <= len(job['sources']) <= 2)
    audio = AudioPerception(sound_path, speech_path)
    result = []
    for source in job['sources']:
        require(source['role'] in ['base', 'voice'] and source['audioSource'] in ['system-output', 'microphone', 'mixed-audio'])
        decoded, samples = decode(source, source.get('focusMs'))
        if samples is not None:
            decoded['audio'] = audio.hear(samples, source['audioSource'])
        result.append({'role': source['role'], **decoded})
    return {'ok': True, 'sources': result}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--sound-model', required=True)
    parser.add_argument('--speech-model', required=True)
    args = parser.parse_args()
    try:
        data = sys.stdin.buffer.read(MAX_INPUT + 1)
        require(len(data) <= MAX_INPUT)
        result = perceive(json.loads(data), args.sound_model, args.speech_model)
    except Exception:
        print(json.dumps({'ok': False}), flush=True)
        sys.exit(1)
    print(json.dumps(result, ensure_ascii=False), flush=True)
