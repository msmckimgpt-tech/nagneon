import { z } from 'zod';
import modelCallLimits from '../shared/model-call-limits.json' with {type:'json'};
import {VIDEO_MAX_FRAMES,VIDEO_FRAME_CHARS,VIDEO_WINDOW_MS} from '../shared/temporal-policy.js';
const short = (n) => z.string().trim().min(1).max(n);
export const Persona = z.object({ id: short(40).regex(/^[a-zA-Z0-9_-]+$/), name: short(30), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), role: z.enum(['viewer','manager']), personality: short(1200), enabled: z.boolean(), system:z.boolean().default(false), sociability:z.number().min(0).max(1).default(0.6), expertise:z.number().min(0).max(1).default(0.5), values:z.string().max(1000).default('즐거운 공동 시청과 스트리머 존중') });
export const Game = z.object({ id: short(40), name: short(80), genre: short(40), context: short(3000), popularity: z.number().min(0).max(1).default(0.5) });
const weight=z.number().min(0).max(100);
export const Discovery=z.object({enabled:z.boolean().default(false),arrivalSeconds:z.number().int().min(10).max(600).default(45),mix:z.object({clip:weight.default(30),guide:weight.default(25),fan:weight.default(20),discussion:weight.default(10),browse:weight.default(15)}).prefault({})}).prefault({}).refine(d=>!d.enabled||Object.values(d.mix).some(w=>w>0),{message:'유입 비중을 하나 이상 0보다 크게 설정하세요.'});
export const Settings = z.object({
  title: short(100), streamer: short(40), gameId: short(40), mode: z.enum(['rehearsal','live']),
  showStreamerMessages:z.boolean().default(true),
  communityActivityEnabled:z.boolean().default(true),
  contextualTranscription:z.boolean().default(true),
  streamerStyle: z.string().max(2000).default('친근한 채팅, 요청할 때만 훈수'), adviceMode: z.enum(['on-request','always','never']).default('on-request'),
  webSearch: z.boolean().default(false), mistakenAdvice: z.number().min(0).max(1).default(0), attentionSeeking: z.number().min(0).max(1).default(0),
  crowdStyle:z.enum(['cozy','lively','stadium']).default('cozy'), lurkRatio:z.number().min(0).max(0.9).default(0.3), communityCulture:z.string().max(2000).default('새 시청자 환영. 과도한 닉네임 친목과 소외 금지. 방송 밖 이야기는 맥락이 있을 때만 짧게.'),
  category:z.enum(['gaming','just-chatting']).default('gaming'),
  discovery:Discovery,
  pointsEnabled:z.boolean().default(true),
  clipBufferEnabled:z.boolean().default(false),autoHighlights:z.boolean().default(false),
  intervalSeconds: z.number().int().min(5).max(120), maxCalls: z.number().int().min(1).max(modelCallLimits.max), chatPace: z.number().int().min(1).max(8),
  managerId: short(40), managerRules: z.string().max(3000), blockedWords: z.array(short(60)).max(100),
  slowModeSeconds: z.number().int().min(0).max(60), spoilerGuard: z.boolean(),
  personas: z.array(Persona).min(1).max(40), games: z.array(Game).min(1).max(100)
}).superRefine((s,ctx) => {
  if (new Set(s.personas.map(p=>p.id)).size !== s.personas.length) ctx.addIssue({code:'custom',message:'관객 ID가 중복됩니다.'});
  if (s.personas.some(p=>['__proto__','constructor','prototype'].includes(p.id))) ctx.addIssue({code:'custom',message:'사용할 수 없는 관객 ID입니다.'});
  if (new Set(s.games.map(g=>g.id)).size !== s.games.length) ctx.addIssue({code:'custom',message:'게임 ID가 중복됩니다.'});
  if (!s.games.some(g=>g.id===s.gameId)) ctx.addIssue({code:'custom',message:'선택한 게임이 없습니다.'});
  if (!s.personas.some(p=>p.id===s.managerId && p.enabled)) ctx.addIssue({code:'custom',message:'활성 관객 중 매니저를 선택하세요.'});
});
export const Observation = z.object({
  communityVotes:z.array(z.object({personaId:short(40),recommended:z.boolean()})).max(3).default([]),
  transcriptCorrections:z.array(z.object({messageId:z.string().uuid(),text:short(3000),confidence:z.number().min(0).max(1),reason:short(240)})).max(4).default([]),
  arrival:z.object({name:short(30),personality:short(1200),values:short(1000),sociability:z.number().min(0).max(1),expertise:z.number().min(0).max(1)}).nullable().default(null),
  viewerChanges:z.array(z.object({personaId:short(40),preference:short(200),nickname:z.string().max(30),reason:short(200),evidence:short(300),sociabilityDelta:z.number().min(-.05).max(.05)})).max(2).default([]),
  clipPicks:z.array(z.object({personaId:short(40),title:short(100),reason:short(240),signature:short(160),soundId:z.string().trim().max(80).default(''),speechId:z.string().trim().max(100).default('')})).max(2).default([]),
  game: z.string().max(120), scene: z.string().max(600), confidence: z.number().min(0).max(1),
  excitement: z.number().min(0).max(1),
  positiveMoment:z.object({positive:z.boolean(),impact:z.number().min(0).max(1),reason:z.string().max(200),signature:z.string().max(160),supporters:z.array(short(40)).max(8),donations:z.array(z.object({personaId:short(40),message:z.string().trim().max(200),anonymous:z.boolean()})).max(2).default([])}).default({positive:false,impact:0,reason:'',signature:'',supporters:[],donations:[]}),
  messages: z.array(z.object({ personaId: short(40), text: short(240), kind: z.enum(['chat','notice']), spoiler: z.boolean(),replyTo:z.string().uuid().nullable().optional() })).max(8)
});
const imageData=(max)=>z.string().max(max).regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/);
export const Frame = z.object({image:imageData(2_800_000).optional(),speech:z.string().max(3000).default(''),
  video:z.object({sessionId:z.string().uuid(),sourceId:z.string().uuid(),frames:z.array(z.object({image:imageData(VIDEO_FRAME_CHARS),at:z.number().int().nonnegative(),still:z.object({since:z.number().int().nonnegative(),samples:z.number().int().min(2).max(33)}).optional()})).min(1).max(VIDEO_MAX_FRAMES)}).optional()
}).superRefine((v,ctx)=>{
  if(v.image&&v.video)ctx.addIssue({code:'custom',message:'화면 입력은 한 가지 경로로 전달하세요.'});
  const f=v.video?.frames;
  if(f&&(f.some((item,i)=>i>0&&item.at<=f[i-1].at)||f.at(-1).at-f[0].at>VIDEO_WINDOW_MS))ctx.addIssue({code:'custom',message:'연속 화면의 순서와 시간 범위를 확인하세요.'});
  if(f?.some(item=>item.still&&(item.still.since>=item.at||item.at-item.still.since>VIDEO_WINDOW_MS)))ctx.addIssue({code:'custom',message:'같은 화면을 본 시간 범위를 확인하세요.'});
});
