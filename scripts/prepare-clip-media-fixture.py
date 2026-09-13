"""Render a tiny moving-square clip and separate file-only Korean TTS tracks.
No device, screen capture, browser or microphone is used by this fixture maker.
"""
import argparse
import io
import json
from pathlib import Path
from fractions import Fraction
from hashlib import sha256
import av
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--speech', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=False)


def speech(name):
    with av.open(str(args.speech / name)) as c:
        resampler = av.AudioResampler(format='fltp', layout='stereo', rate=48000)
        parts = [f.to_ndarray() for frame in c.decode(audio=0) for f in resampler.resample(frame)]
        parts += [f.to_ndarray() for f in resampler.resample(None)]
    return np.concatenate(parts, axis=1)


game, mic = speech('game.wav'), speech('microphone.wav')
duration = max(game.shape[1] / 48000 + 1, mic.shape[1] / 48000 + .8, 6)
duration = np.ceil(duration * 10) / 10
count = round(duration * 48000)
timeline = np.arange(count) / 48000
background = (.012 * np.sin(2 * np.pi * 440 * timeline)).astype(np.float32)
system = np.stack([background, background])
system[:, 24000:24000 + game.shape[1]] += game * .75
voice = np.zeros_like(system)
voice[:, 33600:33600 + mic.shape[1]] = mic * .8


def encode(name, samples, video):
    path = args.output / name
    with av.open(str(path), 'w', format='webm') as c:
        v = c.add_stream('libvpx', rate=10) if video else None
        if v:
            v.width, v.height, v.pix_fmt = 320, 180, 'yuv420p'
        a = c.add_stream('libopus', rate=48000)
        a.layout = 'stereo'
        for i in range(round(duration * 10)):
            if v:
                pixels = np.zeros((180, 320, 3), dtype=np.uint8)
                pixels[:] = [30, 35, 45]
                pixels[60:120, 268:308] = [40, 170, 80]
                x = int(12 + min(1, i / max(1, duration * 10 - 12)) * 264)
                pixels[78:102, x:x + 22] = [240, 40, 40]
                frame = av.VideoFrame.from_ndarray(pixels, format='rgb24')
                frame.pts, frame.time_base = i, Fraction(1, 10)
                for packet in v.encode(frame):
                    c.mux(packet)
            audio = av.AudioFrame.from_ndarray(samples[:, i * 4800:(i + 1) * 4800].copy(), format='fltp', layout='stereo')
            audio.sample_rate, audio.pts, audio.time_base = 48000, i * 4800, Fraction(1, 48000)
            for packet in a.encode(audio):
                c.mux(packet)
        for stream in ([v] if v else []) + [a]:
            for packet in stream.encode():
                c.mux(packet)
    return {'name': name, 'bytes': path.stat().st_size, 'sha256': sha256(path.read_bytes()).hexdigest()}


files = [encode('game.webm', system, True), encode('voice.webm', voice, False)]
result = {'synthetic': True, 'deviceCapture': False, 'durationMs': round(duration * 1000), 'files': files,
          'scene': 'A red square moves from left to a green goal on the right.',
          'systemSpeech': '문이 열렸습니다. 오른쪽으로 이동하세요.', 'microphoneSpeech': '아 드디어 들어갔다. 이번에는 성공했네요!'}
(args.output / 'fixture.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
