// Testes das regras do Firestore no emulador (DRG-Rently)
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, addDoc, collection, serverTimestamp, increment } from 'firebase/firestore';
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

console.log(`\n${ok} ok · ${falhas} falha(s)`);
await env.cleanup();
process.exit(falhas ? 1 : 0);
