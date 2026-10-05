// Isolated subscription settings check. No microphone, screen or model call.
const { app, BrowserWindow, session } = require('electron');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createStudioSession } = require('../desktop/session.cjs');

const out = resolve('artifacts/subscription-followups-20260927/ui-' + Date.now());
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', join(out, 'profile'));
let service,
  win,
  finishing = false;
const result = { syntheticAudience: true, physicalDevice: false, paidCalls: 0, checks: [] };
const deadline = setTimeout(() => {
  console.error('UI check timed out');
  void finish(2);
}, 90000);
async function finish(code = 0) {
  if (finishing) return;
  finishing = true;
  clearTimeout(deadline);
  await service?.close();
  win?.destroy();
  app.exit(code);
}
app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(resolve('server/index.js')).href);
    service = await startServer({
      port: 0,
      dataDir: join(out, 'data'),
      provider: {
        bin: 'synthetic-ui-no-executable',
        model: 'synthetic-ui',
        status: () => ({ kind: 'codex', configured: true, model: 'synthetic-ui' }),
        react: async () => {
          return {
            observation: {
              game: 'Synthetic UI',
              scene: 'Synthetic window',
              confidence: 1,
              excitement: 0,
              messages: [],
            },
          };
        },
      },
    });
    service.studio.ai.update({ background: false });
    const hosts = [];
    const hostFactory = () => {
      const host = {
        start: async () => ({ sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111' }),
        close: async () => {
          host.closed = true;
          return { exited: true };
        },
      };
      hosts.push(host);
      return host;
    };
    service.nativeAudio.subscription.hostFactory = hostFactory;
    service.subscriptionSound.hostFactory = hostFactory;
    service.nativeAudio.configure({ mode: 'remote', transport: 'subscription', consent: false });
    const headers = {
      Authorization: 'Bearer ' + service.accessToken,
      'X-Backseat-Client': 'studio',
      'Content-Type': 'application/json',
    };
    await fetch(service.url + '/api/onboarding', {
      method: 'POST',
      headers,
      body: JSON.stringify({ skip: true }),
    });
    win = new BrowserWindow({
      width: 1100,
      height: 900,
      show: false,
      title: 'Nagneon 원격 음성 검증 · 격리 프로필',
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        session: createStudioSession(session, service),
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.on('page-title-updated', (event) => event.preventDefault());
    win.on('close', () => {
      void finish();
    });
    const js = (code) => win.webContents.executeJavaScript(code);
    const until = async (code) => {
      for (let i = 0; i < 150; i++) {
        if (await js(code)) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw Error('UI condition not reached');
    };
    await win.loadURL(service.url);
    await until(`!!document.querySelector('.app-shell')`);
    await js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='AI 대시보드');if(!b)throw Error('dashboard button');b.click();})()`,
    );
    await until(`!!document.querySelector('[aria-label="모델 연결 시험 화면으로 이동"]')`);
    await js(`document.querySelector('[aria-label="모델 연결 시험 화면으로 이동"]').click()`);
    await until(`!!document.querySelector('[aria-label="마이크 원음 이해"]')`);
    assert.equal(
      await js(`document.querySelector('[aria-label="원음 이해용 OpenAI API 키"]')===null`),
      true,
    );
    assert.equal(
      await js(`document.querySelector('[aria-label="음성 전달 방식"]').value`),
      'remote',
    );
    assert.equal(
      await js(`document.querySelector('[aria-label="마이크 원음 이해"] button').disabled`),
      true,
    );
    assert.equal(service.nativeAudio.snapshot().consent, false);
    result.checks.push(
      'subscription mode; no API key input; no automatic consent; apply disabled before consent; no connection',
    );
    {
      for (const width of [1100, 850, 420]) {
        win.setSize(width, 900);
        await new Promise((r) => setTimeout(r, 150));
        assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
        fs.writeFileSync(
          join(out, 'settings-' + width + '.png'),
          (await win.webContents.capturePage()).toPNG(),
        );
      }
      service.nativeAudio.configure({
        mode: 'remote',
        transport: 'subscription',
        consent: true,
        consentVersion: 2,
      });
      service.studio.settings.mode = 'live';
      service.studio.publish();
      await js(`document.querySelector('[aria-label="방송 설정 창 닫기"]').click()`);
      await js(
        `window.micRequestCount=0;void Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{window.micRequestCount++;throw new DOMException('Synthetic permission denial','NotAllowedError');}})`,
      );
      await js(`(()=>{
        window.uiAudio=[];window.uiTracks=[];window.displayRequests=0;
        window.makeVirtualAudio=()=>{
          const track=new MediaStreamTrackGenerator({kind:'audio'}),writer=track.writable.getWriter();let frame=0;
          const pump=async()=>{if(track.readyState!=='live'){void writer.close().catch(()=>{});return;}const audio=new AudioData({format:'f32-planar',sampleRate:48000,numberOfFrames:480,numberOfChannels:1,timestamp:frame*1000000/48000,data:new Float32Array(480)});frame+=480;try{await writer.write(audio);}catch{audio.close();return;}audio.close();setTimeout(pump,10);};void pump();return track;
        };
        window.RTCPeerConnection=class {
          connectionState='new';iceGatheringState='complete';localDescription=null;
          addTransceiver(){this.sender={track:null,replaceTrack:async track=>{this.sender.track=track;}};return {sender:this.sender};}
          createDataChannel(){return this.dc={readyState:'open',close(){this.readyState='closed';},send(){}};}
          async createOffer(){return {type:'offer',sdp:'v=0\\r\\nm=audio 9 UDP/TLS/RTP/SAVPF 111'};}
          async setLocalDescription(value){this.localDescription=value;}
          async setRemoteDescription(){this.connectionState='connected';}
          getReceivers(){return [];}
          close(){this.connectionState='closed';}
        };
        Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async options=>{
          window.displayRequests++;if(!options.audio)throw Error('system sound omitted');
          const canvas=document.createElement('canvas');canvas.width=320;canvas.height=200;
          canvas.getContext('2d').fillRect(0,0,320,200);
          const video=canvas.captureStream(5),stream=new MediaStream([...video.getVideoTracks(),window.makeVirtualAudio()]);
          window.uiTracks.push(...stream.getTracks());return stream;
        }});
      })()`);
      await js(
        `(()=>{const button=[...document.querySelectorAll('nav button')].find(b=>b.textContent.trim()==='방송실');if(!button)throw Error('studio navigation');button.click();})()`,
      );
      await until(`!!document.querySelector('[data-tutorial="start"]')`);
      await new Promise((r) => setTimeout(r, 200));
      await js(`document.querySelector('[data-tutorial="start"]').click()`);
      await until(`window.micRequestCount===1`);
      assert.equal(service.studio.running, true);
      await until(
        `document.querySelector('button[title="게임·시스템 소리는 방송과 함께 공유합니다"]').textContent.includes('연결됨')`,
      );
      for (let i = 0; i < 100 && !service.subscriptionSound.snapshot().active; i++)
        await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(service.subscriptionSound.snapshot().active, true);
      assert.equal(await js('window.displayRequests'), 1);
      await new Promise((resolve) => setTimeout(resolve, 5500));
      assert.equal(
        await js('window.micRequestCount'),
        1,
        'permission refusal retried automatically',
      );
      assert.equal(await js(`document.body.textContent.includes('마이크 권한이 거절')`), true);
      const firstSoundEpoch = service.subscriptionSound.snapshot().inputEpoch;
      await service.subscriptionSound.stop('transport-failed');
      await until(
        `document.querySelector('button[title="게임·시스템 소리는 방송과 함께 공유합니다"]').textContent.includes('다시 연결 중')`,
      );
      assert.equal(
        await js(
          `document.querySelector('button[title="게임·시스템 소리는 방송과 함께 공유합니다"]').classList.contains('active')`,
        ),
        false,
      );
      for (
        let i = 0;
        i < 150 &&
        (!service.subscriptionSound.snapshot().active ||
          service.subscriptionSound.snapshot().inputEpoch === firstSoundEpoch);
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(service.subscriptionSound.snapshot().active, true);
      assert.notEqual(service.subscriptionSound.snapshot().inputEpoch, firstSoundEpoch);
      assert.equal(
        await js('window.displayRequests'),
        1,
        'reconnect must retain the selected sound source',
      );
      assert.equal(await js('window.micRequestCount'), 1);
      await until(
        `document.querySelector('button[title="게임·시스템 소리는 방송과 함께 공유합니다"]').textContent.includes('연결됨')`,
      );
      await service.subscriptionSound.stop('transport-failed');
      await until(
        `document.querySelector('button[title="게임·시스템 소리는 방송과 함께 공유합니다"]').textContent.includes('다시 연결 중')`,
      );
      const hostsBeforeStop = hosts.length;
      await js(`document.querySelector('[data-tutorial="start"]').click()`);
      await until(
        `document.querySelector('[data-tutorial="start"]').textContent.includes('방송 시작')`,
      );
      assert.equal(service.studio.running, false);
      assert.equal(await js('window.micRequestCount'), 1);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      assert.equal(
        hosts.length,
        hostsBeforeStop,
        'broadcast stop must cancel pending sound reconnect',
      );
      assert.equal(await js('window.uiTracks.every(track=>track.readyState==="ended")'), true);
      assert.equal(service.subscriptionSound.snapshot().active, false);
      assert.ok(hosts.every((host) => host.closed));
      assert.equal(await js('document.querySelectorAll("audio").length'), 0);
      await js('Promise.all(window.uiAudio.map(context=>context.close()))');
      result.checks.push(
        'one broadcast click connects synthetic system audio and requests microphone once; denial stops retries; sound failure is visible and reconnects the same source with a new epoch; stop cancels backoff and releases tracks and connections; no audio playback',
      );
      await js(`(()=>{
        window.micMode='ready';window.micStreams=[];window.micConstraints=[];
        Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async options=>{
          window.micRequestCount++;window.micConstraints.push(options);
          if(window.micMode==='missing')throw new DOMException('Synthetic missing device','NotFoundError');
          const make=()=>{
            const stream=new MediaStream([window.makeVirtualAudio()]),track=stream.getAudioTracks()[0],deviceId=options.audio.deviceId?.exact||'virtual-microphone-one';
            Object.defineProperty(track,'getSettings',{value:()=>({deviceId,groupId:'virtual-test'})});
            Object.defineProperty(track,'label',{value:deviceId});
            window.micStreams.push(stream);return stream;
          };
          if(window.micMode==='deferred')return new Promise(resolve=>{window.finishLateMic=()=>resolve(make());});
          return make();
        }});
      })()`);
      await js(`document.querySelector('[data-tutorial="start"]').click()`);
      await until(
        `document.querySelector('button[title="마이크"]').textContent.includes('마이크 켜짐')`,
      );
      const firstEpoch = service.nativeAudio.snapshot().inputEpoch;
      assert.equal(service.studio.state().microphone.deviceId, 'virtual-microphone-one');
      await js(
        `fetch('/api/microphone/config',{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({deviceId:'virtual-microphone-two',label:'virtual microphone two'})}).then(response=>{if(!response.ok)throw Error('device save');})`,
      );
      await until(
        `window.micConstraints.length===2&&document.querySelector('button[title="마이크"]').textContent.includes('마이크 켜짐')`,
      );
      assert.equal(
        await js('window.micConstraints[1].audio.deviceId.exact'),
        'virtual-microphone-two',
      );
      assert.notEqual(service.nativeAudio.snapshot().inputEpoch, firstEpoch);
      assert.equal(
        await js('window.micStreams[0].getTracks().every(track=>track.readyState==="ended")'),
        true,
      );
      await js(
        `window.micMode='missing';window.micStreams.at(-1).getAudioTracks()[0].stop();window.micStreams.at(-1).getAudioTracks()[0].dispatchEvent(new Event('ended'))`,
      );
      await until(
        `window.micConstraints.length===3&&document.body.textContent.includes('선택한 마이크를 찾을 수 없습니다')`,
      );
      await new Promise((resolve) => setTimeout(resolve, 5500));
      assert.equal(
        await js('window.micConstraints.length'),
        3,
        'missing selected device retried or switched',
      );
      await js(
        `window.micMode='deferred';document.querySelector('button[title="마이크"]').click()`,
      );
      await until(`typeof window.finishLateMic==='function'`);
      await js(`document.querySelector('[data-tutorial="start"]').click()`);
      await until(
        `document.querySelector('[data-tutorial="start"]').textContent.includes('방송 시작')`,
      );
      await js('window.finishLateMic()');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.equal(
        await js(
          'window.micStreams.every(stream=>stream.getTracks().every(track=>track.readyState==="ended"))',
        ),
        true,
      );
      assert.equal(service.nativeAudio.snapshot().active, false);
      assert.equal(service.subscriptionSound.snapshot().active, false);
      assert.equal(await js('window.micConstraints.length'), 4);
      await js('Promise.all(window.uiAudio.map(context=>context.close()))');
      result.checks.push(
        'saved exact device; live replacement creates a new epoch and releases previous tracks; missing device stops retries; stop owns a late permission result',
      );
      result.passed = true;
      fs.writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
      await finish();
      return;
    }
  } catch (error) {
    result.passed = false;
    result.error = error.stack || error.message;
    result.sound = service?.subscriptionSound?.snapshot();
    if (win && !win.isDestroyed())
      result.ui = await win.webContents
        .executeJavaScript('document.body.innerText.slice(-5000)')
        .catch(() => null);
    fs.writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
    console.error(result.error);
    console.error(JSON.stringify({ sound: result.sound, ui: result.ui }));
    await finish(1);
  }
});
