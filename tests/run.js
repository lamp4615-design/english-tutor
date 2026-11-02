// 離線測試：用假的 Google 服務載入 Code.gs，檢查後端邏輯
// 執行：node tests/run.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) pass++; else { fail++; console.log('✗ ' + name); }
}
function throws(fn, re, name) {
  try { fn(); ok(false, name + '（應該要丟錯誤）'); }
  catch (e) { ok(re.test(e.message), name + '：' + e.message); }
}

const MIME_DOC = 'application/vnd.google-apps.document';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function makeEnv() {
  const props = {};
  const files = {};
  const folders = {};
  const fetches = [];
  let fetchQueue = [];
  let nextId = 1;
  const sleeps = [];

  function fileObj(id) {
    const f = files[id];
    return {
      getId: () => id,
      getName: () => f.name,
      getMimeType: () => f.mime,
      getLastUpdated: () => new Date(f.modified),
      isTrashed: () => !!f.trashed,
      setTrashed: v => { f.trashed = v; },
      setContent: s => { f.content = s; },
      getBlob: () => ({ getDataAsString: () => f.content })
    };
  }
  const env = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; }
    }) },
    DriveApp: {
      getFileById: id => { if (!files[id]) throw new Error('no file'); return fileObj(id); },
      createFile: (name, content, mime) => {
        const id = 'f' + nextId++;
        files[id] = { name, content, mime, modified: Date.now() };
        return fileObj(id);
      },
      getFolderById: id => {
        const fo = folders[id];
        if (!fo) throw new Error('no folder');
        let i = 0;
        return {
          getId: () => id,
          getName: () => fo.name,
          getFiles: () => ({ hasNext: () => i < fo.files.length, next: () => fileObj(fo.files[i++]) })
        };
      }
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp: { getOAuthToken: () => 'TOKEN' },
    Utilities: { sleep: ms => sleeps.push(ms), getUuid: () => require('crypto').randomUUID() },
    UrlFetchApp: {
      fetch: (url, opt) => {
        fetches.push({ url, opt: opt || {} });
        const r = fetchQueue.shift();
        if (!r) throw new Error('unexpected fetch ' + url);
        const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
        return { getResponseCode: () => r.code, getContentText: () => body };
      }
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ text: s, setMimeType(m) { this.mime = m; return this; } })
    },
    console: { log() {} }
  };
  env.require = require;
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(root, 'Code.gs'), 'utf8'), env);
  return { env, props, files, folders, fetches, sleeps, queue: rs => { fetchQueue = rs; } };
}

function geminiReply(obj) {
  return { code: 200, body: { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: JSON.stringify(obj) }] } }] } };
}

// ---------- API 與通行碼 ----------
{
  const t = makeEnv();
  const call = body => JSON.parse(t.env.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  ok(/運作中/.test(t.env.doGet().text), 'doGet 只回狀態文字，不提供網頁');
  ok(/setupToken/.test(call({ token: 'x', fn: 'loadData' }).error), '還沒設定通行碼時提示執行 setupToken');

  const token = t.env.setupToken();
  ok(/^[0-9a-f]{16}$/.test(token) || token.length === 16, '產生 16 碼通行碼');
  ok(t.props.APP_TOKEN === token, '通行碼存在 Script Properties');

  const bad = call({ token: 'wrong', fn: 'loadData' });
  ok(!bad.ok && /通行碼不正確/.test(bad.error), '通行碼錯誤時拒絕');
  ok(!call({ fn: 'loadData' }).ok, '沒帶通行碼時拒絕');

  const good = call({ token, fn: 'loadData', args: [] });
  ok(good.ok && good.result.rev === 0, '通行碼正確時可以呼叫');
  const saved = call({ token, fn: 'saveData', args: ['{"lessons":[]}', 0] });
  ok(saved.ok && saved.result.ok, '可以帶參數呼叫');

  ['setupToken', 'dataFile_', 'props_', 'doPost', 'constructor', 'toString', '__proto__'].forEach(fn => {
    const r = call({ token, fn });
    ok(!r.ok && /沒有這個功能/.test(r.error), '不能呼叫清單外的函式：' + fn);
  });
  ok(!JSON.parse(t.env.doPost({ postData: { contents: '{壞' } }).text).ok, '壞掉的請求回錯誤而不是當掉');
  ok(!JSON.parse(t.env.doPost({}).text).ok, '沒有內容的請求回錯誤');
  t.queue([{ code: 200, body: 'x' }]);
  const r = t.env.doPost({ postData: { contents: JSON.stringify({ token, fn: 'getDriveText', args: ['nope'] }) } });
  ok(r.mime === 'json', '回應是 JSON 格式');
}

// ---------- 練習資料 ----------
{
  const t = makeEnv();
  const d = t.env.loadData();
  ok(d.rev === 0 && JSON.parse(d.json).lessons.length === 0, '第一次載入會建立空資料檔');
  ok(d.hasKey === false, '沒設金鑰時 hasKey 為 false');
  const id = t.props.DATA_FILE_ID;
  ok(t.files[id].name === '英文家教資料.json', '資料檔名稱正確');

  const r1 = t.env.saveData('{"lessons":[{"id":"a"}]}', 0);
  ok(r1.ok && r1.rev === 1, '版本相符時可以存檔');
  ok(JSON.parse(t.env.loadData().json).lessons[0].id === 'a', '存檔後讀得回來');

  const r2 = t.env.saveData('{"lessons":[]}', 0);
  ok(!r2.ok && r2.rev === 1, '版本過舊時拒絕覆蓋（其他裝置剛存過）');
  ok(JSON.parse(t.env.loadData().json).lessons.length === 1, '被拒絕時資料沒有被蓋掉');

  throws(() => t.env.saveData('{壞掉', 1), /JSON|Unexpected|Expected/, '壞掉的 JSON 不會被存進去');

  t.files[id].trashed = true;
  t.env.loadData();
  ok(t.props.DATA_FILE_ID !== id, '資料檔被丟進垃圾桶時會重建');

  ok(t.env.setApiKey('  KEY123 ') === true && t.props.GEMINI_API_KEY === 'KEY123', '設定金鑰會去掉空白');
  ok(t.env.loadData().hasKey === true, '設好金鑰後 hasKey 為 true');
  ok(t.env.setApiKey('') === false && !('GEMINI_API_KEY' in t.props), '空字串會清除金鑰');
}

// ---------- 雲端硬碟 ----------
{
  const t = makeEnv();
  t.files.d1 = { name: 'Unit 2', mime: MIME_DOC, modified: 2000 };
  t.files.d2 = { name: 'Unit 1.docx', mime: MIME_DOCX, modified: 3000 };
  t.files.p1 = { name: '講義.pdf', mime: 'application/pdf', modified: 1 };
  t.folders.FOLDER1 = { name: '英文課', files: ['d1', 'd2', 'p1'] };

  ok(t.env.folderId_('https://drive.google.com/drive/folders/FOLDER1?usp=sharing') === 'FOLDER1', '從資料夾網址取出 ID');
  ok(t.env.folderId_('https://drive.google.com/drive/u/0/folders/FOLDER1') === 'FOLDER1', '有 /u/0/ 的網址也可以');
  ok(t.env.folderId_('https://drive.google.com/open?id=FOLDER1') === 'FOLDER1', 'open?id= 的網址也可以');
  ok(t.env.folderId_(' FOLDER1 ') === 'FOLDER1', '直接貼 ID 也可以');

  const list = t.env.listDriveFiles('https://drive.google.com/drive/folders/FOLDER1');
  ok(list.folderName === '英文課', '回傳資料夾名稱');
  ok(list.files.length === 2, '只列出 Google 文件和 Word 檔（PDF 略過）');
  ok(list.files[0].name === 'Unit 1.docx' && list.files[0].type === 'docx' && list.files[1].type === 'doc', '依檔名排序並標示類型');
  throws(() => t.env.listDriveFiles('NOPE'), /找不到這個資料夾/, '找不到資料夾時給中文訊息');

  // Google 文件：直接匯出文字
  t.queue([{ code: 200, body: 'Hello. 你好。' }]);
  const g = t.env.getDriveText('d1');
  ok(g.text === 'Hello. 你好。' && g.title === 'Unit 2' && g.modified === 2000, 'Google 文件讀出文字');
  ok(/files\/d1\/export\?mimeType=text\/plain/.test(t.fetches[0].url), 'Google 文件走匯出網址');
  ok(t.fetches[0].opt.headers.Authorization === 'Bearer TOKEN', '帶上授權');

  // Word 檔：先轉成 Google 文件、匯出、再把暫存檔丟垃圾桶
  t.fetches.length = 0;
  t.files.tmp9 = { name: '（暫存）Unit 1.docx', mime: MIME_DOC, modified: 0 };
  t.queue([{ code: 200, body: { id: 'tmp9' } }, { code: 200, body: 'I am fine.' }]);
  const w = t.env.getDriveText('d2');
  ok(w.text === 'I am fine.' && w.title === 'Unit 1', 'Word 檔讀出文字，標題去掉 .docx');
  ok(/files\/d2\/copy/.test(t.fetches[0].url) && JSON.parse(t.fetches[0].opt.payload).mimeType === MIME_DOC, 'Word 檔先轉成 Google 文件');
  ok(/files\/tmp9\/export/.test(t.fetches[1].url), '匯出的是轉好的暫存檔');
  ok(t.files.tmp9.trashed === true, '暫存檔用完丟進垃圾桶');

  // 匯出失敗時，暫存檔也要清掉
  t.files.tmp10 = { name: 'x', mime: MIME_DOC, modified: 0 };
  t.queue([{ code: 200, body: { id: 'tmp10' } }, { code: 500, body: 'boom' }]);
  throws(() => t.env.getDriveText('d2'), /讀取檔案失敗/, '匯出失敗給中文訊息');
  ok(t.files.tmp10.trashed === true, '匯出失敗時暫存檔仍會丟掉');

  t.queue([{ code: 403, body: 'denied' }]);
  throws(() => t.env.getDriveText('d2'), /Word 檔轉換失敗/, '轉換失敗給中文訊息');
  throws(() => t.env.getDriveText('p1'), /只支援/, 'PDF 不支援');
}

// ---------- Gemini ----------
{
  const t = makeEnv();
  throws(() => t.env.gemini('s', 'u', 'm'), /請先到「設定」/, '沒有金鑰時提示去設定');
  t.env.setApiKey('KEY');

  t.queue([geminiReply({ verdict: 'correct' })]);
  const r = t.env.gemini('系統', '使用者', 'gemini-3.5-flash');
  ok(r.verdict === 'correct', '解析 JSON 回應並略過思考內容');
  const f = t.fetches[0];
  ok(/models\/gemini-3\.5-flash:generateContent/.test(f.url), '用指定的模型');
  ok(f.opt.headers['x-goog-api-key'] === 'KEY', '金鑰放在標頭，不在網址');
  ok(!/KEY/.test(f.url), '網址裡沒有金鑰');
  const body = JSON.parse(f.opt.payload);
  ok(body.systemInstruction.parts[0].text === '系統' && body.contents[0].parts[0].text === '使用者', '送出系統指示與題目');
  ok(body.generationConfig.responseMimeType === 'application/json', '要求 JSON 格式');

  ok(body.contents[0].parts.length === 1, '沒有錄音時只送文字');

  t.fetches.length = 0;
  t.queue([geminiReply({ a: 1 })]);
  t.env.gemini('s', 'u', '');
  ok(/models\/gemini-3\.5-flash:/.test(t.fetches[0].url), '沒指定模型時用預設');

  t.fetches.length = 0;
  t.queue([geminiReply({ heard: 'hi' })]);
  t.env.gemini('s', 'u', 'm', { mime: 'audio/wav', data: 'QUJD' });
  const ap = JSON.parse(t.fetches[0].opt.payload).contents[0].parts;
  ok(ap.length === 2 && ap[1].inlineData.mimeType === 'audio/wav' && ap[1].inlineData.data === 'QUJD', '有錄音時一起送給 Gemini');

  // 503：重試兩次後改用備用模型
  t.fetches.length = 0; t.sleeps.length = 0;
  t.queue([{ code: 503, body: {} }, { code: 503, body: {} }, geminiReply({ ok: true })]);
  ok(t.env.gemini('s', 'u', 'gemini-3.5-flash').ok === true, '忙線時自動重試成功');
  ok(t.fetches.length === 3 && /gemini-flash-lite-latest/.test(t.fetches[2].url), '最後一次改用備用模型');
  ok(t.sleeps.length === 2, '重試前會等一下');

  t.queue([{ code: 503, body: {} }, { code: 503, body: {} }, { code: 503, body: {} }]);
  throws(() => t.env.gemini('s', 'u', 'm'), /忙線/, '一直忙線時給中文訊息');
  t.queue([{ code: 429, body: { error: { message: 'quota' } } }]);
  throws(() => t.env.gemini('s', 'u', 'm'), /超過免費額度/, '429 給額度訊息');
  t.queue([{ code: 404, body: { error: { message: 'no model' } } }]);
  throws(() => t.env.gemini('s', 'u', 'm'), /模型名稱有問題/, '404 給模型訊息');
  t.queue([{ code: 200, body: { candidates: [{ content: { parts: [] } }] } }]);
  throws(() => t.env.gemini('s', 'u', 'm'), /沒有回應內容/, '空回應給中文訊息');
  t.queue([{ code: 200, body: { candidates: [{ content: { parts: [{ text: '```json\n[1,2]\n```' }] } }] } }]);
  ok(JSON.stringify(t.env.gemini('s', 'u', 'm')) === '[1,2]', '包在 ``` 裡的 JSON 也能解析');
}

// ---------- 網頁 ----------
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  try { new vm.Script(js); ok(true); } catch (e) { ok(false, 'index.html 的程式語法錯誤：' + e.message); }
  ok(!/google\.script\.run/.test(js), '網頁不再用 google.script.run');
  ok(!/generativelanguage/.test(js), '網頁不直接連 Gemini（金鑰留在後端）');
  ok(!/drive\.google\.com\/drive\/folders\/[\w-]{10,}/.test(html), '網頁裡沒有寫死雲端硬碟資料夾（會公開在 GitHub）');
  ok(!/AQ\.|AIza/.test(html.replace('placeholder="AIza...', '')), '網頁裡沒有金鑰');
  const ids = [...js.matchAll(/\$\('#([\w-]+)'\)/g)].map(m => m[1]);
  const missing = [...new Set(ids)].filter(id => !html.includes(`id="${id}"`));
  ok(!missing.length, '網頁用到的元素都存在：' + missing.join(', '));
  const calls = [...js.matchAll(/run\('(\w+)'/g)].map(m => m[1]);
  const t = makeEnv();
  const api = vm.runInContext('API', t.env);
  const notDefined = [...new Set(calls)].filter(fn => typeof api[fn] !== 'function');
  ok(calls.length && !notDefined.length, '網頁呼叫的後端函式都在 API 清單裡：' + notDefined.join(', '));

  // 錄音轉 WAV：把網頁裡的函式拿出來單獨測
  const fnSrc = name => js.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}`))[0];
  const w = {};
  vm.createContext(w);
  vm.runInContext([fnSrc('resample'), fnSrc('encodeWav'), fnSrc('bytesToBase64')].join('\n') +
    '\nthis.resample = resample; this.encodeWav = encodeWav; this.bytesToBase64 = bytesToBase64; this.btoa = s => Buffer.from(s, "binary").toString("base64");', Object.assign(w, { Buffer }));
  const r48 = w.resample(new Float32Array(48000).fill(0.5), 48000, 16000);
  ok(r48.length === 16000 && Math.abs(r48[100] - 0.5) < 1e-6, '48kHz 轉 16kHz 長度和數值正確');
  const r44 = w.resample(new Float32Array(44100), 44100, 16000);
  ok(r44.length === 16000, '44.1kHz 轉 16kHz 長度正確');
  const same = new Float32Array(10);
  ok(w.resample(same, 16000, 16000) === same, '相同取樣率不轉換');
  const wav = Buffer.from(w.encodeWav(new Float32Array([0, 1, -1, 2]), 16000));
  ok(wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE' && wav.toString('ascii', 36, 40) === 'data', 'WAV 檔頭正確');
  ok(wav.readUInt32LE(24) === 16000 && wav.readUInt16LE(22) === 1 && wav.readUInt16LE(34) === 16, '16kHz 單聲道 16 位元');
  ok(wav.readUInt32LE(40) === 8 && wav.length === 52, '資料長度正確');
  ok(wav.readInt16LE(46) === 32767 && wav.readInt16LE(48) === -32768 && wav.readInt16LE(50) === 32767, '音量超出範圍會被截斷');
  const big = new Uint8Array(100000).map((_, i) => i % 256);
  ok(w.bytesToBase64(big) === Buffer.from(big).toString('base64'), '大檔案轉 base64 正確');
}

console.log(`\n通過 ${pass}／失敗 ${fail}`);
process.exit(fail ? 1 : 0);
