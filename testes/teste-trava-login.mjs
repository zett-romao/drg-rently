// 🔒 Trava de login (03/11/2026) — regras do Firestore no emulador.
// npx firebase emulators:exec --only firestore --project demo-rently "node teste-trava-login.mjs"
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, getDocs, collection, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'fs';

const T = 'tenantA';
const env = await initializeTestEnvironment({
  projectId: 'demo-rently',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});
const semRegras = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
await env.clearFirestore();
await semRegras(async (db) => {
  await setDoc(doc(db, 'tenants', T), { nome: 'Imob A', criadoPor: 'admin1' });
  await setDoc(doc(db, 'users', 'super'), { role: 'super_admin' });
  await setDoc(doc(db, 'users', 'opdrg'), { role: 'operador_drg' });
  await setDoc(doc(db, 'users', 'admin1'), { role: 'admin', tenantId: T });
  await setDoc(doc(db, 'users', 'op1'), { role: 'operador', tenantId: T });
  await setDoc(doc(db, 'users', 'cor1'), { role: 'corretor', tenantId: T, ativo: true });
  await setDoc(doc(db, 'tenants', T, 'imoveis', 'im1'), { apelido: 'Casa' });
});
const db = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const trava = (d) => semRegras((x) => setDoc(doc(x, 'plataforma', 'acesso'), d));
let ok = 0, falhas = 0;
async function caso(nome, esperado, fn) {
  try { await (esperado ? assertSucceeds(fn()) : assertFails(fn())); ok++; console.log('✓', nome); }
  catch (e) { falhas++; console.log('✗', nome, '→', (e.message || '').split('\n')[0].slice(0, 160)); }
}
const lerImovel = (uid) => () => getDoc(doc(db(uid), 'tenants', T, 'imoveis', 'im1'));
const signup = (uid) => () => {
  const d = db(uid); const b = writeBatch(d);
  b.set(doc(d, 'tenants', 'novo_' + uid), { nome: 'Nova', criadoPor: uid, plano: 'trial', ativo: true });
  b.set(doc(d, 'users', uid), { nome: 'N', email: 'n@x', tenantId: 'novo_' + uid, role: 'admin' });
  return b.commit();
};

// ---------- sem o doc da trava: tudo como antes ----------
await caso('sem trava: operador lê imóvel', true, lerImovel('op1'));
await caso('sem trava: signup de imobiliária', true, signup('novo1'));

// ---------- destravado ----------
await trava({ travado: false, permitidos: [] });
await caso('destravado: corretor lê imóvel', true, lerImovel('admin1'));

// ---------- TRAVADO, só o op1 liberado ----------
await trava({ travado: true, permitidos: ['op1'] });
await caso('travado: super_admin lê imóvel (piso)', true, lerImovel('super'));
await caso('travado: super_admin lista users', true, () => getDocs(collection(db('super'), 'users')));
await caso('travado: op1 (liberado) lê imóvel', true, lerImovel('op1'));
await caso('travado: op1 (liberado) grava imóvel', true, () => updateDoc(doc(db('op1'), 'tenants', T, 'imoveis', 'im1'), { apelido: 'y' }));
await caso('travado: admin1 (fora) NÃO lê imóvel', false, lerImovel('admin1'));
await caso('travado: admin1 (fora) NÃO grava imóvel', false, () => setDoc(doc(db('admin1'), 'tenants', T, 'imoveis', 'n1'), { apelido: 'x' }));
await caso('travado: admin1 (fora) NÃO lista usuários do tenant', false, () => getDocs(collection(db('admin1'), 'users')));
await caso('travado: admin1 (fora) NÃO altera o tenant', false, () => updateDoc(doc(db('admin1'), 'tenants', T), { telefone: '1' }));
await caso('travado: corretor (fora) NÃO lê imóvel', false, lerImovel('cor1'));
await caso('travado: operador_drg (fora) NÃO lê imóvel', false, lerImovel('opdrg'));
await caso('travado: admin1 ainda lê o PRÓPRIO users (app avisa)', true, () => getDoc(doc(db('admin1'), 'users', 'admin1')));
await caso('travado: admin1 NÃO edita o próprio users', false, () => updateDoc(doc(db('admin1'), 'users', 'admin1'), { nome: 'x' }));
await caso('travado: admin1 lê a trava', true, () => getDoc(doc(db('admin1'), 'plataforma', 'acesso')));
await caso('travado: visitante NÃO lê a trava', false, () => getDoc(doc(db(null), 'plataforma', 'acesso')));
await caso('travado: admin1 NÃO se libera sozinho', false, () => setDoc(doc(db('admin1'), 'plataforma', 'acesso'), { travado: false, permitidos: [] }));
await caso('travado: op1 (liberado) NÃO mexe na trava', false, () => setDoc(doc(db('op1'), 'plataforma', 'acesso'), { travado: false }));
await caso('travado: operador_drg NÃO mexe na trava', false, () => setDoc(doc(db('opdrg'), 'plataforma', 'acesso'), { travado: false }));
await caso('travado: signup de imobiliária nova BLOQUEIA', false, signup('novo2'));
await caso('travado: site público continua lendo o tenant', true, () => getDoc(doc(db(null), 'tenants', T)));

// ---------- super_admin trava e destrava ----------
await caso('super_admin destrava', true, () => setDoc(doc(db('super'), 'plataforma', 'acesso'), { travado: false, permitidos: ['op1'] }));
await caso('depois de destravar: admin1 lê imóvel', true, lerImovel('admin1'));
await caso('super_admin trava de novo', true, () => setDoc(doc(db('super'), 'plataforma', 'acesso'), { travado: true, permitidos: [] }));
await caso('op1 saiu da lista: NÃO lê mais', false, lerImovel('op1'));

console.log(`\n${ok} OK, ${falhas} falha(s)`);
await env.clearFirestore(); // não deixa o emulador travado para o próximo teste
await env.cleanup();
process.exit(falhas ? 1 : 0);
