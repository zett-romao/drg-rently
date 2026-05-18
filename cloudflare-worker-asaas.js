// =============================================================
// DRG-Rently — Cloudflare Worker proxy para Asaas API (cobrança recorrente)
//
// Usado pela D.R. Global pra cobrar mensalidade dos clientes do SaaS.
// Token do Asaas fica como SECRET no Worker (só a DRG tem).
// Webhook do Asaas atualiza automaticamente o status do tenant.
//
// =============================================================
//
// COMO INSTALAR:
//
// 1. Crie conta no Asaas: https://www.asaas.com (com CNPJ da D.R. Global)
// 2. Após validar a conta, vá em Integrações → Gerar Token API
//    - Use PRODUÇÃO depois de testar, ou SANDBOX pra desenvolver
// 3. Cloudflare → Workers & Pages → Create Worker
//    - Nome: "drg-rently-asaas"
//    - Cole este código
//    - Deploy
// 4. Settings → Variables and Secrets:
//    - Secret ASAAS_API_KEY = seu token Asaas
//    - Secret WEBHOOK_TOKEN = um token aleatório (você inventa, usado pra
//      autenticar o webhook do Asaas pro seu Worker)
//    - Secret FIREBASE_API_KEY = mesma do drg-rently (pra atualizar
//      Firestore via REST nos webhooks)
//    - Variable PROJECT_ID = drg-rently
//    - Variable ASAAS_ENV = "production" (ou "sandbox" pra testar)
// 5. No Asaas → Integrações → Webhooks → Adicionar:
//    - URL: https://drg-rently-asaas.SEU-USUARIO.workers.dev/webhook
//    - Token de autenticação: o mesmo que você setou em WEBHOOK_TOKEN
//    - Eventos: marque PAYMENT_RECEIVED, PAYMENT_CONFIRMED,
//      PAYMENT_OVERDUE, PAYMENT_DELETED, SUBSCRIPTION_DELETED
// 6. No DRG-Rently → Super Admin → Configurações de cobrança:
//    - Cole URL do Worker
//
// =============================================================

const ALLOWED_ORIGINS = [
  'https://zett-romao.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

function asaasBase(env) {
  return env.ASAAS_ENV === 'sandbox'
    ? 'https://sandbox.asaas.com/api/v3'
    : 'https://api.asaas.com/v3';
}

// Helper que faz fetch pro Asaas com headers obrigatórios
// (Asaas exige User-Agent em todas as requisições)
// apiKey: opcional — se fornecida, usa essa chave (tenant). Senão usa env.ASAAS_API_KEY (DRG Global).
async function asaasFetch(url, env, method = 'GET', body = null, apiKey = null) {
  const token = apiKey || env.ASAAS_API_KEY;
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'DRG-Rently/1.0 (Cloudflare-Worker)',
    'access_token': token,
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

// Determina qual API key usar:
// - Se header X-Tenant-Asaas-Token presente → tenant usa SUA própria chave
//   (cobra seus locatários, paga seus locadores; D.R. Global não participa)
// - Senão → usa env.ASAAS_API_KEY (cobrança de mensalidade do SaaS pela DRG)
function resolveApiKey(request) {
  return request.headers.get('X-Tenant-Asaas-Token') || null;
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-DRG-Admin-Token, X-Tenant-Asaas-Token, asaas-access-token',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });
}

// =============================================================
// CAMADA 2 — Verificação de identidade (Firebase ID token)
// O cliente manda o ID token (auth.currentUser.getIdToken()) em toda
// chamada sensível. O back-end verifica a assinatura ANTES de executar.
// Sem isto, um curl sem Origin passaria direto.
// =============================================================
const FIREBASE_PROJECT_ID = 'drg-rently';
const FIREBASE_JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let _firebaseKeys = null;

function b64urlDecode(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

async function getFirebaseKeys() {
  if (_firebaseKeys && _firebaseKeys.exp > Date.now()) return _firebaseKeys.mapa;
  const res = await fetch(FIREBASE_JWK_URL);
  const data = await res.json();
  const mapa = {};
  for (const jwk of (data.keys || [])) {
    mapa[jwk.kid] = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
  }
  const m = (res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/);
  _firebaseKeys = { mapa, exp: Date.now() + (m ? +m[1] : 3600) * 1000 };
  return mapa;
}

async function verificarIdToken(idToken) {
  if (!idToken) throw new Error('token ausente');
  const p = String(idToken).split('.');
  if (p.length !== 3) throw new Error('token malformado');
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(p[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p[1])));
  if (header.alg !== 'RS256') throw new Error('alg invalido');
  const key = (await getFirebaseKeys())[header.kid];
  if (!key) throw new Error('chave nao encontrada');
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlDecode(p[2]),
    new TextEncoder().encode(p[0] + '.' + p[1])
  );
  if (!ok) throw new Error('assinatura invalida');
  const agora = Math.floor(Date.now() / 1000);
  if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error('outro projeto');
  if (payload.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID) throw new Error('emissor');
  if (!payload.sub || !payload.exp || payload.exp <= agora) throw new Error('token invalido/expirado');
  return { uid: payload.sub, email: payload.email || '', authTime: payload.auth_time || 0 };
}

// Extrai o idToken do request: header Authorization (GET) ou body JSON (POST).
async function extrairIdToken(request) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  if (request.method === 'POST') {
    try {
      const body = await request.clone().json();
      return body.idToken || '';
    } catch (_) {}
  }
  return '';
}

// =============================================================
// S3 — 2FA / MFA via TOTP (Google Authenticator, RFC 6238)
//
// O segredo do 2FA mora na coleção Firestore `mfa/{uid}`, que NÃO tem
// regra de acesso (default-deny): nem o cliente nem a Web API key
// conseguem ler. Só este Worker — autenticado como service account
// (admin, ignora as regras) — grava e lê. Daí a necessidade do secret
// FIREBASE_SERVICE_ACCOUNT_JSON (a MESMA do Worker passkey).
// =============================================================
let _googleToken = null; // cache do access token OAuth2 (vale ~1h)

function b64urlEncode(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Troca a service account por um access token Google (escopo Firestore).
async function getGoogleAccessToken(env) {
  if (_googleToken && _googleToken.exp > Date.now() + 120000) return _googleToken.token;
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error('Service account não configurado no Worker (FIREBASE_SERVICE_ACCOUNT_JSON).');
  }
  let sa;
  try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); }
  catch (_) { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON inválido (não é JSON).'); }
  if (!sa.client_email || !sa.private_key) throw new Error('Service account incompleto.');

  const agora = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600,
  };
  const enc = (o) => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc(header) + '.' + enc(claim);

  const pem = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const pkcs8 = b64urlDecode(pem.replace(/\+/g, '-').replace(/\//g, '_'));
  const chave = await crypto.subtle.importKey(
    'pkcs8', pkcs8, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64urlEncode(sig);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error('Falha OAuth Google: ' + (data.error_description || data.error || res.status));
  }
  _googleToken = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

// --- Firestore REST como admin (ignora regras; usado só na coleção mfa/) ---
function firestoreToFields(obj) {
  const f = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === null || v === undefined) f[k] = { nullValue: null };
    else if (typeof v === 'boolean') f[k] = { booleanValue: v };
    else if (typeof v === 'number') f[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else if (v instanceof Date) f[k] = { timestampValue: v.toISOString() };
    else f[k] = { stringValue: String(v) };
  }
  return f;
}

function firestoreParseValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return firestoreParseFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(firestoreParseValue);
  return null;
}

function firestoreParseFields(fields) {
  const o = {};
  for (const k of Object.keys(fields || {})) o[k] = firestoreParseValue(fields[k]);
  return o;
}

async function firestoreAdminGet(env, docPath) {
  const token = await getGoogleAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Firestore GET ' + res.status);
  const doc = await res.json();
  return firestoreParseFields(doc.fields);
}

async function firestoreAdminMerge(env, docPath, obj) {
  const token = await getGoogleAccessToken(env);
  const mask = Object.keys(obj).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${docPath}?${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: firestoreToFields(obj) }),
  });
  if (!res.ok) throw new Error('Firestore PATCH ' + res.status);
  return true;
}

// Cria um documento novo numa coleção (ID automático).
async function firestoreAdminAddDoc(env, collectionPath, obj) {
  const token = await getGoogleAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collectionPath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: firestoreToFields(obj) }),
  });
  if (!res.ok) throw new Error('Firestore POST ' + res.status);
  return true;
}

// --- TOTP (RFC 6238) ---
const B32_ALFA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) { out += B32_ALFA[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32_ALFA[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const limpo = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (let i = 0; i < limpo.length; i++) {
    value = (value << 5) | B32_ALFA.indexOf(limpo[i]);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function totpCodigo(secretBytes, contador) {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setUint32(0, Math.floor(contador / 0x100000000));
  dv.setUint32(4, contador >>> 0);
  const chave = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', chave, buf));
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1000000).padStart(6, '0');
}

// Verifica um código TOTP com janela ±1 passo (tolera ~30s de relógio fora).
async function verificarTotp(secretBase32, codigo) {
  const code = String(codigo || '').replace(/\D/g, '');
  if (code.length !== 6) return false;
  const secret = base32Decode(secretBase32);
  if (secret.length < 10) return false;
  const passo = Math.floor(Date.now() / 1000 / 30);
  for (let d = -1; d <= 1; d++) {
    const esperado = await totpCodigo(secret, passo + d);
    let diff = 0;
    for (let i = 0; i < 6; i++) diff |= esperado.charCodeAt(i) ^ code.charCodeAt(i);
    if (diff === 0) return true;
  }
  return false;
}

// --- Endpoints /mfa/* ---
async function mfaEnroll(env, origin, usuario) {
  const bytes = crypto.getRandomValues(new Uint8Array(20)); // 160 bits
  const secretBase32 = base32Encode(bytes);
  await firestoreAdminMerge(env, `mfa/${usuario.uid}`, {
    secretBase32,
    ativo: false,
    email: usuario.email || '',
    criadoEm: new Date(),
  });
  const conta = usuario.email || usuario.uid;
  const label = encodeURIComponent('DRG-Rently:' + conta);
  const issuer = encodeURIComponent('DRG-Rently');
  const otpauthUri = `otpauth://totp/${label}?secret=${secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  return jsonResponse({ ok: true, otpauthUri, secretBase32 }, 200, origin);
}

async function mfaConfirm(request, env, origin, usuario) {
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const codigo = String(body.codigo || body.totp || '').replace(/\D/g, '');
  const doc = await firestoreAdminGet(env, `mfa/${usuario.uid}`);
  if (!doc || !doc.secretBase32) {
    return jsonResponse({ ok: false, error: 'Nenhum 2FA pendente. Gere o QR code primeiro.' }, 400, origin);
  }
  if (!(await verificarTotp(doc.secretBase32, codigo))) {
    return jsonResponse({ ok: false, error: 'Código incorreto. Confira a hora do celular e digite o código atual do app.' }, 400, origin);
  }
  await firestoreAdminMerge(env, `mfa/${usuario.uid}`, { ativo: true, confirmadoEm: new Date() });
  return jsonResponse({ ok: true, ativo: true }, 200, origin);
}

async function mfaStatus(env, origin, usuario) {
  const doc = await firestoreAdminGet(env, `mfa/${usuario.uid}`);
  return jsonResponse({ ok: true, ativo: !!(doc && doc.ativo) }, 200, origin);
}

// =============================================================
// S4 — Camada 3: fluxo de aprovação ("Pagar locador via PIX")
//
// O front SOLICITA (cria solicitacoesPagamento/{id} = AGUARDANDO_APROVACAO,
// não move dinheiro). Outra pessoa APROVA: este endpoint faz 8 verificações
// NESTA ORDEM e só então executa a transferência PIX no Asaas.
// =============================================================

// Roles que têm a ação aprovarPagamentoLocador no fallback fixo
// (espelha ROLE_ACOES_PADRAO do app.js — nível 3 da resolução de perfil).
const ROLE_APROVA_PIX = { super_admin: true, operador_drg: true, admin: true, operador: false };

// Replica resolverPerfilUsuario + normalizarPerfil do front, server-side,
// só para a ação aprovarPagamentoLocador. Fallback de 3 níveis.
async function usuarioPodeAprovarPix(env, userDoc, tenantId) {
  const role = userDoc.role || 'operador';
  if (role === 'super_admin') return true; // piso anti-lockout
  let perfil = null;
  // Nível 1 — perfil explícito do usuário
  if (userDoc.perfilId) {
    perfil = await firestoreAdminGet(env, `tenants/${tenantId}/perfis/${userDoc.perfilId}`);
  }
  // Nível 2 — perfil seed do role
  if (!perfil) {
    perfil = await firestoreAdminGet(env, `tenants/${tenantId}/perfis/seed_${role}`);
  }
  // Modelo 2.0 — o perfil tem o mapa acoes
  if (perfil && perfil.acoes && typeof perfil.acoes === 'object') {
    return perfil.acoes.aprovarPagamentoLocador === true;
  }
  // Nível 3 — legado ({modulos:[...]}) ou sem perfil: mapa fixo do role
  return ROLE_APROVA_PIX[role] === true;
}

async function aprovarPagamento(request, env, origin, usuario) {
  // (1) verificarIdToken já rodou no router → usuario = {uid, email, authTime}

  // (2) auth_time recente: a senha tem que ter sido confirmada há ≤ 5 min
  const agora = Math.floor(Date.now() / 1000);
  if (!usuario.authTime || (agora - usuario.authTime) > 300) {
    return jsonResponse({ ok: false, error: 'Sua sessão está antiga. Confirme a senha novamente para aprovar.' }, 401, origin);
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const solicitacaoId = String(body.solicitacaoId || '').trim();
  const totp = String(body.totp || '').replace(/\D/g, '');
  if (!solicitacaoId) return jsonResponse({ ok: false, error: 'solicitacaoId ausente.' }, 400, origin);

  // (3) usuário + tenant + permissão de aprovar
  const userDoc = await firestoreAdminGet(env, `users/${usuario.uid}`);
  if (!userDoc) return jsonResponse({ ok: false, error: 'Usuário não encontrado.' }, 403, origin);
  const tenantId = userDoc.tenantId;
  if (!tenantId) return jsonResponse({ ok: false, error: 'Usuário sem tenant — aprovação não disponível.' }, 403, origin);
  if (!(await usuarioPodeAprovarPix(env, userDoc, tenantId))) {
    return jsonResponse({ ok: false, error: 'Seu perfil não tem permissão para aprovar pagamentos ao locador.' }, 403, origin);
  }

  // (4) 2FA ativo + código TOTP correto
  const mfa = await firestoreAdminGet(env, `mfa/${usuario.uid}`);
  if (!mfa || mfa.ativo !== true || !mfa.secretBase32) {
    return jsonResponse({ ok: false, error: 'Ative o 2FA (botão "Conta") antes de aprovar pagamentos.' }, 403, origin);
  }
  if (!(await verificarTotp(mfa.secretBase32, totp))) {
    return jsonResponse({ ok: false, error: 'Código 2FA incorreto.' }, 401, origin);
  }

  // (5) solicitação existe e está AGUARDANDO_APROVACAO — VALOR LIDO DO SERVIDOR
  const solPath = `tenants/${tenantId}/solicitacoesPagamento/${solicitacaoId}`;
  const sol = await firestoreAdminGet(env, solPath);
  if (!sol) return jsonResponse({ ok: false, error: 'Solicitação não encontrada.' }, 404, origin);
  if (sol.status !== 'AGUARDANDO_APROVACAO') {
    return jsonResponse({ ok: false, error: 'Esta solicitação não está aguardando aprovação (status: ' + sol.status + ').' }, 409, origin);
  }

  // (6) separação de funções: quem aprova ≠ quem solicitou
  if (sol.solicitadoPor && sol.solicitadoPor === usuario.uid) {
    return jsonResponse({ ok: false, error: 'Você não pode aprovar a própria solicitação — outra pessoa precisa aprovar.' }, 403, origin);
  }

  const valor = Number(sol.valor);
  if (!(valor > 0)) return jsonResponse({ ok: false, error: 'Valor da solicitação inválido.' }, 400, origin);
  if (!sol.pixAddressKey) return jsonResponse({ ok: false, error: 'Solicitação sem chave PIX.' }, 400, origin);

  // (7) só AGORA executa a transferência PIX no Asaas
  const cfg = await firestoreAdminGet(env, `tenants/${tenantId}/config/site`);
  const asaasKey = cfg && cfg.asaasTenantToken;
  if (!asaasKey) return jsonResponse({ ok: false, error: 'Chave Asaas do tenant não configurada.' }, 400, origin);

  const transferBody = {
    value: Number(valor.toFixed(2)),
    pixAddressKey: sol.pixAddressKey,
    pixAddressKeyType: sol.pixAddressKeyType || 'CPF',
    description: sol.descricao || 'Repasse DRG-Rently',
  };
  const asaasRes = await asaasFetch(`${asaasBase(env)}/transfers`, env, 'POST', transferBody, asaasKey);
  const asaasData = await asaasRes.json().catch(() => ({}));
  if (!asaasRes.ok) {
    return jsonResponse({ ok: false, error: 'Asaas recusou a transferência: ' + (asaasData.errors?.[0]?.description || asaasRes.status) }, 502, origin);
  }

  // (8) atualiza a solicitação + log de auditoria
  const quando = new Date();
  await firestoreAdminMerge(env, solPath, {
    status: 'APROVADO',
    aprovadoPor: usuario.uid,
    aprovadoPorEmail: usuario.email || '',
    aprovadoEm: quando,
    asaasTransferId: asaasData.id || '',
  });
  try {
    // grava na MESMA subcoleção que o app usa (tenants/{tid}/auditoria)
    await firestoreAdminAddDoc(env, `tenants/${tenantId}/auditoria`, {
      acao: 'aprovar_pagamento_locador',
      entidade: 'solicitacaoPagamento',
      entidadeId: solicitacaoId,
      userId: usuario.uid,
      userNome: userDoc.nome || '',
      userEmail: usuario.email || '',
      userRole: userDoc.role || '',
      detalhe: 'Aprovou repasse de R$ ' + valor.toFixed(2) + ' para ' + (sol.locadorNome || sol.pixAddressKey)
        + '. Solicitado por ' + (sol.solicitadoPorEmail || sol.solicitadoPor || '?')
        + '. Asaas transfer ' + (asaasData.id || '-') + '.',
      timestamp: quando,
    });
  } catch (_) { /* auditoria não bloqueia o resultado */ }

  return jsonResponse({ ok: true, status: 'APROVADO', asaasTransferId: asaasData.id || '', valor: valor }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Webhook do Asaas (não passa por auth do admin)
    if (path === '/webhook' && request.method === 'POST') {
      return await handleWebhook(request, env, origin);
    }

    // Help page
    if (path === '/' || path === '') {
      return new Response(htmlHelp(env), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // =============================================================
    // ROTAS /mfa/* — 2FA TOTP. Exigem só identidade (Firebase ID token);
    // não usam chave Asaas nem token administrativo.
    // =============================================================
    if (path.startsWith('/mfa/')) {
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return jsonResponse({ error: 'Origin not allowed' }, 403, origin);
      }
      let usuarioMfa;
      try {
        usuarioMfa = await verificarIdToken(await extrairIdToken(request));
      } catch (e) {
        return jsonResponse({ error: 'Autenticação falhou: ' + e.message + '. Faça login novamente.' }, 401, origin);
      }
      try {
        if (path === '/mfa/enroll' && request.method === 'POST') return await mfaEnroll(env, origin, usuarioMfa);
        if (path === '/mfa/confirm' && request.method === 'POST') return await mfaConfirm(request, env, origin, usuarioMfa);
        if (path === '/mfa/status' && request.method === 'GET') return await mfaStatus(env, origin, usuarioMfa);
        return jsonResponse({ error: 'Endpoint MFA não encontrado: ' + path }, 404, origin);
      } catch (e) {
        return jsonResponse({ error: 'Erro MFA: ' + e.message }, 500, origin);
      }
    }

    // =============================================================
    // ROTA /aprovar-pagamento — S4: aprova um repasse PIX ao locador.
    // 8 verificações no servidor antes de mover dinheiro.
    // =============================================================
    if (path === '/aprovar-pagamento') {
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return jsonResponse({ error: 'Origin not allowed' }, 403, origin);
      }
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'Use POST.' }, 405, origin);
      }
      let usuarioAp;
      try {
        usuarioAp = await verificarIdToken(await extrairIdToken(request));
      } catch (e) {
        return jsonResponse({ error: 'Autenticação falhou: ' + e.message + '. Faça login novamente.' }, 401, origin);
      }
      try {
        return await aprovarPagamento(request, env, origin, usuarioAp);
      } catch (e) {
        return jsonResponse({ ok: false, error: 'Erro ao aprovar: ' + e.message }, 500, origin);
      }
    }

    // Demais endpoints exigem auth — duas formas:
    //  (a) X-DRG-Admin-Token (cobrança de mensalidade pela DRG Global), OU
    //  (b) X-Tenant-Asaas-Token (tenant usa sua própria chave Asaas)
    const adminToken = request.headers.get('X-DRG-Admin-Token');
    const tenantAsaasKey = request.headers.get('X-Tenant-Asaas-Token');
    const isAdmin = adminToken && adminToken === env.WEBHOOK_TOKEN;
    const isTenant = !!tenantAsaasKey;

    // Endpoints /tenant/* exigem token do tenant; demais exigem admin (compat com cobrança DRG)
    let _usuarioAutenticado = null;
    if (path.startsWith('/tenant/')) {
      if (!isTenant) {
        return jsonResponse({ error: 'Header X-Tenant-Asaas-Token obrigatório.' }, 401, origin);
      }
      // CAMADA 2 — verifica identidade do usuário (Firebase ID token).
      // /tenant/health é exceção (teste de chave, ainda sem usuário logado plenamente).
      if (path !== '/tenant/health') {
        try {
          const idToken = await extrairIdToken(request);
          _usuarioAutenticado = await verificarIdToken(idToken);
        } catch (e) {
          return jsonResponse({ error: 'Autenticação falhou: ' + e.message + '. Faça login novamente.' }, 401, origin);
        }
      }
    } else {
      if (!isAdmin) {
        return jsonResponse({ error: 'Token administrativo inválido' }, 401, origin);
      }
    }
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return jsonResponse({ error: 'Origin not allowed' }, 403, origin);
    }

    try {
      // ----------- CUSTOMERS -----------
      if (path === '/customers' && request.method === 'POST') {
        return await criarCustomer(request, env, origin);
      }
      const matchCustomer = path.match(/^\/customers\/([^\/]+)$/);
      if (matchCustomer && request.method === 'GET') {
        return await buscarCustomer(matchCustomer[1], env, origin);
      }

      // ----------- SUBSCRIPTIONS -----------
      if (path === '/subscriptions' && request.method === 'POST') {
        return await criarSubscription(request, env, origin);
      }
      const matchSub = path.match(/^\/subscriptions\/([^\/]+)$/);
      if (matchSub && request.method === 'GET') {
        return await buscarSubscription(matchSub[1], env, origin);
      }
      if (matchSub && request.method === 'PUT') {
        return await atualizarSubscription(matchSub[1], request, env, origin);
      }
      if (matchSub && request.method === 'DELETE') {
        return await cancelarSubscription(matchSub[1], env, origin);
      }

      // ----------- PAYMENTS (lista da subscription) -----------
      const matchPayments = path.match(/^\/subscriptions\/([^\/]+)\/payments$/);
      if (matchPayments && request.method === 'GET') {
        return await listarPagamentos(matchPayments[1], env, origin);
      }

      // ----------- PAYMENTS — cobrança avulsa -----------
      if (path === '/payments' && request.method === 'POST') {
        return await criarPagamentoAvulso(request, env, origin);
      }

      // =============================================================
      // ROTAS TENANT (imobiliária usa SUA própria chave Asaas)
      // =============================================================
      const apiKey = resolveApiKey(request);

      // POST /tenant/customers — cria cliente no Asaas do tenant
      if (path === '/tenant/customers' && request.method === 'POST') {
        return await tenantCriarCustomer(request, env, origin, apiKey);
      }
      // POST /tenant/payments — cria cobrança (boleto/PIX/cartão) pro locatário
      if (path === '/tenant/payments' && request.method === 'POST') {
        return await tenantCriarCobranca(request, env, origin, apiKey);
      }
      // GET /tenant/payments/:id — busca status da cobrança
      const matchTenantPayment = path.match(/^\/tenant\/payments\/([^\/]+)$/);
      if (matchTenantPayment && request.method === 'GET') {
        return await tenantBuscarCobranca(matchTenantPayment[1], env, origin, apiKey);
      }
      // POST /tenant/transfers — transfere PIX/TED pro locador (repasse do líquido)
      if (path === '/tenant/transfers' && request.method === 'POST') {
        return await tenantCriarTransferencia(request, env, origin, apiKey);
      }
      // GET /tenant/balance — saldo disponível no Asaas do tenant
      if (path === '/tenant/balance' && request.method === 'GET') {
        return await tenantConsultarSaldo(env, origin, apiKey);
      }
      // GET /tenant/health — teste de chave válida (ping)
      if (path === '/tenant/health' && request.method === 'GET') {
        return await tenantHealth(env, origin, apiKey);
      }

      return jsonResponse({ error: 'Endpoint não encontrado: ' + path }, 404, origin);
    } catch (err) {
      return jsonResponse({ error: 'Erro interno: ' + err.message }, 500, origin);
    }
  },
};

// =============================================================
// CUSTOMERS
// =============================================================

async function criarCustomer(request, env, origin) {
  const payload = await request.json();
  // payload esperado: { name, email, cpfCnpj, phone, tenantId }
  if (!payload.name || !payload.cpfCnpj) {
    return jsonResponse({ error: 'Campos obrigatórios: name, cpfCnpj' }, 400, origin);
  }

  const body = {
    name: payload.name,
    email: payload.email,
    cpfCnpj: payload.cpfCnpj.replace(/\D/g, ''),
    phone: (payload.phone || '').replace(/\D/g, '') || undefined,
    externalReference: payload.tenantId, // 🎯 vincula ao tenant
    notificationDisabled: false,
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

  const res = await asaasFetch(`${asaasBase(env)}/customers`, env, 'POST', body);
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description || 'Erro Asaas', details: data }, res.status, origin);
  return jsonResponse({ success: true, customer: data }, 200, origin);
}

async function buscarCustomer(customerId, env, origin) {
  const res = await asaasFetch(`${asaasBase(env)}/customers/${customerId}`, env);
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description, details: data }, res.status, origin);
  return jsonResponse({ success: true, customer: data }, 200, origin);
}

// =============================================================
// SUBSCRIPTIONS
// =============================================================

async function criarSubscription(request, env, origin) {
  const payload = await request.json();
  // payload esperado: { customer, value, nextDueDate, billingType, cycle, description, tenantId }
  if (!payload.customer || !payload.value || !payload.nextDueDate) {
    return jsonResponse({ error: 'Campos obrigatórios: customer, value, nextDueDate' }, 400, origin);
  }

  const body = {
    customer: payload.customer,
    billingType: payload.billingType || 'PIX', // PIX | BOLETO | CREDIT_CARD | UNDEFINED
    value: payload.value,
    nextDueDate: payload.nextDueDate, // YYYY-MM-DD
    cycle: payload.cycle || 'MONTHLY', // WEEKLY | BIWEEKLY | MONTHLY | QUARTERLY | SEMIANNUALLY | YEARLY
    description: payload.description || 'Assinatura DRG-Rently',
    externalReference: payload.tenantId,
    fine: { value: 2 },        // multa 2% por atraso
    interest: { value: 1 },    // juros 1% ao mês
    discount: payload.discount || undefined,
    endDate: payload.endDate || undefined,
    maxPayments: payload.maxPayments || undefined,
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

  const res = await asaasFetch(`${asaasBase(env)}/subscriptions`, env, 'POST', body);
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description || 'Erro Asaas', details: data }, res.status, origin);
  return jsonResponse({ success: true, subscription: data }, 200, origin);
}

async function buscarSubscription(subId, env, origin) {
  const res = await asaasFetch(`${asaasBase(env)}/subscriptions/${subId}`, env);
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description, details: data }, res.status, origin);
  return jsonResponse({ success: true, subscription: data }, 200, origin);
}

async function cancelarSubscription(subId, env, origin) {
  const res = await asaasFetch(`${asaasBase(env)}/subscriptions/${subId}`, env, 'DELETE');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return jsonResponse({ error: data.errors?.[0]?.description || 'Erro Asaas', details: data }, res.status, origin);
  }
  return jsonResponse({ success: true, deleted: true }, 200, origin);
}

async function atualizarSubscription(subId, request, env, origin) {
  const payload = await request.json();
  // payload esperado: { value, nextDueDate?, billingType?, description?, updatePendingPayments? }
  const body = {};
  if (typeof payload.value === 'number' && payload.value > 0) body.value = payload.value;
  if (payload.nextDueDate) body.nextDueDate = payload.nextDueDate;
  if (payload.billingType) body.billingType = payload.billingType;
  if (payload.description) body.description = payload.description;
  if (typeof payload.updatePendingPayments === 'boolean') body.updatePendingPayments = payload.updatePendingPayments;

  if (Object.keys(body).length === 0) {
    return jsonResponse({ error: 'Nenhum campo válido pra atualizar' }, 400, origin);
  }

  const res = await asaasFetch(`${asaasBase(env)}/subscriptions/${subId}`, env, 'POST', body);
  // Asaas usa POST pra atualizar (não PUT), mas o cliente pode mandar PUT pro Worker
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description || 'Erro Asaas', details: data }, res.status, origin);
  return jsonResponse({ success: true, subscription: data }, 200, origin);
}

// =============================================================
// COBRANÇA AVULSA (não-recorrente — payment único)
// =============================================================

async function criarPagamentoAvulso(request, env, origin) {
  const payload = await request.json();
  // payload esperado: { customer, value, dueDate, description, billingType, tenantId, externalReference }
  if (!payload.customer || !payload.value || !payload.dueDate) {
    return jsonResponse({ error: 'Campos obrigatórios: customer, value, dueDate' }, 400, origin);
  }

  const body = {
    customer: payload.customer,
    billingType: payload.billingType || 'PIX',
    value: payload.value,
    dueDate: payload.dueDate, // YYYY-MM-DD
    description: payload.description || 'Cobrança DRG-Rently',
    externalReference: payload.tenantId || payload.externalReference,
    fine: { value: 2 },
    interest: { value: 1 },
    discount: payload.discount || undefined,
    installmentCount: payload.installmentCount || undefined,
    installmentValue: payload.installmentValue || undefined,
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

  const res = await asaasFetch(`${asaasBase(env)}/payments`, env, 'POST', body);
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description || 'Erro Asaas', details: data }, res.status, origin);
  return jsonResponse({ success: true, payment: data }, 200, origin);
}

// =============================================================
// PAYMENTS — lista pagamentos de uma assinatura
// =============================================================

async function listarPagamentos(subId, env, origin) {
  const res = await asaasFetch(`${asaasBase(env)}/payments?subscription=${subId}&limit=100`, env);
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description, details: data }, res.status, origin);
  return jsonResponse({ success: true, payments: data.data || [], total: data.totalCount || 0 }, 200, origin);
}

// =============================================================
// WEBHOOK — recebe notificações do Asaas
// =============================================================

async function handleWebhook(request, env, origin) {
  // Verifica autenticação do webhook (token configurado no Asaas)
  const authHeader = request.headers.get('asaas-access-token');
  if (authHeader !== env.WEBHOOK_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }

  let event;
  try {
    event = await request.json();
  } catch (_) {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Eventos relevantes:
  // - PAYMENT_RECEIVED / PAYMENT_CONFIRMED → renova vencimento + ativa
  // - PAYMENT_OVERDUE → marca como inadimplente (não suspende automaticamente)
  // - SUBSCRIPTION_DELETED → cancela assinatura no tenant

  const eventType = event.event;
  const payment = event.payment;
  const subscription = event.subscription;

  try {
    const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${env.PROJECT_ID || 'drg-rently'}/databases/(default)/documents`;

    if ((eventType === 'PAYMENT_RECEIVED' || eventType === 'PAYMENT_CONFIRMED') && payment) {
      // Pagamento confirmado: identifica o tenant pelo externalReference
      const tenantId = payment.externalReference;
      if (tenantId) {
        // Atualiza vencimento: próximo vencimento = data atual + 30 dias (ou usa subscription.nextDueDate)
        const nextDue = calcularProximoVencimento();
        await atualizarFirestore(FIRESTORE, env, `tenants/${tenantId}`, {
          proximoVencimento: { stringValue: nextDue },
          ativo: { booleanValue: true },
        });
        // Registra pagamento na subcoleção
        await adicionarPagamentoFirestore(FIRESTORE, env, tenantId, {
          asaasPaymentId: payment.id,
          data: (payment.paymentDate || payment.confirmedDate || new Date().toISOString().slice(0, 10)),
          valor: payment.value,
          metodo: (payment.billingType || 'pix').toLowerCase(),
          obs: `Asaas - ${payment.description || 'mensalidade'}`,
        });
      }
    } else if (eventType === 'PAYMENT_OVERDUE' && payment) {
      // Não suspende automaticamente — só registra que está em atraso
      // (vencimento já passou, o painel mostra "Inadimplente" via tenantSituacao)
      // Não precisa fazer nada — proximoVencimento já está no passado
    } else if (eventType === 'SUBSCRIPTION_DELETED' && subscription) {
      const tenantId = subscription.externalReference;
      if (tenantId) {
        await atualizarFirestore(FIRESTORE, env, `tenants/${tenantId}`, {
          'asaas.subscriptionStatus': { stringValue: 'CANCELLED' },
        });
      }
    }
  } catch (err) {
    // Log mas não retorna erro pro Asaas (ele tentaria reenviar)
    console.error('Erro processando webhook:', err);
  }

  // Sempre retorna 200 pro Asaas pra ele não ficar reenviando
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function calcularProximoVencimento() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

async function atualizarFirestore(firestoreBase, env, docPath, fields) {
  // Monta updateMask
  const updateMask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const url = `${firestoreBase}/${docPath}?key=${env.FIREBASE_API_KEY}&${updateMask}`;
  await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

async function adicionarPagamentoFirestore(firestoreBase, env, tenantId, pag) {
  const url = `${firestoreBase}/tenants/${tenantId}/pagamentos?key=${env.FIREBASE_API_KEY}`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        asaasPaymentId: { stringValue: pag.asaasPaymentId },
        data: { stringValue: pag.data },
        valor: { doubleValue: pag.valor },
        metodo: { stringValue: pag.metodo },
        obs: { stringValue: pag.obs },
        registradoEm: { timestampValue: new Date().toISOString() },
        registradoPor: { stringValue: 'asaas-webhook' },
      },
    }),
  });
}

function htmlHelp(env) {
  const isSandbox = env.ASAAS_ENV === 'sandbox';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>DRG-Rently Asaas Worker</title>
<style>body{font-family:-apple-system,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1e293b;line-height:1.6;}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:0.9em;}
.ok{color:#16a34a;} .warn{color:#92400e;background:#fef3c7;padding:8px 12px;border-radius:6px;display:inline-block;}</style></head><body>
<h1>💳 DRG-Rently — Asaas Cobrança Recorrente</h1>
<p class="ok">✅ Worker rodando ${isSandbox ? '<span class="warn">⚠️ AMBIENTE SANDBOX</span>' : '<strong>em PRODUÇÃO</strong>'}.</p>
<p>Este Worker proxia cobrança recorrente pra Asaas e processa webhooks pra atualizar status dos tenants.</p>
<h2>Endpoints</h2>
<ul>
  <li><code>POST /customers</code> — cria cliente Asaas (header X-DRG-Admin-Token)</li>
  <li><code>POST /subscriptions</code> — cria assinatura recorrente</li>
  <li><code>GET /subscriptions/:id</code> — consulta status</li>
  <li><code>DELETE /subscriptions/:id</code> — cancela</li>
  <li><code>GET /subscriptions/:id/payments</code> — lista pagamentos</li>
  <li><code>POST /webhook</code> — recebe notificações do Asaas (auth: asaas-access-token)</li>
  <li><strong>Rotas TENANT</strong> (auth: header X-Tenant-Asaas-Token com chave Asaas da imobiliária):</li>
  <li><code>POST /tenant/customers</code> — cria cliente no Asaas do tenant</li>
  <li><code>POST /tenant/payments</code> — cria cobrança (boleto/PIX) pro locatário</li>
  <li><code>GET /tenant/payments/:id</code> — status da cobrança</li>
  <li><code>POST /tenant/transfers</code> — transfere PIX pro locador (repasse do líquido)</li>
  <li><code>GET /tenant/balance</code> — saldo disponível</li>
  <li><code>GET /tenant/health</code> — teste de chave Asaas válida</li>
  <li><strong>Rotas 2FA</strong> (auth: header <code>Authorization: Bearer</code> com Firebase ID token):</li>
  <li><code>POST /mfa/enroll</code> — gera segredo TOTP + QR (Google Authenticator)</li>
  <li><code>POST /mfa/confirm</code> — valida o 1º código e ativa o 2FA</li>
  <li><code>GET /mfa/status</code> — informa se o usuário tem 2FA ativo</li>
  <li><code>POST /aprovar-pagamento</code> — aprova repasse PIX ao locador (idToken + 2FA + 8 verificações)</li>
</ul>
<p style="margin-top:40px;font-size:12px;color:#64748b;">DRG-Rently · D.R. Global Multi Services</p>
</body></html>`;
}

// =============================================================
// ROTAS TENANT (imobiliária usa SUA própria chave Asaas)
// =============================================================

async function tenantCriarCustomer(request, env, origin, apiKey) {
  const payload = await request.json();
  if (!payload.name || !payload.cpfCnpj) {
    return jsonResponse({ error: 'Campos obrigatórios: name, cpfCnpj' }, 400, origin);
  }
  const body = {
    name: payload.name,
    email: payload.email,
    cpfCnpj: payload.cpfCnpj.replace(/\D/g, ''),
    phone: (payload.phone || '').replace(/\D/g, '') || undefined,
    mobilePhone: (payload.mobilePhone || payload.phone || '').replace(/\D/g, '') || undefined,
    externalReference: payload.externalReference || payload.locatarioId,
    notificationDisabled: false,
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

  const res = await asaasFetch(`${asaasBase(env)}/customers`, env, 'POST', body, apiKey);
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description || 'Erro Asaas', details: data }, res.status, origin);
  return jsonResponse({ success: true, customer: data }, 200, origin);
}

async function tenantCriarCobranca(request, env, origin, apiKey) {
  const payload = await request.json();
  // payload: { customer, value, dueDate, description, billingType, externalReference }
  if (!payload.customer || !payload.value || !payload.dueDate) {
    return jsonResponse({ error: 'Campos obrigatórios: customer, value, dueDate' }, 400, origin);
  }
  const body = {
    customer: payload.customer,
    billingType: payload.billingType || 'PIX', // PIX, BOLETO, CREDIT_CARD, UNDEFINED
    value: Number(payload.value),
    dueDate: payload.dueDate,
    description: payload.description || 'Cobrança DRG-Rently',
    externalReference: payload.externalReference || undefined,
    postalService: false,
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

  const res = await asaasFetch(`${asaasBase(env)}/payments`, env, 'POST', body, apiKey);
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description || 'Erro Asaas', details: data }, res.status, origin);
  return jsonResponse({ success: true, payment: data }, 200, origin);
}

async function tenantBuscarCobranca(paymentId, env, origin, apiKey) {
  const res = await asaasFetch(`${asaasBase(env)}/payments/${paymentId}`, env, 'GET', null, apiKey);
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description || 'Erro Asaas', details: data }, res.status, origin);
  return jsonResponse({ success: true, payment: data }, 200, origin);
}

async function tenantCriarTransferencia(request, env, origin, apiKey) {
  const payload = await request.json();
  // 2 formas: PIX (pixAddressKey + pixAddressKeyType) ou TED (bankAccount)
  if (!payload.value) {
    return jsonResponse({ error: 'Campo "value" obrigatório.' }, 400, origin);
  }
  const body = { value: Number(payload.value) };
  if (payload.pixAddressKey) {
    // Transferência PIX
    body.pixAddressKey = payload.pixAddressKey;
    body.pixAddressKeyType = payload.pixAddressKeyType || 'CPF'; // CPF, CNPJ, EMAIL, PHONE, EVP
    body.description = payload.description || 'Repasse DRG-Rently';
  } else if (payload.bankAccount) {
    // Transferência TED — bankAccount = { bank: {code}, accountName, ownerName, cpfCnpj, agency, account, accountDigit, bankAccountType }
    body.bankAccount = payload.bankAccount;
  } else {
    return jsonResponse({ error: 'Forneça pixAddressKey ou bankAccount.' }, 400, origin);
  }

  const res = await asaasFetch(`${asaasBase(env)}/transfers`, env, 'POST', body, apiKey);
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description || 'Erro Asaas', details: data }, res.status, origin);
  return jsonResponse({ success: true, transfer: data }, 200, origin);
}

async function tenantConsultarSaldo(env, origin, apiKey) {
  const res = await asaasFetch(`${asaasBase(env)}/finance/balance`, env, 'GET', null, apiKey);
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description || 'Erro Asaas', details: data }, res.status, origin);
  return jsonResponse({ success: true, balance: data }, 200, origin);
}

async function tenantHealth(env, origin, apiKey) {
  // Faz uma chamada simples ao /myAccount pra validar a chave
  const res = await asaasFetch(`${asaasBase(env)}/myAccount`, env, 'GET', null, apiKey);
  if (!res.ok) {
    return jsonResponse({ ok: false, error: 'Chave Asaas inválida ou sem permissão.', status: res.status }, 200, origin);
  }
  const data = await res.json();
  return jsonResponse({
    ok: true,
    ambiente: env.ASAAS_ENV || 'production',
    account: {
      name: data.name,
      email: data.email,
      cpfCnpj: data.cpfCnpj,
      walletId: data.walletId,
    },
  }, 200, origin);
}
