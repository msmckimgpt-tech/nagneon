"""Check both known test frequencies in a real recorded WebM audio track."""
import json, sys
from pathlib import Path
import av
import numpy as np
folder=Path(sys.argv[1]);clips=json.loads((folder/'data/clips.json').read_text(encoding='utf-8'))
if isinstance(clips,dict):
    # JsonStore envelope.
    clips=clips.get('data',clips)
clip=next(c for c in clips if c.get('video'))
file=folder/'data/clip-media'/(clip['id']+'.webm')
with av.open(str(file)) as container:
    assert len(container.streams.audio)==1
    parts=[];resample=av.AudioResampler(format='fltp',layout='mono',rate=16000)
    for frame in container.decode(audio=0):
        parts.extend(x.to_ndarray().reshape(-1) for x in resample.resample(frame))
samples=np.concatenate(parts);assert len(samples)>16000
samples=samples[16000:min(len(samples),64000)]
spec=np.abs(np.fft.rfft(samples*np.hanning(len(samples))))
freq=np.fft.rfftfreq(len(samples),1/16000)
def power(hz): return float(spec[np.abs(freq-hz)<3].max())
result={'file':str(file),'oneAudioTrack':True,'powers':{str(f):power(f) for f in [440,880,1600]},'syntheticFrequencies':True}
assert power(440)>power(1600)*20 and power(880)>power(1600)*20,result
result['passed']=True
(folder/'mixed-audio-test.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result,indent=2))
