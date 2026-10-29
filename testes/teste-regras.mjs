// Testes das regras do Firestore no emulador (DRG-Rently)
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, addDoc, collection, query, where, serverTimestamp, increment } from 'firebase/firestore';
import { readFileSync } from 'fs';

const T = 'tenantA';
const env = await initializeTestEnvironment({
  projectId: 'demo-rently',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

// ---------- dados iniciais (regras desligadas) ----------
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const u = (uid, d) => setDoc(doc(db, 'users', uid), d);
  await setDoc(doc(db, 'tenants', T), { nome: 'Imob A', criadoPor: 'admin1', programaParceiros: { ativo: true } });
  await u('admin1', { role: 'admin', tenantId: T, perfilId: 'restrito' }); // admin com perfil restrito: piso libera
  await u('op0', { role: 'operador', tenantId: T });                       // sem perfil, sem seed → padrão do código
  await u('op1', { role: 'operador', tenantId: T, perfilId: 'restrito' }); // 3.0
  await u('op2', { role: 'operador', tenantId: T, perfilId: 'v20' });      // 2.0
  await u('op3', { role: 'operador', tenantId: T, perfilId: 'lista' });    // lista de módulos
  await u('op4', { role: 'operador', tenantId: T, perfilId: 'leitor' });   // só vê contratos/balancetes
  await u('cor1', { role: 'corretor', tenantId: T, ativo: true });
  await u('super', { role: 'super_admin' });
  await u('opSite', { role: 'operador', tenantId: T, perfilId: 'editorSite' }); // edita o site, não publica
  await u('opPub', { role: 'operador', tenantId: T, perfilId: 'publicaSite' }); // edita e publica
  await setDoc(doc(db, 'tenants', T, 'perfis', 'editorSite'), { permissoes: { site: { ver: true, criar: 'nao', editar: 'sim', excluir: 'nao' } }, acoes: { publicarSite: 'nao' } });
  await setDoc(doc(db, 'tenants', T, 'perfis', 'publicaSite'), { permissoes: { site: { ver: true, criar: 'nao', editar: 'sim', excluir: 'nao' } }, acoes: { publicarSite: 'sim' } });
  const P = (id, d) => setDoc(doc(db, 'tenants', T, 'perfis', id), d);
  await P('restrito', { permissoes: {
    imoveis: { ver: true, criar: 'sim', editar: 'aprovacao', excluir: 'nao' },
    contratos: { ver: true, criar: 'sim', editar: 'sim', excluir: 'nao' },
    leads: { ver: true, criar: 'nao', editar: 'sim', excluir: 'nao' },
  } });
  await P('v20', { permissoes: { imoveis: { ver: true, editar: true }, contratos: { acesso: true, editar: false } } });
  await P('lista', { modulos: ['imoveis'] });
  await P('leitor', { permissoes: { contratos: { ver: true, criar: 'nao', editar: 'nao', excluir: 'nao' },
                                     balancetes: { ver: true, criar: 'nao', editar: 'nao', excluir: 'nao' } } });
  await setDoc(doc(db, 'tenants', T, 'imoveis', 'im1'), { apelido: 'Casa', status: 'disponivel', criadoPor: 'cor1' });
  await setDoc(doc(db, 'tenants', T, 'imoveis', 'im2'), { apelido: 'Apto', status: 'disponivel', criadoPor: 'admin1' });
  await setDoc(doc(db, 'tenants', T, 'vitrine', 'im2'), { linkPublico: true, apelido: 'Apto' });
  await setDoc(doc(db, 'tenants', T, 'contratos', 'c1'), { status: 'rascunho', zapsign: { status: 'pending' } });
  await setDoc(doc(db, 'tenants', T, 'contratos', 'c2'), { status: 'rascunho', zapsign: { status: 'signed' } });
  await setDoc(doc(db, 'tenants', T, 'garantias', 'g1'), { tipo: 'caucao' });
  await setDoc(doc(db, 'tenants', T, 'contratos', 'c3'), { status: 'rascunho' });
  await setDoc(doc(db, 'tenants', T, 'leadsImoveis', 'L1'), { status: 'novo', nome: 'x' });
  await u('cor2', { role: 'corretor', tenantId: T, ativo: true });
  await setDoc(doc(db, 'tenants', T, 'leadsImoveis', 'L2'), { status: 'novo', nome: 'Ana', corretorUid: 'cor1', corretorNome: 'Cor 1', historico: [] });
  await setDoc(doc(db, 'tenants', T, 'leadsImoveis', 'L3'), { status: 'novo', nome: 'Beto', corretorUid: 'cor2', corretorNome: 'Cor 2', historico: [] });
  await setDoc(doc(db, 'tenants', T, 'leadsImoveis', 'L4'), { status: 'novo', nome: 'Caio', corretorUid: 'cor1', corretorNome: 'Cor 1', historico: [] });
  for (const [id, cor] of [['L2', 'cor1'], ['L3', 'cor2'], ['L4', 'cor1']]) {
    await setDoc(doc(db, 'tenants', T, 'leadsCorretor', id), { status: 'novo', primeiroNome: 'Cliente', corretorUid: cor, historico: [] });
  }
  await setDoc(doc(db, 'tenants', T, 'corretores', 'cor1'), { nome: 'Cor 1', telefone: '11911112222', status: 'ativo', tipo: 'equipe' });
  await setDoc(doc(db, 'tenants', T, 'corretores', 'cor2'), { nome: 'Cor 2', telefone: '11933334444', status: 'ativo', tipo: 'equipe' });
  await setDoc(doc(db, 'tenants', T, 'imoveis', 'imC'), { apelido: 'Casa do cor1', criadoPor: 'cor1', linkPublico: true, compartilhadoCom: ['cor2'] });
  await setDoc(doc(db, 'tenants', T, 'balancetes', 'b1'), { status: 'fechado', total: 10 });
  await setDoc(doc(db, 'tenants', T, 'config', 'site'), { workerGeminiUrl: 'x', zapsignToken: 'segredo' });
  await setDoc(doc(db, 'tenants', T, 'config', 'ia'), { workerGeminiUrl: 'x' });
  await setDoc(doc(db, 'tenants', T, 'contadores', 'anuncios'), { seq: 5, prefixo: 'IMA' });
  await setDoc(doc(db, 'tenants', T, 'estatisticas', 'im2_2026-10'), { imovelId: 'im2', mes: '2026-10', visitas: 3 });
});

const db = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const R = (d, ...p) => doc(d, 'tenants', T, ...p);
let ok = 0, falhas = 0;
async function caso(nome, esperado, fn) {
  try { await (esperado ? assertSucceeds(fn()) : assertFails(fn())); ok++; console.log('✓', nome); }
  catch (e) { falhas++; console.log('✗', nome, '→', (e.message || '').split('\n')[0].slice(0, 160)); }
}

// ---------- Perfis no servidor ----------
await caso('op0 sem perfil: cria imóvel (como sempre)', true, () => setDoc(R(db('op0'), 'imoveis', 'n0'), { apelido: 'x' }));
await caso('op0 sem perfil: edita imóvel', true, () => updateDoc(R(db('op0'), 'imoveis', 'im2'), { apelido: 'y' }));
await caso('op0 sem perfil: exclui contrato', true, () => deleteDoc(R(db('op0'), 'contratos', 'c3')));
await caso('op1 restrito: cria imóvel (✅)', true, () => setDoc(R(db('op1'), 'imoveis', 'n1'), { apelido: 'x' }));
await caso('op1 restrito: edita imóvel direto (🕓) BLOQUEIA', false, () => updateDoc(R(db('op1'), 'imoveis', 'im2'), { apelido: 'z' }));
await caso('op1 restrito: exclui imóvel (⛔) BLOQUEIA', false, () => deleteDoc(R(db('op1'), 'imoveis', 'im2')));
await caso('op1 restrito: pede alteração na fila', true, () => addDoc(collection(db('op1'), 'tenants', T, 'alteracoesPendentes'), { status: 'PENDENTE', colecao: 'imoveis' }));
await caso('op1 restrito: contrato muda SÓ status do imóvel (efeito colateral)', true, () => updateDoc(R(db('op1'), 'imoveis', 'im2'), { status: 'alugado' }));
await caso('op1 restrito: status + outro campo BLOQUEIA', false, () => updateDoc(R(db('op1'), 'imoveis', 'im2'), { status: 'alugado', apelido: 'w' }));
await caso('op1 restrito: excluir garantia sem poder excluir contrato BLOQUEIA', false, () => deleteDoc(R(db('op1'), 'garantias', 'g1')));
await caso('op1 restrito: módulo que não vê (locadores) BLOQUEIA', false, () => setDoc(R(db('op1'), 'locadores', 'l1'), { nome: 'x' }));
await caso('op1 restrito: config (sem trava de perfil)', true, () => setDoc(R(db('op1'), 'config', 'site'), { a: 1 }, { merge: true }));
await caso('op1 restrito: criar lead (⛔) BLOQUEIA', false, () => setDoc(R(db('op1'), 'leadsImoveis', 'L9'), { status: 'novo' }));
await caso('op1 restrito: editar lead (✅)', true, () => updateDoc(R(db('op1'), 'leadsImoveis', 'L1'), { status: 'contatado' }));
await caso('op2 formato 2.0 (editar:true): edita imóvel', true, () => updateDoc(R(db('op2'), 'imoveis', 'im2'), { apelido: 'v' }));
await caso('op2 formato 2.0 (editar:false): edita contrato BLOQUEIA', false, () => updateDoc(R(db('op2'), 'contratos', 'c1'), { numero: '1' }));
await caso('op3 lista: edita imóvel', true, () => updateDoc(R(db('op3'), 'imoveis', 'im2'), { apelido: 'u' }));
await caso('op3 lista: cria contrato BLOQUEIA', false, () => setDoc(R(db('op3'), 'contratos', 'c9'), { status: 'x' }));
await caso('op4 leitor: ZapSign atualiza assinatura', true, () => updateDoc(R(db('op4'), 'contratos', 'c1'), { zapsign: { status: 'pending', signers: [] } }));
await caso('op4 leitor: ZapSign marca vigente quando assinado', true, () => updateDoc(R(db('op4'), 'contratos', 'c2'), { status: 'vigente' }));
await caso('op4 leitor: muda status sem assinatura BLOQUEIA', false, () => updateDoc(R(db('op4'), 'contratos', 'c1'), { status: 'vigente' }));
await caso('op4 leitor: registra envio do balancete por e-mail', true, () => updateDoc(R(db('op4'), 'balancetes', 'b1'), { status: 'enviado', emailEnviadoPara: 'a@b.c' }));
await caso('op4 leitor: altera valor do balancete BLOQUEIA', false, () => updateDoc(R(db('op4'), 'balancetes', 'b1'), { total: 99 }));
await caso('admin com perfil restrito: piso libera tudo', true, () => deleteDoc(R(db('admin1'), 'imoveis', 'n0')));
await caso('super admin: grava qualquer coisa', true, () => setDoc(R(db('super'), 'contratos', 'c7'), { status: 'x' }));
await caso('corretor: cria imóvel próprio (regra dele)', true, () => setDoc(R(db('cor1'), 'imoveis', 'n2'), { apelido: 'x', criadoPor: 'cor1' }));
await caso('corretor: mexe em contrato BLOQUEIA', false, () => setDoc(R(db('cor1'), 'contratos', 'c8'), { status: 'x' }));
await caso('corretor: soma +1 no contador do código', true, () => updateDoc(R(db('cor1'), 'contadores', 'anuncios'), { seq: 6 }));
await caso('corretor: pula número do contador BLOQUEIA', false, () => updateDoc(R(db('cor1'), 'contadores', 'anuncios'), { seq: 50 }));
await caso('corretor: registra a própria auditoria', true, () => addDoc(collection(db('cor1'), 'tenants', T, 'auditoria'), { acao: 'login', userId: 'cor1', userRole: 'corretor', timestamp: serverTimestamp() }));
await caso('corretor: auditoria em nome de outro BLOQUEIA', false, () => addDoc(collection(db('cor1'), 'tenants', T, 'auditoria'), { acao: 'login', userId: 'admin1', userRole: 'corretor', timestamp: serverTimestamp() }));
await caso('corretor: lê auditoria BLOQUEIA', false, () => getDoc(R(db('cor1'), 'auditoria', 'x')));
await caso('corretor: lê config/ia (endereço da IA)', true, () => getDoc(R(db('cor1'), 'config', 'ia')));
await caso('corretor: lê config/site (tokens) BLOQUEIA', false, () => getDoc(R(db('cor1'), 'config', 'site')));

// ---------- Leads repassados ao corretor ("Meus leads") ----------
const hist = [{ acao: 'x', em: '2026-10-13' }];
await caso('🔒 corretor: lê o lead ORIGINAL (telefone/e-mail do cliente) BLOQUEIA', false, () => getDoc(R(db('cor1'), 'leadsImoveis', 'L2')));
await caso('🔒 corretor: lista "Meus leads" no lead original BLOQUEIA', false, () => getDocs(query(collection(db('cor1'), 'tenants', T, 'leadsImoveis'), where('corretorUid', '==', 'cor1'))));
await caso('🔒 corretor: cria cópia de lead p/ si BLOQUEIA', false, () => setDoc(R(db('cor1'), 'leadsCorretor', 'L1'), { corretorUid: 'cor1', status: 'novo', historico: [] }));
await caso('corretor: lê lead repassado a ele', true, () => getDoc(R(db('cor1'), 'leadsCorretor', 'L2')));
await caso('corretor: lê lead de outro corretor BLOQUEIA', false, () => getDoc(R(db('cor1'), 'leadsCorretor', 'L3')));
await caso('corretor: lê lead sem corretor BLOQUEIA', false, () => getDoc(R(db('cor1'), 'leadsCorretor', 'L1')));
await caso('corretor: lista "Meus leads" (where corretorUid == eu)', true, () => getDocs(query(collection(db('cor1'), 'tenants', T, 'leadsCorretor'), where('corretorUid', '==', 'cor1'))));
await caso('corretor: lista todas as cópias BLOQUEIA', false, () => getDocs(collection(db('cor1'), 'tenants', T, 'leadsCorretor')));
await caso('corretor: marca contatado + anotação', true, () => updateDoc(R(db('cor1'), 'leadsCorretor', 'L2'), { status: 'contatado', notaCorretor: 'liguei', historico: hist }));
await caso('corretor: muda nome/telefone do cliente BLOQUEIA', false, () => updateDoc(R(db('cor1'), 'leadsCorretor', 'L2'), { nome: 'Outro', historico: hist }));
await caso('corretor: passa o lead pra outro corretor BLOQUEIA', false, () => updateDoc(R(db('cor1'), 'leadsCorretor', 'L2'), { corretorUid: 'cor2', historico: hist }));
await caso('corretor: devolve sem motivo BLOQUEIA', false, () => updateDoc(R(db('cor1'), 'leadsCorretor', 'L4'), { status: 'devolvido', corretorUid: null, historico: hist }));
await caso('corretor: devolve com motivo', true, () => updateDoc(R(db('cor1'), 'leadsCorretor', 'L4'), { status: 'devolvido', corretorUid: null, motivoDevolucao: 'fora da minha região', historico: hist }));
await caso('corretor: depois de devolver não lê mais', false, () => getDoc(R(db('cor1'), 'leadsCorretor', 'L4')));
await caso('corretor: mexe em lead de outro BLOQUEIA', false, () => updateDoc(R(db('cor1'), 'leadsCorretor', 'L3'), { status: 'contatado', historico: hist }));
await caso('equipe (editar leads ✅): grava a cópia sem contato p/ o corretor', true, () => setDoc(R(db('op1'), 'leadsCorretor', 'L1'), { corretorUid: 'cor1', primeiroNome: 'x', status: 'novo', historico: [] }));
await caso('equipe sem permissão de leads (op4): grava cópia BLOQUEIA', false, () => setDoc(R(db('op4'), 'leadsCorretor', 'L1'), { corretorUid: 'cor2', status: 'novo', historico: [] }));
await caso('equipe (editar leads ✅): repassa lead a corretor', true, () => updateDoc(R(db('op1'), 'leadsImoveis', 'L1'), { corretorUid: 'cor1', corretorNome: 'Cor 1', historico: hist }));
await caso('equipe sem perfil: cadastra lead manual', true, () => addDoc(collection(db('op0'), 'tenants', T, 'leadsImoveis'), { origem: 'manual', canal: 'whatsapp', nome: 'Zé', telefone: '11999999999', status: 'novo' }));

// ---------- Site público ----------
const lead = (extra = {}) => ({ origem: 'interesse_imovel', nome: 'Maria', telefone: '15991859779', imovelId: 'im2',
  status: 'novo', criadoEm: serverTimestamp(), melhorHorario: 'tarde', ...extra });
await caso('visitante: pedido de visita válido', true, () => addDoc(collection(db(), 'tenants', T, 'leadsImoveis'), lead()));
await caso('visitante: pedido com campo extra BLOQUEIA', false, () => addDoc(collection(db(), 'tenants', T, 'leadsImoveis'), lead({ admin: true })));
await caso('visitante: pedido p/ imóvel não publicado BLOQUEIA', false, () => addDoc(collection(db(), 'tenants', T, 'leadsImoveis'), lead({ imovelId: 'im1' })));
await caso('visitante: pedido com status forjado BLOQUEIA', false, () => addDoc(collection(db(), 'tenants', T, 'leadsImoveis'), lead({ status: 'convertido' })));
await caso('visitante: telefone inválido BLOQUEIA', false, () => addDoc(collection(db(), 'tenants', T, 'leadsImoveis'), lead({ telefone: 'abc' })));
await caso('visitante: "anuncie seu imóvel" antigo continua', true, () => addDoc(collection(db(), 'tenants', T, 'leadsImoveis'), { origem: 'vitrine_publica', status: 'novo', nome: 'João' }));
await caso('visitante: lê leads BLOQUEIA', false, () => getDoc(R(db(), 'leadsImoveis', 'qualquer')));
const est = (d) => R(d, 'estatisticas', 'im2_2026-10');
await caso('visitante: +1 visita', true, () => setDoc(est(db()), { imovelId: 'im2', mes: '2026-10', visitas: increment(1) }, { merge: true }));
await caso('visitante: +1 favorito (contador novo no doc)', true, () => setDoc(est(db()), { imovelId: 'im2', mes: '2026-10', favoritos: increment(1) }, { merge: true }));
await caso('visitante: +5 visitas BLOQUEIA', false, () => setDoc(est(db()), { imovelId: 'im2', mes: '2026-10', visitas: increment(5) }, { merge: true }));
await caso('visitante: zera visitas BLOQUEIA', false, () => updateDoc(est(db()), { visitas: 0 }));
await caso('visitante: dois contadores de uma vez BLOQUEIA', false, () => updateDoc(est(db()), { visitas: increment(1), contatos: increment(1) }));
await caso('visitante: cria estatística de mês novo', true, () => setDoc(R(db(), 'estatisticas', 'im2_2026-11'), { imovelId: 'im2', mes: '2026-11', visitas: increment(1) }, { merge: true }));
await caso('visitante: estatística com id trocado BLOQUEIA', false, () => setDoc(R(db(), 'estatisticas', 'outro_2026-11'), { imovelId: 'im2', mes: '2026-11', visitas: 1 }));
await caso('visitante: estatística de imóvel não publicado BLOQUEIA', false, () => setDoc(R(db(), 'estatisticas', 'im1_2026-11'), { imovelId: 'im1', mes: '2026-11', visitas: 1 }));
await caso('visitante: lê estatísticas BLOQUEIA', false, () => getDoc(est(db())));
await caso('visitante: apaga estatística BLOQUEIA', false, () => deleteDoc(est(db())));
await caso('equipe: lê estatísticas', true, () => getDoc(est(db('op1'))));

// ---------- Auditoria (17/10/2026): imutável e em nome próprio ----------
const aud = (uid, extra = {}) => ({ acao: 'update', entidade: 'imovel', entidadeId: 'im2', userId: uid, userRole: 'operador', timestamp: serverTimestamp(), ...extra });
await caso('auditoria: equipe registra em nome próprio', true, () => setDoc(R(db('op1'), 'auditoria', 'a1'), aud('op1')));
await caso('auditoria: registrar em nome de OUTRO BLOQUEIA', false, () => setDoc(R(db('op1'), 'auditoria', 'a2'), aud('op0')));
await caso('auditoria: hora forjada BLOQUEIA', false, () => setDoc(R(db('op1'), 'auditoria', 'a3'), aud('op1', { timestamp: new Date(2020, 0, 1) })));
await caso('auditoria: admin altera registro BLOQUEIA', false, () => updateDoc(R(db('admin1'), 'auditoria', 'a1'), { acao: 'login' }));
await caso('auditoria: admin apaga registro BLOQUEIA', false, () => deleteDoc(R(db('admin1'), 'auditoria', 'a1')));
await caso('auditoria: super admin apaga registro BLOQUEIA', false, () => deleteDoc(R(db('super'), 'auditoria', 'a1')));
await caso('auditoria: admin lê', true, () => getDoc(R(db('admin1'), 'auditoria', 'a1')));
await caso('auditoria: corretor lê BLOQUEIA', false, () => getDoc(R(db('cor1'), 'auditoria', 'a1')));

// ---------- Meu site (17/10/2026): editar e publicar são permissões delegadas ----------
const siteCfg = { config: { identidade: { nome: 'X' } } };
await caso('site: gestor edita o rascunho', true, () => setDoc(R(db('admin1'), 'site', 'rascunho'), siteCfg));
await caso('site: gestor publica', true, () => setDoc(R(db('admin1'), 'site', 'publicado'), siteCfg));
await caso('site: gestor grava versão no histórico', true, () => setDoc(R(db('admin1'), 'siteVersoes', 'v1'), siteCfg));
await caso('site: visitante lê o site publicado', true, () => getDoc(R(db(), 'site', 'publicado')));
await caso('site: visitante lê o rascunho BLOQUEIA', false, () => getDoc(R(db(), 'site', 'rascunho')));
await caso('site: operador sem perfil edita BLOQUEIA', false, () => setDoc(R(db('op0'), 'site', 'rascunho'), siteCfg));
await caso('site: operador com perfil "editar site" edita o rascunho', true, () => setDoc(R(db('opSite'), 'site', 'rascunho'), siteCfg));
await caso('site: operador que só edita publica BLOQUEIA', false, () => setDoc(R(db('opSite'), 'site', 'publicado'), siteCfg));
await caso('site: operador com "🚀 Publicar" publica', true, () => setDoc(R(db('opPub'), 'site', 'publicado'), siteCfg));
await caso('site: corretor edita BLOQUEIA', false, () => setDoc(R(db('cor1'), 'site', 'rascunho'), siteCfg));
await caso('site: ninguém apaga o histórico (gestor) BLOQUEIA', false, () => deleteDoc(R(db('admin1'), 'siteVersoes', 'v1')));
await caso('site: visitante grava BLOQUEIA', false, () => setDoc(R(db(), 'site', 'publicado'), siteCfg));

// ---------- 🔒 Blindagem de contato (17/10/2026): o contato é sempre o da imobiliária ----------
const imC = (d) => R(d, 'imoveis', 'imC');
await caso('blindagem: corretor lê o PRÓPRIO cartão', true, () => getDoc(R(db('cor1'), 'corretores', 'cor1')));
await caso('blindagem: corretor lê cartão (telefone) de COLEGA BLOQUEIA', false, () => getDoc(R(db('cor1'), 'corretores', 'cor2')));
await caso('blindagem: corretor lista todos os corretores BLOQUEIA', false, () => getDocs(collection(db('cor1'), 'tenants', T, 'corretores')));
await caso('blindagem: equipe lê os corretores', true, () => getDocs(collection(db('op0'), 'tenants', T, 'corretores')));
await caso('blindagem: descrição limpa passa', true, () => updateDoc(imC(db('cor1')), { descricaoLonga: 'Casa térrea, 3 quartos, 2 vagas.\nR$ 1.250.000,00 · 180 m² · reformada em 2021.' }));
for (const [nome, texto] of [
  ['celular com DDD', 'Linda casa! Ligue (11) 98765-4321'],
  ['celular só números', 'Interessados 11987654321'],
  ['celular com pontos', 'fone 11.98765.4321'],
  ['celular na 2ª linha', 'Ótima casa.\nContato 9 8765 4321'],
  ['número por extenso', 'chame no nove oito sete seis cinco quatro'],
  ['e-mail', 'Mais fotos: joao.corretor@gmail.com'],
  ['@perfil', 'Veja mais no @joaocorretor'],
  ['link', 'Detalhes em https://meusite.com.br/casa'],
  ['site sem https', 'Acesse joaoimoveis.com.br para mais'],
  ['wa.me', 'wa.me/5511987654321'],
  ['menção a WhatsApp', 'Chama no WhatsApp que te passo'],
  ['Instagram', 'Me segue no Instagram'],
]) {
  await caso(`blindagem: corretor põe ${nome} na descrição BLOQUEIA`, false, () => updateDoc(imC(db('cor1')), { descricaoLonga: texto }));
}
await caso('blindagem: telefone no título do anúncio BLOQUEIA', false, () => updateDoc(imC(db('cor1')), { tituloAnuncio: 'Casa 3 dorm - 11 98765-4321' }));
await caso('blindagem: e-mail nas tags BLOQUEIA', false, () => updateDoc(imC(db('cor1')), { tags: ['piscina', 'joao@gmail.com'] }));
await caso('blindagem: telefone no bairro BLOQUEIA', false, () => updateDoc(imC(db('cor1')), { endereco: { bairro: 'Centro 11987654321', cidade: 'SP' } }));
await caso('blindagem: vídeo do YouTube passa', true, () => updateDoc(imC(db('cor1')), { videoUrl: 'https://www.youtube.com/watch?v=abc', tourUrl: 'https://my.matterport.com/show/?m=x' }));
await caso('blindagem: vídeo/link do site pessoal BLOQUEIA', false, () => updateDoc(imC(db('cor1')), { videoUrl: 'https://joaoimoveis.com.br/video' }));
await caso('blindagem: tour = wa.me BLOQUEIA', false, () => updateDoc(imC(db('cor1')), { tourUrl: 'https://wa.me/5511987654321' }));
await caso('blindagem: corretor muda com quem compartilha a ficha BLOQUEIA', false, () => updateDoc(imC(db('cor1')), { compartilhadoCom: ['cor2', 'cor3'] }));
await caso('blindagem: corretor cria imóvel já compartilhado BLOQUEIA', false, () => setDoc(R(db('cor1'), 'imoveis', 'imD'), { apelido: 'x', criadoPor: 'cor1', compartilhadoCom: ['cor2'] }));
await caso('blindagem: corretor cria imóvel com telefone no apelido BLOQUEIA', false, () => setDoc(R(db('cor1'), 'imoveis', 'imD'), { apelido: 'Casa 11 98765-4321', criadoPor: 'cor1' }));
await caso('blindagem: equipe põe o telefone DA IMOBILIÁRIA na descrição (permitido)', true, () => updateDoc(R(db('op0'), 'imoveis', 'im2'), { descricaoLonga: 'Plantão (11) 5555-0000' }));
const fichaOk = { captadorUid: 'cor1', visivel: true, apelido: 'Casa', compartilhadoCom: ['cor2'] };
await caso('blindagem: corretor grava ficha limpa', true, () => setDoc(R(db('cor1'), 'imoveisRede', 'imC'), fichaOk));
await caso('blindagem: ficha com contato do captador BLOQUEIA', false, () => setDoc(R(db('cor1'), 'imoveisRede', 'imC'), { ...fichaOk, captador: { nome: 'Cor 1', telefone: '11911112222' } }));
await caso('blindagem: ficha com proprietário BLOQUEIA', false, () => setDoc(R(db('cor1'), 'imoveisRede', 'imC'), { ...fichaOk, proprietario: { nome: 'Dono', telefone: '11900000000' } }));
await caso('blindagem: ficha compartilhada diferente do imóvel BLOQUEIA', false, () => setDoc(R(db('cor1'), 'imoveisRede', 'imC'), { ...fichaOk, compartilhadoCom: ['cor2', 'cor9'] }));
await caso('blindagem: ficha completa com obs com telefone BLOQUEIA', false, () => setDoc(R(db('cor1'), 'imoveisRede', 'imC', 'completo', 'dados'), { obs: 'dono: 11 99999-0000' }));
await caso('blindagem: ficha completa limpa', true, () => setDoc(R(db('cor1'), 'imoveisRede', 'imC', 'completo', 'dados'), { apelido: 'Casa', obs: 'chave na portaria' }));
await caso('blindagem: vitrine com telefone na descrição BLOQUEIA', false, () => setDoc(R(db('cor1'), 'vitrine', 'imC'), { linkPublico: true, descricaoLonga: 'whats 11987654321' }));
await caso('blindagem: vitrine limpa', true, () => setDoc(R(db('cor1'), 'vitrine', 'imC'), { linkPublico: true, descricaoLonga: 'Casa ampla' }));
const pedido = (dados) => ({ solicitadoPor: 'cor1', status: 'PENDENTE', colecao: 'imoveis', modulo: 'imoveis', op: 'editar', docId: 'imC', dados });
await caso('blindagem: pedido na fila (Com aprovação) com texto limpo', true, () => addDoc(collection(db('cor1'), 'tenants', T, 'alteracoesPendentes'), pedido({ descricaoLonga: 'Casa ampla' })));
await caso('blindagem: pedido na fila com telefone BLOQUEIA', false, () => addDoc(collection(db('cor1'), 'tenants', T, 'alteracoesPendentes'), pedido({ descricaoLonga: 'liga 11 98765-4321' })));
await caso('blindagem: pedido na fila mudando compartilhamento BLOQUEIA', false, () => addDoc(collection(db('cor1'), 'tenants', T, 'alteracoesPendentes'), pedido({ compartilhadoCom: ['cor2'] })));
const foto = (extra) =>({ url: 'https://firebasestorage.googleapis.com/v0/b/x/o/f.jpg', ordem: 0, ...extra });
await caso('blindagem: foto com nome neutro', true, () => setDoc(R(db('cor1'), 'imoveis', 'imC', 'fotos', 'f1'), foto({ nome: 'foto-1.jpg' })));
await caso('blindagem: foto com telefone no nome BLOQUEIA', false, () => setDoc(R(db('cor1'), 'imoveis', 'imC', 'fotos', 'f2'), foto({ nome: 'liga_11987654321.jpg' })));
await caso('blindagem: foto com @ na legenda BLOQUEIA', false, () => setDoc(R(db('cor1'), 'imoveis', 'imC', 'fotos', 'f3'), foto({ legenda: 'siga @joao' })));

// ---------- 🛡 Proteção (17/10/2026): registro de cliente, CRECI e contrato ----------
const { writeBatch } = await import('firebase/firestore');
const regCliente = async (uid, regId, chave, extra = {}) => {
  const d = db(uid); const b = writeBatch(d);
  b.set(R(d, 'registrosCliente', regId), { corretorUid: uid, corretorNome: 'x', clienteNome: 'Cliente', telefone: '11987654321', email: null, procura: 'venda', codigoAnuncio: null, obs: null, chave, criadoEm: serverTimestamp(), ...extra });
  b.set(R(d, 'registrosClienteChave', chave), { corretorUid: uid, registroId: regId, criadoEm: serverTimestamp() });
  return b.commit();
};
await caso('proteção: corretor registra cliente (protocolo + chave)', true, () => regCliente('cor1', 'rg1', 'h1'));
await caso('proteção: OUTRO corretor registra o mesmo cliente BLOQUEIA', false, () => regCliente('cor2', 'rg2', 'h1'));
await caso('proteção: registro sem a chave BLOQUEIA', false, () => setDoc(R(db('cor1'), 'registrosCliente', 'rg3'), { corretorUid: 'cor1', corretorNome: 'x', clienteNome: 'C', telefone: '11987654321', procura: 'venda', chave: 'h9', criadoEm: serverTimestamp() }));
await caso('proteção: registro com data forjada BLOQUEIA', false, () => regCliente('cor1', 'rg4', 'h4', { criadoEm: new Date(2020, 0, 1) }));
await caso('proteção: corretor altera o registro BLOQUEIA', false, () => updateDoc(R(db('cor1'), 'registrosCliente', 'rg1'), { clienteNome: 'Outro' }));
await caso('proteção: corretor apaga o registro BLOQUEIA', false, () => deleteDoc(R(db('cor1'), 'registrosCliente', 'rg1')));
await caso('proteção: corretor lê o próprio registro', true, () => getDoc(R(db('cor1'), 'registrosCliente', 'rg1')));
await caso('proteção: colega lê o registro BLOQUEIA', false, () => getDoc(R(db('cor2'), 'registrosCliente', 'rg1')));
await caso('proteção: equipe anota a análise', true, () => updateDoc(R(db('op0'), 'registrosCliente', 'rg1'), { analise: 'valido' }));
await caso('proteção: equipe muda a data do registro BLOQUEIA', false, () => updateDoc(R(db('op0'), 'registrosCliente', 'rg1'), { criadoEm: new Date(2020, 0, 1) }));
await caso('proteção: admin apaga registro BLOQUEIA', false, () => deleteDoc(R(db('admin1'), 'registrosCliente', 'rg1')));
await caso('proteção: corretor marca o próprio CRECI conferido BLOQUEIA', false, () => updateDoc(R(db('cor1'), 'corretores', 'cor1'), { creciConferido: { em: 'x' } }));
await caso('proteção: corretor marca o próprio contrato assinado BLOQUEIA', false, () => updateDoc(R(db('cor1'), 'corretores', 'cor1'), { 'contratoParceria.status': 'signed' }));
await caso('proteção: corretor edita o próprio telefone (continua)', true, () => updateDoc(R(db('cor1'), 'corretores', 'cor1'), { telefone: '11900001111' }));
await caso('proteção: equipe registra CRECI conferido', true, () => updateDoc(R(db('op0'), 'corretores', 'cor2'), { creciConferido: { em: 'x', por: 'op0' } }));
await caso('proteção: corretor marca cliente identificado na cópia BLOQUEIA', false, () => updateDoc(R(db('cor1'), 'leadsCorretor', 'L2'), { clienteIdentificado: true, historico: hist }));

// ---------- 28/10/2026: leitura por módulo, exceção de contato, cadastro, carteira ----------
await env.withSecurityRulesDisabled(async (ctx) => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'users', 'cor3'), { role: 'corretor', tenantId: T, ativo: true });
  await setDoc(doc(d, 'tenants', T, 'corretores', 'cor3'), { nome: 'Cor 3', status: 'ativo', tipo: 'equipe', verContatoProprietario: true });
  await setDoc(doc(d, 'tenants', T, 'imoveisRede', 'fx'), { apelido: 'Ficha visível', visivel: true, captadorUid: 'cor2', compartilhadoCom: [] });
  await setDoc(doc(d, 'tenants', T, 'imoveisRede', 'fx', 'contato', 'proprietario'), { nome: 'Dono', telefone: '11999990000' });
  await setDoc(doc(d, 'tenants', T, 'imoveisRede', 'fy'), { apelido: 'Ficha privada', visivel: false, captadorUid: 'cor2', compartilhadoCom: [] });
  await setDoc(doc(d, 'tenants', T, 'imoveisRede', 'fy', 'contato', 'proprietario'), { nome: 'Dono 2', telefone: '11999991111' });
  await setDoc(doc(d, 'tenants', T, 'caixaPool', 'cx1'), { valor: 100, tipo: 'entrada' });
  await setDoc(doc(d, 'tenants', T, 'config', 'cadastro'), { cpf: '529.982.247-25', endereco: { cidade: 'Sorocaba', uf: 'SP' } });
});
await caso('leitura: operador SEM Leads no perfil lê um lead BLOQUEIA', false, () => getDoc(R(db('op4'), 'leadsImoveis', 'L1')));
await caso('leitura: operador SEM Leads lista os leads BLOQUEIA', false, () => getDocs(collection(db('op4'), 'tenants', T, 'leadsImoveis')));
await caso('leitura: operador SEM Leads lê cópia do corretor BLOQUEIA', false, () => getDoc(R(db('op4'), 'leadsCorretor', 'L2')));
await caso('leitura: operador COM Leads lê leads', true, () => getDocs(collection(db('op1'), 'tenants', T, 'leadsImoveis')));
await caso('leitura: operador sem perfil (padrão) lê leads', true, () => getDoc(R(db('op0'), 'leadsImoveis', 'L1')));
await caso('leitura: admin lê leads', true, () => getDoc(R(db('admin1'), 'leadsImoveis', 'L1')));
await caso('leitura: operador SEM Livro Caixa lê caixaPool BLOQUEIA', false, () => getDoc(R(db('op1'), 'caixaPool', 'cx1')));
await caso('leitura: admin lê caixaPool', true, () => getDoc(R(db('admin1'), 'caixaPool', 'cx1')));
await caso('leitura: operador sem Leads continua lendo contratos', true, () => getDoc(R(db('op4'), 'contratos', 'c1')));
await caso('leitura: operador sem Leads continua lendo imóveis', true, () => getDoc(R(db('op4'), 'imoveis', 'im2')));

await caso('exceção: corretor SEM liberação lê contato do proprietário BLOQUEIA', false, () => getDoc(R(db('cor1'), 'imoveisRede', 'fx', 'contato', 'proprietario')));
await caso('exceção: corretor LIBERADO lê contato do proprietário (ficha visível)', true, () => getDoc(R(db('cor3'), 'imoveisRede', 'fx', 'contato', 'proprietario')));
await caso('exceção: corretor liberado lê contato de ficha PRIVADA BLOQUEIA', false, () => getDoc(R(db('cor3'), 'imoveisRede', 'fy', 'contato', 'proprietario')));
await caso('exceção: corretor liberado grava contato BLOQUEIA', false, () => setDoc(R(db('cor3'), 'imoveisRede', 'fx', 'contato', 'proprietario'), { nome: 'x' }));
await caso('exceção: corretor se libera sozinho BLOQUEIA', false, () => updateDoc(R(db('cor1'), 'corretores', 'cor1'), { verContatoProprietario: true }));
await caso('exceção: equipe grava o contato da ficha', true, () => setDoc(R(db('op0'), 'imoveisRede', 'fx', 'contato', 'proprietario'), { nome: 'Dono', telefone: '11999990000' }));
await caso('exceção: equipe libera o corretor', true, () => updateDoc(R(db('op0'), 'corretores', 'cor1'), { verContatoProprietario: false }));
await caso('exceção: visitante lê contato BLOQUEIA', false, () => getDoc(R(db(null), 'imoveisRede', 'fx', 'contato', 'proprietario')));

await caso('cadastro: corretor completa CPF e endereço no próprio cartão', true, () => updateDoc(R(db('cor1'), 'corretores', 'cor1'), { documento: '529.982.247-25', endereco: { cep: '18010-000', cidade: 'Sorocaba', uf: 'SP' }, telefone: '11911112222' }));
await caso('cadastro: corretor lê o cadastro privado da imobiliária BLOQUEIA', false, () => getDoc(R(db('cor1'), 'config', 'cadastro')));
await caso('cadastro: visitante lê o cadastro privado (CPF) BLOQUEIA', false, () => getDoc(R(db(null), 'config', 'cadastro')));
await caso('cadastro: equipe lê o cadastro privado', true, () => getDoc(R(db('op0'), 'config', 'cadastro')));
await caso('cadastro: admin tira o CPF do doc público', true, () => updateDoc(doc(db('admin1'), 'tenants', T), { cidade: 'Sorocaba', uf: 'SP' }));

await caso('distribuição: quem edita Leads atribui automático', true, () => updateDoc(R(db('op1'), 'leadsImoveis', 'L1'), { corretorUid: 'cor2', corretorNome: 'Cor 2', atribuidoPor: 'auto', distribuicaoAuto: { motivo: 'rodizio' } }));
await caso('distribuição: grava a cópia sem contato do corretor', true, () => setDoc(R(db('op1'), 'leadsCorretor', 'L1'), { corretorUid: 'cor2', primeiroNome: 'x', status: 'novo', historico: [] }));
await caso('distribuição: quem NÃO edita Leads atribui BLOQUEIA', false, () => updateDoc(R(db('op4'), 'leadsImoveis', 'L1'), { corretorUid: 'cor1' }));
await caso('distribuição: grava o ponteiro do rodízio', true, () => setDoc(R(db('op0'), 'config', 'distribuicaoLeads'), { rodizioUltimoUid: 'cor2' }, { merge: true }));

await caso('carteira: equipe passa o imóvel para outro corretor', true, () => updateDoc(R(db('admin1'), 'imoveis', 'im1'), { criadoPor: 'cor2', carteiraAnterior: { uid: 'cor1' } }));
await caso('carteira: novo dono (cor2) lê o imóvel', true, () => getDoc(R(db('cor2'), 'imoveis', 'im1')));
await caso('carteira: antigo dono (cor1) lê o imóvel BLOQUEIA', false, () => getDoc(R(db('cor1'), 'imoveis', 'im1')));
await caso('carteira: corretor se apropria de imóvel alheio BLOQUEIA', false, () => updateDoc(R(db('cor1'), 'imoveis', 'im1'), { criadoPor: 'cor1' }));

// ---------- 29/10/2026: converter tipo de conta (Super Admin) ----------
await env.withSecurityRulesDisabled(async (ctx) => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'tenants', 'tErrado'), { nome: 'Conta errada', tipoPessoa: 'PF', criadoPor: 'dona' });
  await setDoc(doc(d, 'users', 'dona'), { role: 'admin', tenantId: 'tErrado', nome: 'Dona', email: 'dona@x.com' });
});
const conv = (uid) => { const d = db(uid); const b = writeBatch(d);
  b.set(doc(d, 'tenants', T, 'corretores', 'dona'), { uid: 'dona', nome: 'Dona', tipo: 'parceiro', status: 'ativo', origem: 'conversao' }, { merge: true });
  b.update(doc(d, 'users', 'dona'), { role: 'corretor', tenantId: T, ativo: true, status: 'ativo', perfilId: null });
  b.update(doc(d, 'tenants', 'tErrado'), { arquivado: true, ativo: false });
  return b.commit(); };
await caso('conversão: admin de outra imobiliária converte BLOQUEIA', false, () => conv('admin1'));
await caso('conversão: a própria pessoa se converte em parceiro BLOQUEIA', false, () => conv('dona'));
await caso('conversão: Super Admin converte conta própria → parceiro', true, () => conv('super'));
await caso('conversão: convertida lê o próprio cartão de parceiro', true, () => getDoc(R(db('dona'), 'corretores', 'dona')));
await caso('conversão: Super Admin dá conta própria ao parceiro', true, () => { const d = db('super'); const b = writeBatch(d);
  b.set(doc(d, 'tenants', 'tNovo'), { nome: 'Conta nova', tipoPessoa: 'PF', plano: 'trial', ativo: true, criadoPor: 'super' });
  b.update(doc(d, 'users', 'dona'), { role: 'admin', tenantId: 'tNovo', ativo: true, status: 'ativo', perfilId: null });
  b.update(doc(d, 'tenants', T, 'corretores', 'dona'), { status: 'suspenso', convertidoPara: 'tNovo' });
  return b.commit(); });
await caso('conversão: Super Admin grava o cadastro privado da conta nova', true, () => setDoc(doc(db('super'), 'tenants', 'tNovo', 'config', 'cadastro'), { cpf: '529.982.247-25' }));
await caso('conversão: ex-parceiro (agora admin da conta nova) lê imóveis da antiga BLOQUEIA', false, () => getDoc(R(db('dona'), 'imoveis', 'im2')));

console.log(`\n${ok} ok · ${falhas} falha(s)`);
await env.cleanup();
process.exit(falhas ? 1 : 0);
