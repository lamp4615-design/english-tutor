// 讓網頁可以安裝到手機桌面。
// 網頁本身「先抓網路、抓不到才用存好的」：有更新時下次打開就是新版，沒網路時至少畫面打得開。
// 呼叫後端（script.google.com）和 POST 一律不經過這裡。
const CACHE = 'english-tutor-v4';
const SHELL = ['./', './index.html', './js/core.js', './js/stats.js', './js/audio.js', './js/practice.js', './js/modes.js', './js/progress.js', './js/chat.js', './js/car.js', './js/lessons.js', './js/settings.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    // 只清舊版的網頁快取，存好的語音（english-tutor-voices）要留著
    .then(keys => Promise.all(keys.filter(k => /^english-tutor-v\d+$/.test(k) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req)
    .then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })
    .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
});
