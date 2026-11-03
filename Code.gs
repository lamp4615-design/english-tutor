// 英文家教 — Apps Script 後端（API）
// 網頁放在 GitHub Pages，透過 doPost 呼叫這裡：讀雲端硬碟的課文、代為呼叫 Gemini、把練習紀錄存在雲端硬碟
// 部署：網頁應用程式，執行身分「我」，存取權「任何人」；靠通行碼擋掉陌生人

const DATA_NAME = '英文家教資料.json';
const MIME_DOC = 'application/vnd.google-apps.document';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
// 語音：3.1 版只唸句子、長度正常；2.5 版備用（3.8-lite 會把指示也唸出來，不要用）
const TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
const TTS_VOICE = 'Kore';
const TTS_FOLDER_NAME = '英文家教語音';

// 網頁可以呼叫的函式
const API = { loadData, saveData, setApiKey, listDriveFiles, getDriveText, gemini, tts };

function doGet() {
  return ContentService.createTextOutput('英文家教後端運作中');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const token = props_().getProperty('APP_TOKEN');
    if (!token) throw new Error('後端還沒設定通行碼，請在 Apps Script 執行 setupToken');
    if (req.token !== token) throw new Error('通行碼不正確');
    if (!Object.prototype.hasOwnProperty.call(API, req.fn)) throw new Error('沒有這個功能：' + req.fn);
    out = { ok: true, result: API[req.fn].apply(null, req.args || []) };
  } catch (err) {
    out = { ok: false, error: err.message || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// 在 Apps Script 編輯器選這個函式按「執行」，到「執行記錄」複製通行碼，貼到網頁的設定頁
function setupToken() {
  const token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  props_().setProperty('APP_TOKEN', token);
  console.log('你的通行碼：' + token);
  return token;
}

function props_() { return PropertiesService.getScriptProperties(); }

// ---------- 練習資料 ----------
function dataFile_() {
  const p = props_();
  const id = p.getProperty('DATA_FILE_ID');
  if (id) {
    try {
      const f = DriveApp.getFileById(id);
      if (!f.isTrashed()) return f;
    } catch (e) {}
  }
  const f = DriveApp.createFile(DATA_NAME, '{"lessons":[],"settings":{}}', 'application/json');
  p.setProperty('DATA_FILE_ID', f.getId());
  p.setProperty('REV', '0');
  return f;
}

function loadData() {
  const f = dataFile_();
  const p = props_();
  return {
    json: f.getBlob().getDataAsString('UTF-8'),
    rev: Number(p.getProperty('REV') || 0),
    hasKey: !!p.getProperty('GEMINI_API_KEY')
  };
}

// baseRev 跟雲端不同，代表其他裝置剛存過，拒絕覆蓋
function saveData(json, baseRev) {
  JSON.parse(json);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const p = props_();
    const rev = Number(p.getProperty('REV') || 0);
    if (Number(baseRev) !== rev) return { ok: false, rev: rev };
    dataFile_().setContent(json);
    p.setProperty('REV', String(rev + 1));
    return { ok: true, rev: rev + 1 };
  } finally {
    lock.releaseLock();
  }
}

function setApiKey(key) {
  key = String(key || '').trim();
  if (key) props_().setProperty('GEMINI_API_KEY', key);
  else props_().deleteProperty('GEMINI_API_KEY');
  return !!key;
}

// ---------- 雲端硬碟 ----------
function folderId_(input) {
  const s = String(input || '').trim();
  const m = s.match(/folders\/([\w-]+)/) || s.match(/[?&]id=([\w-]+)/);
  return m ? m[1] : s;
}

function listDriveFiles(folderInput) {
  let folder;
  try {
    folder = DriveApp.getFolderById(folderId_(folderInput));
  } catch (e) {
    throw new Error('找不到這個資料夾，請確認網址是否正確');
  }
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const t = f.getMimeType();
    if (t !== MIME_DOC && t !== MIME_DOCX) continue;
    files.push({
      id: f.getId(),
      name: f.getName(),
      type: t === MIME_DOC ? 'doc' : 'docx',
      modified: f.getLastUpdated().getTime()
    });
  }
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return { folderId: folder.getId(), folderName: folder.getName(), files: files };
}

// Google 文件直接匯出文字；Word 檔先轉成暫存的 Google 文件再匯出，用完丟垃圾桶
function getDriveText(fileId) {
  const f = DriveApp.getFileById(fileId);
  const type = f.getMimeType();
  const headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  let docId = fileId, temp = null;
  if (type === MIME_DOCX) {
    const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '/copy?fields=id', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ name: '（暫存）' + f.getName(), mimeType: MIME_DOC }),
      headers: headers,
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) throw new Error('Word 檔轉換失敗：' + r.getContentText().slice(0, 200));
    docId = temp = JSON.parse(r.getContentText()).id;
  } else if (type !== MIME_DOC) {
    throw new Error('只支援 Google 文件和 Word 檔');
  }
  try {
    const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + docId + '/export?mimeType=text/plain', {
      headers: headers,
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) throw new Error('讀取檔案失敗：' + r.getContentText().slice(0, 200));
    return {
      title: f.getName().replace(/\.docx$/i, ''),
      text: r.getContentText('UTF-8'),
      modified: f.getLastUpdated().getTime()
    };
  } finally {
    if (temp) {
      try { DriveApp.getFileById(temp).setTrashed(true); } catch (e) {}
    }
  }
}

// ---------- Gemini ----------
// audio：{ mime: 'audio/wav', data: base64 }，有錄音時一起交給 Gemini 聽
function gemini(system, user, model, audio) {
  const key = props_().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('請先到「設定」輸入 Gemini API 金鑰');
  model = String(model || '').trim() || FALLBACK_MODEL;
  const parts = [{ text: user }];
  if (audio && audio.data) parts.push({ inlineData: { mimeType: audio.mime || 'audio/wav', data: audio.data } });
  // 模型忙線（503）時馬上改用備用模型；本身就是備用模型時等一下再試一次
  const tries = model === FALLBACK_MODEL ? [model, model] : [model, FALLBACK_MODEL];
  let code, data;
  for (let i = 0; i < tries.length; i++) {
    const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + tries[i] + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: parts }],
        generationConfig: genConfig_(tries[i])
      }),
      muteHttpExceptions: true
    });
    code = r.getResponseCode();
    try { data = JSON.parse(r.getContentText()); } catch (e) { data = {}; }
    // 忙線（503），或 3.8 版不接受這個請求（400/404）時，改用備用模型；其他模型名稱打錯照常回報
    if (code !== 503 && !((code === 400 || code === 404) && /^gemini-3\.8/.test(tries[i]))) break;
    if (i < tries.length - 1 && tries[i + 1] === tries[i]) Utilities.sleep(1500);
  }
  if (code !== 200) {
    const msg = (data.error && data.error.message) || ('HTTP ' + code);
    if (code === 503) throw new Error('Gemini 目前忙線，請過一下再按一次');
    if (code === 429) throw new Error('超過免費額度或太頻繁，請稍等再試（' + msg + '）');
    if (code === 400 || code === 403 || code === 404) throw new Error('金鑰或模型名稱有問題：' + msg);
    throw new Error(msg);
  }
  const out = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = out.filter(p => !p.thought).map(p => p.text || '').join('');
  if (!text) throw new Error('Gemini 沒有回應內容，請再試一次');
  return JSON.parse(text.replace(/^\s*```(json)?/, '').replace(/```\s*$/, ''));
}

// 3.8 版不再接受 temperature，改用思考程度（low 回得比較快）；舊模型維持原本設定
function genConfig_(model) {
  if (/^gemini-3\.8/.test(model)) return { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } };
  return { responseMimeType: 'application/json', temperature: 0.2 };
}

// ---------- 語音 ----------
// 用 Gemini 產生真人語調的發音。產生過的存在雲端硬碟「英文家教語音」資料夾，同一句下次直接拿，不用再等、也不耗額度
// 回傳 { mime, data }：mime 可能是 audio/wav 或 audio/L16;rate=24000（網頁會自己轉成 WAV）
// lang：'zh' 唸中文（開車聽用），其他都唸英文
function tts(text, slow, lang) {
  text = String(text || '').trim();
  if (!text) throw new Error('沒有要唸的句子');
  const zh = lang === 'zh';
  const name = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, TTS_VOICE + '|' + (zh ? 'zh|' : '') + (slow ? 'slow' : 'normal') + '|' + text)
    .map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('') + '.json';
  const folder = ttsFolder_();
  const hit = folder.getFilesByName(name);
  if (hit.hasNext()) return JSON.parse(hit.next().getBlob().getDataAsString());

  const key = props_().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('請先到「設定」輸入 Gemini API 金鑰');
  const prompt = zh
    ? 'Read this Traditional Chinese sentence naturally in Taiwanese Mandarin: ' + text
    : slow
    ? 'Read this slowly and clearly for an English learner, keeping natural American English intonation: ' + text
    : 'Say this naturally, like a friendly native American English speaker in everyday conversation: ' + text;
  let code, data;
  for (let i = 0; i < TTS_MODELS.length; i++) {
    const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + TTS_MODELS[i] + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } }
        }
      }),
      muteHttpExceptions: true
    });
    code = r.getResponseCode();
    try { data = JSON.parse(r.getContentText()); } catch (e) { data = {}; }
    if (code === 200) break;
  }
  if (code !== 200) {
    if (code === 429) throw new Error('今天的語音額度用完了，先改用瀏覽器語音');
    throw new Error('語音產生失敗：' + ((data.error && data.error.message) || ('HTTP ' + code)));
  }
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const audio = parts.filter(p => p.inlineData)[0];
  if (!audio) throw new Error('語音產生失敗，請再試一次');
  const result = { mime: audio.inlineData.mimeType, data: audio.inlineData.data };
  folder.createFile(name, JSON.stringify(result), 'application/json');
  return result;
}

function ttsFolder_() {
  const p = props_();
  const id = p.getProperty('TTS_FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) {}
  }
  const f = DriveApp.createFolder(TTS_FOLDER_NAME);
  p.setProperty('TTS_FOLDER_ID', f.getId());
  return f;
}
