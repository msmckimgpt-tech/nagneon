"""Decode generated acceptance media and verify setup/core/aftermath pixels."""
import json
from pathlib import Path
import sys
import av

report_path = Path(sys.argv[1]).resolve()
report = json.loads(report_path.read_text(encoding='utf-8'))
assert report['synthetic'] is True and report['physicalDevices'] is False
case = next(c for c in report['cases'] if c['name'] == 'boundary-merged-video-and-separated-voice')
video = Path(case['videoFile']).resolve()
video.relative_to(report_path.parent / 'data' / 'clip-media')
core = (case['requested']['eventStartedAt'] - case['videoStartedAt']) / 1000
targets = {'setup': (core - 7, 2), 'core': (core, 0), 'aftermath': (core + 9, 1)}
nearest = {}
with av.open(str(video)) as container:
    for frame in container.decode(video=0):
        seconds = float(frame.pts * frame.time_base)
        for name, (target, channel) in targets.items():
            distance = abs(seconds - target)
            if name not in nearest or distance < nearest[name]['distance']:
                rgb = frame.to_ndarray(format='rgb24')[20, 20].tolist()
                nearest[name] = {'distance': distance, 'seconds': seconds, 'rgb': rgb}
for name, (_, channel) in targets.items():
    sample = nearest[name]
    assert sample['distance'] < .5, (name, sample)
    assert sample['rgb'][channel] > 150
    assert sample['rgb'][channel] > max(sample['rgb'][i] for i in range(3) if i != channel) + 60
result = {'passed': True, 'synthetic': True, 'samples': nearest}
(report_path.parent / 'frames.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
