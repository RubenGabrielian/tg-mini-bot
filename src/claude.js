import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PARSE_SYSTEM_PROMPT = `You are a task parser for an anti-procrastination Telegram bot.
The user types a short note (in Armenian, English, or Russian) describing something they need to do.
Your job: extract structured data.

Return ONLY valid JSON, no markdown, no explanations. Schema:
{
  "title": "short clean version, max 50 chars, in the user's language",
  "location_tag": one of ["shop", "bank", "pharmacy", "post", "home", "office", "call", "online", "other"] or null,
  "estimated_minutes": integer estimate (5, 10, 15, 30, 60, etc.),
  "urgency": integer 1-10 (1=can wait months, 10=blocking something today)
}

Rules:
- "կլեյ առ", "գնա խանութ" → location_tag: "shop"
- "բանկ զանգեմ", "call mom", "позвонить" → location_tag: "call"
- "դեղատուն", "pharmacy", "аптека" → location_tag: "pharmacy"
- "ակնոցս նորոգման տամ", "post", "почта" → location_tag: "post" or "shop"
- "տանը անեմ X" → location_tag: "home"
- Default urgency: 5. Only go above 7 if user uses urgency words ("urgent", "շտապ", "deadline", "today", "այսօր").
- Default estimated_minutes: 15 if unclear.
- Title should be imperative, short, lowercase first letter.

Examples:
Input: "կլեյ առ"
Output: {"title": "կլեյ առնել", "location_tag": "shop", "estimated_minutes": 10, "urgency": 5}

Input: "մորս զանգեմ շտապ"
Output: {"title": "մորս զանգել", "location_tag": "call", "estimated_minutes": 10, "urgency": 8}

Input: "ակնոցս նորոգման տամ"
Output: {"title": "ակնոցը նորոգման տալ", "location_tag": "shop", "estimated_minutes": 20, "urgency": 4}`;

export async function parseTask(rawText) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 300,
    system: PARSE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: rawText }],
  });

  const text = response.content[0].text.trim();
  // Strip code fences if Claude added them
  const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Fallback if Claude returns malformed JSON
    return {
      title: rawText.slice(0, 50),
      location_tag: null,
      estimated_minutes: 15,
      urgency: 5,
    };
  }
}

const AUTOPSY_SYSTEM_PROMPT = `You are reviewing a user's stale tasks for their weekly review.
For each task, decide if it should be kept or suggested for deletion.
Tasks older than 14 days that have been "skipped" multiple times are likely dead.
Be honest but kind. Respond in Armenian.

Return JSON array: [{"task_id": <id>, "verdict": "keep" | "kill", "reason": "<short Armenian reason>"}]`;

export async function weeklyAutopsy(staleTasks) {
  if (staleTasks.length === 0) return [];

  const taskList = staleTasks
    .map((t) => `id=${t.id}, title="${t.title}", age_days=${t.age_days}, status=${t.status}`)
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    system: AUTOPSY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: taskList }],
  });

  const text = response.content[0].text.trim();
  const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
}
