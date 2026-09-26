const invalid = (message, code = 'invalid_response') => Object.assign(new Error(message), { code });
const record = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const keysMatch = (actual, expected) =>
  actual.length === expected.length && actual.every((key) => expected.includes(key));
const probability = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

function textJson(value, depth = 0) {
  if (depth > 30) return false;
  if (typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean' || value === null) return true;
  if (Array.isArray(value)) {
    if (value.length > 48000 || Reflect.ownKeys(value).length !== value.length + 1) return false;
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (
        !descriptor ||
        !Object.hasOwn(descriptor, 'value') ||
        !textJson(descriptor.value, depth + 1)
      )
        return false;
    }
    return true;
  }
  return (
    record(value) &&
    Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string' || key.length > 120) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor.enumerable &&
        Object.hasOwn(descriptor, 'value') &&
        textJson(descriptor.value, depth + 1)
      );
    })
  );
}

function instructions(value) {
  return (
    (typeof value === 'string' && value.trim().length > 0) ||
    ((Array.isArray(value) || record(value)) && textJson(value) && JSON.stringify(value).length > 2)
  );
}

export function prepareJevRequest({ state, questions, model = 'jev-1.13.0' }) {
  if (typeof model !== 'string' || !/^jev-(?:latest|\d+\.\d+\.\d+)$/.test(model))
    throw invalid('JEV 모델 설정이 올바르지 않습니다.', 'usage');
  if (!(typeof state === 'string' || Array.isArray(state) || record(state)) || !textJson(state))
    throw invalid('JEV 상태 형식이 올바르지 않습니다.', 'usage');
  if (
    !record(questions) ||
    Object.keys(questions).length < 1 ||
    Object.keys(questions).length > 255 ||
    !textJson(questions)
  )
    throw invalid('JEV 질문 형식이 올바르지 않습니다.', 'usage');
  for (const [id, question] of Object.entries(questions)) {
    if (
      !/^[A-Za-z0-9_-]{1,80}$/.test(id) ||
      !record(question) ||
      !instructions(question.instructions)
    )
      throw invalid('JEV 질문 형식이 올바르지 않습니다.', 'usage');
    if (question.type === 'noul') {
      if (
        !keysMatch(
          Object.keys(question),
          question.criteria === undefined
            ? ['type', 'instructions']
            : ['type', 'instructions', 'criteria'],
        )
      )
        throw invalid('JEV 질문 형식이 올바르지 않습니다.', 'usage');
      if (
        question.criteria !== undefined &&
        (!record(question.criteria) ||
          !Object.keys(question.criteria).every(
            (key) => ['true', 'false'].includes(key) && instructions(question.criteria[key]),
          ))
      )
        throw invalid('JEV 질문 형식이 올바르지 않습니다.', 'usage');
    } else if (question.type === 'choice') {
      const criteria = question.criteria;
      if (
        !keysMatch(Object.keys(question), ['type', 'instructions', 'criteria']) ||
        !record(criteria) ||
        Object.keys(criteria).length < 2 ||
        Object.keys(criteria).length > 255 ||
        !('none' in criteria || 'keep-existing' in criteria) ||
        !Object.entries(criteria).every(
          ([key, description]) =>
            key.length > 0 &&
            key.length <= 80 &&
            (description === null || instructions(description)),
        )
      )
        throw invalid('JEV 선택 질문에는 기존 경로와 유효한 후보가 필요합니다.', 'usage');
    } else if (question.type === 'score') {
      if (
        !keysMatch(Object.keys(question), ['type', 'instructions', 'criteria']) ||
        !Array.isArray(question.criteria) ||
        question.criteria.length < 2 ||
        question.criteria.length > 10 ||
        !question.criteria.every(instructions)
      )
        throw invalid('JEV 점수 질문 형식이 올바르지 않습니다.', 'usage');
    } else throw invalid('JEV 질문 유형이 올바르지 않습니다.', 'usage');
  }
  if (JSON.stringify(state).length > 24000)
    throw invalid('JEV 상태 길이 상한을 초과했습니다.', 'usage');
  const body = JSON.stringify({ model, state, questions });
  if (body.length > 48000) throw invalid('JEV 요청 길이 상한을 초과했습니다.', 'usage');
  return body;
}

export function validateJevResponse(value, questions, onUsage) {
  if (!record(value)) throw invalid('JEV 응답 형식이 올바르지 않습니다.');
  const usage = value.usage;
  if (
    !record(usage) ||
    !Number.isSafeInteger(usage.input_tokens) ||
    usage.input_tokens < 0 ||
    !Number.isSafeInteger(usage.output_tokens) ||
    usage.output_tokens < 0
  )
    throw invalid('JEV 사용량 형식이 올바르지 않습니다.');
  const cleanUsage = { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
  onUsage?.(cleanUsage);
  if (
    typeof value.model !== 'string' ||
    !value.model.trim() ||
    value.model.length > 200 ||
    !record(value.answers) ||
    !keysMatch(Object.keys(value.answers), Object.keys(questions))
  )
    throw invalid('JEV 답변 ID가 올바르지 않습니다.');
  for (const [id, question] of Object.entries(questions)) {
    const answer = value.answers[id];
    if (!record(answer) || answer.type !== question.type)
      throw invalid('JEV 답변 유형이 올바르지 않습니다.');
    if (question.type === 'noul') {
      if (!keysMatch(Object.keys(answer), ['type', 'noul']) || !probability(answer.noul))
        throw invalid('JEV 예/아니요 값이 올바르지 않습니다.');
      continue;
    }
    if (!probability(answer.confidence) || !record(answer.probabilities))
      throw invalid('JEV 확률이 올바르지 않습니다.');
    const options =
      question.type === 'choice'
        ? Object.keys(question.criteria)
        : question.criteria.map((_, i) => String(i));
    if (
      !keysMatch(Object.keys(answer.probabilities), options) ||
      !Object.values(answer.probabilities).every(probability)
    )
      throw invalid('JEV 후보 확률이 올바르지 않습니다.');
    if (Math.abs(Object.values(answer.probabilities).reduce((sum, n) => sum + n, 0) - 1) > 0.02)
      throw invalid('JEV 확률 합계가 올바르지 않습니다.');
    if (question.type === 'choice') {
      if (
        !keysMatch(Object.keys(answer), ['type', 'choice', 'probabilities', 'confidence']) ||
        !options.includes(answer.choice)
      )
        throw invalid('JEV 선택 후보가 올바르지 않습니다.');
    } else {
      if (
        !keysMatch(Object.keys(answer), [
          'type',
          'score',
          'legend',
          'probabilities',
          'confidence',
        ]) ||
        typeof answer.score !== 'number' ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > options.length - 1 ||
        !record(answer.legend) ||
        !keysMatch(Object.keys(answer.legend), options) ||
        !options.every(
          (index) =>
            typeof answer.legend[index] === 'string' && answer.legend[index].trim().length > 0,
        )
      )
        throw invalid('JEV 점수 답변이 올바르지 않습니다.');
    }
  }
  return { answers: value.answers, model: value.model, usage: cleanUsage };
}
