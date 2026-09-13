"""Local output-sound perception; raw audio stays in RAM, separate from microphone STT."""
import argparse
import base64
import csv
import hashlib
import io
import json
from pathlib import Path
import sys
import time
import av
import numpy as np
import onnxruntime as ort

parser = argparse.ArgumentParser()
parser.add_argument('--model-path', type=Path, required=True)
parser.add_argument('--speech-model-path', type=Path)
parser.add_argument('--without-speech', action='store_true')
parser.add_argument('--diagnostics', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
weights = args.model_path / 'yamnet.onnx'
labels_file = args.model_path / 'yamnet_class_map.csv'
if hashlib.sha256(weights.read_bytes()).hexdigest() != 'd3835ffbbd4a1bb3e777f0ca217b5007907f5171dd5d17c4236b95b2af8f908e':
    raise ValueError('Sound model checksum mismatch')
label_bytes = labels_file.read_bytes()
if hashlib.sha1(b'blob ' + str(len(label_bytes)).encode() + b'\0' + label_bytes).hexdigest() != '9c07d818a6fba1a31c2950732c2fe49a16687c5a':
    raise ValueError('Sound labels checksum mismatch')
labels = list(csv.DictReader(io.StringIO(label_bytes.decode('utf-8'))))
if len(labels) != 521 or any(int(label['index']) != i for i, label in enumerate(labels)):
    raise ValueError('Sound label ordering mismatch')
options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
model = ort.InferenceSession(str(weights), sess_options=options, providers=['CPUExecutionProvider'])
speech = None
if not args.without_speech:
    from faster_whisper import WhisperModel
    speech = WhisperModel(str(args.speech_model_path) if args.speech_model_path else 'small', device='cpu', compute_type='int8', cpu_threads=2,
                          download_root=None if args.speech_model_path else str(root / '.models'), local_files_only=True)
print(json.dumps({'ready': True, 'model': 'YAMNet ONNX', 'speech': bool(speech)}), flush=True)

def decode(blob):
    parts = []
    count = 0
    with av.open(io.BytesIO(blob)) as container:
        resampler = av.AudioResampler(format='fltp', layout='stereo', rate=16000)
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                values = converted.to_ndarray()
                count += values.shape[1]
                if count > 16000 * 9:
                    raise ValueError('Sound segment too long')
                parts.append(values)
        for converted in resampler.resample(None):
            parts.append(converted.to_ndarray())
    if not parts:
        raise ValueError('No sound samples')
    stereo = np.concatenate(parts, axis=1)
    if stereo.shape[1] < 1600 or stereo.shape[1] > 16000 * 9 or not np.isfinite(stereo).all():
        raise ValueError('Invalid sound duration/samples')
    return np.clip(stereo, -1, 1)

def analyze(blob):
    stereo = decode(blob)
    samples = np.mean(stereo, axis=0).astype(np.float32)
    duration = len(samples) / 16000
    rms = float(np.sqrt(np.mean(stereo ** 2)))
    db = round(float(20 * np.log10(max(rms, 1e-8))), 1)
    channel_rms = np.sqrt(np.mean(stereo ** 2, axis=1))
    balance = float((channel_rms[1] - channel_rms[0]) / max(float(channel_rms.sum()), 1e-8))
    result = {'durationSeconds': round(duration, 3), 'volumeDb': db, 'balance': round(balance, 3), 'silent': db < -55,
              'classes': [], 'systemSpeech': '', 'language': '', 'source': 'system-output',
              'caveat': 'Local classifier estimates, not verified events; stereo balance is not world-space direction.'}
    if result['silent']:
        return result
    scores = model.run(['output_0'], {'waveform': samples})[0]
    if scores.ndim != 2 or scores.shape[1] != 521 or not np.isfinite(scores).all():
        raise ValueError('Invalid classifier output')
    means, peaks = scores.mean(axis=0), scores.max(axis=0)
    ranked = np.argsort(-(means * .6 + peaks * .4))
    for index in ranked[:8]:
        if means[index] < .12 and peaks[index] < .45:
            continue
        label = labels[index]
        result['classes'].append({'id': label['mid'], 'label': label['display_name'], 'score': round(float(means[index]), 4),
                                  'peak': round(float(peaks[index]), 4), 'offsetSeconds': round(int(np.argmax(scores[:, index])) * .48, 2)})
    # Speech/dialogue from the game is never routed into the streamer's mailbox.
    speech_detected = any(('Speech' in labels[i]['display_name'] or labels[i]['display_name'] in ['Conversation', 'Narration, monologue']) and peaks[i] >= .35 for i in range(521))
    if speech and speech_detected:
        segments, info = speech.transcribe(samples, beam_size=1, vad_filter=True, condition_on_previous_text=False)
        result['systemSpeech'] = ' '.join(s.text.strip() for s in segments if s.no_speech_prob < .6)[:1000]
        result['language'] = info.language
    return result

for line in sys.stdin:
    job = {}
    try:
        if len(line) > 3_000_000:
            raise ValueError('Oversized sound request')
        job = json.loads(line)
        started = time.perf_counter()
        result = analyze(base64.b64decode(job['audio'], validate=True))
        print(json.dumps({'id': job['id'], 'sound': result, 'processingMs': round((time.perf_counter() - started) * 1000)}, ensure_ascii=False), flush=True)
    except Exception as error:
        if args.diagnostics:
            import traceback
            traceback.print_exc(file=sys.stderr)
        print(json.dumps({'id': job.get('id'), 'error': '시스템 소리를 분석하지 못했습니다. 소리 연결을 확인하고 다시 켜주세요.'}, ensure_ascii=False), flush=True)
