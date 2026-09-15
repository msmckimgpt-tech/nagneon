import {useEffect,useState} from 'react';
export function StorageSettings({locked}:{locked:boolean}){
  const [info,setInfo]=useState<{profile:string;defaultProfile:string;isolated:boolean}>();
  const [error,setError]=useState('');
  const [pending,setPending]=useState(false);
  useEffect(()=>{window.backseat?.storageStatus().then(setInfo).catch(e=>setError(String(e)));},[]);
  async function change(useDefault:boolean){
    setPending(true);setError('');
    try{await window.backseat?.changeStorage(useDefault);}catch(e){setError(String(e));}finally{setPending(false);}
  }
  return <section aria-label="저장 위치"><h3>저장 위치</h3>
    {info?<><p style={{overflowWrap:'anywhere'}}>현재 위치: {info.profile}</p><p className="field-note" style={{overflowWrap:'anywhere'}}>시스템 기본 위치: {info.defaultProfile}</p>
      <p className="field-note">버전이 바뀌어도 관객·대화·설정·클립은 이 위치에 보존됩니다. 변경 시 빈 폴더에 기존 기록을 복사한 뒤 앱을 재시작합니다. 원래 기록은 복구용으로 남깁니다. 다른 설정을 수정했다면 먼저 저장해주세요.</p>
      {info.isolated&&<p>검증용 별도 프로필로 실행 중입니다. 저장 위치 변경은 일반 실행에서 사용할 수 있어요.</p>}
      <button type="button" className="secondary" disabled={locked||pending||info.isolated} onClick={()=>void change(false)}>저장 폴더 변경…</button>{' '}
      <button type="button" className="secondary" disabled={locked||pending||info.isolated||info.profile===info.defaultProfile} onClick={()=>void change(true)}>시스템 기본 위치로 변경</button>
    </>:<p>저장 위치는 데스크톱 앱에서 확인할 수 있어요.</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
