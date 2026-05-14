// =============================================================
// DRG-Rently — Service Worker
// Versão: 1.0 (2026-05-13)
//
// Estratégia:
// - Assets estáticos (logo, manifest, css base): cache-first
// - Pra app.js e index.html: network-first (sempre busca a versão
//   nova; só usa cache se offline) — evita travar em versão antiga
// - Firebase, Workers Cloudflare, APIs externas: NÃO cacheia
//   (sempre busca direto da rede)
// =============================================================

const CACHE_VERSION = 'drg-rently-v2-20260514ai';
const STATIC_ASSETS = [
  './logo.png?v=20260514ai',
  './manifest.json',
];

// Domínios que NUNCA devem ser cacheados (precisam ser sempre online)
const NEVER_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebasestorage.googleapis.com',
  'firebase.googleapis.com',
  'gstatic.com',
  'workers.dev', // todos os workers Cloudflare da DRG
  'brasilapi.com.br',
  'viacep.com.br',
];

self.addEventListener('install', (event) => {
  // Pré-cache dos assets estáticos
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        // Se algum asset falhar, não bloqueia a instalação
        console.warn('[SW] Pré-cache falhou pra alguns assets:', err);
      });
    })
  );
  // Ativa imediatamente, sem esperar usuário fechar abas antigas
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Limpa caches antigos
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ----- SHARE TARGET ----- (recebe arquivo compartilhado do SO)
  if (req.method === 'POST' && url.pathname.endsWith('/') && url.searchParams.has('share-target')) {
    event.respondWith(handleShareTarget(req));
    return;
  }

  // Só processa GETs (POST/PUT vão direto pra rede)
  if (req.method !== 'GET') return;

  // Nunca cacheia hosts dinâmicos (Firebase, Workers, APIs)
  if (NEVER_CACHE_HOSTS.some(h => url.hostname.includes(h))) {
    return; // deixa o browser fazer o fetch normal
  }

  // Network-first pra HTML e JS (sempre tenta atualizar)
  if (
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('/') ||
    url.pathname === ''
  ) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Cache-first pra assets estáticos (imagens, CSS)
  event.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    // Só guarda em cache se for resposta válida
    if (fresh && fresh.status === 200 && fresh.type === 'basic') {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (_) {
    // Offline: tenta cache
    const cached = await caches.match(req);
    if (cached) return cached;
    // Sem cache também: retorna página de fallback simples
    return new Response(
      '<html><body style="font-family:sans-serif;text-align:center;padding:40px;"><h1>📡 Sem conexão</h1><p>O DRG-Rently precisa de internet pra funcionar.</p><p>Verifique sua conexão e recarregue.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html' } }
    );
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.status === 200) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (_) {
    return new Response('', { status: 503 });
  }
}

// =============================================================
// Handler do Share Target — recebe arquivo via "Compartilhar com..."
// do SO Android/iOS e armazena em cache temporário pra o app pegar.
// =============================================================
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('documento');
    const cache = await caches.open('shared-files');

    // Limpa shares antigos (mantém só os de hoje)
    const oldKeys = await cache.keys();
    for (const k of oldKeys) await cache.delete(k);

    // Salva cada arquivo no cache (chave = nome do arquivo)
    let count = 0;
    for (const file of files) {
      if (file && file.name && file.size > 0) {
        const safeKey = `/shared-files/${Date.now()}_${file.name.replace(/[^\w.-]/g, '_')}`;
        await cache.put(
          safeKey,
          new Response(file, {
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
              'X-Original-Name': file.name,
              'X-Original-Size': String(file.size),
            },
          })
        );
        count++;
      }
    }

    // Redireciona pro app com flag indicando que tem arquivos compartilhados
    return Response.redirect(`./?shared=${count}`, 303);
  } catch (err) {
    console.error('[SW] Erro no share_target:', err);
    return Response.redirect('./?shared-error=1', 303);
  }
}

// =============================================================
// Notificações push (Fase futura — placeholder por enquanto)
// =============================================================
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch (_) { data = { title: 'DRG-Rently', body: event.data.text() }; }
  const title = data.title || 'DRG-Rently';
  const options = {
    body: data.body || '',
    icon: data.icon || './logo.png?v=20260514ai',
    badge: './logo.png?v=20260514ai',
    data: data.url || './',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data || './';
  event.waitUntil(clients.openWindow(url));
});
