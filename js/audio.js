// 錄音、音檔轉換、朗讀（Gemini 語音＋瀏覽器語音）
// ---------- 錄音 ----------
// 按一下開始錄，再按一下停止；停止後轉成 WAV 交給 Gemini 聽寫、批改、評發音
// 錄音鈕不只一個（練習、情境對話）：btn＝錄音鈕、lock＝錄音時要停用的元素、onBlob＝錄好後要做什麼
const PRACTICE_REC = { btn: '#micBtn', lock: ['#submitBtn', '#hintBtn', '#skipBtn', '#answer'], onBlob: b => gradeRecording(b) };
$('#micBtn').onclick = () => { if (rec) rec.recorder.stop(); else startRecording(PRACTICE_REC); };

async function startRecording(t = PRACTICE_REC) {
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast('這個瀏覽器不支援錄音，請改用打字'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { toast('沒有麥克風權限，請在瀏覽器網址列旁允許使用麥克風'); return; }
  const chunks = [], recorder = new MediaRecorder(stream), started = Date.now();
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    clearInterval(rec.timer);
    const cancelled = rec.cancelled;
    rec = null;
    setRecording(false, t);
    if (cancelled) return;
    if (Date.now() - started < 600) { toast('錄音太短，請按住說完整句再停止'); return; }
    t.onBlob(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
  };
  rec = { recorder, stream, cancelled: false, timer: setInterval(() => {
    const sec = Math.floor((Date.now() - started) / 1000);
    $(t.btn).textContent = `■ 停止 0:${String(sec).padStart(2, '0')}`;
    if (sec >= MAX_REC_SEC) recorder.stop();
  }, 250) };
  recorder.start();
  setRecording(true, t);
}
function cancelRecording() {
  if (!rec) return;
  rec.cancelled = true;
  rec.recorder.stop();
}
function setRecording(on, t = PRACTICE_REC) {
  t.lock.forEach(s => $(s).disabled = on);
  $(t.btn).classList.toggle('on', on);
  $(t.btn).textContent = on ? '■ 停止 0:00' : '🎤 錄音';
}

async function gradeRecording(blob) {
  if (!session || session.answered) return;
  const it = current();
  if (session.recUrl) URL.revokeObjectURL(session.recUrl);
  session.recUrl = URL.createObjectURL(blob);
  setBusy(true, db.settings.audioMode === 'fast' ? 'Gemini 聽你說…' : 'Gemini 仔細聽你說…');
  try {
    const data = await blobToWavBase64(blob);
    const shadow = session.mode === 'shadow';
    const r = shadow
      ? await gemini(SHADOW_PROMPT, `學生跟讀的英文：${it.en}\n學生的錄音如下。`, { mime: 'audio/wav', data }, audioModel())
      : await gemini(AUDIO_PROMPT, `中文：${it.zh}\n課文原句：${it.en}\n學生的錄音如下。`, { mime: 'audio/wav', data }, audioModel());
    const heard = String(r.heard || '').trim();
    if (!heard) { setBusy(false); toast('沒有聽到英文，請再錄一次'); return; }
    // 跟讀只看發音：4 分以上算對、3 分算部分對
    if (shadow) {
      const sc = clampScore(r.pronunciation && r.pronunciation.score);
      r.verdict = sc >= 4 ? 'correct' : sc === 3 ? 'partial' : 'wrong';
      r.errors = [];
    }
    if (!VERDICT[r.verdict]) r.verdict = 'partial';
    r.audio = true;
    $('#answer').value = heard;
    finish(heard, r);
  } catch (e) {
    setBusy(false);
    toast(e.message);
  }
}

// 手機錄出來的格式各家不同（webm、mp4），統一解碼後轉成 16kHz 單聲道 WAV
async function blobToWavBase64(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const ab = await blob.arrayBuffer();
  let buf;
  try {
    buf = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(ab, resolve, reject);
      if (p && p.catch) p.catch(reject);
    });
  } catch (e) {
    throw new Error('錄音解碼失敗，請再試一次');
  } finally {
    if (ctx.close) ctx.close();
  }
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels;
  }
  return bytesToBase64(encodeWav(resample(mono, buf.sampleRate, 16000), 16000));
}
function resample(data, from, to) {
  if (from === to) return data;
  const ratio = from / to, n = Math.floor(data.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.floor(i * ratio), e = Math.min(Math.floor((i + 1) * ratio), data.length);
    let sum = 0;
    for (let j = s; j < e; j++) sum += data[j];
    out[i] = e > s ? sum / (e - s) : data[s] || 0;
  }
  return out;
}
function encodeWav(samples, rate) {
  const v = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(v.buffer);
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
// 瀏覽器內建語音：Gemini 語音失敗時的備案
function speak(text, slow) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US'; u.rate = slow ? 0.7 : 0.9;
  speechSynthesis.speak(u);
}

// ---------- 真人語調語音（Gemini） ----------
// 同一個 <audio> 一直重用：iPhone 只允許「使用者點過的」播放器在等待網路後播放，第一次點擊時先用無聲音檔解鎖
const voicePlayer = new Audio();
const voiceCache = new Map();
let voiceUnlocked = false;
function unlockVoice() {
  if (voiceUnlocked) return;
  voiceUnlocked = true;
  voicePlayer.src = 'data:audio/wav;base64,' + bytesToBase64(encodeWav(new Float32Array(160), 16000));
  voicePlayer.play().catch(() => {});
}
async function playVoice(btn, text, slow) {
  unlockVoice();
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (btn) {
    if (btn.classList.contains('loading')) return;
    btn.classList.add('loading');
  }
  let url;
  try {
    url = await loadVoice(text, slow);
  } catch (e) {
    toast(e.message + '（先用瀏覽器語音）');
    speak(text, slow);
    return;
  } finally {
    if (btn) btn.classList.remove('loading');
  }
  voicePlayer.pause();
  voicePlayer.src = url;
  voicePlayer.play().catch(() => toast('語音準備好了，請再按一次'));
}
// 先把語音準備好（例如下一題要聽的句子），按下去就能馬上播；失敗的不留在快取裡，下次再試
function loadVoice(text, slow) {
  const k = (slow ? 'slow|' : 'normal|') + text;
  if (!voiceCache.has(k)) {
    voiceCache.set(k, voiceData(text, slow).then(a => URL.createObjectURL(voiceBlob(a)))
      .catch(e => { voiceCache.delete(k); throw e; }));
  }
  return voiceCache.get(k);
}
// 語音也存在這台裝置（瀏覽器的 Cache Storage）：同一句第二次起直接播，不用再經過 Apps Script
const VOICE_STORE = 'english-tutor-voices';
async function voiceData(text, slow, lang) {
  const key = location.origin + '/__voice/' + encodeURIComponent([lang || 'en', slow ? 'slow' : 'normal', text].join('|'));
  let store = null;
  try {
    store = await caches.open(VOICE_STORE);
    const hit = await store.match(key);
    if (hit) { logPerf('tts（這台裝置）', 0); return await hit.json(); }
  } catch (e) {}
  const a = await run('tts', text, !!slow, ...(lang ? [lang] : []));
  if (store) store.put(key, new Response(JSON.stringify(a), { headers: { 'Content-Type': 'application/json' } })).catch(() => {});
  return a;
}
// Gemini 回傳 WAV 或原始 PCM（audio/L16;rate=24000），PCM 要自己加上 WAV 檔頭
function voiceBlob(a) {
  const bytes = base64ToBytes(a.data);
  if (/wav/i.test(a.mime)) return new Blob([bytes], { type: 'audio/wav' });
  const rate = +((a.mime || '').match(/rate=(\d+)/) || [])[1] || 24000;
  return new Blob([pcmWavHeader(bytes.length, rate), bytes], { type: 'audio/wav' });
}
function pcmWavHeader(len, rate) {
  const v = new DataView(new ArrayBuffer(44));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + len, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, len, true);
  return new Uint8Array(v.buffer);
}
function base64ToBytes(b64) {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
