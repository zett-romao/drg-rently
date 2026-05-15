// =============================================================
// DRG-Rently — Cloudflare Worker proxy para Bureaus de Crédito
//
// Endpoints:
//   POST /quod/score-imobiliaria   → Quod Score Imobiliária
//   POST /idwall/background-check  → Idwall Background Check
//
// Credenciais vêm em headers (cada tenant tem as próprias):
//   X-Quod-Client-Id     + X-Quod-Client-Secret  (+ X-Quod-Ambiente)
//   X-Idwall-Token
//   X-Mock-Mode: true → força resposta fake (mesmo com credencial)
//
// Modo mock também é ativado automaticamente se a credencial vier
// vazia, com prefixo "mock_" ou exatamente "MOCK".
//
// =============================================================
//
// COMO INSTALAR:
// 1. Acesse https://dash.cloudflare.com → Workers & Pages
// 2. Create Application → nome: "drg-rently-bureaus"
// 3. Edit code → cole todo este arquivo
// 4. Save and Deploy
// 5. Em Configurações do app, cole a URL do Worker
// 6. Cada tenant cadastra suas credenciais Quod e/ou Idwall em
//    Configurações → Pesquisa de Crédito
//
// =============================================================

// --- Endpoints reais (ajuste quando tiver os definitivos do provedor) ---
const QUOD_OAUTH_URL = {
  sandbox: 'https://api-sandbox.quod.com.br/oauth/token',
  producao: 'https://api.quod.com.br/oauth/token',
};
const QUOD_SCORE_IMOB_URL = {
  sandbox: 'https://api-sandbox.quod.com.br/v1/score-imobiliaria',
  producao: 'https://api.quod.com.br/v1/score-imobiliaria',
};
const IDWALL_BGCHECK_URL = 'https://api-v3.idwall.co/relatorios';

const ALLOWED_ORIGINS = [
  'https://zett-romao.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, X-Quod-Client-Id, X-Quod-Client-Secret, X-Quod-Ambiente, X-Idwall-Token, X-Mock-Mode',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });
}

function isMockCred(value) {
  if (!value) return true;
  const v = String(value).trim().toLowerCase();
  return v === '' || v === 'mock' || v.startsWith('mock_');
}

function cleanCpf(s) {
  return String(s || '').replace(/\D/g, '');
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

    try {
      if (request.method === 'POST' && path === '/quod/score-imobiliaria') {
        return await handleQuod(request, origin);
      }
      if (request.method === 'POST' && path === '/idwall/background-check') {
        return await handleIdwall(request, origin);
      }
      if (path === '/' || path === '') {
        return new Response(htmlHelp(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return jsonResponse({ error: 'Endpoint não encontrado: ' + path }, 404, origin);
    } catch (err) {
      return jsonResponse({ error: 'Erro interno: ' + err.message }, 500, origin);
    }
  },
};

// =============================================================
// QUOD — Score Imobiliária
// =============================================================

async function handleQuod(request, origin) {
  const body = await request.json().catch(() => ({}));
  const cpf = cleanCpf(body.cpf);
  if (!cpf || cpf.length !== 11) {
    return jsonResponse({ error: 'CPF inválido (precisa de 11 dígitos)' }, 400, origin);
  }

  const clientId = request.headers.get('X-Quod-Client-Id') || '';
  const clientSecret = request.headers.get('X-Quod-Client-Secret') || '';
  const ambiente = (request.headers.get('X-Quod-Ambiente') || 'sandbox').toLowerCase();
  const forceMock = (request.headers.get('X-Mock-Mode') || '').toLowerCase() === 'true';

  const useMock = forceMock || isMockCred(clientId) || isMockCred(clientSecret);

  if (useMock) {
    return jsonResponse(mockQuodScore(cpf, body.nome), 200, origin);
  }

  // OAuth2 client credentials
  const oauthUrl = QUOD_OAUTH_URL[ambiente] || QUOD_OAUTH_URL.sandbox;
  const tokenRes = await fetch(oauthUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    const errTxt = await tokenRes.text();
    return jsonResponse(
      { error: 'Falha na autenticação Quod', detalhe: errTxt.slice(0, 500), status: tokenRes.status },
      tokenRes.status, origin
    );
  }

  const tokenJson = await tokenRes.json();
  const accessToken = tokenJson.access_token;
  if (!accessToken) {
    return jsonResponse({ error: 'Quod não retornou access_token', detalhe: tokenJson }, 502, origin);
  }

  const scoreUrl = QUOD_SCORE_IMOB_URL[ambiente] || QUOD_SCORE_IMOB_URL.sandbox;
  const scoreRes = await fetch(scoreUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      cpf,
      nome: body.nome || undefined,
      dataNascimento: body.dataNascimento || undefined,
    }),
  });

  const scoreData = await scoreRes.json().catch(() => ({}));
  if (!scoreRes.ok) {
    return jsonResponse(
      { error: 'Falha na consulta Quod', detalhe: scoreData, status: scoreRes.status },
      scoreRes.status, origin
    );
  }

  return jsonResponse({
    success: true,
    modoMock: false,
    provider: 'quod',
    parsed: parseQuod(scoreData),
    cru: scoreData,
  }, 200, origin);
}

function parseQuod(data) {
  // Formato esperado do payload Quod (best-effort — ajustar quando tiver doc oficial).
  // Campos comuns: score (0–1000), faixa, recomendacao, restricoes[], rendaPresumida.
  const score = data.score ?? data.scoreImobiliaria ?? data.scoreValue ?? null;
  const faixa = data.faixa || data.faixaRisco || data.classificacao || null;
  const recomendacao = data.recomendacao || data.recomendacaoLocacao || null;
  const restricoes = data.restricoes || data.negativacoes || [];
  return {
    score,
    faixa,
    recomendacao,
    rendaPresumida: data.rendaPresumida || data.rendaEstimada || null,
    restricoes: Array.isArray(restricoes) ? restricoes : [],
    consultadoEm: new Date().toISOString(),
  };
}

function mockQuodScore(cpf, nome) {
  // Score determinístico baseado nos últimos dígitos do CPF — pra reprodutibilidade
  const seed = parseInt(cpf.slice(-4), 10) || 100;
  const score = 200 + ((seed * 7919) % 750); // 200..949
  let faixa, recomendacao;
  if (score < 400) { faixa = 'Alto Risco'; recomendacao = 'Negar locação ou exigir garantia reforçada'; }
  else if (score < 600) { faixa = 'Risco Moderado'; recomendacao = 'Avaliar com fiador ou seguro fiança'; }
  else if (score < 800) { faixa = 'Bom'; recomendacao = 'Aprovação condicionada à análise complementar'; }
  else { faixa = 'Excelente'; recomendacao = 'Aprovação recomendada'; }

  const hasRestricoes = score < 500;
  return {
    success: true,
    modoMock: true,
    provider: 'quod',
    parsed: {
      score,
      faixa,
      recomendacao,
      rendaPresumida: 3500 + ((seed * 13) % 8500),
      restricoes: hasRestricoes ? [
        { tipo: 'protesto', origem: 'Cartório 5º Ofício - SP', valor: 1850.0, data: '2025-08-12' },
        { tipo: 'pendencia_financeira', origem: 'Banco fictício', valor: 4200.0, data: '2025-11-03' },
      ] : [],
      consultadoEm: new Date().toISOString(),
    },
    cru: {
      _MOCK: true,
      mensagem: 'Resposta gerada localmente para testes. Não representa dados reais.',
      cpfConsultado: cpf,
      nomeConsultado: nome || null,
    },
  };
}

// =============================================================
// IDWALL — Background Check
// =============================================================

async function handleIdwall(request, origin) {
  const body = await request.json().catch(() => ({}));
  const cpf = cleanCpf(body.cpf);
  if (!cpf || cpf.length !== 11) {
    return jsonResponse({ error: 'CPF inválido (precisa de 11 dígitos)' }, 400, origin);
  }

  const token = request.headers.get('X-Idwall-Token') || '';
  const forceMock = (request.headers.get('X-Mock-Mode') || '').toLowerCase() === 'true';

  const useMock = forceMock || isMockCred(token);

  if (useMock) {
    return jsonResponse(mockIdwallBgCheck(cpf, body.nome), 200, origin);
  }

  // Idwall Trust v3 — cria relatório (Background Check completo)
  const idwallBody = {
    profileTemplateId: body.profileTemplateId || 'background-check-completo',
    profileData: {
      cpf,
      nome: body.nome || undefined,
      dataNascimento: body.dataNascimento || undefined,
    },
  };

  const res = await fetch(IDWALL_BGCHECK_URL, {
    method: 'POST',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(idwallBody),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return jsonResponse(
      { error: 'Falha na consulta Idwall', detalhe: data, status: res.status },
      res.status, origin
    );
  }

  return jsonResponse({
    success: true,
    modoMock: false,
    provider: 'idwall',
    parsed: parseIdwall(data),
    cru: data,
  }, 200, origin);
}

function parseIdwall(data) {
  // Formato Idwall Trust v3 (best-effort)
  const result = data.result || data;
  const sources = result.sources || result.fontes || {};
  const processos = sources.processos || sources.processosJudiciais || [];
  const restritivas = sources.listasRestritivas || sources.restrictiveLists || [];
  const midia = sources.midiaAdversa || sources.adverseMedia || [];
  const pep = sources.pep || sources.pessoasExpostas || null;

  const numProcessos = Array.isArray(processos) ? processos.length : (processos.total || 0);
  const numRestritivas = Array.isArray(restritivas) ? restritivas.length : (restritivas.total || 0);
  const numMidia = Array.isArray(midia) ? midia.length : (midia.total || 0);
  const isPep = pep && (pep.encontrado || pep.found || pep.isPEP);

  let risco;
  if (numRestritivas > 0 || isPep) risco = 'alto';
  else if (numProcessos > 0 || numMidia > 0) risco = 'medio';
  else risco = 'baixo';

  return {
    risco,
    numProcessos,
    numRestritivas,
    numMidiaAdversa: numMidia,
    isPEP: !!isPep,
    processos: Array.isArray(processos) ? processos.slice(0, 10) : [],
    listasRestritivas: Array.isArray(restritivas) ? restritivas.slice(0, 10) : [],
    midiaAdversa: Array.isArray(midia) ? midia.slice(0, 10) : [],
    consultadoEm: new Date().toISOString(),
  };
}

function mockIdwallBgCheck(cpf, nome) {
  const seed = parseInt(cpf.slice(-4), 10) || 100;
  const hasIssues = seed % 3 !== 0;
  const numProcessos = hasIssues ? (seed % 4) : 0;
  const numRestritivas = (seed % 7 === 0) ? 1 : 0;
  const isPEP = (seed % 23 === 0);

  let risco;
  if (numRestritivas > 0 || isPEP) risco = 'alto';
  else if (numProcessos > 0) risco = 'medio';
  else risco = 'baixo';

  const processos = [];
  for (let i = 0; i < numProcessos; i++) {
    processos.push({
      numero: `${(1000000 + seed + i)}-${(seed + i) % 99}.2025.8.26.0100`,
      tribunal: 'TJSP',
      classe: i === 0 ? 'Execução de título extrajudicial' : 'Cobrança',
      assunto: 'Locação de imóvel urbano',
      polo: 'passivo',
      dataDistribuicao: '2024-0' + ((seed + i) % 9 + 1) + '-15',
      situacao: 'em andamento',
    });
  }

  return {
    success: true,
    modoMock: true,
    provider: 'idwall',
    parsed: {
      risco,
      numProcessos,
      numRestritivas,
      numMidiaAdversa: 0,
      isPEP,
      processos,
      listasRestritivas: numRestritivas > 0 ? [
        { lista: 'CCF - Cadastro de Cheques sem Fundo', desde: '2024-11-02', origem: 'Banco Central' },
      ] : [],
      midiaAdversa: [],
      consultadoEm: new Date().toISOString(),
    },
    cru: {
      _MOCK: true,
      mensagem: 'Resposta gerada localmente para testes. Não representa dados reais.',
      cpfConsultado: cpf,
      nomeConsultado: nome || null,
    },
  };
}

// =============================================================
// Página de ajuda (GET /)
// =============================================================

function htmlHelp() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>DRG-Rently Bureaus Worker</title>
<style>body{font-family:-apple-system,sans-serif;max-width:780px;margin:40px auto;padding:0 20px;color:#1e293b;line-height:1.6;}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:0.9em;}
.ok{color:#16a34a;} h2{margin-top:32px;}</style></head><body>
<h1>🔍 DRG-Rently — Bureaus de Crédito</h1>
<p class="ok">✅ Worker rodando.</p>
<p>Proxy stateless para Quod (Score Imobiliária) e Idwall (Background Check).
Credenciais vêm em headers — cada tenant traz as suas.</p>

<h2>Endpoints</h2>
<ul>
  <li><code>POST /quod/score-imobiliaria</code> — body: <code>{ cpf, nome?, dataNascimento? }</code><br>
      Headers: <code>X-Quod-Client-Id</code>, <code>X-Quod-Client-Secret</code>, <code>X-Quod-Ambiente</code> (sandbox|producao)</li>
  <li><code>POST /idwall/background-check</code> — body: <code>{ cpf, nome?, dataNascimento? }</code><br>
      Headers: <code>X-Idwall-Token</code></li>
</ul>

<h2>Modo Mock</h2>
<p>Ativado automaticamente quando a credencial vem vazia, igual a <code>mock</code> ou começa com <code>mock_</code>.
Também pode ser forçado com header <code>X-Mock-Mode: true</code>.<br>
Resposta mock é determinística baseada nos últimos 4 dígitos do CPF — permite repetir testes.</p>

<p style="margin-top:40px;font-size:12px;color:#64748b;">DRG-Rently · D.R. Global Multi Services</p>
</body></html>`;
}
