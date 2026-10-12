// =============================================================
// DRG-Rently — parceiro.js
// Página pública "Seja corretor parceiro" (autocadastro)
// URL: parceiro.html?t=<tenantId|slug>
//
// Lê o convite em tenants/{tid}.programaParceiros (doc público).
// Cria a conta no Firebase Auth + users/{uid} (role corretor, ativo:false,
// status:'pendente') + corretores/{uid} (status:'pendente'). As regras só
// aceitam esse formato e só com o programa ligado. O admin aprova na seção
// Corretores do app — até lá o login é recusado com aviso de "aguardando".
// =============================================================

const params = new URLSearchParams(window.location.search);
const tenantIdOrSlug = params.get('t');
let tenantId = null;
let programa = null;

const $$ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showError(titulo, msg) {
  $$('loading').style.display = 'none';
  $$('content').style.display = 'none';
  $$('error-state').style.display = 'flex';
  if (titulo) $$('error-titulo').textContent = titulo;
  if (msg) $$('error-msg').textContent = msg;
}

function showFormAlert(msg) {
  const el = $$('pp-alert');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

async function resolveTenantId(slugOrId) {
  if (!slugOrId) return null;
  const db = firebase.firestore();
  try {
    const direct = await db.collection('tenants').doc(slugOrId).get();
    if (direct.exists) return slugOrId;
  } catch (_) {}
  try {
    const snap = await db.collection('tenants').where('slug', '==', slugOrId).limit(1).get();
    if (!snap.empty) return snap.docs[0].id;
  } catch (_) {}
  return null;
}

(async function init() {
  if (!tenantIdOrSlug) { showError('Link incompleto', 'Peça o link do programa de parceiros à imobiliária.'); return; }
  try {
    tenantId = await resolveTenantId(tenantIdOrSlug);
    if (!tenantId) { showError('Imobiliária não encontrada', 'Confira o link recebido.'); return; }
    const tSnap = await firebase.firestore().collection('tenants').doc(tenantId).get();
    const tenant = tSnap.data() || {};
    programa = tenant.programaParceiros || {};
    if (programa.ativo !== true || tenant.ativo === false) {
      showError('Cadastro fechado no momento', `O programa de parceiros da ${tenant.nome || 'imobiliária'} não está recebendo cadastros agora.`);
      return;
    }

    const nome = tenant.nome || 'DRG-Rently';
    $$('header-empresa').textContent = nome;
    $$('footer-empresa').textContent = nome;
    $$('ano-rodape').textContent = new Date().getFullYear();
    if (tenant.logoUrl && /^https:\/\//i.test(tenant.logoUrl)) {
      document.querySelectorAll('.public-logo, .error-logo').forEach(img => { img.src = tenant.logoUrl; });
    }
    const titulo = programa.titulo || `Seja corretor parceiro da ${nome}`;
    $$('pp-titulo').textContent = titulo;
    document.title = `${titulo} — ${nome}`;
    $$('og-title').setAttribute('content', titulo);

    const itens = String(programa.texto || '').split('\n').map(s => s.trim()).filter(Boolean);
    $$('pp-beneficios').innerHTML = itens.map(i => `<li>${esc(i)}</li>`).join('');

    const c = programa.comissao || {};
    $$('pp-pct-captador').textContent = (c.captadorPct ?? '—') + '%';
    $$('pp-pct-vendedor').textContent = (c.vendedorPct ?? '—') + '%';
    $$('pp-pct-escritorio').textContent = (c.escritorioPct ?? '—') + '%';

    if (programa.exigeCreci === false) {
      $$('f-creci-label').classList.remove('required');
      $$('f-creci-label').textContent = 'CRECI (se tiver)';
    }
    $$('pp-link-login').href = location.pathname.replace(/[^/]*$/, '');

    $$('loading').style.display = 'none';
    $$('content').style.display = 'block';
  } catch (err) {
    console.error('Erro ao carregar programa:', err);
    showError('Erro ao carregar', err.message);
  }
})();

async function enviarCadastroParceiro() {
  showFormAlert('');
  const nome = $$('f-nome').value.trim();
  const creci = $$('f-creci').value.trim();
  const telefone = $$('f-telefone').value.replace(/\D/g, '');
  const email = $$('f-email').value.trim().toLowerCase();
  const senha = $$('f-senha').value;
  const senha2 = $$('f-senha2').value;

  if (nome.split(/\s+/).length < 2) return showFormAlert('Informe o nome completo.');
  if (programa.exigeCreci !== false && !creci) return showFormAlert('Informe seu CRECI.');
  if (telefone.length < 10) return showFormAlert('Telefone inválido (com DDD).');
  if (senha.length < 6) return showFormAlert('A senha precisa ter pelo menos 6 caracteres.');
  if (senha !== senha2) return showFormAlert('As senhas não coincidem.');
  if (!$$('f-aceite').checked) return showFormAlert('É preciso aceitar as condições do programa.');

  const btn = $$('btn-enviar');
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  let user = null;
  try {
    const cred = await firebase.auth().createUserWithEmailAndPassword(email, senha);
    user = cred.user;
    const db = firebase.firestore();
    const agora = firebase.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(db.collection('users').doc(user.uid), {
      nome, email, tenantId,
      role: 'corretor', ativo: false, status: 'pendente',
      origem: 'autocadastro', criadoEm: agora,
    });
    batch.set(db.collection('tenants').doc(tenantId).collection('corretores').doc(user.uid), {
      uid: user.uid, nome, email, telefone, creci: creci || null,
      tipo: 'parceiro', status: 'pendente',
      origem: 'autocadastro', aceiteTermosEm: agora, criadoEm: agora,
    });
    await batch.commit();
    await firebase.auth().signOut();
    $$('pp-form').style.display = 'none';
    $$('pp-ok').style.display = 'block';
  } catch (err) {
    console.error('Erro no cadastro de parceiro:', err);
    // Conta criada mas dados não gravados → desfaz pra pessoa poder tentar de novo
    if (user) { try { await user.delete(); } catch (_) {} }
    const msgs = {
      'auth/email-already-in-use': 'Este e-mail já tem conta no sistema. Use outro e-mail ou fale com a imobiliária.',
      'auth/invalid-email': 'E-mail inválido.',
      'auth/weak-password': 'Senha fraca — use pelo menos 6 caracteres.',
      'permission-denied': 'O programa de parceiros não está aceitando cadastros agora.',
    };
    showFormAlert(msgs[err.code] || ('Não foi possível enviar: ' + err.message));
    btn.disabled = false;
    btn.textContent = 'Enviar cadastro';
  }
}

window.enviarCadastroParceiro = enviarCadastroParceiro;
