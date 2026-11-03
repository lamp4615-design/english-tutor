// 進度：這週和上週、發音趨勢、錯誤類型變化、弱點專練、每週教練信

// ---------- 每週加總 ----------
function weekSum(wk) {
  const out = { n: 0, ok: 0, err: {}, pr: 0, prn: 0, active: 0, car: 0 };
  for (let i = 0; i < 7; i++) {
    const s = dayStat(addDays(wk, i));
    out.n += s.n; out.ok += s.ok; out.pr += s.pr || 0; out.prn += s.prn || 0; out.car += s.car || 0;
    if (isActive(s)) out.active++;
    Object.entries(s.err || {}).forEach(([t, c]) => out.err[t] = (out.err[t] || 0) + c);
  }
  return out;
}
const thisWeek = () => weekKey(dayKey(Date.now()));
const md = k => `${+k.slice(5, 7)}/${+k.slice(8)}`;
// 太籠統、沒辦法專練的類型不列
const VAGUE = ['其他', '意思錯誤', '漏字'];

function renderProgress() {
  renderTiles();
  renderPronChart();
  renderErrTrend();
  renderDrills();
  renderLetterList();
}

// ---------- 這週和上週 ----------
// 少練不用紅色：退步只用灰色，不讓人有罪惡感
function renderTiles() {
  const wk = thisWeek(), a = weekSum(wk), b = weekSum(addDays(wk, -7));
  const rate = s => s.n ? Math.round(s.ok / s.n * 100) : null;
  const delta = (x, y, unit = '') => {
    if (x == null || y == null) return '<span class="delta flat">　</span>';
    const d = x - y;
    return d > 0 ? `<span class="delta up">比上週 +${d}${unit}</span>` : d < 0 ? `<span class="delta flat">比上週 ${d}${unit}</span>` : '<span class="delta flat">和上週一樣</span>';
  };
  const tile = (lab, val, dl) => `<div class="tile"><div class="lab">${lab}</div><div class="val">${val}</div>${dl}</div>`;
  $('#weekTiles').innerHTML =
    tile('練習句數', a.n, delta(a.n, b.n)) +
    tile('完全正確', rate(a) == null ? '—' : rate(a) + '%', delta(rate(a), rate(b), ' 點')) +
    tile('有練的天數', `${a.active}<span class="muted" style="font-size:15px"> / 7</span>`, delta(a.active, b.active, ' 天'));
}

// ---------- 發音分數趨勢（單一系列折線，不用圖例） ----------
function renderPronChart() {
  const today = dayKey(Date.now()), pts = [];
  for (let i = 29; i >= 0; i--) {
    const k = addDays(today, -i), s = dayStat(k);
    if (s.prn) pts.push({ k, v: s.pr / s.prn, n: s.prn });
  }
  if (pts.length < 2) {
    $('#pronNote').textContent = '有 2 天以上的錄音練習（看中文說英文按 🎤，或跟讀），這裡就會畫出最近 30 天的發音分數。';
    $('#pronChart').innerHTML = '';
    return;
  }
  const first = pts[0], last = pts[pts.length - 1];
  $('#pronNote').textContent = `最近 30 天有錄音的日子，每天的平均分數（1～5 分）。${md(first.k)} 是 ${first.v.toFixed(1)} 分，${md(last.k)} 是 ${last.v.toFixed(1)} 分。`;
  const W = 340, H = 150, L = 22, R = 34, T = 10, B = 22;
  const t0 = keyTime(first.k), t1 = keyTime(last.k);
  const x = k => L + (keyTime(k) - t0) / (t1 - t0) * (W - L - R);
  const y = v => T + (5 - v) / 4 * (H - T - B);
  let svg = '';
  for (let v = 1; v <= 5; v++) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  svg += `<text class="axis" x="${L}" y="${H - 4}">${md(first.k)}</text><text class="axis" x="${W - R}" y="${H - 4}" text-anchor="end">${md(last.k)}</text>`;
  svg += `<path class="ln" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.k).toFixed(1)},${y(p.v).toFixed(1)}`).join('')}"/>`;
  // 每個點：看不見的大範圍（好按）＋實際的點；滑過或聚焦時顯示日期和分數
  svg += pts.map(p => `<circle class="hit" cx="${x(p.k)}" cy="${y(p.v)}" r="12" tabindex="0"><title>${md(p.k)}：平均 ${p.v.toFixed(1)} 分（錄了 ${p.n} 句）</title></circle><circle class="dot" cx="${x(p.k)}" cy="${y(p.v)}" r="4"/>`).join('');
  svg += `<text class="endlab" x="${x(last.k) + 8}" y="${y(last.v) + 4}">${last.v.toFixed(1)}</text>`;
  $('#pronChart').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="最近 30 天發音分數，從 ${first.v.toFixed(1)} 到 ${last.v.toFixed(1)}">${svg}</svg>` +
    `<details class="tview"><summary>看數字</summary><table><tr><th>日期</th><th>平均分數</th><th>錄了幾句</th></tr>${pts.map(p => `<tr><td>${md(p.k)}</td><td>${p.v.toFixed(1)}</td><td>${p.n}</td></tr>`).join('')}</table></details>`;
}

// ---------- 錯誤類型的變化：每種一排小長條（最近 6 週，這週用主色） ----------
function errRates() {
  const wk = thisWeek(), weeks = [];
  for (let i = 5; i >= 0; i--) { const k = addDays(wk, -7 * i); weeks.push({ k, s: weekSum(k) }); }
  const total = {};
  weeks.forEach(w => Object.entries(w.s.err).forEach(([t, c]) => total[t] = (total[t] || 0) + c));
  const types = Object.keys(total).filter(t => !VAGUE.includes(t)).sort((a, b) => total[b] - total[a]).slice(0, 5);
  return { weeks, types: types.map(t => ({ t, r: weeks.map(w => w.s.n ? (w.s.err[t] || 0) / w.s.n * 10 : null) })) };
}
function colPath(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function renderErrTrend() {
  const { weeks, types } = errRates();
  if (!types.length) { $('#errTrend').innerHTML = '<p class="muted">練習幾天後，這裡會顯示你常錯的類型有沒有越來越少。</p>'; return; }
  const max = Math.max(...types.flatMap(x => x.r.filter(v => v != null)), 0.1);
  const f = v => v == null ? '—' : v.toFixed(1);
  $('#errTrend').innerHTML = types.map(({ t, r }) => {
    const now = r[5], prev = r[4];
    let note = `這週 ${f(now)}`;
    if (now != null && prev != null) note += now < prev ? `，上週 ${f(prev)} <span class="up">↓ 變少了</span>` : now > prev ? `，上週 ${f(prev)} <span class="flat">↑</span>` : `，和上週一樣`;
    const cols = r.map((v, i) => v == null ? '' : `<path class="col${i === 5 ? ' now' : ''}" d="${colPath(i * 16, 40 - v / max * 38, 12, v / max * 38, 4)}"><title>${md(weeks[i].k)} 那週：每 10 句 ${f(v)} 次</title></path>`).join('');
    return `<div class="etrend"><span class="t">${esc(t)}</span><svg class="chart" viewBox="0 0 94 40" role="img" aria-label="${esc(t)}最近 6 週">${cols}</svg><span class="v">${note}</span></div>`;
  }).join('') +
    `<details class="tview"><summary>看數字</summary><div class="overflow"><table><tr><th>類型</th>${weeks.map(w => `<th>${md(w.k)}週</th>`).join('')}</tr>` +
    types.map(({ t, r }) => `<tr><td>${esc(t)}</td>${r.map(v => `<td>${f(v)}</td>`).join('')}</tr>`).join('') + '</table></div></details>';
}

// ---------- 🎯 弱點專練 ----------
const DRILL_PROMPT = `你是英文家教，學生是台灣的成人學習者。學生最近常犯某一類錯誤，請出 5 句新的練習句，讓他用「看中文、說英文」練這個規則。
規則：
- 每一句都一定要用到這個規則，而且是學生容易錯的用法。
- 句子要是日常生活會說的話，6～14 個英文字，難度和用字接近學生的課文（下面會附上課文句子），但不要跟課文一樣。
- zh：自然的繁體中文。
- rule：一兩句繁體中文，說明這個規則，台灣學生好記的說法，可以附一個簡短例子。
只輸出 JSON：{"rule":"","items":[{"en":"","zh":""}]}`;

function weakList() {
  const t = {}, today = dayKey(Date.now());
  for (let i = 0; i < 14; i++) Object.entries(dayStat(addDays(today, -i)).err || {}).forEach(([k, c]) => t[k] = (t[k] || 0) + c);
  return Object.entries(t).filter(([k]) => !VAGUE.includes(k)).sort((a, b) => b[1] - a[1]).slice(0, 4);
}
function renderDrills() {
  const w = weakList();
  $('#drillList').innerHTML = w.length
    ? w.map(([t, c]) => `<div class="drill"><span class="t"><b>${esc(t)}</b> <span class="muted">最近兩週錯 ${c} 次</span></span><button class="btn small primary" data-drill="${esc(t)}">練 5 句</button></div>`).join('')
    : '<p class="muted">最近兩週還沒有明顯的弱點。多練幾天，這裡會列出最常錯的類型。</p>';
}
$('#drillList').addEventListener('click', async e => {
  const b = e.target.closest('[data-drill]'); if (!b) return;
  const type = b.dataset.drill;
  document.querySelectorAll('[data-drill]').forEach(x => x.disabled = true);
  b.textContent = 'Gemini 出題中…';
  unlockVoice();
  try {
    const sample = shuffle(allItems('all')).slice(0, 15).map(it => it.en).join('\n');
    const r = await gemini(DRILL_PROMPT, `要練的錯誤類型：${type}\n學生課文裡的句子（參考難度和用字）：\n${sample}`);
    const items = list(r.items).filter(x => x.en && x.zh).map(x => newItem(String(x.en).trim(), String(x.zh).trim()));
    if (!items.length) throw new Error('Gemini 沒有出題，請再按一次');
    const rule = String(r.rule || '').trim();
    db.lessons.push({ id: uid(), title: `🎯 弱點專練：${type}（${md(dayKey(Date.now()))}）`, created: Date.now(), drill: type, note: rule, items });
    save();
    showTab('practice');
    startSession(items, 'speak', rule ? `📌 ${type}：${rule}` : '');
  } catch (err) {
    toast(err.message);
  } finally {
    renderDrills();
  }
});

// ---------- 📬 每週教練信 ----------
// 每週第一次打開 App 時，根據上週的紀錄寫一封；上週完全沒練就不寫（不催人）
const LETTER_PROMPT = `你是學生的英文家教，學生是台灣的成人，下班後自己練英文。每週一你會根據他上週的練習紀錄寫一封短信給他。
規則：
- 3～5 句繁體中文，像真人家教寫的私人短信，溫暖、具體，不要列點、不要說教。
- 先具體肯定他做到的事，要引用數字（例如練了幾天、哪種錯誤變少、發音分數進步）。只跟他自己以前比。
- 再給「這週一個重點」，要小、做得到，跟他最常錯的類型或發音有關。
- 上週練得少也不要責備，只說一個很小的目標。
- 最後一句簡短的鼓勵。
只輸出 JSON：{"letter":"","focus":"這週重點（一句話）"}`;

function letterData() {
  const wk = thisWeek(), a = weekSum(addDays(wk, -7)), b = weekSum(addDays(wk, -14)), st = streakInfo();
  const top = s => Object.entries(s.err).filter(([k]) => !VAGUE.includes(k)).sort((x, y) => y[1] - x[1]).slice(0, 3);
  const c = levelCounts(allItems('all'));
  return {
    上週: { 有練天數: a.active, 練習句數: a.n, 完全正確: a.ok, 常錯類型: top(a), 發音平均: a.prn ? +(a.pr / a.prn).toFixed(1) : null, 開車聽分鐘: Math.round(a.car / 60) },
    上上週: { 有練天數: b.active, 練習句數: b.n, 完全正確: b.ok, 常錯類型: top(b), 發音平均: b.prn ? +(b.pr / b.prn).toFixed(1) : null },
    連續天數: st.current, 最長連續: st.best, 每日目標: goal(),
    熟練度: { 新句子: c[0], 學習中: c[1], 熟悉: c[2], 精熟: c[3] }
  };
}
let letterBusy = false;
async function ensureLetter() {
  if (letterBusy || !loaded || !hasKey) return;
  const wk = thisWeek(), letters = db.stats.letters || (db.stats.letters = {});
  if (letters[wk] || !weekSum(addDays(wk, -7)).active) return;
  letterBusy = true;
  try {
    const r = await gemini(LETTER_PROMPT, JSON.stringify(letterData()));
    if (r.letter && !letters[wk]) {
      letters[wk] = { text: String(r.letter).trim(), focus: String(r.focus || '').trim(), at: Date.now(), read: false };
      save();
      renderLetter();
    }
  } catch (e) {
    // 寫信失敗不打擾，下次打開再試
  } finally {
    letterBusy = false;
  }
}
const letterHtml = l => `<p style="margin:4px 0">${esc(l.text)}</p>${l.focus ? `<p class="good" style="margin:6px 0 0">🎯 這週重點：${esc(l.focus)}</p>` : ''}`;
function renderLetter() {
  const l = (db.stats.letters || {})[thisWeek()];
  $('#letterCard').classList.toggle('hidden', !l || l.read || !!session);
  if (l) $('#letterText').innerHTML = letterHtml(l);
}
$('#letterDone').onclick = () => {
  const l = (db.stats.letters || {})[thisWeek()];
  if (l) { l.read = true; save(); }
  renderLetter();
};
function renderLetterList() {
  const ls = Object.entries(db.stats.letters || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8);
  $('#letterList').innerHTML = ls.length
    ? ls.map(([wk, l]) => `<div class="letter-item"><div class="d">${md(wk)} 那週</div>${letterHtml(l)}</div>`).join('')
    : '<p class="muted">每週第一次打開 App 時，Gemini 會根據你上週的練習寫一封短信，告訴你進步在哪、這週練什麼。上週有練才會寫。</p>';
}
