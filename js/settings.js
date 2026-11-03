// 設定、備份、安裝到桌面、啟動（要最後載入）
// ---------- 設定與備份 ----------
function renderSettings() {
  const c = getConn();
  $('#apiUrl').value = c.url || '';
  $('#apiToken').value = c.token || '';
  $('#apiKey').value = '';
  $('#apiKey').placeholder = hasKey ? '已設定（要更換才需要重新輸入）' : '尚未設定';
  $('#model').value = db.settings.model || DEFAULT_MODEL;
  $('#audioMode').value = AUDIO_MODELS[db.settings.audioMode] ? db.settings.audioMode : 'detail';
  $('#goal').value = String(goal());
  renderPerf();
}
const PERF_NAMES = { loadData: '讀取雲端資料（背景）', saveData: '存到雲端（背景，不用等）', tts: '語音（第一次，經過雲端）', 'tts:zh': '中文語音（開車聽）',
  'tts（這台裝置）': '語音（已存在這台裝置）', listDriveFiles: '讀取雲端硬碟資料夾', getDriveText: '讀取課文檔案', setApiKey: '儲存金鑰' };
function perfName(k) {
  if (!k.startsWith('gemini:')) return PERF_NAMES[k] || k;
  const m = k.slice(7);
  return m === AUDIO_MODELS.detail ? `Gemini 錄音分析（${m}）` : `Gemini 批改、出題、對話（${m}）`;
}
function renderPerf() {
  const rows = Object.entries(perf).filter(([, a]) => a.length);
  $('#perfList').innerHTML = rows.length
    ? `<table><tr><th>步驟</th><th>次數</th><th>平均</th><th>最久</th></tr>${rows.map(([k, a]) =>
      `<tr><td>${esc(perfName(k))}</td><td>${a.length}</td><td>${(a.reduce((x, y) => x + y, 0) / a.length / 1000).toFixed(1)} 秒</td><td>${(Math.max(...a) / 1000).toFixed(1)} 秒</td></tr>`).join('')}</table>`
    : '<p class="muted">還沒有紀錄，練習幾題後再回來看。</p>';
}
$('#goal').onchange = () => { db.stats.goal = +$('#goal').value; save(); toast('每日目標已更新'); };
async function saveSettings() {
  const key = $('#apiKey').value.trim();
  if (key) { hasKey = await run('setApiKey', key); $('#apiKey').value = ''; }
  db.settings.model = $('#model').value.trim() || DEFAULT_MODEL;
  db.settings.audioMode = $('#audioMode').value;
  save();
  renderSettings();
}
$('#saveSettings').onclick = async () => {
  try { await saveSettings(); toast('已儲存'); } catch (e) { toast(e.message); }
};
$('#testBtn').onclick = async () => {
  const btn = $('#testBtn'); btn.disabled = true; btn.textContent = '測試中…';
  try {
    await saveSettings();
    await gemini('只輸出 JSON。', '回傳 {"ok":true}');
    toast('連線成功！可以開始使用了');
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.textContent = '測試連線'; }
};
$('#exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' }));
  a.download = '英文家教備份-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click(); URL.revokeObjectURL(a.href);
};
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.lessons)) throw new Error('檔案格式不對');
    if (!confirm(`匯入 ${d.lessons.length} 篇課文，會取代目前的課文與紀錄。確定？`)) return;
    db.lessons = d.lessons;
    if (d.stats && d.stats.days) db.stats = d.stats;
    save(); toast('匯入完成');
  } catch (err) { toast('匯入失敗：' + err.message); }
};

$('#connectBtn').onclick = async () => {
  const url = $('#apiUrl').value.trim(), token = $('#apiToken').value.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(url)) { toast('後端網址要是 https://script.google.com/macros/s/.../exec'); return; }
  if (!token) { toast('請輸入通行碼'); return; }
  setConn({ url, token });
  const btn = $('#connectBtn'); btn.disabled = true; btn.textContent = '連線中…';
  if (await connect()) toast('連線成功');
  btn.disabled = false; btn.textContent = '連線';
};

// 讀取雲端資料；還沒讀到之前不存檔，避免空資料蓋掉雲端
// 打開 App：這台裝置有上次的資料就先顯示，馬上能用；雲端的資料在背景讀，有更新再換上
async function connect() {
  const cached = readCache();
  if (cached) { applyData(cached); startUI(); }
  else $('#loading').classList.remove('hidden');
  return syncFromServer(!!cached);
}
function startUI() {
  $('#loading').classList.add('hidden');
  $('#folderUrls').value = (db.settings.folders || []).join('\n');
  driveGroups = null;
  showTab(hasKey ? 'practice' : 'settings');
}
async function syncFromServer(quick) {
  let d;
  try {
    d = await run('loadData');
  } catch (e) {
    $('#loading').classList.add('hidden');
    if (quick) {
      toast('暫時連不到雲端，先用這台裝置上次的資料，稍後會自動同步');
      setTimeout(() => syncFromServer(true), 15000);
      return true;
    }
    showTab('settings');
    toast(e.message);
    return false;
  }
  if (!quick || d.rev !== rev) {
    // 雲端比這台裝置新（別的裝置練過）：以雲端為準
    if (quick && dirty) toast('其他裝置有更新，已換成最新的資料');
    dirty = false;
    applyData(d);
    if (!quick) startUI();
    else if (!session && !car && !chat) showTab((document.querySelector('nav button.on') || {}).dataset.tab || 'practice');
  } else hasKey = d.hasKey;
  loaded = true;
  cacheData();
  if (dirty) save();
  else if (!session) renderToday();   // 讀到雲端後才能寫教練信
  return true;
}

// ---------- 安裝到手機桌面 ----------
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null;
function renderInstall() {
  $('#installCard').classList.toggle('hidden', standalone());
  $('#installActions').classList.toggle('hidden', !installPrompt);
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('#installHow').textContent = installPrompt ? '按下面的「安裝」，桌面就會出現英文家教的圖示。'
    : ios ? '用 Safari 打開這個網頁，按下方的「分享」按鈕（方框加向上箭頭），往下找「加入主畫面」，再按「加入」。'
    : '打開瀏覽器右上角的選單（⋮），選「安裝應用程式」或「加到主畫面」。';
}
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; renderInstall(); });
addEventListener('appinstalled', () => { installPrompt = null; renderInstall(); toast('已安裝，之後可以從桌面圖示打開'); });
$('#installBtn').onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  renderInstall();
};
renderInstall();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

if (getConn().token) connect();
else { $('#loading').classList.add('hidden'); showTab('settings'); }
