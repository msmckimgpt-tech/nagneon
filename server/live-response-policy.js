import { isChatQuestion } from './conversation-rhythm.js';
import { repeatedChat } from './chat-quality.js';

const requestsAnswer = (text = '') =>
  isChatQuestion(text) ||
  /(?:설명해|알려|말해|답해|대답해|추천해)\s*(?:줘|주세요|줄래|주실)/u.test(text);

// Model labels are suggestions. A durable reply also needs a real, witnessed
// source from this request; a fabricated ID must never remove the deadline.
export function replySource(message, context, speech = '') {
  const history = context?.chatHistory || [];
  const source = history.find((m) => m.id === message.replyTo && !m.fictional);
  if (message.intent === 'reply')
    return source && ['streamer', 'chat'].includes(source.kind) && requestsAnswer(source.text)
      ? source
      : null;
  // Compatibility for providers without the new optional field. Only an
  // explicit question/request can keep an unlabelled answer beyond scene TTL.
  if (message.intent) return null;
  return requestsAnswer(speech)
    ? history.findLast((m) => m.kind === 'streamer' && !m.fictional && requestsAnswer(m.text)) ||
        null
    : null;
}

export function managerMaySpeak(message, context) {
  if (context?.conversationRhythm?.addressed && replySource(message, context)) return true;
  // A notice must point to an actual witnessed public exchange. Empty-room
  // commentary and ungrounded operating notices do not qualify.
  return (
    message.kind === 'notice' &&
    message.intent === 'moderation' &&
    (context?.chatHistory || []).some(
      (m) => m.id === message.replyTo && !m.fictional && m.kind === 'chat',
    )
  );
}

export function repeatsDonation(message, donation, now, context) {
  if (!donation?.text?.trim() || message.personaId !== donation.personaId) return false;
  // A published gift consumes this contributor's spontaneous response. The
  // model's novelty label alone cannot justify a second version of the cheer.
  // Preserve a witnessed question's answer, with the lexical guard still active.
  return (
    message.donationFollowup !== true ||
    !replySource(message, context) ||
    repeatedChat(
      message,
      [
        {
          ...donation,
          kind: 'donation',
          time: now,
        },
      ],
      now,
    )
  );
}
