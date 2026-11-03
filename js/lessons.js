// 課文：手動貼上、雲端硬碟匯入、編輯
// ---------- 課文 ----------
$('#addBtn').onclick = async () => {
  const text = $('#newText').value.trim();
  if (!text) { toast('請先貼上課文內容'); return; }
  const btn = $('#addBtn');
  btn.disabled = true; btn.textContent = 'Gemini 整理中…';
  try {
    const items = await extractItems(text);
    const title = $('#newTitle').value.trim() || '課文 ' + (db.lessons.length + 1);
    db.lessons.push({ id: uid(), title, created: Date.now(), items });
    save();
    $('#newTitle').value = ''; $('#newText').value = '';
    toast(`已整理出 ${items.length} 句，可以開始練習了`);
    renderLessons();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false; btn.textContent = '用 Gemini 整理成練習句';
  }
};
async function extractItems(text) {
  const arr = await gemini(EXTRACT_PROMPT, text);
  const items = (Array.isArray(arr) ? arr : arr.items || [])
    .filter(x => x && x.en && x.zh)
    .map(x => newItem(String(x.en).trim(), String(x.zh).trim()));
  if (!items.length) throw new Error('沒有找到英文句子，請確認內容');
  return items;
}
function newItem(en, zh) {
  return { id: uid(), en, zh, box: 0, due: 0, attempts: 0, correct: 0, last: null, lastAnswer: '', lastAt: 0 };
}

// ---------- 雲端硬碟匯入 ----------
function folderList() {
  return $('#folderUrls').value.split('\n').map(s => s.trim()).filter(Boolean);
}
$('#listBtn').onclick = loadFolders;
async function loadFolders() {
  const urls = folderList();
  if (!urls.length) { toast('請先貼上資料夾網址'); return; }
  if (JSON.stringify(db.settings.folders) !== JSON.stringify(urls)) { db.settings.folders = urls; save(); }
  const btn = $('#listBtn');
  btn.disabled = true; btn.textContent = '讀取中…';
  $('#driveList').innerHTML = '<p class="muted">讀取雲端硬碟中…</p>';
  driveGroups = await Promise.all(urls.map(u => run('listDriveFiles', u).catch(e => ({ folderName: u, files: [], error: e.message }))));
  btn.disabled = false; btn.textContent = '重新讀取資料夾';
  renderDrive();
}
function renderDrive() {
  if (!driveGroups) return;
  $('#driveList').innerHTML = driveGroups.map(g => {
    const head = `<p style="margin:14px 0 4px"><b>📁 ${esc(g.folderName)}</b> <span class="muted">${g.error ? '' : g.files.length + ' 個檔案'}</span></p>`;
    if (g.error) return head + `<p class="muted">⚠️ ${esc(g.error)}</p>`;
    if (!g.files.length) return head + '<p class="muted">這個資料夾裡沒有 Google 文件或 Word 檔。</p>';
    return head + g.files.map(f => {
      const l = db.lessons.find(x => x.sourceId === f.id);
      const status = !l ? '' : f.modified > (l.sourceModified || 0)
        ? '<span class="badge new">檔案有更新</span>' : '<span class="badge">已匯入</span>';
      return `<div class="file" data-file="${f.id}">
        <span class="n">${f.type === 'doc' ? '📄' : '📘'} ${esc(f.name)}</span>${status}
        <button class="btn small" data-import>${l ? '重新匯入' : '匯入'}</button></div>`;
    }).join('');
  }).join('');
}
$('#driveList').addEventListener('click', async e => {
  const b = e.target.closest('[data-import]'); if (!b) return;
  const id = b.closest('[data-file]').dataset.file;
  const old = db.lessons.find(x => x.sourceId === id);
  if (old && !confirm(`重新匯入「${old.title}」？\n句子會依檔案內容更新，相同英文句子的練習紀錄會保留。`)) return;
  document.querySelectorAll('[data-import]').forEach(x => x.disabled = true);
  b.textContent = '讀取檔案…';
  try {
    const f = await run('getDriveText', id);
    if (!f.text.trim()) throw new Error('這個檔案是空的');
    b.textContent = 'Gemini 整理中…';
    const items = await extractItems(f.text);
    if (old) {
      // 英文一樣的句子沿用舊的練習紀錄
      const prev = new Map(old.items.map(it => [it.en.toLowerCase(), it]));
      old.items = items.map(it => {
        const p = prev.get(it.en.toLowerCase());
        return p ? { ...p, zh: it.zh } : it;
      });
      old.sourceModified = f.modified;
      toast(`已更新「${old.title}」，共 ${items.length} 句`);
    } else {
      db.lessons.push({ id: uid(), title: f.title, created: Date.now(), items, sourceId: id, sourceModified: f.modified });
      toast(`已匯入「${f.title}」，共 ${items.length} 句`);
    }
    save();
    renderLessons();
  } catch (err) {
    toast(err.message);
  } finally {
    renderDrive();
  }
});
function renderLessons() {
  const list = $('#lessonList');
  if (!db.lessons.length) { list.innerHTML = ''; return; }
  list.innerHTML = db.lessons.slice().reverse().map(l => {
    const done = l.items.filter(it => it.attempts > 0).length;
    const wrong = l.items.filter(it => it.attempts > 0 && it.last !== 'correct').length;
    return `<details class="card" data-lesson="${l.id}">
      <summary class="lesson-head"><span class="t">${esc(l.title)}</span>
        <span class="muted">⭐ ${levelCounts(l.items)[3]}／${l.items.length} 句・練過 ${done}・錯題 ${wrong}</span>${levelBar(l.items)}</summary>
      <div class="overflow" style="margin-top:12px"><table>
        <tr><th>中文</th><th>英文</th><th style="width:70px">紀錄</th><th style="width:40px"></th></tr>
        ${l.items.map(it => `<tr data-item="${it.id}">
          <td><input type="text" data-f="zh" value="${esc(it.zh)}"></td>
          <td><input type="text" data-f="en" value="${esc(it.en)}"></td>
          <td class="muted">${it.attempts ? `${it.correct}/${it.attempts}` : '—'}</td>
          <td><button class="btn small" data-del-item title="刪除">✕</button></td></tr>`).join('')}
      </table></div>
      <div class="actions">
        <button class="btn small" data-add-item>＋ 新增句子</button>
        <button class="btn small" data-rename>改標題</button>
        <button class="btn small" data-reset>清除練習紀錄</button>
        <span class="grow"></span>
        <button class="btn small" data-del-lesson>刪除這篇</button>
      </div></details>`;
  }).join('');
}
function findLesson(el) { return db.lessons.find(l => l.id === el.closest('[data-lesson]').dataset.lesson); }
$('#lessonList').addEventListener('change', e => {
  const f = e.target.dataset.f; if (!f) return;
  const l = findLesson(e.target), it = l.items.find(x => x.id === e.target.closest('[data-item]').dataset.item);
  it[f] = e.target.value.trim(); save(); toast('已更新');
});
$('#lessonList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const l = findLesson(b);
  if (b.hasAttribute('data-del-item')) {
    l.items = l.items.filter(x => x.id !== b.closest('[data-item]').dataset.item);
  } else if (b.hasAttribute('data-add-item')) {
    l.items.push(newItem('', ''));
  } else if (b.hasAttribute('data-rename')) {
    const t = prompt('新標題', l.title); if (!t) return; l.title = t.trim();
  } else if (b.hasAttribute('data-reset')) {
    if (!confirm('清除「' + l.title + '」的練習紀錄？句子會保留。')) return;
    l.items = l.items.map(it => newItem(it.en, it.zh));
  } else if (b.hasAttribute('data-del-lesson')) {
    if (!confirm('刪除「' + l.title + '」和它的練習紀錄？')) return;
    db.lessons = db.lessons.filter(x => x !== l);
  } else return;
  db.lessons.forEach(x => x.items = x.items.filter(it => it.en || it.zh || b.hasAttribute('data-add-item')));
  save();
  const open = l.id;
  renderLessons();
  const d = document.querySelector(`[data-lesson="${open}"]`); if (d) d.open = true;
});
