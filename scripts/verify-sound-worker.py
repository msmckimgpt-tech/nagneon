"""Synthetic fixtures exercise the real offline model; no microphone capture."""
import base64, io, json, math, subprocess, sys, time, wave
from pathlib import Path
root = Path(__file__).resolve().parent.parent
def wav(kind):
    import numpy as np
    t = np.arange(64000) / 16000
    if kind == 'silence': x = np.zeros_like(t)
    elif kind == 'beep': x = .35 * np.sin(2 * math.pi * 880 * t) * ((t % .5) < .25)
    else: x = sum(.12 * np.sin(2 * math.pi * f * t) for f in [261.63,329.63,392])
    data = io.BytesIO()
    with wave.open(data,'wb') as out:
        out.setparams((2,2,16000,0,'NONE','not compressed'))
        out.writeframes(np.stack([x,x*.5],axis=1).reshape(-1).__mul__(32767).astype('<i2').tobytes())
    return data.getvalue()
report = {'synthetic':True,'results':[]}
p = subprocess.Popen([sys.executable,'-X','utf8','-B',str(root/'scripts/sound_worker.py'),'--diagnostics','--model-path',str(root/'.models/sound-yamnet')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
try:
    start = time.monotonic(); report['ready'] = json.loads(p.stdout.readline()); report['readyMs'] = round((time.monotonic()-start)*1000)
    assert report['ready']['ready']
    for name in ['silence','beep','chord','speech','invalid']:
        if name == 'speech':
            with wave.open(str(root/'artifacts/korean-fixture.wav'),'rb') as src:
                data=io.BytesIO()
                with wave.open(data,'wb') as dst:
                    dst.setparams(src.getparams());dst.writeframes(src.readframes(src.getframerate()*8))
                audio=data.getvalue()
        else: audio = b'invalid' if name=='invalid' else wav(name)
        p.stdin.write(json.dumps({'id':name,'audio':base64.b64encode(audio).decode()})+'\n');p.stdin.flush()
        value=json.loads(p.stdout.readline());report['results'].append(value);assert value['id']==name
        if name=='invalid': assert value.get('error')
        else:
            assert 'sound' in value, value
            assert value['sound']['source']=='system-output'
            if name=='silence': assert value['sound']['silent'] and not value['sound']['classes']
            if name=='speech': assert value['sound']['systemSpeech'],value
    report['passed']=True
finally:
    p.stdin.close();p.wait(timeout=20);report['stderr']=p.stderr.read()
    (root/'artifacts/sound-worker-test.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
