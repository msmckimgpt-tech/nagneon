"""Real codec acceptance; synthetic data only. Run with the packaged Python."""
import importlib.util
import io
import unittest
from fractions import Fraction
from pathlib import Path
import av
import numpy as np

spec = importlib.util.spec_from_file_location('clip_inspector', Path(__file__).resolve().parents[1] / 'scripts/clip_inspector.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def media(video=False, audio=1, seconds=3, live=False):
    data = io.BytesIO()
    with av.open(data, 'w', format='webm', options={'live': '1'} if live else {}) as c:
        v = c.add_stream('libvpx', rate=5) if video else None
        if v:
            v.width, v.height, v.pix_fmt = 160, 90, 'yuv420p'
        sound = [c.add_stream('libopus', rate=48000) for _ in range(audio)]
        for stream in sound:
            stream.layout = 'mono'
        for i in range(seconds * 5):
            if v:
                f = av.VideoFrame.from_ndarray(np.full((90, 160, 3), i * 7 % 256, dtype=np.uint8), format='rgb24')
                f.pts, f.time_base = i, Fraction(1, 5)
                for packet in v.encode(f):
                    c.mux(packet)
            for stream in sound:
                f = av.AudioFrame.from_ndarray(np.zeros((1, 9600), dtype=np.float32), format='flt', layout='mono')
                f.pts, f.time_base, f.sample_rate = i * 9600, Fraction(1, 48000), 48000
                for packet in stream.encode(f):
                    c.mux(packet)
        for stream in ([v] if v else []) + sound:
            for packet in stream.encode():
                c.mux(packet)
    return data.getvalue()


class InspectorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.audio = media()
        cls.video = media(video=True)
        cls.picture = media(video=True, audio=0)
        cls.live = media(video=True, live=True)

    def check(self, data, kind='audio', has_audio=True, duration=3000):
        return worker.inspect(data, kind, has_audio, duration)

    def test_silent_audio_is_valid_and_fully_decoded(self):
        result = self.check(self.audio)
        self.assertEqual(result['tracks'][0]['frames'], 151)
        self.assertAlmostEqual(result['durationMs'], 3000.5, delta=1)

    def test_video_and_audio_both_decode(self):
        result = self.check(self.video, 'video')
        self.assertEqual([t['frames'] for t in result['tracks']], [15, 151])

    def test_video_without_audio_is_supported(self):
        result = self.check(self.picture, 'video', False)
        self.assertFalse(result['hasAudio'])
        self.assertEqual(len(result['tracks']), 1)

    def test_live_unknown_segment_and_cluster_sizes(self):
        self.check(self.live, 'video')
        data = bytearray(self.live)
        start = data.index(bytes.fromhex('1f43b675')) + 4
        width = 1
        while not data[start] & (0x80 >> (width - 1)):
            width += 1
        data[start:start + width] = ((1 << (7 * width + 1)) - 1).to_bytes(width, 'big')
        self.check(bytes(data), 'video')

    def test_metadata_cannot_hide_a_video_or_claim_a_missing_track(self):
        for data, kind, audio in [(self.video, 'audio', True), (self.audio, 'video', True),
                                  (self.picture, 'video', True), (self.video, 'video', False),
                                  (self.audio, 'audio', False)]:
            with self.subTest(kind=kind, hasAudio=audio):
                with self.assertRaises(ValueError):
                    self.check(data, kind, audio)

    def test_multiple_audio_tracks_are_rejected(self):
        with self.assertRaises(ValueError):
            self.check(media(audio=2))

    def test_duration_uses_decoded_timestamps(self):
        with self.assertRaises(ValueError):
            self.check(self.audio, duration=15000)

    def test_truncation_at_several_offsets_cannot_be_saved(self):
        for data in (self.audio, self.video, self.live):
            for offset in (100, len(data) // 2, len(data) - 1):
                with self.subTest(length=len(data), offset=offset):
                    with self.assertRaises(Exception):
                        self.check(data[:offset], 'video' if data != self.audio else 'audio')

    def test_live_complete_packet_prefix_still_needs_the_recorded_duration(self):
        # Even an independently valid short recording cannot pose as a 15s clip.
        with self.assertRaises(ValueError):
            self.check(self.live, 'video', duration=15000)

    def test_fake_magic_trailing_junk_and_wrong_doctype(self):
        for data in (bytes.fromhex('1a45dfa3') + bytes(120), self.audio + b'garbage',
                     self.audio.replace(b'webm', b'nope', 1)):
            with self.assertRaises(Exception):
                self.check(data)

    def test_vp8_payload_corruption_and_oversized_keyframe(self):
        offset = self.video.index(b'\x9d\x01\x2a')
        for replacement in (b'\x00\x00\x00', b'\x9d\x01\x2a\xff\x3f\xff\x3f'):
            broken = bytearray(self.video)
            broken[offset:offset + len(replacement)] = replacement
            with self.assertRaises(Exception):
                self.check(bytes(broken), 'video')

    def test_no_packets_cannot_pass_on_headers_alone(self):
        cluster = self.live.index(bytes.fromhex('1f43b675'))
        with self.assertRaises(Exception):
            self.check(self.live[:cluster], 'video')

    def test_concatenated_recordings_and_unknown_scalar_size(self):
        with self.assertRaises(Exception):
            self.check(self.audio + self.audio)
        broken = bytearray(self.live)
        doctype = broken.index(b'webm')
        broken[doctype - 1] = 0xff
        with self.assertRaises(ValueError):
            self.check(bytes(broken), 'video')


if __name__ == '__main__':
    unittest.main(verbosity=2)
