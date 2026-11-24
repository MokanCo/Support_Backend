import { decideReply, replyIntroducesFacts } from './aiAnswerPolicy.js';
import { approvedEntriesForBranch } from './knowledgeService.js';

export async function answerQuestion(question, locationId) {
  const entries = await approvedEntriesForBranch(locationId);
  const decision = decideReply(question, entries);
  if (decision.source !== 'knowledge' || !process.env.OPENAI_API_KEY) return decision;

  const source = entries.find((entry) => String(entry._id) === decision.entryId);
  const facts = source ? `${source.title}\n${source.body}` : decision.text;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 180,
        messages: [
          {
            role: 'system',
            content:
              'You are the Moka & Co. phone receptionist. Use only the approved facts. Do not add prices, hours, promotions, or products that are not written there. If the facts do not answer the question, say you cannot confirm it. Do not take orders or payment. Keep the reply under 60 words.',
          },
          { role: 'user', content: `Facts:\n${facts}\n\nQuestion:\n${question}` },
        ],
      }),
    });
    clearTimeout(timer);
    if (!response.ok) return decision;
    const payload = await response.json();
    const phrased = String(payload?.choices?.[0]?.message?.content ?? '').trim();
    if (!phrased || !replyIntroducesFacts(phrased, facts)) return decision;
    if (/can't confirm|cannot confirm/i.test(phrased)) {
      return { ...decision, text: phrased, transfer: true };
    }
    return { ...decision, text: phrased };
  } catch {
    return decision;
  }
}
