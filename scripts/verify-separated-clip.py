"""Synthetic file-only codec fixtures and spectral checks. No audio devices."""
import av
import numpy as np
import json
import sys
from fractions import Fraction
from pathlib import Path
from hashlib import sha256

folder = Path(sys.argv[1])
folder.mkdir(parents=True, exist_ok=False)
result = {"synthetic": True, "deviceCapture": False, "files": [], "passed": False}
for name, hz, video in [("game.webm", 440, True), ("voice.webm", 880, False)]:
    path = folder / name
    with av.open(str(path), "w", format="webm") as container:
        v = container.add_stream("libvpx", rate=5) if video else None
        if v:
            v.width, v.height, v.pix_fmt = 160, 90, "yuv420p"
        a = container.add_stream("libopus", rate=48000)
        a.layout = "mono"
        for i in range(15):
            if v:
                frame = av.VideoFrame.from_ndarray(np.full((90, 160, 3), i * 7, dtype=np.uint8), format="rgb24")
                frame.pts, frame.time_base = i, Fraction(1, 5)
                for packet in v.encode(frame):
                    container.mux(packet)
            samples = (.2 * np.sin(2 * np.pi * hz * (np.arange(9600) + i * 9600) / 48000)).astype(np.float32)
            frame = av.AudioFrame.from_ndarray(samples.reshape(1, -1), format="flt", layout="mono")
            frame.pts, frame.time_base, frame.sample_rate = i * 9600, Fraction(1, 48000), 48000
            for packet in a.encode(frame):
                container.mux(packet)
        for stream in ([v] if v else []) + [a]:
            for packet in stream.encode():
                container.mux(packet)
    with av.open(str(path)) as container:
        parts = [f.to_ndarray().reshape(-1) for f in container.decode(audio=0)]
    samples = np.concatenate(parts)
    spec = np.abs(np.fft.rfft(samples * np.hanning(len(samples))))
    freqs = np.fft.rfftfreq(len(samples), 1 / 48000)
    powers = {f: float(spec[np.abs(freqs - f) < 4].max()) for f in [440, 880]}
    assert powers[hz] > powers[880 if hz == 440 else 440] * 100, powers
    result["files"].append({"name": name, "sha256": sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size, "powers": powers})
result["passed"] = True
(folder / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result))
