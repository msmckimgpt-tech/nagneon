"""Decode only this task's synthetic preview QA/benchmark media using existing PyAV."""
import json
import sys
from pathlib import Path
import av
import numpy as np

folder = Path(sys.argv[1]).resolve()
report = json.loads((folder / "result.json").read_text(encoding="utf-8-sig"))
assert report["passed"] and report["synthetic"]
checks = []
if "runs" in report:
    files = [(f"recording-{r['round']}-{r['mode']}.webm", 440, (1920, 1080)) for r in report["runs"]]
else:
    assert report["physicalDevices"] is False
    files = [("hidden-video.webm", 440, (640, 360)), ("hidden-microphone.webm", 880, None)]
for filename, expected_hz, expected_size in files:
    path = folder / filename
    with av.open(str(path)) as container:
        assert len(container.streams.audio) == 1
        rate = container.streams.audio[0].rate
        samples = np.concatenate([f.to_ndarray().mean(axis=0) for f in container.decode(audio=0)])
    assert len(samples) > rate * 2
    window = samples[rate:rate * 3]
    spectrum = np.abs(np.fft.rfft(window * np.hanning(len(window))))
    frequencies = np.fft.rfftfreq(len(window), 1 / rate)
    powers = {hz: float(spectrum[np.abs(frequencies - hz) < 4].max()) for hz in [440, 880, 1600]}
    other_hz = 880 if expected_hz == 440 else 440
    assert powers[expected_hz] > max(powers[other_hz], powers[1600]) * 20, powers
    video = None
    if expected_size:
        with av.open(str(path)) as container:
            assert len(container.streams.video) == 1
            frames = list(container.decode(video=0))
        assert len(frames) > 30
        assert all((f.width, f.height) == expected_size for f in frames)
        times = [float(f.pts * f.time_base) for f in frames]
        duration = times[-1] - times[0]
        fps = (len(frames) - 1) / duration
        assert 13 <= fps <= 17, fps
        # A changing frame sequence must be encoded, not a repeated frozen image.
        probes = [f.to_ndarray(format="rgb24")[::16, ::16].tobytes() for f in frames[::15]]
        assert len(set(probes)) > 1
        video = {"frames": len(frames), "durationSeconds": duration, "fps": fps, "width": expected_size[0], "height": expected_size[1], "distinctProbes": len(set(probes))}
    checks.append({"file": filename, "audioHz": expected_hz, "audioSamples": len(samples), "audioRate": rate, "powers": powers, "video": video})
result = {"passed": True, "synthetic": True, "checks": checks}
(folder / "decoded-media.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps({"passed": True, "folder": str(folder), "checks": [{k: v for k, v in c.items() if k != "powers"} for c in checks]}))
