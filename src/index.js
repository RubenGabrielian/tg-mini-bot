import { Telegraf, Markup } from 'telegraf';
import express from 'express';
import 'dotenv/config';
import { supabase, getOrCreateUser, getUserStats } from './db.js';
import { parseTask } from './claude.js';
import { updateStatsOnComplete, incrementCaptured } from './streak.js';
import { startCronJobs } from './cron.js';

const bot = new Telegraf(process.env.BOT_TOKEN);

// /start
bot.start(async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  await ctx.reply(
    `Բարի գալուստ։\n\n` +
    `Գրի՛ր ինձ ինչ որ պետք է անես։ Ինչքան փոքր՝ այնքան լավ։\n` +
    `Օրինակ՝ "կլեյ առ", "մորս զանգեմ", "ակնոցս նորոգման տամ"։\n\n` +
    `Հետո բացի՛ր Mini App-ը՝ տեսնելու ինչը հիմա արժի անել։`,
    Markup.keyboard([[Markup.button.webApp('📋 Բացել', process.env.MINIAPP_URL)]])
      .resize()
      .persistent()
  );
});

// /stats
bot.command('stats', async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  const stats = await getUserStats(user.id);
  await ctx.reply(
    `📊 Քո վիճակագրությունը\n\n` +
    `Գրանցել ես՝ ${stats.total_captured}\n` +
    `Արել ես՝ ${stats.total_completed}\n` +
    `Ընթացիկ streak՝ ${stats.current_streak} օր 🔥\n` +
    `Ամենաերկար streak՝ ${stats.longest_streak} օր`
  );
});

// Any text message → new task
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const user = await getOrCreateUser(ctx.from);

  // Show typing indicator while Claude parses
  await ctx.sendChatAction('typing');

  try {
    const parsed = await parseTask(text);

    const { data: task, error } = await supabase
      .from('tasks')
      .insert({
        user_id: user.id,
        raw_text: text,
        title: parsed.title,
        location_tag: parsed.location_tag,
        estimated_minutes: parsed.estimated_minutes,
        urgency: parsed.urgency,
      })
      .select()
      .single();

    if (error) throw error;

    await supabase.from('activity_log').insert({
      user_id: user.id,
      task_id: task.id,
      action: 'captured',
    });

    await incrementCaptured(user.id);

    const stats = await getUserStats(user.id);
    const tagEmoji = locationEmoji(parsed.location_tag);

    await ctx.reply(
      `✓ ${tagEmoji} ${parsed.title}\n` +
      `_~${parsed.estimated_minutes} րոպե_\n\n` +
      `Ընդամենը գրանցել ես՝ ${stats.total_captured}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('=== FULL ERROR ===');
    console.error('Message:', err.message);
    console.error('Status:', err.status);
    console.error('Stack:', err.stack);
    console.error('Full:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    console.error('==================');
    await ctx.reply('Ինչ-որ բան սխալ գնաց։ Փորձիր կրկին։');
  }
});

function locationEmoji(tag) {
  const map = {
    shop: '🛒',
    bank: '🏦',
    pharmacy: '💊',
    post: '📮',
    home: '🏠',
    office: '🏢',
    call: '📞',
    online: '💻',
    other: '📌',
  };
  return map[tag] || '📌';
}

// Express server for Mini App API
const app = express();
app.use(express.json());

// CORS for Mini App
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Mount API routes
import { apiRouter } from './api.js';
app.use('/api', apiRouter);

app.get('/', (_, res) => res.send('NudgeBot running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on :${PORT}`));
bot.catch((err, ctx) => {
  console.error('=== TELEGRAF ERROR ===');
  console.error('Update:', ctx.update);
  console.error('Error:', err);
  console.error('Stack:', err.stack);
});
bot.launch();
startCronJobs(bot);

console.log('Bot started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
