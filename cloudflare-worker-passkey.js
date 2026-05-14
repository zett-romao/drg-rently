// =============================================================
// DRG-Rently — Worker Passkey (WebAuthn)
//
// Endpoints:
//   POST /register/begin         {uid, email, displayName}
//     → retorna PublicKeyCredentialCreationOptions
//   POST /register/complete      {uid, attestationResponse}
//     → valida e salva credential, retorna {ok:true}
//   POST /login/begin            {email?}  // email opcional (discoverable login)
//     → retorna PublicKeyCredentialRequestOptions
//   POST /login/complete         {assertionResponse}
//     → valida e retorna {customToken} pro Firebase signInWithCustomToken
//   GET  /credentials/list       {uid}
//     → lista as passkeys cadastradas do user (pra UI de gerenciamento)
//   DELETE /credentials/:credId  {uid}
//     → remove uma passkey específica
//
// Setup manual no Cloudflare:
//   1. Criar KV namespace "PASSKEYS_KV" e atualizar wrangler-passkey.toml
//   2. Adicionar Secret FIREBASE_SERVICE_ACCOUNT_JSON
//      (cole o JSON COMPLETO de uma service account com role "Firebase Auth Admin")
//   3. Adicionar Variables (não-secret):
//      - RP_ID = "zett-romao.github.io"   (sem protocolo)
//      - RP_NAME = "DRG-Rently"
//      - ORIGIN = "https://zett-romao.github.io"   (com protocolo, sem path)
// =============================================================

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

// -----------------------------------------------------------------------------
// Helpers CORS / response
// -----------------------------------------------------------------------------
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
  });
}

function err(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

// -----------------------------------------------------------------------------
// Base64URL helpers
// -----------------------------------------------------------------------------
function bufToBase64Url(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuf(b64u) {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// -----------------------------------------------------------------------------
// KV helpers (chaves por uid + credId)
// -----------------------------------------------------------------------------
const CHALLENGE_TTL = 300; // 5 min
const challengeKey = (purpose, id) => `chal:${purpose}:${id}`;
const credentialKey = (uid, credId) => `cred:${uid}:${credId}`;
const credentialIndexKey = (uid) => `idx:${uid}`; // lista de credIds do user

async function saveCredential(env, uid, credential) {
  // credential = { id (base64url), publicKey (base64url), counter, transports, deviceType, backedUp, createdAt }
  await env.PASSKEYS_KV.put(credentialKey(uid, credential.id), JSON.stringify(credential));
  // Index pra listar/login discoverable
  const idxRaw = await env.PASSKEYS_KV.get(credentialIndexKey(uid));
  const idx = idxRaw ? JSON.parse(idxRaw) : [];
  if (!idx.includes(credential.id)) idx.push(credential.id);
  await env.PASSKEYS_KV.put(credentialIndexKey(uid), JSON.stringify(idx));
  // Index global credId → uid (pra discoverable login)
  await env.PASSKEYS_KV.put(`uid:${credential.id}`, uid);
}

async function listCredentials(env, uid) {
  const idxRaw = await env.PASSKEYS_KV.get(credentialIndexKey(uid));
  if (!idxRaw) return [];
  const ids = JSON.parse(idxRaw);
  const creds = [];
  for (const id of ids) {
    const raw = await env.PASSKEYS_KV.get(credentialKey(uid, id));
    if (raw) creds.push(JSON.parse(raw));
  }
  return creds;
}

async function getCredentialByCredId(env, credId) {
  const uid = await env.PASSKEYS_KV.get(`uid:${credId}`);
  if (!uid) return null;
  const raw = await env.PASSKEYS_KV.get(credentialKey(uid, credId));
  if (!raw) return null;
  return { uid, credential: JSON.parse(raw) };
}

async function deleteCredential(env, uid, credId) {
  await env.PASSKEYS_KV.delete(credentialKey(uid, credId));
  await env.PASSKEYS_KV.delete(`uid:${credId}`);
  const idxRaw = await env.PASSKEYS_KV.get(credentialIndexKey(uid));
  if (idxRaw) {
    const idx = JSON.parse(idxRaw).filter(id => id !== credId);
    await env.PASSKEYS_KV.put(credentialIndexKey(uid), JSON.stringify(idx));
  }
}

// -----------------------------------------------------------------------------
// Firebase Custom Token (assina JWT RS256 com service account)
// -----------------------------------------------------------------------------
async function createFirebaseCustomToken(env, uid) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error('Service account não configurado no Worker (FIREBASE_SERVICE_ACCOUNT_JSON).');
  }
  let sa;
  try {
    sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch (_) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON inválido (não é JSON).');
  }
  const { client_email, private_key } = sa;
  if (!client_email || !private_key) throw new Error('Service account incompleto.');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: client_email,
    sub: client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
  };

  const encB64Url = (obj) => bufToBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
  const headerB64 = encB64Url(header);
  const payloadB64 = encB64Url(payload);
  const unsigned = `${headerB64}.${payloadB64}`;

  // Importa PEM RSA pra Web Crypto API
  const pem = private_key.replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const pkcs8 = base64UrlToBuf(pem.replace(/\+/g, '-').replace(/\//g, '_'));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const sigB64 = bufToBase64Url(sig);
  return `${unsigned}.${sigB64}`;
}

// -----------------------------------------------------------------------------
// Handlers
// -----------------------------------------------------------------------------
async function handleRegisterBegin(req, env) {
  const body = await req.json();
  const { uid, email, displayName } = body || {};
  if (!uid || !email) return err('uid e email são obrigatórios.');

  const existing = await listCredentials(env, uid);
  const options = await generateRegistrationOptions({
    rpName: env.RP_NAME || 'DRG-Rently',
    rpID: env.RP_ID,
    userID: new TextEncoder().encode(uid),
    userName: email,
    userDisplayName: displayName || email,
    attestationType: 'none',
    excludeCredentials: existing.map(c => ({ id: c.id, type: 'public-key', transports: c.transports })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform', // prioriza biometria do dispositivo (Windows Hello, TouchID etc)
    },
  });

  await env.PASSKEYS_KV.put(challengeKey('register', uid), options.challenge, { expirationTtl: CHALLENGE_TTL });
  return json({ ok: true, options });
}

async function handleRegisterComplete(req, env) {
  const body = await req.json();
  const { uid, attestationResponse } = body || {};
  if (!uid || !attestationResponse) return err('uid e attestationResponse são obrigatórios.');

  const expectedChallenge = await env.PASSKEYS_KV.get(challengeKey('register', uid));
  if (!expectedChallenge) return err('Challenge expirou. Tente cadastrar novamente.', 400);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      requireUserVerification: false,
    });
  } catch (e) {
    return err(`Falha ao validar attestation: ${e.message}`, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return err('Attestation inválido.', 400);
  }

  const reg = verification.registrationInfo;
  // Em @simplewebauthn/server v11+, os campos vêm com nomes ligeiramente diferentes
  const credInfo = reg.credential || reg;
  const credIdBytes = credInfo.id || credInfo.credentialID;
  const publicKeyBytes = credInfo.publicKey || credInfo.credentialPublicKey;

  const credentialToSave = {
    id: typeof credIdBytes === 'string' ? credIdBytes : bufToBase64Url(credIdBytes),
    publicKey: bufToBase64Url(publicKeyBytes),
    counter: credInfo.counter || 0,
    transports: attestationResponse.response.transports || [],
    deviceType: reg.credentialDeviceType || 'singleDevice',
    backedUp: reg.credentialBackedUp || false,
    createdAt: Date.now(),
  };

  await saveCredential(env, uid, credentialToSave);
  await env.PASSKEYS_KV.delete(challengeKey('register', uid));
  return json({ ok: true, credentialId: credentialToSave.id });
}

async function handleLoginBegin(req, env) {
  const body = await req.json().catch(() => ({}));
  // Discoverable login: não exige uid. Mas se vier, listamos as creds dele.
  const { uid } = body || {};
  let allowCredentials;
  if (uid) {
    const creds = await listCredentials(env, uid);
    allowCredentials = creds.map(c => ({ id: c.id, type: 'public-key', transports: c.transports }));
  }
  const options = await generateAuthenticationOptions({
    rpID: env.RP_ID,
    allowCredentials,
    userVerification: 'preferred',
  });

  const sessionId = crypto.randomUUID();
  await env.PASSKEYS_KV.put(challengeKey('login', sessionId), options.challenge, { expirationTtl: CHALLENGE_TTL });
  return json({ ok: true, options, sessionId });
}

async function handleLoginComplete(req, env) {
  const body = await req.json();
  const { sessionId, assertionResponse } = body || {};
  if (!sessionId || !assertionResponse) return err('sessionId e assertionResponse são obrigatórios.');

  const expectedChallenge = await env.PASSKEYS_KV.get(challengeKey('login', sessionId));
  if (!expectedChallenge) return err('Challenge expirou. Tente novamente.', 400);

  const credId = assertionResponse.id;
  const found = await getCredentialByCredId(env, credId);
  if (!found) return err('Passkey não cadastrada neste sistema.', 404);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      credential: {
        id: found.credential.id,
        publicKey: base64UrlToBuf(found.credential.publicKey),
        counter: found.credential.counter,
        transports: found.credential.transports,
      },
      requireUserVerification: false,
    });
  } catch (e) {
    return err(`Falha ao validar assinatura: ${e.message}`, 400);
  }

  if (!verification.verified) return err('Assinatura inválida.', 401);

  // Atualiza counter (anti-replay)
  found.credential.counter = verification.authenticationInfo.newCounter;
  await env.PASSKEYS_KV.put(credentialKey(found.uid, found.credential.id), JSON.stringify(found.credential));
  await env.PASSKEYS_KV.delete(challengeKey('login', sessionId));

  // Gera custom token Firebase
  let customToken;
  try {
    customToken = await createFirebaseCustomToken(env, found.uid);
  } catch (e) {
    return err(`Falha ao gerar token Firebase: ${e.message}`, 500);
  }

  return json({ ok: true, uid: found.uid, customToken });
}

async function handleListCredentials(req, env) {
  const url = new URL(req.url);
  const uid = url.searchParams.get('uid');
  if (!uid) return err('uid é obrigatório.', 400);
  const creds = await listCredentials(env, uid);
  // Não expõe a publicKey, só metadata
  return json({
    ok: true,
    credentials: creds.map(c => ({
      id: c.id,
      createdAt: c.createdAt,
      deviceType: c.deviceType,
      backedUp: c.backedUp,
      transports: c.transports,
    })),
  });
}

async function handleDeleteCredential(req, env, credId) {
  const body = await req.json().catch(() => ({}));
  const uid = body.uid;
  if (!uid) return err('uid é obrigatório no body.', 400);
  await deleteCredential(env, uid, credId);
  return json({ ok: true });
}

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === 'POST' && path === '/register/begin') return await handleRegisterBegin(request, env);
      if (request.method === 'POST' && path === '/register/complete') return await handleRegisterComplete(request, env);
      if (request.method === 'POST' && path === '/login/begin') return await handleLoginBegin(request, env);
      if (request.method === 'POST' && path === '/login/complete') return await handleLoginComplete(request, env);
      if (request.method === 'GET' && path === '/credentials/list') return await handleListCredentials(request, env);
      if (request.method === 'DELETE' && path.startsWith('/credentials/')) {
        const credId = decodeURIComponent(path.slice('/credentials/'.length));
        return await handleDeleteCredential(request, env, credId);
      }
      if (request.method === 'GET' && path === '/health') {
        return json({
          ok: true,
          rpId: env.RP_ID || '(não configurado)',
          origin: env.ORIGIN || '(não configurado)',
          hasServiceAccount: !!env.FIREBASE_SERVICE_ACCOUNT_JSON,
        });
      }
      return err('Rota não encontrada.', 404);
    } catch (e) {
      console.error('Erro no Worker passkey:', e);
      return err(`Erro interno: ${e.message}`, 500);
    }
  },
};
