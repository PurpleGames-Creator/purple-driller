// 画面切り替え・UI制御と、ゲーム開始エントリポイント

document.addEventListener("DOMContentLoaded", () => {
  const screenHome = document.getElementById("screen-home");
  const screenGame = document.getElementById("screen-game");
  const nicknameInput = document.getElementById("nickname");
  const startButton = document.getElementById("start-button");
  const tabButtons = document.querySelectorAll(".tab");
  const gameoverOverlay = document.getElementById("gameover-overlay");
  const gameoverScoreEl = document.getElementById("gameover-score");
  const gameoverScoreValueEl = document.getElementById("gameover-score-value");
  const gameoverBadgeEl = document.getElementById("gameover-badge");
  const retryButton = document.getElementById("gameover-retry");
  const homeButton = document.getElementById("gameover-home");

  let lastGameOverNickname = null;
  let gameoverScoreAnimId = null;

  // タブ切り替え
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;

      tabButtons.forEach((b) => {
        const isActive = b === btn;
        b.classList.toggle("tab--active", isActive);
        b.setAttribute("aria-selected", isActive ? "true" : "false");
      });

      document.querySelectorAll(".ranking-list").forEach((panel) => {
        panel.classList.toggle(
          "ranking-list--active",
          panel.dataset.panel === target
        );
      });

      // ランキング読み込み（後で実実装）
      loadRanking(target);
    });
  });

  // GAME START ボタン
  startButton.addEventListener("click", async () => {
    const nickname = nicknameInput.value.trim();
    if (!nickname) {
      alert("ニックネームを入力してください。");
      nicknameInput.focus();
      return;
    }

    screenHome.classList.remove("screen--active");
    screenGame.classList.add("screen--active");

    // ゲーム開始（start() 内でドリル音の load を実行）
    if (window.startPurpleDiverGame) {
      window.startPurpleDiverGame({ nickname });
    }
  });

  // ゲームオーバー時に呼ばれるグローバルハンドラ（game.js から）
  window.handlePurpleDiverGameOver = function ({ nickname, finalDepth }) {
    lastGameOverNickname = nickname;

    // スコア表示のカウントアップ演出
    if (gameoverScoreValueEl) {
      if (gameoverScoreAnimId != null) {
        cancelAnimationFrame(gameoverScoreAnimId);
        gameoverScoreAnimId = null;
      }
      const target = Math.max(0, Math.round(finalDepth));
      const duration = 800; // ms
      const startTime = performance.now();

      const tick = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out
        const current = Math.floor(target * eased);
        gameoverScoreValueEl.textContent = `${current}m`;
        if (t < 1) {
          gameoverScoreAnimId = requestAnimationFrame(tick);
        } else {
          gameoverScoreAnimId = null;
        }
      };

      gameoverScoreValueEl.textContent = "0m";
      gameoverScoreAnimId = requestAnimationFrame(tick);
    }

    // ローカルベスト判定
    const key = "purpleDiverBestDepth";
    const prev = Number(localStorage.getItem(key) || "0");
    const isNewRecord = finalDepth > prev;
    if (isNewRecord) {
      localStorage.setItem(key, String(finalDepth));
    }

    if (gameoverBadgeEl) {
      if (isNewRecord) {
        gameoverBadgeEl.textContent = "New Record!";
        gameoverBadgeEl.classList.remove("gameover-badge--hidden");
      } else {
        gameoverBadgeEl.classList.add("gameover-badge--hidden");
      }
    }

    if (gameoverOverlay) {
      gameoverOverlay.classList.add("gameover-overlay--visible");
      gameoverOverlay.setAttribute("aria-hidden", "false");
    }
  };

  const hideGameoverOverlay = () => {
    if (gameoverOverlay) {
      gameoverOverlay.classList.remove("gameover-overlay--visible");
      gameoverOverlay.setAttribute("aria-hidden", "true");
    }
  };

  if (retryButton) {
    retryButton.addEventListener("click", async () => {
      hideGameoverOverlay();
      const nickname = lastGameOverNickname || nicknameInput.value.trim();
      if (!nickname || !window.startPurpleDiverGame) return;
      screenHome.classList.remove("screen--active");
      screenGame.classList.add("screen--active");
      window.startPurpleDiverGame({ nickname });
    });
  }

  if (homeButton) {
    homeButton.addEventListener("click", () => {
      hideGameoverOverlay();
      screenGame.classList.remove("screen--active");
      screenHome.classList.add("screen--active");
      loadRanking("today");
    });
  }

  // 初期表示：今日のランキングを読み込み
  loadRanking("today");
});

async function loadRanking(range) {
  const map = {
    today: document.getElementById("ranking-today"),
    week: document.getElementById("ranking-week"),
    all: document.getElementById("ranking-all"),
  };
  const listEl = map[range];
  if (!listEl) return;

  // プレースホルダー表示
  listEl.innerHTML = `<li class="ranking-item ranking-item--placeholder">読み込み中…</li>`;

  if (typeof fetchRanking !== "function") {
    listEl.innerHTML = `<li class="ranking-item ranking-item--placeholder">Supabase未設定のため、ランキングはまだ表示できません。</li>`;
    return;
  }

  const { data, error } = await fetchRanking(range);
  if (error) {
    console.error(error);
    listEl.innerHTML = `<li class="ranking-item ranking-item--placeholder">ランキングの取得に失敗しました。</li>`;
    return;
  }

  if (!data || data.length === 0) {
    listEl.innerHTML = `<li class="ranking-item ranking-item--placeholder">まだスコアが登録されていません。</li>`;
    return;
  }

  listEl.innerHTML = "";
  data.forEach((row, idx) => {
    const rank = idx + 1;
    const li = document.createElement("li");

    let extraClass = "";
    let medal = "";
    if (rank === 1) {
      extraClass = " ranking-item--gold";
      medal = "🥇";
    } else if (rank === 2) {
      extraClass = " ranking-item--silver";
      medal = "🥈";
    } else if (rank === 3) {
      extraClass = " ranking-item--bronze";
      medal = "🥉";
    }

    li.className = "ranking-item" + extraClass;
    li.innerHTML = `
      <span class="ranking-rank">${medal || rank}</span>
      <span class="ranking-name">${escapeHtml(row.nickname ?? "No Name")}</span>
      <span class="ranking-score">${row.depth_m ?? 0}m</span>
    `;
    listEl.appendChild(li);
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

