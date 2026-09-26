import { DecisionAssistant, defaultDecisionConfig } from '../../server/decision/assistant.js';
export function attachDecision(
  studio,
  { mode = 'assist', key = true, tasks = {}, judge = () => ({}) } = {},
) {
  const calls = [];
  const decision = new DecisionAssistant({
    aiControl: studio.ai,
    now: studio.now,
    config: {
      ...structuredClone(defaultDecisionConfig),
      mode,
      acknowledgeTransfer: true,
      tasks: { ...defaultDecisionConfig.tasks, ...tasks },
    },
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      calls.push(request);
      const selected = await judge(request, init.signal);
      const answers = Object.fromEntries(
        Object.entries(request.questions).map(([id, q]) => {
          if (q.type === 'noul') return [id, { type: 'noul', noul: selected[id] ?? 0.5 }];
          const choice = selected[id] ?? 'keep-existing';
          return [
            id,
            {
              type: 'choice',
              choice,
              confidence: 1,
              probabilities: Object.fromEntries(
                Object.keys(q.criteria).map((k) => [k, k === choice ? 1 : 0]),
              ),
            },
          ];
        }),
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'jev-1.13.0',
          answers,
          usage: { input_tokens: 10, output_tokens: 1 },
        }),
      };
    },
  });
  if (key) decision.setKey('synthetic-test-key');
  studio.decision = decision;
  return { decision, calls };
}
