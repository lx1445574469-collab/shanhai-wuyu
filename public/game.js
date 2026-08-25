(function () {
  "use strict";

  var DATA = window.SHANHAI_DATA;
  var STORAGE_KEY = "shanhai_v3";
  var DEMO = /[?&]demo=1/.test(location.search);
  var DELAY = DEMO ? 0 : 2000;
  var SCALE_MAX = 14; // 刚柔尺半幅对应的最大绝对值

  var el = function (id) { return document.getElementById(id); };

  var state = {
    R: 0,
    pool: null,
    badges: [],
    qingyu: 0,
    checkins: {},      // { levelId: true } 到场章
    poolsClaimed: [],  // 历次认领过的潭名（十八潭图鉴）
    history: [],       // 本局每关选择记录（问道录）
    levelIndex: 0,
    screenIndex: 0,
    quizIndex: 0,
    quizAnswers: [],
    withHistory: 0,
    inward: [false, false],
    finished: false,
    levelComplete: false,
    readMode: false
  };

  // 关卡地图坐标（百分比，viewBox 100×100）—— 斜向上登山阶梯式动线
  var MAP_NODES = [
    { x: 15, y: 83, theme: "问水·上善若水", icon: "assets/elements/element_1.png" },
    { x: 42, y: 75, theme: "问寿·仁者寿", icon: "assets/elements/element_2.png" },
    { x: 24, y: 67, theme: "问进退·功遂身退", icon: "assets/elements/element_3.png" },
    { x: 55, y: 59, theme: "问逆境·素患难行乎患难", icon: "assets/elements/element_4.png" },
    { x: 34, y: 51, theme: "问山海·刚柔相推", icon: "assets/elements/element_5.png" },
    { x: 66, y: 43, theme: "问自胜·自知者明", icon: "assets/elements/element_6.png" },
    { x: 46, y: 35, theme: "问生·情之至者鬼神可通", icon: "assets/elements/element_7.png" },
    { x: 78, y: 27, theme: "问强·自胜者强", icon: "assets/elements/element_8.png" }
  ];

  // 每关无隅姿态与动作映射
  var LEVEL_WUYU = [
    { pose: "point", anim: "point", bubble: "从九水开始，我们一道走。" },
    { pose: "read",  anim: "read",  bubble: "这里要慢慢读，才读得懂。" },
    { pose: "default", anim: "nod", bubble: "进和退，都是路。" },
    { pose: "read",  anim: "peek",  bubble: "逆境里，先看看缝里有没有光。" },
    { pose: "point", anim: "climb", bubble: "山海之间，刚柔要一起用。" },
    { pose: "read",  anim: "shine", bubble: "照亮自己的，才是明。" },
    { pose: "default", anim: "nod", bubble: "生生之谓易，别急着砍树。" },
    { pose: "read",  anim: "read",  bubble: "最后一关，和历史对个答案。" }
  ];

  // ---------- storage ----------
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        R: state.R, pool: state.pool, badges: state.badges,
        qingyu: state.qingyu, checkins: state.checkins,
        poolsClaimed: state.poolsClaimed, history: state.history,
        readMode: state.readMode
      }));
    } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (s && typeof s.R === "number") return s;
    } catch (e) {}
    return null;
  }

  // ---------- wuyu companion ----------
  var bubbleTimer = null;
  var wuyuPoses = {
    default: "assets/wuyu/wuyu_default.png",
    point: "assets/wuyu/wuyu_point.png",
    read: "assets/wuyu/wuyu_read.png"
  };
  function setWuyu(pose, anim, bubble) {
    var stage = el("wuyu-stage");
    var img = el("wuyu-img");
    var wrap = el("wuyu-wrap");
    if (!stage) return;
    stage.style.display = "block";
    if (pose) {
      img.src = wuyuPoses[pose] || wuyuPoses.default;
    }
    wrap.className = "wuyu-wrap" + (anim ? " " + anim : "");
    if (bubble) showBubble(bubble);
  }
  function showBubble(text) {
    var b = el("wuyu-bubble");
    if (!b) return;
    b.textContent = text;
    b.classList.add("show");
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () { b.classList.remove("show"); }, 3600);
  }
  function bounceWuyu() {
    var wrap = el("wuyu-wrap");
    if (!wrap) return;
    wrap.classList.remove("bounce");
    void wrap.offsetWidth;
    wrap.classList.add("bounce");
  }

  // ---------- 背景音乐：循环播放用户提供的《归零》（AAC），缺失则回退到实时合成古风轻音乐 ----------
  // 用法：把音乐文件放到 assets/bgm/ 目录，命名为「gui_zero.aac」即可自动启用（浏览器原生支持 AAC，无需转码）。
  // 这样替换零风险——文件不存在时，仍有一段贯穿全程的古筝轻音乐兜底，保证“有背景乐”。
  var BGM = (function () {
    var AC = (typeof window !== "undefined") ? (window.AudioContext || window.webkitAudioContext) : null;
    var ctx = null, master = null, started = false, muted = false;
    var melodyTimer = null, bellTimer = null;
    var SCALE = [293.66, 329.63, 392.00, 440.00, 587.33, 659.25]; // D 调五声
    var MELODY = [0, 2, 4, 2, 1, 3, 1, 0, 2, 4, 3, 1, 0, 2, 1, 0, 4, 3, 2, 1, 0, 1, 2, 0];
    var mi = 0;
    var audioEl = null; // 若用户提供了音频文件

    // 优先播放用户提供的《归零》（MP4/AAC 容器，扩展名 m4a，浏览器原生支持）；列多个候选名以兼容不同命名习惯。
    var FILES = ["assets/bgm/gui_zero.m4a", "assets/bgm/归零.m4a", "assets/bgm/guiling.m4a", "assets/bgm/归零.aac"];

    function ensureCtx() {
      if (ctx) return ctx;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);
      return ctx;
    }
    function reverbBus() {
      var delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.28;
      var fb = ctx.createGain(); fb.gain.value = 0.32;
      var wet = ctx.createGain(); wet.gain.value = 0.6;
      delay.connect(fb); fb.connect(delay);
      delay.connect(wet);
      return { input: delay, output: wet };
    }
    function startDrone() {
      var rev = reverbBus();
      rev.output.connect(master);
      [146.83, 220.00, 293.66].forEach(function (f, i) {
        var o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
        var g = ctx.createGain(); g.gain.value = i === 2 ? 0.022 : 0.05;
        var lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.02;
        var lfoG = ctx.createGain(); lfoG.gain.value = 0.02;
        lfo.connect(lfoG); lfoG.connect(g.gain);
        o.connect(g); g.connect(rev.input);
        o.start(); lfo.start();
      });
    }
    function pluckNote(freq, vol) {
      if (!ctx || muted) return;
      var t = ctx.currentTime;
      var o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = freq;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 1.8);
    }
    function melodyStep() {
      if (muted) return;
      var idx = MELODY[mi % MELODY.length];
      mi++;
      pluckNote(SCALE[idx], 0.12);
      if (Math.random() < 0.22) pluckNote(SCALE[idx] * 2, 0.035);
    }
    function bell() {
      if (!ctx || muted) return;
      var t = ctx.currentTime;
      var o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = 880 + Math.random() * 240;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 2.5);
    }
    function schedule() {
      melodyTimer = setInterval(melodyStep, 500);
      bellTimer = setInterval(function () { if (!muted && Math.random() < 0.4) bell(); }, 7000);
    }
    function fade(target) {
      if (!ctx) return;
      var t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), t);
      master.gain.exponentialRampToValueAtTime(Math.max(target, 0.0001), t + 2.2);
    }
    function startSynth() {
      if (!ensureCtx()) return;
      if (ctx.state === "suspended") ctx.resume();
      startDrone();
      schedule();
      fade(muted ? 0.0001 : 0.5);
    }
    // 在“用户手势调用栈内”创建并同步 play()，满足 iOS/移动端的自动播放策略。
    // 只有在真的 playing 之后才标记 started，避免被拦截后误判为已启动而再也不重试。
    function startNow(i) {
      if (i >= FILES.length) { startSynth(); started = true; return; }
      var a = new Audio();
      a.loop = true;
      a.preload = "auto";
      a.volume = muted ? 0 : 0.6;
      var fell = false;
      a.addEventListener("error", function () {
        if (fell) return; fell = true;
        tryFile(i + 1); // 该文件不可用（404/解码失败）→ 试下一个候选
      });
      a.addEventListener("playing", function () { audioEl = a; started = true; });
      audioEl = a;
      a.src = FILES[i];
      a.load();
      var p = a.play(); // 关键：必须在手势调用栈内同步调用
      if (p && p.catch) {
        p.catch(function () {
          // 被自动播放策略拦截：保持 started=false，下一次手势由 unlock() 重新触发
        });
      }
    }
    function tryFile(i) { startNow(i); }
    // 由首次用户手势调用：创建音频并同步播放
    function unlock() {
      if (started && audioEl && !audioEl.paused) return;
      if (started) { resume(); return; }
      startNow(0);
    }
    function start() { unlock(); }
    function setMuted(m) {
      muted = m;
      if (audioEl) audioEl.volume = m ? 0 : 0.6;
      else if (ctx) fade(m ? 0.0001 : 0.5);
    }
    return {
      supported: function () { return !!(AC || (typeof Audio !== "undefined")); },
      start: start,
      unlock: unlock,
      resume: function () {
        if (audioEl && audioEl.paused) audioEl.play().catch(function () {});
        else if (ctx && ctx.state === "suspended") ctx.resume();
      },
      setMuted: setMuted,
      isMuted: function () { return muted; },
      isStarted: function () { return started; }
    };
  })();

  // ---------- 乐·开/关 开关 + 首次手势启动 ----------
  function initCompanion() {
    var musicBtn = el("music-toggle");
    var musicOff = false;
    try { musicOff = localStorage.getItem("shanhai_music_off") === "1"; } catch (e) {}
    BGM.setMuted(musicOff);

    function updateMusicBtn() {
      if (!musicBtn) return;
      var off = BGM.isMuted();
      musicBtn.classList.toggle("off", off);
      musicBtn.textContent = off ? "乐·关" : "乐·开";
    }
    updateMusicBtn();

    if (musicBtn) musicBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var willMute = !BGM.isMuted();
      if (!willMute) BGM.start();
      BGM.setMuted(willMute);
      try { localStorage.setItem("shanhai_music_off", willMute ? "1" : "0"); } catch (e) {}
      updateMusicBtn();
    });

    // 首次任意用户手势：在手势调用栈内解锁并同步播放音频（移动端自动播放策略要求）
    function kick() {
      if (!BGM.isMuted()) BGM.unlock();
      document.removeEventListener("pointerdown", kick);
      document.removeEventListener("touchstart", kick);
      document.removeEventListener("click", kick);
    }
    document.addEventListener("pointerdown", kick);
    document.addEventListener("touchstart", kick, { passive: true });
    document.addEventListener("click", kick);

    // 无隅立绘常驻可点：任何时候点她即可就《道德经》发问
    var ww = el("wuyu-wrap");
    if (ww) ww.addEventListener("click", function (e) {
      e.stopPropagation();
      renderWuyuChat();
    });
  }

  // ---------- ink particles ----------
  var particleCtx = null;
  var particleCanvas = null;
  var particles = [];
  var particleRAF = null;
  var particleRunning = false;

  function initParticles() {
    particleCanvas = el("ink-particles");
    if (!particleCanvas || !particleCanvas.getContext) return;
    particleCtx = particleCanvas.getContext("2d");
    resizeParticles();
    window.addEventListener("resize", resizeParticles);
  }

  function resizeParticles() {
    if (!particleCanvas) return;
    particleCanvas.width = window.innerWidth;
    particleCanvas.height = window.innerHeight;
  }

  function spawnParticles(count) {
    particles = [];
    var w = particleCanvas ? particleCanvas.width : window.innerWidth;
    var h = particleCanvas ? particleCanvas.height : window.innerHeight;
    for (var i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 2.2 + 0.4,
        vx: (Math.random() - 0.5) * 0.25 + 0.08,
        vy: (Math.random() - 0.8) * 0.18 - 0.05,
        alpha: Math.random() * 0.35 + 0.08,
        fade: Math.random() * 0.003 + 0.001,
        phase: Math.random() * Math.PI * 2,
        type: Math.random() > 0.75 ? "petal" : "dot"
      });
    }
  }

  function drawParticles() {
    if (!particleCtx || !particleRunning) return;
    var w = particleCanvas.width;
    var h = particleCanvas.height;
    particleCtx.clearRect(0, 0, w, h);

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.phase += 0.02;
      p.alpha += Math.sin(p.phase) * p.fade;
      if (p.alpha < 0.04) p.alpha = 0.04;
      if (p.alpha > 0.45) p.alpha = 0.45;

      if (p.x > w + 10) p.x = -10;
      if (p.x < -10) p.x = w + 10;
      if (p.y < -10) p.y = h + 10;
      if (p.y > h + 10) p.y = -10;

      particleCtx.save();
      particleCtx.globalAlpha = p.alpha;
      particleCtx.fillStyle = p.type === "petal" ? "rgba(139,115,85,0.55)" : "rgba(74,63,53,0.45)";
      if (p.type === "petal") {
        particleCtx.translate(p.x, p.y);
        particleCtx.rotate(p.phase * 0.3);
        particleCtx.beginPath();
        particleCtx.ellipse(0, 0, p.r * 1.6, p.r * 0.7, 0, 0, Math.PI * 2);
        particleCtx.fill();
      } else {
        particleCtx.beginPath();
        particleCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        particleCtx.fill();
      }
      particleCtx.restore();
    }

    particleRAF = requestAnimationFrame(drawParticles);
  }

  function startParticles() {
    if (!particleCanvas) initParticles();
    if (particles.length === 0) spawnParticles(42);
    particleRunning = true;
    if (particleRAF) cancelAnimationFrame(particleRAF);
    drawParticles();
  }

  function stopParticles() {
    particleRunning = false;
    if (particleRAF) {
      cancelAnimationFrame(particleRAF);
      particleRAF = null;
    }
    if (particleCtx) {
      particleCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
    }
  }

  // ---------- header ----------
  function renderHeader() {
    var bar = el("top-bar");
    if (!bar) return;
    bar.style.display = "flex";
    var lvl = DATA.levels[state.levelIndex];
    if (lvl) {
      el("level-pill").textContent = "第" + lvl.id + "关 · " + lvl.name;
    }
    var totalScreens = 0, doneScreens = 0;
    DATA.levels.forEach(function (L, i) {
      L.screens.forEach(function () { totalScreens++; });
      if (i < state.levelIndex) {
        doneScreens += L.screens.length;
      } else if (i === state.levelIndex) {
        doneScreens += state.screenIndex;
      }
    });
    var pct = totalScreens ? (doneScreens / totalScreens) * 100 : 0;
    el("progress-fill").style.width = pct + "%";

    var mini = el("badges-mini");
    mini.innerHTML = "";
    DATA.badges.forEach(function (bd) {
      var im = document.createElement("img");
      im.src = "assets/badges/badge_" + bd.id + ".png";
      im.alt = bd.name;
      if (state.badges.indexOf(bd.id) >= 0) im.classList.add("earned");
      mini.appendChild(im);
    });
  }

  // ---------- fact card ----------
  function openFactCard(card, onContinue) {
    el("modal-fact").textContent = card.fact || "";
    el("modal-source").textContent = card.source || "";
    var g = el("modal-grade");
    g.textContent = card.grade || "创作";
    g.className = "grade-tag grade-" + (card.grade || "创作");
    el("fact-modal").classList.add("open");
    var btn = el("modal-continue");
    var handler = function () {
      el("fact-modal").classList.remove("open");
      btn.removeEventListener("click", handler);
      if (onContinue) onContinue();
    };
    btn.addEventListener("click", handler);
  }

  // ---------- helpers ----------
  function btn(label, cls, onClick) {
    var b = document.createElement("button");
    b.className = "btn " + (cls || "btn-primary");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }
  function levelCompleted(levelId) {
    var L = DATA.levels[levelId];
    return L && state.badges.indexOf(L.badge) >= 0;
  }
  function levelIdOf(index) { return index + 1; }

  // 记录一次选择，用于问道录与清誉判定
  function recordChoice(levelIndex, screen, opt) {
    var L = DATA.levels[levelIndex];
    var histSide = opt.historical || (screen.historical || null);
    var tier, same = false;
    if (!histSide || histSide === "none" || opt.side === "none") {
      tier = "此关不论刚柔";
    } else if (opt.side === histSide) {
      tier = "与古人同道";
      same = true;
    } else {
      tier = "与古人异途";
    }
    state.history.push({
      levelId: L.id,
      levelName: L.name,
      title: screen.title || "",
      player: opt.label,
      playerSide: opt.side,
      historical: histSide,
      tier: tier,
      same: same
    });
  }

  // ---------- 刚柔尺 ----------
  function scaleMarkup(extraLabel) {
    var pct = 50 + (Math.max(-SCALE_MAX, Math.min(SCALE_MAX, state.R)) / SCALE_MAX) * 45;
    var label = extraLabel || ("刚柔 " + (state.R > 0 ? "+" + state.R : state.R));
    return '<div class="scale-wrap">' +
      '<div class="scale-track">' +
        '<div class="scale-center"></div>' +
        '<div class="scale-pointer" style="left:' + pct + '%"></div>' +
      '</div>' +
      '<div class="scale-ends"><span>柔</span><span class="scale-mid">中</span><span>刚</span></div>' +
      '<div class="scale-label">' + escapeHtml(label) + '</div>' +
    '</div>';
  }
  // 结算时浮现约两秒
  function showScaleFlash(extraLabel) {
    var box = document.createElement("div");
    box.className = "scale-flash";
    box.innerHTML = scaleMarkup(extraLabel);
    document.body.appendChild(box);
    requestAnimationFrame(function () { box.classList.add("show"); });
    setTimeout(function () {
      box.classList.remove("show");
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 500);
    }, DELAY && DELAY > 400 ? 2200 : (DELAY || 2000) + 200);
  }

  // ---------- map screen ----------
  function showMap() {
    document.body.classList.remove("decree-mode");
    el("map-screen").style.display = "flex";
    el("screen-root").style.display = "none";
    el("top-bar").style.display = "none";
    el("app").classList.add("in-map");

    var cfg = LEVEL_WUYU[0];
    setWuyu(cfg.pose, cfg.anim, "点关卡节点上山，或点我向无隅发问《道德经》。");

    renderMap();
    startParticles();

    var left = el("curtain-left");
    var right = el("curtain-right");
    if (left && right) {
      left.classList.remove("hidden-curtain");
      right.classList.remove("hidden-curtain");
      left.classList.remove("open-left");
      right.classList.remove("open-right");
      setTimeout(function () {
        left.classList.add("open-left");
        right.classList.add("open-right");
      }, 80);
    }
  }

  function hideMap() {
    el("map-screen").style.display = "none";
    el("screen-root").style.display = "block";
    el("top-bar").style.display = "flex";
    el("app").classList.remove("in-map");
    stopParticles();

    var left = el("curtain-left");
    var right = el("curtain-right");
    if (left && right) {
      left.classList.add("hidden-curtain");
      right.classList.add("hidden-curtain");
    }
  }

  function renderMap() {
    var svgDim = el("map-path-dim");
    var svgLit = el("map-path-lit");
    var nodes = el("map-nodes");

    var d = "M" + MAP_NODES.map(function (n) { return n.x + " " + n.y; }).join(" L");
    svgDim.setAttribute("d", d);
    svgLit.setAttribute("d", d);

    var litCount = 0;
    DATA.levels.forEach(function (L, i) {
      if (state.badges.indexOf(L.badge) >= 0) litCount = i + 1;
    });

    var totalLen = svgDim.getTotalLength ? svgDim.getTotalLength() : 140;
    var segLen = totalLen / (MAP_NODES.length - 1);
    var litLen = Math.max(0, litCount - 1) * segLen;
    svgLit.style.strokeDasharray = totalLen;
    svgLit.style.strokeDashoffset = totalLen - litLen;

    nodes.innerHTML = "";
    MAP_NODES.forEach(function (node, i) {
      var levelId = i + 1;
      var L = DATA.levels[i];
      var completed = levelCompleted(i);
      var unlocked = completed || levelId === 1 || levelCompleted(i - 1);
      var checked = !!state.checkins[levelId];

      var div = document.createElement("div");
      div.className = "map-node" + (completed ? " lit" : "") + (unlocked ? "" : " locked");
      div.style.left = node.x + "%";
      div.style.top = node.y + "%";

      var parts = node.theme.split("·");
      var checkMark = checked ? '<span class="node-check" title="已到场">到</span>' : '';
      div.innerHTML =
        '<div class="node-ring">' +
          '<img src="' + node.icon + '" alt="' + escapeHtml(parts[0]) + '"/>' +
          '<span class="node-num">' + levelId + '</span>' + checkMark +
        '</div>' +
        '<div class="node-label">' +
          '<span class="ln-main">' + escapeHtml(parts[0]) + '</span>' +
          (parts[1] ? '<br/>' + escapeHtml(parts[1]) : "") +
        '</div>';

      if (unlocked) {
        (function (levelId) {
          div.addEventListener("click", function () { enterLevel(levelId); });
        })(i);
      }
      nodes.appendChild(div);
    });

    renderMapTools();
  }

  // 地图底部工具条：到场任务 / 十八潭 / 文献 / 对读模式
  // 通关前不在首页出现，避免干扰选关
  function renderMapTools() {
    var old = el("map-tools");
    if (old) old.parentNode.removeChild(old);
    // 六个板块只在集齐八枚勋章（即八关全部通关）后才出现
    if (state.badges.length < DATA.badges.length) return;
    var bar = document.createElement("div");
    bar.id = "map-tools";
    bar.className = "map-tools";

    var allChecked = DATA.levels.every(function (L) { return state.checkins[L.id]; });
    var allBadges = state.badges.length >= DATA.badges.length;

    function toolCard(label, sub, iconClass, variant, onClick) {
      var d = document.createElement("div");
      d.className = "tool-card" + (variant ? " tool-card-" + variant : "");
      d.innerHTML = '<div class="tool-icon">' +
        '<div class="tool-icon-inner ' + (iconClass || "") + '"></div>' +
        '</div>' +
        '<span class="tool-label">' + escapeHtml(label) + '</span>' +
        (sub ? '<span class="tool-sub">' + escapeHtml(sub) + '</span>' : '');
      d.addEventListener("click", onClick);
      return d;
    }

    bar.appendChild(toolCard("到场任务", allChecked ? "全部到场" : "", "tool-i-checkin", "", renderCheckin));
    bar.appendChild(toolCard("十八潭图鉴", state.poolsClaimed.length + "/18", "tool-i-gallery", "", renderGallery18));
    if (state.history.length > 0 || state.finished) {
      bar.appendChild(toolCard("问道录", state.withHistory + " 次同行", "tool-i-wendao", "", renderWendao));
    }
    bar.appendChild(toolCard("文献页", "八关考据", "tool-i-refs", "", renderReferences));
    if (allBadges) {
      bar.appendChild(toolCard("兑换电子券", "已通关", "tool-i-voucher", "red", renderVoucher));
    }
    bar.appendChild(toolCard("问无隅", "对读《道德经》", "tool-i-read", "", renderWuyuChat));

    var reset = document.createElement("button");
    reset.className = "tool-reset";
    reset.textContent = "重走山道（清除进度，从第一关开始）";
    reset.addEventListener("click", function () {
      if (confirm("确定要清除全部进度，从第一关重新开始吗？")) {
        resetGame();
      }
    });
    bar.appendChild(reset);

    el("map-screen").appendChild(bar);
  }

  function enterLevel(levelId) {
    state.levelIndex = levelId;
    state.screenIndex = 0;
    state.quizIndex = 0;
    state.quizAnswers = [];
    state.finished = false;
    state.levelComplete = false;
    hideMap();
    renderScreen();
  }

  function returnToMap() {
    state.levelComplete = false;
    state.finished = false;
    showMap();
  }

  // ---------- screen renderers ----------
  function renderText(screen) {
    var cfg = LEVEL_WUYU[state.levelIndex] || LEVEL_WUYU[0];
    setWuyu(cfg.pose, cfg.anim);
    var root = el("screen-root");
    var c = document.createElement("div");
    c.className = "question-card";
    var html = "";
    if (state.screenIndex === 0 && DATA.levels[state.levelIndex]) {
      var L = DATA.levels[state.levelIndex];
      html += '<div class="motto-box"><p class="motto-text">' + escapeHtml(L.motto) + '</p><p class="motto-source">' + escapeHtml(L.mottoSource) + '</p></div>';
    }
    html += '<h2 class="screen-title">' + escapeHtml(screen.title || "") + '</h2>';
    html += '<p class="screen-body">' + escapeHtml(screen.body || "").replace(/\n/g, "<br/>") + '</p>';
    if (screen.source) html += '<p class="screen-source">' + escapeHtml(screen.source) + '</p>';
    html += '<div id="next-holder"></div>';
    c.innerHTML = html;
    root.appendChild(c);
    c.querySelector("#next-holder").appendChild(
      btn("下一步", "btn-primary", function () { advance(); })
    );
  }

  function renderChoice(screen) {
    var cfg = LEVEL_WUYU[state.levelIndex] || LEVEL_WUYU[0];
    setWuyu(cfg.pose, cfg.anim, screen.body ? "做个选择吧～" : "");
    var root = el("screen-root");
    var c = document.createElement("div");
    c.className = "question-card";
    var html = '<h2 class="screen-title">' + escapeHtml(screen.title || "") + '</h2>';
    html += '<p class="screen-body">' + escapeHtml(screen.body || "").replace(/\n/g, "<br/>") + '</p>';
    if (state.levelIndex === 7) {
      html += '<p class="scale-note">此处不再计分，只记你与历史是否同行。</p>';
    }
    html += '<div class="option-list" id="opt-list"></div>';
    c.innerHTML = html;
    root.appendChild(c);

    var list = c.querySelector("#opt-list");
    screen.options.forEach(function (opt) {
      list.appendChild(btn(opt.label, "btn-option", function () { onChoose(opt, screen); }));
    });

    if (state.readMode && screen.card) {
      c.appendChild(btn("展开史实对照卡", "btn-secondary mt-1", function () {
        openFactCard(screen.card, null);
      }));
    }
  }

  function renderChoice3(screen) {
    var cfg = LEVEL_WUYU[state.levelIndex] || LEVEL_WUYU[0];
    setWuyu(cfg.pose, cfg.anim, "三选一，只能带走一件。");
    var root = el("screen-root");
    var c = document.createElement("div");
    c.className = "question-card";
    var html = '<h2 class="screen-title">' + escapeHtml(screen.title || "") + '</h2>';
    html += '<p class="screen-body">' + escapeHtml(screen.body || "").replace(/\n/g, "<br/>") + '</p>';
    html += '<div class="option-list" id="opt-list"></div>';
    c.innerHTML = html;
    root.appendChild(c);

    var list = c.querySelector("#opt-list");
    screen.options.forEach(function (opt) {
      var b = btn(opt.label, "btn-option", function () { onChoose(opt, screen); });
      if (opt.note) b.innerHTML += '<span class="opt-note">' + escapeHtml(opt.note) + '</span>';
      list.appendChild(b);
    });

    if (state.readMode && screen.card) {
      c.appendChild(btn("展开史实对照卡", "btn-secondary mt-1", function () {
        openFactCard(screen.card, null);
      }));
    }
  }

  // 暗屏三步（第六关减法）：画面渐暗至全黑，凭触屏走完三步后复明
  function renderDarkSteps(screen) {
    var cfg = LEVEL_WUYU[state.levelIndex] || LEVEL_WUYU[0];
    setWuyu(cfg.pose, "shine", "闭上眼，听。");
    var overlay = document.createElement("div");
    overlay.className = "dark-steps";
    var steps = screen.steps || ["点灯", "静坐", "出洞"];
    overlay.innerHTML =
      '<div class="dark-inner">' +
        '<p class="dark-intro">' + escapeHtml(screen.intro || "画面渐暗……") + '</p>' +
        '<p class="dark-step current">' + escapeHtml(steps[0]) + '</p>' +
        '<p class="dark-hint">轻触屏幕，继续</p>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add("show"); });

    var idx = 0;
    var stepping = false;
    function step() {
      if (stepping) return;
      stepping = true;
      setTimeout(function () { stepping = false; }, 320);
      idx++;
      if (idx < steps.length) {
        var s = overlay.querySelector(".dark-step");
        s.textContent = steps[idx];
        s.classList.remove("current");
        void s.offsetWidth;
        s.classList.add("current");
        setTimeout(function () { overlay.querySelector(".dark-hint").textContent = "轻触屏幕，继续"; }, 400);
      } else {
        overlay.querySelector(".dark-step").textContent = "复明";
        overlay.querySelector(".dark-hint").textContent = "即将复明……";
        setTimeout(function () {
          overlay.classList.remove("show");
          setTimeout(function () {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            advance();
          }, 600);
        }, DELAY && DELAY > 200 ? 700 : 300);
      }
    }
    overlay.addEventListener("click", step);
  }

  // 归潭九印仪式：九题答毕，九枚水名印记逐枚亮起（柔=石青，刚=朱砂）
  function renderPoolRitual() {
    setWuyu("point", "bounce", "看看你是怎么被归入这一潭的。");
    var quizScreen = DATA.levels[0].screens[1];
    var items = quizScreen.items;
    var answers = state.quizAnswers;
    var root = el("screen-root");
    var c = document.createElement("div");
    c.className = "card pool-ritual";
    var html = '<h2 class="screen-title text-center">归潭</h2>';
    html += '<p class="screen-source text-center">九印依次亮起，石青为柔，朱砂为刚。</p>';
    html += '<div class="seal-row" id="seal-row"></div>';
    c.innerHTML = html;
    root.appendChild(c);

    var row = c.querySelector("#seal-row");
    var seals = [];
    for (var i = 0; i < items.length; i++) {
      var s = document.createElement("div");
      s.className = "seal";
      s.textContent = items[i].water;
      row.appendChild(s);
      seals.push(s);
    }

    var k = 0;
    function light() {
      if (k >= seals.length) {
        setTimeout(revealPool, DEMO ? 120 : 700);
        return;
      }
      var side = answers[k];
      seals[k].classList.add("lit");
      seals[k].classList.add(side === "gang" ? "gang" : "rou");
      k++;
      setTimeout(light, DELAY && DELAY > 200 ? 220 : 120);
    }
    function revealPool() {
      var meta = DATA.poolsMeta[state.pool] || { src: "", text: "" };
      var title = c.querySelector(".screen-title");
      var sub = c.querySelector(".screen-source");
      if (title) title.textContent = "归入 · " + state.pool;
      if (sub) sub.textContent = meta.src || "你的九次选择，落在一潭。";
      var reveal = document.createElement("div");
      reveal.className = "pool-reveal";
      reveal.innerHTML =
        '<div class="reveal-pool">' + escapeHtml(state.pool) + '</div>' +
        '<p class="reveal-text">' + escapeHtml(meta.text) + '</p>';
      var row = c.querySelector("#seal-row");
      if (row && row.parentNode) row.parentNode.replaceChild(reveal, row);
      var act = document.createElement("div");
      act.className = "mt-2";
      act.appendChild(btn("认领此潭", "btn-primary", function () { advance(); }));
      c.appendChild(act);
    }
    setTimeout(light, 400);
  }

  function onChoose(opt, screen) {
    if (screen.type === "treeChoice" && opt.side === "gang") {
      showTreeFell(screen);
      return;
    }
    if (!screen.skipScore && opt.side === "gang") state.R += 1;
    if (!screen.skipScore && opt.side === "rou") state.R -= 1;
    if (opt.inward) {
      if (state.levelIndex === 3) state.inward[0] = true;
      if (state.levelIndex === 5) state.inward[1] = true;
    }
    if (opt.withHistory) state.withHistory += 1;
    if (typeof opt.qingyu === "number") state.qingyu += opt.qingyu;
    recordChoice(state.levelIndex, screen, opt);
    save();
    bounceWuyu();
    if (opt.side === "none" && !screen.card) {
      // 声张之类不计分且无对照卡，直接推进
      advance();
      return;
    }
    openFactCard(screen.card, function () { advance(); });
  }

  function showTreeFell(screen) {
    var bs = document.createElement("div");
    bs.className = "black-screen";
    bs.innerHTML = '<p>树倒了。</p>';
    document.body.appendChild(bs);
    setTimeout(function () {
      document.body.removeChild(bs);
      renderScreen();
    }, DELAY || 2000);
  }

  function renderQuiz9(screen) {
    var cfg = LEVEL_WUYU[state.levelIndex] || LEVEL_WUYU[0];
    setWuyu(cfg.pose, cfg.anim, "九题之后，认领一潭～");
    var root = el("screen-root");
    var c = document.createElement("div");
    c.className = "question-card";
    var items = screen.items;
    var idx = state.quizIndex;
    var item = items[idx];

    var dots = '<div class="quiz-progress">';
    for (var i = 0; i < items.length; i++) {
      dots += '<span class="quiz-dot ' + (i < idx ? "done" : "") + '"></span>';
    }
    dots += '</div>';

    var L = DATA.levels[state.levelIndex];
    var badge = DATA.badges.find(function (b) { return b.id === L.badge; });

    var html = dots;
    html += '<div class="quiz-meta">';
    html += '<span>第 ' + (idx + 1) + ' / ' + items.length + ' 题 · ' + escapeHtml(item.water) + '</span>';
    html += '<span class="quiz-badge-mini"><img src="assets/badges/badge_' + L.badge + '.png" alt=""/>' + escapeHtml(badge ? badge.name : "") + '</span>';
    html += '</div>';
    html += '<p class="quiz-question">' + escapeHtml(item.question) + '</p>';
    html += '<div class="option-list" id="q9-list"></div>';
    html += '<p class="quote-line">' + escapeHtml(item.quote) + '</p>';
    c.innerHTML = html;
    root.appendChild(c);

    var list = c.querySelector("#q9-list");
    item.options.forEach(function (opt) {
      list.appendChild(btn(opt.label, "btn-option", function () {
        state.quizAnswers.push(opt.side);
        // 第一关九题均计入刚柔轴
        if (opt.side === "gang") state.R += 1;
        if (opt.side === "rou") state.R -= 1;
        state.quizIndex += 1;
        if (state.quizIndex >= items.length) {
          computePool();
          save();
          state.screenIndex += 1;
          renderScreen();
        } else {
          renderScreen();
        }
      }));
    });
  }

  function computePool() {
    var rouCount = 0;
    for (var i = 0; i < 8; i++) {
      if (state.quizAnswers[i] === "rou") rouCount++;
    }
    var b = state.quizAnswers[8] === "rou" ? 0 : 1;
    state.pool = DATA.pools[rouCount][b];
    if (state.poolsClaimed.indexOf(state.pool) < 0) state.poolsClaimed.push(state.pool);
  }

  function renderQuiz5(screen) {
    var cfg = LEVEL_WUYU[state.levelIndex] || LEVEL_WUYU[0];
    setWuyu(cfg.pose, cfg.anim, "归个类，柔还是刚？");
    var root = el("screen-root");
    var items = screen.items;
    var idx = state.quizIndex;
    var item = items[idx];
    var L = DATA.levels[state.levelIndex];
    var badge = DATA.badges.find(function (b) { return b.id === L.badge; });

    var c = document.createElement("div");
    c.className = "question-card";
    var html = '<div class="quiz-meta">';
    html += '<span>第 ' + (idx + 1) + ' / ' + items.length + ' 句</span>';
    html += '<span class="quiz-badge-mini"><img src="assets/badges/badge_' + L.badge + '.png" alt=""/>' + escapeHtml(badge ? badge.name : "") + '</span>';
    html += '</div>';
    html += '<div class="classify-target">' + escapeHtml(item.sentence) + '</div>';

    if (item.special === "zhongyong") {
      // 中庸三层题：不设对错，问“孔子会放在哪一边”，选后展开三层
      html += '<p class="quiz-question">' + escapeHtml(item.question) + '</p>';
      html += '<div class="classify-btns" id="zy-btns"></div>';
      html += '<div id="fb-holder"></div>';
      c.innerHTML = html;
      root.appendChild(c);
      var holder = c.querySelector("#fb-holder");
      var zy = c.querySelector("#zy-btns");
      item.options.forEach(function (o) {
        zy.appendChild(btn(o.label, "btn-secondary classify-cat", function () {
          zy.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
          var fb = document.createElement("div");
          fb.className = "feedback correct";
          fb.innerHTML = '<strong>原典三层：</strong> ' + escapeHtml(item.explanation);
          holder.appendChild(fb);
          setTimeout(function () {
            state.quizIndex += 1;
            if (state.quizIndex >= items.length) { state.quizIndex = 0; advance(); }
            else renderScreen();
          }, DEMO ? 60 : 3200);
        }));
      });
      return;
    }

    html += '<div class="classify-btns">';
    ["柔", "刚", "刚柔相济"].forEach(function (cat) {
      html += '<button class="btn btn-secondary classify-cat" data-cat="' + cat + '">' + cat + '</button>';
    });
    html += '</div>';
    html += '<p class="scale-note">此关只校准认知，不改变你的位置。</p>';
    html += '<div id="fb-holder"></div>';
    c.innerHTML = html;
    root.appendChild(c);

    var fbHolder = c.querySelector("#fb-holder");
    c.querySelectorAll(".classify-cat").forEach(function (b) {
      b.addEventListener("click", function () {
        c.querySelectorAll(".classify-cat").forEach(function (x) { x.disabled = true; });
        var correct = b.getAttribute("data-cat") === item.answer;
        var fb = document.createElement("div");
        fb.className = "feedback " + (correct ? "correct" : "wrong");
        fb.innerHTML = '<strong>' + (correct ? "对。" : "其实——") + '</strong> ' + escapeHtml(item.explanation);
        fbHolder.appendChild(fb);
        setTimeout(function () {
          state.quizIndex += 1;
          if (state.quizIndex >= items.length) { state.quizIndex = 0; advance(); }
          else renderScreen();
        }, DEMO ? 60 : 2600);
      });
    });
  }

  // 判决屏强化：暗底、逐字浮出、接受按钮延迟两秒、不弹对照卡
  function renderDecree(screen) {
    var cfg = LEVEL_WUYU[state.levelIndex] || LEVEL_WUYU[0];
    setWuyu(cfg.pose, cfg.anim, "这一页，你改变不了。");
    document.body.classList.add("decree-mode");
    var root = el("screen-root");
    var c = document.createElement("div");
    c.className = "question-card decree-card";
    var html = '<h2 class="screen-title">' + escapeHtml(screen.title || "") + '</h2>';
    html += '<p class="screen-body decree-body" id="dec-body"></p>';
    if (screen.source) html += '<p class="screen-source">' + escapeHtml(screen.source) + '</p>';
    html += '<div id="dec-holder"></div>';
    c.innerHTML = html;
    root.appendChild(c);

    var bodyEl = c.querySelector("#dec-body");
    var full = screen.body || "";
    var chars = full.split("");
    var ci = 0;
    var stepMs = DELAY && DELAY > 200 ? 120 : 40;
    var timer = setInterval(function () {
      if (ci >= chars.length) { clearInterval(timer); revealAccept(); return; }
      bodyEl.textContent += chars[ci];
      ci++;
    }, stepMs);

    var holder = c.querySelector("#dec-holder");
    var accept = null;
    function revealAccept() {
      accept = btn("接受", "btn-red", function () {
        if (accept.disabled) return;
        document.body.classList.remove("decree-mode");
        advance();
      });
      accept.disabled = true;
      holder.appendChild(accept);
      setTimeout(function () { if (accept) accept.disabled = false; }, DELAY || 2000);
    }
  }

  function renderPoolResult() {
    setWuyu("point", "bounce", "这就是你的本命潭！");
    bounceWuyu();
    var meta = DATA.poolsMeta[state.pool] || { src: "", text: "" };
    var root = el("screen-root");
    var c = document.createElement("div");
    c.className = "card";
    var html = '<div class="result-summary">';
    html += '<p class="screen-source">你的九次选择，认领一潭。</p>';
    html += '<div class="result-pool">' + escapeHtml(state.pool) + '</div>';
    html += '<p class="screen-body">' + escapeHtml(meta.text) + '</p>';
    html += '<p class="screen-source">' + escapeHtml(meta.src) + '</p>';
    html += '</div>';
    html += '<div id="pool-actions"></div>';
    c.innerHTML = html;
    root.appendChild(c);
    var actions = c.querySelector("#pool-actions");
    actions.appendChild(btn("保存分享图", "btn-secondary", function () { drawShare("pool"); }));
    actions.appendChild(document.createElement("div")).className = "mt-1";
    actions.appendChild(btn("继续前行", "btn-primary", function () { advance(); }));
  }

  function computeVerdict() {
    var inwardBoth = state.inward[0] && state.inward[1];
    for (var i = 0; i < DATA.verdicts.length; i++) {
      var v = DATA.verdicts[i];
      if (v.condition(state.R, inwardBoth)) return v;
    }
    return DATA.verdicts[DATA.verdicts.length - 1];
  }

  function qingyuTier() {
    var tiers = DATA.qingyuTiers || [];
    var best = tiers[tiers.length - 1];
    for (var i = 0; i < tiers.length; i++) {
      if (state.qingyu >= tiers[i].min) { best = tiers[i]; break; }
    }
    return best;
  }

  function renderResult() {
    setWuyu("point", "bounce", "山问完了，你是什么样的人？");
    bounceWuyu();
    document.body.classList.remove("decree-mode");
    var v = computeVerdict();
    var inwardBoth = state.inward[0] && state.inward[1];
    var qy = qingyuTier();
    var root = el("screen-root");
    root.innerHTML = "";
    var c = document.createElement("div");
    c.className = "card";
    var html = '<div class="motto-box"><p class="motto-text">八关走毕</p></div>';
    html += '<div class="result-summary">';
    html += '<p class="result-verdict-name">' + escapeHtml(v.name) + '</p>';
    html += '<p class="result-verdict-text">' + escapeHtml(v.text) + '</p>';
    html += '<p class="result-verdict-source">' + escapeHtml(v.source) + '</p>';
    html += '</div>';
    html += '<div class="scale-block">' + scaleMarkup("刚柔尺终点 " + (state.R > 0 ? "+" + state.R : state.R)) + '</div>';
    html += '<p class="screen-body text-center">第八关三处抉择，你与当年的当事人做出相同选择 ' + state.withHistory + ' 次。</p>';
    html += '<div class="qingyu-block"><p class="qingyu-title">' + escapeHtml(qy.title) + '</p><p class="screen-body">' + escapeHtml(qy.text) + '</p></div>';
    html += '<div class="badges-grid" id="result-badges"></div>';
    html += '<div id="result-actions"></div>';
    html += '<p class="screen-source text-center mt-2">集齐八枚，可至景区兑换实体文创（渠道待定）。</p>';
    c.innerHTML = html;
    root.appendChild(c);

    var grid = c.querySelector("#result-badges");
    DATA.badges.forEach(function (bd) {
      var item = document.createElement("div");
      item.className = "badge-item earned";
      item.innerHTML = '<img src="assets/badges/badge_' + bd.id + '.png" alt="' + bd.name + '"/><span>' + escapeHtml(bd.name) + '</span>';
      grid.appendChild(item);
    });

    var actions = c.querySelector("#result-actions");
    actions.appendChild(btn("保存判词长图", "btn-secondary", function () { drawShare("result"); }));
    actions.appendChild(btn("问道录长图", "btn-secondary", function () { drawShare("wendao"); }));
    actions.appendChild(document.createElement("div")).className = "mt-1";
    actions.appendChild(btn("再走一遍", "btn-primary", function () { resetGame(); }));
    addBackToMapButton();
  }

  function renderLevelComplete() {
    removeBackToMapButton();
    el("screen-root").innerHTML = "";
    renderHeader();

    var L = DATA.levels[state.levelIndex];
    var badge = DATA.badges.find(function (b) { return b.id === L.badge; }) || { name: "", meaning: "" };

    var cfg = LEVEL_WUYU[state.levelIndex] || LEVEL_WUYU[0];
    setWuyu(cfg.pose, "shine", "好厉害，" + badge.name + "勋章到手啦！");

    var root = el("screen-root");
    var c = document.createElement("div");
    c.className = "card level-complete-card";
    c.innerHTML =
      '<div class="text-center">' +
        '<p class="screen-source">第 ' + L.id + ' 关 · ' + escapeHtml(L.name) + '</p>' +
        '<h2 class="screen-title" style="margin-top:4px;">通关</h2>' +
        '<div class="level-badge-wrap">' +
          '<img src="assets/badges/badge_' + L.badge + '.png" alt="' + escapeHtml(badge.name) + '"/>' +
        '</div>' +
        '<p class="result-verdict-name" style="color:var(--gold);">' + escapeHtml(badge.name) + '</p>' +
        '<p class="screen-body" style="margin-top:6px;">' + escapeHtml(badge.meaning) + '</p>' +
      '</div>' +
      '<div id="level-complete-actions"></div>';
    root.appendChild(c);

    var actions = c.querySelector("#level-complete-actions");
    actions.appendChild(btn("收下勋章，返回地图", "btn-primary", function () { returnToMap(); }));

    // 刚柔尺结算浮现
    if (state.levelIndex >= 0) {
      var label = "刚柔 " + (state.R > 0 ? "+" + state.R : state.R) + "（第" + L.id + "关结算）";
      showScaleFlash(label);
    }
  }

  // ---------- 通关后：问道录 ----------
  function renderWendao() {
    var root = el("screen-root");
    root.innerHTML = "";
    el("top-bar").style.display = "flex";
    el("map-screen").style.display = "none";
    el("screen-root").style.display = "block";
    var c = document.createElement("div");
    c.className = "card wendao-card";
    var html = '<h2 class="screen-title text-center">问道录</h2>';
    html += '<p class="screen-source text-center">逐关对照你的选择与古人的选择。<span style="color:var(--red);font-weight:700;">红色</span>＝与古人同道（朱记），<span style="color:var(--ink);">墨色</span>＝与古人异途或此关不论刚柔。</p>';
    html += '<div class="wendao-list">';
    state.history.forEach(function (h) {
      html += '<div class="wendao-row' + (h.same ? ' same' : '') + '">';
      html += '<div class="wd-head"><span class="wd-level">第' + h.levelId + '关 · ' + escapeHtml(h.levelName) + '</span><span class="wd-tier">' + escapeHtml(h.tier) + (h.same ? ' · 朱记' : '') + '</span></div>';
      html += '<div class="wd-body">';
      html += '<div class="wd-you"><span class="wd-tag">你</span>' + escapeHtml(h.player) + '</div>';
      html += '<div class="wd-him"><span class="wd-tag">古人</span>' + escapeHtml(sideLabel(h.historical)) + '</div>';
      html += '</div></div>';
    });
    html += '</div>';
    if (state.history.length === 0) {
      html += '<p class="screen-body text-center">本局还没有记录，先去走一遍吧。</p>';
    }
    html += '<div id="wd-actions" class="mt-2"></div>';
    c.innerHTML = html;
    root.appendChild(c);
    var actions = c.querySelector("#wd-actions");
    actions.appendChild(btn("保存问道录长图", "btn-secondary", function () { drawShare("wendao"); }));
    actions.appendChild(btn("返回地图", "btn-primary mt-1", function () { showMap(); }));
  }
  function sideLabel(side) {
    if (side === "rou") return "柔";
    if (side === "gang") return "刚";
    return "——（不论刚柔）";
  }

  // ---------- 通关后：十八潭图鉴 ----------
  function renderGallery18() {
    var root = el("screen-root");
    root.innerHTML = "";
    el("top-bar").style.display = "flex";
    el("map-screen").style.display = "none";
    el("screen-root").style.display = "block";
    var c = document.createElement("div");
    c.className = "card gallery-card";
    var html = '<h2 class="screen-title text-center">十八潭图鉴</h2>';
    html += '<p class="screen-source text-center">认领过的潭作朱砂，未领者留白。认满十八潭，可得“九水十八潭”总章。</p>';
    html += '<div class="gallery-grid">';
    DATA.pools.forEach(function (pair) {
      pair.forEach(function (name) {
        var claimed = state.poolsClaimed.indexOf(name) >= 0;
        var meta = DATA.poolsMeta[name] || { src: "", text: "" };
        html += '<div class="gallery-item' + (claimed ? ' claimed' : '') + '" title="' + escapeHtml(meta.src + '｜' + meta.text) + '">';
        html += '<span class="gi-name">' + escapeHtml(name) + '</span>';
        html += '</div>';
      });
    });
    html += '</div>';
    var allClaimed = DATA.pools.every(function (p) { return p.every(function (n) { return state.poolsClaimed.indexOf(n) >= 0; }); });
    if (allClaimed) {
      html += '<p class="result-verdict-name" style="color:var(--red);">恭喜！“九水十八潭”总章已点亮。</p>';
    }
    html += '<div class="mt-2"><button class="btn btn-primary" id="g-back">返回地图</button></div>';
    c.innerHTML = html;
    root.appendChild(c);
    c.querySelector("#g-back").addEventListener("click", function () { showMap(); });
  }

  // ---------- 到场任务 ----------
  function renderCheckin() {
    var root = el("screen-root");
    root.innerHTML = "";
    el("top-bar").style.display = "flex";
    el("map-screen").style.display = "none";
    el("screen-root").style.display = "block";
    var c = document.createElement("div");
    c.className = "card checkin-card";
    var html = '<h2 class="screen-title text-center">到场任务</h2>';
    html += '<p class="screen-source text-center">八处皆为真实景区。凭扫码或拍照（仅存本地，不上传）解锁到场章，与勋章并列。</p>';
    html += '<div class="checkin-list">';
    DATA.levels.forEach(function (L) {
      var done = !!state.checkins[L.id];
      html += '<div class="checkin-row' + (done ? ' done' : '') + '">';
      html += '<div class="ck-info"><span class="ck-level">第' + L.id + '关 · ' + escapeHtml(L.name) + '</span><span class="ck-place">' + escapeHtml(L.checkin.place) + '｜' + escapeHtml(L.checkin.target) + '</span><span class="ck-judge">' + escapeHtml(L.checkin.judge) + '</span></div>';
      html += '<button class="btn ' + (done ? 'btn-secondary' : 'btn-red') + ' ck-btn" data-lv="' + L.id + '">' + (done ? '已到场 ✓' : '标记到场') + '</button>';
      html += '</div>';
    });
    html += '</div>';
    html += '<div class="mt-2"><button class="btn btn-primary" id="ck-back">返回地图</button></div>';
    c.innerHTML = html;
    root.appendChild(c);
    c.querySelectorAll(".ck-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var lv = +b.getAttribute("data-lv");
        state.checkins[lv] = !state.checkins[lv];
        save();
        renderCheckin();
        renderMapTools();
      });
    });
    c.querySelector("#ck-back").addEventListener("click", function () { showMap(); });
  }

  // ---------- 兑换电子券 ----------
  function renderVoucher() {
    var root = el("screen-root");
    root.innerHTML = "";
    el("top-bar").style.display = "flex";
    el("map-screen").style.display = "none";
    var code = "SH" + (state.R >= 0 ? "P" : "N") + Math.abs(state.R) + "-" + (state.pool || "0") + "-" + Date.now().toString().slice(-6);
    var c = document.createElement("div");
    c.className = "card voucher-card";
    c.innerHTML =
      '<h2 class="screen-title text-center">电子兑换券</h2>' +
      '<p class="screen-source text-center">集齐八枚勋章，先发电子券与专属编号；实体文创待与景区商定后接入。</p>' +
      '<div class="voucher-box">' +
        '<div class="voucher-title">山海问道 · 八关通关</div>' +
        '<div class="voucher-code">' + escapeHtml(code) + '</div>' +
        '<div class="voucher-note">凭此券编号至景区游客中心核验（实体兑换渠道待定）。</div>' +
      '</div>' +
      '<div class="mt-2"><button class="btn btn-primary" id="v-back">返回地图</button></div>';
    root.appendChild(c);
    c.querySelector("#v-back").addEventListener("click", function () { showMap(); });
  }

  // ---------- 文献页 ----------
  function renderReferences() {
    var root = el("screen-root");
    root.innerHTML = "";
    el("top-bar").style.display = "flex";
    el("map-screen").style.display = "none";
    el("screen-root").style.display = "block";
    var c = document.createElement("div");
    c.className = "card refs-card";
    var html = '<h2 class="screen-title text-center">文献页</h2>';
    html += '<p class="screen-source text-center">全作引用书目，按关别列出，供研学延伸。</p>';
    DATA.references.forEach(function (sec) {
      html += '<div class="ref-sec"><p class="ref-level">' + escapeHtml(sec.level) + '</p><ul class="ref-list">';
      sec.items.forEach(function (it) {
        html += '<li><span class="ref-title">' + escapeHtml(it.title) + '</span><span class="ref-note">' + escapeHtml(it.note) + '</span></li>';
      });
      html += '</ul></div>';
    });
    html += '<div class="mt-2"><button class="btn btn-primary" id="r-back">返回地图</button></div>';
    c.innerHTML = html;
    root.appendChild(c);
    c.querySelector("#r-back").addEventListener("click", function () { showMap(); });
  }

  // ---------- 问无隅：《道德经》知识问答（接后端 /api/chat，SSE 流式） ----------
  function renderWuyuChat() {
    var wstage = el("wuyu-stage");
    if (wstage) wstage.style.display = "none"; // 展开对话时隐藏立绘，避免遮挡面板
    var root = el("screen-root");
    root.innerHTML = "";
    el("top-bar").style.display = "flex";
    el("map-screen").style.display = "none";
    el("screen-root").style.display = "block";
    var c = document.createElement("div");
    c.className = "card chat-card";
    c.innerHTML =
      '<h2 class="screen-title text-center">问无隅</h2>' +
      '<p class="screen-source text-center">就《道德经》向引路人无隅发问。回答依据经文原文，附白话阐释。</p>' +
      '<div class="chat-log" id="chat-log"></div>' +
      '<div class="chat-input-row">' +
        '<input id="chat-input" class="chat-input" type="text" placeholder="例如：什么是真正的强大？" maxlength="120" autocomplete="off" />' +
        '<button class="btn btn-primary" id="chat-send">问无隅</button>' +
      '</div>' +
      '<div class="mt-2"><button class="btn btn-secondary" id="chat-back">返回地图</button></div>';
    root.appendChild(c);
    var log = c.querySelector("#chat-log");
    var input = c.querySelector("#chat-input");
    var sendBtn = c.querySelector("#chat-send");
    var cur = DATA.levels.filter(function (L) { return L.id === state.levelIndex; })[0];
    var levelCtx = cur ? ("第" + cur.id + "关 · " + cur.name) : "";

    function ask() {
      var q = input.value.trim();
      if (!q) return;
      input.value = "";
      var u = document.createElement("div");
      u.className = "chat-msg user";
      u.textContent = q;
      log.appendChild(u);
      var w = document.createElement("div");
      w.className = "chat-msg wuyu";
      w.textContent = "无隅正在思忖…";
      log.appendChild(w);
      log.scrollTop = log.scrollHeight;

      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: q, level: levelCtx })
      })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          if (!r.body || !r.body.getReader) throw new Error("no-stream");
          var reader = r.body.getReader();
          var dec = new TextDecoder();
          var buf = "";
          function pump() {
            return reader.read().then(function (res) {
              if (res.done) return;
              buf += dec.decode(res.value, { stream: true });
              var idx;
              while ((idx = buf.indexOf("\n")) >= 0) {
                var line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (line.indexOf("data:") !== 0) continue;
                var data = line.slice(5).trim();
                try {
                  var j = JSON.parse(data);
                  if (j.type === "token") {
                    w.textContent += j.text;
                    log.scrollTop = log.scrollHeight;
                  }
                } catch (e) {}
              }
              return pump();
            });
          }
          return pump();
        })
        .catch(function () {
          w.textContent = "（无隅暂未回应：当前未在 AI 后端环境中运行，或网络不通。请启动 shanhai_ai 后端并配置 DEEPSEEK_API_KEY 后重试。）";
        });
    }

    sendBtn.addEventListener("click", ask);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") ask(); });
    c.querySelector("#chat-back").addEventListener("click", function () { showMap(); });
    setTimeout(function () { input.focus(); }, 50);
  }

  // ---------- screen dispatch ----------
  function renderScreen() {
    if (state.finished) { renderResult(); return; }
    var L = DATA.levels[state.levelIndex];
    if (!L) { renderResult(); return; }
    var screen = L.screens[state.screenIndex];
    if (!screen) { renderResult(); return; }
    el("screen-root").innerHTML = "";
    renderHeader();
    switch (screen.type) {
      case "text": renderText(screen); break;
      case "choice": renderChoice(screen); break;
      case "choice3": renderChoice3(screen); break;
      case "treeChoice": renderChoice(screen); break;
      case "quiz9": renderQuiz9(screen); break;
      case "quiz5": renderQuiz5(screen); break;
      case "decree": renderDecree(screen); break;
      case "darkSteps": renderDarkSteps(screen); break;
      case "poolRitual": renderPoolRitual(); break;
      case "poolResult": renderPoolResult(); break;
      default: renderText(screen);
    }
    addBackToMapButton();
  }

  function addBackToMapButton() {
    if (el("screen-root").querySelector(".back-map")) return;
    var holder = document.createElement("div");
    holder.className = "back-map";
    holder.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:85;";
    var b = document.createElement("button");
    b.className = "btn btn-secondary";
    b.style.cssText = "min-height:36px;padding:8px 14px;font-size:13px;width:auto;border-radius:999px;box-shadow:0 2px 8px rgba(74,63,53,0.1);";
    b.textContent = "返回关卡地图";
    b.addEventListener("click", function () { returnToMap(); });
    holder.appendChild(b);
    document.getElementById("app").appendChild(holder);
  }

  function removeBackToMapButton() {
    var old = document.querySelector(".back-map");
    if (old) old.remove();
  }

  function advance() {
    var L = DATA.levels[state.levelIndex];
    state.screenIndex += 1;
    if (state.screenIndex >= L.screens.length) {
      if (state.badges.indexOf(L.badge) < 0) state.badges.push(L.badge);
      save();
      if (state.levelIndex >= DATA.levels.length - 1) {
        // 末关通关 → 终局结算（判词/清誉/问道录/十八潭）
        state.finished = true;
        renderResult();
      } else {
        state.levelComplete = true;
        renderLevelComplete();
      }
      return;
    }
    renderScreen();
  }

  function resetGame() {
    state = {
      R: 0, pool: null, badges: [], qingyu: 0, checkins: {}, poolsClaimed: [],
      history: [], levelIndex: 0, screenIndex: 0,
      quizIndex: 0, quizAnswers: [], withHistory: 0, inward: [false, false],
      finished: false, levelComplete: false, readMode: false
    };
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    removeBackToMapButton();
    showMap();
  }

  // ---------- share canvas ----------
  function drawShare(mode) {
    var canvas = el("share-canvas");
    var ctx = canvas.getContext("2d");
    if (!ctx) { alert("当前环境不支持生成图片"); return; }
    var W = 1080, H = 1920;
    canvas.width = W; canvas.height = H;

    function paintBg() {
      ctx.fillStyle = "#F5EFE3";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(74,124,140,0.10)";
      ctx.fillRect(0, 0, W, 360);
      ctx.fillStyle = "rgba(194,64,46,0.08)";
      ctx.fillRect(0, 300, W, 60);
      ctx.textAlign = "center";
      ctx.fillStyle = "#4A3F35";
      ctx.font = "700 72px 'Songti SC','SimSun',serif";
      ctx.fillText("山海问道", W / 2, 150);
      ctx.font = "400 34px 'Songti SC','SimSun',serif";
      ctx.fillStyle = "#7A6E62";
      ctx.fillText("无隅伴你，行走崂山", W / 2, 220);
    }

    var centerX = W / 2;
    var sources = ["assets/wuyu/wuyu_default.png"];
    DATA.badges.forEach(function (bd) { sources.push("assets/badges/badge_" + bd.id + ".png"); });
    var imgs = sources.map(function (s) { var im = new Image(); im.src = s; return im; });
    var done = 0;
    function check() { done++; if (done === imgs.length) compose(imgs); }
    imgs.forEach(function (im) { im.onload = im.onerror = check; });
    setTimeout(function () { if (done < imgs.length) compose(imgs); }, 1500);

    function compose(imgs) {
      var wuyu = imgs[0];
      paintBg();

      var wH = 780, wW = wH * (wuyu.width / wuyu.height);
      if (wW > W - 80) { wW = W - 80; wH = wW * (wuyu.height / wuyu.width); }
      ctx.drawImage(wuyu, centerX - wW / 2, 350, wW, wH);

      var textY = 1200;
      if (mode === "wendao") {
        // 问道录以文字为主，无隅图缩小置顶，给长文留出空间
        var maxWuyuH = 420;
        if (wH > maxWuyuH) { wH = maxWuyuH; wW = wH * (wuyu.width / wuyu.height); }
        if (wW > W - 80) { wW = W - 80; wH = wW * (wuyu.height / wuyu.width); }
        textY = 260 + wH + 60;
      }
      if (mode === "pool") {
        var meta = DATA.poolsMeta[state.pool] || { src: "", text: "" };
        ctx.fillStyle = "#4A3F35";
        ctx.font = "400 38px 'Songti SC','SimSun',serif";
        ctx.fillText("你的本命潭", centerX, textY);
        ctx.fillStyle = "#4A7C8C";
        ctx.font = "700 120px 'Songti SC','SimSun',serif";
        ctx.fillText(state.pool || "—", centerX, textY + 130);
        ctx.fillStyle = "#4A3F35";
        ctx.font = "400 36px 'Songti SC','SimSun',serif";
        var ml = wrapText(ctx, meta.text, centerX, textY + 200, W - 200, 50);
        ctx.fillStyle = "#7A6E62";
        ctx.font = "400 30px 'Songti SC','SimSun',serif";
        ctx.fillText(meta.src, centerX, textY + 200 + ml * 50 + 50);
      } else if (mode === "wendao") {
        ctx.fillStyle = "#4A3F35";
        ctx.font = "400 38px 'Songti SC','SimSun',serif";
        ctx.fillText("问道录", centerX, textY);
        var legendY = textY + 44;
        var legendFont = "400 24px 'Songti SC','SimSun',serif";
        ctx.font = legendFont;
        ctx.fillStyle = "#4A3F35";
        var legend = "红色＝与古人同道（朱记）　墨色＝与古人异途或此关不论刚柔";
        var legendLines = wrapText(ctx, legend, centerX, legendY, W - 140, 34);
        var y = legendY + legendLines * 34 + 22;
        var lineH = 42;
        var maxW = W - 140;
        var font = "400 23px 'Songti SC','SimSun',serif";
        // 先算总高，必要时动态加长画布
        var totalH = legendLines * 34 + 22;
        var tmp = document.createElement("canvas").getContext("2d");
        tmp.font = font;
        state.history.forEach(function (h) {
          var line = "第" + h.levelId + "关 " + h.levelName + "：你「" + h.player + "」· 古人「" + sideLabel(h.historical) + "」" + (h.same ? "（朱记）" : "");
          var lines = 1, cur = "";
          var chars = line.split("");
          for (var i = 0; i < chars.length; i++) {
            var test = cur + chars[i];
            if (tmp.measureText(test).width > maxW && cur) { lines++; cur = chars[i]; }
            else cur = test;
          }
          totalH += lines * lineH + 10;
        });
        totalH += 80; // 底部统计行
        var badgesH = 140;
        var needH = y + totalH + badgesH + 120;
        if (needH > H) { H = needH; canvas.height = H; paintBg(); }
        // 正式绘制
        ctx.font = legendFont;
        ctx.fillStyle = "#4A3F35";
        wrapText(ctx, legend, centerX, legendY, W - 140, 34);
        state.history.forEach(function (h) {
          var line = "第" + h.levelId + "关 " + h.levelName + "：你「" + h.player + "」· 古人「" + sideLabel(h.historical) + "」" + (h.same ? "（朱记）" : "");
          ctx.fillStyle = h.same ? "#C2402E" : "#4A3F35";
          ctx.font = font;
          var drawn = wrapText(ctx, line, centerX, y, maxW, lineH);
          y += drawn * lineH + 10;
        });
        ctx.fillStyle = "#7A6E62";
        ctx.font = "400 28px 'Songti SC','SimSun',serif";
        ctx.fillText("刚柔 " + (state.R > 0 ? "+" + state.R : state.R) + " ｜ 与历史同行 " + state.withHistory + " 次", centerX, y + 20);
      } else {
        var v = computeVerdict();
        var qy = qingyuTier();
        ctx.fillStyle = "#4A3F35";
        ctx.font = "400 38px 'Songti SC','SimSun',serif";
        ctx.fillText("判词 · " + v.name, centerX, textY);
        ctx.fillStyle = "#C2402E";
        ctx.font = "700 84px 'Songti SC','SimSun',serif";
        var tl = wrapText(ctx, v.text, centerX, textY + 110, W - 160, 98);
        ctx.fillStyle = "#7A6E62";
        ctx.font = "400 32px 'Songti SC','SimSun',serif";
        ctx.fillText(v.source, centerX, textY + 110 + tl * 98 + 30);
        ctx.fillStyle = "#4A3F35";
        ctx.font = "400 30px 'Songti SC','SimSun',serif";
        ctx.fillText("与历史同行 " + state.withHistory + " 次 ｜ 清誉：" + qy.title, centerX, textY + 110 + tl * 98 + 80);
      }

      var badgesY = H - 180;
      if (mode === "wendao") badgesY = H - 160;
      ctx.fillStyle = "#7A6E62";
      ctx.font = "400 30px 'Songti SC','SimSun',serif";
      ctx.fillText("八枚勋章", centerX, badgesY - 24);
      var bw = 100, gap = 16, total = DATA.badges.length * bw + (DATA.badges.length - 1) * gap;
      var startX = centerX - total / 2;
      DATA.badges.forEach(function (bd, i) {
        var bx = startX + i * (bw + gap);
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx + bw / 2, badgesY + bw / 2, bw / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        try { ctx.drawImage(imgs[i + 1], bx, badgesY, bw, bw); } catch (e) {}
        ctx.restore();
      });

      ctx.fillStyle = "#9A8E7E";
      ctx.font = "400 24px 'Songti SC','SimSun',serif";
      ctx.fillText("山海问道 · 无隅伴你行走崂山", centerX, H - 110);

      tryDownload();
    }

    function tryDownload() {
      try {
        var url = canvas.toDataURL("image/png");
        var a = document.createElement("a");
        a.href = url;
        a.download = (mode === "pool" ? "本命潭_" : mode === "wendao" ? "问道录_" : "判词_") + (state.pool || "山海问道") + ".png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (e) {}
    }
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    var chars = String(text).split("");
    var line = "";
    var lines = [];
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = chars[i];
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    for (var j = 0; j < lines.length; j++) {
      ctx.fillText(lines[j], x, y + j * lineHeight);
    }
    return lines.length;
  }

  // ---------- demo panel ----------
  function initDemoPanel() {
    if (!DEMO) return;
    var panel = el("demo-panel");
    panel.classList.remove("hidden");
    var selL = el("demo-level");
    var selS = el("demo-screen");
    DATA.levels.forEach(function (L, i) {
      var o = document.createElement("option");
      o.value = i;
      o.textContent = "L" + L.id + " " + L.name;
      selL.appendChild(o);
    });
    function updateScreens() {
      selS.innerHTML = "";
      var L = DATA.levels[+selL.value];
      L.screens.forEach(function (s, i) {
        var o = document.createElement("option");
        o.value = i;
        o.textContent = (i + 1) + "." + (s.type || "text");
        selS.appendChild(o);
      });
    }
    updateScreens();
    selL.addEventListener("change", updateScreens);
    el("demo-jump").addEventListener("click", function () {
      removeBackToMapButton();
      state.levelIndex = +selL.value;
      state.screenIndex = +selS.value;
      state.quizIndex = 0;
      state.quizAnswers = [];
      state.finished = false;
      hideMap();
      renderScreen();
    });
    el("demo-reset").addEventListener("click", function () { resetGame(); });
  }

  // ---------- init ----------
  function init() {
    initParticles();
    initDemoPanel();
    initCompanion();
    var saved = load();
    if (saved) {
      state.R = saved.R || 0;
      state.pool = saved.pool || null;
      state.badges = saved.badges || [];
      state.qingyu = saved.qingyu || 0;
      state.checkins = saved.checkins || {};
      state.poolsClaimed = saved.poolsClaimed || [];
      state.history = saved.history || [];
      state.readMode = !!saved.readMode;
    }
    showMap();
  }

  if (typeof window !== 'undefined') {
    window.__getState = function () { return state; };
    window.__advance = advance;
    window.__renderResult = renderResult;
  }

  init();
})();
