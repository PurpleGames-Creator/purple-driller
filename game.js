// Canvas を用いた Purple Diver のゲームロジック

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColorHex(c1, c2, t) {
  const parse = (c) => {
    const v = c.replace("#", "");
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16),
    };
  };
  const a = parse(c1);
  const b = parse(c2);
  const r = Math.round(lerp(a.r, b.r, t));
  const g = Math.round(lerp(a.g, b.g, t));
  const bl = Math.round(lerp(a.b, b.b, t));
  return `rgb(${r},${g},${bl})`;
}

// 0m 基準の土の色（好評な茶色）
const baseGroundColor = "#8B4513";

/** hex → HSL（h: 0-360, s,l: 0-1） */
function hexToHsl(hex) {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}

/** HSL → CSS色文字列 */
function hslToCss(h, s, l) {
  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

/**
 * 深さに応じて基準色を暗くした色（100mごとにリニアに輝度を下げる）
 * @param {number} depth - 現在の深さ（m）
 * @param {number} lOffset - グラデーション用の輝度オフセット（0=上, 負で下ほど暗く）
 */
function groundColorAtDepth(depth, lOffset = 0) {
  const { h, s, l: baseL } = hexToHsl(baseGroundColor);
  const steps = depth / 100;
  const darkenPer100 = 0.012;
  const darken = Math.min(0.5, steps * darkenPer100);
  const L = Math.max(0.06, baseL - darken + lOffset);
  return hslToCss(h, s, L);
}

/** シード付き擬似乱数（0〜1）テクスチャ・地層用 */
function seededNoise(seed) {
  let s = seed | 0;
  return function () {
    s = (s * 1103515245 + 12345) >>> 0;
    return (s % 65536) / 65536;
  };
}

class PurpleDiverGame {
  /**
   * @param {Object} options
   * @param {HTMLCanvasElement} options.canvas
   * @param {HTMLElement} options.depthLabelEl
   * @param {string} options.nickname
   * @param {(finalDepth: number) => void} options.onGameOver
   */
  constructor({ canvas, depthLabelEl, nickname, onGameOver }) {
    console.log("[BOOT] G1. PurpleDiverGame コンストラクタ開始");
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.depthLabelEl = depthLabelEl;
    this.nickname = nickname;
    this.onGameOver = onGameOver;

    this.logicalWidth = 0;
    this.logicalHeight = 0;
    this.targetCharY = 0;

    // キャラクター画像
    this.characterImage = new Image();
    this.characterImage.src = "./正面.png";
    this.imageLoaded = false;

    this.charX = 0;
    this.charY = 0;
    this.charSize = 48;
    this.charHalfWidth = 24;

    // 画像ロード後にアスペクト比を反映
    this.characterImage.onload = () => {
      this.imageLoaded = true;
      if (this.characterImage.naturalHeight > 0) {
        const aspect =
          this.characterImage.naturalWidth / this.characterImage.naturalHeight;
        this.charHalfWidth = (this.charSize * aspect) / 2;
      }
    };

    // 状態
    this.state = "intro"; // "intro" | "landing_wait" | "playing" | "gameover"
    this.lastTime = null;
    this.introStartTime = null;
    this.landingStartTime = null;
    this.rafId = null;

    // 進行
    this.depthMeters = 0;
    // スタート時の初速をこれまでより 1.5 倍程度に強化
    this.scrollSpeedBase = 220 * 1.95; // px/sec
    // 500m 到達時に到達したい最高速度の目安（base の約3倍弱）
    this.scrollSpeedMax = 640;
    this.depthAtMaxSpeed = 500; // 500m で最大速度に到達
    // 水深の進み方をよりじっくりにするため係数を 1/5 に調整
    this.depthPerPixel = 0.01; // 1px 進むごとに 0.01m
    this.bgOffset = 0;
    this.horizonY = 0; // 地平線（地面）の Y 座標

    // 入力状態
    this.pointerDown = false;
    this.pointerDir = 0; // -1: left, 1: right
    this.keyLeft = false;
    this.keyRight = false;
    this.horizontalDir = 0;
    // 左右移動スピードをさらに 1.3 倍強化
    this.horizontalSpeed = 220 * 1.44 * 1.3; // px/sec

    // 障害物・アイテム
    this.bombs = [];
    this.beers = [];
    this.bombRadius = 18 * 0.5;
    // ロブスターアイテムの当たり判定半径（表示サイズ 2倍に合わせて拡大）
    this.beerRadius = 16 * 0.5 * 2;
    // 無敵アイテム（ロブスター）の画像アセット
    this.lobsterImage = new Image();
    this.lobsterImageLoaded = false;
    this.lobsterImage.src = "./ロブスター.png";
    this.lobsterImage.onload = () => {
      this.lobsterImageLoaded = true;
    };
    // 爆弾（魚雷）の出現率：従来比 1.5 倍
    this.bombSpawnRatePerSec = 1.2 * 1.5; // 秒あたり出現期待値
    this.beerSpawnRatePerSec = 0.25;

    // 無敵
    this.invincibleUntil = 0;
    this.boostUntil = 0; // 掘削開始直後のブースト時間

    // パーティクル
    this.dustParticles = []; // 土煙
    this.sparkParticles = []; // 火花
    this.bubbleParticles = []; // ビールの泡
    this.invincibleTrailParticles = []; // 無敵オーブの残像

    // 効果音（ドリル音はシンプルな Audio オブジェクトで再生）
    this.drillSound = null;
    this.explosionSound = null;
    this.landingSound = (() => {
      const a = new Audio("./着地音.mp3");
      a.loop = false;
      a.volume = 0.05;
      return a;
    })();
    this.invincibleSound = null;
    // ドリル音の最大ボリューム（以前の 1.5 倍に増幅）
    this.drillMaxVolume = 0.03;
    this.drillFadeDurationMs = 100;
    this._drillFadeRafId = null;

    // 降下（intro）用の重力
    this.introVelocityY = 0;
    this.GRAVITY_INTRO = 480; // px/s^2（地球の重力をイメージ）

    // マイルストーン演出は廃止（深度テキストのみ維持）

    // 爆発演出
    this.explosion = null; // { x, y, startTime, duration }

    // 無敵中の爆弾ブースト（2秒2倍速→2秒かけて通常へ）
    this.bombBoostStartTime = 0;

    // マイルストーン用フラッシュ・シェイク
    this.screenFlashUntil = 0;
    this.screenShakeUntil = 0;
    this.screenShakeOffsetX = 0;
    this.screenShakeOffsetY = 0;

    // バインド
    this._loop = this._loop.bind(this);
    this._handleResize = this._handleResize.bind(this);
    this._onPress = this._onPress.bind(this);
    this._onRelease = this._onRelease.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);

    console.log("[BOOT] G2. PurpleDiverGame コンストラクタ完了");
  }

  start() {
    console.log("[BOOT] G3. start() 呼び出し");
    this._setupCanvasSize();
    window.addEventListener("resize", this._handleResize);
    this._setupControls();

    this.state = "intro";
    this.introStartTime = null;
    this.landingStartTime = null;
    this.introVelocityY = 0;
    this.depthMeters = 0;
    this.bombs = [];
    this.beers = [];
    this.dustParticles = [];
    this.sparkParticles = [];
    this.bubbleParticles = [];
    this.invincibleTrailParticles = [];
    // マイルストーン演出は廃止（深度テキストのみ維持）
    this.invincibleUntil = 0;
    this.boostUntil = 0;
    this.bombBoostStartTime = 0;
    this.screenFlashUntil = 0;
    this.screenShakeUntil = 0;
    this.bgOffset = 0;
    this.lastTime = null;

    // 効果音を念のため停止
    this._stopDrillSound();
    // GAME START クリック直後の処理として、効果音をまとめて準備（preload）する
    this._prepareDrillSound();
    if (this.landingSound) this.landingSound.load();

    // 爆発音の事前読み込み
    if (!this.explosionSound) {
      this.explosionSound = new Audio("./爆発音.mp3");
      this.explosionSound.loop = false;
      this.explosionSound.volume = 0.5;
    }
    this.explosionSound.load();

    // 無敵音の事前読み込み
    if (!this.invincibleSound) {
      this.invincibleSound = new Audio("./無敵音.mp3");
      this.invincibleSound.loop = false;
      this.invincibleSound.volume = 0.04;
    }
    this.invincibleSound.load();

    if (this.depthLabelEl) this.depthLabelEl.textContent = "0";

    console.log("[BOOT] G4. requestAnimationFrame(_loop) を登録");
    this.rafId = requestAnimationFrame(this._loop);
  }

  destroy() {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener("resize", this._handleResize);
    this._teardownControls();
    this._stopDrillSound();
  }

  get isInvincible() {
    return performance.now() < this.invincibleUntil;
  }

  _handleResize() {
    this._setupCanvasSize();
  }

  _setupCanvasSize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.logicalWidth = rect.width;
    this.logicalHeight = rect.height;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.charSize = Math.max(
      32,
      Math.min(this.logicalWidth, this.logicalHeight) * 0.12
    );

    // 画像のアスペクト比に応じて幅を再計算
    if (this.imageLoaded && this.characterImage.naturalHeight > 0) {
      const aspect =
        this.characterImage.naturalWidth / this.characterImage.naturalHeight;
      this.charHalfWidth = (this.charSize * aspect) / 2;
    } else {
      this.charHalfWidth = this.charSize / 2;
    }

    // キャラクター固定位置を中央より上（0.4）にし、視界を確保
    this.targetCharY = this.logicalHeight * 0.4;
    this.horizonY = this.targetCharY + this.charSize / 2;

    if (this.state === "intro") {
      this.charX = this.logicalWidth / 2;
      this.charY = -this.charSize;
    } else {
      this.charX = this.logicalWidth / 2;
      this.charY = this.targetCharY;
    }
  }

  _setupControls() {
    const target = this.canvas;

    target.addEventListener("mousedown", this._onPress);
    window.addEventListener("mouseup", this._onRelease);

    target.addEventListener("touchstart", this._onPress, { passive: false });
    window.addEventListener("touchend", this._onRelease);
    window.addEventListener("touchcancel", this._onRelease);

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
  }

  _teardownControls() {
    const target = this.canvas;

    target.removeEventListener("mousedown", this._onPress);
    window.removeEventListener("mouseup", this._onRelease);

    target.removeEventListener("touchstart", this._onPress);
    window.removeEventListener("touchend", this._onRelease);
    window.removeEventListener("touchcancel", this._onRelease);

    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
  }

  _onPress(ev) {
    if (this.state !== "playing") {
      ev.preventDefault?.();
      return;
    }

    ev.preventDefault?.();
    const x = this._getClientX(ev);
    if (x == null) return;

    const rect = this.canvas.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;

    this.pointerDown = true;
    this.pointerDir = x < mid ? -1 : 1;
    this._syncHorizontalDir();
  }

  _onRelease() {
    this.pointerDown = false;
    this.pointerDir = 0;
    this._syncHorizontalDir();
  }

  _getClientX(ev) {
    if (ev.touches && ev.touches.length > 0) {
      return ev.touches[0].clientX;
    }
    if (ev.changedTouches && ev.changedTouches.length > 0) {
      return ev.changedTouches[0].clientX;
    }
    if (typeof ev.clientX === "number") {
      return ev.clientX;
    }
    return null;
  }

  _onKeyDown(ev) {
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      ev.preventDefault();
    } else {
      return;
    }

    if (this.state !== "playing") {
      return;
    }

    if (ev.key === "ArrowLeft") {
      this.keyLeft = true;
    } else if (ev.key === "ArrowRight") {
      this.keyRight = true;
    }
    this._syncHorizontalDir();
  }

  _onKeyUp(ev) {
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      ev.preventDefault();
    } else {
      return;
    }

    if (ev.key === "ArrowLeft") {
      this.keyLeft = false;
    } else if (ev.key === "ArrowRight") {
      this.keyRight = false;
    }
    this._syncHorizontalDir();
  }

  _syncHorizontalDir() {
    if (this.pointerDown && this.pointerDir !== 0) {
      this.horizontalDir = this.pointerDir;
    } else if (this.keyLeft && !this.keyRight) {
      this.horizontalDir = -1;
    } else if (this.keyRight && !this.keyLeft) {
      this.horizontalDir = 1;
    } else {
      this.horizontalDir = 0;
    }
  }

  _loop(timestamp) {
    if (this.lastTime == null) {
      console.log("[BOOT] G5. _loop 初回フレーム到達");
      this.lastTime = timestamp;
      this.introStartTime = timestamp;
      this._renderIntro(0);
      this.rafId = requestAnimationFrame(this._loop);
      return;
    }

    // 経過時間（秒）。急激なフレーム落ち時のスパイクを抑えるため上限を設ける
    const rawDt = (timestamp - this.lastTime) / 1000;
    const dt = Math.min(rawDt, 1 / 30); // 最大でも約 33ms 分として扱う
    this.lastTime = timestamp;

    if (this.state === "intro") {
      this._updateIntro(dt);
      this._renderIntro(
        (timestamp - this.introStartTime) / 1000
      );
      this.rafId = requestAnimationFrame(this._loop);
      return;
    }

    if (this.state === "landing_wait") {
      // 着地後のウェイト中：スクロールや深度更新は行わず、静止した状態を描画
      if (this.landingStartTime == null) {
        this.landingStartTime = timestamp;
      }
      const elapsedWait = (timestamp - this.landingStartTime) / 1000;

      // 着地後の静止シーンを描画（現在位置のまま）
      this._renderLanding();

      // 約1秒待機したら掘削（playing）へ移行
      if (elapsedWait >= 1.0) {
        this.state = "playing";
        console.log("[BOOT] G6. state=playing に遷移（掘削開始）");
        this._startDrillSound();
        this.depthMeters = 0;
        this.bombs = [];
        this.beers = [];
        this.dustParticles = [];
        this.sparkParticles = [];
        this.bubbleParticles = [];
        this.bgOffset = 0;
        this.invincibleUntil = 0;
        this.boostUntil = performance.now() + 100; // 掘削開始直後の軽いブースト
        if (this.depthLabelEl) this.depthLabelEl.textContent = "0";
      }

      this.rafId = requestAnimationFrame(this._loop);
      return;
    }

    if (this.state === "playing") {
      this._updatePlaying(dt);
      this._renderPlaying(timestamp);
      this.rafId = requestAnimationFrame(this._loop);
      return;
    }

    if (this.state === "exploding") {
      this._renderExploding(timestamp);
      this.rafId = requestAnimationFrame(this._loop);
      return;
    }

    // gameover は最後のフレームを描画済みなのでループ停止
  }

  _updateIntro(dt) {
    const startY = -this.charSize;
    const endY = this.targetCharY;

    this.charX = this.logicalWidth / 2;

    // 重力に従った加速度運動（初速0、毎フレーム加速度を加算）
    this.introVelocityY += this.GRAVITY_INTRO * dt;
    this.charY += this.introVelocityY * dt;

    // 地面（緑のライン）に到達した瞬間
    if (this.charY >= endY) {
      this.charY = endY;
      this.state = "landing_wait";
      this.landingStartTime = null; // 次フレームで初期化
      this._playLandingSound(); // 着地音を一度だけ再生
    }
  }

  _updatePlaying(dt) {
    // スクロール速度：深さに応じて 50m ごとに段階的に加速し、500m で最大速度に到達
    const cappedDepthForSpeed = Math.min(this.depthMeters, this.depthAtMaxSpeed); // 0〜500m
    const steps = cappedDepthForSpeed / 50; // 50m ごとに 1 ステップ（0〜10）
    const speedRange = this.scrollSpeedMax - this.scrollSpeedBase;
    const perStep = speedRange / (this.depthAtMaxSpeed / 50 || 1); // 500m / 50m = 10 ステップ前提
    let speed = this.scrollSpeedBase + perStep * steps;
    speed = Math.min(speed, this.scrollSpeedMax); // 上限でキャップ

    // 掘削開始直後のブースト
    if (performance.now() < this.boostUntil) {
      speed *= 1.6;
    }

    // 無敵中の爆弾ブースト：最初2秒2倍速、続く2秒で滑らかに通常へ
    if (this.bombBoostStartTime > 0) {
      const elapsed = (performance.now() - this.bombBoostStartTime) / 1000;
      if (elapsed >= 4) {
        this.bombBoostStartTime = 0;
      } else if (elapsed < 2) {
        speed *= 2;
      } else {
        const t = (elapsed - 2) / 2;
        speed *= 2 - t;
      }
    }

    // 深度更新
    this.depthMeters += speed * dt * this.depthPerPixel;
    if (this.depthLabelEl) {
      this.depthLabelEl.textContent = Math.floor(this.depthMeters).toString();
    }

    // 背景オフセット
    this.bgOffset = (this.bgOffset + speed * dt) % this.logicalHeight;

    // プレイヤーの左右移動
    if (this.horizontalDir !== 0) {
      this.charX += this.horizontalDir * this.horizontalSpeed * dt;
    }

    // 画面ループ（シームレス）: 画像が完全に画面外に出たときだけ座標を正規化
    const W = this.logicalWidth;
    const CHAR_HALF_W = this.charHalfWidth ?? this.charSize / 2;
    while (this.charX + CHAR_HALF_W < 0) {
      this.charX += W;
    }
    while (this.charX - CHAR_HALF_W > W) {
      this.charX -= W;
    }

    // 障害物・アイテムの生成
    this._spawnEntities(dt);

    // パーティクル更新
    this._updateDustParticles(dt, speed);
    this._updateSparkParticles(dt, speed);
    this._updateBubbleParticles(dt);
    this._updateInvincibleTrailParticles(dt);

    // 移動（上方向へスクロール）＋魚雷の横移動
    const deltaY = -speed * dt;
    this.bombs.forEach((b) => {
      b.y += deltaY;
      const vx = typeof b.vx === "number" ? b.vx : 0;
      if (vx !== 0) {
        b.x += vx * dt;
        // 画面端でのバウンド
        if (b.x - b.radius < 0) {
          b.x = b.radius;
          b.vx = -vx;
        } else if (b.x + b.radius > W) {
          b.x = W - b.radius;
          b.vx = -vx;
        }
      }
    });
    this.beers.forEach((b) => {
      b.y += deltaY;
    });
    this.dustParticles.forEach((p) => {
      p.y += deltaY;
    });
    this.sparkParticles.forEach((p) => {
      p.y += deltaY;
    });

    // 地平線も同じ速度で上にスクロール
    this.horizonY += deltaY;

    // 画面外を削除
    this.bombs = this.bombs.filter((b) => b.y + b.radius > 0);
    this.beers = this.beers.filter((b) => b.y + b.radius > 0);
    this.dustParticles = this.dustParticles.filter(
      (p) => p.life < p.lifeMax && p.y + p.size > 0
    );
    this.sparkParticles = this.sparkParticles.filter(
      (p) => p.life < p.lifeMax && p.y + p.size > 0
    );

    // 当たり判定
    this._handleCollisions();
  }

  _spawnEntities(dt) {
    if (Math.random() < this.bombSpawnRatePerSec * dt) {
      // 魚雷の生成：100m 以上では横移動速度を付与（深さごとに 1.2 倍スケーリング）
      let vx = 0;
      if (this.depthMeters >= 100) {
        // ベース横速度を従来の 50%（0.25倍）に抑えて回避余地を確保
        const baseVx = this.scrollSpeedBase * 0.25; // 100m 時点の基準横速度
        const steps = Math.max(0, Math.floor((this.depthMeters - 100) / 100)); // 100m ごとに増加
        const scale = Math.pow(1.2, steps);
        const dir = Math.random() < 0.5 ? -1 : 1;
        vx = dir * baseVx * scale;
      }

      this.bombs.push({
        x: Math.random() * this.logicalWidth,
        y: this.logicalHeight + this.bombRadius * 2,
        radius: this.bombRadius,
        vx,
      });
    }

    if (Math.random() < this.beerSpawnRatePerSec * dt) {
      this.beers.push({
        x: Math.random() * this.logicalWidth,
        y: this.logicalHeight + this.beerRadius * 2,
        radius: this.beerRadius,
      });
    }
  }

  _handleCollisions() {
    const W = this.logicalWidth;
    const cx = this.charX;
    const cy = this.charY;
    // 当たり判定用の矩形（キャラ幅・高さを考慮）
    const rw = this.charSize * 0.7;
    const rh = this.charSize * 0.9;
    const baseRx = cx - rw / 2;
    const ry = cy - rh / 2;

    // 本体＋ループ時のゴースト分も含めた当たり判定矩形（デュアル描画と一致）
    const rects = [{ rx: baseRx, ry }];
    if (baseRx < 0) {
      rects.push({ rx: baseRx + W, ry }); // 左にはみ出し → 右側ゴースト
    }
    if (baseRx + rw > W) {
      rects.push({ rx: baseRx - W, ry }); // 右にはみ出し → 左側ゴースト
    }

    // ビール取得（無敵）
    this.beers = this.beers.filter((beer) => {
      const hitAny = rects.some(({ rx, ry }) =>
        this._circleRectIntersect(beer.x, beer.y, beer.radius, rx, ry, rw, rh)
      );
      if (hitAny) {
        this.invincibleUntil = performance.now() + 5000;
        this._playInvincibleSound();
        return false;
      }
      return true;
    });

    // 爆弾判定
    let hitBomb = null;
    this.bombs = this.bombs.filter((bomb) => {
      const hit = rects.some(({ rx, ry }) =>
        this._circleRectIntersect(
          bomb.x,
          bomb.y,
          bomb.radius,
          rx,
          ry,
          rw,
          rh
        )
      );
      if (hit) {
        if (this.isInvincible) {
          this.bombBoostStartTime = performance.now();
          return false; // 無敵中はすり抜け（破壊）＋ブースト発動
        } else {
          if (!hitBomb) {
            hitBomb = { x: bomb.x, y: bomb.y };
          }
          return false;
        }
      }
      return true;
    });

    if (hitBomb) {
      this._startExplosion(hitBomb);
    }
  }

  _circleRectIntersect(cx, cy, radius, rx, ry, rw, rh) {
    const closestX = Math.max(rx, Math.min(cx, rx + rw));
    const closestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy <= radius * radius;
  }

  _triggerGameOver() {
    this.state = "gameover";
    this._renderPlaying(performance.now(), true);

    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this._teardownControls();
    window.removeEventListener("resize", this._handleResize);

    // 掘削効果音を停止
    this._stopDrillSound();

    if (typeof this.onGameOver === "function") {
      this.onGameOver(this.depthMeters);
    }
  }

  _renderIntro(elapsed) {
    const w = this.logicalWidth;
    const h = this.logicalHeight;

    this.ctx.clearRect(0, 0, w, h);
    // intro 中は地平線固定の背景
    this._renderBackgroundWithHorizon(this.horizonY);

    // ループ描画で左右端を繋げるキャラクター
    this._drawWrappedCharacter(this.charX, this.charY, false, 0);
  }

  _renderLanding() {
    const w = this.logicalWidth;
    const h = this.logicalHeight;

    this.ctx.clearRect(0, 0, w, h);
    // 着地後も現在の地平線位置とキャラクター位置で静止描画
    this._renderBackgroundWithHorizon(this.horizonY);
    this._drawWrappedCharacter(this.charX, this.charY, false, 0);
  }

  _drawCloud(cx, cy, baseR) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.beginPath();
    ctx.arc(cx - baseR * 0.6, cy, baseR * 0.75, 0, Math.PI * 2);
    ctx.arc(cx, cy - baseR * 0.25, baseR, 0, Math.PI * 2);
    ctx.arc(cx + baseR * 0.8, cy, baseR * 0.85, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _renderBackgroundWithHorizon(groundY) {
    const ctx = this.ctx;
    const w = this.logicalWidth;
    const h = this.logicalHeight;
    const d = this.depthMeters;

    // 海中のベースグラデーション（0m では明るい水色、深くなるほど藍色へ）
    const maxDepthForColor = 4000;
    const t = Math.max(0, Math.min(1, d / maxDepthForColor));

    const surfaceTop = "#e4fbff";   // 水面付近のまぶしい水色
    const surfaceMid = "#4fd1ff";   // ビビッドなライトブルー
    const midBlue    = "#0077be";   // 中層の青
    const deepIndigo = "#050526";   // 深海の藍色

    const midBlend    = lerpColorHex(surfaceMid, midBlue, t * 0.6);
    const bottomBlend = lerpColorHex(midBlue, deepIndigo, t);

    const waterGrad = ctx.createLinearGradient(0, 0, 0, h);
    waterGrad.addColorStop(0.0, surfaceTop);
    waterGrad.addColorStop(0.12, surfaceMid);
    waterGrad.addColorStop(0.5, midBlend);
    waterGrad.addColorStop(1.0, bottomBlend);
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, 0, w, h);

    // 水中のゆらめきノイズ（柔らかい光の揺らぎ）
    const noiseSeed = ((this.bgOffset * 1.2) | 0) % 100000;
    const rnd = seededNoise(noiseSeed);
    ctx.save();
    ctx.globalAlpha = 0.08;
    for (let nx = 0; nx < w; nx += 8) {
      for (let ny = 0; ny < h; ny += 8) {
        const v = rnd();
        const alpha = v > 0.5 ? 0.22 : 0.12;
        ctx.fillStyle =
          v > 0.5
            ? `rgba(255, 255, 255, ${alpha})`
            : `rgba(0, 40, 80, ${alpha * 0.7})`;
        ctx.fillRect(nx, ny, 4, 4);
      }
    }
    ctx.restore();

    // 上部の海面表現（波とハイライト）
    this._drawSeaSurface(w, h, groundY, d);

    // 深くなるほど周辺光量を落とす
    this._drawVignette(w, h, d);
  }

  _drawSeaSurface(w, h, groundY, depth) {
    const ctx = this.ctx;
    // 地平線（元の地面）位置を基準に、画面上側に少しオフセットした位置を海面とみなす。
    // groundY はスクロールとともに変化するため、海面もプレイヤーの潜行に合わせて
    // 画面外へ上方向に流れていく。
    const baseY = groundY - this.logicalHeight * 0.4;
    // 完全に画面の下に沈んだ、あるいは十分上に抜けた場合は描画しない
    if (baseY > h + 40 || baseY < -80) {
      return;
    }
    const waveAmp = 6;
    const waveLen = 80;
    const t = performance.now() * 0.001;

    ctx.save();

    // 水面付近の強いハイライト
    const surfTop = Math.max(0, baseY - 30);
    const surfBottom = Math.max(0, baseY);
    const surfGrad = ctx.createLinearGradient(0, surfTop, 0, surfBottom);
    surfGrad.addColorStop(0, "rgba(255,255,255,0.95)");
    surfGrad.addColorStop(0.4, "rgba(224,248,255,0.9)");
    surfGrad.addColorStop(1, "rgba(180,232,255,0.0)");
    ctx.fillStyle = surfGrad;
    ctx.fillRect(0, surfTop, w, Math.max(0, surfBottom - surfTop));

    // 波打ち際の輪郭（さざ波）
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (let x = 0; x <= w + waveLen; x += 8) {
      const y =
        baseY +
        Math.sin((x / waveLen) * Math.PI * 2 + t * 1.2) *
          waveAmp *
          (0.8 + 0.2 * Math.sin(t + x * 0.01));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fill();

    ctx.restore();
  }

  _drawSunWithBloom(sunX, sunY, baseR, w, skyH) {
    const ctx = this.ctx;
    const outerR = baseR * 3.5;
    const grad = ctx.createRadialGradient(
      sunX, sunY, 0,
      sunX, sunY, outerR
    );
    grad.addColorStop(0, "rgba(255,255,255,0.98)");
    grad.addColorStop(0.12, "rgba(255,250,220,0.95)");
    grad.addColorStop(0.35, "rgba(255,200,100,0.6)");
    grad.addColorStop(0.6, "rgba(255,150,50,0.2)");
    grad.addColorStop(1, "rgba(255,180,80,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sunX, sunY, outerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // レンズフレア風の光条
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255,230,180,0.8)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + performance.now() * 0.0001;
      const len = baseR * (2 + (i % 2) * 0.5);
      ctx.beginPath();
      ctx.moveTo(sunX + Math.cos(a) * baseR * 0.5, sunY + Math.sin(a) * baseR * 0.5);
      ctx.lineTo(sunX + Math.cos(a) * len, sunY + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawVignette(w, h, depth) {
    const ctx = this.ctx;
    const strength = Math.min(0.45, 0.15 + (depth / 2000) * 0.3);
    const vig = ctx.createRadialGradient(
      w / 2, h / 2, 0,
      w / 2, h / 2, Math.max(w, h) * 0.75
    );
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(0.6, "rgba(0,0,0,0)");
    vig.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.save();
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // _drawInvincibleWaveOverlay は無敵エフェクト簡素化のため削除（キャラ周りのオーラのみ維持）

  _renderPlaying(timestamp, isFinalFrame = false) {
    const ctx = this.ctx;
    const w = this.logicalWidth;
    const h = this.logicalHeight;

    ctx.clearRect(0, 0, w, h);

    // 空 → 地面 → 地中がシームレスにスクロールする背景
    this._renderBackgroundWithHorizon(this.horizonY);

    // 爆弾
    this.bombs.forEach((bomb) => {
      this._drawBomb(bomb, timestamp);
    });

    // ビール
    this.beers.forEach((beer) => {
      this._drawBeer(beer, timestamp);
    });

    // パーティクル
    this._drawDustParticles();
    this._drawSparkParticles();
    this._drawBubbleParticles();
    this._drawInvincibleTrailParticles();

    // キャラクターと無敵オーラ（左右端ループ描画）
    const inv = this.isInvincible;
    this._drawWrappedCharacter(this.charX, this.charY, inv, timestamp);

    // 無敵時も画面全体の追加エフェクトは描かず、キャラ周りのオーラのみ表示

    if (this.state === "gameover" && isFinalFrame) {
      ctx.fillStyle = "rgba(255,64,96,0.25)";
      ctx.fillRect(0, 0, w, h);
    }
  }

  _startExplosion(hitBomb) {
    if (this.state !== "playing") return;

    this._stopDrillSound();

    this.state = "exploding";
    this.explosion = {
      x: hitBomb.x,
      y: hitBomb.y,
      startTime: performance.now(),
      duration: 1000,
    };

    // 爆発音を再生
    this._playExplosionSound();

    // 入力・移動を停止
    this.pointerDown = false;
    this.pointerDir = 0;
    this.keyLeft = false;
    this.keyRight = false;
    this.horizontalDir = 0;
  }

  _renderExploding(timestamp) {
    const ctx = this.ctx;
    if (!this.explosion) {
      this._triggerGameOver();
      return;
    }

    const w = this.logicalWidth;
    const h = this.logicalHeight;

    // 直前の状態を維持したまま描画
    this._renderPlaying(timestamp);

    const elapsed = timestamp - this.explosion.startTime;
    const t = Math.max(0, Math.min(1, elapsed / this.explosion.duration));

    // 花火風パーティクルを初回に生成（大きく・派手に）
    if (!this.explosion.particles) {
      const colors = ["233, 213, 255", "250, 204, 21", "249, 115, 22", "96, 165, 250"];
      const count = 200; // 以前より約2.5倍
      const particles = [];
      for (let i = 0; i < count; i++) {
        const angle = (Math.random() * Math.PI * 2);
        // 速度レンジを拡大して広い範囲に飛び散る
        const speed = this.charSize * (5 + Math.random() * 6);
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        const color = colors[i % colors.length]; // "r,g,b"
        const lifeMax = 1.0;
        particles.push({
          x: this.explosion.x,
          y: this.explosion.y,
          vx,
          vy,
          life: 0,
          lifeMax,
          color,
        });
      }
      this.explosion.particles = particles;
    }

    const dt = this.lastTime ? 0 : 0; // 実際の移動は life から計算するので簡略化

    // パーティクル更新（重力でやや下に落ちる）
    const grav = this.charSize * 10;
    this.explosion.particles.forEach((p) => {
      const lifeT = t; // 全体進行で近似
      const decay = 1 - lifeT;
      // 時間に対する移動スケールを増やして画面全体に広げる
      p.x = this.explosion.x + p.vx * lifeT * 0.08;
      p.y = this.explosion.y + p.vy * lifeT * 0.08 + 0.5 * grav * (lifeT * lifeT) * 0.0006;
      p.life = lifeT * p.lifeMax;
      p.alpha = decay;
    });

    ctx.save();

    // 画面全体をわずかに暗く
    ctx.fillStyle = `rgba(0,0,0,${0.25 * t})`;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = "lighter";
    this.explosion.particles.forEach((p) => {
      const alpha = Math.max(0, Math.min(1, p.alpha ?? 1));
      // 爆発の光のサイズも拡大
      const r = this.charSize * 0.14;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `rgba(${p.color}, ${alpha})`);
      grad.addColorStop(1, `rgba(${p.color}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();

    if (elapsed >= this.explosion.duration) {
      this._triggerGameOver();
    }
  }

  _drawCharacter(x, y, invincible) {
    const ctx = this.ctx;
    const size = this.charSize;
    const aspect =
      this.imageLoaded && this.characterImage.naturalHeight > 0
        ? this.characterImage.naturalWidth / this.characterImage.naturalHeight
        : 1;
    const drawH = size;
    const drawW = size * aspect;
    const halfW = drawW / 2;
    const halfH = drawH / 2;

    ctx.save();
    if (this.imageLoaded) {
      ctx.drawImage(
        this.characterImage,
        x - halfW,
        y - halfH,
        drawW,
        drawH
      );
    } else {
      const radius = size / 2;
      ctx.fillStyle = "#9b5cff";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 深度が深くなるほどドリル先端を赤く発光
    const intensity = Math.max(0, Math.min(1, (this.depthMeters - 800) / 2000));
    if (intensity > 0) {
      const tipY = y + size * 0.4;
      const tipX = x;
      const glowR = size * (0.25 + 0.15 * intensity);
      const grad = ctx.createRadialGradient(
        tipX,
        tipY,
        0,
        tipX,
        tipY,
        glowR
      );
      grad.addColorStop(0, `rgba(248, 113, 113, ${0.3 + 0.4 * intensity})`);
      grad.addColorStop(1, "rgba(248, 113, 113, 0)");
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(tipX, tipY, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _drawInvincibleAura(x, y, timestamp) {
    const ctx = this.ctx;
    const baseRadius = this.charSize * 1.0;
    const t = timestamp / 700; // ベースとなる時間

    // 脈動するスケールと回転スピード
    const pulse = 0.9 + 0.15 * Math.sin(t * 2 * Math.PI);
    const spinFast = t * 2.8 * Math.PI;
    const spinSlow = t * 1.6 * Math.PI;

    // 座標系を変更せず、必ず save/restore で元に戻す（ズレ防止）
    ctx.save();
    try {
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = "rgba(250, 250, 210, 0.95)";
      ctx.shadowBlur = this.charSize * 0.8;

      // 原子モデル風の複数オービット（基準点は常にプレイヤー中心 x,y、translate は使わない）
      const orbits = [
        { tilt: 0, speedAngle: spinFast, radiusMul: 1.0 },
        { tilt: Math.PI / 3, speedAngle: spinSlow, radiusMul: 1.1 },
        { tilt: -Math.PI / 4, speedAngle: -spinFast * 0.75, radiusMul: 0.85 },
      ];

      orbits.forEach((orbit, idx) => {
        const radius = baseRadius * orbit.radiusMul * pulse;
        const thickness = this.charSize * (0.06 + 0.015 * idx);
        const cosT = Math.cos(orbit.tilt);
        const sinT = Math.sin(orbit.tilt);

        const grad = ctx.createLinearGradient(
          x - radius,
          y,
          x + radius,
          y
        );
        grad.addColorStop(0, "rgba(253, 224, 71, 0)");
        grad.addColorStop(0.5, "rgba(250, 204, 21, 0.9)");
        grad.addColorStop(1, "rgba(253, 224, 71, 0)");

        ctx.strokeStyle = grad;
        ctx.lineWidth = thickness;
        ctx.beginPath();

        // 弧を絶対座標で描画（translate/rotate を使わず座標系を変えない）
        const segCount = 3;
        for (let i = 0; i < segCount; i++) {
          const start = orbit.speedAngle + ((i * 2 * Math.PI) / segCount) * 0.9;
          const end = start + (Math.PI * 0.55);
          for (let a = start; a <= end; a += (end - start) / 24) {
            const lx = Math.cos(a) * radius;
            const ly = Math.sin(a) * radius;
            const wx = x + lx * cosT - ly * sinT;
            const wy = y + lx * sinT + ly * cosT;
            if (a === start) ctx.moveTo(wx, wy);
            else ctx.lineTo(wx, wy);
          }
        }
        ctx.stroke();

        const headAngle = orbit.speedAngle;
        const px = x + Math.cos(headAngle) * radius * cosT - Math.sin(headAngle) * radius * sinT;
        const py = y + Math.cos(headAngle) * radius * sinT + Math.sin(headAngle) * radius * cosT;
        this._emitInvincibleTrail(px, py, idx);
      });
    } finally {
      ctx.restore();
    }
  }

  _drawWrappedCharacter(x, y, invincible, timestamp) {
    const W = this.logicalWidth;
    const CHAR_HALF_W = this.charHalfWidth ?? this.charSize / 2;

    const remaining =
      this.invincibleUntil > 0
        ? (this.invincibleUntil - performance.now()) / 1000
        : 0;
    const isWarnFlash = invincible && remaining > 0 && remaining <= 2;
    const flashOn = !isWarnFlash || Math.floor(timestamp / 120) % 2 === 0;

    const drawAt = (px) => {
      if (invincible && flashOn) {
        this._drawInvincibleAura(px, y, timestamp);
      }
      this._drawCharacter(px, y, invincible);
    };

    // デュアル描画: 常に本体を描き、端をまたぐ時は反対側にゴーストも描画
    drawAt(x);
    if (x - CHAR_HALF_W < 0) {
      drawAt(x + W); // 左端にはみ出し → 右側にゴースト
    }
    if (x + CHAR_HALF_W > W) {
      drawAt(x - W); // 右端にはみ出し → 左側にゴースト
    }
  }

  _updateDustParticles(dt, speed) {
    const maxCount = 220;
    const emissionBase = 35;
    const emissionBySpeed = speed * 0.18;
    const emission = emissionBase + emissionBySpeed; // 1秒あたり
    const expected = emission * dt;
    const count = Math.floor(expected);
    const extra = expected - count;

    const spawnOne = () => {
      if (this.dustParticles.length > maxCount) return;
      const angle = (Math.random() - 0.5) * Math.PI * 0.45;
      const power = 40 + speed * 0.25 + Math.random() * 30;
      const vx = Math.cos(angle) * power;
      const vy = -Math.abs(Math.sin(angle) * power * 0.6);

      const size = this.charSize * (0.08 + Math.random() * 0.05);
      const life = 0;
      const lifeMax = 0.35 + Math.random() * 0.3;

      const tipX = this.charX;
      const tipY = this.charY + this.charSize * 0.45;

      this.dustParticles.push({
        x: tipX,
        y: tipY,
        vx,
        vy,
        life,
        lifeMax,
        size,
      });
    };

    for (let i = 0; i < count; i++) spawnOne();
    if (Math.random() < extra) spawnOne();

    this.dustParticles.forEach((p) => {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    });
  }

  _drawDustParticles() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    this.dustParticles.forEach((p) => {
      const t = p.life / p.lifeMax;
      const alpha = (1 - t) * 0.5;
      const r = p.size;

      const grad = ctx.createRadialGradient(
        p.x,
        p.y,
        0,
        p.x,
        p.y,
        r
      );
      grad.addColorStop(0, `rgba(220, 180, 120, ${alpha})`);
      grad.addColorStop(0.5, `rgba(139, 92, 46, ${alpha * 0.7})`);
      grad.addColorStop(1, "rgba(64, 37, 20, 0)");

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }

  _updateSparkParticles(dt, speed) {
    const maxCount = 180;
    const spawnOne = () => {
      if (this.sparkParticles.length > maxCount) return;
      const angle = (Math.random() - 0.5) * Math.PI * 0.55;
      const power = 120 + speed * 0.4 + Math.random() * 80;
      const vx = Math.cos(angle) * power;
      const vy = -Math.abs(Math.sin(angle) * power * 0.9);
      const size = this.charSize * (0.04 + Math.random() * 0.03);
      const lifeMax = 0.18 + Math.random() * 0.12;
      const tipX = this.charX;
      const tipY = this.charY + this.charSize * 0.42;
      this.sparkParticles.push({
        x: tipX,
        y: tipY,
        vx,
        vy,
        life: 0,
        lifeMax,
        size,
      });
    };

    const intensity = Math.max(0, Math.min(1, (this.depthMeters - 300) / 1500));
    if (intensity > 0.05) {
      const emission = (40 + speed * 0.25) * intensity;
      const expected = emission * dt;
      const count = Math.floor(expected);
      const extra = expected - count;
      for (let i = 0; i < count; i++) spawnOne();
      if (Math.random() < extra) spawnOne();
    }

    if (this.bombBoostStartTime > 0) {
      const elapsed = (performance.now() - this.bombBoostStartTime) / 1000;
      if (elapsed < 4) {
        for (let i = 0; i < 6; i++) spawnOne();
      }
    }

    this.sparkParticles.forEach((p) => {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    });
  }

  _drawSparkParticles() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    this.sparkParticles.forEach((p) => {
      const t = p.life / p.lifeMax;
      const alpha = (1 - t) * 0.95;
      const r = p.size * 1.2;
      const grad = ctx.createRadialGradient(
        p.x,
        p.y,
        0,
        p.x,
        p.y,
        r
      );
      grad.addColorStop(0, `rgba(255, 255, 220, ${alpha})`);
      grad.addColorStop(0.3, `rgba(253, 224, 71, ${alpha})`);
      grad.addColorStop(0.7, "rgba(251, 146, 60, 0.4)");
      grad.addColorStop(1, "rgba(251, 146, 60, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  _updateBubbleParticles(dt) {
    const nowInvincible = this.isInvincible;
    const maxCount = 80;
    if (nowInvincible) {
      const remaining = (this.invincibleUntil - performance.now()) / 1000;
      const intensity = Math.max(0.3, Math.min(1, remaining / 5));
      const emission = 35 * intensity;
      const expected = emission * dt;
      const count = Math.floor(expected);
      const extra = expected - count;

      const spawnOne = () => {
        if (this.bubbleParticles.length > maxCount) return;
        const x =
          this.charX + (Math.random() - 0.5) * this.charSize * 0.4;
        const y =
          this.charY +
          this.charSize * 0.2 +
          Math.random() * this.charSize * 0.2;
        const vy = -30 - Math.random() * 40;
        const size = this.charSize * (0.05 + Math.random() * 0.04);
        const lifeMax = 0.8 + Math.random() * 0.5;
        this.bubbleParticles.push({
          x,
          y,
          vy,
          life: 0,
          lifeMax,
          size,
        });
      };

      for (let i = 0; i < count; i++) spawnOne();
      if (Math.random() < extra) spawnOne();
    }

    this.bubbleParticles.forEach((p) => {
      p.life += dt;
      p.y += p.vy * dt;
    });
    this.bubbleParticles = this.bubbleParticles.filter(
      (p) => p.life < p.lifeMax && p.y + p.size > 0
    );
  }

  _emitInvincibleTrail(x, y, laneIndex) {
    const maxCount = 160;
    if (!this.isInvincible) return;
    if (this.invincibleTrailParticles.length > maxCount) return;

    const sizeBase = this.charSize * 0.04;
    const jitter = (laneIndex - 1) * this.charSize * 0.01;
    this.invincibleTrailParticles.push({
      x: x + jitter,
      y,
      life: 0,
      lifeMax: 0.4 + Math.random() * 0.25,
      size: sizeBase * (0.8 + Math.random() * 0.8),
    });
  }

  _updateInvincibleTrailParticles(dt) {
    this.invincibleTrailParticles.forEach((p) => {
      p.life += dt;
      // わずかに外側かつ上方向へ流れる残像
      p.y -= this.charSize * 0.25 * dt;
    });
    this.invincibleTrailParticles = this.invincibleTrailParticles.filter(
      (p) => p.life < p.lifeMax
    );
  }

  _drawInvincibleTrailParticles() {
    const ctx = this.ctx;
    if (!this.invincibleTrailParticles.length) return;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    this.invincibleTrailParticles.forEach((p) => {
      const t = p.life / p.lifeMax;
      const alpha = (1 - t) * 0.7;
      const r = p.size;

      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `rgba(250, 250, 210, ${alpha})`);
      grad.addColorStop(0.4, `rgba(253, 224, 71, ${alpha * 0.9})`);
      grad.addColorStop(1, "rgba(253, 224, 71, 0)");

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }

  /**
   * ドリル音のフェード（volume を durationMs かけて targetVolume へ）
   * @param {number} targetVolume 目標ボリューム（0〜1）
   * @param {number} durationMs フェード時間（ミリ秒）
   * @param {boolean} stopAtEnd true の場合、フェード完了時に pause()+reset する
   */
  _fadeDrillVolume(targetVolume, durationMs, stopAtEnd) {
    if (!this.drillSound) return;
    if (this._drillFadeRafId != null) {
      cancelAnimationFrame(this._drillFadeRafId);
      this._drillFadeRafId = null;
    }
    const startVol = this.drillSound.volume ?? 0;
    const delta = targetVolume - startVol;
    const startTime = performance.now();

    const step = (now) => {
      if (!this.drillSound) {
        this._drillFadeRafId = null;
        return;
      }
      const t = Math.min(1, (now - startTime) / durationMs);
      const vol = startVol + delta * t;
      this.drillSound.volume = vol;
      if (t < 1) {
        this._drillFadeRafId = requestAnimationFrame(step);
      } else {
        this._drillFadeRafId = null;
        this.drillSound.volume = targetVolume;
        if (stopAtEnd && targetVolume === 0) {
          try {
            this.drillSound.pause();
            this.drillSound.currentTime = 0;
          } catch (_e) {
            // noop
          }
        }
      }
    };

    this._drillFadeRafId = requestAnimationFrame(step);
  }

  _prepareDrillSound() {
    if (!this.drillSound) {
      this.drillSound = new Audio("./ドリル音.mp3");
      this.drillSound.loop = true;
      this.drillSound.volume = 0;
    }
    const timeoutId = setTimeout(() => {
      if (!this.drillSound || isNaN(this.drillSound.duration)) {
        const msg = "ドリル音.mp3 の読み込みが3秒以内に完了しませんでした。フォールバックでゲームを継続します。";
        console.warn(msg);
        if (typeof window !== "undefined" && typeof window.showGameError === "function") {
          window.showGameError(msg);
        }
      }
    }, 3000);
    this.drillSound.addEventListener(
      "canplaythrough",
      () => {
        clearTimeout(timeoutId);
      },
      { once: true }
    );
    this.drillSound.load();
  }

  _startDrillSound() {
    if (!this.drillSound) {
      this._prepareDrillSound();
    }
    try {
      // ボリューム0から再生し、短時間でフェードイン
      this.drillSound.volume = 0;
      this.drillSound.currentTime = 0;
      const p = this.drillSound.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {});
      }
      this._fadeDrillVolume(this.drillMaxVolume, this.drillFadeDurationMs, false);
    } catch (e) {
      console.error("ドリル音の再生に失敗しました:", e);
    }
  }

  _stopDrillSound() {
    if (!this.drillSound) return;
    // 現在の音量から0までフェードアウトし、終了時に停止
    this._fadeDrillVolume(0, this.drillFadeDurationMs, true);
  }

  _playExplosionSound() {
    try {
      if (!this.explosionSound) {
        this.explosionSound = new Audio("./爆発音.mp3");
        this.explosionSound.loop = false;
        this.explosionSound.volume = 0.2;
      }

      // ベースインスタンスからクローンを作り、毎回先頭から再生（重なりも許可）
      const node = this.explosionSound.cloneNode(true);
      node.currentTime = 0;
      node.volume = this.explosionSound.volume;
      const p = node.play();
      if (p && typeof p.catch === "function") {
        p.catch((err) => {
          console.error("爆発音の再生中にエラーが発生しました:", err);
        });
      }
    } catch (e) {
      console.error("爆発音の再生に失敗しました:", e);
    }
  }

  _playLandingSound() {
    if (!this.landingSound) return;
    try {
      this.landingSound.currentTime = 0;
      const p = this.landingSound.play();
      if (p && typeof p.catch === "function") {
        p.catch((err) => {
          console.error("着地音の再生中にエラーが発生しました:", err);
        });
      }
    } catch (e) {
      console.error("着地音の再生に失敗しました:", e);
    }
  }

  _playInvincibleSound() {
    try {
      if (!this.invincibleSound) {
        this.invincibleSound = new Audio("./無敵音.mp3");
        this.invincibleSound.loop = false;
        this.invincibleSound.volume = 0.04;
      }

      // 無敵音もクローンで重ねて再生できるようにする
      const node = this.invincibleSound.cloneNode(true);
      node.currentTime = 0;
      node.volume = this.invincibleSound.volume;
      const p = node.play();
      if (p && typeof p.catch === "function") {
        p.catch((err) => {
          console.error("無敵音の再生中にエラーが発生しました:", err);
        });
      }
    } catch (e) {
      console.error("無敵音の再生に失敗しました:", e);
    }
  }

  _drawBubbleParticles() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    this.bubbleParticles.forEach((p) => {
      const t = p.life / p.lifeMax;
      const alpha = (1 - t) * 0.7;
      const r = p.size;
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }

  // マイルストーン用の更新／描画ロジックは不要になったため削除済み

  _drawBomb(bomb, timestamp) {
    const ctx = this.ctx;
    const r = bomb.radius;
    ctx.save();

    // 魚雷ボディ（横長カプセル形状・黒々とした重厚メタル）
    const bodyLength = r * 3.8;
    const bodyRadius = r * 0.95;
    const centerX = bomb.x;
    const centerY = bomb.y;
    const leftX = centerX - bodyLength / 2;
    const rightX = centerX + bodyLength / 2;
    const topY = centerY - bodyRadius;
    const bottomY = centerY + bodyRadius;

    const bodyGrad = ctx.createLinearGradient(leftX, centerY, rightX, centerY);
    bodyGrad.addColorStop(0, "#020617");
    bodyGrad.addColorStop(0.25, "#111827");
    bodyGrad.addColorStop(0.55, "#020617");
    bodyGrad.addColorStop(0.9, "#0b1120");
    bodyGrad.addColorStop(1, "#000000");

    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(leftX, topY);
    ctx.lineTo(rightX, topY);
    ctx.arc(rightX, centerY, bodyRadius, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(leftX, bottomY);
    ctx.arc(leftX, centerY, bodyRadius, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();

    // ノーズ部分のハイライト（鈍い金属光沢）
    const noseGrad = ctx.createRadialGradient(
      rightX - bodyRadius * 0.3,
      centerY,
      0,
      rightX,
      centerY,
      bodyRadius * 1.3
    );
    noseGrad.addColorStop(0, "rgba(249, 250, 251, 0.7)");
    noseGrad.addColorStop(0.3, "rgba(148, 163, 184, 0.4)");
    noseGrad.addColorStop(1, "rgba(15, 23, 42, 0)");
    ctx.fillStyle = noseGrad;
    ctx.beginPath();
    ctx.arc(rightX - bodyRadius * 0.1, centerY, bodyRadius * 1.2, 0, Math.PI * 2);
    ctx.fill();

    // 後部フィン＆推進部
    const finWidth = bodyRadius * 1.4;
    const finHeight = bodyRadius * 1.6;

    // 後部の円筒推進部
    const tailRadius = bodyRadius * 0.9;
    const tailGrad = ctx.createLinearGradient(
      leftX - tailRadius * 2,
      centerY,
      leftX,
      centerY
    );
    tailGrad.addColorStop(0, "#000000");
    tailGrad.addColorStop(0.5, "#020617");
    tailGrad.addColorStop(1, "#111827");
    ctx.fillStyle = tailGrad;
    ctx.beginPath();
    ctx.arc(leftX, centerY, tailRadius, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.lineTo(leftX - tailRadius * 1.8, centerY - tailRadius * 0.6);
    ctx.lineTo(leftX - tailRadius * 1.8, centerY + tailRadius * 0.6);
    ctx.closePath();
    ctx.fill();

    // 上フィン（左右非対称でメカニカルな形状）
    ctx.fillStyle = "#020617";
    ctx.beginPath();
    ctx.moveTo(leftX - tailRadius * 0.2, centerY);
    ctx.lineTo(leftX - finWidth * 0.6, centerY - finHeight * 0.3);
    ctx.lineTo(leftX - finWidth * 0.1, centerY - finHeight * 0.9);
    ctx.closePath();
    ctx.fill();

    // 下フィン
    ctx.beginPath();
    ctx.moveTo(leftX - tailRadius * 0.2, centerY);
    ctx.lineTo(leftX - finWidth * 0.6, centerY + finHeight * 0.3);
    ctx.lineTo(leftX - finWidth * 0.1, centerY + finHeight * 0.9);
    ctx.closePath();
    ctx.fill();

    // 簡易プロペラブレード
    ctx.strokeStyle = "rgba(15,23,42,0.9)";
    ctx.lineWidth = bodyRadius * 0.28;
    ctx.beginPath();
    ctx.moveTo(leftX - tailRadius * 1.3, centerY - tailRadius * 0.4);
    ctx.lineTo(leftX - tailRadius * 1.65, centerY);
    ctx.lineTo(leftX - tailRadius * 1.3, centerY + tailRadius * 0.4);
    ctx.stroke();

    // 上面のパネルライン＆リベット
    ctx.strokeStyle = "rgba(31,41,55,0.9)";
    ctx.lineWidth = bodyRadius * 0.11;
    ctx.beginPath();
    ctx.moveTo(leftX + bodyRadius * 0.4, centerY - bodyRadius * 0.4);
    ctx.lineTo(rightX - bodyRadius * 0.8, centerY - bodyRadius * 0.2);
    ctx.stroke();

    const rivetCount = 6;
    ctx.fillStyle = "rgba(148,163,184,0.85)";
    for (let i = 0; i < rivetCount; i++) {
      const tR = (i + 0.7) / (rivetCount + 0.4);
      const rx = leftX + (rightX - leftX) * tR;
      const ry = centerY - bodyRadius * 0.32;
      ctx.beginPath();
      ctx.arc(rx, ry, bodyRadius * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }

    // 側面ラベル「DANGER」（ステンシル風に沈んだ文字）
    ctx.save();
    ctx.translate(centerX, centerY + bodyRadius * 0.15);
    ctx.rotate(-0.02);
    const labelFontSize = Math.floor(r * 0.65);
    ctx.font = `600 ${labelFontSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // 暗いプレート
    const platePaddingX = labelFontSize * 2.3;
    const platePaddingY = labelFontSize * 0.9;
    ctx.fillStyle = "rgba(15,23,42,0.96)";
    ctx.strokeStyle = "rgba(55,65,81,0.9)";
    ctx.lineWidth = bodyRadius * 0.12;
    ctx.beginPath();
    ctx.roundRect(-platePaddingX / 2, -platePaddingY / 2, platePaddingX, platePaddingY, bodyRadius * 0.3);
    ctx.fill();
    ctx.stroke();

    // ステンシル文字
    const gradText = ctx.createLinearGradient(-platePaddingX / 2, 0, platePaddingX / 2, 0);
    gradText.addColorStop(0, "#9ca3af");
    gradText.addColorStop(0.5, "#e5e7eb");
    gradText.addColorStop(1, "#6b7280");
    ctx.fillStyle = gradText;
    ctx.fillText("DANGER", 0, 0);

    ctx.restore();

    ctx.restore();
  }

  _drawBeer(beer, timestamp) {
    const ctx = this.ctx;
    const r = beer.radius;
    ctx.save();

    const cx = beer.x;
    const cy = beer.y;

    // 画像が読み込めていればローカルアセット「ロブスター.png」を使用
    if (this.lobsterImage && this.lobsterImageLoaded) {
      // 表示サイズを従来の 2 倍に拡大（幅・高さとも）
      const width = r * 3.0 * 2;
      const height = r * 2.0 * 2;
      ctx.drawImage(
        this.lobsterImage,
        cx - width / 2,
        cy - height / 2,
        width,
        height
      );
      ctx.restore();
      return;
    }

    // フォールバック：従来のベクターロブスター描画（非発光）
    const bodyLen = r * 3.0;
    const bodyRad = r * 1.1;
    const left = cx - bodyLen * 0.4;
    const right = cx + bodyLen * 0.6;

    const shellGrad = ctx.createLinearGradient(left, cy, right, cy);
    shellGrad.addColorStop(0, "#7f1d1d");
    shellGrad.addColorStop(0.4, "#b91c1c");
    shellGrad.addColorStop(0.7, "#ef4444");
    shellGrad.addColorStop(1, "#f97316");

    ctx.fillStyle = shellGrad;
    ctx.beginPath();
    ctx.moveTo(left, cy - bodyRad * 0.6);
    ctx.quadraticCurveTo(cx, cy - bodyRad * 1.1, right, cy - bodyRad * 0.3);
    ctx.quadraticCurveTo(
      right + bodyLen * 0.05,
      cy,
      right,
      cy + bodyRad * 0.3
    );
    ctx.quadraticCurveTo(cx, cy + bodyRad * 1.1, left, cy + bodyRad * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(248, 113, 113, 0.85)";
    ctx.lineWidth = r * 0.18;
    for (let i = -1; i <= 2; i++) {
      const t = (i + 1.8) / 4;
      const x = left + (right - left) * t;
      ctx.beginPath();
      ctx.moveTo(x, cy - bodyRad * 0.45);
      ctx.lineTo(x - r * 0.15, cy + bodyRad * 0.45);
      ctx.stroke();
    }

    const clawOffsetX = bodyLen * 0.55;
    const clawOffsetY = bodyRad * 0.3;
    const clawR = r * 0.9;

    const drawClaw = (sign) => {
      const baseX = cx + clawOffsetX;
      const baseY = cy + sign * clawOffsetY;
      const innerR = clawR * 0.4;

      const outerGrad = ctx.createLinearGradient(
        baseX,
        baseY - sign * clawR,
        baseX + clawR,
        baseY + sign * clawR
      );
      outerGrad.addColorStop(0, "#b91c1c");
      outerGrad.addColorStop(0.4, "#ef4444");
      outerGrad.addColorStop(1, "#f97316");
      ctx.fillStyle = outerGrad;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo(
        baseX + clawR * 0.35,
        baseY - sign * clawR * 0.55,
        baseX + clawR,
        baseY
      );
      ctx.quadraticCurveTo(
        baseX + clawR * 0.35,
        baseY + sign * clawR * 0.55,
        baseX,
        baseY
      );
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#7f1d1d";
      ctx.beginPath();
      ctx.moveTo(baseX - innerR * 0.4, baseY);
      ctx.quadraticCurveTo(
        baseX + innerR * 0.2,
        baseY - sign * innerR * 0.8,
        baseX + innerR * 0.9,
        baseY
      );
      ctx.quadraticCurveTo(
        baseX + innerR * 0.2,
        baseY + sign * innerR * 0.6,
        baseX - innerR * 0.4,
        baseY
      );
      ctx.closePath();
      ctx.fill();
    };
    drawClaw(-1);
    drawClaw(1);

    ctx.strokeStyle = "rgba(254, 242, 242, 0.9)";
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.moveTo(cx - bodyLen * 0.25, cy - bodyRad * 0.7);
    ctx.quadraticCurveTo(
      cx - bodyLen * 0.6,
      cy - bodyRad * 1.2,
      cx - bodyLen * 0.9,
      cy - bodyRad * 0.4
    );
    ctx.moveTo(cx - bodyLen * 0.1, cy - bodyRad * 0.7);
    ctx.quadraticCurveTo(
      cx - bodyLen * 0.5,
      cy - bodyRad * 1.5,
      cx - bodyLen * 0.95,
      cy - bodyRad * 0.8
    );
    ctx.stroke();

    ctx.strokeStyle = "rgba(248, 113, 113, 0.9)";
    ctx.lineWidth = r * 0.16;
    for (let i = 0; i < 4; i++) {
      const tLeg = (i + 0.7) / 4.5;
      const xLeg = left + (right - left) * tLeg;
      const legLen = r * 1.1;
      ctx.beginPath();
      ctx.moveTo(xLeg, cy + bodyRad * 0.35);
      ctx.lineTo(xLeg + legLen * 0.6, cy + bodyRad * 0.9);
      ctx.stroke();
    }

    ctx.restore();
  }
}

// エントリーポイント（main.js から呼び出し）
(() => {
  /** @type {PurpleDiverGame | null} */
  let currentGame = null;

  window.startPurpleDiverGame = function (options) {
    const { nickname } = options || {};
    if (currentGame) {
      currentGame.destroy();
      currentGame = null;
    }

    const canvas = document.getElementById("game-canvas");
    const depthLabelEl = document.getElementById("depth-value");
    if (!canvas || !depthLabelEl) return;

    currentGame = new PurpleDiverGame({
      canvas,
      depthLabelEl,
      nickname,
      onGameOver: async (finalDepth) => {
        const rounded = Math.round(finalDepth);
        try {
          if (typeof submitScore === "function") {
            await submitScore({
              nickname,
              depthMeters: rounded,
            });
          }
        } catch (e) {
          console.error("スコア送信中にエラーが発生しました:", e);
        }

        if (typeof window.handlePurpleDiverGameOver === "function") {
          window.handlePurpleDiverGameOver({ nickname, finalDepth: rounded });
        }
      },
    });

    currentGame.start();
  };

  window.PurpleDiverGame = PurpleDiverGame;
})();

