"""Compare two real local recognizers against saved synthetic ground truth.

No device access, uploads, or human speech archive. The caller supplies corpus
JSON (id, reference) and matching WAVs in that file's directory.
"""
import argparse
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import statistics
import time
import wave
import numpy as np


def load(path, name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def clean(text): return re.sub(r'[^가-힣A-Za-z0-9]', '', text)


def distance(a,b):
    row=list(range(len(b)+1))
    for i,x in enumerate(a):
        new=[i+1]
        for j,y in enumerate(b): new.append(min(new[-1]+1,row[j+1]+1,row[j]+(x!=y)))
        row=new
    return row[-1]


def wav(samples):
    out=io.BytesIO()
    with wave.open(out,'wb') as stream:
        stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(16000)
        stream.writeframes((np.clip(samples,-1,1)*32767).astype('<i2').tobytes())
    return out.getvalue()


def main():
    parser=argparse.ArgumentParser()
    for name in ['baseline-worker','baseline-model','model','corpus','output']: parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args()
    baseline=load(args.baseline_worker,'baseline_worker')
    revised=load(Path(__file__).with_name('speech_worker.py'),'revised_worker')
    models={name:(module,module.MicrophoneWhisper(str(path),device='cpu',compute_type='int8',cpu_threads=4,local_files_only=True))
            for name,module,path in [('baseline',baseline,args.baseline_model),('revised',revised,args.model)]}
    cases=json.loads(args.corpus.read_text(encoding='utf-8-sig'))
    report={'syntheticFilesOnly':True,'devices':False,'rows':[],'summary':{}}
    for case in cases:
        path=args.corpus.parent/(case['id']+'.wav')
        blob=path.read_bytes()
        variants=[('clean',blob)]
        if case['id'] in ['changed','strength','affirm']:
            samples=revised.decode_audio(io.BytesIO(blob));rng=np.random.default_rng(20260913)
            noise=rng.normal(0,np.sqrt(np.mean(samples**2))/10**(15/20),len(samples))
            variants.append(('noise-15dB',wav(samples+noise)))
        for condition,audio in variants:
            for name,(module,model) in models.items():
                started=time.perf_counter()
                result=module.process_job(model,{'id':'synthetic','audio':base64.b64encode(audio).decode()})
                text=result['text'];reference=clean(case['reference'])
                row={'id':case['id'],'condition':condition,'variant':name,'sha256':hashlib.sha256(audio).hexdigest(),
                     'text':text,'reference':reference,'errors':distance(reference,clean(text)),'characters':len(reference),
                     'ms':round((time.perf_counter()-started)*1000),'timing':result['timing']}
                report['rows'].append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
                args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    for name in models:
        rows=[r for r in report['rows'] if r['variant']==name]
        report['summary'][name]={'errors':sum(r['errors'] for r in rows),'characters':sum(r['characters'] for r in rows),
                                 'exact':sum(r['errors']==0 for r in rows),'cases':len(rows),'medianMs':statistics.median(r['ms'] for r in rows)}
    for name,(module,model) in models.items():
        result=module.process_job(model,{'id':'silence','audio':base64.b64encode(wav(np.zeros(32000))).decode()})
        assert result['text']=='', 'Silence hallucination: '+name
    report['silencePassed']=True
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(report['summary'],ensure_ascii=False),flush=True)


if __name__=='__main__':main()
