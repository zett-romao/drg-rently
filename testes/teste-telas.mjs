// Teste de telas: o app REAL (servido localmente) contra Firestore/Auth EMULADOS
// com as regras de produção. Usuários e dados fictícios; nada toca a produção.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH);

const PROJ = 'drg-rently';
const T = 'tenantTeste';
const SITE = 'http://localhost:5503';
const SENHA = 'senha-ficticia-123'; // conta fictícia, só existe no emulador

// ---------- contas no Auth emulado ----------
async function criarConta(email) {
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: SENHA, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.localId) throw new Error('signUp falhou: ' + JSON.stringify(j));
  return j.localId;
}
const contas = {};
for (const k of ['admin', 'op0', 'op1', 'cor']) contas[k] = await criarConta(`${k}@teste.local`);

// ---------- dados ----------
const env = await initializeTestEnvironment({ projectId: PROJ,
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const S = (p, d) => setDoc(doc(db, ...p), d);
  await S(['tenants', T], { nome: 'Imobiliária Teste', ativo: true, plano: 'ilimitado', modulosHabilitados: null, criadoPor: contas.admin, telefone: '15991859779' });
  await S(['users', contas.admin], { nome: 'Admin Teste', email: 'admin@teste.local', role: 'admin', tenantId: T, ativo: true });
  await S(['users', contas.op0], { nome: 'Operador Sem Perfil', email: 'op0@teste.local', role: 'operador', tenantId: T, ativo: true });
  await S(['users', contas.op1], { nome: 'Operador Restrito', email: 'op1@teste.local', role: 'operador', tenantId: T, ativo: true, perfilId: 'restrito' });
  await S(['users', contas.cor], { nome: 'Corretor Teste', email: 'cor@teste.local', role: 'corretor', tenantId: T, ativo: true, status: 'ativo' });
  await S(['tenants', T, 'corretores', contas.cor], { nome: 'Corretor Teste', status: 'ativo', tipo: 'equipe' });
  const tudo = { ver: true, criar: 'sim', editar: 'sim', excluir: 'sim' };
  await S(['tenants', T, 'perfis', 'restrito'], { nome: 'Restrito', permissoes: {
    dashboard: { ver: true }, imoveis: { ver: true, criar: 'sim', editar: 'aprovacao', excluir: 'nao' },
    locadores: { ver: true, criar: 'sim', editar: 'nao', excluir: 'nao' }, contratos: tudo,
    leads: { ver: true, criar: 'nao', editar: 'sim', excluir: 'nao' }, alertas: { ver: true },
  }, acoes: {} });
  await S(['tenants', T, 'config', 'site'], { workerGeminiUrl: 'https://ia.invalido.local', workerFeedUrl: 'https://feed.invalido.local' });
  await S(['tenants', T, 'config', 'ia'], { workerGeminiUrl: 'https://ia.invalido.local' });
  await S(['tenants', T, 'locadores', 'L1'], { nome: 'Proprietário Um', tipo: 'PF', telefone: '15991859779', criadoPor: contas.admin });
  await S(['tenants', T, 'locadores', 'L2'], { nome: 'Proprietário do Corretor', tipo: 'PF', criadoPor: contas.cor });
  await S(['tenants', T, 'locatarios', 'LT1'], { nome: 'Inquilino Um', tipo: 'PF', status: 'aprovado' });
  await S(['tenants', T, 'imoveis', 'im1'], { apelido: 'Casa Centro', status: 'disponivel', locadorId: 'L1', finalidade: 'locacao', aluguelSugerido: 2500, linkPublico: true, criadoPor: contas.admin, codigoAnuncio: 'IT-00001' });
  await S(['tenants', T, 'vitrine', 'im1'], { linkPublico: true, apelido: 'Casa Centro', finalidade: 'locacao' });
  await S(['tenants', T, 'contadores', 'anuncios'], { seq: 1, prefixo: 'IT' });
  await S(['tenants', T, 'contratos', 'c1'], { status: 'vigente', imovelId: 'im1', locadorId: 'L1', locatarioId: 'LT1', valorAluguel: 2500 });
  await S(['tenants', T, 'leadsImoveis', 'lead1'], { origem: 'interesse_imovel', nome: 'Maria', telefone: '15991859779', imovelId: 'im1', status: 'novo', criadoEm: new Date() });
  await S(['tenants', T, 'leadsImoveis', 'lead2'], { origem: 'manual', canal: 'whatsapp', tipoLead: 'cliente', nome: 'Joana', telefone: '11997347272', status: 'novo', criadoEm: new Date(), corretorUid: contas.cor, corretorNome: 'Corretor Teste', atribuidoEm: new Date(), historico: [] });
  await S(['tenants', T, 'estatisticas', 'im1_2026-10'], { imovelId: 'im1', mes: '2026-10', visitas: 12, favoritos: 3, contatos: 2 });
});

// ---------- navegador ----------
const configOriginal = readFileSync(process.env.FIREBASE_CONFIG_PATH || new URL('../firebase-config.js', import.meta.url), 'utf8');
const configEmulador = configOriginal + `
// TESTE: tudo no emulador local
db.useEmulator('127.0.0.1', 8080);
auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
if (window.storage) storage.useEmulator('127.0.0.1', 9199);`;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const relatorio = [];

async function sessao(nome, quem, fluxos) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  // trava de segurança: nenhuma chamada para a produção
  await page.route(u => /googleapis\.com$|workers\.dev$|invalido\.local$/.test(u.hostname), r => r.abort());
  await page.route('**/firebase-config.js*', r => r.fulfill({ contentType: 'application/javascript', body: configEmulador }));
  const erros = []; const logs = [];
page.on('console', m => logs.push(m.type()+': '+m.text().slice(0,200)));
  let secaoAtual = 'login';
  const anota = (txt) => { if (/permission|insufficient|PERMISSION_DENIED|permissão/i.test(txt)) erros.push(`[${secaoAtual}] ${txt.slice(0, 220)}`); };
  page.on('console', m => anota(m.text()));
  page.on('pageerror', e => anota(e.message));
  page.on('dialog', d => d.dismiss());

  await page.goto(SITE + '/index.html');
  await page.fill('#login-email', `${quem}@teste.local`);
  await page.fill('#login-senha', SENHA);
  await page.click('#btn-login');
  try { await page.waitForFunction(() => document.getElementById('screen-app')?.classList.contains('active') && typeof State !== 'undefined' && State.tenant, null, { timeout: 25000 }); } catch (e) { await page.screenshot({ path: 'falha-login-' + quem + '.png' }); const a = await page.evaluate(() => document.getElementById('login-alert')?.innerText || ''); throw new Error('login ' + quem + ' não completou: ' + a + ' | logs: ' + logs.slice(-8).join(' || ')); }
  await page.waitForTimeout(2500);
  // pergunta de notificações (aparece pro admin): 'Agora não', como um usuário faria
  const naoAgora = page.getByRole('button', { name: 'Agora não' });
  if (await naoAgora.isVisible().catch(() => false)) await naoAgora.click();

  // todas as telas que aparecem no menu dessa pessoa
  const secoes = await page.evaluate(() => [...document.querySelectorAll('.nav-link[data-section]')]
    .filter(a => a.offsetParent !== null).map(a => a.dataset.section));
  for (const s of secoes) {
    secaoAtual = s;
    await page.evaluate(sec => { try { showSection(sec); } catch (e) { console.error('permission? ' + e.message); } }, s);
    await page.waitForTimeout(1300);
    const erroNaTela = await page.evaluate(sec => {
      const el = document.getElementById('section-' + sec);
      const t = el ? el.innerText : '';
      const m = t.match(/(Erro[^\n]{0,120}permiss[^\n]{0,80}|Missing or insufficient[^\n]{0,60})/i);
      return m ? m[0] : '';
    }, s);
    if (erroNaTela) erros.push(`[${s}] texto na tela: ${erroNaTela}`);
  }

  const resultados = [];
  for (const [desc, fn, esperado] of fluxos) {
    secaoAtual = desc;
    let r;
    try { r = await fn(page); } catch (e) { r = 'EXCEÇÃO: ' + e.message.slice(0, 160); }
    const ok = esperado instanceof RegExp ? esperado.test(String(r)) : r === esperado;
    resultados.push(`${ok ? '✓' : '✗'} ${desc} → ${String(r).slice(0, 160)}`);
  }
  relatorio.push({ nome, secoes: secoes.length, erros, resultados });
  await ctx.close();
}

// helpers de fluxo
const statusInline = (page, id) => page.waitForFunction(i => { const e = document.getElementById(i); return e && e.style.display !== 'none' && e.innerText.trim(); }, id, { timeout: 15000 })
  .then(() => page.evaluate(i => document.getElementById(i).innerText.trim(), id));
const novoImovel = (apelido, loc = 'L1') => async (page) => {
  await page.evaluate(() => openImovelModal()); await page.waitForTimeout(1200);
  await page.fill('#imovel-apelido', apelido);
  await page.selectOption('#imovel-locador', loc);
  await page.click('#btn-save-imovel');
  return statusInline(page, 'imovel-acoes-status');
};
const editarImovel = (id, apelido) => async (page) => {
  await page.evaluate(i => openImovelModal(i), id); await page.waitForTimeout(1800);
  await page.fill('#imovel-apelido', apelido);
  { const b = page.getByRole('button', { name: 'Agora não' }); if (await b.isVisible().catch(() => false)) await b.click(); }
  try { await page.click('#btn-save-imovel', { timeout: 8000 }); } catch (e) { await page.screenshot({ path: 'falha-salvar.png' }); throw new Error(e.message.split(String.fromCharCode(10)).slice(0, 8).join(' | ')); }
  // Lê o aviso assim que aparece: no "🕓 com aprovação" o modal fecha sozinho em 1,8 s
  await page.waitForFunction(() => {
    const vis = el => el && el.style.display !== 'none' && el.innerText.trim();
    return vis(document.getElementById('imovel-acoes-status')) || vis(document.getElementById('imovel-alert'))
      || document.getElementById('modal-imovel').style.display === 'none';
  }, null, { timeout: 15000, polling: 100 }).catch(() => {});
  return page.evaluate(() => {
    const s = document.getElementById('imovel-acoes-status');
    const a = document.getElementById('imovel-alert');
    const vis = el => el && el.style.display !== 'none' && el.innerText.trim();
    return vis(s) || vis(a) || (document.getElementById('modal-imovel').style.display === 'none' ? 'salvo e fechou' : 'sem resposta');
  });
};
const direto = (codigo) => (page) => page.evaluate(async c => { try { await eval(c); return 'ok'; } catch (e) { return 'NEGADO: ' + (e.code || e.message); } }, codigo);

await sessao('Administrador', 'admin', [
  ['edita imóvel', editarImovel('im1', 'Casa Centro (adm)'), /salvo e fechou/],
  ['salva configurações (cria config/ia)', direto(`(async()=>{ await tenantPath().collection('config').doc('ia').set({workerGeminiUrl:'x'}); })()`), 'ok'],
  ['repassa lead pelo modal (sugere captador)', async (page) => {
    await page.evaluate(() => showSection('leads')); await page.waitForTimeout(1500);
    await page.evaluate(() => openRepassarLead('lead1')); await page.waitForTimeout(1500);
    const opcoes = await page.evaluate(() => [...document.querySelectorAll('#repasse-lead-corretor option')].map(o => o.value).filter(Boolean).length);
    await page.selectOption('#repasse-lead-corretor', { index: 1 });
    await page.fill('#repasse-lead-nota', 'cliente quer visitar sábado');
    await page.evaluate(() => confirmarRepassarLead()); await page.waitForTimeout(2500);
    return page.evaluate(n => { const t = document.getElementById('tbody-leads').innerText; return t.includes('Corretor Teste') ? `repassado (${n} corretor na lista)` : 'não apareceu: ' + t.slice(0, 120); }, opcoes);
  }, /^repassado/],
  ['cadastra lead manual', async (page) => {
    await page.evaluate(() => openLeadManual()); await page.waitForTimeout(1200);
    await page.fill('#lm-nome', 'Lead Manual Teste'); await page.fill('#lm-telefone', '11 99999-8888');
    await page.evaluate(() => { salvarLeadManual(); }); // não espera: termina perguntando "Repassar agora?"
    const depois = page.getByRole('button', { name: 'Depois' });
    await depois.waitFor({ timeout: 15000 }); await depois.click(); await page.waitForTimeout(1000);
    return page.evaluate(() => document.getElementById('tbody-leads').innerText.includes('Lead Manual Teste') ? 'cadastrado' : 'não apareceu');
  }, 'cadastrado'],
  ['abre desempenho do imóvel', async (page) => { await page.evaluate(() => openImovelModal('im1')); await page.waitForTimeout(2500); return page.evaluate(() => document.getElementById('imovel-desempenho')?.innerText.includes('12') ? 'mostrou 12 visitas' : document.getElementById('imovel-desempenho')?.innerText || 'vazio'); }, 'mostrou 12 visitas'],
]);
await sessao('Operador SEM perfil', 'op0', [
  ['cria imóvel', novoImovel('Apto Novo op0'), /criado/i],
  ['edita imóvel', editarImovel('im1', 'Casa Centro (op0)'), /salvo e fechou/],
  ['exclui lead', direto(`tenantPath().collection('leadsImoveis').doc('lead1').update({status:'contatado'})`), 'ok'],
]);
await sessao('Operador RESTRITO', 'op1', [
  ['cria imóvel (✅)', novoImovel('Apto Novo op1'), /criado/i],
  ['edita imóvel (🕓 vai para aprovação)', editarImovel('im1', 'Casa Centro (op1)'), /aprova/i],
  ['contrato muda status do imóvel (efeito colateral)', direto(`tenantPath().collection('imoveis').doc('im1').update({status:'alugado'})`), 'ok'],
  ['edita lead (✅)', direto(`tenantPath().collection('leadsImoveis').doc('lead1').update({status:'convertido'})`), 'ok'],
  ['exclui imóvel direto (⛔) é barrado', direto(`tenantPath().collection('imoveis').doc('im1').delete()`), /NEGADO/],
  ['edita contrato (✅)', direto(`tenantPath().collection('contratos').doc('c1').update({obs:'teste'})`), 'ok'],
]);
await sessao('Corretor', 'cor', [
  ['cria imóvel próprio (recebe código)', novoImovel('Casa do Corretor', 'L2'), /criado|aprova/i],
  ['gerador de IA enxerga o endereço da IA', async (page) => { const u = await page.evaluate(() => urlWorkerIA()); return u ? 'ok' : 'vazio'; }, 'ok'],
  ['"Meus leads" mostra só os dele', async (page) => {
    await page.evaluate(() => showSection('meusleads')); await page.waitForTimeout(2000);
    const t = await page.evaluate(() => document.getElementById('tbody-meus-leads').innerText);
    return t.includes('Joana') && t.includes('Maria') && !t.includes('Lead Manual Teste') ? 'Joana e Maria (repassados), sem os outros' : t.slice(0, 160);
  }, /^Joana e Maria/],
  ['marca "Contatei" no lead', async (page) => {
    await page.evaluate(() => atualizarMeuLead('lead2', 'contatado')); await page.waitForTimeout(2000);
    return page.evaluate(() => (_meusLeads.find(l => l._id === 'lead2') || {}).status);
  }, 'contatado'],
  ['devolve lead com motivo', direto(`tenantPath().collection('leadsImoveis').doc('lead2').update({status:'devolvido',corretorUid:null,corretorNome:null,motivoDevolucao:'fora da minha região',historico:[]})`), 'ok'],
  ['lead de fora da caixa dele é barrado', direto(`tenantPath().collection('leadsImoveis').doc('lead2').get()`), /NEGADO/],
]);

await browser.close();
await env.cleanup();
let falhou = 0;
for (const r of relatorio) {
  console.log(`\n=== ${r.nome} — ${r.secoes} telas abertas ===`);
  if (r.erros.length) { falhou += r.erros.length; r.erros.forEach(e => console.log('  ⛔ ' + e)); } else console.log('  ✓ nenhuma tela com erro de permissão');
  r.resultados.forEach(x => { console.log('  ' + x); if (x.startsWith('✗')) falhou++; });
}
console.log(`\n${falhou ? falhou + ' PROBLEMA(S)' : 'TUDO OK'}`);
process.exit(falhou ? 1 : 0);
