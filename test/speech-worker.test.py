"""Run with bundled speech Python; fake inference, real ndarray/audio handling."""
import base64
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import wave
import numpy as np

spec = importlib.util.spec_from_file_location('speech_worker', Path(__file__).resolve().parents[1] / 'scripts/speech_worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def segment(text='안녕하세요', **kw):
    return SimpleNamespace(text=text, avg_logprob=-.3, compression_ratio=1.1, no_speech_prob=.1, **kw)


class FakeModel:
    encoder_frames = 3000

    def __init__(self, results, duration=1):
        self.results, self.calls, self.duration, self.samples = iter(results), [], duration, []

    def transcribe(self, samples, **options):
        self.calls.append((self.encoder_frames, options))
        self.samples.append(samples)
        result = next(self.results)
        def generate():
            if isinstance(result, Exception):
                raise result
            yield from result
        return generate(), SimpleNamespace(duration_after_vad=self.duration)


class SpeechWorkerTests(unittest.TestCase):
    def test_gpu_failure_retries_same_job_on_cpu_once(self):
        events = []
        cpu = object()
        with patch.object(worker, 'process_job', side_effect=[RuntimeError('CUDA out of memory'), {'id': 'one', 'text': '같은 발언'}]) as process:
            worker.serve(object(), [json.dumps({'id': 'one', 'audio': 'original'})], events.append, lambda: cpu)
        self.assertEqual(events, [{'id': 'one', 'text': '같은 발언'}])
        self.assertIs(process.call_args.args[0], cpu)
        self.assertEqual(process.call_args.args[1]['audio'], 'original')

    def test_invalid_audio_does_not_trigger_gpu_fallback(self):
        events = []
        with patch.object(worker, 'process_job', side_effect=RuntimeError('invalid audio')), patch('builtins.print') as recover:
            worker.serve(object(), [json.dumps({'id': 'bad'})], events.append, recover)
        recover.assert_not_called()
        self.assertEqual(events[0]['id'], 'bad')
        self.assertIn('error', events[0])

    def test_encoder_passes_short_features_without_mutating_them(self):
        model = object.__new__(worker.MicrophoneWhisper)
        features = np.arange(80*3000).reshape(80, 3000)
        with patch.object(worker.WhisperModel, 'encode', return_value='encoded') as encode:
            for frames in [400, 600, 800, 1200, 1600, 3000]:
                model.encoder_frames = frames
                self.assertEqual(model.encode(features), 'encoded')
                np.testing.assert_array_equal(encode.call_args.args[0], features[:, :frames])
                self.assertEqual(features.shape, (80, 3000))

    def test_short_audio_uses_all_samples_and_bounded_padding(self):
        for seconds, frames in [(0, 3000), (1, 400), (2.5, 400), (3, 600), (4.5, 600), (6, 800), (6.5, 800), (7, 1200), (10.5, 1200), (11, 1600), (14.5, 1600), (15, 3000), (35, 3000)]:
            model = FakeModel([[segment()]])
            samples = np.arange(int(seconds*16000), dtype=np.float32)
            text, policy = worker.recognize(model, samples)
            self.assertEqual(text, '안녕하세요')
            self.assertEqual(model.calls[0][0], frames)
            self.assertEqual(model.calls[0][1]['beam_size'], 3)
            self.assertEqual(model.encoder_frames, 3000)
            self.assertEqual(policy['fallback'], False)
            self.assertEqual('temperature' in model.calls[0][1], frames < 3000)
            self.assertIs(model.samples[0], samples)
            self.assertEqual(policy['encoderPassesMs'], [frames * 10])

    def test_window_boundaries_never_drop_actual_audio_or_padding(self):
        for limit, frames, next_frames in [(2.5, 400, 600), (4.5, 600, 800), (6.5, 800, 1200), (10.5, 1200, 1600), (14.5, 1600, 3000)]:
            count = int(limit*16000)
            self.assertEqual(worker.encoder_window_frames(count), frames)
            self.assertGreaterEqual(frames/100 - count/16000, 1.5)
            self.assertEqual(worker.encoder_window_frames(count+1), next_frames)

    def test_low_confidence_rechecks_original_context(self):
        for field, value in [('avg_logprob', -1.1), ('compression_ratio', 2.5), ('no_speech_prob', .7)]:
            bad = segment(); setattr(bad, field, value)
            model = FakeModel([[bad], [segment('확인된 발언')]])
            text, policy = worker.recognize(model, np.zeros(48000))
            self.assertEqual(text, '확인된 발언')
            self.assertEqual([c[0] for c in model.calls], [600, 3000])
            self.assertNotIn('temperature', model.calls[1][1])
            self.assertTrue(policy['fallback'])
            self.assertEqual(policy['encoderPassesMs'], [6000, 30000])

    def test_longer_window_fallback_and_failed_retry_restore_next_request(self):
        for count, frames in [(16000*9, 1200), (16000*12, 1600)]:
            bad = segment(); bad.avg_logprob = -1.1
            model = FakeModel([[bad], RuntimeError('retry failed'), [segment()]])
            with self.assertRaises(RuntimeError): worker.recognize(model, np.zeros(count))
            self.assertEqual([c[0] for c in model.calls], [frames, 3000])
            self.assertEqual(model.encoder_frames, 3000)
            worker.recognize(model, np.zeros(16000))
            self.assertEqual(model.calls[-1][0], 400)

    def test_silence_does_not_retry_but_unrecognized_voice_does(self):
        silent = FakeModel([[]], duration=0)
        self.assertEqual(worker.recognize(silent, np.zeros(48000))[0], '')
        self.assertEqual(len(silent.calls), 1)
        voiced = FakeModel([[], [segment()]], duration=1)
        self.assertTrue(worker.recognize(voiced, np.zeros(48000))[1]['fallback'])

    def test_generator_failure_restores_encoder_for_next_job(self):
        model = FakeModel([RuntimeError('decode failed'), [segment()]])
        with self.assertRaises(RuntimeError): worker.recognize(model, np.zeros(48000))
        self.assertEqual(model.encoder_frames, 3000)
        worker.recognize(model, np.zeros(16000*10))
        self.assertEqual(model.calls[-1][0], 1200)

    def test_descriptor_failure_preserves_text_and_timings_without_temp_files(self):
        audio = io.BytesIO()
        with wave.open(audio, 'wb') as out:
            out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000); out.writeframes(bytes(32000))
        with patch.object(worker, 'voice_cues', side_effect=ValueError('cues')):
            result = worker.process_job(FakeModel([[segment()]]), {'id': 'one', 'audio': base64.b64encode(audio.getvalue()).decode()})
        self.assertEqual(result['text'], '안녕하세요')
        self.assertIsNone(result['cues'])
        self.assertGreaterEqual(result['timing']['processingMs'], result['timing']['recognitionMs'])

    def test_failed_job_retains_id_and_next_job_is_processed(self):
        output = []
        with patch.object(worker, 'process_job', side_effect=[ValueError('private details'), {'id': 'new', 'text': '성공'}]):
            worker.serve(None, [json.dumps({'id': 'old'}), json.dumps({'id': 'new'})], output.append)
        self.assertEqual(output[0]['id'], 'old')
        self.assertNotIn('private details', output[0]['error'])
        self.assertEqual(output[1]['text'], '성공')


if __name__ == '__main__': unittest.main()
