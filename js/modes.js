// 多元題型：聽音選意思、句子重組、克漏字、跟讀、看中文說英文，以及依熟練度自動選題型的智慧模式
// 每種題型：ui＝要顯示的共用按鈕、cap＝答對最多升到第幾階、show＝出題、submit／hint＝自己處理送出和提示（沒有就用看中文說英文的）
const MODES = {
  listen: { icon: '👂', name: '聽音選意思', prompt: '聽英文，選出正確的中文意思', ui: [], cap: 1, show: showListen },
  order: { icon: '🧩', name: '句子重組', prompt: '看中文，把英文字卡排回正確順序', ui: ['submit'], cap: 2, show: showOrder, submit: checkOrder, submitLabel: '檢查' },
  cloze: { icon: '✏️', name: '克漏字', prompt: '看中文，填入空格裡的英文', ui: ['hint', 'submit'], cap: 3, show: showCloze, submit: checkCloze, hint: clozeHint, submitLabel: '檢查' },
  shadow: { icon: '🗣️', name: '跟讀', prompt: '聽完跟著唸，按 🎤 錄音', ui: ['mic'], cap: 3, show: showShadow },
  speak: { icon: '💬', name: '看中文說英文', prompt: '請用英文說出：', ui: ['answer', 'mic', 'hint', 'submit'], cap: INTERVALS.length - 1, show: () => $('#answer').focus() }
};

// 智慧模式的難度階梯：新句子或剛答錯 → 聽 → 排 → 填空／跟讀輪流 → 自己說
function modeFor(it, type) {
  let m = type;
  if (type === 'smart') {
    const b = it.box || 0;
    m = b === 0 ? 'listen' : b === 1 ? 'order' : b === 2 ? (canRecord() && it.attempts % 2 ? 'shadow' : 'cloze') : 'speak';
  }
  // 這一句做不了這種題型時，換下一種
  if (m === 'listen' && !distractors(it, 1).length) m = 'order';
  if (m === 'order' && words(it.en).length < 3) m = 'cloze';
  if (m === 'cloze' && !blankCandidates(words(it.en)).length) m = 'speak';
  if (m === 'shadow' && !canRecord()) m = 'speak';
  return m;
}
const canRecord = () => !!(navigator.mediaDevices && window.MediaRecorder);
const words = en => en.trim().split(/\s+/).filter(Boolean);
// 比對用：去掉前後標點、統一撇號、不分大小寫
const core = w => w.replace(/[’‘]/g, "'").replace(/^[^\w']+|[^\w']+$/g, '').toLowerCase();
function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
function sayRow(text) {
  return `<div class="say-row"><button class="btn" data-say="${esc(text)}" id="sayNormal">🔊 再聽一次</button>` +
    `<button class="btn" data-say="${esc(text)}" data-slow="1">🐢 慢速</button></div>`;
}
$('#modeArea').addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) playVoice(b, b.dataset.say, !!b.dataset.slow); });
// 後面 3 題如果要聽，先把語音準備好，輪到時不用等
function preloadNext() {
  session.queue.slice(session.i + 1, session.i + 4).forEach(nx => {
    if (['listen', 'shadow'].includes(modeFor(nx, session.type))) loadVoice(nx.en).catch(() => {});
  });
}

// ---------- 👂 聽音選意思 ----------
// 錯的選項優先從同一課挑，意思比較接近，才不會一看就知道
function distractors(it, k) {
  const own = db.lessons.find(l => l.items.includes(it));
  const others = db.lessons.filter(l => l !== own).flatMap(l => l.items);
  const seen = new Set([it.zh]), out = [];
  for (const x of shuffle(own ? own.items : []).concat(shuffle(others))) {
    if (out.length >= k) break;
    if (x.zh && x.en && !seen.has(x.zh)) { seen.add(x.zh); out.push(x.zh); }
  }
  return out;
}
function showListen(it) {
  const opts = shuffle([it.zh, ...distractors(it, 3)]);
  $('#modeArea').innerHTML = sayRow(it.en) +
    `<div class="opts">${opts.map(o => `<button class="btn opt" data-opt="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  playVoice($('#sayNormal'), it.en);
}
$('#modeArea').addEventListener('click', e => {
  const b = e.target.closest('[data-opt]');
  if (!b || !session || session.answered) return;
  const it = current(), right = b.dataset.opt === it.zh;
  document.querySelectorAll('[data-opt]').forEach(x => x.classList.toggle('right', x.dataset.opt === it.zh));
  if (!right) b.classList.add('picked-wrong');
  finish(b.dataset.opt, { verdict: right ? 'correct' : 'wrong', errors: [], note: right ? '' : `正確的意思是「${it.zh}」。再聽一次原句，注意關鍵字。` });
});

// ---------- 🧩 句子重組 ----------
function showOrder(it) {
  const w = words(it.en);
  let pool = shuffle(w.map((_, i) => i));
  for (let k = 0; k < 10 && pool.every((v, i) => core(w[v]) === core(w[i])); k++) pool = shuffle(pool);   // 不要剛好排好
  session.order = { w, pool, picked: [] };
  renderOrder();
}
function renderOrder() {
  const o = session.order;
  const chip = (i, where) => `<button class="chip" data-chip="${i}" data-where="${where}">${esc(o.w[i])}</button>`;
  $('#modeArea').innerHTML = `<div class="chips ans">${o.picked.map(i => chip(i, 'ans')).join('')}</div>` +
    `<div class="chips">${o.pool.map(i => chip(i, 'pool')).join('')}</div>`;
}
$('#modeArea').addEventListener('click', e => {
  const b = e.target.closest('[data-chip]');
  if (!b || !session || session.answered || session.mode !== 'order') return;
  const o = session.order, i = +b.dataset.chip;
  const [from, to] = b.dataset.where === 'pool' ? [o.pool, o.picked] : [o.picked, o.pool];
  from.splice(from.indexOf(i), 1);
  to.push(i);
  renderOrder();
});
function checkOrder(it) {
  if (session.answered) return;
  const o = session.order;
  if (o.pool.length) { toast(`還有 ${o.pool.length} 張字卡沒排`); return; }
  const ans = o.picked.map(i => o.w[i]).join(' ');
  const got = o.picked.map(i => core(o.w[i])), want = o.w.map(core);
  const same = got.filter((x, i) => x === want[i]).length;
  const verdict = same === want.length ? 'correct' : same >= want.length * 0.6 ? 'partial' : 'wrong';
  finish(ans, {
    verdict,
    errors: verdict === 'correct' ? [] : [{ type: '語序', wrong: ans, fix: it.en, explain: '對照下面的課文原句，看看哪幾個字的位置不同。' }],
    note: verdict === 'correct' ? '' : '英文的語序常常跟中文不一樣，多唸幾次原句，順序會變成直覺。'
  });
}

// ---------- ✏️ 克漏字 ----------
const PREPS = ['in', 'on', 'at', 'to', 'for', 'with', 'from', 'of', 'by', 'about', 'into', 'over', 'under', 'after', 'before', 'during', 'between', 'through', 'around'];
const ARTICLES = ['a', 'an', 'the'];
const STOP = ['i', 'you', 'he', 'she', 'it', 'we', 'they', 'is', 'am', 'are', 'was', 'were', 'be', 'and', 'or', 'but', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that', 'do', 'does', 'did', 'not'];
function blankCandidates(w) {
  return w.map((x, i) => i).filter(i => /^[a-z']+$/.test(core(w[i])));
}
// 這兩週最常錯的是介系詞或冠詞，就優先挖那種字
function weakType() {
  const t = {}, today = dayKey(Date.now());
  for (let i = 0; i < 14; i++) Object.entries(dayStat(addDays(today, -i)).err || {}).forEach(([k, c]) => t[k] = (t[k] || 0) + c);
  return ['介系詞', '冠詞'].filter(k => t[k]).sort((a, b) => t[b] - t[a])[0];
}
const wordType = c => PREPS.includes(c) ? '介系詞' : ARTICLES.includes(c) ? '冠詞' : '用字';
// 一句挖一個空，9 個字以上挖兩個；兩個空不相鄰
function pickBlanks(w) {
  const cand = blankCandidates(w), weak = weakType();
  const focus = cand.filter(i => weak && wordType(core(w[i])) === weak);
  const content = cand.filter(i => core(w[i]).length >= 3 && !STOP.includes(core(w[i])) && !PREPS.includes(core(w[i])))
    .sort((a, b) => core(w[b]).length - core(w[a]).length);
  const out = [];
  const add = from => { for (const i of shuffle(from.slice(0, 3))) if (!out.some(j => Math.abs(j - i) < 2)) { out.push(i); return; } };
  add(focus.length ? focus : content.length ? content : cand);
  if (w.length >= 9) add(content.length ? content : cand);
  return out.sort((a, b) => a - b);
}
function showCloze(it) {
  const w = words(it.en), blanks = pickBlanks(w);
  session.cloze = { w, blanks };
  $('#modeArea').innerHTML = '<div class="cloze">' + w.map((x, i) => {
    if (!blanks.includes(i)) return esc(x);
    const m = x.match(/^([^\w'’]*)(.*?)([^\w'’]*)$/);
    return `${esc(m[1])}<input data-blank="${i}" size="${Math.max(3, core(x).length)}" autocomplete="off" autocapitalize="off" spellcheck="false">${esc(m[3])}`;
  }).join(' ') + '</div>';
  const first = $('#modeArea input');
  if (first) first.focus();
}
function clozeHint() {
  const c = session.cloze;
  session.hints++;
  c.blanks.forEach(i => { $(`[data-blank="${i}"]`).placeholder = core(c.w[i]).slice(0, session.hints); });
  $('#modeArea input').focus();
}
$('#modeArea').addEventListener('keydown', e => {
  if (!e.target.matches('[data-blank]') || e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault(); e.stopPropagation();   // 不要讓 Enter 同時觸發「下一題」
  const inputs = [...document.querySelectorAll('[data-blank]')], k = inputs.indexOf(e.target);
  if (k < inputs.length - 1 && !inputs[k + 1].value) inputs[k + 1].focus(); else checkCloze(current());
});
function checkCloze(it) {
  if (session.answered) return;
  const c = session.cloze, inp = i => $(`[data-blank="${i}"]`);
  if (!c.blanks.some(i => inp(i).value.trim())) { toast('請先填入英文'); return; }
  const errors = [];
  let right = 0;
  c.blanks.forEach(i => {
    const want = core(c.w[i]), ok = core(inp(i).value) === want;
    inp(i).classList.add(ok ? 'ok' : 'no');
    if (ok) right++;
    else errors.push({ type: wordType(want), wrong: inp(i).value.trim() || '（空白）', fix: want, explain: `這裡要填「${want}」。` });
  });
  const ans = c.w.map((x, i) => c.blanks.includes(i) ? (inp(i).value.trim() || '___') : x).join(' ');
  finish(ans, { verdict: right === c.blanks.length ? 'correct' : right ? 'partial' : 'wrong', errors });
}

// ---------- 🗣️ 跟讀 ----------
function showShadow(it) {
  $('#modeArea').innerHTML = `<div class="shadow-en">${esc(it.en)}</div>` + sayRow(it.en);
  playVoice($('#sayNormal'), it.en);
}
