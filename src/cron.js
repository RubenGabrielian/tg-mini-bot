import cron from 'node-cron';
import { supabase } from './db.js';
import { weeklyAutopsy } from './claude.js';

export function startCronJobs(bot) {
  // Every Sunday at 10:00 — weekly autopsy of stale tasks
  cron.schedule('0 10 * * 0', async () => {
    console.log('Running weekly autopsy...');
    await runAutopsyForAllUsers(bot);
  });
}

async function runAutopsyForAllUsers(bot) {
  const { data: users } = await supabase.from('users').select('id, telegram_id');
  if (!users) return;

  for (const user of users) {
    try {
      await runAutopsyForUser(bot, user);
    } catch (err) {
      console.error(`Autopsy failed for user ${user.id}:`, err);
    }
  }
}

async function runAutopsyForUser(bot, user) {
  // Find tasks older than 14 days, still pending
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: stale } = await supabase
    .from('tasks')
    .select('id, title, status, created_at')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .lt('created_at', cutoff);

  if (!stale || stale.length === 0) return;

  const enriched = stale.map((t) => ({
    ...t,
    age_days: Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000),
  }));

  const verdicts = await weeklyAutopsy(enriched);
  const toKill = verdicts.filter((v) => v.verdict === 'kill');

  if (toKill.length === 0) return;

  const lines = toKill
    .map((v) => {
      const task = enriched.find((t) => t.id === v.task_id);
      return `• ${task?.title || '?'} — ${v.reason}`;
    })
    .join('\n');

  await bot.telegram.sendMessage(
    user.telegram_id,
    `🧹 Շաբաթական ստուգում\n\nՍա այն task-երն են, որ վաղուց փակած չես․ արժե՞ ջնջել։\n\n${lines}\n\nMini App-ից կարող ես ձեռքով ջնջել եթե համաձայն ես։`
  );
}
