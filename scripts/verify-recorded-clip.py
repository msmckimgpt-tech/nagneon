"""Decode only verify-clip-capture.cjs generated tones, never user recordings."""
import json
import sys
from pathlib import Path
import av
import numpy as np

folder = Path(sys.argv[1])
capture = json.loads((folder / "result.json").read_text(encoding="utf-8"))
assert capture["passed"] and capture["synthetic"] and not capture["physicalDevices"]
checks = []
for case in capture["cases"]:
    files = [(case["id"] + ".webm", 440 if case["kind"] == "video" else 880)]
    if case["voice"]:
        files.append((case["id"] + ".voice.webm", 880))
    for filename, expected in files:
        with av.open(str(folder / "data" / "clip-media" / filename)) as container:
            assert len(container.streams.audio) == 1
            rate = container.streams.audio[0].rate
            samples = np.concatenate([f.to_ndarray().mean(axis=0) for f in container.decode(audio=0)])
        assert len(samples) > rate
        samples = samples[rate:rate * 3]
        spectrum = np.abs(np.fft.rfft(samples * np.hanning(len(samples))))
        frequencies = np.fft.rfftfreq(len(samples), 1 / rate)
        powers = {hz: float(spectrum[np.abs(frequencies - hz) < 4].max()) for hz in [440, 880, 1600]}
        other = 880 if expected == 440 else 440
        assert powers[expected] > max(powers[other], powers[1600]) * 20, powers
        checks.append({"file": filename, "expectedHz": expected, "powers": powers})
result = {"passed": True, "synthetic": True, "physicalDevices": False, "checks": checks}
(folder / "audio-spectrum.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result))
