import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// Get or create user from Telegram ID
export async function getOrCreateUser(telegramUser) {
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramUser.id)
    .single();

  if (existing) return existing;

  const { data: created, error } = await supabase
    .from('users')
    .insert({
      telegram_id: telegramUser.id,
      username: telegramUser.username,
      first_name: telegramUser.first_name,
    })
    .select()
    .single();

  if (error) throw error;
  return created;
}

export async function getUserStats(userId) {
  const { data } = await supabase
    .from('users')
    .select('total_captured, total_completed, current_streak, longest_streak')
    .eq('id', userId)
    .single();
  return data;
}
