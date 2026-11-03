// 開車聽
// ---------- 開車聽 ----------
// 每句做成一個音檔：中文 → 停頓 → 英文 →（慢速英文）。整句一個檔，螢幕關掉時只要換下一個檔，不靠計時器
const CAR_RATE = 24000;
let car = null;   // { queue, i, playing, url, clips: Map(i → Promise<url|null>) }

function carOpts() {
  return { think: +$('#carThink').value, twice: $('#carTwice').value === '1', loop: $('#carLoop').value === '1' };
}
// Gemini 語音轉成 24kHz 的取樣值，方便接在一起
function voiceSamples(a) {
  const bytes = base64ToBytes(a.data);
  let rate = +((a.mime || '').match(/rate=(\d+)/) || [])[1] || 24000, start = 0;
  if (/wav/i.test(a.mime)) { rate = new DataView(bytes.buffer).getUint32(24, true); start = 44; }
  const v = new DataView(bytes.buffer, start), n = Math.floor((bytes.length - start) / 2), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(i * 2, true) / 0x8000;
  return resample(out, rate, CAR_RATE);
}
function joinSamples(parts) {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  parts.forEach(p => { out.set(p, o); o += p.length; });
  return out;
}
const silence = sec => new Float32Array(Math.round(sec * CAR_RATE));
async function carClip(it, o) {
  const [zh, en, slow] = await Promise.all([
    voiceData(it.zh, false, 'zh'), voiceData(it.en, false), o.twice ? voiceData(it.en, true) : null
  ]);
  const parts = [voiceSamples(zh), silence(o.think), voiceSamples(en)];
  if (slow) parts.push(silence(1.2), voiceSamples(slow));
  parts.push(silence(2));
  return URL.createObjectURL(new Blob([encodeWav(joinSamples(parts), CAR_RATE)], { type: 'audio/wav' }));
}
function carLoad(i) {
  if (!car.clips.has(i)) car.clips.set(i, carClip(car.queue[i], carOpts()).catch(e => { car.err = e.message; return null; }));
  return car.clips.get(i);
}
function carShow() {
  const it = car.queue[car.i], n = car.queue.length;
  $('#carProg').textContent = `第 ${car.i + 1} 句 / 共 ${n} 句`;
  $('#carBar').style.width = ((car.i + 1) / n * 100) + '%';
  $('#carZh').textContent = it.zh;
  $('#carEn').textContent = it.en;
  $('#carPlay').textContent = car.playing ? '⏸' : '▶';
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: it.zh, artist: it.en, album: '英文家教・開車聽' }); } catch (e) {}
    navigator.mediaSession.playbackState = car.playing ? 'playing' : 'paused';
  }
}
async function carPlay() {
  const c = car, i = c.i;
  c.playing = true;
  carShow();
  $('#carStatus').textContent = c.clips.has(i) ? '' : '準備語音中…';
  const url = await carLoad(i);
  if (car !== c || c.i !== i || !c.playing) return;
  $('#carStatus').textContent = '';
  // 先準備後面兩句，播完就能直接接上
  [1, 2].forEach(k => { const j = i + k; if (j < c.queue.length) carLoad(j); else if (carOpts().loop) carLoad(j % c.queue.length); });
  if (url) {
    c.url = url;
    voicePlayer.src = url;
    voicePlayer.play().catch(() => { c.playing = false; carShow(); toast('請按 ▶ 開始播放'); });
    return;
  }
  // Gemini 語音失敗（例如額度用完）：改用瀏覽器語音，螢幕要開著
  c.url = null;
  $('#carStatus').textContent = '⚠️ ' + (c.err || '語音產生失敗') + '，先用瀏覽器語音（螢幕請保持開著）';
  c.clips.delete(i);
  await carSpeak(car.queue[i], carOpts(), () => car === c && c.i === i && c.playing);
  if (car === c && c.i === i && c.playing) carStep(1);
}
async function carSpeak(it, o, alive) {
  if (!window.speechSynthesis) { await new Promise(r => setTimeout(r, 1500)); return; }
  const say = (text, lang, rate) => new Promise(r => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = rate; u.onend = u.onerror = r;
    speechSynthesis.speak(u);
  });
  const wait = sec => new Promise(r => setTimeout(r, sec * 1000));
  const steps = [() => say(it.zh, 'zh-TW', 1), () => wait(o.think), () => say(it.en, 'en-US', 0.9)];
  if (o.twice) steps.push(() => wait(1.2), () => say(it.en, 'en-US', 0.7));
  steps.push(() => wait(2));
  for (const s of steps) { if (!alive()) return; await s(); }
}
function carStep(d) {
  if (!car) return;
  let i = car.i + d;
  if (i >= car.queue.length) {
    if (!carOpts().loop) { car.i = car.queue.length - 1; carPause(); $('#carStatus').textContent = '播完了'; return; }
    i = 0;
  }
  car.i = Math.max(0, i);
  if (window.speechSynthesis) speechSynthesis.cancel();
  voicePlayer.pause();
  carPlay();
}
function carPause() {
  if (!car) return;
  car.playing = false;
  voicePlayer.pause();
  if (window.speechSynthesis) speechSynthesis.cancel();
  carShow();
}
function carResume() {
  if (!car || car.playing) return;
  unlockVoice();
  // 暫停在同一句的音檔中間：接著播；其他情況重播這一句
  if (car.url && voicePlayer.src === car.url && voicePlayer.currentTime > 0 && !voicePlayer.ended) {
    car.playing = true; carShow();
    voicePlayer.play().catch(() => { car.playing = false; carShow(); });
  } else carPlay();
}
voicePlayer.addEventListener('ended', () => {
  if (!(car && car.playing && car.url && voicePlayer.src === car.url)) return;
  // 開車聽也算練習：累計秒數，滿 10 分鐘當天就算有練
  const s = dayStat(dayKey(Date.now()), true), before = s.car;
  s.car += Math.round(voicePlayer.duration) || 0;
  if (before < CAR_ACTIVE_SEC && s.car >= CAR_ACTIVE_SEC && !s.n) toast('開車聽滿 10 分鐘，今天算有練 🔥');
  save();
  carStep(1);
});

$('#carBtn').onclick = () => {
  let q = pick($('#selMode').value, $('#selLesson').value);
  const n = +$('#selCount').value;
  if (n) q = q.slice(0, n);
  if (!q.length) { toast($('#selMode').value === 'wrong' ? '沒有錯題可以聽' : '目前沒有要複習的句子，可以改選「全部依序」'); return; }
  unlockVoice();
  const c = db.settings.car || {};
  if (c.think) $('#carThink').value = c.think;
  if (c.twice != null) $('#carTwice').value = c.twice ? '1' : '0';
  if (c.loop != null) $('#carLoop').value = c.loop ? '1' : '0';
  car = { queue: q, i: 0, playing: false, url: null, clips: new Map() };
  $('#home').classList.add('hidden');
  $('#summary').classList.add('hidden');
  $('#car').classList.remove('hidden');
  carPlay();
};
$('#carPlay').onclick = () => { if (car.playing) carPause(); else carResume(); };
$('#carPrev').onclick = () => { unlockVoice(); carStep(-1); };
$('#carNext').onclick = () => { unlockVoice(); carStep(1); };
['#carThink', '#carTwice', '#carLoop'].forEach(s => $(s).onchange = () => {
  const o = carOpts();
  db.settings.car = o; save();
  // 停頓、唸幾次改了，已經做好的音檔要重做（目前這句播完後生效）
  if (s !== '#carLoop' && car) { const cur = car.clips.get(car.i); car.clips = new Map(cur ? [[car.i, cur]] : []); }
});
$('#carQuit').onclick = e => {
  e.preventDefault();
  carPause();
  car.clips.forEach(p => p.then(u => { if (u) URL.revokeObjectURL(u); }));
  car = null;
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  $('#car').classList.add('hidden');
  $('#home').classList.remove('hidden');
  renderSetup();
};
if ('mediaSession' in navigator) {
  const h = { play: carResume, pause: carPause, nexttrack: () => carStep(1), previoustrack: () => carStep(-1) };
  Object.entries(h).forEach(([k, f]) => { try { navigator.mediaSession.setActionHandler(k, () => { if (car) f(); }); } catch (e) {} });
}
