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

    // Demais endpoints exigem auth — duas formas:
    //  (a) X-DRG-Admin-Token (cobrança de mensalidade pela DRG Global), OU
    //  (b) X-Tenant-Asaas-Token (tenant usa sua própria chave Asaas)
    const adminToken = request.headers.get('X-DRG-Admin-Token');
    const tenantAsaasKey = request.headers.get('X-Tenant-Asaas-Token');
    const isAdmin = adminToken && adminToken === env.WEBHOOK_TOKEN;
    const isTenant = !!tenantAsaasKey;

    // Endpoints /tenant/* exigem token do tenant; demais exigem admin (compat com cobrança DRG)
    if (path.startsWith('/tenant/')) {
      if (!isTenant) {
        return jsonResponse({ error: 'Header X-Tenant-Asaas-Token obrigatório.' }, 401, origin);
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
