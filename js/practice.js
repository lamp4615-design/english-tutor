// 練習流程：選題、作答、批改結果、練習結果
// ---------- 練習設定 ----------
function allItems(lessonId) {
  const ls = lessonId === 'all' ? db.lessons : db.lessons.filter(l => l.id === lessonId);
  return ls.flatMap(l => l.items).filter(it => it.en && it.zh);
}
function pick(mode, lessonId) {
  const items = allItems(lessonId), now = Date.now();
  if (mode === 'all') return items.slice();
  if (mode === 'wrong') return items.filter(it => it.attempts > 0 && it.last !== 'correct');
  const reviews = items.filter(it => it.attempts > 0 && it.due <= now).sort((a, b) => a.due - b.due);
  const fresh = items.filter(it => it.attempts === 0);
  return reviews.concat(fresh);
}
function renderSetup() {
  if (session) return;
  renderToday();
  const has = db.lessons.length > 0;
  $('#noLesson').classList.toggle('hidden', has);
  $('#setupForm').classList.toggle('hidden', !has);
  if (!has) return;
  const sel = $('#selLesson'), prev = sel.value;
  sel.innerHTML = (db.lessons.length > 1 ? '<option value="all">全部課文</option>' : '') +
    db.lessons.map(l => `<option value="${l.id}">${esc(l.title)}</option>`).join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  updateCounts();
}
function updateCounts() {
  const id = $('#selLesson').value;
  const items = allItems(id);
  const now = Date.now();
  const fresh = items.filter(it => it.attempts === 0).length;
  const due = items.filter(it => it.attempts > 0 && it.due <= now).length;
  const wrong = items.filter(it => it.attempts > 0 && it.last !== 'correct').length;
  $('#counts').textContent = `待複習 ${due} 題、新句子 ${fresh} 題、錯題 ${wrong} 題，共 ${items.length} 句`;
}
$('#selLesson').onchange = updateCounts;
$('#startBtn').onclick = () => {
  let q = pick($('#selMode').value, $('#selLesson').value);
  const n = +$('#selCount').value;
  if (n) q = q.slice(0, n);
  if (!q.length) { toast($('#selMode').value === 'wrong' ? '沒有錯題，太棒了！' : '目前沒有要複習的題目，可以改選「全部依序」'); return; }
  startSession(q, $('#selType').value);
};

// ---------- 作答 ----------
// type：smart＝依熟練度自動選題型，或指定一種題型
function startSession(queue, type = 'smart') {
  unlockVoice();   // 在按鈕的點擊裡先解鎖播放器，聽力題才能自動播放
  session = { queue, i: 0, results: [], before: snapshot(), type };
  $('#home').classList.add('hidden');
  $('#summary').classList.add('hidden');
  $('#quiz').classList.remove('hidden');
  showQuestion();
}
function current() { return session.queue[session.i]; }
function showQuestion() {
  const it = current(), n = session.queue.length;
  cancelRecording();
  if (session.recUrl) { URL.revokeObjectURL(session.recUrl); session.recUrl = null; }
  session.hints = 0; session.answered = false;
  const mode = session.mode = modeFor(it, session.type), m = MODES[mode];
  $('#progText').textContent = `第 ${session.i + 1} 題 / 共 ${n} 題`;
  $('#progBar').style.width = (session.i / n * 100) + '%';
  $('#qMode').textContent = `${m.icon} ${m.name}`;
  $('#qPrompt').textContent = m.prompt;
  $('#qZh').textContent = it.zh;
  $('#qZh').classList.toggle('hidden', mode === 'listen');   // 聽力題的中文就是答案
  $('#qHint').classList.add('hidden');
  $('#modeArea').innerHTML = '';
  $('#answer').value = ''; $('#answer').disabled = false;
  Object.entries({ answer: '#answer', mic: '#micBtn', hint: '#hintBtn', submit: '#submitBtn' })
    .forEach(([k, sel]) => $(sel).classList.toggle('hidden', !m.ui.includes(k)));
  $('#micBtn').classList.toggle('primary', mode === 'shadow');   // 跟讀只能用說的，錄音鈕放大
  $('#result').classList.add('hidden');
  $('#askActions').classList.remove('hidden');
  $('#nextActions').classList.add('hidden');
  setBusy(false);
  m.show(it);
  preloadNext();
}
function setBusy(b, label) {
  ['#submitBtn', '#hintBtn', '#skipBtn', '#micBtn'].forEach(s => $(s).disabled = b);
  $('#answer').disabled = b;
  $('#submitBtn').textContent = b ? (label || 'Gemini 批改中…') : (session && MODES[session.mode].submitLabel) || '送出';
}
$('#hintBtn').onclick = () => {
  const m = MODES[session.mode];
  if (m.hint) { m.hint(current()); return; }
  const words = current().en.split(/\s+/);
  session.hints = Math.min(session.hints + 1, words.length);
  $('#qHint').textContent = '提示：' + words.slice(0, session.hints).join(' ') + (session.hints < words.length ? ' …' : '');
  $('#qHint').classList.remove('hidden');
  $('#answer').focus();
};
$('#skipBtn').onclick = () => finish('', { verdict: 'wrong', errors: [], corrected: '', note: '已跳過，這題會列入錯題。' });
$('#submitBtn').onclick = () => { const m = MODES[session.mode]; if (m.submit) m.submit(current()); else submit(); };
$('#answer').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && session && session.answered && document.activeElement !== $('#answer')) { e.preventDefault(); next(); }
});

async function submit() {
  if (!session || session.answered) return;
  const ans = $('#answer').value.trim();
  if (!ans) { toast('請先輸入英文，或按 🎤 錄音'); return; }
  const it = current();
  setBusy(true);
  try {
    const r = await gemini(GRADE_PROMPT, `中文：${it.zh}\n課文原句：${it.en}\n學生的英文：${ans}`);
    if (!VERDICT[r.verdict]) r.verdict = 'partial';
    finish(ans, r);
  } catch (e) {
    setBusy(false);
    toast(e.message);
  }
}

function finish(ans, r) {
  const it = current();
  session.answered = true;
  const usedHint = session.hints > 0 && r.verdict === 'correct';
  const prevLevel = level(it);
  if (ans) logAnswer(r);   // 跳過的不算進今天的量
  schedule(it, usedHint ? 'partial' : r.verdict, ans, MODES[session.mode].cap);
  session.results.push({ item: it, answer: ans, r, prevLevel, mode: session.mode });
  $('#modeArea').querySelectorAll('.opt, .chip, input').forEach(x => x.disabled = true);
  $('#qZh').classList.remove('hidden');
  renderResult(it, ans, r, usedHint);
  $('#answer').disabled = true;
  $('#askActions').classList.add('hidden');
  $('#nextActions').classList.remove('hidden');
  $('#nextBtn').textContent = session.i + 1 < session.queue.length ? '下一題 →' : '看結果';
  $('#nextBtn').focus();
}

// cap：這種題型答對最多升到第幾階。簡單的題型（聽力、重組、克漏字、跟讀）升不到「精熟」，要自己說得出來才算真的會
function schedule(it, verdict, ans, cap = INTERVALS.length - 1) {
  const now = Date.now();
  it.attempts++;
  if (verdict === 'correct') {
    it.correct++;
    // 已經超過這種題型的上限：答對不影響原本的複習排程
    if (it.box < cap) { it.box++; it.due = now + INTERVALS[it.box] * DAY; }
  } else {
    it.box = verdict === 'partial' ? 1 : 0;
    it.due = now + INTERVALS[it.box] * DAY;
  }
  it.last = verdict;
  it.lastAnswer = ans;
  it.lastAt = now;
  save();
}

// lite 模型偶爾會用韓文、日文拼「聽起來像」，這種就不顯示
const FOREIGN_SCRIPT = /[가-힯぀-ヿ一-鿿]/;
const PRON_DETAIL = { accuracy: '單字發音', fluency: '流暢度', intonation: '語調', rhythm: '重音節奏' };
const list = a => (Array.isArray(a) ? a : []).filter(Boolean);
function stars(n) { const s = clampScore(n); return '★'.repeat(s) + '☆'.repeat(5 - s); }
function sayBtns(text, withSlow) {
  return `<button class="speak" title="真人語調朗讀" data-say="${esc(text)}">🔊</button>` +
    (withSlow ? `<button class="speak" title="慢速朗讀" data-say="${esc(text)}" data-slow="1">🐢</button>` : '');
}

function renderResult(it, ans, r, usedHint) {
  const errs = list(r.errors).map(e => `
    <div class="err"><span class="tag">${esc(e.type || '錯誤')}</span>
      ${e.wrong ? `<del>${esc(e.wrong)}</del> → ` : ''}<ins>${esc(e.fix)}</ins>
      <div>${esc(e.explain)}</div>
      ${e.rule ? `<div class="muted">📌 ${esc(e.rule)}</div>` : ''}
      ${e.example ? `<div class="muted">例：${esc(e.example)} ${sayBtns(e.example)}</div>` : ''}</div>`).join('');
  const showCorrected = r.corrected && r.corrected.trim() !== ans.trim();
  const natural = list(r.natural).filter(s => s.trim() !== it.en.trim());
  $('#result').innerHTML = `
    <span class="verdict v-${r.verdict}">${VERDICT[r.verdict]}</span>
    ${usedHint ? '<span class="muted">（有用提示，下次會提早複習）</span>' : ''}
    ${r.good ? `<div class="good">👍 ${esc(r.good)}</div>` : ''}
    ${ans ? `<div class="line"><b>${r.audio ? 'Gemini 聽到' : '你的回答'}</b>${esc(ans)}</div>` : ''}
    ${r.audio && session.recUrl ? `<div class="line"><b>你的錄音</b></div><audio controls src="${session.recUrl}"></audio>` : ''}
    ${errs}
    ${showCorrected ? `<div class="line"><b>修正後</b><ins>${esc(r.corrected)}</ins> ${sayBtns(r.corrected)}</div>` : ''}
    <div class="line"><b>課文原句</b>${esc(it.en)} ${sayBtns(it.en, true)}</div>
    ${natural.length ? `<div class="line"><b>更自然的說法</b>${natural.map(s => `<div>${esc(s)} ${sayBtns(s)}</div>`).join('')}</div>` : ''}
    ${r.note ? `<div class="line muted">💡 ${esc(r.note)}</div>` : ''}
    ${renderPron(r.pronunciation, it)}
    ${list(r.practice).length ? `<div class="sec"><h3>📝 練習建議</h3><ol>${list(r.practice).map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}`;
  $('#result').classList.remove('hidden');
}

function renderPron(p, it) {
  if (!p) return '';
  const d = p.detail || {};
  const stress = p.stress || {};
  return `<div class="sec pron">
    <h3>🗣️ 發音 <span class="stars">${stars(p.score)}</span></h3>
    ${Object.keys(PRON_DETAIL).some(k => d[k]) ? `<div class="subs">${Object.entries(PRON_DETAIL).map(([k, name]) =>
      `<div><span>${name}</span><span class="stars">${stars(d[k])}</span></div>`).join('')}</div>` : ''}
    ${stress.marked ? `<div class="line"><b>重音</b><span class="marked">${esc(stress.marked)}</span> ${sayBtns(it.en, true)}
      ${stress.comment ? `<div class="muted">${esc(stress.comment)}</div>` : ''}</div>` : ''}
    ${p.intonation ? `<div class="line"><b>語調</b>${esc(p.intonation)}</div>` : ''}
    ${list(p.linking).length ? `<div class="line"><b>連音</b>${list(p.linking).map(x =>
      `<div>🔗 ${esc(x.phrase)} → <b class="w">${esc(x.how)}</b><span class="muted">${esc(x.comment)}</span></div>`).join('')}</div>` : ''}
    ${list(p.items).map(x => `<div class="word">
      <div>🔸 <b class="w">${esc(x.word)}</b>${x.kk ? `<span class="kk">${esc(x.kk)}</span>` : ''} ${x.word ? sayBtns(x.word, true) : ''}</div>
      ${x.heard_as && !FOREIGN_SCRIPT.test(x.heard_as) ? `<div class="muted">聽起來像：${esc(x.heard_as)}</div>` : ''}
      <div>${esc(x.issue)}</div>
      ${x.tip ? `<div class="muted">👉 ${esc(x.tip)}</div>` : ''}</div>`).join('')}
    ${p.comment ? `<div class="muted" style="margin-top:8px">${esc(p.comment)}</div>` : ''}
  </div>`;
}
function clampScore(n) { return Math.max(1, Math.min(5, Math.round(Number(n) || 3))); }
$('#result').addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) playVoice(b, b.dataset.say, !!b.dataset.slow); });
$('#nextBtn').onclick = next;
function next() {
  if (!session) return;
  session.i++;
  if (session.i < session.queue.length) showQuestion(); else showSummary();
}
$('#quitBtn').onclick = e => { e.preventDefault(); cancelRecording(); if (session.results.length) showSummary(); else endSession(); };

function showSummary() {
  const res = session.results, n = res.length;
  const ok = res.filter(x => x.r.verdict === 'correct').length;
  const tally = {};
  res.forEach(x => (x.r.errors || []).forEach(e => { const t = e.type || '其他'; tally[t] = (tally[t] || 0) + 1; }));
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const missed = res.filter(x => x.r.verdict !== 'correct');
  const spoken = res.filter(x => x.r.pronunciation);
  const byMode = Object.keys(MODES).map(k => [k, res.filter(x => x.mode === k).length]).filter(x => x[1]);
  const pronAvg = spoken.length ? (spoken.reduce((s, x) => s + clampScore(x.r.pronunciation.score), 0) / spoken.length).toFixed(1) : '';
  $('#summary').innerHTML = `
    <h2>練習結果</h2>
    <div class="cheer">${cheers(session).map(c => `<div>${esc(c)}</div>`).join('')}</div>
    <div class="stat">
      <div><span class="muted">答對率</span><strong>${n ? Math.round(ok / n * 100) : 0}%</strong></div>
      <div><span class="muted">完全正確</span><strong>${ok} / ${n}</strong></div>
      ${pronAvg ? `<div><span class="muted">發音平均</span><strong>${pronAvg} / 5</strong></div>` : ''}
    </div>
    ${byMode.length > 1 ? `<p class="muted">這次練了：${byMode.map(([k, c]) => `${MODES[k].icon} ${MODES[k].name} ${c}`).join('・')}</p>` : ''}
    ${top.length ? `<p><b>最常犯的錯誤：</b>${top.map(([t, c]) => `${esc(t)}（${c} 次）`).join('、')}</p>` : ''}
    ${missed.length ? `<h2>要再加強的句子</h2><div class="overflow"><table>
      <tr><th>中文</th><th>正確英文</th><th>你的回答</th></tr>
      ${missed.map(x => `<tr><td>${esc(x.item.zh)}</td><td>${esc(x.item.en)}</td><td>${esc(x.answer || '（跳過）')}</td></tr>`).join('')}
    </table></div>` : '<p>全部答對，太厲害了！</p>'}
    <div class="actions">
      ${missed.length ? '<button class="btn primary" id="retryBtn">重練這次的錯題</button>' : ''}
      <button class="btn" id="homeBtn">回到首頁</button>
    </div>`;
  $('#quiz').classList.add('hidden');
  $('#summary').classList.remove('hidden');
  const missedItems = missed.map(x => x.item);
  const type = session.type;
  if (missed.length) $('#retryBtn').onclick = () => startSession(missedItems, type);
  $('#homeBtn').onclick = endSession;
}
function endSession() {
  cancelRecording();
  session = null;
  $('#quiz').classList.add('hidden');
  $('#summary').classList.add('hidden');
  $('#home').classList.remove('hidden');
  renderSetup();
}
