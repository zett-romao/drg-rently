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

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-DRG-Admin-Token, asaas-access-token',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });
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

    // Demais endpoints exigem auth do admin DRG
    const adminToken = request.headers.get('X-DRG-Admin-Token');
    if (!adminToken || adminToken !== env.WEBHOOK_TOKEN) {
      return jsonResponse({ error: 'Token administrativo inválido' }, 401, origin);
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
      if (matchSub && request.method === 'DELETE') {
        return await cancelarSubscription(matchSub[1], env, origin);
      }

      // ----------- PAYMENTS (lista da subscription) -----------
      const matchPayments = path.match(/^\/subscriptions\/([^\/]+)\/payments$/);
      if (matchPayments && request.method === 'GET') {
        return await listarPagamentos(matchPayments[1], env, origin);
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

  const res = await fetch(`${asaasBase(env)}/customers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'access_token': env.ASAAS_API_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description || 'Erro Asaas', details: data }, res.status, origin);
  return jsonResponse({ success: true, customer: data }, 200, origin);
}

async function buscarCustomer(customerId, env, origin) {
  const res = await fetch(`${asaasBase(env)}/customers/${customerId}`, {
    headers: { 'access_token': env.ASAAS_API_KEY },
  });
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

  const res = await fetch(`${asaasBase(env)}/subscriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'access_token': env.ASAAS_API_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description || 'Erro Asaas', details: data }, res.status, origin);
  return jsonResponse({ success: true, subscription: data }, 200, origin);
}

async function buscarSubscription(subId, env, origin) {
  const res = await fetch(`${asaasBase(env)}/subscriptions/${subId}`, {
    headers: { 'access_token': env.ASAAS_API_KEY },
  });
  const data = await res.json();
  if (!res.ok) return jsonResponse({ error: data.errors?.[0]?.description, details: data }, res.status, origin);
  return jsonResponse({ success: true, subscription: data }, 200, origin);
}

async function cancelarSubscription(subId, env, origin) {
  const res = await fetch(`${asaasBase(env)}/subscriptions/${subId}`, {
    method: 'DELETE',
    headers: { 'access_token': env.ASAAS_API_KEY },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return jsonResponse({ error: data.errors?.[0]?.description || 'Erro Asaas', details: data }, res.status, origin);
  }
  return jsonResponse({ success: true, deleted: true }, 200, origin);
}

// =============================================================
// PAYMENTS — lista pagamentos de uma assinatura
// =============================================================

async function listarPagamentos(subId, env, origin) {
  const res = await fetch(`${asaasBase(env)}/payments?subscription=${subId}&limit=100`, {
    headers: { 'access_token': env.ASAAS_API_KEY },
  });
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
</ul>
<p style="margin-top:40px;font-size:12px;color:#64748b;">DRG-Rently · D.R. Global Multi Services</p>
</body></html>`;
}
