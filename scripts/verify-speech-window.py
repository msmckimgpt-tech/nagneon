"""Compare complete worker paths on the same offline model and synthetic files.

No capture or playback. Preserve partial results and do not equate a small
synthetic corpus with real microphone accuracy or end-to-end chat latency.
"""
import argparse
import base64
import hashlib
import importlib.metadata
import importlib.util
import io
import json
from pathlib import Path
import re
import statistics
import time


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def clean(text):
    return re.sub(r'[^가-힣A-Za-z0-9]', '', text)


def distance(a, b):
    row = list(range(len(b) + 1))
    for i, x in enumerate(a):
        new = [i + 1]
        for j, y in enumerate(b):
            new.append(min(new[-1] + 1, row[j + 1] + 1, row[j] + (x != y)))
        row = new
    return row[-1]


def main():
    parser = argparse.ArgumentParser()
    for name in ['baseline-worker', 'candidate-worker', 'model-path', 'corpus', 'output']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--rounds', type=int, default=2, choices=range(1, 4))
    parser.add_argument('--ids', default='')
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Use a fresh output path')
    corpus = json.loads(args.corpus.read_text(encoding='utf-8-sig'))
    assert corpus['synthetic'] and not corpus['deviceCapture']
    cases = corpus['items']
    assert cases and len({case['id'] for case in cases}) == len(cases)
    if args.ids:
        ids = args.ids.split(',')
        cases = [case for case in cases if case['id'] in ids]
        assert set(ids) == {case['id'] for case in cases}
    report = {'passed': False, 'synthetic': True, 'physicalDevices': False,
              'modelPath': str(args.model_path), 'voice': corpus['voice'],
              'rounds': args.rounds, 'rows': [], 'regressions': [],
              'versions': {p: importlib.metadata.version(p) for p in ['faster-whisper', 'ctranslate2']},
              'workers': {k: {'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                          for k, p in [('baseline', args.baseline_worker), ('candidate', args.candidate_worker)]}}
    def save():
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    save()
    try:
        modules = {name: load(path, name + '_worker') for name, path in
                   [('baseline', args.baseline_worker), ('candidate', args.candidate_worker)]}
        models = {name: module.MicrophoneWhisper(str(args.model_path), device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
                  for name, module in modules.items()}
        for case_index, case in enumerate(cases):
            blob = Path(case['file']).read_bytes()
            assert hashlib.sha256(blob).hexdigest() == case['sha256']
            duration = len(modules['baseline'].decode_audio(io.BytesIO(blob))) / 16000
            # Short-path regression cases are unchanged; repeat changed long
            # inputs in opposite order to make order-dependent costs visible.
            rounds = args.rounds if case['group'] != 'short' else 1
            for repeat in range(rounds):
                pair = {}
                order = ['baseline', 'candidate'] if (case_index + repeat) % 2 == 0 else ['candidate', 'baseline']
                for variant in order:
                    started = time.perf_counter()
                    result = modules[variant].process_job(models[variant], {'id': case['id'], 'audio': base64.b64encode(blob).decode()})
                    reference = clean(case['reference'])
                    row = {'id': case['id'], 'group': case['group'], 'repeat': repeat, 'order': order,
                           'variant': variant, 'sha256': case['sha256'], 'durationSeconds': duration,
                           'reference': reference, 'text': result['text'], 'characters': len(reference),
                           'errors': distance(reference, clean(result['text'])),
                           'ms': round((time.perf_counter() - started) * 1000), 'timing': result['timing']}
                    report['rows'].append(row)
                    pair[variant] = row
                    print(json.dumps(row, ensure_ascii=False), flush=True)
                    save()
                if pair['candidate']['errors'] > pair['baseline']['errors']:
                    report['regressions'].append({'id': case['id'], 'repeat': repeat,
                                                  'baseline': pair['baseline']['text'], 'candidate': pair['candidate']['text']})
        report['summary'] = {}
        for variant in modules:
            rows = [r for r in report['rows'] if r['variant'] == variant]
            long = [r for r in rows if 6.5 < r['durationSeconds'] <= 14.5]
            report['summary'][variant] = {'cases': len(rows), 'errors': sum(r['errors'] for r in rows),
                                          'characters': sum(r['characters'] for r in rows),
                                          'exact': sum(r['errors'] == 0 for r in rows),
                                          'changedWindowCases': len(long),
                                          'changedWindowMedianMs': statistics.median(r['ms'] for r in long) if long else None,
                                          'changedWindowTotalMs': sum(r['ms'] for r in long)}
        report['passed'] = not report['regressions']
        print(json.dumps({'passed': report['passed'], 'summary': report['summary'], 'regressions': report['regressions']}, ensure_ascii=False), flush=True)
    except Exception as error:
        report['error'] = repr(error)
        raise
    finally:
        save()
    if not report['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
