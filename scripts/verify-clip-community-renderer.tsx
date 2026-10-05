// Synthetic-only renderer for verify-clip-community.cjs. No device/account access.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CommunitySpace } from '../src/CommunitySpace';
import { createSeparatedClipSources } from '../src/clip-source';
import { createSoundAnalysisSource } from '../src/sound-analysis-source';
import type { State } from '../src/types';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const preferences = {
  enabled: true,
  arrivalsEnabled: true,
  creativeImages: false,
  notifications: false,
  mutedCommunities: [],
  mutedTopics: ['quiet'],
  bookmarks: [],
  hiddenThreads: [],
};
const communities = [
  {
    id: 'guide',
    name: '게임 이야기',
    description: '작은 발견과 궁금한 점을 나누는 공간',
    topics: [
      { id: 'practice', label: '함께 찾는 방법' },
      { id: 'quiet', label: '조용한 플레이' },
    ],
  },
  {
    id: 'lounge',
    name: '잠깐 쉬어가는 방',
    description: '일상과 취미를 각자의 속도로 나눠요',
    topics: [{ id: 'daily', label: '오늘의 작은 이야기' }],
  },
];
const image = document.createElement('canvas');
image.width = 32;
image.height = 32;
image.getContext('2d')!.fillRect(0, 0, 32, 32);
const post = {
  id: 'synthetic-post',
  communityId: 'guide',
  topicId: 'practice',
  kind: 'daily',
  title: '자꾸 놓치던 길을 찾았음',
  text: '계속 정면만 보다가 옆길을 놓쳤네. 지도 다시 보고 알았다.',
  author: '가상 테스트 주민',
  at: 1,
  authorIsViewer: false,
  sourceStatus: 'current',
  bookmarked: false,
  recommendationCount: 0,
  recommended: false,
  comments: [],
  attachments: [
    {
      id: 'preserved',
      name: '기존 주민 그림.png',
      kind: 'image',
      mime: 'image/png',
      bytes: 128,
      url: image.toDataURL(),
      available: true,
      generated: true,
    },
  ],
};
const fixture = {
  ready: false,
  preferences,
  patches: [] as unknown[],
  errors: [] as string[],
  failNext: false,
  holdNext: false,
  release: (() => {}) as () => void,
  async audio() {
    const context = new AudioContext();
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const picture = canvas.captureStream(15);
    const system = context.createMediaStreamDestination(),
      mic = context.createMediaStreamDestination();
    const gameTone = context.createOscillator(),
      voiceTone = context.createOscillator();
    gameTone.frequency.value = 440;
    voiceTone.frequency.value = 880;
    gameTone.connect(system);
    voiceTone.connect(mic);
    gameTone.start();
    voiceTone.start();
    const shared = new MediaStream([
      ...picture.getVideoTracks(),
      ...system.stream.getAudioTracks(),
    ]);
    let sources: ReturnType<typeof createSeparatedClipSources> = null;
    let analysis: ReturnType<typeof createSoundAnalysisSource> | null = null;
    const recorders: MediaRecorder[] = [];
    const timer = setInterval(() => {
      const paint = canvas.getContext('2d')!;
      paint.fillStyle = Math.floor(performance.now() / 100) % 2 ? '#223344' : '#446688';
      paint.fillRect(0, 0, 160, 90);
    }, 50);
    try {
      await context.resume();
      sources = createSeparatedClipSources(shared, mic.stream, null);
      if (!sources?.voice || !sources.base.hasAudio) throw Error('Missing separated capture');
      analysis = createSoundAnalysisSource(shared);
      const start = (source: NonNullable<typeof sources>['base']) => {
        const recorder = new MediaRecorder(source.stream, source.recorderOptions),
          chunks: Blob[] = [];
        recorders.push(recorder);
        const done = new Promise<Blob>((resolve, reject) => {
          recorder.ondataavailable = (event) => {
            if (event.data.size) chunks.push(event.data);
          };
          recorder.onerror = () => reject(Error('MediaRecorder failed'));
          recorder.onstop = () => resolve(new Blob(chunks, { type: source.mimeType }));
        });
        recorder.start(100);
        return { recorder, done };
      };
      const base = start(sources.base),
        voice = start(sources.voice);
      await wait(450);
      analysis.stream?.getTracks().forEach((track) => track.stop());
      analysis.close();
      const alive = [...shared.getTracks(), ...sources.base.stream.getTracks()].every(
        (track) => track.readyState === 'live',
      );
      if (!alive) throw Error('Analysis teardown ended the recording source');
      await wait(1400);
      base.recorder.stop();
      voice.recorder.stop();
      const baseBlob = await base.done,
        voiceBlob = await voice.done;
      const inspect = async (blob: Blob, wanted: number, other: number) => {
        const decoded = await context.decodeAudioData(await blob.arrayBuffer());
        const data = decoded.getChannelData(0),
          rate = decoded.sampleRate;
        const amplitude = (frequency: number) => {
          let real = 0,
            imaginary = 0;
          // Inspect the tail, which was recorded after the analyser was stopped.
          // Electron may delay the first encoded frames in a hidden test window.
          const start = Math.floor(data.length * 0.6),
            end = Math.min(data.length, start + Math.floor(rate * 0.3));
          for (let i = start; i < end; i++) {
            const phase = (2 * Math.PI * frequency * i) / rate;
            real += data[i] * Math.cos(phase);
            imaginary += data[i] * Math.sin(phase);
          }
          return (2 * Math.hypot(real, imaginary)) / (end - start);
        };
        const desired = amplitude(wanted),
          unwanted = amplitude(other);
        if (
          !Number.isFinite(desired) ||
          decoded.duration < 0.75 ||
          desired < 0.05 ||
          unwanted > desired * 0.1
        )
          throw Error(
            `Audio separation/decode failed: wanted=${wanted}, duration=${decoded.duration}, desired=${desired}, unwanted=${unwanted}, bytes=${blob.size}`,
          );
        return {
          bytes: blob.size,
          duration: decoded.duration,
          sampleRate: rate,
          desired,
          unwanted,
        };
      };
      const encode = async (blob: Blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      return {
        aliveAfterAnalysisStop: alive,
        base: await inspect(baseBlob, 440, 880),
        voice: await inspect(voiceBlob, 880, 440),
        baseBytes: await encode(baseBlob),
        voiceBytes: await encode(voiceBlob),
      };
    } finally {
      clearInterval(timer);
      for (const recorder of recorders) if (recorder.state !== 'inactive') recorder.stop();
      analysis?.close();
      sources?.close();
      gameTone.stop();
      voiceTone.stop();
      [...picture.getTracks(), ...system.stream.getTracks(), ...mic.stream.getTracks()].forEach(
        (track) => track.stop(),
      );
      await context.close();
    }
  },
};
Object.assign(window, { fixture });
window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    'http://fixture.invalid',
  );
  if (url.pathname === '/api/social/preferences' && init?.method === 'PATCH') {
    const patch = JSON.parse(String(init.body));
    fixture.patches.push(patch);
    if (fixture.holdNext) {
      fixture.holdNext = false;
      await new Promise<void>((resolve) => {
        fixture.release = resolve;
      });
    }
    if (fixture.failNext) {
      fixture.failNext = false;
      return Response.json({ error: '합성 저장 실패' }, { status: 409 });
    }
    Object.assign(preferences, patch);
    return Response.json(preferences);
  }
  if (url.pathname === '/api/social/search')
    return Response.json({
      revision: 1,
      communities,
      preferences,
      quarantined: false,
      blockedReason: '',
      status: 'ready',
      stale: false,
      total: 1,
      posts: [post],
    });
  if (url.pathname === '/api/social/threads/synthetic-post') return Response.json(post);
  throw Error('Unexpected network request in synthetic fixture: ' + url.pathname);
};
const state = {
  settings: { personas: [], streamer: '합성 테스트 방송' },
  audience: { members: {} },
  social: { threads: 1, revision: 1 },
} as unknown as State;
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CommunitySpace
      state={state}
      onError={(message) => fixture.errors.push(message)}
      section="outside"
      setSection={() => {}}
    >
      <p>방송 커뮤니티 합성 검증</p>
    </CommunitySpace>
  </React.StrictMode>,
);
setTimeout(() => {
  fixture.ready = true;
}, 100);
