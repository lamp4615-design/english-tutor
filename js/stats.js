// 每天的紀錄、連續天數、熟練度、今日任務、練習日曆、鼓勵
// ---------- 每天的紀錄、連續天數、熟練度 ----------
// stats.days['2026-11-03'] = { n 練了幾句, ok 完全正確, err {錯誤類型: 次數}, car 開車聽秒數, pr／prn 發音總分／次數 }
// 連續天數不另外存，每次從 days 算，手機和電腦一定一致
const CAR_ACTIVE_SEC = 600;
const LEVELS = [['🌱', '新句子'], ['🌿', '學習中'], ['🌳', '熟悉'], ['⭐', '精熟']];
function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function keyTime(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}
// 每週從星期一算起，補休以週為單位
function weekKey(key) {
  return addDays(key, -((new Date(keyTime(key)).getDay() + 6) % 7));
}
function dayStat(key, create) {
  const days = db.stats.days;
  if (!days[key] && create) days[key] = { n: 0, ok: 0, err: {}, car: 0 };
  return days[key] || { n: 0, ok: 0, err: {}, car: 0 };
}
const isActive = s => s.n > 0 || s.car >= CAR_ACTIVE_SEC;

// 從最早有紀錄的那天往後走：有練就 +1；沒練的那天，那週補休還在就用掉，否則歸零。今天還沒練不算斷
function streakInfo(today = dayKey(Date.now())) {
  const keys = Object.keys(db.stats.days).filter(k => isActive(db.stats.days[k])).sort();
  const res = { current: 0, best: 0, rest: {}, restLeft: 1 };
  if (!keys.length) return res;
  let run = 0;
  for (let k = keys[0]; k < today; k = addDays(k, 1)) {
    if (isActive(dayStat(k))) run++;
    else if (run && !res.rest[weekKey(k)]) res.rest[weekKey(k)] = k;
    else run = 0;
    res.best = Math.max(res.best, run);
  }
  if (isActive(dayStat(today))) run++;
  res.current = run;
  res.best = Math.max(res.best, run);
  res.restLeft = res.rest[weekKey(today)] ? 0 : 1;
  return res;
}
function level(it) {
  if (!it.attempts) return 0;
  return it.box >= 5 ? 3 : it.box >= 3 ? 2 : 1;
}
function levelCounts(items) {
  const c = [0, 0, 0, 0];
  items.forEach(it => c[level(it)]++);
  return c;
}
function levelBar(items) {
  const c = levelCounts(items), n = items.length || 1;
  return `<div class="lbar">${[1, 2, 3].map(l => `<i class="lv${l}" style="width:${c[l] / n * 100}%"></i>`).join('')}</div>`;
}
function logAnswer(r) {
  const s = dayStat(dayKey(Date.now()), true);
  s.n++;
  if (r.verdict === 'correct') s.ok++;
  list(r.errors).forEach(e => { const t = e.type || '其他'; s.err[t] = (s.err[t] || 0) + 1; });
  // 發音分數：pr＝總分、prn＝次數，給「進度」畫趨勢
  if (r.pronunciation) { s.pr = (s.pr || 0) + clampScore(r.pronunciation.score); s.prn = (s.prn || 0) + 1; }
}
function goal() { return +db.stats.goal || 10; }

// ---------- 今日任務 ----------
// 待複習太多（超過目標兩倍）時，今天只排目標的量，其他的平均分到之後幾天，不讓人一打開就有壓力
function todayPlan() {
  const items = allItems('all'), now = Date.now();
  const due = items.filter(it => it.attempts > 0 && it.due <= now).sort((a, b) => a.due - b.due);
  const fresh = items.filter(it => it.attempts === 0);
  const done = dayStat(dayKey(now)).n;
  const left = Math.max(goal() - done, 0);
  const size = left || 5;
  const reviews = due.slice(0, size);
  const queue = reviews.concat(fresh.slice(0, size - reviews.length));
  return { due, fresh, done, left, queue, overflow: due.length > goal() * 2 ? due.slice(goal()) : [] };
}
function lastActiveBefore(today) {
  const keys = Object.keys(db.stats.days).filter(k => k < today && isActive(db.stats.days[k])).sort();
  return keys[keys.length - 1];
}
function renderToday() {
  const has = db.lessons.some(l => l.items.length);
  $('#today').classList.toggle('hidden', !has);
  $('#calCard').classList.toggle('hidden', !has);
  if (!has) return;
  const p = todayPlan(), g = goal(), st = streakInfo();
  const pct = Math.min(p.done / g, 1), C = 2 * Math.PI * 34;
  $('#ringFg').setAttribute('stroke-dasharray', C.toFixed(1));
  $('#ringFg').setAttribute('stroke-dashoffset', (C * (1 - pct)).toFixed(1));
  $('#ringFg').closest('svg').classList.toggle('done', pct >= 1);
  $('#todayN').textContent = p.left ? `今天 ${p.done} / ${g} 句` : '今天的目標完成了 🎉';
  const nr = p.queue.filter(it => it.attempts > 0).length, nf = p.queue.length - nr;
  $('#todayPlan').textContent = !p.queue.length ? '所有句子都練過了，可以到「課文」加新的'
    : (p.left ? '接下來：' : '想多練的話：') + [nr && `複習 ${nr} 句`, nf && `新句子 ${nf} 句`].filter(Boolean).join('＋') + `，約 ${Math.max(1, Math.round(p.queue.length * 0.7))} 分鐘`;
  $('#streak').innerHTML = `<b>🔥 ${st.current}</b>連續天數${st.restLeft ? '' : '<br>本週補休已用'}`;
  $('#todayBtn').textContent = p.left ? '開始今天的練習' : '再多練 5 句';
  $('#todayBtn').disabled = !p.queue.length;
  const today = dayKey(Date.now()), last = lastActiveBefore(today);
  const away = last ? Math.round((keyTime(today) - keyTime(last)) / DAY) : 0;
  const msgs = [];
  if (away >= 3 && !p.done) msgs.push(`歡迎回來！隔了 ${away - 1} 天沒關係，今天練一點點就好。`);
  if (p.overflow.length) msgs.push(`待複習有 ${p.due.length} 句，今天先練 ${g} 句，其他的會平均排到接下來幾天，不用一次補完。`);
  $('#welcome').innerHTML = msgs.map(esc).join('<br>');
  $('#welcome').classList.toggle('hidden', !msgs.length);
  const c = levelCounts(allItems('all'));
  $('#levels').innerHTML = LEVELS.map(([icon, name], i) => `<span>${icon} ${name} ${c[i]}</span>`).join('');
  renderCalendar(st);
  renderLetter();
  ensureLetter();
}
$('#todayBtn').onclick = () => {
  const p = todayPlan();
  if (!p.queue.length) return;
  // 多出來的待複習分散到之後幾天，每天最多一個目標的量
  if (p.overflow.length) {
    const today = dayKey(Date.now());
    p.overflow.forEach((it, i) => { it.due = keyTime(addDays(today, 1 + Math.floor(i / goal()))); });
    save();
  }
  startSession(p.queue);
};

// 最近 12 週，一欄一週（星期一在最上面）
function renderCalendar(st) {
  const today = dayKey(Date.now()), start = addDays(weekKey(today), -7 * 11);
  const rest = new Set(Object.values(st.rest));
  let html = '', total = 0;
  for (let k = start, i = 0; i < 84; k = addDays(k, 1), i++) {
    const s = dayStat(k), n = s.n, on = isActive(s);
    if (on) total++;
    const c = n >= 20 ? 4 : n >= 10 ? 3 : n >= 5 ? 2 : on ? 1 : 0;
    const cls = k > today ? 'future' : rest.has(k) ? 'rest' : 'c' + c;
    const what = [n && `${n} 句`, s.car >= 60 && `開車聽 ${Math.round(s.car / 60)} 分`].filter(Boolean).join('、') || (rest.has(k) ? '補休' : '沒練');
    html += `<i class="${cls}${k === today ? ' today' : ''}" title="${+k.slice(5, 7)}/${+k.slice(8)}：${what}"></i>`;
  }
  $('#cal').innerHTML = html;
  $('#calNote').textContent = `近 12 週練了 ${total} 天・最長連續 ${st.best} 天`;
}

// 練習結束時，找出值得鼓勵的地方（只跟自己比）
function snapshot() {
  const days = db.stats.days, today = dayKey(Date.now());
  return {
    n: dayStat(today).n,
    streak: streakInfo().current,
    best: Math.max(0, ...Object.keys(days).filter(k => k !== today).map(k => days[k].n || 0))
  };
}
function cheers(sess) {
  const res = sess.results, out = [], b = sess.before;
  const today = dayKey(Date.now()), st = streakInfo(), s = dayStat(today);
  if (b.n < goal() && s.n >= goal()) out.push(`🎯 今天的目標 ${goal()} 句達成了！`);
  if (st.current > b.streak) out.push(st.current > 1 ? `🔥 連續第 ${st.current} 天，繼續保持！` : '🔥 今天開始新的連續紀錄！');
  if (st.current > b.streak && st.current === st.best && st.current > 2) out.push('🏆 這是你最長的連續紀錄！');
  const ups = res.filter(x => level(x.item) > x.prevLevel);
  const top = ups.filter(x => level(x.item) >= 2).length;
  if (ups.length) out.push(`🌳 ${ups.length} 句升級了${top ? `，其中 ${top} 句已經熟悉或精熟` : ''}`);
  if (b.best > 0 && s.n > b.best && b.n <= b.best) out.push(`📈 今天練了 ${s.n} 句，是你練最多的一天！`);
  // 過去 7 天最常錯的類型，這次一次都沒錯
  const past = {};
  for (let i = 1; i <= 7; i++) Object.entries(dayStat(addDays(today, -i)).err || {}).forEach(([t, c]) => past[t] = (past[t] || 0) + c);
  const worst = Object.entries(past).sort((x, y) => y[1] - x[1])[0];
  if (worst && worst[1] >= 3 && res.length >= 3 && !res.some(x => list(x.r.errors).some(e => (e.type || '其他') === worst[0])))
    out.push(`👏 這週最常錯的「${worst[0]}」（${worst[1]} 次），這次一次都沒錯！`);
  if (!out.length) out.push(`💪 完成 ${res.length} 句，每一句都在累積。`);
  return out;
}
