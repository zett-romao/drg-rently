// =============================================================
// DRG-Rently — Worker "drg-rently-sites": DOMÍNIO PRÓPRIO AUTOMÁTICO (Meu site, fase 3)
// =============================================================
// Duas funções:
//
// 1) SERVIR o site de qualquer cliente no domínio dele (ex.: www.casabela.com.br).
//    O domínio aponta (CNAME) para sites.rently.dev.br — Cloudflare for SaaS emite o https
//    e manda a visita para cá. Quem é o cliente sai do DNS do próprio domínio:
//      TXT  _rently.<domínio>  =  <id do cliente no Rently>
//    Só o dono do domínio mexe no DNS dele → ninguém "sequestra" o domínio de outro cliente.
//    As páginas vêm de rently.dev.br (mesmo motor do site.html) com o cliente fixado:
//      /  e  /index.html  → site.html     (páginas extras: /index.html?p=<id>)
//      /imoveis.html, /imovel.html …     → vitrine do cliente
//
// 2) API para a tela 🌐 Meu site (login do Firebase no Authorization):
//      GET    /api/dominios?tenantId=&hostname=   → situação (DNS, https, ativo)
//      POST   /api/dominios  { tenantId, hostname } → liga (cria o hostname no Cloudflare for SaaS)
//      DELETE /api/dominios  { tenantId, hostname } → desliga
//    Pode: administrador do cliente, quem tem "🚀 Publicar o site" ou a equipe DRG.
//
// Configuração (painel Cloudflare → Workers → drg-rently-sites → Settings → Variables):
//   CF_ZONE_ID        (variável)  zona rently.dev.br, com SSL for SaaS ligado
//   CF_API_TOKEN      (SECRET)    token com "SSL and Certificates: Edit" na zona
//   ALVO_CNAME        (variável)  padrão sites.rently.dev.br
// Sem CF_ZONE_ID/CF_API_TOKEN o site no domínio já funciona se o hostname for criado à mão;
// a API responde 503 explicando o que falta.

const ORIGEM = 'https://rently.dev.br';
const PROJETO = 'drg-rently';
const HOSTS_PROPRIOS = ['rently.dev.br', 'www.rently.dev.br'];
const PAGINAS_COM_CLIENTE = /^\/(site|imoveis|imovel|parceiro)\.html$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request, env, url);
    const host = (url.searchParams.get('_host') && url.hostname.endsWith('workers.dev'))
      ? url.searchParams.get('_host').toLowerCase()           // teste pelo workers.dev
      : url.hostname.toLowerCase();
    if (HOSTS_PROPRIOS.includes(host)) return fetch(request); // rently.dev.br segue para o GitHub Pages
    if (url.hostname.endsWith('workers.dev') && !url.searchParams.get('_host')) {
      return new Response('drg-rently-sites: ok', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    return servirSite(request, env, ctx, url, host);
  },
};

// =============================================================
// 1) Site do cliente no domínio dele
// =============================================================
async function servirSite(request, env, ctx, url, host) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Método não permitido', { status: 405 });
  const tenantId = await tenantDoDominio(host, ctx);
  if (!tenantId) return paginaAviso(404, 'Este endereço ainda não está ligado a um site',
    `Falta o registro TXT <code>_rently.${esc(host)}</code> com o código do cliente no Rently. Configure em 🌐 Meu site → Endereço e domínio.`);

  let caminho = url.pathname;
  if (caminho === '/' || caminho === '/index.html') caminho = '/site.html';
  if (caminho === '/sw.js' || caminho === '/manifest.json') return new Response('', { status: 404 });
  const destino = new URL(caminho + url.search, ORIGEM);
  destino.searchParams.delete('_host');
  const resp = await fetch(destino.toString(), { headers: { 'User-Agent': request.headers.get('User-Agent') || 'drg-rently-sites' }, cf: { cacheTtl: 300 } });

  const tipo = resp.headers.get('content-type') || '';
  if (!PAGINAS_COM_CLIENTE.test(caminho) || !tipo.includes('text/html') || !resp.ok) {
    const h = new Headers(resp.headers);
    h.delete('set-cookie');
    return new Response(resp.body, { status: resp.status, headers: h });
  }
  // Fixa o cliente na página (o motor e a vitrine leem window.RENTLY_TENANT_FIXO)
  let html = await resp.text();
  const fixo = `<script>window.RENTLY_TENANT_FIXO=${JSON.stringify(tenantId)};window.RENTLY_SITE=Object.assign({inicio:'index.html'},window.RENTLY_SITE||{});</script>`;
  html = html.replace(/<head([^>]*)>/i, (m) => `${m}\n${fixo}`);
  const h = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  return new Response(html, { status: 200, headers: h });
}

// TXT _rently.<host> → id do cliente (cache de 5 min)
async function tenantDoDominio(host, ctx) {
  const chave = new Request(`https://cache.rently.local/dominio/${encodeURIComponent(host)}`);
  const cache = caches.default;
  const guardado = await cache.match(chave);
  if (guardado) { const t = await guardado.text(); return t || null; }
  const txt = await consultarDns(`_rently.${host}`, 'TXT');
  const id = txt.map((v) => v.replace(/^"|"$/g, '').trim()).find((v) => /^[A-Za-z0-9_-]{6,64}$/.test(v)) || '';
  ctx.waitUntil(cache.put(chave, new Response(id, { headers: { 'cache-control': `public, max-age=${id ? 300 : 60}` } })));
  return id || null;
}
async function consultarDns(nome, tipo) {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(nome)}&type=${tipo}`, { headers: { accept: 'application/dns-json' } });
    const j = await r.json();
    return (j.Answer || []).map((a) => String(a.data).replace(/\.$/, ''));
  } catch (_) { return []; }
}

// =============================================================
// 2) API do domínio (tela 🌐 Meu site)
// =============================================================
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });

async function api(request, env, url) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (url.pathname !== '/api/dominios') return json({ erro: 'Rota não existe.' }, 404);
  try {
    const corpo = request.method === 'GET' ? Object.fromEntries(url.searchParams) : await request.json().catch(() => ({}));
    const tenantId = String(corpo.tenantId || '');
    const hostname = normalizarHost(corpo.hostname);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(tenantId)) return json({ erro: 'Cliente inválido.' }, 400);
    if (!hostname) return json({ erro: 'Domínio inválido. Use, por exemplo, www.suaimobiliaria.com.br' }, 400);
    if (HOSTS_PROPRIOS.includes(hostname) || hostname.endsWith('.rently.dev.br')) return json({ erro: 'Esse endereço é do próprio Rently.' }, 400);

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const quem = await verificarPermissao(token, tenantId);
    if (!quem.ok) return json({ erro: quem.erro }, quem.status || 403);

    const alvo = env.ALVO_CNAME || 'sites.rently.dev.br';
    const registros = [
      { tipo: 'CNAME', nome: hostname, valor: alvo, para: 'leva o domínio até o site' },
      { tipo: 'TXT', nome: `_rently.${hostname}`, valor: tenantId, para: 'prova que o domínio é seu e diz qual é o seu site' },
    ];
    const [cname, txt] = await Promise.all([consultarDns(hostname, 'CNAME'), consultarDns(`_rently.${hostname}`, 'TXT')]);
    const dns = {
      cnameOk: cname.some((c) => c.toLowerCase() === alvo),
      cnameAtual: cname,
      txtOk: txt.some((t) => t.replace(/^"|"$/g, '') === tenantId),
    };
    const cfPronto = !!(env.CF_ZONE_ID && env.CF_API_TOKEN);

    if (request.method === 'GET') {
      const ch = cfPronto ? await cfBuscar(env, hostname) : null;
      return json({ hostname, registros, dns, cloudflare: resumoCf(ch), cfPronto, ativo: !!(dns.cnameOk && dns.txtOk && ch && ch.status === 'active' && ch.ssl?.status === 'active') });
    }
    if (request.method === 'POST') {
      if (!dns.txtOk) return json({ erro: `Falta o registro TXT _rently.${hostname} = ${tenantId} no DNS do domínio (pode levar alguns minutos para aparecer).`, registros, dns }, 412);
      if (!cfPronto) return json({ erro: 'O domínio automático ainda não foi ativado no servidor (Cloudflare). Fale com a DR Systems.', registros, dns }, 503);
      let ch = await cfBuscar(env, hostname);
      if (!ch) ch = await cfCriar(env, hostname);
      return json({ hostname, registros, dns, cloudflare: resumoCf(ch), cfPronto, ativo: !!(dns.cnameOk && ch.status === 'active' && ch.ssl?.status === 'active') });
    }
    if (request.method === 'DELETE') {
      if (!cfPronto) return json({ erro: 'Domínio automático não ativado no servidor.' }, 503);
      // Só desliga quem é do cliente que o DNS aponta (ou se o DNS já não aponta para ninguém)
      const dono = txt.map((t) => t.replace(/^"|"$/g, '')).find(Boolean);
      if (dono && dono !== tenantId) return json({ erro: 'Este domínio está ligado a outro cliente.' }, 403);
      const ch = await cfBuscar(env, hostname);
      if (ch) await cfApi(env, `/custom_hostnames/${ch.id}`, { method: 'DELETE' });
      return json({ hostname, desligado: true });
    }
    return json({ erro: 'Método não permitido.' }, 405);
  } catch (e) {
    return json({ erro: e.message || 'Erro inesperado.' }, 500);
  }
}

function normalizarHost(h) {
  const s = String(h || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(s) ? s : '';
}

// ---------- Cloudflare for SaaS ----------
async function cfApi(env, caminho, init = {}) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}${caminho}`, {
    ...init, headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new Error('Cloudflare: ' + ((j.errors || []).map((e) => e.message).join('; ') || `erro ${r.status}`));
  return j.result;
}
async function cfBuscar(env, hostname) {
  const lista = await cfApi(env, `/custom_hostnames?hostname=${encodeURIComponent(hostname)}`);
  return (lista || []).find((c) => c.hostname === hostname) || null;
}
async function cfCriar(env, hostname) {
  return cfApi(env, '/custom_hostnames', { method: 'POST', body: JSON.stringify({ hostname, ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } } }) });
}
function resumoCf(ch) {
  if (!ch) return null;
  return { id: ch.id, status: ch.status, ssl: ch.ssl?.status || null, erros: [...(ch.verification_errors || []), ...((ch.ssl?.validation_errors || []).map((e) => e.message))] };
}

// ---------- Login do Firebase (ID token) ----------
let _chaves = null, _chavesAte = 0;
async function chavesGoogle() {
  if (_chaves && Date.now() < _chavesAte) return _chaves;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  _chaves = (await r.json()).keys || [];
  _chavesAte = Date.now() + 3600 * 1000;
  return _chaves;
}
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
async function verificarToken(token) {
  const partes = token.split('.');
  if (partes.length !== 3) throw new Error('Sessão inválida.');
  const cab = JSON.parse(new TextDecoder().decode(b64url(partes[0])));
  const dados = JSON.parse(new TextDecoder().decode(b64url(partes[1])));
  const agora = Math.floor(Date.now() / 1000);
  if (cab.alg !== 'RS256') throw new Error('Sessão inválida.');
  if (dados.aud !== PROJETO || dados.iss !== `https://securetoken.google.com/${PROJETO}`) throw new Error('Sessão de outro sistema.');
  if (!dados.sub || dados.exp < agora || dados.iat > agora + 300) throw new Error('Sessão expirada. Entre de novo.');
  const jwk = (await chavesGoogle()).find((k) => k.kid === cab.kid);
  if (!jwk) throw new Error('Sessão inválida (chave).');
  const chave = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', chave, b64url(partes[2]), new TextEncoder().encode(`${partes[0]}.${partes[1]}`));
  if (!ok) throw new Error('Sessão inválida (assinatura).');
  return dados.sub;
}
// Lê no Firestore COM o token da própria pessoa (as regras decidem o que ela vê)
async function lerDoc(caminho, token) {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJETO}/databases/(default)/documents/${caminho}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const d = await r.json();
  return d.fields || null;
}
const valor = (f, k) => { const v = f && f[k]; if (!v) return undefined; return v.stringValue ?? v.booleanValue ?? v.integerValue ?? (v.nullValue !== undefined ? null : undefined); };

async function verificarPermissao(token, tenantId) {
  if (!token) return { ok: false, status: 401, erro: 'Entre no Rently para ligar o domínio.' };
  let uid;
  try { uid = await verificarToken(token); } catch (e) { return { ok: false, status: 401, erro: e.message }; }
  const u = await lerDoc(`users/${uid}`, token);
  if (!u) return { ok: false, erro: 'Usuário não encontrado.' };
  const role = valor(u, 'role');
  if (['super_admin', 'operador_drg'].includes(role)) return { ok: true, uid };
  if (valor(u, 'tenantId') !== tenantId) return { ok: false, erro: 'Você não é deste cliente.' };
  if (role === 'admin') return { ok: true, uid };
  if (role === 'corretor') return { ok: false, erro: 'Corretor não liga domínio.' };
  const perfilId = valor(u, 'perfilId');
  if (perfilId) {
    const p = await lerDoc(`tenants/${tenantId}/perfis/${perfilId}`, token);
    const acoes = p?.acoes?.mapValue?.fields;
    const pub = acoes?.publicarSite?.stringValue ?? acoes?.publicarSite?.booleanValue;
    if (pub === 'sim' || pub === true) return { ok: true, uid };
  }
  return { ok: false, erro: 'Ligar domínio exige a permissão 🚀 Publicar o site.' };
}

// ---------- página de aviso ----------
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function paginaAviso(status, titulo, texto) {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<style>body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#f6f7f9;color:#1d2733;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{background:#fff;border-radius:14px;padding:28px;max-width:520px;box-shadow:0 8px 30px rgba(0,0,0,.08)}h1{font-size:1.3rem;margin:0 0 10px}code{background:#eef1f5;padding:2px 6px;border-radius:6px}</style></head>
<body><main><h1>${esc(titulo)}</h1><p>${texto}</p><p style="color:#5d6b7a;font-size:.9rem">Site feito com DRG-Rently · DR Systems</p></main></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
