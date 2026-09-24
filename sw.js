// Service worker: guarda os arquivos do app para abrir sem internet.
// Estratégia "rede primeiro": com internet, sempre pega a versão nova (e atualiza a cópia);
// sem internet ou com rede muito lenta, usa a cópia guardada.
// Os dados da família não passam por aqui (ficam no localStorage e no Google Drive).
const CACHE = 'bolsa-cheia-v1';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'store.js',
  'drive.js',
  'config.js',
  'lessons.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];
const TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Google (login, Drive, seletor) e outros sites: não mexe.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const fromNetwork = fetch(req).then((resp) => {
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  });
  fromNetwork.catch(() => {}); // a falha é tratada abaixo
  const timeout = new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS));
  try {
    const resp = await Promise.race([fromNetwork, timeout]);
    if (resp) return resp;
  } catch {}
  const cached = (await cache.match(req, { ignoreSearch: true }))
    || (req.mode === 'navigate' ? await cache.match('index.html') : null);
  if (cached) return cached;
  return fromNetwork; // sem cópia: espera a rede mesmo lenta (ou falha)
}
