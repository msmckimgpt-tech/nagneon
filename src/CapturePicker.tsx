import {useEffect,useState} from 'react';
import {AppWindow,LoaderCircle,Monitor,RefreshCw,Search,Volume2,X} from 'lucide-react';
import {AccessibleDialog} from './AccessibleDialog';
import type {Source} from './types';
import './capture-picker.css';

type Kind='screen'|'window';
type PreviewState='loading'|'ready'|'unavailable';
const kindOf=(source:Source):Kind=>source.kind||(source.id.startsWith('screen:')?'screen':'window');

export function CapturePicker({initialSound,onClose,onSelect}:{initialSound:boolean;onClose:()=>void;onSelect:(id:string,options:{systemAudio:boolean;picture:boolean})=>void}){
  const [sources,setSources]=useState<Source[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [revision,setRevision]=useState(0),[query,setQuery]=useState('');
  const [shareSound,setShareSound]=useState(initialSound),[sharePicture,setSharePicture]=useState(true);
  const [preview,setPreview]=useState<Record<Kind,PreviewState>>({screen:'loading',window:'loading'});

  useEffect(()=>{
    let active=true;const timers:ReturnType<typeof setTimeout>[]=[];
    setLoading(true);setError('');setSources([]);setPreview({screen:'loading',window:'loading'});
    // An inaccessible OS window must not prevent closing or retrying the picker.
    timers.push(setTimeout(()=>{if(active){setLoading(false);setError('목록을 가져오는 데 시간이 걸리고 있어요. 잠시 후 새로고침하거나 창을 닫아도 괜찮아요.');}},10000));
    void window.backseat!.sources().then(list=>{
      if(!active)return;clearTimeout(timers[0]);setSources(list);setLoading(false);setError('');
      for(const type of ['screen','window'] as const){
        if(!list.some(s=>kindOf(s)===type)||!window.backseat?.sourcePreviews){setPreview(p=>({...p,[type]:'unavailable'}));continue;}
        const timer=setTimeout(()=>{if(active)setPreview(p=>({...p,[type]:'unavailable'}));},4000);timers.push(timer);
        void window.backseat.sourcePreviews(type).then(images=>{
          if(!active)return;clearTimeout(timer);
          // A closed/reused window ID with a different title is not this source.
          setSources(current=>current.map(source=>{
            const image=images.find(item=>item.id===source.id&&item.name===source.name);
            return image?{...source,thumbnail:image.thumbnail}:source;
          }));setPreview(p=>({...p,[type]:'ready'}));
        }).catch(()=>{if(active){clearTimeout(timer);setPreview(p=>({...p,[type]:'unavailable'}));}});
      }
    }).catch(()=>{if(active){clearTimeout(timers[0]);setLoading(false);setError('화면 목록을 가져오지 못했어요. 공유할 창이 열려 있는지 확인하고 다시 시도해주세요.');}});
    return()=>{active=false;timers.forEach(clearTimeout);};
  },[revision]);

  const visible=sources.filter(s=>s.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <AccessibleDialog className="source-modal" labelledBy="screen-dialog-title" describedBy="screen-dialog-desc" onClose={onClose}>
    <div className="modal-title"><div><h2 id="screen-dialog-title">함께 볼 화면을 선택하세요</h2><p id="screen-dialog-desc">목록에서 고르면 바로 연결됩니다. 미리보기가 없어도 선택할 수 있어요.</p></div><button className="icon" aria-label="화면 선택 창 닫기" onClick={onClose}><X/></button></div>
    <div className="source-body">
      <div className="source-options">
        <div className="source-option"><Volume2 size={20} aria-hidden="true"/><div><label className="checkbox"><input type="checkbox" aria-describedby="source-sound-help" checked={shareSound} onChange={e=>{setShareSound(e.target.checked);if(!e.target.checked)setSharePicture(true);}}/><span>시스템 출력 소리도 공유</span></label><p id="source-sound-help">게임의 배경음악·효과음·대사와 다른 앱을 포함한 시스템 출력 전체를 듣습니다. 원본 소리는 로컬에서 분석하고, 해석한 단서를 AI에 전달합니다. 클립 버퍼가 켜져 있으면 이 소리가 핫클립에도 저장됩니다. 소리 공유를 끄면 영상에 시스템·게임 소리는 포함되지 않습니다. Mac에서 처음 연결하면 시스템 오디오 녹음 권한을 허용해주세요.</p></div></div>
        <div className="source-option"><Monitor size={20} aria-hidden="true"/><div><label className="checkbox"><input type="checkbox" aria-describedby="source-picture-help" checked={sharePicture} disabled={!shareSound} onChange={e=>setSharePicture(e.target.checked)}/><span>선택한 화면도 관객에게 전달</span></label><p id="source-picture-help">소리를 공유할 때 화면은 끌 수 있어요. 소리만 공유해도 아래 대상은 선택해야 하며, 이때 화면은 전달·저장하지 않습니다. 클립 버퍼가 켜져 있으면 관객이 고른 소리는 음성 클립으로 남을 수 있어요.</p></div></div>
      </div>
      <div className="source-toolbar"><label className="source-search"><Search size={16} aria-hidden="true"/><input aria-label="화면 또는 창 이름 검색" placeholder="화면 또는 창 이름 검색" value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="secondary" aria-label="화면 목록 새로고침" disabled={loading} onClick={()=>setRevision(r=>r+1)}><RefreshCw size={15}/><span>새로고침</span></button></div>
      {loading&&<p className="source-status" role="status"><LoaderCircle size={18} className="source-spinner"/>열려 있는 화면과 창을 찾고 있어요.</p>}
      {error&&<p className="source-status source-error" role="alert">{error}</p>}
      {!loading&&!error&&!visible.length&&<p className="source-status" role="status">{sources.length?'검색 결과가 없어요. 다른 이름으로 찾아보세요.':'선택할 화면이 없어요. 공유할 창을 열고 새로고침해주세요.'}</p>}
      {(['screen','window'] as const).map(type=>{
        const items=visible.filter(s=>kindOf(s)===type);if(!items.length)return null;
        return <section className="source-group" key={type} aria-labelledby={'source-'+type+'-heading'}><h3 id={'source-'+type+'-heading'}>{type==='screen'?'전체 화면':'앱 창'}<span>{items.length}</span></h3><div className="source-grid">{items.map(source=><button key={source.id} type="button" className="source-card" title={source.name} aria-label={source.name} onClick={()=>onSelect(source.id,{systemAudio:shareSound,picture:sharePicture})}>
          <span className="source-preview" aria-hidden="true">{source.thumbnail?<img src={source.thumbnail} alt="" onError={()=>setSources(all=>all.map(s=>s.id===source.id?{...s,thumbnail:''}:s))}/>:<span className="source-placeholder">{type==='screen'?<Monitor size={28}/>:<AppWindow size={28}/>}<small>{preview[type]==='loading'?'미리보기 준비 중':'이름으로 선택할 수 있어요'}</small></span>}</span><span className="source-name">{source.name}</span>
        </button>)}</div></section>;
      })}
    </div>
    <div className="source-footer"><span>{shareSound?(sharePicture?'선택한 화면 + 시스템 소리':'시스템 소리만 공유'):'선택한 화면만 공유'}</span><span>마이크는 방송실에서 별도로 연결해요.</span></div>
  </AccessibleDialog>;
}
