// 共用：常數、連線後端、存檔、Gemini 提示詞、分頁
const $ = s => document.querySelector(s);
const DAY = 864e5;
const INTERVALS = [0, 1, 2, 4, 7, 15, 30];
const VERDICT = { correct: '完全正確', partial: '意思對，但有錯', wrong: '意思不對' };
// lite 版批改約 1～2 秒；完整版常忙線，要重試很久
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const OLD_DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-flash-latest'];
const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbxHlvAinyEKuBxo2rwCAnjzetTUu9JFrPw9Wtrp9wAPpFpsRVtKWjiqhyI_VL5QTfUV/exec';
const CONN_KEY = 'english-tutor.conn';
const MAX_REC_SEC = 30;

let db = { lessons: [], settings: {}, stats: { days: {} } };
let rev = 0, hasKey = false, loaded = false;
let session = null;   // { queue, i, results, hints, answered, recUrl }
let rec = null;       // { recorder, stream, timer }
let driveGroups = null;   // [{ folderName, files, error }]，null 代表還沒讀過

// 後端網址和通行碼只記在這個瀏覽器
function getConn() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(CONN_KEY)) || {}; } catch (e) {}
  return { url: c.url || DEFAULT_API_URL, token: c.token || '' };
}
function setConn(c) {
  try { localStorage.setItem(CONN_KEY, JSON.stringify(c)); } catch (e) { toast('這個瀏覽器無法記住設定'); }
}

// 呼叫 Code.gs 的函式。Content-Type 用 text/plain，才不會被瀏覽器擋（CORS 預檢）
async function run(fn, ...args) {
  const { url, token } = getConn();
  if (!url || !token) throw new Error('請先到「設定」填寫後端網址和通行碼');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, fn, args })
    });
  } catch (e) {
    throw new Error('連不到後端，請檢查網路，或確認 Apps Script 部署的存取權是「任何人」');
  }
  let d;
  try { d = await res.json(); }
  catch (e) { throw new Error('後端回應格式不對，請確認後端網址是結尾 /exec 的網址，且存取權是「任何人」'); }
  if (!d.ok) throw new Error(d.error);
  return d.result;
}

function applyData(d) {
  const parsed = JSON.parse(d.json || '{}');
  db = { lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [], settings: parsed.settings || {}, stats: parsed.stats || {} };
  if (!db.stats.days) db.stats.days = {};
  if (!db.settings.model || OLD_DEFAULT_MODELS.includes(db.settings.model)) db.settings.model = DEFAULT_MODEL;
  rev = d.rev; hasKey = d.hasKey;
}

// 存檔：等使用者停下來 0.6 秒再一次寫進雲端；同時間只送一筆
let saveTimer = null, saving = false, dirty = false;
function save() {
  if (!loaded) return;
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 600);
}
async function flush() {
  if (saving || !dirty) return;
  saving = true; dirty = false;
  try {
    const r = await run('saveData', JSON.stringify(db), rev);
    if (r.ok) rev = r.rev;
    else {
      applyData(await run('loadData'));
      toast('其他裝置剛更新過資料，已重新載入最新版本');
      if (!session) { renderSetup(); renderLessons(); }
    }
  } catch (e) {
    dirty = true;
    toast('雲端儲存失敗，稍後會再試：' + e.message);
    setTimeout(flush, 5000);
  } finally {
    saving = false;
    if (dirty) save();
  }
}
window.addEventListener('beforeunload', e => { if (dirty || saving) { e.preventDefault(); e.returnValue = ''; } });
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ---------- Gemini ----------
function gemini(system, user, audio, model) {
  if (!hasKey) return Promise.reject(new Error('請先到「設定」輸入 Gemini API 金鑰'));
  return run('gemini', system, user, model || db.settings.model || DEFAULT_MODEL, audio || null);
}
// 錄音分析：仔細＝3.8 Flash（聽得出語調平淡等細節）；快速＝lite 版（約 3 秒）。3.8 忙線時後端會自動改用 lite
const AUDIO_MODELS = { detail: 'gemini-3.8-flash', fast: DEFAULT_MODEL };
function audioModel() { return AUDIO_MODELS[db.settings.audioMode] || AUDIO_MODELS.detail; }

const EXTRACT_PROMPT = `你會收到一篇雙語（英文＋中文）課程內容。請抽出適合做「看中文、說英文」練習的英文句子，並配上對應的中文。
規則：
- 以完整句子為單位；超過 25 個字的長句可依子句切開。
- 標題、頁碼、說明文字可略過；有意義的片語可保留。
- 英文保持原文，不要改寫。
- 有對應中文就用課文的中文；沒有的話請翻成自然的繁體中文。
- 依課文順序。
只輸出 JSON 陣列：[{"en":"...","zh":"..."}]`;

const GRADE_RULES = `- 標準是「意思正確，而且英文文法正確、自然」，不要求跟課文原句一模一樣。學生的說法若也正確自然，verdict 給 correct，並在 note 說明跟原句的差別。
- 忽略大小寫和句尾標點。
- verdict：correct＝意思正確且沒有文法錯誤；partial＝意思大致對，但有文法、用字錯誤或漏掉部分內容；wrong＝意思不對或幾乎沒答。
- errors：逐一列出錯誤。type 從這些選一個：文法、時態、用字、拼字、冠詞、介系詞、單複數、語序、漏字、意思錯誤、其他。wrong＝學生說錯的片段，fix＝修正後的片段，explain＝用繁體中文說明為什麼錯，rule＝一句話的文法規則（台灣學生好記的說法），example＝另一個套用同規則的英文例句。
- corrected：保留學生原本的說法，只改掉錯的地方後的完整句子。全對就和學生答案相同。
- natural：1～2 個母語人士在日常對話中更常用的說法（跟課文原句、corrected 都不同的才列，沒有就給空陣列）。
- good：一句繁體中文，具體說出學生這次做對的地方（例如時態用對、單字選得好、句型完整），讓他知道哪些已經會了；幾乎沒答就留空。
- note：一兩句繁體中文總評，語氣像鼓勵人的家教。`;

const GRADE_JSON = `"verdict":"correct|partial|wrong","good":"","errors":[{"type":"","wrong":"","fix":"","explain":"","rule":"","example":""}],"corrected":"","natural":[""],"note":""`;

const GRADE_PROMPT = `你是英文家教，學生是台灣的成人學習者。學生看中文，用英文寫出意思。請批改學生的英文，給具體、可以照著改的回饋。
規則：
${GRADE_RULES}
- 學生可能用手機鍵盤語音輸入，若明顯是語音辨識的同音字問題，在 note 提醒即可，不算錯。
只輸出 JSON：{${GRADE_JSON}}`;

// 發音評分規則：看中文說英文、跟讀共用
const PRON_RULES = `- score：整體 1～5（5＝清楚自然，3＝聽得懂但有明顯口音或錯誤，1＝很難聽懂）。
- detail：四個分項各 1～5 分：accuracy（單字發音準確）、fluency（流暢度：停頓、卡住、重複）、intonation（語調起伏）、rhythm（重音與節奏）。
- items：逐字檢查，列出每一個唸不準的字：word、heard_as（聽起來像什麼，只能用英文字母拼法或 KK 音標）、issue（哪裡不對：母音、子音、字尾子音沒發、多加母音、重音位置等）、tip（具體怎麼調整嘴型、舌位或發音）、kk（正確 KK 音標）。台灣學生常見問題要特別注意：th 發成 s/z、v 發成 b/f、字尾 d/t/s 吞掉、r/l 不分、長短母音不分（i/ɪ、u/ʊ）、æ 和 ɛ 不分、在子音後多加「ㄜ」。沒有問題就給空陣列。
- stress：marked＝把課文原句改寫成標出重音的版本，重讀的音節用全大寫，例如 "I WENT to the LIbrary YESterday."；comment＝學生的重音跟這個差在哪。
- intonation：這句應有的語調（例如直述句結尾下降、Yes/No 問句結尾上升），以及學生實際的語調哪裡不同。語調平淡、每個字一樣重也要指出來。
- linking：這句裡母語人士會連在一起唸的地方：phrase（原文）、how（實際唸法，例如 "wen-tə"）、comment（學生有沒有連起來）。沒有就給空陣列。
- comment：一句總評。`;
const PRON_JSON = `"pronunciation":{"score":3,"detail":{"accuracy":3,"fluency":3,"intonation":3,"rhythm":3},"items":[{"word":"","heard_as":"","issue":"","tip":"","kk":""}],"stress":{"marked":"","comment":""},"intonation":"","linking":[{"phrase":"","how":"","comment":""}],"comment":""}`;
const PRACTICE_RULE = `practice：2～3 個具體的練習步驟，每個是一句繁體中文的行動指示，針對這次最需要改的問題，可以提到按「🐢 慢速」跟讀（例如：「先按 🐢 慢速跟讀三次，特別注意 library 的 br 要連在一起」）。`;

const AUDIO_PROMPT = `你是專業的英語口說教練，學生是台灣的成人學習者，母語是中文。學生看中文，用說的說出英文，你會收到他的錄音。請仔細聽，給具體、可以照著練的回饋。

步驟：
1. heard：逐字寫下你聽到的英文。講錯、唸錯的地方照實寫，不要幫他修正；聽不清楚的字寫成 (?)。完全聽不到英文就留空字串。

2. 用 heard 批改文法和用字：
${GRADE_RULES}

3. pronunciation（說明全部用繁體中文，音標用 KK 音標，不要出現中文、英文以外的文字）：
${PRON_RULES}

4. ${PRACTICE_RULE}

只輸出 JSON：
{"heard":"",${GRADE_JSON},${PRON_JSON},"practice":[""]}`;

// 跟讀：學生聽完標準發音，看著英文唸一次，只評發音
const SHADOW_PROMPT = `你是專業的英語口說教練，學生是台灣的成人學習者，母語是中文。學生在練「跟讀」：先聽標準發音，再看著英文句子唸一次。你會收到他的錄音。這次只評發音，不評文法。請仔細聽，給具體、可以照著練的回饋。

步驟：
1. heard：逐字寫下你聽到的英文。唸錯的地方照實寫，不要幫他修正；聽不清楚的字寫成 (?)。完全聽不到英文就留空字串。

2. good：一句繁體中文，具體說出這次唸得好的地方（例如某個字的音很準、語調自然、節奏穩），讓他知道哪些已經會了。

3. pronunciation（說明全部用繁體中文，音標用 KK 音標，不要出現中文、英文以外的文字）：
${PRON_RULES}

4. ${PRACTICE_RULE}

只輸出 JSON：
{"heard":"","good":"",${PRON_JSON},"practice":[""]}`;

// ---------- 分頁 ----------
document.querySelectorAll('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
function showTab(name) {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  ['practice', 'progress', 'lessons', 'settings'].forEach(t => $('#tab-' + t).classList.toggle('hidden', t !== name));
  if (name === 'practice') renderSetup();
  if (name === 'progress') renderProgress();
  if (name === 'lessons') { renderLessons(); if (loaded && !driveGroups && folderList().length) loadFolders(); }
  if (name === 'settings') renderSettings();
}
