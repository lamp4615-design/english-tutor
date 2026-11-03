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
async function connect() {
  $('#loading').classList.remove('hidden');
  try {
    applyData(await run('loadData'));
    loaded = true;
  } catch (e) {
    $('#loading').classList.add('hidden');
    showTab('settings');
    toast(e.message);
    return false;
  }
  $('#loading').classList.add('hidden');
  $('#folderUrls').value = (db.settings.folders || []).join('\n');
  driveGroups = null;
  showTab(hasKey ? 'practice' : 'settings');
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
