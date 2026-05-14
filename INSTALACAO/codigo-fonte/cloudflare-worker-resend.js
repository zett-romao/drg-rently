// =============================================================
// DRG-Rently — Cloudflare Worker proxy para Resend
//
// Este arquivo NÃO faz parte do código do app — é o conteúdo
// que você cola no painel Cloudflare ao criar o Worker.
//
// COMO INSTALAR (passo a passo):
//
// 1. Acesse https://dash.cloudflare.com → Workers & Pages
// 2. Clique em "Create Application" → "Create Worker"
// 3. Nome sugerido: "drg-rently-resend"
// 4. Clique em "Deploy" pra criar com o Worker padrão
// 5. Depois clique em "Edit code" → cole o código abaixo
// 6. Salve e faça "Deploy"
//
// 7. Configure o secret RESEND_API_KEY:
//    Settings → Variables and Secrets → Add → tipo "Secret"
//    Name: RESEND_API_KEY
//    Value: cole sua API key do Resend (resend.com/api-keys)
//    Save
//
// 8. (Opcional) Restrinja a origem em ALLOWED_ORIGINS abaixo
//    pra apenas o seu domínio do GitHub Pages.
//
// 9. Pegue a URL do Worker (algo como
//    https://drg-rently-resend.SEU-USUARIO.workers.dev)
//    e cole em:
//    DRG-Rently → Configurações → URL do Worker
//
// 10. Pronto. Teste enviando um balancete.
// =============================================================

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
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // Valida origem
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

    const { from, fromName, to, bcc, replyTo, subject, html, attachments } = payload;

    if (!from || !to || !subject || !html) {
      return new Response(JSON.stringify({ error: 'Faltam campos obrigatórios: from, to, subject, html' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // Monta o "from" no formato "Nome <email@domain>"
    const fromField = fromName ? `${fromName} <${from}>` : from;

    // Body para Resend
    const resendBody = {
      from: fromField,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    };
    if (bcc) resendBody.bcc = Array.isArray(bcc) ? bcc : [bcc];
    if (replyTo) resendBody.reply_to = replyTo;
    if (attachments && attachments.length) resendBody.attachments = attachments;

    try {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(resendBody),
      });

      const responseText = await resendRes.text();
      let resendData;
      try { resendData = JSON.parse(responseText); } catch (_) { resendData = { raw: responseText }; }

      if (!resendRes.ok) {
        return new Response(JSON.stringify({
          error: resendData.message || resendData.error || 'Erro no Resend',
          details: resendData,
        }), {
          status: resendRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      return new Response(JSON.stringify({ success: true, id: resendData.id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Falha ao chamar Resend: ' + err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }
  },
};
