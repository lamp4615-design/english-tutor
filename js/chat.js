// 💬 情境對話：Gemini 用課文的句子設計一個情境、扮演對方，學生用英文回應（打字或錄音），每句都有即時回饋
const CHAT_TURNS = 6;
let chat = null;   // { lesson, scene, them, me, log: [{ who, en, zh, fb }], turns, busy, showZh, before }

const CHAT_START_PROMPT = `你是英文家教，要和台灣的成人學生做英文情境對話練習。你會收到一課的英文句子，請設計一個日常情境，讓學生在對話中有機會用到這些句子。
規則：
- scene：一句繁體中文，說明情境（例如「你在餐廳點餐，服務生來問你要點什麼」）。
- them：你扮演的角色（繁體中文，例如「服務生」）；me：學生的角色（繁體中文）。
- opening：你扮演的角色說的第一句英文，簡單自然、一兩句，結尾要讓學生有話可以回。opening_zh：這句的繁體中文。
只輸出 JSON：{"scene":"","them":"","me":"","opening":"","opening_zh":""}`;

const CHAT_TURN_PROMPT = `你在和台灣的成人學生做英文情境對話練習。你會收到：情境、你的角色、學生的角色、課文句子、目前為止的對話，以及學生這一次說的話（打字或錄音）。
請做兩件事：
1. 批改學生這一句：
- heard：有錄音時，逐字寫下你聽到的英文（唸錯的照實寫）；打字時留空字串。完全聽不到英文時 heard 留空、其他欄位也留空。
- ok：意思清楚、文法正確、在這個情境自然，就給 true。小地方不自然但沒錯也算 true。
- 不是 true 時：fix＝保留學生原意、修正後的句子；type＝錯誤類型，從這些選一個：文法、時態、用字、拼字、冠詞、介系詞、單複數、語序、漏字、意思錯誤、其他；tip＝一句繁體中文說明。
- good：一句繁體中文，具體說出這句做得好的地方（例如用對了課文的句型）。
2. 繼續對話：
- reply：你的角色接下來說的英文，自然、簡短（一兩句），要回應學生說的內容（就算學生有錯，也照他想表達的意思回應），並讓他有機會用到課文的句子。reply_zh：這句的繁體中文。
- 學生已經說到第 ${CHAT_TURNS} 句時，用 reply 自然地結束對話（例如道謝、道別），end 給 true；其他時候 end 給 false。
只輸出 JSON：{"heard":"","ok":true,"fix":"","type":"","tip":"","good":"","reply":"","reply_zh":"","end":false}`;

$('#chatBtn').onclick = async () => {
  const id = $('#selLesson').value;
  const pool = db.lessons.filter(l => l.items.length && (id === 'all' || l.id === id));
  if (!pool.length) { toast('請先到「課文」加一篇課文'); return; }
  const lesson = pool[Math.floor(Math.random() * pool.length)];
  unlockVoice();
  chat = { lesson, log: [], turns: 0, busy: true, showZh: false, before: snapshot() };
  $('#home').classList.add('hidden');
  $('#summary').classList.add('hidden');
  $('#chat').classList.remove('hidden');
  $('#chatEnd').classList.add('hidden');
  $('#chatInput').classList.remove('hidden');
  $('#chatScene').textContent = 'Gemini 正在設計情境…';
  $('#chatLog').innerHTML = '';
  renderChatProg();
  try {
    const r = await gemini(CHAT_START_PROMPT, `課文「${lesson.title}」的句子：\n${lesson.items.map(it => it.en).join('\n')}`);
    if (!chat || chat.lesson !== lesson) return;
    Object.assign(chat, { scene: r.scene || '', them: r.them || '對方', me: r.me || '你', busy: false });
    renderChatProg();
    $('#chatScene').textContent = `${chat.scene}（Gemini 演${chat.them}，你是${chat.me}）`;
    addThem(r.opening, r.opening_zh);
  } catch (e) {
    toast(e.message);
    closeChat();
  }
};

function renderChatProg() {
  $('#chatProg').textContent = `💬 情境對話・第 ${Math.min(chat.turns + 1, CHAT_TURNS)} / ${CHAT_TURNS} 句`;
  ['#chatSend', '#chatMic', '#chatText'].forEach(s => $(s).disabled = chat.busy);
  $('#chatSend').textContent = chat.busy ? 'Gemini 回應中…' : '送出';
}
function addThem(en, zh) {
  chat.log.push({ who: 'them', en: String(en || ''), zh: String(zh || '') });
  renderChatLog();
  playVoice(null, en);
}
function renderChatLog() {
  $('#chatLog').innerHTML = chat.log.map((m, i) => m.who === 'them'
    ? `<div class="msg them"><div class="b">${esc(m.en)} <button class="speak" data-say="${esc(m.en)}" title="再聽一次">🔊</button><button class="speak" data-say="${esc(m.en)}" data-slow="1" title="慢速">🐢</button></div>` +
      `${chat.showZh && m.zh ? `<div class="zh2">${esc(m.zh)}</div>` : ''}</div>`
    : `<div class="msg me"><div class="b">${esc(m.en)}</div>${m.fb ? `<div class="fb">${m.fb.ok
      ? `👍 ${esc(m.fb.good || '說得很好')}`
      : `<span class="muted">更好的說法：</span><ins>${esc(m.fb.fix)}</ins> ${sayBtns(m.fb.fix)}<div class="muted">${esc(m.fb.tip)}</div>`}</div>` : ''}</div>`).join('');
  const last = $('#chatLog').lastElementChild;
  if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
$('#chatLog').addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) playVoice(b, b.dataset.say, !!b.dataset.slow); });
$('#chatZh').onclick = () => { chat.showZh = !chat.showZh; $('#chatZh').textContent = chat.showZh ? '隱藏中文' : '看中文'; renderChatLog(); };
$('#chatSend').onclick = () => {
  const t = $('#chatText').value.trim();
  if (!t) { toast('請先輸入英文，或按 🎤 錄音'); return; }
  chatTurn(t, null);
};
$('#chatText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chatSend').click(); } });
const CHAT_REC = { btn: '#chatMic', lock: ['#chatSend', '#chatText', '#chatZh'], onBlob: async b => {
  try { chatTurn(null, { mime: 'audio/wav', data: await blobToWavBase64(b) }); } catch (e) { toast(e.message); }
} };
$('#chatMic').onclick = () => { if (rec) rec.recorder.stop(); else if (!chat.busy) startRecording(CHAT_REC); };

async function chatTurn(text, audio) {
  if (!chat || chat.busy) return;
  const c = chat;
  c.busy = true;
  const me = { who: 'me', en: text || '🎤 …' };
  c.log.push(me);
  renderChatLog(); renderChatProg();
  try {
    const input = {
      情境: c.scene, 你的角色: c.them, 學生的角色: c.me,
      課文句子: c.lesson.items.map(it => it.en),
      目前的對話: c.log.slice(0, -1).map(m => `${m.who === 'them' ? c.them : c.me}：${m.en}`),
      學生這是第幾句: c.turns + 1,
      學生這一句: text || '（錄音如下）'
    };
    const r = await gemini(CHAT_TURN_PROMPT, JSON.stringify(input), audio, audio ? audioModel() : null);
    if (chat !== c) return;
    if (audio) {
      const heard = String(r.heard || '').trim();
      if (!heard) { c.log.pop(); renderChatLog(); toast('沒有聽到英文，請再錄一次'); return; }
      me.en = heard;
    }
    me.fb = { ok: r.ok !== false || !r.fix, fix: String(r.fix || ''), tip: String(r.tip || ''), good: String(r.good || ''), type: r.type || '其他' };
    c.turns++;
    logAnswer({ verdict: me.fb.ok ? 'correct' : 'partial', errors: me.fb.ok ? [] : [{ type: me.fb.type }] });
    save();
    $('#chatText').value = '';
    if (r.reply) addThem(r.reply, r.reply_zh); else renderChatLog();
    if (r.end || c.turns >= CHAT_TURNS) endChat();
  } catch (e) {
    if (chat === c) { c.log.pop(); renderChatLog(); }
    toast(e.message);
  } finally {
    if (chat === c) { c.busy = false; renderChatProg(); }
  }
}

function endChat() {
  const c = chat, mine = c.log.filter(m => m.who === 'me' && m.fb);
  const good = mine.filter(m => m.fb.ok).length, fixes = mine.filter(m => !m.fb.ok);
  // 借用練習結果的鼓勵（連續天數、目標達成、常錯類型這次沒錯）
  const lines = cheers({ before: c.before, results: mine.map(m => ({ item: {}, prevLevel: 0, r: { errors: m.fb.ok ? [] : [{ type: m.fb.type }] } })) });
  $('#chatInput').classList.add('hidden');
  $('#chatEnd').classList.remove('hidden');
  $('#chatEnd').innerHTML = `<div class="cheer" style="margin-top:14px">${[`💬 對話了 ${mine.length} 句，其中 ${good} 句一次就說得很好！`, ...lines.filter(l => !/^💪/.test(l))].map(l => `<div>${esc(l)}</div>`).join('')}</div>` +
    (fixes.length ? `<h2>可以說得更好的句子</h2>${fixes.map(m => `<div class="err"><del>${esc(m.en)}</del> → <ins>${esc(m.fb.fix)}</ins> ${sayBtns(m.fb.fix)}<div class="muted">${esc(m.fb.tip)}</div></div>`).join('')}` : '') +
    `<div class="actions"><button class="btn primary" id="chatAgain">換個情境再聊</button><button class="btn" id="chatHome">回到首頁</button></div>`;
  $('#chatAgain').onclick = () => { closeChat(); $('#chatBtn').click(); };
  $('#chatHome').onclick = closeChat;
}
$('#chatEnd').addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) playVoice(b, b.dataset.say, !!b.dataset.slow); });
$('#chatQuit').onclick = e => {
  e.preventDefault();
  if (rec) cancelRecording();
  if (chat && chat.turns && $('#chatEnd').classList.contains('hidden')) endChat(); else closeChat();
};
function closeChat() {
  if (rec) cancelRecording();
  chat = null;
  $('#chat').classList.add('hidden');
  $('#home').classList.remove('hidden');
  renderSetup();
}
