import { supabase } from './db.js';

// Update user stats after task completion
// Streak = consecutive days with at least 1 completion
export async function updateStatsOnComplete(userId) {
  const { data: user } = await supabase
    .from('users')
    .select('current_streak, longest_streak, last_completion_date, total_completed')
    .eq('id', userId)
    .single();

  const today = new Date().toISOString().split('T')[0];
  const lastDate = user.last_completion_date;

  let newStreak = user.current_streak;

  if (lastDate === today) {
    // Already completed something today, streak unchanged
  } else if (isYesterday(lastDate, today)) {
    newStreak = user.current_streak + 1;
  } else {
    // Missed at least one day → reset
    newStreak = 1;
  }

  const longest = Math.max(newStreak, user.longest_streak);

  await supabase
    .from('users')
    .update({
      total_completed: user.total_completed + 1,
      current_streak: newStreak,
      longest_streak: longest,
      last_completion_date: today,
    })
    .eq('id', userId);

  return { current_streak: newStreak, longest_streak: longest };
}

export async function incrementCaptured(userId) {
  const { data: user } = await supabase
    .from('users')
    .select('total_captured')
    .eq('id', userId)
    .single();

  await supabase
    .from('users')
    .update({ total_captured: (user?.total_captured || 0) + 1 })
    .eq('id', userId);
}

function isYesterday(lastDateStr, todayStr) {
  if (!lastDateStr) return false;
  const last = new Date(lastDateStr);
  const today = new Date(todayStr);
  const diffMs = today - last;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays === 1;
}
