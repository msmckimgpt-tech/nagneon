"""File-only A/B check using saved synthetic Korean WAVs; never opens a device.

Run with the bundled speech Python and --model-path/--audio/--output paths.
Timing is reported, not asserted: CPU contention varies during user testing.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import time
import io
spec = importlib.util.spec_from_file_location('speech_worker', Path(__file__).with_name('speech_worker.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
MicrophoneWhisper, process_job, decode_audio = worker.MicrophoneWhisper, worker.process_job, worker.decode_audio


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-path', type=Path, required=True)
    parser.add_argument('--audio', type=Path, action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--rounds', type=int, default=2)
    args = parser.parse_args()
    model = MicrophoneWhisper(str(args.model_path), device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
    report = {'syntheticFilesOnly': True, 'physicalDevices': False, 'rows': []}
    for path in args.audio:
        blob = path.read_bytes()
        samples = decode_audio(io.BytesIO(blob))
        for run in range(args.rounds):
            for variant in (['baseline', 'short-window'] if run % 2 == 0 else ['short-window', 'baseline']):
                started = time.perf_counter()
                if variant == 'baseline':
                    model.encoder_frames = 3000
                    segments, _ = model.transcribe(samples, language='ko', beam_size=1, vad_filter=True, condition_on_previous_text=False)
                    text = ' '.join(s.text.strip() for s in segments if s.no_speech_prob < .65)
                    timing = {}
                else:
                    result = process_job(model, {'id': 'fixture', 'audio': base64.b64encode(blob).decode('ascii')})
                    text, timing = result['text'], result['timing']
                row = {'file': str(path), 'sha256': hashlib.sha256(blob).hexdigest(), 'durationSeconds': len(samples)/16000,
                       'run': run, 'variant': variant, 'elapsedMs': round((time.perf_counter()-started)*1000), 'text': text, 'timing': timing}
                report['rows'].append(row)
                print(json.dumps(row, ensure_ascii=False), flush=True)
                args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')


if __name__ == '__main__':
    main()
