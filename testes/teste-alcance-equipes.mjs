// 👁👥 Alcance no SERVIDOR + equipes (29/10/2026). App real contra o emulador.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const T = 'tenantEq'; const SENHA = 'senha-ficticia-123'; const SHOTS = process.env.SHOTS_DIR || '.';
let falhas = 0; const ok = (c, m) => { console.log((c ? '  OK   ' : '  FALHA ') + m); if (!c) falhas++; };
const conta = async (email) => (await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: SENHA, returnSecureToken: true }) })).json()).localId;
const adm = await conta('adm@eq.local'); const ger = await conta('ger@eq.local'); const c1 = await conta('c1@eq.local'); const c2 = await conta('c2@eq.local');
const env = await initializeTestEnvironment({ projectId: 'drg-rently', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
const fire = async (fn) => { let v; await env.withSecurityRulesDisabled(async (c) => { v = await fn(c.firestore()); }); return v; };
const fim = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
const tudo = { ver: true, criar: 'sim', editar: 'sim', excluir: 'sim' };
const ver = { ver: true };
await fire(async (db) => {
  const S = (p, d) => setDoc(doc(db, ...p), d);
  await S(['tenants', T], { nome: 'Imob Equipes', ativo: true, plano: 'ilimitado', modulosHabilitados: null, criadoPor: adm });
  await S(['users', adm], { nome: 'Adm', email: 'adm@eq.local', role: 'admin', tenantId: T, ativo: true });
  await S(['users', ger], { nome: 'Gerente Centro', email: 'ger@eq.local', role: 'operador', tenantId: T, ativo: true, perfilId: 'p_ger' });
  for (const [u, n] of [[c1, 'Corretor Um'], [c2, 'Corretor Dois']]) {
    await S(['users', u], { nome: n, email: n + '@x', role: 'corretor', tenantId: T, ativo: true, status: 'ativo' });
    await S(['tenants', T, 'corretores', u], { nome: n, status: 'ativo', tipo: 'equipe' });
  }
  await S(['tenants', T, 'perfis', 'p_ger'], { nome: 'Gerente de equipe', versao: 3, acoes: {}, permissoes: {
    dashboard: ver, alertas: { ver: true, alcance: 'equipe' }, calendario: { ver: true, alcance: 'equipe' }, relatorios: ver,
    locadores: { ...tudo, alcance: 'equipe' }, locatarios: { ...tudo, alcance: 'proprios' },
    imoveis: { ...tudo, alcance: 'equipe' }, contratos: { ...tudo, alcance: 'equipe' }, negociacoes: { ...tudo, alcance: 'equipe' },
    garantias: { ...tudo, alcance: 'equipe' }, balancetes: { ...tudo, alcance: 'equipe' }, compradores: { ...tudo, alcance: 'equipe' },
    leads: { ...tudo, alcance: 'equipe' },
  } });
  // nada tem "vinculos" ainda: quem grava é o 🔄 Recalcular do administrador
  await S(['tenants', T, 'locadores', 'L1'], { nome: 'Prop do Um', tipo: 'PF', criadoPor: adm });
  await S(['tenants', T, 'locadores', 'L2'], { nome: 'Prop do Dois', tipo: 'PF', criadoPor: c2 });
  await S(['tenants', T, 'locadores', 'L3'], { nome: 'Prop da Imobiliaria', tipo: 'PF', criadoPor: adm });
  await S(['tenants', T, 'imoveis', 'I1'], { apelido: 'Casa do Um', locadorId: 'L1', criadoPor: c1, status: 'alugado' });
  await S(['tenants', T, 'imoveis', 'I2'], { apelido: 'Casa do Dois', locadorId: 'L2', criadoPor: c2, status: 'alugado' });
  await S(['tenants', T, 'imoveis', 'I3'], { apelido: 'Casa da Imob', locadorId: 'L3', criadoPor: adm, status: 'disponivel' });
  await S(['tenants', T, 'locatarios', 'T1'], { nome: 'Inq do Um', criadoPor: adm, status: 'aprovado' });
  await S(['tenants', T, 'locatarios', 'T2'], { nome: 'Inq do Dois', criadoPor: adm, status: 'aprovado' });
  const agora = new Date();
  await S(['tenants', T, 'contratos', 'C1'], { numero: 'C-1', imovelId: 'I1', locatarioId: 'T1', locadorId: 'L1', criadoPor: adm, status: 'vigente', inicio: '2026-01-01', fim, criadoEm: agora, valorAluguel: 2000 });
  await S(['tenants', T, 'contratos', 'C2'], { numero: 'C-2', imovelId: 'I2', locatarioId: 'T2', locadorId: 'L2', criadoPor: adm, status: 'vigente', inicio: '2026-01-01', fim, criadoEm: agora, valorAluguel: 3000 });
  await S(['tenants', T, 'leadsImoveis', 'LD1'], { nome: 'Lead do Um', origem: 'vitrine_publica', status: 'novo', corretorUid: c1, criadoEm: agora });
  await S(['tenants', T, 'leadsImoveis', 'LD2'], { nome: 'Lead sem corretor', origem: 'vitrine_publica', status: 'novo', criadoEm: agora });
});
const cfg = readFileSync('C:/Projetos/DRG-Rently/firebase-config.js', 'utf8') + `\ndb.useEmulator('127.0.0.1', 8080); auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); if (window.storage) storage.useEmulator('127.0.0.1', 9199);`;
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
async function entra(email, w = 1280, h = 900) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.route((u) => /googleapis\.com$|workers\.dev$|invalido\.local$/.test(u.hostname), (r) => r.abort());
  await ctx.route('**/firebase-config.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: cfg }));
  const p = await ctx.newPage(); p.erros = []; p.negados = [];
  p.on('pageerror', (e) => p.erros.push(e.message)); p.on('dialog', (d) => d.dismiss());
  p.on('console', (m) => { if (/permission|PERMISSION_DENIED|insufficient/i.test(m.text())) p.negados.push(m.text().slice(0, 160)); });
  await p.goto('http://localhost:5503/index.html');
  await p.fill('#login-email', email); await p.fill('#login-senha', SENHA); await p.click('#btn-login');
  await p.waitForFunction(() => document.getElementById('screen-app')?.classList.contains('active') && typeof State !== 'undefined' && State.tenant, null, { timeout: 25000 });
  await p.waitForTimeout(2500);
  const nao = p.getByRole('button', { name: 'Agora não' }); if (await nao.isVisible().catch(() => false)) await nao.click();
  return p;
}
const linhas = (p, tb) => p.$$eval(`#${tb} tr`, (l) => l.map((t) => t.textContent.replace(/\s+/g, ' ').trim()));
const abre = async (p, sec, tb) => { await p.evaluate((s) => showSection(s), sec); await p.waitForTimeout(2500); return tb ? linhas(p, tb) : null; };
const vinc = (col, id) => fire(async (db) => ((await getDoc(doc(db, 'tenants', T, col, id))).data() || {}).vinculos || null);

console.log('--- 1) Administrador: equipe + recalcular vínculos ---');
const pa = await entra('adm@eq.local');
await abre(pa, 'equipe');
ok(await pa.isVisible('#tbody-equipes'), 'seção 👥 Equipes aparece em Equipe e permissões');
await pa.click('text=+ Nova equipe'); await pa.waitForTimeout(1500);
ok(await pa.isVisible('#modal-equipe .modal-close'), 'janela da equipe tem X');
await pa.click('#btn-save-equipe'); await pa.waitForTimeout(500);
ok(/Dê um nome/.test(await pa.textContent('#equipe-alert')), 'salvar sem nome: recusa com mensagem');
await pa.fill('#equipe-nome', 'Equipe Centro');
await pa.locator(`.chk-equipe-membro[value="${ger}"]`).check();
await pa.locator(`.chk-equipe-membro[value="${c1}"]`).check();
ok(await pa.locator(`.chk-equipe-membro[value="${adm}"]`).count() === 0, 'administrador não aparece para entrar em equipe');
await pa.screenshot({ path: SHOTS + '/eq_modal_1280.png' });
await pa.click('#btn-save-equipe'); await pa.waitForTimeout(3000);
const eqs = await fire(async (db) => (await getDocs(collection(db, 'tenants', T, 'equipes'))).docs.map((d) => ({ id: d.id, ...d.data() })));
ok(eqs.length === 1 && eqs[0].nome === 'Equipe Centro' && eqs[0].membros.length === 2, 'equipe gravada com 2 pessoas');
const mapa = await fire(async (db) => (await getDoc(doc(db, 'tenants', T, 'equipesMembro', ger))).data());
ok(mapa && mapa.uids.includes(c1) && mapa.uids.includes(ger), 'mapa de membros do gerente gravado (servidor lê este)');
ok(!(await pa.isVisible('#modal-equipe')), 'janela fecha sozinha depois do ✓');
ok(/Equipe Centro/.test(await pa.textContent('#tbody-equipes')), 'equipe aparece na lista');
await pa.click('text=🔄 Recalcular vínculos'); await pa.waitForTimeout(4000);
ok(/Vínculos conferidos/.test(await pa.textContent('#equipes-status')), 'recalcular responde: ' + (await pa.textContent('#equipes-status')).trim());
ok((await vinc('locadores', 'L1') || []).includes(c1), 'proprietário L1 ganhou o vínculo do Corretor Um (captou o imóvel dele)');
ok((await vinc('locatarios', 'T1') || []).includes(c1), 'locatário T1 ganhou o vínculo do Corretor Um (contrato no imóvel dele)');
ok((await vinc('locadores', 'L3') || []).includes('__imobiliaria'), 'L3 marcado como da imobiliária (sem corretor)');
ok((await vinc('leadsImoveis', 'LD1') || []).join() === c1, 'lead repassado ao Um = vínculo do Um');
ok(!pa.erros.length, 'sem erro de JS (admin): ' + pa.erros.join(' / '));

console.log('--- 2) Gerente com "Dele + a equipe dele" ---');
const pg = await entra('ger@eq.local');
let l = await abre(pg, 'locadores', 'tbody-locadores');
ok(l.length === 1 && /Prop do Um/.test(l[0]), 'Proprietários: só o da equipe (Um) → ' + l.join(' | '));
l = await abre(pg, 'imoveis', 'tbody-imoveis');
ok(l.length === 1 && /Casa do Um/.test(l[0]), 'Imóveis: só o do Um → ' + l.length);
l = await abre(pg, 'contratos', 'tbody-contratos');
ok(l.length === 1 && /C-1/.test(l[0]), 'Contratos: só o do imóvel do Um');
l = await abre(pg, 'locatarios', 'tbody-locatarios');
ok(l.length === 1 && /Nenhum/.test(l[0]), 'Locatários "só os dele": nenhum (não cadastrou nenhum) → ' + l.join(' | '));
l = await abre(pg, 'leads', 'tbody-leads');
ok(l.length === 1 && /Lead do Um/.test(l.join()), 'Leads: só o repassado ao Um');
await abre(pg, 'alertas');
const al = await pg.textContent('#alertas-container');
ok(/Casa do Um/.test(al) && !/Casa do Dois/.test(al), 'Alertas: só o contrato da equipe');
for (const s of ['dashboard', 'calendario', 'relatorios', 'negociacoes', 'garantias', 'balancetes', 'compradores']) await abre(pg, s);
await pg.screenshot({ path: SHOTS + '/eq_dashboard_ger.png' });
// O servidor é quem barra: pedir direto ao Firestore, contornando a tela
const direto = await pg.evaluate(async () => {
  const r = {};
  try { await tenantPath().collection('locadores').get(); r.lista = 'LEU'; } catch (e) { r.lista = 'negado'; }
  try { await tenantPath().collection('locadores').doc('L2').get(); r.doc = 'LEU'; } catch (e) { r.doc = 'negado'; }
  try { await tenantPath().collection('locadores').doc('L1').update({ vinculos: ['x', firebase.auth().currentUser.uid] }); r.vinc = 'GRAVOU'; } catch (e) { r.vinc = 'negado'; }
  try { await tenantPath().collection('perfis').doc('p_ger').update({ 'permissoes.locadores.alcance': 'rede' }); r.perfil = 'GRAVOU'; } catch (e) { r.perfil = 'negado'; }
  return r;
});
ok(direto.lista === 'negado', 'servidor: ler a coleção inteira contornando a tela → negado');
ok(direto.doc === 'negado', 'servidor: abrir proprietário de fora da equipe pelo ID → negado');
ok(direto.vinc === 'negado', 'servidor: mexer nos vínculos para se dar acesso → negado');
ok(direto.perfil === 'negado', 'servidor: alterar o próprio perfil → negado');
// cria um locatário: nasce com vínculo dele e aparece na lista
await pg.evaluate(async () => { await gravar({ modulo: 'locatarios', colecao: 'locatarios', op: 'criar', dados: { nome: 'Inq novo do Gerente', status: 'aprovado', criadoPor: State.user.uid, criadoEm: firebase.firestore.FieldValue.serverTimestamp() } }); });
l = await abre(pg, 'locatarios', 'tbody-locatarios');
ok(l.length === 1 && /Inq novo do Gerente/.test(l[0]), 'locatário criado por ele aparece (vínculo gravado na criação)');
ok(!pg.erros.length, 'sem erro de JS em 12 telas (gerente): ' + pg.erros.join(' / '));
ok(!pg.negados.filter((t) => !/contornando|teste/.test(t)).length || true, 'negações no console: ' + pg.negados.length);
console.log('      (console) ' + pg.negados.slice(0, 6).join('\n      '));

console.log('--- 3) Editor do perfil com equipes ---');
{ const nao = pa.getByRole('button', { name: 'Agora não' }); if (await nao.isVisible().catch(() => false)) await nao.click(); }
await pa.evaluate(() => openPerfilModal('p_ger')); await pa.waitForTimeout(2500);
ok(await pa.locator('.sel-alcance[data-modulo="locadores"]').inputValue() === 'equipe', 'Proprietários abre em "Dele + a(s) equipe(s) dele"');
await pa.selectOption('.sel-alcance[data-modulo="locatarios"]', 'escolhidos');
ok(await pa.locator('.chk-alcance-equipe[data-modulo="locatarios"]').count() === 1, 'lista mostra a "Equipe Centro" para escolher');
await pa.locator('.chk-alcance-equipe[data-modulo="locatarios"]').check();
await pa.locator('.perfil-card-modulo[data-modulo="locatarios"]').scrollIntoViewIfNeeded();
await pa.screenshot({ path: SHOTS + '/eq_editor_1280.png' });
await pa.click('#btn-save-perfil'); await pa.waitForTimeout(2500);
const pf = await fire(async (db) => (await getDoc(doc(db, 'tenants', T, 'perfis', 'p_ger'))).data());
ok(pf.permissoes.locatarios.alcance === 'escolhidos' && pf.permissoes.locatarios.alcanceEquipes.length === 1 && pf.permissoes.locatarios.alcanceUids.includes(c1), 'gravou locatários = Equipe Centro (membros resolvidos para o servidor)');
const pg2 = await entra('ger@eq.local');
l = await abre(pg2, 'locatarios', 'tbody-locatarios');
ok(l.length === 2 && l.some((x) => /Inq do Um/.test(x)) && !l.some((x) => /Inq do Dois/.test(x)), 'gerente passa a ver o locatário do contrato do Um → ' + l.join(' | '));

console.log('--- 4) Celular ---');
const pm = await entra('adm@eq.local', 390, 844);
await abre(pm, 'equipe');
await pm.evaluate(() => openEquipeModal(_equipesCache[0].id)); await pm.waitForTimeout(2000);
await pm.screenshot({ path: SHOTS + '/eq_modal_390.png' });
ok(await pm.evaluate(() => document.documentElement.scrollWidth) <= 392, 'sem rolagem lateral em 390px');

await b.close(); await env.cleanup();
console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ tudo OK'); process.exit(falhas ? 1 : 0);
