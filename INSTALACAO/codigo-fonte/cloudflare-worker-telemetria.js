// =============================================================
// DRG-Rently — Telemetria Worker (Modelo C / Self-hosted)
// =============================================================
//
// Recebe pings das instâncias self-hosted (clientes que compraram
// o "pendrive") e grava no Firestore CENTRAL do drg-rently pra que
// o Super Admin possa monitorar.
//
// Dados coletados (METADADOS, nada de pessoal):
//   - projectId (Firebase do cliente)
//   - tenantId (qual imobiliária)
//   - nome da empresa (público — sai em NF)
//   - CNPJ (público)
//   - quantidade de imóveis
//   - quantidade de usuários
//   - versão do app
//   - timestamp do ping
//
// NÃO COLETA:
//   ❌ Nomes de pessoas, CPF
//   ❌ Endereços, fotos, documentos
//   ❌ Valores, contratos, balancetes
//   ❌ Qualquer dado pessoal LGPD
//
// Cliente pode desabilitar com flag `window.DISABLE_TELEMETRY = true`
// em firebase-config.js
//
// =============================================================
//
// Configuração no Cloudflare Worker:
//   Variables:
//     PROJECT_ID = drg-rently (Firestore central onde grava os pings)
//   Secrets:
//     FIREBASE_API_KEY = a mesma do firebase-config.js do drg-rently
//
// =============================================================

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Use POST' }),
        { status: 405, headers: corsHeaders() }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return new Response(
        JSON.stringify({ error: 'JSON inválido' }),
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!body.projectId || !body.tenantId) {
      return new Response(
        JSON.stringify({ error: 'projectId e tenantId obrigatórios' }),
        { status: 400, headers: corsHeaders() }
      );
    }

    // Não conta o próprio SaaS principal (drg-rently) como self-hosted
    if (body.projectId === (env.PROJECT_ID || 'drg-rently')) {
      return new Response(
        JSON.stringify({ ok: true, skipped: 'main_saas' }),
        { status: 200, headers: corsHeaders() }
      );
    }

    try {
      const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${env.PROJECT_ID || 'drg-rently'}/databases/(default)/documents`;
      const API_KEY = env.FIREBASE_API_KEY;

      // ID único da instalação (SHA-256 do projectId + tenantId)
      const installId = await hashSHA256(`${body.projectId}__${body.tenantId}`);
      const docUrl = `${FIRESTORE}/instalacoesSelfHosted/${installId}?key=${API_KEY}`;

      // Verifica se já existe
      const checkRes = await fetch(docUrl);
      const existed = checkRes.ok;

      // Campos pra gravar (formato Firestore REST)
      const now = new Date().toISOString();
      const fields = {
        projectId: { stringValue: String(body.projectId) },
        tenantId: { stringValue: String(body.tenantId) },
        nome: { stringValue: String(body.nome || '—') },
        cnpj: { stringValue: String(body.cnpj || '') },
        imoveisCount: { integerValue: String(body.imoveisCount || 0) },
        usuariosCount: { integerValue: String(body.usuariosCount || 0) },
        versaoApp: { stringValue: String(body.versao || '') },
        ultimoPing: { timestampValue: now },
      };

      if (!existed) {
        fields.primeiroPing = { timestampValue: now };
      }

      // PATCH (cria se não existe, atualiza se existe)
      const patchRes = await fetch(docUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });

      if (!patchRes.ok) {
        const errText = await patchRes.text();
        return new Response(
          JSON.stringify({ error: 'Falha gravando: ' + errText }),
          { status: 500, headers: corsHeaders() }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, installId, novo: !existed }),
        { status: 200, headers: corsHeaders() }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Erro interno: ' + err.message }),
        { status: 500, headers: corsHeaders() }
      );
    }
  },
};

function corsHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function hashSHA256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
