import { Router } from 'express';
import crypto from 'crypto';
import { supabase } from './db.js';
import { updateStatsOnComplete } from './streak.js';

export const apiRouter = Router();

// Verify Telegram WebApp init data
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyTelegramInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(process.env.BOT_TOKEN)
    .digest();

  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (computedHash !== hash) return null;

  const userJson = params.get('user');
  if (!userJson) return null;
  return JSON.parse(userJson);
}

// Auth middleware
async function authMiddleware(req, res, next) {
  const initData = req.header('X-Telegram-Init-Data');
  const tgUser = verifyTelegramInitData(initData);

  if (!tgUser) {
    // For local dev, allow ?dev_user_id=123
    if (process.env.NODE_ENV !== 'production' && req.query.dev_user_id) {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', Number(req.query.dev_user_id))
        .single();
      if (data) {
        req.user = data;
        return next();
      }
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', tgUser.id)
    .single();

  if (!user) return res.status(404).json({ error: 'User not found, /start the bot first' });
  req.user = user;
  next();
}

// GET /api/tasks — bucketed list for Mini App
apiRouter.get('/tasks', authMiddleware, async (req, res) => {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Score each task: urgency + decay (older = higher score)
  const now = Date.now();
  const scored = tasks.map((t) => {
    const ageDays = (now - new Date(t.created_at).getTime()) / 86400000;
    // Decay: 1 point per day, capped at 10
    const decayBoost = Math.min(ageDays, 10);
    const score = t.urgency + decayBoost;
    return { ...t, _score: score, _age_days: ageDays };
  });

  scored.sort((a, b) => b._score - a._score);

  // Bucket into now / nearby / later
  const now_task = scored[0] || null;
  const nearby = scored.slice(1, 4); // next 3
  const later = scored.slice(4);

  res.json({
    now: now_task,
    nearby,
    later,
    stats: {
      total_captured: req.user.total_captured,
      total_completed: req.user.total_completed,
      current_streak: req.user.current_streak,
      longest_streak: req.user.longest_streak,
    },
  });
});

// POST /api/tasks/:id/complete
apiRouter.post('/tasks/:id/complete', authMiddleware, async (req, res) => {
  const taskId = Number(req.params.id);

  const { data: task, error } = await supabase
    .from('tasks')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error || !task) return res.status(404).json({ error: 'Task not found' });

  await supabase.from('activity_log').insert({
    user_id: req.user.id,
    task_id: taskId,
    action: 'completed',
  });

  const newStats = await updateStatsOnComplete(req.user.id);
  res.json({ task, stats: newStats });
});

// POST /api/tasks/:id/skip — push to back of queue, don't complete
apiRouter.post('/tasks/:id/skip', authMiddleware, async (req, res) => {
  await supabase
    .from('tasks')
    .update({ last_surfaced_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  await supabase.from('activity_log').insert({
    user_id: req.user.id,
    task_id: req.params.id,
    action: 'skipped',
  });

  res.json({ ok: true });
});
