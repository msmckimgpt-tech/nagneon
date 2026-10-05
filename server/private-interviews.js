const validTime = (value) => Number.isFinite(value) && value >= 0 && value <= 8.64e15;

// Purchase results are opaque legacy data. Read a bounded owner-only projection
// without repairing or deleting the durable purchase itself.
export function privateInterviews(purchases, personaId) {
  if (!Array.isArray(purchases) || typeof personaId !== 'string' || !personaId) return [];
  const preferences = [];
  for (const purchase of purchases) {
    const result = purchase?.result;
    if (
      purchase?.kind !== 'interview' ||
      purchase.status !== 'completed' ||
      typeof purchase.key !== 'string' ||
      !purchase.key.startsWith(`${personaId}:`) ||
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      result.personaId !== personaId ||
      (result.kind !== undefined && result.kind !== 'interview') ||
      typeof result.question !== 'string' ||
      !result.question.trim() ||
      result.question.length > 600 ||
      !Array.isArray(result.messages)
    )
      continue;
    const at = validTime(result.at) ? result.at : purchase.at;
    if (!validTime(at)) continue;
    const answers = [];
    for (const message of result.messages) {
      if (
        message?.personaId === personaId &&
        typeof message.text === 'string' &&
        message.text.trim() &&
        message.text.length <= 240
      )
        answers.push(message.text);
      if (answers.length === 8) break;
    }
    if (answers.length) preferences.push({ at, question: result.question, answers });
  }
  return preferences.slice(-4);
}
