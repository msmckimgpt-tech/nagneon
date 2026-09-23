export const DecisionMode = Object.freeze({ OFF: 'off', SHADOW: 'shadow', ASSIST: 'assist' });
export const DecisionTask = Object.freeze({
  MEMORY_RERANK: 'memory-rerank',
  REACTION_CHECK: 'reaction-check',
  INTENT_HINT: 'intent-hint',
  COMMUNITY_AFFINITY: 'community-affinity',
  ROUTE_HINT: 'route-hint',
});
const modes = new Set(Object.values(DecisionMode));
const tasks = new Set(Object.values(DecisionTask));
const reasons = new Set([
  'disabled',
  'unavailable',
  'busy',
  'timeout',
  'auth',
  'usage',
  'network',
  'invalid_response',
  'error',
]);

export function parseDecisionConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('판단 설정 형식이 올바르지 않습니다.');
  const mode = input.mode ?? DecisionMode.OFF;
  if (!modes.has(mode)) throw new RangeError('판단 모드는 off/shadow/assist 중 하나여야 합니다.');
  const timeoutMs = input.timeoutMs ?? 1000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 60000)
    throw new RangeError('판단 제한 시간은 50~60000ms여야 합니다.');
  const maxInFlight = input.maxInFlight ?? 2;
  if (!Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 8)
    throw new RangeError('동시 판단 요청은 1~8개여야 합니다.');
  return Object.freeze({ mode, timeoutMs, maxInFlight });
}

export function assertDecisionTask(task) {
  if (!tasks.has(task)) throw new RangeError('등록되지 않은 판단 작업입니다.');
  return task;
}

function common(
  kind,
  {
    task,
    mode,
    requestId = null,
    scopeToken = null,
    questionVersion = null,
    startedAt = null,
    receivedAt = null,
  },
) {
  return {
    kind,
    task,
    mode,
    requestId,
    scopeToken,
    questionVersion,
    startedAt,
    receivedAt,
    apply: false,
  };
}

export function decisionAbstain(meta, reason) {
  if (!reasons.has(reason)) reason = 'error';
  return { ...common('abstain', meta), reason };
}

export function decisionObservation(meta, value, extra = {}) {
  return { ...resultDetails(extra), ...common('observation', meta), value };
}

export function decisionProposal(meta, value, extra = {}) {
  return { ...resultDetails(extra), ...common('proposal', meta), value };
}

function resultDetails(extra) {
  const usage = normalizeDecisionUsage(extra?.usage);
  return {
    ...(typeof extra?.modelVersion === 'string' && extra.modelVersion.length <= 200
      ? { modelVersion: extra.modelVersion }
      : {}),
    ...(Number.isFinite(extra?.confidence) ? { confidence: extra.confidence } : {}),
    ...(usage ? { usage } : {}),
  };
}

export function normalizeDecisionUsage(usage) {
  const inputTokens = usage?.inputTokens;
  return Number.isInteger(inputTokens) && inputTokens >= 0 ? { inputTokens } : undefined;
}
