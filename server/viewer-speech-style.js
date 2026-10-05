import { createHash } from 'node:crypto';

const STYLE_TOPIC =
  /(?:말투|어투|존댓말|존대|반말|말버릇|어미|ㅋㅋ|ㅎㅎ|웃음(?:표현)?|초성|줄임말|축약|채팅(?:\s*(?:스타일|방식))?|질문|설명|분석|중계|(?:짧|길|부드럽|세)게\s*말|질문(?:을|이)?\s*(?:많|적|줄)|설명(?:을|이)?\s*(?:많|적|줄)|비꼬|빈정|장난(?:스럽)?게\s*말|농담(?:을)?\s*(?:많|적|줄))/u;
const FEEDBACK_CUE =
  /(?:부담|불편|싫|좋|괜찮|과해|너무|좀|더|편하|부드럽|세게|줄|늘|그만|하지|말아|마(?:세요)?|바꿔|고쳐|해\s*줘|해주세요|해라|써|쓰지|말해|했으면|적당)/u;
const CLEAR_BOUNDARY =
  /(?:그만|멈춰|중단|하지\s*마|하지\s*말|쓰지\s*마|불편(?:해|합니다|하니)|싫(?:어|어요|습니다))/u;

const choose = (digest, index, items) => items[digest[index % digest.length] % items.length];
function explicitRegister(personality) {
  if (
    /(?:친해지\S*\s*(?:반말|말을?\s*놓)|존댓말\S*반말|반말\S*존댓말|말높임\S*섞|존반|혼합)/u.test(
      personality,
    )
  )
    return 'mixed-by-closeness';
  if (/(?:존댓말|높임말|존대)/u.test(personality)) return 'polite';
  if (/(?:반말|말을?\s*놓)/u.test(personality)) return 'casual';
  return null;
}

export function isSpeechStyleFeedback(text = '') {
  if (typeof text !== 'string') return false;
  const normalized = text.normalize('NFC').trim();
  return STYLE_TOPIC.test(normalized) && FEEDBACK_CUE.test(normalized);
}

export function isSpeechStylePreference(text = '') {
  if (typeof text !== 'string') return false;
  return STYLE_TOPIC.test(text.normalize('NFC').trim());
}

export function isSpeechStyleBoundary(text = '') {
  if (typeof text !== 'string') return false;
  const normalized = text.normalize('NFC').trim();
  return isSpeechStyleFeedback(normalized) && CLEAR_BOUNDARY.test(normalized);
}

export function viewerSpeechStyle(persona, member = {}) {
  const id = String(persona?.id || '');
  const personality = String(persona?.personality || '').normalize('NFC');
  if (persona?.system || persona?.role === 'manager')
    return Object.freeze({
      version: 1,
      register: 'polite',
      messageLength: 'compact',
      laughter: 'rare',
      texture: 'plain',
      banter: 'restrained',
      stability: 'same-viewer-baseline',
    });
  const digest = createHash('sha256')
    .update('nagneon-viewer-speech-style-v1\0' + id)
    .digest();
  // Do not infer a new baseline from the latest few generated messages: doing so
  // would let a temporary mood or one provider response silently rewrite identity.
  // Only an adopted, witnessed change can alter one long-term axis.
  const register =
    explicitRegister(personality) || choose(digest, 0, ['polite', 'casual', 'mixed-by-closeness']);
  const messageLength = /말수.*적|단답|결론부터|짧게|한\s*호흡/u.test(personality)
    ? 'brief'
    : /풀어\s*말|수다|말이.*길|경험.*덧붙/u.test(personality)
      ? 'expands-on-interest'
      : choose(digest, 1, ['brief', 'compact', 'variable', 'expands-on-interest']);
  const laughter = /웃음.*(?:드물|거의\s*안|잘\s*안)|ㅋㅋ.*(?:드물|거의\s*안|잘\s*안)/u.test(
    personality,
  )
    ? 'rare'
    : /웃음.*(?:자주|많)|ㅋㅋ.*(?:자주|많)|호불호.*순간/u.test(personality)
      ? 'expressive'
      : choose(digest, 2, ['rare', 'contextual', 'contextual', 'expressive']);
  const texture = /(?:초성|줄임말|축약)/u.test(personality)
    ? 'light-chat-shorthand'
    : /(?:담백|결론부터|차분)/u.test(personality)
      ? 'plain'
      : choose(digest, 3, ['plain', 'spoken', 'spoken', 'light-chat-shorthand']);
  const banter = /(?:엉뚱|받아치|능청|장난|드립|농담)/u.test(personality)
    ? 'playful'
    : /(?:싸움을?\s*걸지|조용|차분)/u.test(personality)
      ? 'restrained'
      : choose(digest, 4, ['restrained', 'contextual', 'contextual', 'playful']);
  const style = {
    version: 1,
    register,
    messageLength,
    laughter,
    texture,
    banter,
    stability: 'same-viewer-baseline',
  };
  const adopted = member?.speechStyleOverlay;
  const allowed = {
    register: ['polite', 'casual'],
    messageLength: ['brief'],
    laughter: ['rare'],
    banter: ['restrained'],
  };
  for (const [axis, values] of Object.entries(allowed))
    if (values.includes(adopted?.[axis])) style[axis] = adopted[axis];
  return Object.freeze(style);
}
