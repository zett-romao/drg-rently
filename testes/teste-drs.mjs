// 🧩 Contrato de Plataforma DR Systems v1 no drg-rently-asaas + webhook da mensalidade.
// Roda o Worker de verdade contra um Firestore simulado em memória (fetch interceptado).
// Rodar: node testes/teste-drs.mjs
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = path.join(raiz, 'testes', '.worker-asaas-teste.mjs');
fs.copyFileSync(path.join(raiz, 'cloudflare-worker-asaas.js'), tmp);
const worker = (await import('file://' + tmp.replace(/\\/g, '/'))).default;
fs.unlinkSync(tmp);

let ok = 0, falha = 0;
const checa = (c, m) => { if (c) { ok++; console.log('  OK   ' + m); } else { falha++; console.log('  FALHA ' + m); } };

// ── Firestore em memória (formato REST) ──
const docs = new Map(); // caminho → objeto JS
const enc = (v) => v === null || v === undefined ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? { doubleValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) };
const dec = (v) => 'nullValue' in v ? null : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue : 'timestampValue' in v ? v.timestampValue : 'stringValue' in v ? v.stringValue
  : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec) : Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
const BASE = 'https://firestore.googleapis.com/v1/projects/drg-rently/databases/(default)/documents/';
let semAuth = 0, n = 0;
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  const R = (st, j) => new Response(JSON.stringify(j), { status: st, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return R(200, { access_token: 'ya29.teste', expires_in: 3600 });
  if (!url.startsWith(BASE)) return R(500, { erro: 'rede inesperada ' + url });
  if ((o.headers || {}).Authorization !== 'Bearer ya29.teste') { semAuth++; return R(403, { error: 'PERMISSION_DENIED' }); }
  const u = new URL(url); const cam = decodeURIComponent(u.pathname.split('/documents/')[1]);
  const metodo = o.method || 'GET';
  if (metodo === 'GET' && cam.split('/').length % 2 === 1) { // coleção
    const docsCol = [...docs.entries()].filter(([k]) => k.startsWith(cam + '/') && k.split('/').length === cam.split('/').length + 1);
    return R(200, { documents: docsCol.map(([k, d]) => ({ name: BASE + k, fields: enc(d).mapValue.fields })) });
  }
  if (metodo === 'GET') { const d = docs.get(cam); return d ? R(200, { name: BASE + cam, fields: enc(d).mapValue.fields }) : R(404, {}); }
  if (metodo === 'POST') { const id = 'auto' + (++n); docs.set(cam + '/' + id, dec({ mapValue: JSON.parse(o.body) })); return R(200, {}); }
  if (metodo === 'PATCH') {
    const novo = dec({ mapValue: JSON.parse(o.body) }); const atual = docs.get(cam) || {};
    for (const fp of u.searchParams.getAll('updateMask.fieldPaths')) {
      const partes = fp.split('.'); let src = novo, dst = atual;
      for (let i = 0; i < partes.length - 1; i++) { src = src ? src[partes[i]] : undefined; dst[partes[i]] = dst[partes[i]] || {}; dst = dst[partes[i]]; }
      const ult = partes.at(-1); if (src && ult in src) dst[ult] = src[ult]; else delete dst[ult];
    }
    docs.set(cam, atual); return R(200, {});
  }
  if (metodo === 'DELETE') { docs.delete(cam); return R(200, {}); }
  return R(400, {});
};

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const TK = 'drs_' + 'a'.repeat(48);
const env = {
  DRS_PLATAFORMA_TOKEN: TK, WEBHOOK_TOKEN: 'wh-teste', PROJECT_ID: 'drg-rently',
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'sa@drg-rently.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
};
const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const somaDias = (d) => new Date(Date.now() - 3 * 3600e3 + d * 864e5).toISOString().slice(0, 10);
docs.set('tenants/DRGIMOVEIS', { nome: 'D.R. Global Imóveis', cnpj: '49.698.112/0001-57', plano: 'pro', ativo: true, valorMensalidade: 199, proximoVencimento: somaDias(-3), pacote: 'completo' });
docs.set('tenants/CLIENTE1', { nome: 'Imobiliária Um', cnpj: '11.222.333/0001-81', plano: 'basic', ativo: true, valorMensalidade: 99, proximoVencimento: somaDias(20), asaas: { customerId: 'cus_1', subscriptionId: 'sub_1', subscriptionStatus: 'ACTIVE' } });
docs.set('tenants/TRIAL1', { nome: 'Corretor PF', tipoPessoa: 'PF', plano: 'trial', ativo: true, trialExpira: somaDias(10) });
docs.set('tenants/SUSP', { nome: 'Suspensa', plano: 'basic', ativo: false });
docs.set('tenants/ARQ', { nome: 'Arquivada', plano: 'basic', ativo: true, arquivado: true });
docs.set('tenants/CLIENTE1/pagamentos/p0', { data: '2026-10-01', valor: 99, metodo: 'pix', obs: 'out' });
docs.set('tenants/ISENTA', { nome: 'Isenta', plano: 'basic', ativo: true, proximoVencimento: somaDias(-30), isencao: { ate: null, motivo: 'parceria' } });

const chama = async (metodo, rota, corpo, tk = TK) => {
  const r = await worker.fetch(new Request('https://drg-rently-asaas.x.workers.dev' + rota, {
    method: metodo, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined,
  }), env);
  return { st: r.status, j: await r.json().catch(() => ({})) };
};
const acao = (id, corpo) => chama('POST', `/drs/v1/licencas/${id}/acao`, corpo);

let r = await chama('GET', '/drs/v1/info', null, null);
checa(r.st === 401, '🔒 sem token: 401');
r = await chama('GET', '/drs/v1/info', null, 'drs_' + 'b'.repeat(48));
checa(r.st === 401, '🔒 token errado: 401');
r = await chama('GET', '/drs/v1/info');
checa(r.st === 200 && r.j.contrato === 1 && r.j.app === 'rently' && r.j.recursos.includes('empresaDoDono'), 'info: contrato 1, app rently');

r = await chama('GET', '/drs/v1/licencas');
const L = Object.fromEntries((r.j.licencas || []).map((l) => [l.id, l]));
checa(r.st === 200 && Object.keys(L).length === 6, 'licenças: lista todos os tenants (6)');
checa(L.DRGIMOVEIS.status === 'inadimplente' && L.DRGIMOVEIS.documento === '49698112000157' && L.DRGIMOVEIS.mensalidade === 199, 'vencimento passado → inadimplente; CNPJ só dígitos');
checa(L.CLIENTE1.status === 'ativo' && L.CLIENTE1.plano === 'Basic' && L.CLIENTE1.cobranca && L.CLIENTE1.cobranca.asaas === 'ACTIVE', 'ativo com assinatura Asaas visível');
checa(L.TRIAL1.status === 'trial' && L.TRIAL1.validade === somaDias(10), 'trial: validade = fim do trial');
checa(L.SUSP.status === 'suspenso' && L.ARQ.status === 'arquivado', 'ativo:false → suspenso; arquivado → arquivado');
checa(L.ISENTA.status === 'ativo' && L.ISENTA.isento === true, '🎁 isenta não fica inadimplente');

// 🔒 migração: licença sai do doc público
const L0 = JSON.stringify(L);
r = await chama('POST', '/drs/v1/manutencao/separar-licencas');
const pubs = [...docs.entries()].filter(([k]) => /^tenants\/[^/]+$/.test(k)).map(([, d]) => d);
checa(r.st === 200 && r.j.ok && pubs.every((d) => !['valorMensalidade', 'proximoVencimento', 'trialExpira', 'isencao', 'notas', 'asaas'].some((k) => k in d)),
  '🔒 migração: nenhum tenant público guarda mensalidade, vencimento, trial, isenção, notas ou Asaas');
checa(docs.get('licencas/CLIENTE1').valorMensalidade === 99 && docs.get('licencas/CLIENTE1').asaas.subscriptionId === 'sub_1' && docs.get('licencas/ISENTA').isencao.motivo === 'parceria',
  '…foi tudo para licencas/{id}');
checa(docs.has('licencas/CLIENTE1/pagamentos/p0') && !docs.has('tenants/CLIENTE1/pagamentos/p0') && r.j.pagamentos === 1, '…e o histórico de mensalidades também');
checa(docs.get('tenants/CLIENTE1').nome === 'Imobiliária Um' && docs.get('tenants/CLIENTE1').plano === 'basic', '…sem perder nome/plano no público');
r = await chama('GET', '/drs/v1/licencas');
checa(JSON.stringify(Object.fromEntries((r.j.licencas || []).map((l) => [l.id, l]))) === L0, 'a Central vê exatamente o mesmo de antes da migração');
r = await chama('POST', '/drs/v1/manutencao/separar-licencas');
checa(r.j.ok && r.j.movidos === 0, 'migração idempotente (2ª vez não move nada)');

// 🏠 empresa do dono → ♾️ Ilimitado sem custo
r = await acao('DRGIMOVEIS', { acao: 'definir', empresaDoDono: true });
let d = docs.get('tenants/DRGIMOVEIS');
checa(r.st === 200 && r.j.licenca.empresaDoDono && r.j.licenca.status === 'ativo' && r.j.licenca.mensalidade === 0 && r.j.licenca.validade === null,
  '🏠 empresa do dono: vira ♾️ Ilimitado, ativa, R$ 0, sem vencimento');
const dl = docs.get('licencas/DRGIMOVEIS');
checa(d.plano === 'ilimitado' && d.pacote === 'ilimitado' && d.modulosHabilitados === null && dl.valorMensalidade === null && dl.proximoVencimento === null && d.nome === 'D.R. Global Imóveis' && !('valorMensalidade' in d),
  '…grava igual ao Super Admin (pacote ilimitado, todos os módulos) e não mexe no resto');
r = await acao('DRGIMOVEIS', { acao: 'definir', plano: 'basic' });
checa(r.st === 400 && /empresa do dono/.test(r.j.erro), '🔒 empresa do dono não sai do Ilimitado sem desmarcar');
r = await acao('DRGIMOVEIS', { acao: 'definir', mensalidade: 50 });
checa(r.st === 400 && /sem custo/.test(r.j.erro), '🔒 Ilimitado não aceita mensalidade');
r = await acao('DRGIMOVEIS', { acao: 'definir', validade: '2027-01-01' });
checa(r.st === 400, '🔒 Ilimitado não tem vencimento');

// definir num cliente comum
r = await acao('CLIENTE1', { acao: 'definir', plano: 'Pro', mensalidade: '149.90', validade: '2026-12-10' });
d = docs.get('tenants/CLIENTE1'); let lc = docs.get('licencas/CLIENTE1');
checa(r.st === 200 && d.plano === 'pro' && lc.valorMensalidade === 149.9 && lc.proximoVencimento === '2026-12-10' && lc.asaas.subscriptionId === 'sub_1' && !('valorMensalidade' in d), 'definir: plano no público; mensalidade e vencimento na licença privada (Asaas intacto)');
r = await acao('TRIAL1', { acao: 'definir', validade: '2026-12-31' });
checa(docs.get('licencas/TRIAL1').trialExpira === '2026-12-31', 'definir validade num trial estende o trial');
r = await acao('CLIENTE1', { acao: 'definir', plano: 'ouro' });
checa(r.st === 400, 'plano inexistente: recusa');
r = await acao('CLIENTE1', { acao: 'definir', limite: 10 });
checa(r.st === 400 && /limite/.test(r.j.erro), 'limite numérico: o Rently explica que não tem');

// suspender / ativar / arquivar
r = await acao('CLIENTE1', { acao: 'suspender', motivo: 'atraso' });
checa(r.st === 200 && r.j.licenca.status === 'suspenso' && docs.get('tenants/CLIENTE1').suspensoMotivo === 'atraso', 'suspender: ativo:false + motivo');
r = await acao('CLIENTE1', { acao: 'ativar' });
checa(r.j.licenca.status === 'ativo' && docs.get('tenants/CLIENTE1').ativo === true, 'ativar');
r = await acao('ARQ', { acao: 'reativar' });
checa(r.j.licenca.status === 'ativo' && docs.get('tenants/ARQ').arquivado === false, 'reativar tira do arquivo');
r = await acao('SUSP', { acao: 'arquivar' });
checa(r.j.licenca.status === 'arquivado' && docs.has('tenants/SUSP'), '🔒 arquivar não apaga nada');
r = await acao('NAOEXISTE', { acao: 'ativar' });
checa(r.st === 404, 'licença inexistente: 404');
r = await acao('CLIENTE1', { acao: 'apagar' });
checa(r.st === 400, '🔒 ação fora do contrato: 400');
r = await chama('GET', '/drs/v1/planos');
checa(r.j.planos.ilimitado.cobra === false && r.j.planos.ilimitado.cortesia === true, 'planos: ♾️ Ilimitado sem custo');

// webhook da mensalidade (antes gravava sem credencial e falhava calado)
const wh = (ev) => worker.fetch(new Request('https://x/webhook', { method: 'POST', headers: { 'asaas-access-token': 'wh-teste', 'Content-Type': 'application/json' }, body: JSON.stringify(ev) }), env);
docs.get('licencas/CLIENTE1').proximoVencimento = somaDias(-5);
await wh({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_9', value: 149.9, billingType: 'PIX', externalReference: 'CLIENTE1', paymentDate: hoje, description: 'Mensalidade' } });
d = docs.get('licencas/CLIENTE1');
const pg = [...docs.entries()].filter(([k]) => k.startsWith('licencas/CLIENTE1/pagamentos/') && k !== 'licencas/CLIENTE1/pagamentos/p0');
checa(d.proximoVencimento > hoje && pg.length === 1 && pg[0][1].asaasPaymentId === 'pay_9' && docs.get('tenants/CLIENTE1').ativo === true && !('proximoVencimento' in docs.get('tenants/CLIENTE1')), '🔧 webhook: mensalidade paga renova o vencimento e registra o pagamento');
await wh({ event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1', externalReference: 'CLIENTE1' } });
d = docs.get('licencas/CLIENTE1');
checa(d.asaas.subscriptionStatus === 'CANCELLED' && d.asaas.customerId === 'cus_1' && d.asaas.subscriptionId === 'sub_1', '🔧 webhook: assinatura cancelada marca só o status (resto do mapa asaas intacto)');
checa(semAuth === 0, '🔒 nenhuma gravação sem credencial de admin');

console.log(falha ? `REPROVADO ${falha}` : `APROVADO (${ok})`);
process.exit(falha ? 1 : 0);
