// ランキング用のSupabase APIラッパ
// 実際のSupabaseクライアントは supabase-config.js (開発者が作成) で
// window.supabaseClient として注入されている想定です。

const RANKING_TABLE = "diver_scores";

/**
 * スコア送信
 * @param {Object} params
 * @param {string} params.nickname
 * @param {number} params.depthMeters
 */
async function submitScore({ nickname, depthMeters }) {
  if (!window.supabaseClient) {
    console.warn("Supabaseクライアントが設定されていません。スコア送信をスキップします。");
    return { error: null, skipped: true };
  }

  const { data, error } = await window.supabaseClient
    .from(RANKING_TABLE)
    .insert({
      nickname,
      score: depthMeters,
    })
    .select()
    .single();

  return { data, error };
}

/**
 * ランキング取得
 * @param {"today" | "week" | "all"} range
 */
async function fetchRanking(range) {
  if (!window.supabaseClient) {
    console.warn("Supabaseクライアントが設定されていません。ランキング取得をスキップします。");
    return { data: [], error: null, skipped: true };
  }

  const now = new Date();
  let fromDate = null;

  if (range === "today") {
    fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (range === "week") {
    fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  }

  let query = window.supabaseClient
    .from(RANKING_TABLE)
    .select("*")
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(100);

  if (fromDate) {
    query = query.gte("created_at", fromDate.toISOString());
  }

  const { data, error } = await query;
  return { data, error };
}

