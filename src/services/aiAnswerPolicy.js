export const ORDER_REPLY =
  'I can help answer questions about our menu and services, but I cannot place orders over the phone at this time. I can connect you with our branch team for further assistance.';

export const UNVERIFIED_REPLY =
  "I can't confirm that from our approved information. I can connect you with our branch team.";

export const PAYMENT_REPLY =
  'I cannot take payment or card details over the phone. I can connect you with our branch team.';

const DAY_INDEX = { Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat' };

export function classifyUtterance(text) {
  const value = String(text ?? '');
  if (/\b(credit card|card number|cvv|cvc|pay(?:ment)? (?:by|with) card|debit card)\b/i.test(value)) {
    return 'payment';
  }
  if (
    /\b(place(?: an)? order|i(?:'d| would) like to order|can i order|order for (?:pickup|delivery)|checkout|add to (?:my )?order)\b/i.test(
      value,
    )
  ) {
    return 'order';
  }
  if (
    /\b(manager|real person|speak (?:to|with)|talk to (?:a |an )?(?:human|person|employee|someone|staff)|representative)\b/i.test(
      value,
    )
  ) {
    return 'human';
  }
  if (/\b(frustrat\w*|angry|upset|complaint|ridiculous|terrible service|refund)\b/i.test(value)) {
    return 'complaint';
  }
  return 'question';
}

function tokens(value) {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}

export function scoreEntry(question, entry) {
  const questionTokens = tokens(question);
  const titleTokens = new Set(tokens(entry.title));
  const bodyTokens = new Set(tokens(`${entry.title} ${entry.body}`));
  let score = 0;
  for (const token of questionTokens) {
    if (bodyTokens.has(token)) score += 1;
    if (titleTokens.has(token)) score += 2;
  }
  return score;
}

export function selectKnowledge(question, entries) {
  const ranked = (entries ?? [])
    .map((entry) => ({ entry, score: scoreEntry(question, entry) }))
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score);
  const branch = ranked.find((item) => item.entry.scope === 'branch');
  if (branch) return branch.entry;
  return ranked.find((item) => item.entry.scope === 'global')?.entry ?? null;
}

export function replyIntroducesFacts(reply, source) {
  const numbers = String(reply ?? '').match(/\d+(?:\.\d+)?/g) ?? [];
  const facts = String(source ?? '');
  return numbers.every((number) => facts.includes(number));
}

export function answerFromEntry(question, entry) {
  if (!entry) {
    return { text: UNVERIFIED_REPLY, transfer: true, source: 'unverified' };
  }
  if (/\b(price|prices|cost|how much)\b/i.test(question) && !/\d/.test(entry.body)) {
    return { text: UNVERIFIED_REPLY, transfer: true, source: 'unverified' };
  }
  return {
    text: String(entry.body ?? '').trim() || UNVERIFIED_REPLY,
    transfer: false,
    source: 'knowledge',
    entryId: entry.id || String(entry._id || ''),
  };
}

export function decideReply(question, entries) {
  const kind = classifyUtterance(question);
  if (kind === 'payment') return { text: PAYMENT_REPLY, transfer: true, source: 'payment' };
  if (kind === 'order') return { text: ORDER_REPLY, transfer: true, source: 'order' };
  if (kind === 'human' || kind === 'complaint') {
    const entry = selectKnowledge(question, entries);
    const answer = answerFromEntry(question, entry);
    if (kind === 'human' || answer.source !== 'knowledge') {
      return {
        text: answer.source === 'knowledge' ? answer.text : UNVERIFIED_REPLY,
        transfer: true,
        source: kind,
      };
    }
  }
  return answerFromEntry(question, selectKnowledge(question, entries));
}

export function buildSummary(turns) {
  const caller = (turns ?? []).find((turn) => turn.speaker === 'caller');
  const receptionist = (turns ?? []).find((turn) => turn.speaker === 'ai');
  if (!caller) return '';
  const question = String(caller.text ?? '').slice(0, 240);
  const answer = receptionist ? ` Receptionist: ${String(receptionist.text ?? '').slice(0, 240)}` : '';
  return `Caller: ${question}${answer}`;
}

export function isWithinBusinessHours(hours, now = new Date()) {
  const schedule = hours?.schedule ?? [];
  const configured = schedule.some((day) => day.closed || (day.open && day.close));
  if (!configured) return { known: false, open: true };
  let weekday = 'mon';
  let time = '12:00';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: hours.timezone || 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const week = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
    const hour = parts.find((part) => part.type === 'hour')?.value ?? '12';
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
    weekday = DAY_INDEX[week] ?? 'mon';
    time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  } catch {
    return { known: false, open: true };
  }
  const today = schedule.find((day) => day.day === weekday);
  if (!today || today.closed || !today.open || !today.close) return { known: true, open: false };
  return { known: true, open: time >= today.open && time < today.close };
}

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
