// =============================================================
// DRG-Rently — Cloudflare Worker proxy para ZapSign API
//
// Recebe requisições do app (com token do tenant) e proxia pra ZapSign.
// Não armazena token aqui — o app envia o token do tenant em cada
// request (vindo de tenants/{id}/config/site.zapsignToken).
//
// Endpoints:
//   POST /docs              → cria documento + signatários
//   GET  /docs/:openId      → consulta status
//   GET  /docs/:openId/pdf  → baixa PDF assinado (após 100% assinado)
//
// =============================================================
//
// COMO INSTALAR:
// 1. Acesse https://dash.cloudflare.com → Workers & Pages
// 2. Create Application → nome: "drg-rently-zapsign"
// 3. Edit code → cole todo este arquivo
// 4. Save and Deploy
// 5. Em Configurações do app, cole a URL do Worker
// 6. Cada tenant cadastra seu próprio token ZapSign em
//    Configurações → Assinatura Eletrônica
//
// =============================================================

const ZAPSIGN_BASE = 'https://api.zapsign.com.br/api/v1';

const ALLOWED_ORIGINS = [
  'https://zett-romao.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-ZapSign-Token',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return jsonResponse({ error: 'Origin not allowed' }, 403, origin);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Token do tenant vem no header (cada tenant tem o próprio)
    const tenantToken = request.headers.get('X-ZapSign-Token');
    if (!tenantToken) {
      return jsonResponse({ error: 'Token ZapSign do tenant não enviado (X-ZapSign-Token)' }, 401, origin);
    }

    try {
      // POST /docs → criar documento
      if (request.method === 'POST' && path === '/docs') {
        const payload = await request.json();
        return await criarDocumento(payload, tenantToken, origin);
      }

      // GET /docs/:openId → status
      const matchStatus = path.match(/^\/docs\/([^\/]+)$/);
      if (request.method === 'GET' && matchStatus) {
        return await consultarDocumento(matchStatus[1], tenantToken, origin);
      }

      // GET /docs/:openId/pdf → baixa PDF assinado
      const matchPdf = path.match(/^\/docs\/([^\/]+)\/pdf$/);
      if (request.method === 'GET' && matchPdf) {
        return await baixarPdfAssinado(matchPdf[1], tenantToken, origin);
      }

      // Help page
      if (path === '/' || path === '') {
        return new Response(htmlHelp(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      return jsonResponse({ error: 'Endpoint não encontrado: ' + path }, 404, origin);
    } catch (err) {
      return jsonResponse({ error: 'Erro interno: ' + err.message }, 500, origin);
    }
  },
};

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });
}

async function criarDocumento(payload, tenantToken, origin) {
  // payload esperado do app:
  // {
  //   name: "Contrato locação - Apto 301",
  //   pdfBase64: "...",   // ou pdfUrl
  //   signers: [
  //     { name: "João Locador", email: "joao@x.com" },
  //     { name: "Maria Locatária", email: "maria@x.com" },
  //   ],
  //   message: "Por favor, assine o contrato"
  // }

  if (!payload.name) return jsonResponse({ error: 'Campo "name" obrigatório' }, 400, origin);
  if (!payload.pdfBase64 && !payload.pdfUrl) {
    return jsonResponse({ error: 'Envie pdfBase64 ou pdfUrl' }, 400, origin);
  }
  if (!Array.isArray(payload.signers) || payload.signers.length === 0) {
    return jsonResponse({ error: 'Lista de signatários (signers) vazia' }, 400, origin);
  }

  // Validações dos signatários
  for (const s of payload.signers) {
    if (!s.name || !s.email) {
      return jsonResponse({ error: 'Cada signatário precisa de "name" e "email"' }, 400, origin);
    }
  }

  // ZapSign API: criar doc
  // Docs: https://docs.zapsign.com.br/documentos/criar-documento-via-upload-pdf-base64
  const zapsignBody = {
    name: payload.name,
    base64_pdf: payload.pdfBase64,
    url_pdf: payload.pdfUrl,
    signers: payload.signers.map(s => ({
      name: s.name,
      email: s.email,
      cpf: s.cpf || undefined,
      send_automatic_email: true,
      auth_mode: 'assinaturaTela', // ou 'certificado' / 'whatsapp'
    })),
    lang: 'pt-br',
    disable_signer_emails: false,
    brand_logo: payload.brandLogo || undefined,
    brand_primary_color: payload.brandColor || '#475569',
    folder_path: '/DRG-Rently/',
    external_id: payload.externalId || undefined, // ID do contrato no DRG (rastreabilidade)
  };

  // Remove campos undefined (ZapSign não aceita)
  Object.keys(zapsignBody).forEach(k => zapsignBody[k] === undefined && delete zapsignBody[k]);
  if (zapsignBody.url_pdf && zapsignBody.base64_pdf) delete zapsignBody.base64_pdf;

  const res = await fetch(`${ZAPSIGN_BASE}/docs/?api_token=${tenantToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(zapsignBody),
  });

  const data = await res.json();
  if (!res.ok) {
    return jsonResponse({ error: data.error || data.message || 'Falha no ZapSign', details: data }, res.status, origin);
  }

  // Retorna os campos mais importantes
  return jsonResponse({
    success: true,
    openId: data.open_id,
    token: data.token,
    name: data.name,
    status: data.status,
    signers: (data.signers || []).map(s => ({
      token: s.token,
      name: s.name,
      email: s.email,
      status: s.status,
      sign_url: s.sign_url,
    })),
    createdAt: data.created_at,
    originalFileUrl: data.original_file,
  }, 200, origin);
}

async function consultarDocumento(openId, tenantToken, origin) {
  const res = await fetch(`${ZAPSIGN_BASE}/docs/${openId}/?api_token=${tenantToken}`, {
    method: 'GET',
  });
  const data = await res.json();
  if (!res.ok) {
    return jsonResponse({ error: data.error || data.message || 'Falha no ZapSign', details: data }, res.status, origin);
  }
  return jsonResponse({
    success: true,
    openId: data.open_id,
    token: data.token,
    name: data.name,
    status: data.status,         // 'pending' | 'signed' | 'refused' | 'expired'
    signers: (data.signers || []).map(s => ({
      token: s.token,
      name: s.name,
      email: s.email,
      status: s.status,         // 'new' | 'pending' | 'signed' | 'refused'
      sign_url: s.sign_url,
      times_viewed: s.times_viewed,
      last_view_at: s.last_view_at,
      signed_at: s.signed_at,
    })),
    signedFileUrl: data.signed_file || null,
    createdAt: data.created_at,
  }, 200, origin);
}

async function baixarPdfAssinado(openId, tenantToken, origin) {
  // Primeiro busca o doc pra pegar a URL do signed_file
  const res = await fetch(`${ZAPSIGN_BASE}/docs/${openId}/?api_token=${tenantToken}`, {
    method: 'GET',
  });
  const data = await res.json();
  if (!res.ok) {
    return jsonResponse({ error: data.error || 'Doc não encontrado', details: data }, res.status, origin);
  }
  const signedUrl = data.signed_file;
  if (!signedUrl) {
    return jsonResponse({ error: 'Documento ainda não foi 100% assinado.' }, 400, origin);
  }
  // Retorna a URL pro app baixar diretamente (mais leve que proxiar o arquivo)
  return jsonResponse({
    success: true,
    signedFileUrl: signedUrl,
    name: data.name,
    status: data.status,
  }, 200, origin);
}

function htmlHelp() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>DRG-Rently ZapSign Worker</title>
<style>body{font-family:-apple-system,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1e293b;line-height:1.6;}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:0.9em;}
.ok{color:#16a34a;}</style></head><body>
<h1>✍️ DRG-Rently — ZapSign Proxy</h1>
<p class="ok">✅ Worker rodando.</p>
<p>Este endpoint proxia chamadas pro ZapSign API usando o token de cada tenant.</p>
<h2>Endpoints</h2>
<ul>
  <li><code>POST /docs</code> + Header <code>X-ZapSign-Token</code> → criar documento</li>
  <li><code>GET /docs/:openId</code> + Header → consultar status</li>
  <li><code>GET /docs/:openId/pdf</code> + Header → baixar PDF assinado</li>
</ul>
<p style="margin-top:40px;font-size:12px;color:#64748b;">DRG-Rently · D.R. Global Multi Services</p>
</body></html>`;
}
