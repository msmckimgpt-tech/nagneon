/** A doorway, an N, and the light of a live broadcast. */
export function Brand({compact=false}:{compact?:boolean}){
  return <span className="nagneon-brand"><svg className="nagneon-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="12" fill="currentColor" fillOpacity=".1"/><path d="M12 29V12l16 16V11" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="29" cy="10" r="3" fill="currentColor"/></svg>{!compact&&<span className="nagneon-wordmark">nagne<span>on</span><small>나그네온</small></span>}</span>;
}
