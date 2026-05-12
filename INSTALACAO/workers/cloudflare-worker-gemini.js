// =============================================================
// DRG-Rently — Cloudflare Worker proxy para Gemini Vision
//
// Extrai dados de boletos / faturas / contas a pagar via Gemini Vision.
// Recebe um arquivo (PDF/imagem) em base64 e retorna JSON estruturado.
//
// COMO INSTALAR (passo a passo):
//
// 1. Acesse https://dash.cloudflare.com → Workers & Pages
// 2. Clique em "Create Application" → "Create Worker"
// 3. Nome sugerido: "drg-rently-gemini"
// 4. Clique em "Deploy" pra criar com o Worker padrão
// 5. Depois clique em "Edit code" → cole TODO o código abaixo
// 6. Salve e faça "Deploy"
//
// 7. Configure o secret GEMINI_API_KEY:
//    Settings → Variables and Secrets → Add → tipo "Secret"
//    Name: GEMINI_API_KEY
//    Value: a chave que você gerou em aistudio.google.com/apikey
//    Save
//
// 8. Pegue a URL do Worker (algo como
//    https://drg-rently-gemini.SEU-USUARIO.workers.dev)
//    e cole em:
//    DRG-Rently → Configurações → URL do Worker (Gemini Vision)
//
// 9. Teste num balancete clicando em "🤖 Ler de boleto".
// =============================================================

const ALLOWED_ORIGINS = [
  'https://zett-romao.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const GEMINI_MODEL = 'gemini-2.5-flash';

const PROMPT_BOLETO = `Você está analisando um boleto bancário, fatura, recibo ou conta a pagar (condomínio, IPTU, água, luz, gás, manutenção, etc.).

Extraia as informações abaixo e responda APENAS com JSON válido, sem markdown nem texto fora do JSON:

{
  "valor": <número decimal em reais, ex: 320.50 — usar ponto como separador decimal>,
  "vencimento": <data no formato "YYYY-MM-DD" ou null>,
  "competencia": <mês de referência no formato "YYYY-MM" ou null — ex: "2026-05" para maio/2026>,
  "beneficiario": <nome do beneficiário/credor (string) ou null>,
  "documento_beneficiario": <CNPJ ou CPF do beneficiário com formatação ou null>,
  "linha_digitavel": <linha digitável completa do boleto (string) ou null>,
  "categoria_sugerida": <um destes valores: "iptu", "condominio", "agua", "luz", "gas", "internet", "manutencao", "seguro", "outros">,
  "descricao": <descrição curta do que é, ex: "Condomínio maio/2026", "IPTU 2026 - 1ª parcela" — ou null>
}

Se algum campo não for legível ou não estiver no documento, retorne null.
NÃO inclua explicações. Resposta deve ser apenas JSON puro.`;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const { fileBase64, mimeType, prompt } = payload;
    if (!fileBase64 || !mimeType) {
      return new Response(JSON.stringify({ error: 'Faltam campos: fileBase64, mimeType' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const maxBytes = 4 * 1024 * 1024;
    const sizeBytes = (fileBase64.length * 3) / 4;
    if (sizeBytes > maxBytes) {
      return new Response(JSON.stringify({ error: 'Arquivo excede 4MB' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const requestBody = {
      contents: [{
        role: 'user',
        parts: [
          { text: prompt || PROMPT_BOLETO },
          { inline_data: { mime_type: mimeType, data: fileBase64 } },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    };

    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
      const geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await geminiRes.json();

      if (!geminiRes.ok) {
        return new Response(JSON.stringify({
          error: data?.error?.message || 'Erro no Gemini',
          details: data,
        }), {
          status: geminiRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        return new Response(JSON.stringify({
          error: 'Resposta do Gemini não é JSON válido',
          raw: text,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      return new Response(JSON.stringify({ success: true, data: parsed }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Falha ao chamar Gemini: ' + err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }
  },
};
