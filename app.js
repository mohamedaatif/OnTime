/* ===================================================================
   OnTime — a gentle getting-ready timer that works backwards
   from the moment you need to be out the door.
   =================================================================== */
'use strict';

/* ---------------- tiny helpers ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function fmtClock(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad2(m)} ${ap}`;
}
function fmtClockParts(d) {
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return { time: `${h}:${pad2(d.getMinutes())}`, ap };
}
function fmtDur(mins) {
  mins = Math.round(mins);
  if (mins >= 60) {
    const h = Math.floor(mins / 60), m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}
function fmtCount(secs) {
  const neg = secs < 0;
  secs = Math.abs(Math.round(secs));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  const core = h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  return (neg ? '−' : '') + core;
}
function fmtMinsLoose(secs) {
  const mins = Math.round(Math.abs(secs) / 60);
  if (mins < 1) return 'under a minute';
  return fmtDur(mins);
}
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/* ---------------- emoji guessing ---------------- */
const ICON_RULES = [
  [/shower|bath|rinse/i, '🚿'], [/hair|blow|dry|curl|straighten/i, '💇‍♀️'],
  [/makeup|mascara|foundation|lip|blush|eyeliner|concealer/i, '💄'],
  [/skincare|serum|moistur|sunscreen|spf|lotion/i, '🧴'],
  [/dress|outfit|clothes|wear|change/i, '👗'], [/shoe|heel|boot|sneaker/i, '👟'],
  [/breakfast|eat|food|meal|lunch|dinner/i, '🍳'], [/coffee|chai|tea|latte/i, '☕'],
  [/pack|bag|purse|backpack/i, '👜'], [/key/i, '🔑'], [/phone|charge|charger/i, '🔌'],
  [/teeth|brush|floss/i, '🪥'], [/face|wash|cleanse/i, '🧼'],
  [/iron|steam|press/i, '🧺'], [/jewel|earring|necklace|ring|watch/i, '💍'],
  [/perfume|scent|fragrance/i, '🌸'], [/nail|polish/i, '💅'],
  [/kid|baby|child/i, '🍼'], [/dog|cat|pet|feed/i, '🐾'],
  [/water|bottle|hydrate/i, '🥤'], [/snack/i, '🍎'], [/gift|present/i, '🎁'],
  [/car|gas|fuel/i, '🚗'], [/pray|meditat/i, '🕊️'], [/email|work|laptop/i, '💻'],
  [/clean|tidy|dishes/i, '🧽'], [/plant|flower/i, '🪴'], [/gym|workout|stretch|yoga/i, '🧘‍♀️'],
];
const FALLBACK_ICONS = ['🌷', '✨', '🎀', '🌿', '🫧', '🌼'];
function guessIcon(name) {
  for (const [re, ic] of ICON_RULES) if (re.test(name)) return ic;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_ICONS[h % FALLBACK_ICONS.length];
}
const EVENT_ICON_RULES = [
  [/work|office|shift/i, '💼'], [/wedding|shaadi|nikkah/i, '💍'], [/dinner|restaurant|brunch|lunch/i, '🍽️'],
  [/flight|airport|travel|trip/i, '✈️'], [/gym|class|yoga/i, '🏃‍♀️'], [/doctor|dentist|appoint/i, '🩺'],
  [/party|birthday/i, '🎉'], [/school|college/i, '🎒'], [/church|mosque|temple|service/i, '🕊️'],
  [/movie|show|concert/i, '🎬'], [/date/i, '💕'],
];
function guessEventIcon(name) {
  for (const [re, ic] of EVENT_ICON_RULES) if (re.test(name)) return ic;
  return '🌷';
}

/* ---------------- state ---------------- */
const LS_KEY = 'ontime.v1';
const SEED_PRESETS = [
  ['Shower', 15, '🚿'], ['Hair', 10, '💇‍♀️'], ['Makeup', 15, '💄'],
  ['Skincare', 5, '🧴'], ['Get dressed', 10, '👗'], ['Breakfast', 15, '🍳'],
  ['Coffee', 5, '☕'], ['Pack bag', 5, '👜'], ['Brush teeth', 3, '🪥'],
  ['Find keys', 2, '🔑'],
];

let S = load();
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.sound === undefined) s.sound = true;
      return s;
    }
  } catch (e) { /* fall through to fresh state */ }
  const history = {};
  for (const [name, est, icon] of SEED_PRESETS) {
    history[name.toLowerCase()] = { name, icon, estMins: est, count: 0, seed: true };
  }
  return { events: [], routines: [], history, lastDur: 10, sound: true };
}
function save() {
  // keep finished events trimmed
  const done = S.events.filter((e) => e.status === 'done');
  if (done.length > 12) {
    const drop = new Set(done.slice(0, done.length - 12).map((e) => e.id));
    S.events = S.events.filter((e) => !drop.has(e.id));
  }
  localStorage.setItem(LS_KEY, JSON.stringify(S));
}

/* ---------------- chimes & haptics ----------------
   iOS unlocks audio only after a user gesture, so the context is
   created/resumed on the first touch anywhere. */
let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* no audio available */ }
}
document.addEventListener('pointerdown', unlockAudio);

function tone(freq, at, dur = 0.45, vol = 0.16) {
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}
function chime(kind) {
  buzz(kind === 'leave' ? [180, 90, 180] : 90);
  if (!S.sound || !audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime;
  if (kind === 'over') { tone(659, t); tone(523, t + 0.18); }                      // gentle "psst"
  if (kind === 'warn5') { tone(784, t); tone(988, t + 0.15); }                     // heads-up
  if (kind === 'leave') { tone(880, t); tone(1109, t + 0.16); tone(1319, t + 0.32, 0.7); } // time to go
  if (kind === 'start') { tone(523, t); tone(659, t + 0.16); tone(784, t + 0.32, 0.6); }   // time to begin
  if (kind === 'pop') tone(1047, t, 0.2, 0.1);                                     // toggle feedback
}
function buzz(pattern) {
  if (S.sound && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
}

/* ---------------- schedule math ---------------- */
function targetAt(ev) {
  const d = new Date(ev.date + 'T00:00:00');
  const [h, m] = ev.time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}
function leaveAt(ev) {
  return new Date(targetAt(ev).getTime() - (Number(ev.travelMins) || 0) * 60000);
}
function pendingTasks(ev) { return ev.tasks.filter((t) => !t.done); }
function totalEstMins(tasks) { return tasks.reduce((s, t) => s + (t.done ? 0 : t.estMins), 0); }

function curSpentSecs(ev) {
  const cur = pendingTasks(ev)[0];
  if (!cur || ev.status !== 'active') return 0;
  if (ev.notStarted || ev.paused) return cur.spentSecs || 0;
  return (cur.spentSecs || 0) + (Date.now() - ev.curStart) / 1000;
}

/** Project the rest of the routine in real clock time.
    Normally it flows from `now`; while still waiting to start, it sits packed
    against the deadline (from the latest safe start) so the plan looks settled
    while the "until you start" timer counts down. */
function computeSchedule(ev, now = new Date()) {
  const pend = pendingTasks(ev);
  const lv = leaveAt(ev);
  const remSecsFor = (t, i) =>
    (ev.status === 'active' && !ev.notStarted && i === 0)
      ? Math.max(0, t.estMins * 60 - curSpentSecs(ev))
      : t.estMins * 60;
  const totalRemMs = pend.reduce((s, t, i) => s + remSecsFor(t, i) * 1000, 0);
  // latest moment you can begin and still finish on time
  const startByMs = lv.getTime() - totalRemMs;
  const originMs = ev.notStarted ? Math.max(startByMs, now.getTime()) : now.getTime();

  let cursor = originMs;
  const rows = pend.map((t, i) => {
    const start = cursor;
    cursor += remSecsFor(t, i) * 1000;
    return { t, start: new Date(start), end: new Date(cursor) };
  });
  const readyAt = new Date(cursor);
  return {
    rows, readyAt, leaveAt: lv, targetAt: targetAt(ev), startByMs,
    slackSecs: (lv.getTime() - readyAt.getTime()) / 1000,
  };
}
function slackStatus(slackSecs) {
  if (slackSecs >= 120) return { cls: 'ok', icon: '🌿', label: `On track · ${fmtMinsLoose(slackSecs)} to spare` };
  if (slackSecs >= 0) return { cls: 'close', icon: '🐝', label: 'Cutting it close' };
  return { cls: 'late', icon: '🌧️', label: `Behind by ${fmtMinsLoose(slackSecs)}` };
}

/* Wording adapts to the kind of deadline: a trip out the door (travel time
   set) talks about leaving & arriving; everything else — bedtime, a call,
   dinner on the table — just talks about being "ready by". */
function terms(ev) {
  const out = Number(ev.travelMins) > 0;
  return {
    out,
    timeLabel: out ? '🕐 I need to ARRIVE by' : '🕐 I need to be ready by',
    goalEmoji: out ? '🚪' : '✨',
    goalWord: out ? 'leave' : 'ready by',     // clock chip: "🚪 leave 8:00" / "✨ ready by 10:00"
    homeMeta: out ? 'leave by' : 'ready by',
    countUntil: out ? 'until you leave' : "until you're ready",
    countPast: out ? 'past your leave time' : 'past your ready time',
    homeUntil: out ? 'until leave' : 'until ready',
    homePast: out ? 'past leave' : 'past ready',
    verdictHead: out ? 'Out the door' : 'All ready',
    verdictPast: out ? 'past leave time' : 'past your ready time',
    startTail: out ? "and you'll glide out the door." : "and you'll be ready in time.",
  };
}

/** What the big countdown is racing toward: the start time while waiting,
    otherwise the leave/ready time. Shared by home cards and live mode. */
function liveCountdown(ev) {
  const sch = computeSchedule(ev);
  if (ev.notStarted) return { secs: (sch.startByMs - Date.now()) / 1000, until: 'until you start', past: 'start now!' };
  const T = terms(ev);
  return { secs: (sch.leaveAt.getTime() - Date.now()) / 1000, until: T.homeUntil, past: T.homePast };
}

/* ---------------- event mutations ---------------- */
function getEvent(id) { return S.events.find((e) => e.id === id); }

function newEvent() {
  const now = new Date();
  // default: next round half-hour at least 45 min away
  const t = new Date(now.getTime() + 45 * 60000);
  t.setMinutes(t.getMinutes() + (30 - (t.getMinutes() % 30)) % 30, 0, 0);
  const ev = {
    id: uid(), name: '', icon: '🌷',
    date: todayStr(t), time: `${pad2(t.getHours())}:${pad2(t.getMinutes())}`,
    travelMins: 0, tasks: [], status: 'setup',
    createdAt: Date.now(),
  };
  S.events.push(ev);
  save();
  return ev;
}

function makeTask(name, estMins) {
  return { id: uid(), name, icon: guessIcon(name), estMins, done: false, spentSecs: 0, actualSecs: null };
}

function reconcileCurrent(ev) {
  if (ev.status !== 'active' || ev.notStarted) return;
  const cur = pendingTasks(ev)[0];
  const curId = cur ? cur.id : null;
  if (curId !== ev.curTaskId) {
    // bank elapsed time on whichever task the clock was running against
    const old = ev.tasks.find((t) => t.id === ev.curTaskId);
    if (old && !old.done && !ev.paused) old.spentSecs = (old.spentSecs || 0) + (Date.now() - ev.curStart) / 1000;
    ev.curTaskId = curId;
    ev.curStart = Date.now();
  }
}

function pauseEvent(ev, auto = false, asOf = Date.now()) {
  if (ev.paused || ev.status !== 'active') return;
  const cur = pendingTasks(ev)[0];
  if (cur) cur.spentSecs = (cur.spentSecs || 0) + Math.max(0, asOf - ev.curStart) / 1000;
  ev.paused = true;
  ev.autoPaused = auto;
  ev.curStart = Date.now();
  save();
}
function resumeEvent(ev) {
  ev.paused = false;
  ev.autoPaused = false;
  ev.curStart = Date.now();
  save();
}

/** Move the whole event target (arrive/leave time) by `mins`, handling midnight rollover. */
function shiftEventTime(ev, mins) {
  const d = new Date(targetAt(ev).getTime() + mins * 60000);
  ev.date = todayStr(d);
  ev.time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  resetChimeFlags(ev);
  save();
}
function resetChimeFlags(ev) {
  const secs = (leaveAt(ev).getTime() - Date.now()) / 1000;
  if (secs > 0) ev.chimedLeave = false;
  if (secs > 300) ev.chimed5 = false;
}

function startEvent(ev) {
  ev.status = 'active';
  ev.openedAt = Date.now();
  // if there's real buffer before you must begin, hold in a relaxed pre-start
  // state instead of starting the first task's clock right away
  const startByMs = leaveAt(ev).getTime() - totalEstMins(ev.tasks) * 60000;
  if (startByMs - Date.now() > 60000) {
    ev.notStarted = true;
    ev.curTaskId = null;
    ev.curStart = null;
  } else {
    beginRoutine(ev);
  }
  save();
}

/** Leave the waiting room: the clock now runs on the first task. */
function beginRoutine(ev) {
  ev.notStarted = false;
  ev.paused = false;
  ev.startedAt = Date.now();
  const cur = pendingTasks(ev)[0];
  ev.curTaskId = cur ? cur.id : null;
  ev.curStart = Date.now();
  save();
}

function completeTask(ev, taskId) {
  const t = ev.tasks.find((x) => x.id === taskId);
  if (!t || t.done) return;
  const wasCurrent = ev.status === 'active' && ev.curTaskId === t.id;
  if (wasCurrent && !ev.paused) {
    t.spentSecs = (t.spentSecs || 0) + (Date.now() - ev.curStart) / 1000;
  }
  t.done = true;
  t.actualSecs = t.spentSecs || 0;
  // checked off out of order (or while paused) with no real time on the
  // clock → treat as "done ahead of time": no fake duration, no learning
  t.untimed = !wasCurrent && t.actualSecs < 20;
  t.doneAt = Date.now();
  buzz(35);
  reconcileCurrent(ev);
  if (pendingTasks(ev).length === 0 && ev.status === 'active') {
    finishEvent(ev);
    save();
    go('summary', { id: ev.id });
    return;
  }
  save();
}

function uncompleteTask(ev, taskId) {
  const t = ev.tasks.find((x) => x.id === taskId);
  if (!t) return;
  t.done = false;
  t.actualSecs = null;
  t.untimed = false;
  reconcileCurrent(ev);
  save();
}

function finishEvent(ev) {
  ev.status = 'done';
  ev.finishedAt = Date.now();
  ev.resultSlackSecs = (leaveAt(ev).getTime() - Date.now()) / 1000;
  learnFromEvent(ev);
}

/** The quiet superpower: remember how long things ACTUALLY take. */
function learnFromEvent(ev) {
  for (const t of ev.tasks) {
    if (!t.done || t.untimed || !t.actualSecs || t.actualSecs < 20) continue;
    const key = t.name.trim().toLowerCase();
    if (!key) continue;
    const h = S.history[key];
    const actualMins = Math.max(1, Math.round(t.actualSecs / 60));
    if (h && !h.seed) {
      h.samples = (h.samples || []).slice(-9);
      h.samples.push(actualMins);
      h.estMins = Math.max(1, Math.round(h.samples.reduce((a, b) => a + b, 0) / h.samples.length));
      h.count++;
      h.icon = t.icon;
      h.lastAt = Date.now();
    } else {
      S.history[key] = { name: t.name.trim(), icon: t.icon, estMins: actualMins, count: 1, samples: [actualMins], lastAt: Date.now() };
    }
  }
}
function noteTaskUsed(name, estMins, icon) {
  const key = name.trim().toLowerCase();
  if (!key) return;
  if (!S.history[key]) S.history[key] = { name: name.trim(), icon, estMins, count: 0, seed: true };
}
function presetList() {
  return Object.values(S.history)
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name))
    .slice(0, 14);
}
function suggestEst(name) {
  const h = S.history[name.trim().toLowerCase()];
  return h ? h.estMins : null;
}

/* ---------------- router ---------------- */
let route = { page: 'home' };
function go(page, params = {}) {
  route = { page, ...params };
  window.scrollTo(0, 0);
  render();
}

/* ---------------- render root ---------------- */
const app = $('#app');
function render() {
  app.classList.remove('page-enter');
  void app.offsetWidth; // restart animation
  app.classList.add('page-enter');
  app.classList.toggle('has-dock', route.page === 'live');
  switch (route.page) {
    case 'home': renderHome(); break;
    case 'edit': renderEdit(); break;
    case 'live': renderLive(); break;
    case 'summary': renderSummary(); break;
    case 'routines': renderRoutines(); break;
    case 'routine-edit': renderRoutineEdit(); break;
    case 'insights': renderInsights(); break;
    default: renderHome();
  }
}

/* ===================================================================
   HOME
   =================================================================== */
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late 🌙';
  if (h < 12) return 'Good morning 🌷';
  if (h < 17) return 'Good afternoon 🌼';
  return 'Good evening 🌙';
}

function renderHome() {
  // sweep abandoned empty drafts so they don't clutter the home screen
  const before = S.events.length;
  S.events = S.events.filter((e) => !(e.status === 'setup' && !e.tasks.length && !e.name.trim()));
  if (S.events.length !== before) save();
  const active = S.events.filter((e) => e.status === 'active');
  const upcoming = S.events.filter((e) => e.status === 'setup')
    .sort((a, b) => targetAt(a) - targetAt(b));
  const past = S.events.filter((e) => e.status === 'done')
    .sort((a, b) => b.finishedAt - a.finishedAt);
  const cp = fmtClockParts(new Date());

  app.innerHTML = `
    <div class="home-head">
      <div class="home-clock" data-home-clock>${cp.time}<span class="ampm">${cp.ap}</span></div>
      <div class="home-greet">${greeting()}</div>
    </div>

    ${active.map((ev) => homeEventCard(ev, true)).join('')}
    ${upcoming.map((ev) => homeEventCard(ev, false)).join('')}

    ${!active.length && !upcoming.length ? `
      <div class="card empty">
        <span class="big">🎀</span>
        Nothing planned yet.<br>Tell me when you need to be somewhere<br>and I'll walk you out the door on time.
      </div>` : ''}

    <div style="margin-top:16px">
      <button class="btn btn-primary btn-big" data-act="new-event">＋ &nbsp;Get ready for something</button>
    </div>

    <div class="section-label">My routines</div>
    ${S.routines.length ? S.routines.map((r) => `
      <button class="routine-card" data-act="use-routine" data-id="${r.id}">
        <span class="ev-emoji">${r.icon}</span>
        <span style="min-width:0">
          <div class="ev-name">${esc(r.name)}</div>
          <div class="ev-meta">${r.tasks.length} steps · ${fmtDur(r.tasks.reduce((s, t) => s + t.estMins, 0))}</div>
        </span>
        <span style="margin-left:auto;color:var(--green-deep);font-weight:800;font-size:0.84rem">Use ›</span>
      </button>`).join('') : `
      <div class="card empty" style="padding:18px">Save a routine after you finish getting ready —<br>next time it's one tap. 🌿</div>`}
    ${S.routines.length ? `<button class="btn-link" data-act="manage-routines">Manage routines</button>` : ''}

    ${Object.values(S.history).some((h) => h.count > 0) ? `
      <div class="section-label">My pace</div>
      <button class="event-card" data-act="insights" style="padding:14px 18px">
        <div class="ev-row1">
          <span class="ev-emoji" style="background:var(--lav)">⏱️</span>
          <span style="min-width:0">
            <div class="ev-name">What things really take</div>
            <div class="ev-meta">learned from your timed routines</div>
          </span>
          <span style="margin-left:auto;color:var(--ink-faint)">›</span>
        </div>
      </button>` : ''}

    ${past.length ? `
      <div class="label-row">
        <div class="section-label" style="margin:0 4px">How it went</div>
        <button class="btn-link" data-act="clear-past" style="padding:6px 4px">Clear all</button>
      </div>
      <div class="card" style="padding:8px 16px">
        ${past.map((ev) => {
          const ok = ev.resultSlackSecs >= 0;
          return `<div class="past-row" data-past-id="${ev.id}">
            <button class="past-open" data-act="open-summary" data-id="${ev.id}" aria-label="View details">
              <span>${ev.icon}</span>
              <span class="past-name">${esc(ev.name || 'Getting ready')}</span>
              <span class="badge ${ok ? 'ok' : 'late'}">${ok ? `${fmtMinsLoose(ev.resultSlackSecs)} early 🎉` : `${fmtMinsLoose(ev.resultSlackSecs)} late`}</span>
            </button>
            <button class="past-del" data-act="del-past" data-id="${ev.id}" aria-label="Delete this">×</button>
          </div>`;
        }).join('')}
      </div>` : ''}
  `;

  app.onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'new-event') { const ev = newEvent(); go('edit', { id: ev.id }); }
    if (act === 'open-event') {
      const ev = getEvent(btn.dataset.id);
      go(ev.status === 'active' ? 'live' : 'edit', { id: ev.id });
    }
    if (act === 'use-routine') {
      const r = S.routines.find((x) => x.id === btn.dataset.id);
      const ev = newEvent();
      ev.name = r.name; ev.icon = r.icon;
      ev.tasks = r.tasks.map((t) => makeTask(t.name, t.estMins));
      ev.tasks.forEach((t, i) => { t.icon = r.tasks[i].icon || t.icon; });
      save();
      go('edit', { id: ev.id });
    }
    if (act === 'manage-routines') go('routines');
    if (act === 'insights') go('insights');
    if (act === 'open-summary') go('summary', { id: btn.dataset.id, replay: true });
    if (act === 'del-past') {
      const row = btn.closest('.past-row');
      const id = btn.dataset.id;
      if (row) {
        row.classList.add('removing');
        setTimeout(() => { S.events = S.events.filter((x) => x.id !== id); save(); renderHome(); }, 200);
      } else {
        S.events = S.events.filter((x) => x.id !== id); save(); renderHome();
      }
    }
    if (act === 'clear-past') {
      const n = S.events.filter((x) => x.status === 'done').length;
      if (confirm(`Clear all ${n} finished ${n === 1 ? 'event' : 'events'} from your history?`)) {
        S.events = S.events.filter((x) => x.status !== 'done');
        save();
        renderHome();
      }
    }
  };
}

function homeEventCard(ev, isActive) {
  const sch = computeSchedule(ev);
  const T = terms(ev);
  const cd = liveCountdown(ev);
  const st = slackStatus(sch.slackSecs);
  const dayLabel = ev.date === todayStr() ? '' :
    (ev.date === todayStr(new Date(Date.now() + 86400000)) ? 'tomorrow · ' : ev.date + ' · ');
  let meta;
  if (isActive && ev.notStarted) {
    meta = `<span class="badge ok" style="margin-left:0">⏳ starts ${fmtClock(new Date(sch.startByMs))}</span>`;
  } else if (isActive) {
    meta = `<span class="badge ${st.cls === 'late' ? 'late' : 'ok'}" style="margin-left:0">${ev.paused ? '⏸ paused · ' : ''}${st.icon} ${st.label}</span>`;
  } else {
    meta = `${dayLabel}${T.homeMeta} <b>${fmtClock(sch.leaveAt)}</b> · ${pendingTasks(ev).length} tasks · ${fmtDur(totalEstMins(ev.tasks))}`;
  }
  return `
    <button class="event-card ${isActive ? 'active-ev' : ''}" data-act="open-event" data-id="${ev.id}">
      <div class="ev-row1">
        <span class="ev-emoji">${ev.icon}</span>
        <span style="min-width:0">
          <div class="ev-name">${esc(ev.name || 'Getting ready')}</div>
          <div class="ev-meta">${meta}</div>
        </span>
        <span class="ev-count" data-home-count data-id="${ev.id}">
          <div class="n">${fmtCount(cd.secs)}</div>
          <div class="lbl">${cd.secs < 0 ? cd.past : cd.until}</div>
        </span>
      </div>
    </button>`;
}

/* ===================================================================
   shared: task list renderer
   opts: { live, schRows (clock projections), onChange }
   =================================================================== */
function taskRowsHTML(tasks, opts = {}) {
  const projByTask = {};
  (opts.schRows || []).forEach((r) => { projByTask[r.t.id] = r; });
  return tasks.map((t) => {
    const proj = projByTask[t.id];
    let timeline = '';
    if (t.done && t.untimed) {
      timeline = `<span class="diff-under">done ahead of time ✓</span>`;
    } else if (t.done) {
      const actual = Math.round((t.actualSecs || 0) / 60);
      const diff = actual - t.estMins;
      const diffStr = diff > 0 ? `<span class="diff-over">+${fmtDur(diff)}</span>`
        : diff < 0 ? `<span class="diff-under">−${fmtDur(-diff)}</span>` : `<span class="diff-under">on the dot</span>`;
      timeline = `took ${fmtDur(Math.max(1, actual))} · ${diffStr}`;
    } else if (proj) {
      timeline = `<span data-proj="${t.id}">${fmtClock(proj.start)} – ${fmtClock(proj.end)}</span> · <span class="est-pill">${fmtDur(t.estMins)}</span>`;
    } else {
      timeline = `<span class="est-pill">${fmtDur(t.estMins)}</span>`;
    }
    return `
      <div class="t-row ${t.done ? 'done-row' : ''}" data-task="${t.id}">
        ${t.done ? '' : `<button class="drag-handle" data-drag aria-label="Reorder">⠿</button>`}
        <span class="t-icon">${t.icon}</span>
        <div class="t-main" data-taprow>
          <div class="t-name">${esc(t.name)}</div>
          <div class="t-time">${timeline}</div>
        </div>
        ${opts.noCheck ? '' : `<button class="t-check" data-check aria-label="Done">✓</button>`}
        <div class="t-actions">
          <button class="chip" data-est="-5">−5</button>
          <button class="chip" data-est="-1">−1</button>
          <input class="est-input" data-est-input type="number" inputmode="numeric" min="1" max="240" value="${t.estMins}" aria-label="Minutes">
          <button class="chip" data-est="1">＋1</button>
          <button class="chip" data-est="5">＋5</button>
          <input class="est-slider" data-est-slider type="range" min="1" max="60" step="1" value="${clamp(t.estMins, 1, 60)}" aria-label="Minutes slider">
          ${opts.live && !t.done ? `<button class="chip chip-green on" data-donext>Do next</button>` : ''}
          <button class="chip" data-del style="color:var(--coral-deep)">Remove</button>
        </div>
      </div>`;
  }).join('');
}

function bindTaskList(listEl, tasks, ev, opts = {}) {
  const onChange = opts.onChange || (() => {});
  listEl.onclick = (e) => {
    const row = e.target.closest('.t-row');
    if (!row) return;
    const t = tasks.find((x) => x.id === row.dataset.task);
    if (!t) return;

    if (e.target.closest('[data-check]')) {
      if (ev) {
        if (t.done) uncompleteTask(ev, t.id);
        else {
          e.target.closest('[data-check]').classList.add('checked', 'pop-done');
          setTimeout(() => completeTask(ev, t.id) || onChange('structure'), 160);
          return;
        }
      } else {
        // planning ahead: tasks finished before the routine even starts
        t.done = !t.done;
        t.untimed = t.done;
        t.actualSecs = t.done ? 0 : null;
        save();
      }
      onChange('structure');
      return;
    }
    const estBtn = e.target.closest('[data-est]');
    if (estBtn) {
      t.estMins = clamp(t.estMins + Number(estBtn.dataset.est), 1, 240);
      syncRowEst(row, t);
      save();
      onChange('times');
      return;
    }
    if (e.target.closest('[data-del]')) {
      tasks.splice(tasks.indexOf(t), 1);
      if (ev) reconcileCurrent(ev);
      save();
      onChange('structure');
      return;
    }
    if (e.target.closest('[data-donext]')) {
      // move right after the current (first pending) task
      const pend = tasks.filter((x) => !x.done);
      tasks.splice(tasks.indexOf(t), 1);
      const cur = pend[0] === t ? null : tasks.filter((x) => !x.done)[0];
      const at = cur ? tasks.indexOf(cur) + 1 : tasks.length;
      tasks.splice(at, 0, t);
      if (ev) reconcileCurrent(ev);
      save();
      onChange('structure');
      return;
    }
    if (e.target.closest('[data-taprow]')) {
      const was = row.classList.contains('expanded');
      $$('.t-row.expanded', listEl).forEach((r) => r.classList.remove('expanded'));
      if (!was) row.classList.add('expanded');
    }
  };
  // typed minutes + slider, updated in place so the strip stays open
  listEl.oninput = (e) => {
    const row = e.target.closest('.t-row');
    if (!row) return;
    const t = tasks.find((x) => x.id === row.dataset.task);
    if (!t) return;
    if (e.target.matches('[data-est-input]')) {
      const v = parseInt(e.target.value, 10);
      if (!(v >= 1)) return;
      t.estMins = clamp(v, 1, 240);
      syncRowEst(row, t, 'input');
    } else if (e.target.matches('[data-est-slider]')) {
      t.estMins = Number(e.target.value);
      syncRowEst(row, t, 'slider');
    } else return;
    save();
    onChange('times');
  };
  enableDrag(listEl, tasks, ev, onChange);
}

/** Refresh a row's estimate displays without re-rendering (keeps the strip open). */
function syncRowEst(row, t, skip) {
  const inp = $('[data-est-input]', row);
  if (inp && skip !== 'input') inp.value = t.estMins;
  const sl = $('[data-est-slider]', row);
  if (sl && skip !== 'slider') sl.value = clamp(t.estMins, 1, 60);
  const pill = $('.est-pill', row);
  if (pill) pill.textContent = fmtDur(t.estMins);
}

/* ---------------- drag to reorder ---------------- */
function enableDrag(listEl, tasks, ev, onChange) {
  listEl.onpointerdown = (e) => {
    const handle = e.target.closest('[data-drag]');
    if (!handle) return;
    e.preventDefault();
    const row = handle.closest('.t-row');
    const rows = $$('.t-row:not(.done-row)', listEl);
    const idx = rows.indexOf(row);
    if (idx < 0) return;
    const rowH = row.offsetHeight;
    const startY = e.clientY;
    let curIdx = idx;
    row.classList.add('dragging');
    row.setPointerCapture(e.pointerId);

    const onMove = (me) => {
      const dy = me.clientY - startY;
      row.style.transform = `translateY(${dy}px)`;
      const newIdx = clamp(Math.round(dy / rowH) + idx, 0, rows.length - 1);
      if (newIdx !== curIdx) {
        curIdx = newIdx;
        rows.forEach((r, i) => {
          if (r === row) return;
          let shift = 0;
          if (idx < curIdx && i > idx && i <= curIdx) shift = -rowH;
          if (idx > curIdx && i < idx && i >= curIdx) shift = rowH;
          r.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      }
    };
    const onUp = () => {
      row.releasePointerCapture(e.pointerId);
      row.removeEventListener('pointermove', onMove);
      row.removeEventListener('pointerup', onUp);
      row.removeEventListener('pointercancel', onUp);
      rows.forEach((r) => { r.style.transform = ''; r.classList.remove('dragging'); });
      if (curIdx !== idx) {
        // reorder only the visible rows, leaving any task not shown in this
        // list (e.g. the live "current" hero task, done tasks) in place
        const ids = rows.map((r) => r.dataset.task);
        const movedId = ids.splice(idx, 1)[0];
        ids.splice(curIdx, 0, movedId);
        const visible = new Set(ids);
        const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
        let k = 0;
        for (let i = 0; i < tasks.length; i++) {
          if (visible.has(tasks[i].id)) tasks[i] = byId[ids[k++]];
        }
        if (ev) reconcileCurrent(ev);
        save();
        onChange && onChange('structure');
      }
    };
    row.addEventListener('pointermove', onMove);
    row.addEventListener('pointerup', onUp);
    row.addEventListener('pointercancel', onUp);
  };
}

/* ---------------- add bar (shared by editor + live dock) ---------------- */
const DUR_CHOICES = [2, 5, 10, 15, 20, 30];
function addBarHTML(opts = {}) {
  const sel = S.lastDur || 10;
  return `
    <div class="addbar">
      <div class="chip-scroll" data-presets>
        ${presetList().map((p) => `
          <button class="chip" data-preset="${esc(p.name)}">${p.icon} ${esc(p.name)} · ${fmtDur(p.estMins)}${p.count > 0 ? ' ✨' : ''}</button>
        `).join('')}
      </div>
      <div class="add-input-row">
        <span class="add-emoji" data-add-emoji>🌷</span>
        <input class="add-input" data-add-input type="text" placeholder="Add a task…" enterkeyhint="done" autocomplete="off">
        <button class="add-go" data-add-go aria-label="Add task">＋</button>
      </div>
      <div class="dur-row">
        ${DUR_CHOICES.map((d) => `<button class="chip ${d === sel ? 'on' : ''}" data-dur="${d}">${d}m</button>`).join('')}
        <input class="dur-custom" data-dur-custom type="number" inputmode="numeric" min="1" max="240" placeholder="…m" aria-label="Custom minutes">
        ${opts.live ? `
          <span class="next-toggle" data-next-toggle>
            <button data-pos="next">Next</button>
            <button data-pos="last" class="on">Last</button>
          </span>` : ''}
      </div>
    </div>`;
}

function bindAddBar(rootEl, ev, opts = {}) {
  const onAdd = opts.onAdd || (() => {});
  const input = $('[data-add-input]', rootEl);
  const emojiEl = $('[data-add-emoji]', rootEl);
  let dur = S.lastDur || 10;
  let durExplicit = false;
  let pos = 'last';

  input.oninput = () => {
    emojiEl.textContent = input.value.trim() ? guessIcon(input.value) : '🌷';
    if (!durExplicit) {
      const sug = suggestEst(input.value);
      if (sug) setDur(sug, false);
    }
  };
  function setDur(d, explicit) {
    dur = d;
    if (explicit) { durExplicit = true; S.lastDur = d; save(); }
    $$('[data-dur]', rootEl).forEach((c) => c.classList.toggle('on', Number(c.dataset.dur) === d));
    const custom = $('[data-dur-custom]', rootEl);
    if (custom && Number(custom.value) !== d) custom.value = '';
  }
  rootEl.addEventListener('input', (e) => {
    if (!e.target.matches('[data-dur-custom]')) return;
    const v = parseInt(e.target.value, 10);
    if (!(v >= 1)) return;
    dur = clamp(v, 1, 240);
    durExplicit = true;
    S.lastDur = dur;
    save();
    $$('[data-dur]', rootEl).forEach((c) => c.classList.remove('on'));
  });
  rootEl.addEventListener('click', (e) => {
    const durBtn = e.target.closest('[data-dur]');
    if (durBtn) { setDur(Number(durBtn.dataset.dur), true); return; }
    const posBtn = e.target.closest('[data-pos]');
    if (posBtn) {
      pos = posBtn.dataset.pos;
      $$('[data-pos]', rootEl).forEach((b) => b.classList.toggle('on', b === posBtn));
      return;
    }
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      const h = S.history[preset.dataset.preset.toLowerCase()];
      addTask(h.name, h.estMins, h.icon);
      return;
    }
    if (e.target.closest('[data-add-go]')) submit();
  });
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };

  function submit() {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const sug = durExplicit ? dur : (suggestEst(name) || dur);
    addTask(name, sug, guessIcon(name));
    input.value = '';
    emojiEl.textContent = '🌷';
    durExplicit = false;
    input.focus();
  }
  function addTask(name, estMins, icon) {
    const t = makeTask(name, estMins);
    t.icon = icon || t.icon;
    noteTaskUsed(name, estMins, t.icon);
    if (pos === 'next' && ev && ev.status === 'active') {
      const pend = pendingTasks(ev);
      const at = pend.length ? ev.tasks.indexOf(pend[0]) + 1 : ev.tasks.length;
      ev.tasks.splice(at, 0, t);
    } else {
      ev.tasks.push(t);
    }
    if (ev.status === 'active') reconcileCurrent(ev);
    save();
    onAdd();
  }
}

/* ===================================================================
   EDITOR
   =================================================================== */
function renderEdit() {
  const ev = getEvent(route.id);
  if (!ev) return go('home');
  const tomorrow = todayStr(new Date(Date.now() + 86400000));

  app.innerHTML = `
    <div class="page-top">
      <button class="btn-icon" data-act="back" aria-label="Back">‹</button>
      <h1>Plan it out</h1>
      <button class="btn-icon" data-act="delete" aria-label="Delete" style="color:var(--coral-deep)">🗑</button>
    </div>

    <div class="card">
      <div class="name-row">
        <span class="ev-emoji" data-ev-emoji>${ev.icon}</span>
        <input class="input-name" data-name type="text" placeholder="What's the occasion?" value="${esc(ev.name)}">
      </div>
    </div>

    <div class="card">
      <div class="field-label" data-time-label>${terms(ev).timeLabel}</div>
      <input class="time-input" data-time type="time" value="${ev.time}">
      <div class="chip-row" style="margin-top:12px">
        <button class="chip ${ev.date !== tomorrow ? 'on' : ''}" data-day="today">Today</button>
        <button class="chip ${ev.date === tomorrow ? 'on' : ''}" data-day="tomorrow">Tomorrow</button>
      </div>
      <div class="field-label" style="margin-top:18px">🚗 Travel time</div>
      <div class="chip-row" data-travel-row>
        ${[0, 10, 15, 20, 30, 45, 60].map((m) =>
          `<button class="chip chip-green ${Number(ev.travelMins) === m ? 'on' : ''}" data-travel="${m}">${m === 0 ? 'None' : fmtDur(m)}</button>`).join('')}
      </div>
      <div class="derived-line" data-derived></div>
    </div>

    <div class="card">
      <div class="field-label">🌷 Steps to get ready <span style="color:var(--ink-faint)">· tap a step to tweak, drag ⠿ to reorder</span></div>
      <div class="t-list" data-tlist></div>
      <div data-addbar>${addBarHTML()}</div>
    </div>

    <div class="footer-cta">
      <div class="start-hint" data-start-hint></div>
      <button class="btn btn-primary btn-big" data-act="start" ${ev.tasks.length ? '' : 'disabled'}>Start getting ready 💫</button>
      <div style="text-align:center;margin-top:6px">
        <button class="btn-link" data-act="save-routine">Save these steps as a routine</button>
      </div>
    </div>
  `;

  const onListChange = (kind) => {
    if (kind === 'times') { refreshDerived(); updateProjections(); }
    else refresh();
  };
  const updateProjections = () => {
    for (const r of computeSchedule(ev).rows) {
      const el = $(`[data-proj="${r.t.id}"]`);
      if (el) el.textContent = `${fmtClock(r.start)} – ${fmtClock(r.end)}`;
    }
  };
  const refreshList = () => {
    const sch = computeSchedule(ev);
    $('[data-tlist]').innerHTML = taskRowsHTML(ev.tasks, { schRows: sch.rows });
    bindTaskList($('[data-tlist]'), ev.tasks, null, { onChange: onListChange });
    $('[data-act="start"]').disabled = !pendingTasks(ev).length;
  };
  const refreshDerived = () => {
    const sch = computeSchedule(ev);
    const T = terms(ev);
    const total = totalEstMins(ev.tasks);
    const startBy = new Date(sch.startByMs);
    const late = startBy.getTime() < Date.now();
    const goalLine = T.out
      ? `Leave home by <b>${fmtClock(sch.leaveAt)}</b> · arrive <b>${fmtClock(sch.targetAt)}</b><br>`
      : `Be ready by <b>${fmtClock(sch.targetAt)}</b><br>`;
    $('[data-derived]').innerHTML = goalLine +
      (ev.tasks.length
        ? `${fmtDur(total)} of steps → start by <b>${fmtClock(startBy)}</b>${late ? ' — that\'s already passed, hustle! 🐇' : ''}`
        : 'Add your steps below and I\'ll tell you when to start.');
    $('[data-derived]').classList.toggle('warn', late && ev.tasks.length > 0);
    $('[data-start-hint]').innerHTML = ev.tasks.length
      ? (late ? `You're starting <b>${fmtMinsLoose((Date.now() - startBy.getTime()) / 1000)} late</b> — I'll keep you honest 💪`
              : `Start by <b>${fmtClock(startBy)}</b> ${T.startTail}`)
      : '';
  };
  const refresh = () => { refreshList(); refreshDerived(); };
  refresh();

  bindAddBar($('[data-addbar]'), ev, { onAdd: refresh });

  $('[data-name]').oninput = (e) => {
    ev.name = e.target.value;
    ev.icon = guessEventIcon(ev.name);
    $('[data-ev-emoji]').textContent = ev.icon;
    save();
  };
  $('[data-time]').onchange = (e) => {
    if (e.target.value) ev.time = e.target.value;
    save(); refreshDerived();
  };
  app.onclick = (e) => {
    const day = e.target.closest('[data-day]');
    if (day) {
      ev.date = day.dataset.day === 'tomorrow' ? tomorrow : todayStr();
      $$('[data-day]').forEach((c) => c.classList.toggle('on', c === day));
      save(); refreshDerived(); return;
    }
    const tr = e.target.closest('[data-travel]');
    if (tr) {
      ev.travelMins = Number(tr.dataset.travel);
      $$('[data-travel]').forEach((c) => c.classList.toggle('on', c === tr));
      $('[data-time-label]').textContent = terms(ev).timeLabel;
      save(); refreshDerived(); return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'back') go('home');
    if (act.dataset.act === 'delete') {
      if (confirm('Delete this event?')) {
        S.events = S.events.filter((x) => x.id !== ev.id);
        save(); go('home');
      }
    }
    if (act.dataset.act === 'start') {
      if (!ev.name.trim()) { ev.name = 'Getting ready'; save(); }
      startEvent(ev);
      go('live', { id: ev.id });
    }
    if (act.dataset.act === 'save-routine') saveAsRoutine(ev);
  };
}

function saveAsRoutine(ev) {
  if (!ev.tasks.length) return;
  const name = prompt('Name this routine:', ev.name || 'My routine');
  if (!name) return;
  S.routines.push({
    id: uid(), name, icon: guessEventIcon(name),
    tasks: ev.tasks.map((t) => ({ name: t.name, icon: t.icon, estMins: t.estMins })),
  });
  save();
  alert('Saved! It\'ll be one tap on the home screen. 🌿');
}

/* ===================================================================
   LIVE MODE
   =================================================================== */
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* not critical */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkAway();
    if (route.page === 'live') keepAwake();
  }
});

/* If the app was gone for a long while (phone pocketed, did other things),
   don't let that gap count against the current task: bank time only up to
   when we last saw the clock, then auto-pause. */
const AWAY_MS = 20 * 60 * 1000;
function checkAway() {
  const last = S.lastTick || 0;
  const gone = Date.now() - last;
  if (!last || gone < AWAY_MS) return;
  let touched = false;
  for (const ev of S.events) {
    if (ev.status === 'active' && !ev.paused && !ev.notStarted) {
      pauseEvent(ev, true, Math.max(ev.curStart, last));
      touched = true;
    }
  }
  S.lastTick = Date.now();
  save();
  if (touched && (route.page === 'live' || route.page === 'home')) render();
}

function renderLive() {
  const ev = getEvent(route.id);
  if (!ev || ev.status !== 'active') return go('home');
  keepAwake();
  const T = terms(ev);

  app.innerHTML = `
    <div class="page-top">
      <button class="btn-icon" data-act="back" aria-label="Home">‹</button>
      <h1 style="font-size:1.1rem;color:var(--ink-soft)">${ev.icon} ${esc(ev.name || 'Getting ready')}</h1>
      <button class="btn-icon" data-act="sound" aria-label="Chimes" title="Chimes on/off">${S.sound ? '🔔' : '🔕'}</button>
      <button class="btn-icon" data-act="finish" aria-label="Finish" title="Finish now">🏁</button>
    </div>

    <div class="live-head">
      <div class="live-count" data-countdown>–:–</div>
      <div class="live-count-lbl" data-countdown-lbl>${T.countUntil}</div>
      <div class="clock-strip">
        <span class="clock-bit">now <b data-now-clock></b></span>
        <button class="clock-bit clock-edit" data-act="edit-time"><span data-goal-word>${T.goalEmoji} ${T.goalWord}</span> <b data-leave-clock></b> ✎</button>
        <span class="clock-bit" data-arrive-bit ${T.out ? '' : 'style="display:none"'}>📍 arrive <b data-arrive-clock></b></span>
      </div>
      <div><span class="status-pill ok" data-status></span></div>
      <div style="margin-top:8px;color:var(--ink-soft);font-weight:700;font-size:0.88rem" data-readyline></div>
    </div>

    <div class="card" data-time-panel style="display:none;margin-bottom:14px">
      <div class="field-label" data-panel-label>${T.timeLabel}</div>
      <input class="time-input" data-live-time type="time" value="${ev.time}">
      <div class="field-label" style="margin-top:16px">🚗 Travel time</div>
      <div class="chip-row">
        ${[0, 10, 15, 20, 30, 45, 60].map((m) =>
          `<button class="chip chip-green ${Number(ev.travelMins) === m ? 'on' : ''}" data-ltravel="${m}">${m === 0 ? 'None' : fmtDur(m)}</button>`).join('')}
      </div>
      <div class="field-label" style="margin-top:16px">⏰ Or nudge the whole plan</div>
      <div class="chip-row">
        <button class="chip" data-push="5">＋5m later</button>
        <button class="chip" data-push="15">＋15m later</button>
        <button class="chip" data-push="-5">−5m earlier</button>
      </div>
      <button class="btn btn-soft btn-big" style="margin-top:16px" data-act="close-time-panel">Done</button>
    </div>

    <div data-hero></div>

    <div class="card live-list-card">
      <div class="section-label" style="margin:10px 4px 4px">Up next</div>
      <div class="t-list" data-tlist></div>
      <div class="done-section" data-done-section>
        <button class="done-toggle" data-done-toggle>
          <span>✓ Done</span><span data-done-count></span><span class="arrow">▾</span>
        </button>
        <div class="done-body"><div class="t-list" data-donelist></div></div>
      </div>
    </div>

    <div style="text-align:center;margin-top:4px">
      <button class="btn-link btn-danger-link" data-act="cancel-session">Cancel &amp; discard this session</button>
    </div>

    <div class="dock"><div class="dock-inner" data-addbar>${addBarHTML({ live: true })}</div></div>
  `;

  const structure = () => {
    if (ev.status !== 'active') return; // completed via last check-off
    renderHero(ev);
    renderUpNext(ev);
    updateLive(ev);
  };
  structure();
  bindAddBar($('[data-addbar]'), ev, { onAdd: structure });

  $('[data-done-toggle]').onclick = () => $('[data-done-section]').classList.toggle('open');

  $('[data-live-time]').onchange = (e) => {
    if (!e.target.value) return;
    ev.time = e.target.value;
    resetChimeFlags(ev);
    save();
    updateLive(ev);
  };

  app.onclick = (e) => {
    const tr = e.target.closest('[data-ltravel]');
    if (tr) {
      ev.travelMins = Number(tr.dataset.ltravel);
      $$('[data-ltravel]').forEach((c) => c.classList.toggle('on', c === tr));
      $('[data-panel-label]').textContent = terms(ev).timeLabel;
      resetChimeFlags(ev);
      save();
      updateLive(ev);
      return;
    }
    const push = e.target.closest('[data-push]');
    if (push) {
      shiftEventTime(ev, Number(push.dataset.push));
      $('[data-live-time]').value = ev.time;
      updateLive(ev);
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'back') go('home');
    if (act.dataset.act === 'sound') {
      S.sound = !S.sound;
      save();
      act.textContent = S.sound ? '🔔' : '🔕';
      unlockAudio();
      if (S.sound) chime('pop');
    }
    if (act.dataset.act === 'edit-time') {
      const panel = $('[data-time-panel]');
      panel.style.display = panel.style.display === 'none' ? '' : 'none';
    }
    if (act.dataset.act === 'close-time-panel') $('[data-time-panel]').style.display = 'none';
    if (act.dataset.act === 'hero-begin') { beginRoutine(ev); structure(); }
    if (act.dataset.act === 'hero-pause') { pauseEvent(ev); renderHero(ev); updateLive(ev); }
    if (act.dataset.act === 'hero-resume') { resumeEvent(ev); renderHero(ev); updateLive(ev); }
    if (act.dataset.act === 'cancel-session') {
      if (confirm('Discard this session? It won\'t be saved to your history, and any timings from it won\'t be learned.')) {
        S.events = S.events.filter((x) => x.id !== ev.id);
        save(); go('home');
      }
    }
    if (act.dataset.act === 'finish') {
      if (pendingTasks(ev).length === 0 || confirm('Finish now and skip the remaining tasks?')) {
        finishEvent(ev); save(); go('summary', { id: ev.id });
      }
    }
    if (act.dataset.act === 'hero-done') {
      const cur = pendingTasks(ev)[0];
      if (cur) {
        completeTask(ev, cur.id);
        if (ev.status === 'active') structure();
      }
    }
    if (act.dataset.act === 'hero-later') {
      const pend = pendingTasks(ev);
      if (pend.length > 1) {
        const cur = pend[0];
        const i = ev.tasks.indexOf(cur);
        const j = ev.tasks.indexOf(pend[1]);
        ev.tasks.splice(i, 1);
        ev.tasks.splice(j, 0, cur);
        reconcileCurrent(ev);
        save(); structure();
      }
    }
    if (act.dataset.act === 'hero-plus5') {
      const cur = pendingTasks(ev)[0];
      if (cur) {
        cur.estMins += 5;
        save();
        const estEl = $('[data-hero-est]');
        if (estEl) estEl.textContent = `of ${fmtDur(cur.estMins)} planned`;
        updateLive(ev);
      }
    }
  };
}

function renderHero(ev) {
  const cur = pendingTasks(ev)[0];
  const heroEl = $('[data-hero]');
  if (!heroEl) return;
  if (!cur) { heroEl.innerHTML = ''; return; }

  if (ev.notStarted) {
    const startBy = new Date(computeSchedule(ev).startByMs);
    heroEl.innerHTML = `
      <div class="hero-task">
        <div class="hero-top">
          <span class="hero-icon">${cur.icon}</span>
          <div style="min-width:0">
            <div class="hero-name">First up: ${esc(cur.name)}</div>
            <div class="hero-sub">${fmtDur(cur.estMins)} planned</div>
          </div>
        </div>
        <div class="pause-banner waiting-banner">
          🌿 No rush yet — you don't need to start until <b>${fmtClock(startBy)}</b>.<br>
          I'll start the clock then, or begin early whenever you're ready.
        </div>
        <div class="hero-btns">
          <button class="btn btn-green" style="flex:1" data-act="hero-begin">Start now ▶</button>
        </div>
      </div>`;
    return;
  }

  if (ev.paused) {
    const banked = Math.round(cur.spentSecs || 0);
    heroEl.innerHTML = `
      <div class="hero-task">
        <div class="hero-top">
          <span class="hero-icon">${cur.icon}</span>
          <div style="min-width:0">
            <div class="hero-name">${esc(cur.name)}</div>
            <div class="hero-sub">first up when you're back · ${fmtDur(cur.estMins)} planned</div>
          </div>
        </div>
        <div class="pause-banner">
          ⏸ ${ev.autoPaused ? "Paused while you were away — that gap isn't counted." : "Paused — the timer isn't counting."}
          ${banked >= 20 ? `<br>${fmtCount(banked)} on the clock for this so far.` : ''}
        </div>
        <div class="hero-btns">
          <button class="btn btn-primary" style="flex:1" data-act="hero-resume">Resume ▶</button>
          <button class="btn btn-ghost" data-act="hero-done">Done ✓</button>
        </div>
      </div>`;
    return;
  }

  heroEl.innerHTML = `
    <div class="hero-task">
      <div class="hero-top">
        <span class="hero-icon">${cur.icon}</span>
        <div style="min-width:0">
          <div class="hero-name">${esc(cur.name)}</div>
          <div class="hero-sub" data-hero-sub></div>
        </div>
      </div>
      <div class="hero-timer">
        <span class="hero-elapsed" data-hero-elapsed>0:00</span>
        <span class="hero-est" data-hero-est>of ${fmtDur(cur.estMins)} planned</span>
      </div>
      <div class="hero-bar"><div class="hero-fill" data-hero-fill></div></div>
      <div class="hero-btns">
        <button class="btn btn-green" data-act="hero-done">Done ✓</button>
        <button class="btn btn-ghost" data-act="hero-plus5">+5m</button>
        <button class="btn btn-ghost" data-act="hero-later">Later ↓</button>
      </div>
      <button class="pause-link" data-act="hero-pause">⏸ Stepping away for a while? Pause the timer</button>
    </div>`;
}

function renderUpNext(ev) {
  const pend = pendingTasks(ev);
  const upcoming = pend.slice(1);
  const done = ev.tasks.filter((t) => t.done);
  const sch = computeSchedule(ev);
  $('[data-tlist]').innerHTML = upcoming.length
    ? taskRowsHTML(upcoming, { schRows: sch.rows, live: true })
    : `<div class="empty" style="padding:14px">${pend.length ? 'This is the last one — home stretch! 🏡' : ''}</div>`;
  const liveOnChange = (kind) => {
    if (route.page !== 'live' || ev.status !== 'active') return;
    if (kind === 'times') { updateLive(ev); return; } // in place — keep the strip open
    renderHero(ev); renderUpNext(ev); updateLive(ev);
  };
  bindTaskList($('[data-tlist]'), ev.tasks, ev, { onChange: liveOnChange });
  $('[data-done-count]').textContent = done.length;
  $('[data-done-section]').style.display = done.length ? '' : 'none';
  $('[data-donelist]').innerHTML = taskRowsHTML(done, {});
  bindTaskList($('[data-donelist]'), ev.tasks, ev, { onChange: liveOnChange });
}

/** per-second refresh of everything time-flavoured */
function updateLive(ev) {
  if (route.page !== 'live' || ev.status !== 'active') return;
  const now = new Date();
  const T = terms(ev);
  let sch = computeSchedule(ev, now);

  // waiting → running: the clock reaches the latest safe start time
  if (ev.notStarted && now.getTime() >= sch.startByMs) {
    beginRoutine(ev);
    chime('start');
    renderHero(ev); renderUpNext(ev);
    sch = computeSchedule(ev, now);
  }

  const secsToLeave = (sch.leaveAt.getTime() - now.getTime()) / 1000;
  const secsToStart = (sch.startByMs - now.getTime()) / 1000;

  const cd = $('[data-countdown]');
  if (cd) {
    if (ev.notStarted) {
      cd.textContent = fmtCount(secsToStart);
      cd.classList.remove('late-t');
      $('[data-countdown-lbl]').textContent = 'until you start';
    } else {
      cd.textContent = fmtCount(secsToLeave);
      cd.classList.toggle('late-t', secsToLeave < 0);
      $('[data-countdown-lbl]').textContent = secsToLeave < 0 ? T.countPast : T.countUntil;
    }
  }
  const nowEl = $('[data-now-clock]'); if (nowEl) nowEl.textContent = fmtClock(now);
  const lvEl = $('[data-leave-clock]'); if (lvEl) lvEl.textContent = fmtClock(sch.leaveAt);
  const gw = $('[data-goal-word]'); if (gw) gw.textContent = `${T.goalEmoji} ${T.goalWord}`;
  const arEl = $('[data-arrive-clock]'); if (arEl) arEl.textContent = fmtClock(sch.targetAt);
  const arBit = $('[data-arrive-bit]'); if (arBit) arBit.style.display = T.out ? '' : 'none';

  // gentle reminders — once each, re-armed if the plan moves (skipped while waiting)
  if (!ev.notStarted) {
    if (secsToLeave <= 300 && secsToLeave > 0 && !ev.chimed5) { ev.chimed5 = true; save(); chime('warn5'); }
    if (secsToLeave <= 0 && !ev.chimedLeave) { ev.chimedLeave = true; save(); chime('leave'); }
  }

  const pill = $('[data-status]');
  if (pill) {
    if (ev.notStarted) {
      pill.className = 'status-pill ok';
      pill.textContent = `🌿 ${fmtMinsLoose(secsToStart)} of buffer before you start`;
    } else {
      const st = slackStatus(sch.slackSecs);
      pill.className = `status-pill ${st.cls}`;
      pill.textContent = `${st.icon} ${st.label}`;
    }
  }

  const rl = $('[data-readyline]');
  if (rl) {
    rl.innerHTML = ev.notStarted
      ? `start at <b>${fmtClock(new Date(sch.startByMs))}</b> and you'll be ${T.out ? 'out' : 'ready'} right on time`
      : `at this pace you're ready at <b>${fmtClock(sch.readyAt)}</b> · goal ${fmtClock(sch.leaveAt)}`;
  }

  // hero timer
  const cur = pendingTasks(ev)[0];
  if (cur && !ev.paused && !ev.notStarted) {
    const spent = curSpentSecs(ev);
    const over = spent > cur.estMins * 60;
    if (over && !cur.chimedOver) { cur.chimedOver = true; save(); chime('over'); }
    if (!over && cur.chimedOver) cur.chimedOver = false; // re-arm if +5m brought it back under
    const he = $('[data-hero-elapsed]');
    if (he) {
      he.textContent = fmtCount(spent);
      he.classList.toggle('over-t', over);
    }
    const fill = $('[data-hero-fill]');
    if (fill) {
      fill.style.width = `${clamp((spent / (cur.estMins * 60)) * 100, 2, 100)}%`;
      fill.classList.toggle('over-f', over);
    }
    const sub = $('[data-hero-sub]');
    if (sub) {
      const projEnd = sch.rows[0] ? sch.rows[0].end : now;
      sub.textContent = over
        ? `${fmtCount(spent - cur.estMins * 60)} over — no judgement, just hustle 🐇`
        : `wrap up by ${fmtClock(projEnd)}`;
    }
  }
  // upcoming projected clock times
  for (const r of sch.rows.slice(1)) {
    const el = $(`[data-proj="${r.t.id}"]`);
    if (el) el.textContent = `${fmtClock(r.start)} – ${fmtClock(r.end)}`;
  }
}

/* ===================================================================
   SUMMARY
   =================================================================== */
function renderSummary() {
  const ev = getEvent(route.id);
  if (!ev) return go('home');
  const ok = ev.resultSlackSecs >= 0;
  const T = terms(ev);
  const doneTasks = ev.tasks.filter((t) => t.done && !t.untimed);
  const earlyTasks = ev.tasks.filter((t) => t.done && t.untimed);
  const totalActual = doneTasks.reduce((s, t) => s + (t.actualSecs || 0), 0);
  const maxSecs = Math.max(...doneTasks.map((t) => Math.max(t.actualSecs || 0, t.estMins * 60)), 1);

  app.innerHTML = `
    ${route.replay ? `<div class="page-top">
      <button class="btn-icon" data-act="home" aria-label="Back">‹</button>
      <h1 style="font-size:1.2rem">Looking back</h1>
    </div>` : ''}
    <div class="summary-hero">
      <div class="big-emoji">${ok ? '🎉' : '🌧️'}</div>
      <div class="summary-verdict ${ok ? 'ok-v' : 'late-v'}">
        ${ok ? `${T.verdictHead}<br>${fmtMinsLoose(ev.resultSlackSecs)} early!` : `${fmtMinsLoose(ev.resultSlackSecs)} ${T.verdictPast}`}
      </div>
      <div class="summary-sub">${esc(ev.name || 'Getting ready')} · ${ok ? 'right on schedule ⭐' : 'the estimates will be smarter next time 💕'}</div>
    </div>

    <div class="stat-tiles">
      <div class="stat-tile"><div class="v">${fmtClock(new Date(ev.finishedAt))}</div><div class="k">ready at</div></div>
      <div class="stat-tile"><div class="v">${fmtClock(leaveAt(ev))}</div><div class="k">goal</div></div>
      <div class="stat-tile"><div class="v">${fmtDur(Math.round(totalActual / 60))}</div><div class="k">total time</div></div>
    </div>

    ${doneTasks.length ? `
    <div class="card">
      <div class="field-label">How each step went</div>
      <div class="cmp-legend">
        <span><span class="dot" style="background:var(--lav)"></span>planned</span>
        <span><span class="dot" style="background:var(--pink)"></span>actual</span>
      </div>
      ${doneTasks.map((t) => {
        const act = t.actualSecs || 0;
        const est = t.estMins * 60;
        const diff = Math.round((act - est) / 60);
        return `
        <div class="cmp-row">
          <div class="cmp-head">
            <span>${t.icon}</span><span>${esc(t.name)}</span>
            <span class="delta ${diff > 0 ? 'diff-over' : 'diff-under'}">${diff > 0 ? `+${fmtDur(diff)}` : diff < 0 ? `−${fmtDur(-diff)}` : 'on the dot ✨'}</span>
          </div>
          <div class="cmp-bars">
            <div class="cmp-bar est-b" style="width:${(est / maxSecs) * 100}%"></div>
            <div class="cmp-bar act-b ${act > est ? 'over-b' : ''}" style="width:${clamp((act / maxSecs) * 100, 2, 100)}%"></div>
          </div>
        </div>`;
      }).join('')}
      <div style="color:var(--ink-faint);font-weight:600;font-size:0.82rem;margin-top:10px">
        ✨ Suggestions updated — next time the estimates will be smarter.
      </div>
    </div>` : ''}

    ${earlyTasks.length ? `
    <div class="card">
      <div class="field-label">Done ahead of time</div>
      <div style="color:var(--ink-soft);font-weight:600;font-size:0.92rem;line-height:1.7">
        ${earlyTasks.map((t) => `${t.icon} ${esc(t.name)}`).join(' · ')}
      </div>
    </div>` : ''}

    <div class="footer-cta">
      <button class="btn btn-green btn-big" data-act="save-routine">Save as a routine 🌿</button>
      <div style="height:10px"></div>
      <button class="btn btn-ghost btn-big" data-act="home">Back home</button>
      <div style="text-align:center"><button class="btn-link" data-act="insights">See how long things usually take →</button></div>
    </div>
  `;

  if (ok && !route.replay) confetti();
  app.onclick = (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'home') go('home');
    if (act.dataset.act === 'insights') go('insights');
    if (act.dataset.act === 'save-routine') saveAsRoutine(ev);
  };
}

/* ===================================================================
   MY PACE — what things actually take, learned from real life
   =================================================================== */
function renderInsights() {
  const entries = Object.values(S.history)
    .filter((h) => h.count > 0)
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));

  app.innerHTML = `
    <div class="page-top">
      <button class="btn-icon" data-act="back" aria-label="Back">‹</button>
      <h1>My pace</h1>
    </div>
    ${entries.length ? `
    <div class="card" style="padding:10px 16px">
      ${entries.map((h, i) => `
        <div class="ins-row" data-ins="${i}">
          <span class="t-icon">${h.icon}</span>
          <div class="t-main">
            <div class="t-name">${esc(h.name)}</div>
            <div class="t-time">timed ${h.count} time${h.count === 1 ? '' : 's'}${h.samples && h.samples.length > 1 ? ` · recently: ${h.samples.slice(-5).map((m) => m + 'm').join(', ')}` : ''}</div>
          </div>
          <span class="ins-avg">~${fmtDur(h.estMins)}</span>
          <div class="ins-actions">
            <span style="color:var(--ink-faint);font-size:0.8rem;font-weight:600;flex:1">This is what new "${esc(h.name)}" tasks will suggest.</span>
            <button class="chip" data-forget="${esc(h.name.toLowerCase())}" style="color:var(--coral-deep)">Forget</button>
          </div>
        </div>`).join('')}
    </div>
    <div style="color:var(--ink-faint);font-weight:600;font-size:0.84rem;text-align:center;margin-top:14px;line-height:1.6">
      Estimates are the average of recent real timings.<br>The more you use it, the more honest it gets 🌿
    </div>` : `
    <div class="card empty"><span class="big">⏱️</span>Nothing timed yet.<br>Finish a routine and real durations<br>will show up here.</div>`}
  `;

  app.onclick = (e) => {
    const forget = e.target.closest('[data-forget]');
    if (forget) {
      if (confirm(`Forget the timing history for "${S.history[forget.dataset.forget]?.name}"?`)) {
        delete S.history[forget.dataset.forget];
        save();
        renderInsights();
      }
      return;
    }
    const row = e.target.closest('.ins-row');
    if (row) {
      const was = row.classList.contains('expanded');
      $$('.ins-row.expanded').forEach((r) => r.classList.remove('expanded'));
      if (!was) row.classList.add('expanded');
      return;
    }
    if (e.target.closest('[data-act="back"]')) go('home');
  };
}

function confetti() {
  const colors = ['#f6a8c8', '#a3d9b8', '#ffdcc7', '#e7ddf8', '#fff3cd', '#e26f9e'];
  for (let i = 0; i < 46; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 2.2 + Math.random() * 1.8 + 's';
    c.style.animationDelay = Math.random() * 0.7 + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 5000);
  }
}

/* ===================================================================
   ROUTINES
   =================================================================== */
function renderRoutines() {
  app.innerHTML = `
    <div class="page-top">
      <button class="btn-icon" data-act="back" aria-label="Back">‹</button>
      <h1>My routines</h1>
    </div>
    ${S.routines.length ? S.routines.map((r) => `
      <button class="routine-card" data-act="edit-routine" data-id="${r.id}">
        <span class="ev-emoji">${r.icon}</span>
        <span style="min-width:0">
          <div class="ev-name">${esc(r.name)}</div>
          <div class="ev-meta">${r.tasks.length} steps · ${fmtDur(r.tasks.reduce((s, t) => s + t.estMins, 0))}</div>
        </span>
        <span style="margin-left:auto;color:var(--ink-faint)">›</span>
      </button>`).join('')
    : `<div class="card empty"><span class="big">🌿</span>No routines yet.<br>Finish getting ready once and save it!</div>`}
  `;
  app.onclick = (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'back') go('home');
    if (act.dataset.act === 'edit-routine') go('routine-edit', { id: act.dataset.id });
  };
}

function renderRoutineEdit() {
  const r = S.routines.find((x) => x.id === route.id);
  if (!r) return go('routines');
  // adapt routine tasks into task-shaped objects for the shared list
  r.tasks.forEach((t) => { if (!t.id) t.id = uid(); t.done = false; });

  app.innerHTML = `
    <div class="page-top">
      <button class="btn-icon" data-act="back" aria-label="Back">‹</button>
      <h1>Edit routine</h1>
      <button class="btn-icon" data-act="delete" style="color:var(--coral-deep)">🗑</button>
    </div>
    <div class="card">
      <div class="name-row">
        <span class="ev-emoji">${r.icon}</span>
        <input class="input-name" data-name type="text" value="${esc(r.name)}">
      </div>
    </div>
    <div class="card">
      <div class="field-label">Steps · ${fmtDur(r.tasks.reduce((s, t) => s + t.estMins, 0))} total</div>
      <div class="t-list" data-tlist></div>
      <div data-addbar>${addBarHTML()}</div>
    </div>
    <div class="footer-cta">
      <button class="btn btn-primary btn-big" data-act="use">Get ready with this 💫</button>
    </div>
  `;

  const refresh = (kind) => {
    if (kind === 'times') return; // est inputs update in place
    $('[data-tlist]').innerHTML = taskRowsHTML(r.tasks, { noCheck: true });
    bindTaskList($('[data-tlist]'), r.tasks, null, { onChange: refresh });
  };
  refresh();
  bindAddBar($('[data-addbar]'), { tasks: r.tasks, status: 'setup' }, { onAdd: refresh });

  $('[data-name]').oninput = (e) => { r.name = e.target.value; save(); };
  app.onclick = (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'back') { save(); go('routines'); }
    if (act.dataset.act === 'delete') {
      if (confirm('Delete this routine?')) {
        S.routines = S.routines.filter((x) => x.id !== r.id);
        save(); go('routines');
      }
    }
    if (act.dataset.act === 'use') {
      const ev = newEvent();
      ev.name = r.name; ev.icon = r.icon;
      ev.tasks = r.tasks.map((t) => {
        const nt = makeTask(t.name, t.estMins);
        nt.icon = t.icon || nt.icon;
        return nt;
      });
      save();
      go('edit', { id: ev.id });
    }
  };
}

/* ===================================================================
   heartbeat
   =================================================================== */
setInterval(() => {
  // remember when we last saw the clock, so long absences can be detected
  if (S.events.some((e) => e.status === 'active') && Date.now() - (S.lastTick || 0) > 10000) {
    S.lastTick = Date.now();
    save();
  }
  if (route.page === 'live') {
    const ev = getEvent(route.id);
    if (ev && ev.status === 'active') updateLive(ev);
  } else if (route.page === 'home') {
    const cp = fmtClockParts(new Date());
    const c = $('[data-home-clock]');
    if (c) c.innerHTML = `${cp.time}<span class="ampm">${cp.ap}</span>`;
    $$('[data-home-count]').forEach((el) => {
      const ev = getEvent(el.dataset.id);
      if (!ev) return;
      const cd = liveCountdown(ev);
      $('.n', el).textContent = fmtCount(cd.secs);
      $('.lbl', el).textContent = cd.secs < 0 ? cd.past : cd.until;
    });
  }
}, 1000);

checkAway();
render();
