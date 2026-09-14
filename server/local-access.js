import {randomBytes,timingSafeEqual} from 'node:crypto';

// A per-process capability, never part of studio state or renderer JavaScript.
// Desktop injects Authorization in its private Electron session. Cookies are
// used only by the explicitly enabled development-browser connection flow.
export function createLocalAccess({browserConnect=false}={}){
  const token=randomBytes(32).toString('hex');
  const cookieName='backseat_'+randomBytes(12).toString('hex');
  let redeemed=false;
  const matches=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&timingSafeEqual(Buffer.from(value),Buffer.from(token));
  const authenticated=req=>{
    if(req.headers.authorization?.startsWith('Bearer ')&&matches(req.headers.authorization.slice(7)))return true;
    if(!browserConnect||!redeemed)return false;
    const cookies=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(cookieName+'='));
    return cookies.length===1&&matches(cookies[0].slice(cookieName.length+1));
  };
  return {token,authenticated,
    redeem(value,res){
      if(!browserConnect||redeemed||!matches(value))return false;
      redeemed=true;
      res.setHeader('Set-Cookie',`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict`);
      return true;
    }
  };
}

export const connectPage='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Nagneon 개발 연결</title><body style="margin:0;padding:12vh 8vw;background:#10151e;color:#edf4f6;font:16px/1.8 Segoe UI,Malgun Gothic,sans-serif"><p style="color:#80e6cf;letter-spacing:3px">NAGNEON · 나그네온</p><h1>Nagneon 개발 연결</h1><p id="status">실행 터미널에서 제공한 일회용 연결 주소로 접속하세요.</p><script src="/connect.js" defer></script></body></html>';
export const connectScript=`(async()=>{
  const token=location.hash.slice(1);history.replaceState(null,'','/connect');
  if(!token)return;
  try{const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({token})});
    if(!response.ok)throw new Error();location.replace('/');
  }catch{document.getElementById('status').textContent='연결 주소가 만료되었거나 올바르지 않습니다. 서버를 다시 실행해 새 주소를 사용하세요.';}
})();`;
