// =============================================================
// DRG-Rently — Monitor legislativo (Lei do Inquilinato + Código Civil)
//
// Cron diário (7h Brasília / 10h UTC). Para cada URL na lista:
//   1. Baixa o conteúdo HTML do Planalto
//   2. Calcula SHA-256 e compara com o hash anterior em KV
//   3. Se mudou: chama Gemini com prompt comparativo, gera resumo +
//      sugestão de patch nos templates afetados
//   4. Envia email pra DRG via worker Resend existente
//   5. Grava histórico em KV (últimas 50 detecções)
//
// COMO INSTALAR:
// 1. Acesse https://dash.cloudflare.com → Workers & Pages
// 2. Create Worker, nome: "drg-rently-legis-monitor"
// 3. Cole este código + faça Deploy
// 4. Crie um KV namespace: Workers → KV → Create namespace "LEGIS_KV"
// 5. Settings do worker → Variables → Bindings:
//      - KV: variable LEGIS_KV ↔ namespace LEGIS_KV
// 6. Settings → Variables and Secrets:
//      - Secret GEMINI_API_KEY (mesma chave usada no drg-rently-gemini)
//      - Variable RESEND_WORKER_URL (URL do drg-rently-resend)
//      - Variable EMAIL_DESTINATARIO (zett.romao@gmail.com)
//      - Variable EMAIL_FROM (ex: onboarding@resend.dev)
//      - Variable FROM_NAME (ex: DRG-Rently Legis Monitor)
// 7. Triggers → Cron Triggers → Add: "0 10 * * *" (todos os dias 10h UTC)
//
// Endpoints HTTP:
//   GET /status — JSON com últimas detecções + URLs monitoradas
//   POST /check — força execução imediata (útil pra testar)
//
// Workflow GH Actions deploya automaticamente quando este arquivo muda.
// =============================================================

const GEMINI_MODEL = 'gemini-2.5-flash';

// URLs monitoradas — editáveis no código (versionado no repo).
// Quando o admin (Donizete) quiser adicionar/remover, basta editar e fazer push.
const URLS_MONITORADAS = [
  {
    id: 'lei_inquilinato',
    nome: 'Lei do Inquilinato (Lei 8.245/91)',
    url: 'http://www.planalto.gov.br/ccivil_03/leis/l8245.htm',
    templatesAfetados: ['locacao', 'distrato'],
  },
  {
    id: 'codigo_civil_locacao',
    nome: 'Código Civil — Locação (Lei 10.406/2002, arts. 565-578)',
    url: 'http://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm',
    templatesAfetados: ['locacao', 'venda'],
  },
];

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
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function fetchTexto(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'DRG-Rently-Legis-Monitor/1.0 (contato: zett.romao@gmail.com)' },
    cf: { cacheTtl: 0 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  // Remove scripts/styles para focar no texto puro
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function analisarMudancaComGemini(env, entrada, anterior, atual) {
  if (!env.GEMINI_API_KEY) {
    return { resumo: '(GEMINI_API_KEY não configurada — análise pulada)', patches: [] };
  }

  // Trunca para evitar overflow (Gemini 2.5 Flash aceita ~1M tokens, mas
  // mandar uma lei inteira 2 vezes é desperdício; usamos diff por linhas).
  const prompt = `Você é um assistente jurídico especializado em direito imobiliário brasileiro.

Está analisando uma mudança no texto da lei "${entrada.nome}" (${entrada.url}).

Versão ANTERIOR (snapshot anterior, possivelmente desatualizado — trecho relevante):
"""
${anterior.slice(0, 30000)}
"""

Versão ATUAL (baixada agora):
"""
${atual.slice(0, 30000)}
"""

Analise APENAS as diferenças relevantes para contratos imobiliários (locação, venda, distrato, multas, juros, garantias, prazos). Ignore mudanças puramente formais (espaços, formatação, links).

Responda APENAS com JSON válido, sem markdown:

{
  "houve_mudanca_relevante": true | false,
  "resumo_mudancas": "<até 250 palavras explicando o que mudou e o impacto em contratos>",
  "artigos_alterados": ["art. X", "art. Y"],
  "impacto": "alto" | "medio" | "baixo" | "nenhum",
  "patches_sugeridos": [
    {
      "template": "locacao" | "venda" | "distrato",
      "instrucao": "<descreva exatamente o que ajustar no template do wizard>",
      "trecho_exemplo": "<sugira o novo trecho de cláusula ajustada>"
    }
  ]
}`;

  const reqBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 4096 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  try {
    return JSON.parse(txt);
  } catch (e) {
    return { resumo_mudancas: 'Falha ao parsear resposta do Gemini', raw: txt };
  }
}

async function enviarEmail(env, alertas) {
  if (!env.RESEND_WORKER_URL) {
    console.warn('RESEND_WORKER_URL não configurada — pulando envio de email');
    return false;
  }
  const dest = env.EMAIL_DESTINATARIO || 'zett.romao@gmail.com';

  const corpo = alertas.map(a => `
    <div style="margin-bottom:24px; padding:16px; background:#fff8e1; border-left:4px solid #ffc107; border-radius:4px;">
      <h3 style="margin:0 0 8px; color:#333;">${a.entrada.nome}</h3>
      <p style="margin:0 0 8px; font-size:12px; color:#666;">
        <a href="${a.entrada.url}">${a.entrada.url}</a> · Impacto: <strong>${a.analise.impacto || '—'}</strong>
      </p>
      <p style="margin:0 0 8px; font-size:13px;">${a.analise.resumo_mudancas || '(sem resumo)'}</p>
      ${(a.analise.artigos_alterados || []).length ? `<p style="margin:0 0 8px; font-size:12px;"><strong>Artigos alterados:</strong> ${a.analise.artigos_alterados.join(', ')}</p>` : ''}
      ${(a.analise.patches_sugeridos || []).length ? `
        <details style="margin-top:10px;">
          <summary style="cursor:pointer; font-size:12px; color:#0066cc; font-weight:bold;">📝 Patches sugeridos (${a.analise.patches_sugeridos.length})</summary>
          ${a.analise.patches_sugeridos.map(p => `
            <div style="margin:8px 0; padding:10px; background:white; border:1px solid #ddd; border-radius:4px;">
              <strong>Template afetado:</strong> ${p.template}<br>
              <strong>Instrução:</strong> ${p.instrucao}<br>
              ${p.trecho_exemplo ? `<strong>Trecho sugerido:</strong> <em>${p.trecho_exemplo}</em>` : ''}
            </div>
          `).join('')}
        </details>
      ` : ''}
    </div>
  `).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,Helvetica,sans-serif; color:#111; background:#f4f4f4; margin:0; padding:0;">
  <div style="max-width:680px; margin:0 auto; background:white; padding:30px;">
    <div style="border-bottom:2px solid #b91c1c; padding-bottom:14px; margin-bottom:20px;">
      <h1 style="margin:0; font-size:20px; color:#b91c1c;">🚨 Monitor Legislativo — Mudança Detectada</h1>
      <p style="margin:6px 0 0; color:#666; font-size:13px;">Verificação realizada em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
    </div>
    <p style="font-size:14px;">Detectamos <strong>${alertas.length}</strong> mudança(s) em legislação monitorada. Revise abaixo e, se necessário, atualize os templates do wizard (DRG-Rently → Configurações → Templates).</p>
    ${corpo}
    <p style="margin-top:30px; font-size:11px; color:#888; text-align:center; border-top:1px solid #ddd; padding-top:14px;">
      Análise automática via Gemini. Sempre revise com cuidado antes de aplicar patches. ⚠️ A IA pode interpretar mudanças incorretamente.
    </p>
  </div>
</body></html>`;

  try {
    const res = await fetch(env.RESEND_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM || 'onboarding@resend.dev',
        fromName: env.FROM_NAME || 'DRG-Rently Legis Monitor',
        to: dest,
        subject: `🚨 Monitor Legislativo: ${alertas.length} mudança(s) detectada(s)`,
        html,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('Falha ao enviar email:', err);
    return false;
  }
}

// Carrega URLs ativas — primeiro tenta override no KV, senão usa hardcoded.
async function getUrlsAtivas(env) {
  try {
    const stored = await env.LEGIS_KV.get('urls_config');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}
  return URLS_MONITORADAS;
}

async function executarCheck(env) {
  const inicio = Date.now();
  const alertas = [];
  const log = [];

  const urlsAtivas = await getUrlsAtivas(env);
  for (const entrada of urlsAtivas) {
    try {
      const conteudo = await fetchTexto(entrada.url);
      const hashAtual = await sha256(conteudo);
      const hashAnterior = await env.LEGIS_KV.get(`hash:${entrada.id}`);
      const conteudoAnterior = await env.LEGIS_KV.get(`content:${entrada.id}`);

      log.push({ id: entrada.id, nome: entrada.nome, statusHttp: 'OK', tamanho: conteudo.length });

      if (hashAnterior && hashAnterior === hashAtual) {
        log[log.length - 1].mudou = false;
        continue;
      }

      if (!hashAnterior) {
        // Primeira execução: só baseline
        await env.LEGIS_KV.put(`hash:${entrada.id}`, hashAtual);
        await env.LEGIS_KV.put(`content:${entrada.id}`, conteudo);
        log[log.length - 1].mudou = false;
        log[log.length - 1].baseline = true;
        continue;
      }

      // Mudou — analisar com Gemini
      log[log.length - 1].mudou = true;
      const analise = await analisarMudancaComGemini(env, entrada, conteudoAnterior || '', conteudo).catch(err => ({
        resumo_mudancas: 'Falha na análise: ' + err.message,
        impacto: 'desconhecido',
        patches_sugeridos: [],
      }));

      // Se IA disse que NÃO é relevante, marca mas não notifica
      if (analise.houve_mudanca_relevante === false) {
        log[log.length - 1].relevante = false;
      } else {
        alertas.push({ entrada, analise, detectadoEm: new Date().toISOString() });
        log[log.length - 1].relevante = true;
      }

      // Atualiza baseline (mesmo se não foi relevante — evita re-analisar todo dia)
      await env.LEGIS_KV.put(`hash:${entrada.id}`, hashAtual);
      await env.LEGIS_KV.put(`content:${entrada.id}`, conteudo);
    } catch (err) {
      log.push({ id: entrada.id, nome: entrada.nome, erro: err.message });
    }
  }

  if (alertas.length) {
    await enviarEmail(env, alertas);
  }

  // Grava no histórico (últimas 50 execuções)
  const exec = {
    executadoEm: new Date().toISOString(),
    duracaoMs: Date.now() - inicio,
    urlsVerificadas: urlsAtivas.length,
    alertas: alertas.length,
    log,
  };
  try {
    const histStr = await env.LEGIS_KV.get('historico');
    let hist = histStr ? JSON.parse(histStr) : [];
    hist.unshift(exec);
    if (hist.length > 50) hist = hist.slice(0, 50);
    await env.LEGIS_KV.put('historico', JSON.stringify(hist));
    // Guarda também os alertas em separado para a UI consumir
    if (alertas.length) {
      const alertasStr = await env.LEGIS_KV.get('alertas');
      let lista = alertasStr ? JSON.parse(alertasStr) : [];
      lista = alertas.concat(lista).slice(0, 100);
      await env.LEGIS_KV.put('alertas', JSON.stringify(lista));
    }
  } catch (err) {
    console.warn('Falha ao gravar histórico:', err);
  }

  return exec;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(executarCheck(env));
  },

  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/status') {
      const histStr = await env.LEGIS_KV.get('historico');
      const alertasStr = await env.LEGIS_KV.get('alertas');
      const urlsAtivas = await getUrlsAtivas(env);
      const body = {
        urlsMonitoradas: urlsAtivas,
        urlsCustomizadas: !!(await env.LEGIS_KV.get('urls_config')),
        historico: histStr ? JSON.parse(histStr) : [],
        alertas: alertasStr ? JSON.parse(alertasStr) : [],
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    if (url.pathname === '/check' && request.method === 'POST') {
      // Trigger manual — útil para teste
      const exec = await executarCheck(env);
      return new Response(JSON.stringify(exec), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // ===== Gerenciamento de URLs monitoradas (admin only) =====
    if (url.pathname === '/urls') {
      // GET retorna sem precisar auth (informacional, mesmo conteúdo de /status)
      if (request.method === 'GET') {
        const urlsAtivas = await getUrlsAtivas(env);
        return new Response(JSON.stringify({
          urls: urlsAtivas,
          customizadas: !!(await env.LEGIS_KV.get('urls_config')),
          default: URLS_MONITORADAS,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      // POST/DELETE exigem token admin
      const adminToken = request.headers.get('X-DRG-Admin-Token');
      if (!adminToken || adminToken !== env.LEGIS_ADMIN_TOKEN) {
        return new Response(JSON.stringify({ error: 'Token administrativo inválido' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      if (request.method === 'POST') {
        // Substitui a lista no KV
        let body;
        try { body = await request.json(); }
        catch (_) { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: corsHeaders(origin) }); }

        if (!Array.isArray(body.urls) || body.urls.length === 0) {
          return new Response(JSON.stringify({ error: 'Campo "urls" deve ser array não-vazio' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
          });
        }

        // Sanitiza entradas
        const sanitizado = body.urls.map((u, i) => ({
          id: String(u.id || `url_${i}_${Date.now()}`).trim().replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
          nome: String(u.nome || u.url || 'Sem nome').trim().slice(0, 200),
          url: String(u.url || '').trim(),
          templatesAfetados: Array.isArray(u.templatesAfetados) ? u.templatesAfetados.filter(t => typeof t === 'string') : [],
        })).filter(u => u.url && /^https?:\/\//i.test(u.url));

        if (sanitizado.length === 0) {
          return new Response(JSON.stringify({ error: 'Nenhuma URL válida após sanitização' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
          });
        }

        await env.LEGIS_KV.put('urls_config', JSON.stringify(sanitizado));
        return new Response(JSON.stringify({ ok: true, salvas: sanitizado.length, urls: sanitizado }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      if (request.method === 'DELETE') {
        // Volta pro hardcoded
        await env.LEGIS_KV.delete('urls_config');
        return new Response(JSON.stringify({ ok: true, restaurado: true, urls: URLS_MONITORADAS }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }
    }

    return new Response(JSON.stringify({
      info: 'DRG-Rently Legis Monitor',
      endpoints: [
        'GET /status',
        'POST /check (sem auth)',
        'GET /urls (lista atual)',
        'POST /urls (admin: substitui lista)',
        'DELETE /urls (admin: volta ao padrão)',
      ],
      cronAgendado: 'diário 10h UTC (7h Brasília)',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  },
};
