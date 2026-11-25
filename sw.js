const CACHE = 'blessed-shell-v1';
const ASSETS = [
  './', './index.html', './manifest.json', './blessed.css',
  './blessed.mjs', './blessed-model.mjs',
  './blessed-icon.png', './blessed-icon-large.png', './sample.mp3',
];
const sampleURL = new URL('./sample.mp3', self.location.href).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('blessed-shell-') && key !== CACHE)
      .map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function serve(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request.url);
  if (!cached) {
    return request.mode === 'navigate'
      ? fetch(request).catch(() => cache.match('./index.html'))
      : fetch(request);
  }

  const range = request.headers.get('range');
  if (request.url !== sampleURL || !range) return cached;
  const bytes = await cached.arrayBuffer();
  const [, left, right] = /^bytes=(\d*)-(\d*)$/.exec(range) || [];
  const start = left ? Number(left) : Math.max(0, bytes.byteLength - Number(right));
  const end = !left || !right ? bytes.byteLength - 1 : Math.min(Number(right), bytes.byteLength - 1);
  if ((!left && !right) || !Number.isFinite(start) || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + bytes.byteLength } });
  }
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
    },
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(serve(request));
});
