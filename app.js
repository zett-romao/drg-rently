// =============================================================
// DRG-Rently — app.js
// Fase 0: Auth Firebase + multi-tenant + roteamento básico
// =============================================================

const APP_VERSION = '0.1.0';

// =============================================================
// State
// =============================================================
const State = {
  user: null,          // Firebase Auth user
  userDoc: null,       // documento Firestore users/{uid}
  tenant: null,        // documento tenants/{tenantId}
  isSuperAdmin: false,
  currentSection: 'dashboard',
  signingUp: false,    // bloqueia onAuthStateChanged durante criação do tenant
};

// =============================================================
// Helpers UI
// =============================================================
function $(id) { return document.getElementById(id); }

function showScreen(id) {
  ['screen-login', 'screen-signup', 'screen-app'].forEach(s => {
    $(s).classList.toggle('active', s === id);
  });
}

function showAlert(targetId, msg, kind = 'error') {
  const el = $(targetId);
  if (!el) return;
  el.textContent = msg;
  el.className = `alert alert-${kind}`;
  el.style.display = 'block';
  if (kind !== 'error') {
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }
}

function clearAlert(targetId) {
  const el = $(targetId);
  if (el) el.style.display = 'none';
}

function fmtDate(value) {
  if (!value) return '—';
  const d = value.toDate ? value.toDate() : new Date(value);
  return d.toLocaleDateString('pt-BR');
}

// =============================================================
// Máscaras de entrada (CPF, CNPJ, telefone, CEP)
// Documento, telefone e CEP são salvos no Firestore SEM máscara
// (só dígitos). A máscara é aplicada visualmente nos inputs e
// re-aplicada na hora de exibir (tabelas, modais).
// =============================================================
function maskCPF(v) {
  v = (v || '').replace(/\D/g, '').slice(0, 11);
  if (v.length > 9) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6,9)}-${v.slice(9)}`;
  if (v.length > 6) return `${v.slice(0,3)}.${v.slice(3,6)}.${v.slice(6)}`;
  if (v.length > 3) return `${v.slice(0,3)}.${v.slice(3)}`;
  return v;
}

function maskCNPJ(v) {
  v = (v || '').replace(/\D/g, '').slice(0, 14);
  if (v.length > 12) return `${v.slice(0,2)}.${v.slice(2,5)}.${v.slice(5,8)}/${v.slice(8,12)}-${v.slice(12)}`;
  if (v.length > 8)  return `${v.slice(0,2)}.${v.slice(2,5)}.${v.slice(5,8)}/${v.slice(8)}`;
  if (v.length > 5)  return `${v.slice(0,2)}.${v.slice(2,5)}.${v.slice(5)}`;
  if (v.length > 2)  return `${v.slice(0,2)}.${v.slice(2)}`;
  return v;
}

function maskCPFCNPJ(v) {
  const digits = (v || '').replace(/\D/g, '');
  return digits.length <= 11 ? maskCPF(digits) : maskCNPJ(digits);
}

function maskTelefone(v) {
  v = (v || '').replace(/\D/g, '').slice(0, 11);
  if (v.length === 0) return '';
  if (v.length <= 2)  return `(${v}`;
  if (v.length <= 6)  return `(${v.slice(0,2)}) ${v.slice(2)}`;
  if (v.length <= 10) return `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`;
  return `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
}

function maskCEP(v) {
  v = (v || '').replace(/\D/g, '').slice(0, 8);
  if (v.length > 5) return `${v.slice(0,5)}-${v.slice(5)}`;
  return v;
}

// =============================================================
// Validadores e busca de dados públicos
// =============================================================
function isCPFValid(cpf) {
  cpf = (cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  return d2 === parseInt(cpf[10]);
}

function isCNPJValid(cnpj) {
  cnpj = (cnpj || '').replace(/\D/g, '');
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(cnpj[i]) * w1[i];
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(cnpj[12])) return false;

  sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(cnpj[i]) * w2[i];
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  return d2 === parseInt(cnpj[13]);
}

// Consulta dados públicos da Receita Federal via BrasilAPI (gratuita).
async function fetchCNPJ(cnpj) {
  cnpj = (cnpj || '').replace(/\D/g, '');
  if (cnpj.length !== 14) throw new Error('CNPJ deve ter 14 dígitos');
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      const err = await res.json();
      if (err.message) msg = err.message;
    } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

// Aplica máscara em um input preservando a posição relativa do cursor.
function bindMask(inputId, maskFn) {
  const el = $(inputId);
  if (!el) return;
  el.addEventListener('input', () => {
    const start = el.selectionStart;
    const oldValue = el.value;
    const digitsBeforeCursor = oldValue.slice(0, start).replace(/\D/g, '').length;
    el.value = maskFn(oldValue);
    // Recalcula cursor: posição após `digitsBeforeCursor` dígitos no novo valor
    let count = 0;
    let newPos = el.value.length;
    if (digitsBeforeCursor === 0) {
      newPos = 0;
    } else {
      for (let i = 0; i < el.value.length; i++) {
        if (/\d/.test(el.value[i])) count++;
        if (count >= digitsBeforeCursor) { newPos = i + 1; break; }
      }
    }
    el.setSelectionRange(newPos, newPos);
  });
}

function translateAuthError(code) {
  const map = {
    'auth/invalid-email': 'E-mail inválido.',
    'auth/user-not-found': 'Usuário não encontrado.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
    'auth/weak-password': 'Senha muito fraca (mínimo 6 caracteres).',
    'auth/too-many-requests': 'Muitas tentativas. Tente novamente em alguns minutos.',
    'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.',
  };
  return map[code] || `Erro: ${code}`;
}

// =============================================================
// Carregar perfil do usuário e direcionar pra tela apropriada
// =============================================================
async function loadProfileAndShow(user) {
  State.user = user;
  try {
    const userSnap = await db.collection('users').doc(user.uid).get();
    if (!userSnap.exists) {
      await auth.signOut();
      showAlert('login-alert', 'Conta sem perfil associado. Contate o administrador.');
      return;
    }

    State.userDoc = userSnap.data();
    State.isSuperAdmin = State.userDoc.role === 'super_admin';

    if (State.userDoc.tenantId) {
      const tenantSnap = await db.collection('tenants').doc(State.userDoc.tenantId).get();
      if (!tenantSnap.exists) {
        await auth.signOut();
        showAlert('login-alert', 'Imobiliária associada não encontrada.');
        return;
      }
      State.tenant = { id: tenantSnap.id, ...tenantSnap.data() };

      if (State.tenant.ativo === false && !State.isSuperAdmin) {
        await auth.signOut();
        showAlert('login-alert', 'Esta conta está suspensa. Contate o suporte.');
        return;
      }
    } else if (State.isSuperAdmin) {
      // Super-admin sem tenantId atua no primeiro tenant ativo (fallback simples).
      // TODO: adicionar seletor "Atuar como" no painel super-admin pra trocar.
      // Sem orderBy pra evitar índice composto; com volume real, super-admin escolherá pelo painel.
      const tenantsSnap = await db.collection('tenants').where('ativo', '==', true).limit(1).get();
      if (!tenantsSnap.empty) {
        const t = tenantsSnap.docs[0];
        State.tenant = { id: t.id, ...t.data() };
      }
    }

    renderApp();
    showScreen('screen-app');

  } catch (err) {
    console.error('Erro carregando perfil:', err);
    await auth.signOut();
    showAlert('login-alert', 'Erro ao carregar perfil: ' + err.message);
  }
}

// =============================================================
// Auth — listener principal
// =============================================================
auth.onAuthStateChanged(async (user) => {
  // Durante signup, doSignupTenant chama loadProfileAndShow manualmente
  // depois do batch.commit. Bloquear esse listener evita a race condition em que
  // onAuthStateChanged dispara antes do user doc existir no Firestore.
  if (State.signingUp) return;

  if (!user) {
    State.user = null;
    State.userDoc = null;
    State.tenant = null;
    State.isSuperAdmin = false;
    showScreen('screen-login');
    return;
  }

  await loadProfileAndShow(user);
});

// =============================================================
// Login
// =============================================================
async function doLogin() {
  clearAlert('login-alert');
  const email = $('login-email').value.trim();
  const senha = $('login-senha').value;

  if (!email || !senha) {
    showAlert('login-alert', 'Preencha e-mail e senha.');
    return;
  }

  const btn = $('btn-login');
  btn.disabled = true;
  btn.textContent = 'Entrando…';

  try {
    await auth.signInWithEmailAndPassword(email, senha);
    // o onAuthStateChanged cuida do resto
  } catch (err) {
    showAlert('login-alert', translateAuthError(err.code));
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

// =============================================================
// Signup de novo tenant
// =============================================================
async function doSignupTenant() {
  clearAlert('signup-alert');

  const razao = $('signup-razao').value.trim();
  const cnpj = $('signup-cnpj').value.trim();
  const creci = $('signup-creci').value.trim();
  const nome = $('signup-nome').value.trim();
  const email = $('signup-email').value.trim();
  const senha = $('signup-senha').value;
  const senha2 = $('signup-senha2').value;

  if (!razao || !cnpj || !nome || !email || !senha) {
    showAlert('signup-alert', 'Preencha todos os campos obrigatórios.');
    return;
  }
  if (senha !== senha2) {
    showAlert('signup-alert', 'As senhas não coincidem.');
    return;
  }
  if (senha.length < 6) {
    showAlert('signup-alert', 'Senha deve ter no mínimo 6 caracteres.');
    return;
  }

  const btn = $('btn-signup');
  btn.disabled = true;
  btn.textContent = 'Criando…';

  let createdUid = null;
  State.signingUp = true;

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, senha);
    createdUid = cred.user.uid;

    const tenantRef = db.collection('tenants').doc();
    const tenantId = tenantRef.id;

    const batch = db.batch();
    batch.set(tenantRef, {
      nome: razao,
      cnpj,
      creci: creci || null,
      plano: 'trial',
      ativo: true,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      criadoPor: createdUid,
    });
    batch.set(db.collection('users').doc(createdUid), {
      nome,
      email,
      tenantId,
      role: 'admin',
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    State.signingUp = false;
    await loadProfileAndShow(cred.user);

  } catch (err) {
    State.signingUp = false;
    console.error('Erro no signup:', err);
    showAlert('signup-alert', translateAuthError(err.code) || err.message);
    if (createdUid && auth.currentUser) {
      try { await auth.currentUser.delete(); } catch (_) { /* ignore */ }
    }
    btn.disabled = false;
    btn.textContent = 'Criar conta';
  }
}

// =============================================================
// Logout
// =============================================================
async function doLogout() {
  await auth.signOut();
}

// =============================================================
// Render do app principal
// =============================================================
function renderApp() {
  $('brand-tenant-name').textContent = State.tenant ? State.tenant.nome : (State.isSuperAdmin ? 'Super Admin' : '—');
  $('user-name').textContent = State.userDoc?.nome || State.user?.email || '—';
  $('footer-version').textContent = `v${APP_VERSION}`;

  $('nav-superadmin').style.display = State.isSuperAdmin ? 'flex' : 'none';

  showSection(State.currentSection || 'dashboard');
}

// =============================================================
// Navegação entre seções
// =============================================================
function showSection(name) {
  State.currentSection = name;

  document.querySelectorAll('.nav-link').forEach(el => {
    el.classList.toggle('active', el.dataset.section === name);
  });

  document.querySelectorAll('.section').forEach(el => {
    el.style.display = (el.id === `section-${name}`) ? 'block' : 'none';
  });

  const titles = {
    dashboard: 'Dashboard',
    locadores: 'Locadores',
    locatarios: 'Locatários',
    garantias: 'Garantias',
    imoveis: 'Imóveis',
    contratos: 'Contratos',
    balancetes: 'Balancetes Mensais',
    superadmin: 'Super Admin — Tenants',
    configuracoes: 'Configurações',
  };
  $('topbar-title').textContent = titles[name] || name;

  if (name === 'dashboard' && State.tenant) {
    loadDashboard();
  }
  if (name === 'superadmin' && State.isSuperAdmin) {
    loadTenantsTable();
  }
  if (name === 'locadores' && State.tenant) {
    loadLocadores();
  }
  if (name === 'locatarios' && State.tenant) {
    loadLocatarios();
  }
  if (name === 'compradores' && State.tenant) {
    loadCompradores();
  }
  if (name === 'negociacoes' && State.tenant) {
    loadNegociacoes();
  }
  if (name === 'garantias' && State.tenant) {
    loadGarantias();
  }
  if (name === 'imoveis' && State.tenant) {
    loadImoveis();
  }
  if (name === 'contratos' && State.tenant) {
    loadContratos();
  }
  if (name === 'balancetes' && State.tenant) {
    initBalanceteFiltros();
    loadBalancetes();
  }
  if (name === 'configuracoes' && State.tenant) {
    loadConfigImobiliaria();
  }
}

// =============================================================
// Super Admin — lista de tenants
// =============================================================
async function loadTenantsTable() {
  const tbody = $('tbody-tenants');
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-light);">Carregando…</td></tr>`;

  try {
    const snap = await db.collection('tenants').orderBy('criadoEm', 'desc').get();
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-light);">Nenhum tenant cadastrado.</td></tr>`;
      return;
    }

    const rows = [];
    for (const doc of snap.docs) {
      const t = doc.data();
      const adminSnap = await db.collection('users')
        .where('tenantId', '==', doc.id)
        .where('role', '==', 'admin')
        .limit(1)
        .get();
      const adminNome = adminSnap.empty ? '—' : (adminSnap.docs[0].data().nome || adminSnap.docs[0].data().email);

      const ativo = t.ativo !== false;
      rows.push(`
        <tr>
          <td><strong>${t.nome || '—'}</strong></td>
          <td>${t.cnpj || '—'}</td>
          <td>${adminNome}</td>
          <td>${fmtDate(t.criadoEm)}</td>
          <td><span class="badge-status ${ativo ? 'ativo' : 'suspenso'}">${ativo ? 'Ativo' : 'Suspenso'}</span></td>
          <td>
            <button class="btn btn-sm ${ativo ? 'btn-danger' : 'btn-primary'}" onclick="toggleTenantStatus('${doc.id}', ${!ativo})">
              ${ativo ? 'Suspender' : 'Reativar'}
            </button>
          </td>
        </tr>
      `);
    }
    tbody.innerHTML = rows.join('');
  } catch (err) {
    console.error('Erro carregando tenants:', err);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

async function toggleTenantStatus(tenantId, ativo) {
  const acao = ativo ? 'reativar' : 'suspender';
  if (!confirm(`Confirma ${acao} este tenant?`)) return;

  try {
    await db.collection('tenants').doc(tenantId).update({
      ativo,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    });
    loadTenantsTable();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

// =============================================================
// DASHBOARD — contagens + drag-and-drop pra reordenar cards
// =============================================================

let _dndCardEnabled = false;

function enableDashboardDnD() {
  if (_dndCardEnabled) return;
  const grid = $('dashboard-grid');
  if (!grid) return;

  let draggedCard = null;
  // Distância mínima pra considerar arraste (evita click acidental virar drag)
  let dragStartedAt = 0;

  grid.querySelectorAll('.stat-card').forEach(card => {
    card.setAttribute('draggable', 'true');

    card.addEventListener('dragstart', (e) => {
      draggedCard = card;
      dragStartedAt = Date.now();
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox precisa de algum data setado
      try { e.dataTransfer.setData('text/plain', card.dataset.cardId || ''); } catch (_) {}
    });

    card.addEventListener('dragend', () => {
      if (draggedCard) draggedCard.classList.remove('dragging');
      draggedCard = null;
      grid.querySelectorAll('.stat-card').forEach(c => c.classList.remove('drag-over'));
    });

    card.addEventListener('dragover', (e) => {
      if (!draggedCard || draggedCard === card) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('drag-over');
      if (!draggedCard || draggedCard === card) return;

      // Insere antes ou depois baseado na posição do cursor (horizontal)
      const rect = card.getBoundingClientRect();
      const insertBefore = e.clientX < rect.left + rect.width / 2;
      if (insertBefore) {
        grid.insertBefore(draggedCard, card);
      } else {
        grid.insertBefore(draggedCard, card.nextSibling);
      }
      saveDashboardOrder();
    });

    // Previne click navegar imediatamente após um drag
    card.addEventListener('click', (e) => {
      if (Date.now() - dragStartedAt < 250) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  });

  _dndCardEnabled = true;
}

async function saveDashboardOrder() {
  if (!State.tenant) return;
  const grid = $('dashboard-grid');
  if (!grid) return;
  const order = Array.from(grid.querySelectorAll('.stat-card'))
    .map(c => c.dataset.cardId)
    .filter(Boolean);
  try {
    await tenantPath().collection('config').doc('site').set({
      dashboardOrder: order,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error('Erro ao salvar ordem do dashboard:', err);
  }
}

async function applyDashboardOrder() {
  if (!State.tenant) return;
  try {
    const snap = await tenantPath().collection('config').doc('site').get();
    if (!snap.exists) return;
    const order = (snap.data() || {}).dashboardOrder;
    if (!Array.isArray(order) || order.length === 0) return;

    const grid = $('dashboard-grid');
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll('.stat-card'));
    const byId = Object.fromEntries(cards.map(c => [c.dataset.cardId, c]));

    // Cards que estão na ordem salva
    order.forEach(id => {
      if (byId[id]) grid.appendChild(byId[id]);
    });
    // Cards novos que não estão na ordem salva ficam no final (já estão lá após appendChild dos outros)
  } catch (err) {
    console.error('Erro ao aplicar ordem:', err);
  }
}

async function loadDashboard() {
  const ids = ['stat-locadores', 'stat-locatarios', 'stat-imoveis-alugados',
               'stat-imoveis-disponiveis', 'stat-imoveis-venda',
               'stat-contratos-vigentes', 'stat-garantias-ativas', 'stat-negociacoes',
               'stat-balancetes-mes'];
  ids.forEach(id => { const el = $(id); if (el) el.textContent = '…'; });

  if (!State.tenant) return;

  // Reordena cards conforme preferência salva + habilita drag-and-drop
  await applyDashboardOrder();
  enableDashboardDnD();

  try {
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();
    const [locadoresSnap, locatariosSnap, imoveisSnap, contratosSnap, garantiasSnap, negociacoesSnap, balancetesMesSnap] = await Promise.all([
      tenantPath().collection('locadores').get(),
      tenantPath().collection('locatarios').get(),
      tenantPath().collection('imoveis').get(),
      tenantPath().collection('contratos').get(),
      tenantPath().collection('garantias').get(),
      tenantPath().collection('negociacoes').get(),
      tenantPath().collection('balancetes').where('mes', '==', mesAtual).where('ano', '==', anoAtual).get(),
    ]);

    const imoveisAlugados = imoveisSnap.docs.filter(d => d.data().status === 'alugado').length;
    const imoveisDisponiveis = imoveisSnap.docs.filter(d => d.data().status === 'disponivel').length;
    const imoveisVenda = imoveisSnap.docs.filter(d => {
      const f = d.data().finalidade || 'locacao';
      return f === 'venda' || f === 'ambos';
    }).length;
    const contratosVigentes = contratosSnap.docs.filter(d => d.data().status === 'vigente').length;
    const garantiasAtivas = garantiasSnap.docs.filter(d => (d.data().status || 'ativa') === 'ativa').length;
    const negociacoesAndamento = negociacoesSnap.docs.filter(d => {
      const s = d.data().status;
      return s === 'em_negociacao' || s === 'aceita' || s === 'rascunho';
    }).length;

    $('stat-locadores').textContent = locadoresSnap.size;
    $('stat-locatarios').textContent = locatariosSnap.size;
    $('stat-imoveis-alugados').textContent = imoveisAlugados;
    $('stat-imoveis-disponiveis').textContent = imoveisDisponiveis;
    $('stat-imoveis-venda').textContent = imoveisVenda;
    $('stat-contratos-vigentes').textContent = contratosVigentes;
    $('stat-garantias-ativas').textContent = garantiasAtivas;
    $('stat-negociacoes').textContent = negociacoesAndamento;
    $('stat-balancetes-mes').textContent = balancetesMesSnap.size;
  } catch (err) {
    console.error('Erro ao carregar dashboard:', err);
    ids.forEach(id => { const el = $(id); if (el) el.textContent = '—'; });
  }
}

// =============================================================
// LOCADORES — CRUD + documentos
// =============================================================

function tenantPath() {
  if (!State.tenant) throw new Error('Tenant não carregado');
  return db.collection('tenants').doc(State.tenant.id);
}

function storageTenantRef() {
  if (!State.tenant) throw new Error('Tenant não carregado');
  return storage.ref().child(`tenants/${State.tenant.id}`);
}

async function loadLocadores() {
  const tbody = $('tbody-locadores');
  tbody.innerHTML = `<tr><td colspan="6" class="empty">Carregando…</td></tr>`;

  try {
    const snap = await tenantPath().collection('locadores').orderBy('nome').get();
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhum locador cadastrado. Clique em "Novo Locador" para começar.</td></tr>`;
      return;
    }

    const rows = snap.docs.map((doc, i) => {
      const l = doc.data();
      const docFmt = l.documento ? (l.tipo === 'PJ' ? maskCNPJ(l.documento) : maskCPF(l.documento)) : '—';
      const telFmt = l.telefone ? maskTelefone(l.telefone) : '—';
      return `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${l.nome || '—'}</strong>${l.tipo === 'PJ' ? ' <span class="muted" style="font-size:11px;">(PJ)</span>' : ''}</td>
          <td>${docFmt}</td>
          <td>${telFmt}</td>
          <td>${l.email || '—'}</td>
          <td>
            <div class="action-btns">
              <button class="btn btn-sm btn-secondary" onclick="openLocadorModal('${doc.id}')">Editar</button>
            </div>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join('');
  } catch (err) {
    console.error('Erro ao carregar locadores:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

async function buscarCEPLocador() {
  const input = $('locador-cep');
  const status = $('locador-cep-status');
  const cepRaw = (input.value || '').replace(/\D/g, '');

  if (cepRaw.length === 0) return;
  if (cepRaw.length !== 8) {
    showAlert('locador-alert', 'CEP deve ter 8 dígitos.');
    return;
  }

  // Formatar visualmente (00000-000)
  input.value = cepRaw.replace(/(\d{5})(\d{3})/, '$1-$2');
  status.style.display = 'inline';
  status.textContent = 'Buscando…';

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepRaw}/json/`);
    const data = await res.json();

    if (data.erro) {
      status.textContent = 'CEP não encontrado';
      status.style.color = 'var(--danger)';
      return;
    }

    if (data.logradouro) $('locador-logradouro').value = data.logradouro;
    if (data.bairro) $('locador-bairro').value = data.bairro;
    if (data.localidade) $('locador-cidade').value = data.localidade;
    if (data.uf) $('locador-uf').value = data.uf;

    status.textContent = '✓';
    status.style.color = 'var(--success)';
    $('locador-numero').focus();
  } catch (err) {
    console.error('Erro CEP:', err);
    status.textContent = 'Erro de conexão';
    status.style.color = 'var(--danger)';
  }
}

function onLocadorDocumentoInput() {
  const tipo = $('locador-tipo').value;
  const digits = $('locador-documento').value.replace(/\D/g, '');
  const status = $('locador-doc-status');

  if (digits.length === 0) {
    status.style.display = 'none';
    return;
  }
  status.style.display = 'block';

  const isPJ = tipo === 'PJ';
  const max = isPJ ? 14 : 11;
  const valido = isPJ ? isCNPJValid(digits) : isCPFValid(digits);

  if (digits.length < max) {
    status.textContent = `${digits.length}/${max} dígitos`;
    status.style.color = 'var(--text-muted)';
  } else if (valido) {
    status.textContent = `✓ ${isPJ ? 'CNPJ' : 'CPF'} válido`;
    status.style.color = 'var(--success)';
  } else {
    status.textContent = `✗ ${isPJ ? 'CNPJ' : 'CPF'} inválido`;
    status.style.color = 'var(--danger)';
  }
}

async function onLocadorDocumentoBlur() {
  if ($('locador-tipo').value !== 'PJ') return;

  const digits = $('locador-documento').value.replace(/\D/g, '');
  if (digits.length !== 14 || !isCNPJValid(digits)) return;

  const nomeAtual = $('locador-nome').value.trim();
  if (nomeAtual && !confirm('Buscar dados na Receita Federal pode sobrescrever a razão social e o endereço já preenchidos. Deseja prosseguir?')) return;

  const status = $('locador-doc-status');
  status.style.display = 'block';
  status.textContent = 'Buscando na Receita…';
  status.style.color = 'var(--primary)';

  try {
    const data = await fetchCNPJ(digits);

    $('locador-nome').value = data.razao_social || nomeAtual;
    if (data.logradouro)  $('locador-logradouro').value  = data.logradouro;
    if (data.numero)      $('locador-numero').value      = data.numero;
    if (data.complemento) $('locador-complemento').value = data.complemento;
    if (data.bairro)      $('locador-bairro').value      = data.bairro;
    if (data.municipio)   $('locador-cidade').value      = data.municipio;
    if (data.uf)          $('locador-uf').value          = data.uf;
    if (data.cep)         $('locador-cep').value         = maskCEP(String(data.cep));
    if (data.email && !$('locador-email').value)         $('locador-email').value    = data.email;
    if (data.ddd_telefone_1 && !$('locador-telefone').value) {
      $('locador-telefone').value = maskTelefone(String(data.ddd_telefone_1));
    }

    const situacao = (data.descricao_situacao_cadastral || '').toUpperCase();
    if (situacao === 'ATIVA') {
      status.textContent = '✓ CNPJ ativo na Receita';
      status.style.color = 'var(--success)';
    } else if (situacao) {
      status.textContent = `⚠ Situação: ${situacao}`;
      status.style.color = 'var(--warning)';
    } else {
      status.textContent = '✓ Dados encontrados';
      status.style.color = 'var(--success)';
    }
  } catch (err) {
    console.error('Erro BrasilAPI:', err);
    status.textContent = 'Não foi possível consultar a Receita: ' + err.message;
    status.style.color = 'var(--danger)';
  }
}

function onLocadorTipoChange() {
  const tipo = $('locador-tipo').value;
  const isPJ = tipo === 'PJ';
  $('locador-nome-label').textContent = isPJ ? 'Razão social' : 'Nome completo';
  $('locador-doc-label').textContent = isPJ ? 'CNPJ' : 'CPF';
  $('locador-documento').placeholder = isPJ ? '00.000.000/0000-00' : '000.000.000-00';
  $('locador-rg-group').style.display = isPJ ? 'none' : 'block';
  $('locador-nascimento-group').style.display = isPJ ? 'none' : 'block';
  $('locador-pf-extra').style.display = isPJ ? 'none' : 'grid';
  // Reaplica a máscara do documento ao trocar PF/PJ e revalida o status
  const docInput = $('locador-documento');
  docInput.value = isPJ ? maskCNPJ(docInput.value) : maskCPF(docInput.value);
  onLocadorDocumentoInput();
}

async function openLocadorModal(id) {
  clearAlert('locador-alert');

  $('locador-id').value = id || '';
  $('modal-locador-title').textContent = id ? 'Editar Locador' : 'Novo Locador';
  $('btn-delete-locador').style.display = id ? 'inline-block' : 'none';

  // Limpar campos
  ['locador-nome', 'locador-documento', 'locador-rg', 'locador-nascimento',
   'locador-profissao', 'locador-email', 'locador-telefone',
   'locador-cep', 'locador-logradouro', 'locador-numero', 'locador-complemento',
   'locador-bairro', 'locador-cidade', 'locador-uf',
   'locador-pix', 'locador-banco', 'locador-obs'].forEach(f => $(f).value = '');
  $('locador-tipo').value = 'PF';
  $('locador-estado-civil').value = '';
  $('locador-nacionalidade').value = 'Brasileira';
  $('locador-cep-status').style.display = 'none';
  $('locador-doc-status').style.display = 'none';
  onLocadorTipoChange();

  if (id) {
    try {
      const snap = await tenantPath().collection('locadores').doc(id).get();
      if (snap.exists) {
        const l = snap.data();
        $('locador-tipo').value = l.tipo || 'PF';
        $('locador-nome').value = l.nome || '';
        $('locador-documento').value = l.documento ? (l.tipo === 'PJ' ? maskCNPJ(l.documento) : maskCPF(l.documento)) : '';
        $('locador-rg').value = l.rg || '';
        $('locador-nascimento').value = l.nascimento || '';
        $('locador-estado-civil').value = l.estadoCivil || '';
        $('locador-profissao').value = l.profissao || '';
        $('locador-nacionalidade').value = l.nacionalidade || 'Brasileira';
        $('locador-email').value = l.email || '';
        $('locador-telefone').value = l.telefone ? maskTelefone(l.telefone) : '';
        onLocadorTipoChange();
        const end = l.endereco || {};
        $('locador-cep').value = end.cep ? maskCEP(end.cep) : '';
        $('locador-logradouro').value = end.logradouro || '';
        $('locador-numero').value = end.numero || '';
        $('locador-complemento').value = end.complemento || '';
        $('locador-bairro').value = end.bairro || '';
        $('locador-cidade').value = end.cidade || '';
        $('locador-uf').value = end.uf || '';
        $('locador-pix').value = l.pix || '';
        $('locador-banco').value = l.banco || '';
        $('locador-obs').value = l.obs || '';
      }
    } catch (err) {
      console.error('Erro ao carregar locador:', err);
      showAlert('locador-alert', 'Erro ao carregar dados: ' + err.message);
    }
    $('locador-docs-section').style.display = 'block';
    loadLocadorDocs(id);
  } else {
    $('locador-docs-section').style.display = 'none';
  }

  $('modal-locador').style.display = 'flex';
}

function closeLocadorModal() {
  $('modal-locador').style.display = 'none';
}

async function saveLocador() {
  clearAlert('locador-alert');

  const id = $('locador-id').value;
  const nome = $('locador-nome').value.trim();
  const documento = $('locador-documento').value.trim();

  if (!nome) {
    showAlert('locador-alert', 'Nome / Razão social é obrigatório.');
    return;
  }
  if (!documento) {
    showAlert('locador-alert', 'CPF / CNPJ é obrigatório.');
    return;
  }

  const data = {
    tipo: $('locador-tipo').value,
    nome,
    documento: documento.replace(/\D/g, ''),
    rg: $('locador-rg').value.trim() || null,
    nascimento: $('locador-nascimento').value || null,
    estadoCivil: $('locador-estado-civil').value || null,
    profissao: $('locador-profissao').value.trim() || null,
    nacionalidade: $('locador-nacionalidade').value.trim() || null,
    email: $('locador-email').value.trim() || null,
    telefone: $('locador-telefone').value.replace(/\D/g, '') || null,
    endereco: {
      cep: $('locador-cep').value.replace(/\D/g, '') || null,
      logradouro: $('locador-logradouro').value.trim() || null,
      numero: $('locador-numero').value.trim() || null,
      complemento: $('locador-complemento').value.trim() || null,
      bairro: $('locador-bairro').value.trim() || null,
      cidade: $('locador-cidade').value.trim() || null,
      uf: $('locador-uf').value.trim().toUpperCase() || null,
    },
    pix: $('locador-pix').value.trim() || null,
    banco: $('locador-banco').value.trim() || null,
    obs: $('locador-obs').value.trim() || null,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  };

  const btn = $('btn-save-locador');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  try {
    if (id) {
      await tenantPath().collection('locadores').doc(id).update(data);
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('locadores').add(data);
      // re-abrir em modo edição pra liberar uploads de docs
      btn.disabled = false;
      btn.textContent = 'Salvar';
      invalidateLocadoresCache();
      await openLocadorModal(docRef.id);
      showAlert('locador-alert', 'Locador criado. Agora você pode anexar documentos.', 'success');
      loadLocadores();
      return;
    }
    invalidateLocadoresCache();
    closeLocadorModal();
    loadLocadores();
  } catch (err) {
    console.error('Erro ao salvar:', err);
    showAlert('locador-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function deleteLocador() {
  const id = $('locador-id').value;
  if (!id) return;
  if (!confirm('Excluir este locador? Os documentos anexados também serão removidos. Esta ação não pode ser desfeita.')) return;

  try {
    // apagar arquivos do Storage
    const folderRef = storageTenantRef().child(`locadores/${id}`);
    try {
      const list = await folderRef.listAll();
      await Promise.all(list.items.map(item => item.delete()));
    } catch (_) { /* pasta pode não existir */ }

    // apagar doc do Firestore
    await tenantPath().collection('locadores').doc(id).delete();
    invalidateLocadoresCache();
    closeLocadorModal();
    loadLocadores();
  } catch (err) {
    console.error('Erro ao excluir:', err);
    showAlert('locador-alert', 'Erro: ' + err.message);
  }
}

// ---------- Documentos do Locador ----------

async function loadLocadorDocs(locadorId) {
  const container = $('locador-docs-list');
  container.innerHTML = `<p class="empty">Carregando documentos…</p>`;

  try {
    const folderRef = storageTenantRef().child(`locadores/${locadorId}`);
    const list = await folderRef.listAll();

    if (list.items.length === 0) {
      container.innerHTML = `<p class="empty">Nenhum documento anexado.</p>`;
      return;
    }

    const items = await Promise.all(list.items.map(async (item) => {
      const meta = await item.getMetadata();
      const url = await item.getDownloadURL();
      const ext = (item.name.split('.').pop() || '').toLowerCase();
      const icon = (ext === 'pdf') ? '📄' : (['jpg','jpeg','png'].includes(ext) ? '🖼' : '📎');
      const sizeKb = (meta.size / 1024).toFixed(0);
      const date = new Date(meta.timeCreated).toLocaleDateString('pt-BR');
      return `
        <div class="doc-item">
          <span class="doc-icon">${icon}</span>
          <span class="doc-name">${item.name}</span>
          <span class="doc-meta">${sizeKb} KB · ${date}</span>
          <div class="doc-actions">
            <a class="btn-icon" href="${url}" target="_blank" title="Abrir">👁</a>
            <a class="btn-icon" href="${url}" download="${item.name}" title="Baixar">⬇</a>
            <button class="btn-icon btn-icon-danger" onclick="deleteLocadorDoc('${locadorId}','${item.name}')" title="Excluir">🗑</button>
          </div>
        </div>
      `;
    }));
    container.innerHTML = items.join('');
  } catch (err) {
    console.error('Erro ao listar docs:', err);
    container.innerHTML = `<p class="empty" style="color:var(--danger);">Erro: ${err.message}</p>`;
  }
}

async function uploadLocadorDocs() {
  const locadorId = $('locador-id').value;
  if (!locadorId) {
    showAlert('locador-alert', 'Salve o locador antes de anexar documentos.');
    return;
  }

  const input = $('locador-doc-input');
  const files = Array.from(input.files || []);
  if (files.length === 0) {
    showAlert('locador-alert', 'Selecione ao menos um arquivo.');
    return;
  }

  // Limite 10MB por arquivo
  const tooBig = files.find(f => f.size > 10 * 1024 * 1024);
  if (tooBig) {
    showAlert('locador-alert', `Arquivo "${tooBig.name}" excede 10MB.`);
    return;
  }

  const folderRef = storageTenantRef().child(`locadores/${locadorId}`);
  try {
    for (const file of files) {
      await folderRef.child(file.name).put(file, {
        contentType: file.type,
        customMetadata: { uploadedBy: State.user.uid },
      });
    }
    input.value = '';
    showAlert('locador-alert', `${files.length} arquivo(s) enviado(s).`, 'success');
    loadLocadorDocs(locadorId);
  } catch (err) {
    console.error('Erro no upload:', err);
    showAlert('locador-alert', 'Erro: ' + err.message);
  }
}

async function deleteLocadorDoc(locadorId, filename) {
  if (!confirm(`Excluir o arquivo "${filename}"?`)) return;
  try {
    await storageTenantRef().child(`locadores/${locadorId}/${filename}`).delete();
    loadLocadorDocs(locadorId);
  } catch (err) {
    console.error('Erro ao excluir doc:', err);
    showAlert('locador-alert', 'Erro: ' + err.message);
  }
}

// =============================================================
// LOCATÁRIOS — CRUD + análise de crédito + documentos
// =============================================================

const LOCATARIO_STATUS_LABEL = {
  pendente_analise: 'Pendente',
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
};

async function loadLocatarios() {
  const tbody = $('tbody-locatarios');
  tbody.innerHTML = `<tr><td colspan="6" class="empty">Carregando…</td></tr>`;

  try {
    const snap = await tenantPath().collection('locatarios').orderBy('nome').get();
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhum locatário cadastrado. Clique em "Novo Locatário" para começar.</td></tr>`;
      return;
    }

    const rows = snap.docs.map((doc, i) => {
      const l = doc.data();
      const docFmt = l.documento ? (l.tipo === 'PJ' ? maskCNPJ(l.documento) : maskCPF(l.documento)) : '—';
      const telFmt = l.telefone ? maskTelefone(l.telefone) : '—';
      const status = l.status || 'pendente_analise';
      return `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${l.nome || '—'}</strong>${l.tipo === 'PJ' ? ' <span class="muted" style="font-size:11px;">(PJ)</span>' : ''}</td>
          <td>${docFmt}</td>
          <td>${telFmt}</td>
          <td><span class="badge-status ${status}">${LOCATARIO_STATUS_LABEL[status] || status}</span></td>
          <td>
            <div class="action-btns">
              <button class="btn btn-sm btn-secondary" onclick="openLocatarioModal('${doc.id}')">Editar</button>
            </div>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join('');
  } catch (err) {
    console.error('Erro ao carregar locatários:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

async function buscarCEPLocatario() {
  const input = $('locatario-cep');
  const status = $('locatario-cep-status');
  const cepRaw = (input.value || '').replace(/\D/g, '');

  if (cepRaw.length === 0) return;
  if (cepRaw.length !== 8) {
    showAlert('locatario-alert', 'CEP deve ter 8 dígitos.');
    return;
  }

  input.value = cepRaw.replace(/(\d{5})(\d{3})/, '$1-$2');
  status.style.display = 'block';
  status.textContent = 'Buscando…';
  status.style.color = 'var(--primary)';

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepRaw}/json/`);
    const data = await res.json();

    if (data.erro) {
      status.textContent = 'CEP não encontrado';
      status.style.color = 'var(--danger)';
      return;
    }

    if (data.logradouro) $('locatario-logradouro').value = data.logradouro;
    if (data.bairro)     $('locatario-bairro').value     = data.bairro;
    if (data.localidade) $('locatario-cidade').value     = data.localidade;
    if (data.uf)         $('locatario-uf').value         = data.uf;

    status.textContent = '✓';
    status.style.color = 'var(--success)';
    $('locatario-numero').focus();
  } catch (err) {
    console.error('Erro CEP:', err);
    status.textContent = 'Erro de conexão';
    status.style.color = 'var(--danger)';
  }
}

function onLocatarioTipoChange() {
  const tipo = $('locatario-tipo').value;
  const isPJ = tipo === 'PJ';
  $('locatario-nome-label').textContent = isPJ ? 'Razão social' : 'Nome completo';
  $('locatario-doc-label').textContent = isPJ ? 'CNPJ' : 'CPF';
  $('locatario-documento').placeholder = isPJ ? '00.000.000/0000-00' : '000.000.000-00';
  $('locatario-rg-group').style.display = isPJ ? 'none' : 'block';
  $('locatario-nascimento-group').style.display = isPJ ? 'none' : 'block';
  $('locatario-pf-extra').style.display = isPJ ? 'none' : 'grid';
  $('locatario-profissao-label').textContent = isPJ ? 'Ramo de atividade' : 'Profissão';
  const docInput = $('locatario-documento');
  docInput.value = isPJ ? maskCNPJ(docInput.value) : maskCPF(docInput.value);
  onLocatarioDocumentoInput();
}

function onLocatarioDocumentoInput() {
  const tipo = $('locatario-tipo').value;
  const digits = $('locatario-documento').value.replace(/\D/g, '');
  const status = $('locatario-doc-status');

  if (digits.length === 0) {
    status.style.display = 'none';
    return;
  }
  status.style.display = 'block';

  const isPJ = tipo === 'PJ';
  const max = isPJ ? 14 : 11;
  const valido = isPJ ? isCNPJValid(digits) : isCPFValid(digits);

  if (digits.length < max) {
    status.textContent = `${digits.length}/${max} dígitos`;
    status.style.color = 'var(--text-muted)';
  } else if (valido) {
    status.textContent = `✓ ${isPJ ? 'CNPJ' : 'CPF'} válido`;
    status.style.color = 'var(--success)';
  } else {
    status.textContent = `✗ ${isPJ ? 'CNPJ' : 'CPF'} inválido`;
    status.style.color = 'var(--danger)';
  }
}

async function onLocatarioDocumentoBlur() {
  if ($('locatario-tipo').value !== 'PJ') return;

  const digits = $('locatario-documento').value.replace(/\D/g, '');
  if (digits.length !== 14 || !isCNPJValid(digits)) return;

  const nomeAtual = $('locatario-nome').value.trim();
  if (nomeAtual && !confirm('Buscar dados na Receita Federal pode sobrescrever a razão social e o endereço já preenchidos. Deseja prosseguir?')) return;

  const status = $('locatario-doc-status');
  status.style.display = 'block';
  status.textContent = 'Buscando na Receita…';
  status.style.color = 'var(--primary)';

  try {
    const data = await fetchCNPJ(digits);
    $('locatario-nome').value = data.razao_social || nomeAtual;
    if (data.logradouro)  $('locatario-logradouro').value  = data.logradouro;
    if (data.numero)      $('locatario-numero').value      = data.numero;
    if (data.complemento) $('locatario-complemento').value = data.complemento;
    if (data.bairro)      $('locatario-bairro').value      = data.bairro;
    if (data.municipio)   $('locatario-cidade').value      = data.municipio;
    if (data.uf)          $('locatario-uf').value          = data.uf;
    if (data.cep)         $('locatario-cep').value         = maskCEP(String(data.cep));
    if (data.email && !$('locatario-email').value)         $('locatario-email').value    = data.email;
    if (data.ddd_telefone_1 && !$('locatario-telefone').value) {
      $('locatario-telefone').value = maskTelefone(String(data.ddd_telefone_1));
    }

    const situacao = (data.descricao_situacao_cadastral || '').toUpperCase();
    if (situacao === 'ATIVA') {
      status.textContent = '✓ CNPJ ativo na Receita';
      status.style.color = 'var(--success)';
    } else if (situacao) {
      status.textContent = `⚠ Situação: ${situacao}`;
      status.style.color = 'var(--warning)';
    } else {
      status.textContent = '✓ Dados encontrados';
      status.style.color = 'var(--success)';
    }
  } catch (err) {
    console.error('Erro BrasilAPI:', err);
    status.textContent = 'Não foi possível consultar a Receita: ' + err.message;
    status.style.color = 'var(--danger)';
  }
}

async function openLocatarioModal(id) {
  clearAlert('locatario-alert');

  $('locatario-id').value = id || '';
  $('modal-locatario-title').textContent = id ? 'Editar Locatário' : 'Novo Locatário';
  $('btn-delete-locatario').style.display = id ? 'inline-block' : 'none';

  ['locatario-nome', 'locatario-documento', 'locatario-rg', 'locatario-nascimento',
   'locatario-profissao', 'locatario-empresa', 'locatario-cargo', 'locatario-admissao',
   'locatario-renda', 'locatario-outros-detalhes',
   'locatario-email', 'locatario-telefone',
   'locatario-cep', 'locatario-logradouro', 'locatario-numero', 'locatario-complemento',
   'locatario-bairro', 'locatario-cidade', 'locatario-uf',
   'locatario-obs', 'locatario-motivo-status'].forEach(f => $(f).value = '');
  $('locatario-tipo').value = 'PF';
  $('locatario-estado-civil').value = '';
  $('locatario-nacionalidade').value = 'Brasileira';
  $('locatario-dependentes').value = '0';
  $('locatario-outros-imoveis').value = 'nao';
  $('locatario-status').value = 'pendente_analise';
  $('locatario-cep-status').style.display = 'none';
  $('locatario-doc-status').style.display = 'none';
  onLocatarioTipoChange();

  if (id) {
    try {
      const snap = await tenantPath().collection('locatarios').doc(id).get();
      if (snap.exists) {
        const l = snap.data();
        $('locatario-status').value = l.status || 'pendente_analise';
        $('locatario-motivo-status').value = l.motivoStatus || '';
        $('locatario-tipo').value = l.tipo || 'PF';
        $('locatario-nome').value = l.nome || '';
        $('locatario-documento').value = l.documento ? (l.tipo === 'PJ' ? maskCNPJ(l.documento) : maskCPF(l.documento)) : '';
        $('locatario-rg').value = l.rg || '';
        $('locatario-nascimento').value = l.nascimento || '';
        $('locatario-estado-civil').value = l.estadoCivil || '';
        $('locatario-nacionalidade').value = l.nacionalidade || 'Brasileira';
        $('locatario-dependentes').value = l.dependentes ?? 0;
        $('locatario-email').value = l.email || '';
        $('locatario-telefone').value = l.telefone ? maskTelefone(l.telefone) : '';
        onLocatarioTipoChange();
        const end = l.endereco || {};
        $('locatario-cep').value = end.cep ? maskCEP(end.cep) : '';
        $('locatario-logradouro').value = end.logradouro || '';
        $('locatario-numero').value = end.numero || '';
        $('locatario-complemento').value = end.complemento || '';
        $('locatario-bairro').value = end.bairro || '';
        $('locatario-cidade').value = end.cidade || '';
        $('locatario-uf').value = end.uf || '';
        $('locatario-profissao').value = l.profissao || '';
        $('locatario-empresa').value = l.empresa || '';
        $('locatario-cargo').value = l.cargo || '';
        $('locatario-admissao').value = l.admissao || '';
        $('locatario-renda').value = l.renda ?? '';
        $('locatario-outros-imoveis').value = l.outrosImoveis || 'nao';
        $('locatario-outros-detalhes').value = l.outrosImoveisDetalhes || '';
        $('locatario-obs').value = l.obs || '';
      }
    } catch (err) {
      console.error('Erro ao carregar locatário:', err);
      showAlert('locatario-alert', 'Erro ao carregar dados: ' + err.message);
    }
    $('locatario-docs-section').style.display = 'block';
    loadLocatarioDocs(id);
  } else {
    $('locatario-docs-section').style.display = 'none';
  }

  $('modal-locatario').style.display = 'flex';
}

function closeLocatarioModal() {
  $('modal-locatario').style.display = 'none';
}

async function saveLocatario() {
  clearAlert('locatario-alert');

  const id = $('locatario-id').value;
  const nome = $('locatario-nome').value.trim();
  const documento = $('locatario-documento').value.trim();

  if (!nome) { showAlert('locatario-alert', 'Nome / Razão social é obrigatório.'); return; }
  if (!documento) { showAlert('locatario-alert', 'CPF / CNPJ é obrigatório.'); return; }

  const rendaRaw = $('locatario-renda').value;
  const data = {
    status: $('locatario-status').value,
    motivoStatus: $('locatario-motivo-status').value.trim() || null,
    tipo: $('locatario-tipo').value,
    nome,
    documento: documento.replace(/\D/g, ''),
    rg: $('locatario-rg').value.trim() || null,
    nascimento: $('locatario-nascimento').value || null,
    estadoCivil: $('locatario-estado-civil').value || null,
    nacionalidade: $('locatario-nacionalidade').value.trim() || null,
    dependentes: parseInt($('locatario-dependentes').value, 10) || 0,
    email: $('locatario-email').value.trim() || null,
    telefone: $('locatario-telefone').value.replace(/\D/g, '') || null,
    endereco: {
      cep: $('locatario-cep').value.replace(/\D/g, '') || null,
      logradouro: $('locatario-logradouro').value.trim() || null,
      numero: $('locatario-numero').value.trim() || null,
      complemento: $('locatario-complemento').value.trim() || null,
      bairro: $('locatario-bairro').value.trim() || null,
      cidade: $('locatario-cidade').value.trim() || null,
      uf: $('locatario-uf').value.trim().toUpperCase() || null,
    },
    profissao: $('locatario-profissao').value.trim() || null,
    empresa: $('locatario-empresa').value.trim() || null,
    cargo: $('locatario-cargo').value.trim() || null,
    admissao: $('locatario-admissao').value || null,
    renda: rendaRaw ? parseFloat(rendaRaw) : null,
    outrosImoveis: $('locatario-outros-imoveis').value,
    outrosImoveisDetalhes: $('locatario-outros-detalhes').value.trim() || null,
    obs: $('locatario-obs').value.trim() || null,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  };

  const btn = $('btn-save-locatario');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  try {
    if (id) {
      await tenantPath().collection('locatarios').doc(id).update(data);
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('locatarios').add(data);
      btn.disabled = false;
      btn.textContent = 'Salvar';
      invalidateLocatariosCache();
      await openLocatarioModal(docRef.id);
      showAlert('locatario-alert', 'Locatário criado. Agora você pode anexar documentos.', 'success');
      loadLocatarios();
      return;
    }
    invalidateLocatariosCache();
    closeLocatarioModal();
    loadLocatarios();
  } catch (err) {
    console.error('Erro ao salvar:', err);
    showAlert('locatario-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function deleteLocatario() {
  const id = $('locatario-id').value;
  if (!id) return;
  if (!confirm('Excluir este locatário? Os documentos anexados também serão removidos. Esta ação não pode ser desfeita.')) return;

  try {
    const folderRef = storageTenantRef().child(`locatarios/${id}`);
    try {
      const list = await folderRef.listAll();
      await Promise.all(list.items.map(item => item.delete()));
    } catch (_) { /* pasta pode não existir */ }

    await tenantPath().collection('locatarios').doc(id).delete();
    invalidateLocatariosCache();
    closeLocatarioModal();
    loadLocatarios();
  } catch (err) {
    console.error('Erro ao excluir:', err);
    showAlert('locatario-alert', 'Erro: ' + err.message);
  }
}

async function loadLocatarioDocs(locatarioId) {
  const container = $('locatario-docs-list');
  container.innerHTML = `<p class="empty">Carregando documentos…</p>`;

  try {
    const folderRef = storageTenantRef().child(`locatarios/${locatarioId}`);
    const list = await folderRef.listAll();

    if (list.items.length === 0) {
      container.innerHTML = `<p class="empty">Nenhum documento anexado.</p>`;
      return;
    }

    const items = await Promise.all(list.items.map(async (item) => {
      const meta = await item.getMetadata();
      const url = await item.getDownloadURL();
      const ext = (item.name.split('.').pop() || '').toLowerCase();
      const icon = (ext === 'pdf') ? '📄' : (['jpg','jpeg','png'].includes(ext) ? '🖼' : '📎');
      const sizeKb = (meta.size / 1024).toFixed(0);
      const date = new Date(meta.timeCreated).toLocaleDateString('pt-BR');
      return `
        <div class="doc-item">
          <span class="doc-icon">${icon}</span>
          <span class="doc-name">${item.name}</span>
          <span class="doc-meta">${sizeKb} KB · ${date}</span>
          <div class="doc-actions">
            <a class="btn-icon" href="${url}" target="_blank" title="Abrir">👁</a>
            <a class="btn-icon" href="${url}" download="${item.name}" title="Baixar">⬇</a>
            <button class="btn-icon btn-icon-danger" onclick="deleteLocatarioDoc('${locatarioId}','${item.name}')" title="Excluir">🗑</button>
          </div>
        </div>
      `;
    }));
    container.innerHTML = items.join('');
  } catch (err) {
    console.error('Erro ao listar docs:', err);
    container.innerHTML = `<p class="empty" style="color:var(--danger);">Erro: ${err.message}</p>`;
  }
}

async function uploadLocatarioDocs() {
  const locatarioId = $('locatario-id').value;
  if (!locatarioId) {
    showAlert('locatario-alert', 'Salve o locatário antes de anexar documentos.');
    return;
  }

  const input = $('locatario-doc-input');
  const files = Array.from(input.files || []);
  if (files.length === 0) {
    showAlert('locatario-alert', 'Selecione ao menos um arquivo.');
    return;
  }

  const tooBig = files.find(f => f.size > 10 * 1024 * 1024);
  if (tooBig) {
    showAlert('locatario-alert', `Arquivo "${tooBig.name}" excede 10MB.`);
    return;
  }

  const folderRef = storageTenantRef().child(`locatarios/${locatarioId}`);
  try {
    for (const file of files) {
      await folderRef.child(file.name).put(file, {
        contentType: file.type,
        customMetadata: { uploadedBy: State.user.uid },
      });
    }
    input.value = '';
    showAlert('locatario-alert', `${files.length} arquivo(s) enviado(s).`, 'success');
    loadLocatarioDocs(locatarioId);
  } catch (err) {
    console.error('Erro no upload:', err);
    showAlert('locatario-alert', 'Erro: ' + err.message);
  }
}

async function deleteLocatarioDoc(locatarioId, filename) {
  if (!confirm(`Excluir o arquivo "${filename}"?`)) return;
  try {
    await storageTenantRef().child(`locatarios/${locatarioId}/${filename}`).delete();
    loadLocatarioDocs(locatarioId);
  } catch (err) {
    console.error('Erro ao excluir doc:', err);
    showAlert('locatario-alert', 'Erro: ' + err.message);
  }
}

// =============================================================
// GARANTIAS — fiador / caução / seguro fiança
// =============================================================

const GARANTIA_TIPO_LABEL = {
  fiador: '🧑 Fiador',
  caucao: '💰 Caução',
  seguro_fianca: '🛡 Seguro Fiança',
};

function garantiaIdentificacao(g) {
  if (g.tipo === 'fiador') return g.fiador?.nome || '—';
  if (g.tipo === 'caucao') {
    const mod = g.caucao?.modalidade || '—';
    const label = mod === 'dinheiro' ? 'Dinheiro' : mod === 'imovel' ? 'Imóvel' : mod === 'titulo' ? 'Título' : mod;
    return `Caução em ${label}`;
  }
  if (g.tipo === 'seguro_fianca') {
    const s = g.seguro || {};
    return `${s.seguradora || 'Seguradora'} · Apólice ${s.apolice || '—'}`;
  }
  return '—';
}

function garantiaValorRef(g) {
  if (g.tipo === 'fiador' && g.fiador?.renda) return g.fiador.renda;
  if (g.tipo === 'caucao' && g.caucao?.valor) return g.caucao.valor;
  if (g.tipo === 'seguro_fianca' && g.seguro?.cobertura) return g.seguro.cobertura;
  return null;
}

function fmtBRL(n) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function loadGarantias() {
  const tbody = $('tbody-garantias');
  tbody.innerHTML = `<tr><td colspan="6" class="empty">Carregando…</td></tr>`;

  try {
    const snap = await tenantPath().collection('garantias').orderBy('criadoEm', 'desc').get();
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhuma garantia cadastrada. Clique em "Nova Garantia" para começar.</td></tr>`;
      return;
    }

    const rows = snap.docs.map((doc, i) => {
      const g = doc.data();
      const status = g.status || 'ativa';
      const statusClass = status === 'ativa' ? 'ativo' : 'suspenso';
      const statusLabel = status === 'ativa' ? 'Ativa' : 'Encerrada';
      return `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${garantiaIdentificacao(g)}</strong></td>
          <td>${GARANTIA_TIPO_LABEL[g.tipo] || g.tipo}</td>
          <td>${fmtBRL(garantiaValorRef(g))}</td>
          <td><span class="badge-status ${statusClass}">${statusLabel}</span></td>
          <td>
            <div class="action-btns">
              <button class="btn btn-sm btn-secondary" onclick="openGarantiaModal('${doc.id}')">Editar</button>
            </div>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join('');
  } catch (err) {
    console.error('Erro ao carregar garantias:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

function onGarantiaTipoChange() {
  const tipo = $('garantia-tipo').value;
  $('garantia-bloco-fiador').style.display = (tipo === 'fiador') ? 'block' : 'none';
  $('garantia-bloco-caucao').style.display = (tipo === 'caucao') ? 'block' : 'none';
  $('garantia-bloco-seguro').style.display = (tipo === 'seguro_fianca') ? 'block' : 'none';
}

function onCaucaoModalidadeChange() {
  const m = $('garantia-caucao-modalidade').value;
  $('garantia-caucao-dinheiro-extra').style.display = (m === 'dinheiro') ? 'block' : 'none';
  $('garantia-caucao-bem-extra').style.display = (m === 'imovel' || m === 'titulo') ? 'block' : 'none';
}

function onFiadorEstadoCivilChange() {
  const ec = $('garantia-fiador-estado-civil').value;
  const mostra = (ec === 'casado' || ec === 'uniao_estavel');
  $('garantia-fiador-conjuge-wrap').style.display = mostra ? 'block' : 'none';
}

function onGarantiaFiadorCPFInput() {
  const digits = $('garantia-fiador-cpf').value.replace(/\D/g, '');
  const status = $('garantia-fiador-cpf-status');
  if (digits.length === 0) { status.style.display = 'none'; return; }
  status.style.display = 'block';
  if (digits.length < 11) {
    status.textContent = `${digits.length}/11 dígitos`;
    status.style.color = 'var(--text-muted)';
  } else if (isCPFValid(digits)) {
    status.textContent = '✓ CPF válido';
    status.style.color = 'var(--success)';
  } else {
    status.textContent = '✗ CPF inválido';
    status.style.color = 'var(--danger)';
  }
}

function onGarantiaConjugeCPFInput() {
  const digits = $('garantia-fiador-conjuge-cpf').value.replace(/\D/g, '');
  const status = $('garantia-fiador-conjuge-cpf-status');
  if (digits.length === 0) { status.style.display = 'none'; return; }
  status.style.display = 'block';
  if (digits.length < 11) {
    status.textContent = `${digits.length}/11 dígitos`;
    status.style.color = 'var(--text-muted)';
  } else if (isCPFValid(digits)) {
    status.textContent = '✓ CPF válido';
    status.style.color = 'var(--success)';
  } else {
    status.textContent = '✗ CPF inválido';
    status.style.color = 'var(--danger)';
  }
}

async function buscarCEPFiador() {
  const input = $('garantia-fiador-cep');
  const status = $('garantia-fiador-cep-status');
  const cepRaw = (input.value || '').replace(/\D/g, '');

  if (cepRaw.length === 0) return;
  if (cepRaw.length !== 8) {
    showAlert('garantia-alert', 'CEP deve ter 8 dígitos.');
    return;
  }

  input.value = cepRaw.replace(/(\d{5})(\d{3})/, '$1-$2');
  status.style.display = 'block';
  status.textContent = 'Buscando…';
  status.style.color = 'var(--primary)';

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepRaw}/json/`);
    const data = await res.json();
    if (data.erro) {
      status.textContent = 'CEP não encontrado';
      status.style.color = 'var(--danger)';
      return;
    }
    if (data.logradouro) $('garantia-fiador-logradouro').value = data.logradouro;
    if (data.bairro)     $('garantia-fiador-bairro').value     = data.bairro;
    if (data.localidade) $('garantia-fiador-cidade').value     = data.localidade;
    if (data.uf)         $('garantia-fiador-uf').value         = data.uf;
    status.textContent = '✓';
    status.style.color = 'var(--success)';
    $('garantia-fiador-numero').focus();
  } catch (err) {
    console.error('Erro CEP:', err);
    status.textContent = 'Erro de conexão';
    status.style.color = 'var(--danger)';
  }
}

async function openGarantiaModal(id) {
  clearAlert('garantia-alert');

  $('garantia-id').value = id || '';
  $('modal-garantia-title').textContent = id ? 'Editar Garantia' : 'Nova Garantia';
  $('btn-delete-garantia').style.display = id ? 'inline-block' : 'none';

  // Reset comum
  $('garantia-tipo').value = 'fiador';
  $('garantia-status').value = 'ativa';
  $('garantia-inicio').value = '';
  $('garantia-obs').value = '';

  // Reset fiador
  ['garantia-fiador-nome', 'garantia-fiador-cpf', 'garantia-fiador-rg',
   'garantia-fiador-nascimento', 'garantia-fiador-profissao',
   'garantia-fiador-email', 'garantia-fiador-telefone',
   'garantia-fiador-cep', 'garantia-fiador-logradouro', 'garantia-fiador-numero',
   'garantia-fiador-complemento', 'garantia-fiador-bairro', 'garantia-fiador-cidade',
   'garantia-fiador-uf', 'garantia-fiador-renda', 'garantia-fiador-bens',
   'garantia-fiador-conjuge-nome', 'garantia-fiador-conjuge-cpf'].forEach(f => $(f).value = '');
  $('garantia-fiador-estado-civil').value = '';
  $('garantia-fiador-cpf-status').style.display = 'none';
  $('garantia-fiador-cep-status').style.display = 'none';
  $('garantia-fiador-conjuge-cpf-status').style.display = 'none';

  // Reset caução
  $('garantia-caucao-modalidade').value = 'dinheiro';
  ['garantia-caucao-data', 'garantia-caucao-valor', 'garantia-caucao-banco',
   'garantia-caucao-agencia', 'garantia-caucao-conta', 'garantia-caucao-bem-descricao'].forEach(f => $(f).value = '');

  // Reset seguro
  ['garantia-seguro-seguradora', 'garantia-seguro-apolice',
   'garantia-seguro-vigencia-ini', 'garantia-seguro-vigencia-fim',
   'garantia-seguro-cobertura', 'garantia-seguro-premio',
   'garantia-seguro-parcelas'].forEach(f => $(f).value = '');
  $('garantia-seguro-forma').value = '';

  onGarantiaTipoChange();
  onCaucaoModalidadeChange();
  onFiadorEstadoCivilChange();

  if (id) {
    try {
      const snap = await tenantPath().collection('garantias').doc(id).get();
      if (snap.exists) {
        const g = snap.data();
        $('garantia-tipo').value = g.tipo || 'fiador';
        $('garantia-status').value = g.status || 'ativa';
        $('garantia-inicio').value = g.inicio || '';
        $('garantia-obs').value = g.obs || '';

        if (g.fiador) {
          const f = g.fiador;
          $('garantia-fiador-nome').value = f.nome || '';
          $('garantia-fiador-cpf').value = f.cpf ? maskCPF(f.cpf) : '';
          $('garantia-fiador-rg').value = f.rg || '';
          $('garantia-fiador-nascimento').value = f.nascimento || '';
          $('garantia-fiador-profissao').value = f.profissao || '';
          $('garantia-fiador-estado-civil').value = f.estadoCivil || '';
          $('garantia-fiador-email').value = f.email || '';
          $('garantia-fiador-telefone').value = f.telefone ? maskTelefone(f.telefone) : '';
          const end = f.endereco || {};
          $('garantia-fiador-cep').value = end.cep ? maskCEP(end.cep) : '';
          $('garantia-fiador-logradouro').value = end.logradouro || '';
          $('garantia-fiador-numero').value = end.numero || '';
          $('garantia-fiador-complemento').value = end.complemento || '';
          $('garantia-fiador-bairro').value = end.bairro || '';
          $('garantia-fiador-cidade').value = end.cidade || '';
          $('garantia-fiador-uf').value = end.uf || '';
          $('garantia-fiador-renda').value = f.renda ?? '';
          $('garantia-fiador-bens').value = f.bens || '';
          $('garantia-fiador-conjuge-nome').value = f.conjugeNome || '';
          $('garantia-fiador-conjuge-cpf').value = f.conjugeCpf ? maskCPF(f.conjugeCpf) : '';
          onFiadorEstadoCivilChange();
          onGarantiaFiadorCPFInput();
          onGarantiaConjugeCPFInput();
        }

        if (g.caucao) {
          const c = g.caucao;
          $('garantia-caucao-modalidade').value = c.modalidade || 'dinheiro';
          $('garantia-caucao-data').value = c.data || '';
          $('garantia-caucao-valor').value = c.valor ?? '';
          $('garantia-caucao-banco').value = c.banco || '';
          $('garantia-caucao-agencia').value = c.agencia || '';
          $('garantia-caucao-conta').value = c.conta || '';
          $('garantia-caucao-bem-descricao').value = c.bemDescricao || '';
          onCaucaoModalidadeChange();
        }

        if (g.seguro) {
          const s = g.seguro;
          $('garantia-seguro-seguradora').value = s.seguradora || '';
          $('garantia-seguro-apolice').value = s.apolice || '';
          $('garantia-seguro-vigencia-ini').value = s.vigenciaInicio || '';
          $('garantia-seguro-vigencia-fim').value = s.vigenciaFim || '';
          $('garantia-seguro-cobertura').value = s.cobertura ?? '';
          $('garantia-seguro-premio').value = s.premio ?? '';
          $('garantia-seguro-forma').value = s.formaPagamento || '';
          $('garantia-seguro-parcelas').value = s.parcelas ?? '';
        }

        onGarantiaTipoChange();
      }
    } catch (err) {
      console.error('Erro ao carregar garantia:', err);
      showAlert('garantia-alert', 'Erro ao carregar dados: ' + err.message);
    }
    $('garantia-docs-section').style.display = 'block';
    loadGarantiaDocs(id);
  } else {
    $('garantia-docs-section').style.display = 'none';
  }

  $('modal-garantia').style.display = 'flex';
}

function closeGarantiaModal() {
  $('modal-garantia').style.display = 'none';
}

async function saveGarantia() {
  clearAlert('garantia-alert');

  const id = $('garantia-id').value;
  const tipo = $('garantia-tipo').value;

  // Validações específicas
  if (tipo === 'fiador') {
    if (!$('garantia-fiador-nome').value.trim()) {
      showAlert('garantia-alert', 'Nome do fiador é obrigatório.');
      return;
    }
    const cpfDigits = $('garantia-fiador-cpf').value.replace(/\D/g, '');
    if (!cpfDigits) {
      showAlert('garantia-alert', 'CPF do fiador é obrigatório.');
      return;
    }
  } else if (tipo === 'seguro_fianca') {
    if (!$('garantia-seguro-seguradora').value.trim()) {
      showAlert('garantia-alert', 'Seguradora é obrigatória.');
      return;
    }
    if (!$('garantia-seguro-apolice').value.trim()) {
      showAlert('garantia-alert', 'Número da apólice é obrigatório.');
      return;
    }
  }

  const data = {
    tipo,
    status: $('garantia-status').value,
    inicio: $('garantia-inicio').value || null,
    obs: $('garantia-obs').value.trim() || null,
    fiador: null,
    caucao: null,
    seguro: null,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  };

  if (tipo === 'fiador') {
    data.fiador = {
      nome: $('garantia-fiador-nome').value.trim(),
      cpf: $('garantia-fiador-cpf').value.replace(/\D/g, ''),
      rg: $('garantia-fiador-rg').value.trim() || null,
      nascimento: $('garantia-fiador-nascimento').value || null,
      profissao: $('garantia-fiador-profissao').value.trim() || null,
      estadoCivil: $('garantia-fiador-estado-civil').value || null,
      email: $('garantia-fiador-email').value.trim() || null,
      telefone: $('garantia-fiador-telefone').value.replace(/\D/g, '') || null,
      endereco: {
        cep: $('garantia-fiador-cep').value.replace(/\D/g, '') || null,
        logradouro: $('garantia-fiador-logradouro').value.trim() || null,
        numero: $('garantia-fiador-numero').value.trim() || null,
        complemento: $('garantia-fiador-complemento').value.trim() || null,
        bairro: $('garantia-fiador-bairro').value.trim() || null,
        cidade: $('garantia-fiador-cidade').value.trim() || null,
        uf: $('garantia-fiador-uf').value.trim().toUpperCase() || null,
      },
      renda: parseFloat($('garantia-fiador-renda').value) || null,
      bens: $('garantia-fiador-bens').value.trim() || null,
      conjugeNome: $('garantia-fiador-conjuge-nome').value.trim() || null,
      conjugeCpf: $('garantia-fiador-conjuge-cpf').value.replace(/\D/g, '') || null,
    };
  } else if (tipo === 'caucao') {
    data.caucao = {
      modalidade: $('garantia-caucao-modalidade').value,
      data: $('garantia-caucao-data').value || null,
      valor: parseFloat($('garantia-caucao-valor').value) || null,
      banco: $('garantia-caucao-banco').value.trim() || null,
      agencia: $('garantia-caucao-agencia').value.trim() || null,
      conta: $('garantia-caucao-conta').value.trim() || null,
      bemDescricao: $('garantia-caucao-bem-descricao').value.trim() || null,
    };
  } else if (tipo === 'seguro_fianca') {
    data.seguro = {
      seguradora: $('garantia-seguro-seguradora').value.trim(),
      apolice: $('garantia-seguro-apolice').value.trim(),
      vigenciaInicio: $('garantia-seguro-vigencia-ini').value || null,
      vigenciaFim: $('garantia-seguro-vigencia-fim').value || null,
      cobertura: parseFloat($('garantia-seguro-cobertura').value) || null,
      premio: parseFloat($('garantia-seguro-premio').value) || null,
      formaPagamento: $('garantia-seguro-forma').value || null,
      parcelas: parseInt($('garantia-seguro-parcelas').value, 10) || null,
    };
  }

  const btn = $('btn-save-garantia');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  try {
    if (id) {
      await tenantPath().collection('garantias').doc(id).update(data);
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('garantias').add(data);
      btn.disabled = false;
      btn.textContent = 'Salvar';
      invalidateGarantiasCache();
      await openGarantiaModal(docRef.id);
      showAlert('garantia-alert', 'Garantia criada. Agora você pode anexar documentos.', 'success');
      loadGarantias();
      return;
    }
    invalidateGarantiasCache();
    closeGarantiaModal();
    loadGarantias();
  } catch (err) {
    console.error('Erro ao salvar:', err);
    showAlert('garantia-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function deleteGarantia() {
  const id = $('garantia-id').value;
  if (!id) return;
  if (!confirm('Excluir esta garantia? Os documentos anexados também serão removidos. Esta ação não pode ser desfeita.')) return;

  try {
    const folderRef = storageTenantRef().child(`garantias/${id}`);
    try {
      const list = await folderRef.listAll();
      await Promise.all(list.items.map(item => item.delete()));
    } catch (_) { /* pasta pode não existir */ }

    await tenantPath().collection('garantias').doc(id).delete();
    invalidateGarantiasCache();
    closeGarantiaModal();
    loadGarantias();
  } catch (err) {
    console.error('Erro ao excluir:', err);
    showAlert('garantia-alert', 'Erro: ' + err.message);
  }
}

async function loadGarantiaDocs(garantiaId) {
  const container = $('garantia-docs-list');
  container.innerHTML = `<p class="empty">Carregando documentos…</p>`;

  try {
    const folderRef = storageTenantRef().child(`garantias/${garantiaId}`);
    const list = await folderRef.listAll();

    if (list.items.length === 0) {
      container.innerHTML = `<p class="empty">Nenhum documento anexado.</p>`;
      return;
    }

    const items = await Promise.all(list.items.map(async (item) => {
      const meta = await item.getMetadata();
      const url = await item.getDownloadURL();
      const ext = (item.name.split('.').pop() || '').toLowerCase();
      const icon = (ext === 'pdf') ? '📄' : (['jpg','jpeg','png'].includes(ext) ? '🖼' : '📎');
      const sizeKb = (meta.size / 1024).toFixed(0);
      const date = new Date(meta.timeCreated).toLocaleDateString('pt-BR');
      return `
        <div class="doc-item">
          <span class="doc-icon">${icon}</span>
          <span class="doc-name">${item.name}</span>
          <span class="doc-meta">${sizeKb} KB · ${date}</span>
          <div class="doc-actions">
            <a class="btn-icon" href="${url}" target="_blank" title="Abrir">👁</a>
            <a class="btn-icon" href="${url}" download="${item.name}" title="Baixar">⬇</a>
            <button class="btn-icon btn-icon-danger" onclick="deleteGarantiaDoc('${garantiaId}','${item.name}')" title="Excluir">🗑</button>
          </div>
        </div>
      `;
    }));
    container.innerHTML = items.join('');
  } catch (err) {
    console.error('Erro ao listar docs:', err);
    container.innerHTML = `<p class="empty" style="color:var(--danger);">Erro: ${err.message}</p>`;
  }
}

async function uploadGarantiaDocs() {
  const garantiaId = $('garantia-id').value;
  if (!garantiaId) {
    showAlert('garantia-alert', 'Salve a garantia antes de anexar documentos.');
    return;
  }

  const input = $('garantia-doc-input');
  const files = Array.from(input.files || []);
  if (files.length === 0) {
    showAlert('garantia-alert', 'Selecione ao menos um arquivo.');
    return;
  }

  const tooBig = files.find(f => f.size > 10 * 1024 * 1024);
  if (tooBig) {
    showAlert('garantia-alert', `Arquivo "${tooBig.name}" excede 10MB.`);
    return;
  }

  const folderRef = storageTenantRef().child(`garantias/${garantiaId}`);
  try {
    for (const file of files) {
      await folderRef.child(file.name).put(file, {
        contentType: file.type,
        customMetadata: { uploadedBy: State.user.uid },
      });
    }
    input.value = '';
    showAlert('garantia-alert', `${files.length} arquivo(s) enviado(s).`, 'success');
    loadGarantiaDocs(garantiaId);
  } catch (err) {
    console.error('Erro no upload:', err);
    showAlert('garantia-alert', 'Erro: ' + err.message);
  }
}

async function deleteGarantiaDoc(garantiaId, filename) {
  if (!confirm(`Excluir o arquivo "${filename}"?`)) return;
  try {
    await storageTenantRef().child(`garantias/${garantiaId}/${filename}`).delete();
    loadGarantiaDocs(garantiaId);
  } catch (err) {
    console.error('Erro ao excluir doc:', err);
    showAlert('garantia-alert', 'Erro: ' + err.message);
  }
}

// =============================================================
// BALANCETES — apuração mensal por contrato
// =============================================================

const BALANCETE_STATUS_LABEL = {
  aberto: 'Aberto',
  fechado: 'Fechado',
  enviado: 'Enviado',
};

const LANC_CATEGORIAS = {
  entrada: ['aluguel', 'multa_juros', 'reembolso_locatario', 'mobilia', 'garagem_extra', 'outros'],
  despesa_locador: ['iptu', 'condominio', 'manutencao', 'seguro', 'outros'],
  despesa_locatario: ['agua', 'luz', 'gas', 'internet', 'outros'],
};

const LANC_CATEGORIA_LABEL = {
  aluguel: 'Aluguel',
  multa_juros: 'Multa / Juros',
  reembolso_locatario: 'Reembolso do locatário',
  mobilia: 'Mobília',
  garagem_extra: 'Garagem extra',
  iptu: 'IPTU',
  condominio: 'Condomínio',
  manutencao: 'Manutenção',
  seguro: 'Seguro',
  agua: 'Água',
  luz: 'Luz',
  gas: 'Gás',
  internet: 'Internet',
  outros: 'Outros (custom)',
};

// State local do balancete em edição
let _balanceteLancamentos = []; // { id, bloco, categoria, descricao, valor, comprovantePath, comprovanteNome }
let _balanceteLocadorInfo = null; // cache de { nome, pix, banco } pra montar texto do Pix

function balanceteId(ano, mes, contratoId) {
  return `${ano}_${String(mes).padStart(2, '0')}_${contratoId}`;
}

function fmtMesAno(mes, ano) {
  const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return `${meses[mes - 1]}/${ano}`;
}

async function loadBalancetes() {
  const tbody = $('tbody-balancetes');
  tbody.innerHTML = `<tr><td colspan="8" class="empty">Carregando…</td></tr>`;

  const mes = parseInt($('filtro-balancete-mes').value, 10);
  const ano = parseInt($('filtro-balancete-ano').value, 10);
  if (!mes || !ano) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">Selecione mês e ano.</td></tr>`;
    return;
  }

  try {
    const [snap, imoveis, locadores, locatarios] = await Promise.all([
      tenantPath().collection('balancetes').where('mes', '==', mes).where('ano', '==', ano).get(),
      ensureImoveisCache(),
      ensureLocadoresCache(),
      ensureLocatariosCache(),
    ]);

    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">Nenhum balancete para ${fmtMesAno(mes, ano)}. Clique em "Novo Balancete" para criar.</td></tr>`;
      return;
    }

    const imMap = Object.fromEntries(imoveis.map(i => [i.id, i.apelido]));
    const locadorMap = Object.fromEntries(locadores.map(l => [l.id, l.nome]));
    const locatarioMap = Object.fromEntries(locatarios.map(l => [l.id, l.nome]));

    const rows = snap.docs.map((doc, i) => {
      const b = doc.data();
      const status = b.status || 'aberto';
      return `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${imMap[b.imovelId] || '—'}</strong></td>
          <td>${locadorMap[b.locadorId] || '—'}</td>
          <td>${locatarioMap[b.locatarioId] || '—'}</td>
          <td>${fmtBRL(b.aluguelBase)}</td>
          <td><strong>${fmtBRL(b.liquidoLocador)}</strong></td>
          <td><span class="badge-status ${status}">${BALANCETE_STATUS_LABEL[status] || status}</span></td>
          <td><div class="action-btns"><button class="btn btn-sm btn-secondary" onclick="openBalanceteModal('${doc.id}')">Editar</button></div></td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join('');
  } catch (err) {
    console.error('Erro ao carregar balancetes:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

// Inicializa filtros do mês/ano com mês atual
function initBalanceteFiltros() {
  const hoje = new Date();
  if (!$('filtro-balancete-ano').value) $('filtro-balancete-ano').value = hoje.getFullYear();
  if ($('filtro-balancete-mes').value === '') $('filtro-balancete-mes').value = hoje.getMonth() + 1;
}

// ----- Modal -----

async function populateBalanceteContratos(selected) {
  const select = $('balancete-contrato');
  select.innerHTML = '<option value="">— Selecione —</option>';

  try {
    const snap = await tenantPath().collection('contratos').get();
    const [imoveis, locatarios] = await Promise.all([
      ensureImoveisCache(),
      ensureLocatariosCache(),
    ]);
    const imMap = Object.fromEntries(imoveis.map(i => [i.id, i.apelido]));
    const locMap = Object.fromEntries(locatarios.map(l => [l.id, l.nome]));

    const opts = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.status === 'vigente' || c.id === selected)
      .map(c => {
        const im = imMap[c.imovelId] || 'Imóvel';
        const loc = locMap[c.locatarioId] || 'Locatário';
        const sel = c.id === selected ? ' selected' : '';
        return `<option value="${c.id}"${sel}>${im} · ${loc} · ${fmtBRL(c.aluguel)}</option>`;
      });

    select.innerHTML += opts.join('');
  } catch (err) {
    console.error('Erro ao carregar contratos:', err);
  }
}

async function openBalanceteModal(id) {
  clearAlert('balancete-alert');
  $('balancete-id').value = id || '';
  $('modal-balancete-title').textContent = id ? 'Editar Balancete' : 'Novo Balancete';
  $('btn-delete-balancete').style.display = id ? 'inline-block' : 'none';

  _balanceteLancamentos = [];
  _balanceteLocadorInfo = null;
  $('balancete-aluguel-base').value = '';
  $('balancete-taxa-adm').value = '';
  $('balancete-taxa-valor').value = '';
  $('balancete-obs').value = '';
  $('balancete-status').value = 'aberto';
  $('balancete-contrato-info').style.display = 'none';
  $('resumo-pix').style.display = 'none';
  $('resumo-pix-aviso').style.display = 'none';

  const hoje = new Date();
  if (!id) {
    $('balancete-mes').value = parseInt($('filtro-balancete-mes').value, 10) || (hoje.getMonth() + 1);
    $('balancete-ano').value = parseInt($('filtro-balancete-ano').value, 10) || hoje.getFullYear();
  }

  let selectedContratoId = null;
  $('btn-gerar-balancete').style.display = id ? 'inline-block' : 'none';
  $('btn-enviar-balancete').style.display = id ? 'inline-block' : 'none';

  if (id) {
    try {
      const snap = await tenantPath().collection('balancetes').doc(id).get();
      if (snap.exists) {
        const b = snap.data();
        selectedContratoId = b.contratoId;
        $('balancete-mes').value = b.mes;
        $('balancete-ano').value = b.ano;
        $('balancete-status').value = b.status || 'aberto';
        $('balancete-aluguel-base').value = b.aluguelBase ?? '';
        $('balancete-taxa-adm').value = b.taxaAdm ?? '';
        $('balancete-obs').value = b.obs || '';
        _balanceteLancamentos = (b.lancamentos || []).map(l => ({
          ...l,
          id: l.id || cryptoRandomId(),
        }));
      }
    } catch (err) {
      console.error('Erro ao carregar balancete:', err);
    }
  }

  await populateBalanceteContratos(selectedContratoId);
  if (selectedContratoId) $('balancete-contrato').value = selectedContratoId;
  await refreshBalanceteContratoInfo();
  await refreshBalancetePixInfo();

  renderLancamentos();
  recalcBalancete();
  aplicarStatusBalancete();
  $('modal-balancete').style.display = 'flex';
}

async function refreshBalancetePixInfo() {
  // Busca o locador via contrato selecionado pra pegar a chave Pix
  const contratoId = $('balancete-contrato').value;
  const pixBox = $('resumo-pix');
  const avisoBox = $('resumo-pix-aviso');
  pixBox.style.display = 'none';
  avisoBox.style.display = 'none';
  _balanceteLocadorInfo = null;
  if (!contratoId) return;

  try {
    const cSnap = await tenantPath().collection('contratos').doc(contratoId).get();
    if (!cSnap.exists) return;
    const c = cSnap.data();
    if (!c.locadorId) return;

    const locSnap = await tenantPath().collection('locadores').doc(c.locadorId).get();
    if (!locSnap.exists) return;
    const loc = locSnap.data();

    _balanceteLocadorInfo = {
      nome: loc.nome || '',
      pix: loc.pix || null,
      banco: loc.banco || null,
    };

    if (loc.pix) {
      $('resumo-pix-chave').textContent = loc.pix;
      pixBox.style.display = 'flex';
    } else {
      avisoBox.style.display = 'block';
    }
  } catch (err) {
    console.warn('Não foi possível carregar Pix do locador:', err);
  }
}

function copiarPixLocador() {
  if (!_balanceteLocadorInfo || !_balanceteLocadorInfo.pix) {
    showAlert('balancete-alert', 'Locador não tem chave Pix cadastrada.');
    return;
  }

  const liquidoText = $('resumo-liquido').textContent;
  const mes = parseInt($('balancete-mes').value, 10);
  const ano = parseInt($('balancete-ano').value, 10);
  const contratoSelect = $('balancete-contrato');
  const contratoLabel = contratoSelect.options[contratoSelect.selectedIndex]?.text || '';
  const imovelApelido = contratoLabel.split(' · ')[0] || 'Imóvel';

  const texto = [
    `Pagamento — Balancete ${fmtMesAno(mes, ano)}`,
    `Imóvel: ${imovelApelido}`,
    `Locador: ${_balanceteLocadorInfo.nome}`,
    `Valor: ${liquidoText}`,
    `Chave Pix: ${_balanceteLocadorInfo.pix}`,
    _balanceteLocadorInfo.banco ? `Banco/Agência/Conta: ${_balanceteLocadorInfo.banco}` : '',
  ].filter(Boolean).join('\n');

  navigator.clipboard.writeText(texto).then(() => {
    showAlert('balancete-alert', '✓ Dados copiados! Cole no app do banco para fazer o Pix.', 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = texto;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showAlert('balancete-alert', '✓ Dados copiados!', 'success');
  });
}

function closeBalanceteModal() { $('modal-balancete').style.display = 'none'; }

function cryptoRandomId() {
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

async function onBalanceteContratoChange() {
  await refreshBalanceteContratoInfo();
  await refreshBalancetePixInfo();
}

async function refreshBalanceteContratoInfo() {
  const contratoId = $('balancete-contrato').value;
  const info = $('balancete-contrato-info');
  if (!contratoId) { info.style.display = 'none'; $('balancete-aluguel-base').value = ''; $('balancete-taxa-adm').value = ''; recalcBalancete(); return; }

  try {
    const snap = await tenantPath().collection('contratos').doc(contratoId).get();
    if (!snap.exists) return;
    const c = snap.data();
    $('balancete-aluguel-base').value = (c.aluguel ?? 0).toFixed(2);
    if (!$('balancete-taxa-adm').value) $('balancete-taxa-adm').value = c.taxaAdm ?? 10;

    // Garante linha de Aluguel nas Entradas se ainda não tiver
    const jaTemAluguel = _balanceteLancamentos.some(l => l.bloco === 'entrada' && l.categoria === 'aluguel');
    if (!jaTemAluguel && !$('balancete-id').value) {
      _balanceteLancamentos.unshift({
        id: cryptoRandomId(),
        bloco: 'entrada',
        categoria: 'aluguel',
        descricao: 'Aluguel mensal',
        valor: c.aluguel || 0,
        comprovantePath: null,
        comprovanteNome: null,
      });
      renderLancamentos();
    }

    info.style.display = 'block';
    info.textContent = `Aluguel ${fmtBRL(c.aluguel)} · Taxa adm padrão ${c.taxaAdm}% · Vencimento dia ${c.diaVencimento}`;
    info.style.color = 'var(--text-muted)';
    recalcBalancete();
  } catch (err) {
    console.error('Erro ao buscar contrato:', err);
  }
}

function renderLancamentos() {
  const blocos = ['entrada', 'despesa_locador', 'despesa_locatario'];
  blocos.forEach(bloco => {
    const list = $('lanc-' + bloco.replace('_', '-') + '-list');
    const linhas = _balanceteLancamentos.filter(l => l.bloco === bloco);
    if (linhas.length === 0) {
      list.innerHTML = '<div class="empty-lanc">Nenhum lançamento — clique em + Adicionar.</div>';
      return;
    }
    list.innerHTML = linhas.map(l => renderLancRow(l)).join('');
  });
}

function renderLancRow(l) {
  const cats = LANC_CATEGORIAS[l.bloco] || [];
  const catOptions = cats.map(c => {
    const sel = c === l.categoria ? ' selected' : '';
    return `<option value="${c}"${sel}>${LANC_CATEGORIA_LABEL[c] || c}</option>`;
  }).join('');

  const hasFile = !!l.comprovantePath;
  const fileLabel = hasFile ? '📎 ' + (l.comprovanteNome || 'anexado').slice(0, 14) : '📎 Anexar';
  const fileClass = hasFile ? 'lanc-comprovante-btn has-file' : 'lanc-comprovante-btn';

  return `
    <div class="lanc-row" data-id="${l.id}">
      <select onchange="updateLanc('${l.id}', 'categoria', this.value)">${catOptions}</select>
      <input type="text" value="${(l.descricao || '').replace(/"/g, '&quot;')}" placeholder="Descrição" oninput="updateLanc('${l.id}', 'descricao', this.value)">
      <input type="number" min="0" step="0.01" value="${l.valor ?? ''}" placeholder="0,00" oninput="updateLanc('${l.id}', 'valor', parseFloat(this.value) || 0)">
      <label class="${fileClass}" title="${hasFile ? 'Trocar comprovante' : 'Anexar comprovante'}">
        <span>${fileLabel}</span>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" onchange="uploadLancComprovante('${l.id}', this.files[0])">
        ${hasFile ? `<a href="#" onclick="abrirLancComprovante(event, '${l.id}')" style="margin-left:4px;">↗</a>` : ''}
      </label>
      <button class="lanc-del" title="Excluir" onclick="removeLanc('${l.id}')">×</button>
    </div>
  `;
}

function updateLanc(id, campo, valor) {
  const idx = _balanceteLancamentos.findIndex(l => l.id === id);
  if (idx === -1) return;
  _balanceteLancamentos[idx][campo] = valor;
  if (campo === 'valor') recalcBalancete();
}

function addLancamento(bloco) {
  const defaultCat = LANC_CATEGORIAS[bloco][0];
  _balanceteLancamentos.push({
    id: cryptoRandomId(),
    bloco,
    categoria: defaultCat,
    descricao: LANC_CATEGORIA_LABEL[defaultCat] || '',
    valor: 0,
    comprovantePath: null,
    comprovanteNome: null,
  });
  renderLancamentos();
  recalcBalancete();
}

function removeLanc(id) {
  if (!confirm('Remover este lançamento?')) return;
  _balanceteLancamentos = _balanceteLancamentos.filter(l => l.id !== id);
  renderLancamentos();
  recalcBalancete();
}

function recalcBalancete() {
  const sum = (bloco) => _balanceteLancamentos.filter(l => l.bloco === bloco)
    .reduce((acc, l) => acc + (parseFloat(l.valor) || 0), 0);

  const totalEntradas = sum('entrada');
  const totalDespLocador = sum('despesa_locador');
  const totalDespLocatario = sum('despesa_locatario');

  // Taxa adm é calculada sobre o aluguel-base do contrato
  const aluguelBase = parseFloat($('balancete-aluguel-base').value) || 0;
  const taxaPercent = parseFloat($('balancete-taxa-adm').value) || 0;
  const taxaValor = aluguelBase * taxaPercent / 100;

  const liquido = totalEntradas - totalDespLocador - taxaValor;

  $('total-entradas').textContent = fmtBRL(totalEntradas);
  $('total-despesas-locador').textContent = fmtBRL(totalDespLocador);
  $('total-despesas-locatario').textContent = fmtBRL(totalDespLocatario);
  $('balancete-taxa-valor').value = taxaValor.toFixed(2);

  $('resumo-entradas').textContent = fmtBRL(totalEntradas);
  $('resumo-despesas-locador').textContent = fmtBRL(totalDespLocador);
  $('resumo-taxa-adm').textContent = fmtBRL(taxaValor);
  $('resumo-liquido').textContent = fmtBRL(liquido);
}

function aplicarStatusBalancete() {
  const fechado = $('balancete-status').value !== 'aberto';
  // Trava edição se fechado
  document.querySelectorAll('#modal-balancete .lanc-row input, #modal-balancete .lanc-row select, #modal-balancete .lanc-row button').forEach(el => {
    el.disabled = fechado;
  });
  $('balancete-taxa-adm').disabled = fechado;
}

// ----- Leitura de boleto via Gemini Vision -----

let _boletoContexto = null; // { bloco, file }

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.substring(result.indexOf(',') + 1);
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

async function lerBoletoLancamento(bloco) {
  if ($('balancete-status').value !== 'aberto' && $('balancete-id').value) {
    showAlert('balancete-alert', 'Reabra o balancete para adicionar lançamentos.');
    return;
  }

  // Verifica se há URL do Worker configurada
  try {
    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (!cfg.workerGeminiUrl) {
      showAlert('balancete-alert', 'Configure a URL do Worker Gemini em Configurações antes de usar a leitura de boleto.');
      return;
    }
  } catch (_) {}

  // Abre file picker programaticamente
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.jpg,.jpeg,.png,.webp';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      showAlert('balancete-alert', 'Arquivo excede 4MB.');
      return;
    }
    _boletoContexto = { bloco, file };
    await processarBoleto(file, bloco);
  };
  input.click();
}

async function processarBoleto(file, bloco) {
  showAlert('balancete-alert', '🤖 Lendo boleto com Gemini Vision... pode levar alguns segundos.', 'info');

  try {
    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (!cfg.workerGeminiUrl) {
      showAlert('balancete-alert', 'Configure a URL do Worker Gemini em Configurações.');
      return;
    }

    const fileBase64 = await fileToBase64(file);
    const res = await fetch(cfg.workerGeminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileBase64,
        mimeType: file.type || 'application/pdf',
      }),
    });

    if (!res.ok) {
      let errMsg = `Erro ${res.status}`;
      try { const j = await res.json(); if (j.error) errMsg = j.error; } catch (_) {}
      throw new Error(errMsg);
    }

    const result = await res.json();
    if (!result.success || !result.data) {
      throw new Error('Resposta inválida do Worker');
    }

    abrirBoletoRevisao(result.data, bloco, file);
    clearAlert('balancete-alert');
  } catch (err) {
    console.error('Erro ao processar boleto:', err);
    showAlert('balancete-alert', 'Erro ao ler boleto: ' + err.message);
  }
}

function abrirBoletoRevisao(dados, bloco, file) {
  _boletoContexto = { bloco, file, dadosOriginais: dados };

  // Popula categorias do bloco
  const cats = LANC_CATEGORIAS[bloco] || [];
  const catSelect = $('boleto-categoria');
  catSelect.innerHTML = cats.map(c => {
    const sel = c === dados.categoria_sugerida ? ' selected' : '';
    return `<option value="${c}"${sel}>${LANC_CATEGORIA_LABEL[c] || c}</option>`;
  }).join('');

  $('boleto-descricao').value = dados.descricao || '';
  $('boleto-valor').value = dados.valor || '';
  $('boleto-vencimento').value = dados.vencimento || '';
  $('boleto-competencia').value = dados.competencia || '';
  $('boleto-beneficiario').value = dados.beneficiario || '';
  $('boleto-doc-benef').value = dados.documento_beneficiario || '';
  $('boleto-linha-digitavel').value = dados.linha_digitavel || '';
  $('boleto-arquivo-nome').textContent = file.name;

  clearAlert('boleto-alert');
  $('modal-boleto-revisao').style.display = 'flex';
}

function closeBoletoRevisao() {
  $('modal-boleto-revisao').style.display = 'none';
  _boletoContexto = null;
}

async function confirmarBoletoExtraido() {
  if (!_boletoContexto) return;
  const { bloco, file, dadosOriginais } = _boletoContexto;

  const valor = parseFloat($('boleto-valor').value);
  if (!valor || valor <= 0) {
    showAlert('boleto-alert', 'Valor é obrigatório.');
    return;
  }

  const categoria = $('boleto-categoria').value;
  const descricao = $('boleto-descricao').value.trim() || LANC_CATEGORIA_LABEL[categoria] || categoria;

  const lancId = cryptoRandomId();
  _balanceteLancamentos.push({
    id: lancId,
    bloco,
    categoria,
    descricao,
    valor,
    comprovantePath: null,
    comprovanteNome: null,
    // metadados extras do boleto
    boletoVencimento: $('boleto-vencimento').value || null,
    boletoCompetencia: $('boleto-competencia').value || null,
    boletoBeneficiario: $('boleto-beneficiario').value.trim() || null,
    boletoDocBeneficiario: $('boleto-doc-benef').value.trim() || null,
    boletoLinhaDigitavel: $('boleto-linha-digitavel').value.trim() || null,
  });

  // Faz upload do boleto como comprovante
  const balanceteId = $('balancete-id').value || `temp_${Date.now()}`;
  try {
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `balancetes/${balanceteId}/comprovantes/${lancId}_${cleanName}`;
    const ref = storageTenantRef().child(path);
    await ref.put(file, { contentType: file.type });
    const idx = _balanceteLancamentos.findIndex(l => l.id === lancId);
    if (idx !== -1) {
      _balanceteLancamentos[idx].comprovantePath = path;
      _balanceteLancamentos[idx].comprovanteNome = file.name;
    }
  } catch (err) {
    console.warn('Falha ao anexar boleto (lançamento criado mesmo assim):', err);
  }

  closeBoletoRevisao();
  renderLancamentos();
  recalcBalancete();
  showAlert('balancete-alert', `✓ Lançamento criado: ${descricao} (${fmtBRL(valor)})`, 'success');
}

async function uploadLancComprovante(id, file) {
  if (!file) return;
  const balanceteId = $('balancete-id').value || `temp_${Date.now()}`;
  const idx = _balanceteLancamentos.findIndex(l => l.id === id);
  if (idx === -1) return;

  try {
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `balancetes/${balanceteId}/comprovantes/${id}_${cleanName}`;
    const ref = storageTenantRef().child(path);
    await ref.put(file, { contentType: file.type });
    _balanceteLancamentos[idx].comprovantePath = path;
    _balanceteLancamentos[idx].comprovanteNome = file.name;
    renderLancamentos();
    showAlert('balancete-alert', `Comprovante anexado: ${file.name}`, 'success');
  } catch (err) {
    console.error('Erro ao anexar:', err);
    showAlert('balancete-alert', 'Erro: ' + err.message);
  }
}

async function abrirLancComprovante(event, id) {
  event.preventDefault();
  event.stopPropagation();
  const l = _balanceteLancamentos.find(x => x.id === id);
  if (!l || !l.comprovantePath) return;
  try {
    const url = await storage.ref().child(l.comprovantePath).getDownloadURL();
    window.open(url, '_blank');
  } catch (err) {
    alert('Erro ao abrir: ' + err.message);
  }
}

async function copiarBalanceteMesAnterior() {
  const contratoId = $('balancete-contrato').value;
  if (!contratoId) { showAlert('balancete-alert', 'Selecione o contrato primeiro.'); return; }
  const mes = parseInt($('balancete-mes').value, 10);
  const ano = parseInt($('balancete-ano').value, 10);
  if (!mes || !ano) return;

  let mesAnt = mes - 1, anoAnt = ano;
  if (mesAnt === 0) { mesAnt = 12; anoAnt = ano - 1; }
  const anteriorId = balanceteId(anoAnt, mesAnt, contratoId);

  try {
    const snap = await tenantPath().collection('balancetes').doc(anteriorId).get();
    if (!snap.exists) {
      showAlert('balancete-alert', `Sem balancete em ${fmtMesAno(mesAnt, anoAnt)} para este contrato.`);
      return;
    }
    const b = snap.data();
    // Copia lançamentos (sem comprovantes — pertencem ao balancete anterior)
    _balanceteLancamentos = (b.lancamentos || []).map(l => ({
      ...l,
      id: cryptoRandomId(),
      comprovantePath: null,
      comprovanteNome: null,
    }));
    if (b.taxaAdm != null) $('balancete-taxa-adm').value = b.taxaAdm;
    renderLancamentos();
    recalcBalancete();
    showAlert('balancete-alert', `Lançamentos copiados de ${fmtMesAno(mesAnt, anoAnt)} (comprovantes não foram copiados).`, 'success');
  } catch (err) {
    console.error('Erro ao copiar mês anterior:', err);
    showAlert('balancete-alert', 'Erro: ' + err.message);
  }
}

async function saveBalancete() {
  clearAlert('balancete-alert');
  const contratoId = $('balancete-contrato').value;
  const mes = parseInt($('balancete-mes').value, 10);
  const ano = parseInt($('balancete-ano').value, 10);

  if (!contratoId) { showAlert('balancete-alert', 'Selecione o contrato.'); return; }
  if (!mes || !ano) { showAlert('balancete-alert', 'Informe mês e ano.'); return; }

  const id = $('balancete-id').value || balanceteId(ano, mes, contratoId);

  // Busca contrato pra snapshot de imovel/locador/locatário
  const cSnap = await tenantPath().collection('contratos').doc(contratoId).get();
  if (!cSnap.exists) { showAlert('balancete-alert', 'Contrato não encontrado.'); return; }
  const c = cSnap.data();

  // Calcula totais finais
  const sum = (b) => _balanceteLancamentos.filter(l => l.bloco === b)
    .reduce((acc, l) => acc + (parseFloat(l.valor) || 0), 0);
  const totalEntradas = sum('entrada');
  const totalDespLocador = sum('despesa_locador');
  const totalDespLocatario = sum('despesa_locatario');
  const aluguelBase = c.aluguel || 0;
  const taxaAdm = parseFloat($('balancete-taxa-adm').value) || 0;
  const taxaAdmValor = aluguelBase * taxaAdm / 100;
  const liquidoLocador = totalEntradas - totalDespLocador - taxaAdmValor;

  const data = {
    contratoId,
    imovelId: c.imovelId || null,
    locadorId: c.locadorId || null,
    locatarioId: c.locatarioId || null,
    mes, ano,
    status: $('balancete-status').value,
    aluguelBase,
    taxaAdm,
    taxaAdmValor,
    totalEntradas,
    totalDespesasLocador: totalDespLocador,
    totalDespesasLocatario: totalDespLocatario,
    liquidoLocador,
    lancamentos: _balanceteLancamentos.map(l => ({
      id: l.id, bloco: l.bloco, categoria: l.categoria,
      descricao: l.descricao || null, valor: parseFloat(l.valor) || 0,
      comprovantePath: l.comprovantePath || null,
      comprovanteNome: l.comprovanteNome || null,
    })),
    obs: $('balancete-obs').value.trim() || null,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  };

  const btn = $('btn-save-balancete');
  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const existing = await tenantPath().collection('balancetes').doc(id).get();
    if (!existing.exists) {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
    }
    await tenantPath().collection('balancetes').doc(id).set(data, { merge: true });
    $('balancete-id').value = id;

    closeBalanceteModal();
    loadBalancetes();
  } catch (err) {
    console.error('Erro ao salvar balancete:', err);
    showAlert('balancete-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar';
  }
}

// ----- Envio do balancete por e-mail -----

let _envioBalanceteContexto = null;

async function openEnvioBalancete() {
  const id = $('balancete-id').value;
  if (!id) { showAlert('balancete-alert', 'Salve o balancete antes de enviar.'); return; }
  clearAlert('envio-alert');

  try {
    // Carrega tudo necessário
    const bSnap = await tenantPath().collection('balancetes').doc(id).get();
    if (!bSnap.exists) { showAlert('balancete-alert', 'Balancete não encontrado.'); return; }
    const b = bSnap.data();

    const [contratoSnap, locadorSnap, locatarioSnap, imovelSnap, configSnap] = await Promise.all([
      b.contratoId  ? tenantPath().collection('contratos').doc(b.contratoId).get()  : Promise.resolve(null),
      b.locadorId   ? tenantPath().collection('locadores').doc(b.locadorId).get()   : Promise.resolve(null),
      b.locatarioId ? tenantPath().collection('locatarios').doc(b.locatarioId).get() : Promise.resolve(null),
      b.imovelId    ? tenantPath().collection('imoveis').doc(b.imovelId).get()    : Promise.resolve(null),
      tenantPath().collection('config').doc('site').get(),
    ]);

    const contrato  = (contratoSnap  && contratoSnap.exists)  ? contratoSnap.data()  : {};
    const locador   = (locadorSnap   && locadorSnap.exists)   ? locadorSnap.data()   : {};
    const locatario = (locatarioSnap && locatarioSnap.exists) ? locatarioSnap.data() : {};
    const imovel    = (imovelSnap    && imovelSnap.exists)    ? imovelSnap.data()    : {};
    const cfg = configSnap.exists ? configSnap.data() : {};

    if (!cfg.workerUrl) {
      showAlert('balancete-alert', 'Configure a URL do Worker em Configurações antes de enviar.');
      return;
    }
    if (!locador.email) {
      showAlert('balancete-alert', `O locador "${locador.nome || 'sem nome'}" não tem e-mail cadastrado.`);
      return;
    }

    _envioBalanceteContexto = { id, b, contrato, locador, locatario, imovel, cfg };

    // Preenche campos do modal
    const mesAno = fmtMesAno(b.mes, b.ano);
    $('envio-to').value = locador.email;
    $('envio-bcc').value = '';
    $('envio-subject').value = `Balancete ${mesAno} — ${imovel.apelido || 'Imóvel'} — ${State.tenant.nome}`;

    const dadosMsg = {
      tenant: { nome: State.tenant.nome },
      locador: { nome: locador.nome || '' },
      imovel: { apelido: imovel.apelido || '' },
      periodo: mesAno,
    };
    const mensagemPadrao = cfg.emailTemplate ||
      `Prezado(a) {{locador.nome}},\n\nSegue em anexo o balancete do mês {{periodo}} referente ao imóvel "{{imovel.apelido}}".\n\nQualquer dúvida ficamos à disposição.\n\nAtenciosamente,\n{{tenant.nome}}`;
    $('envio-mensagem').value = mergeTemplate(mensagemPadrao, dadosMsg);

    // Preview HTML
    const cabecalho = mergeTemplate(cfg.balanceteCabecalho || '', { tenant: State.tenant });
    const rodape = mergeTemplate(cfg.balanceteRodape || '', { tenant: State.tenant });
    const htmlBalancete = buildBalanceteHtml(b, contrato, locador, locatario, imovel, cabecalho, rodape);
    $('envio-preview').innerHTML = htmlBalancete;

    $('modal-envio-balancete').style.display = 'flex';
  } catch (err) {
    console.error('Erro ao preparar envio:', err);
    showAlert('balancete-alert', 'Erro: ' + err.message);
  }
}

function closeEnvioBalancete() {
  $('modal-envio-balancete').style.display = 'none';
}

// HTML otimizado pra e-mail (estilos inline pra Gmail/Outlook)
function buildBalanceteEmailHtml(b, contrato, locador, locatario, imovel, cabecalho, mensagem) {
  const tenant = State.tenant || {};
  const mesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const periodoTxt = `${mesNomes[b.mes - 1]} de ${b.ano}`;

  const rowsBloco = (bloco) => {
    const linhas = (b.lancamentos || []).filter(l => l.bloco === bloco);
    if (linhas.length === 0) return `<tr><td colspan="3" style="text-align:center;color:#888;padding:8px;">—</td></tr>`;
    return linhas.map(l => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;font-size:13px;">${escapeHtml(LANC_CATEGORIA_LABEL[l.categoria] || l.categoria || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;font-size:13px;">${escapeHtml(l.descricao || '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;font-size:13px;text-align:right;white-space:nowrap;">${fmtBRL(l.valor)}</td>
      </tr>
    `).join('');
  };

  const mensagemHtml = textToHtml(mensagem || '');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Balancete</title></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f4;color:#111;">
  <div style="max-width:680px;margin:0 auto;background:white;padding:30px;">

    <div style="text-align:center;border-bottom:2px solid #475569;padding-bottom:14px;margin-bottom:20px;">
      <h1 style="margin:0;color:#334155;font-size:20px;">BALANCETE DE LOCAÇÃO</h1>
      <p style="margin:4px 0 0;color:#666;font-size:14px;">${escapeHtml(periodoTxt)}</p>
      <p style="margin:8px 0 0;font-weight:bold;color:#475569;">${escapeHtml(tenant.nome || 'DRG-Rently')}</p>
    </div>

    <div style="margin-bottom:20px;font-size:14px;color:#333;">
      ${mensagemHtml}
    </div>

    ${cabecalho ? `<div style="margin-bottom:18px;font-size:13px;color:#444;padding:12px;background:#f8fafc;border-left:3px solid #475569;">${textToHtml(cabecalho)}</div>` : ''}

    <table style="width:100%;border-collapse:collapse;margin-bottom:6px;font-size:13px;">
      <tr><td style="padding:3px 0;color:#666;width:120px;">Locador:</td><td style="padding:3px 0;">${escapeHtml(locador.nome || '—')}</td></tr>
      <tr><td style="padding:3px 0;color:#666;">Locatário:</td><td style="padding:3px 0;">${escapeHtml(locatario.nome || '—')}</td></tr>
      <tr><td style="padding:3px 0;color:#666;">Imóvel:</td><td style="padding:3px 0;">${escapeHtml(imovel.apelido || '—')}</td></tr>
      <tr><td style="padding:3px 0;color:#666;">Endereço:</td><td style="padding:3px 0;">${escapeHtml(formatEnderecoCompleto(imovel.endereco))}</td></tr>
    </table>

    <h3 style="margin:24px 0 8px;color:#15803d;font-size:14px;">⬆ ENTRADAS</h3>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f0f0f0;">
        <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;">Categoria</th>
        <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;">Descrição</th>
        <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;">Valor</th>
      </tr></thead>
      <tbody>
        ${rowsBloco('entrada')}
        <tr style="background:#f9f9f9;font-weight:bold;border-top:2px solid #000;">
          <td colspan="2" style="padding:8px;">Total entradas</td>
          <td style="padding:8px;text-align:right;">${fmtBRL(b.totalEntradas)}</td>
        </tr>
      </tbody>
    </table>

    <h3 style="margin:24px 0 8px;color:#b91c1c;font-size:14px;">⬇ DESPESAS DO LOCADOR</h3>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f0f0f0;">
        <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;">Categoria</th>
        <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;">Descrição</th>
        <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;">Valor</th>
      </tr></thead>
      <tbody>
        ${rowsBloco('despesa_locador')}
        <tr style="background:#f9f9f9;font-weight:bold;border-top:2px solid #000;">
          <td colspan="2" style="padding:8px;">Total despesas do locador</td>
          <td style="padding:8px;text-align:right;">${fmtBRL(b.totalDespesasLocador)}</td>
        </tr>
      </tbody>
    </table>

    <div style="border:2px solid #000;padding:14px 18px;margin:24px 0;background:#fafafa;">
      <table style="width:100%;font-size:13px;">
        <tr><td style="padding:4px 0;">Total de entradas</td><td style="text-align:right;font-weight:bold;">${fmtBRL(b.totalEntradas)}</td></tr>
        <tr><td style="padding:4px 0;">(−) Despesas do locador</td><td style="text-align:right;font-weight:bold;">${fmtBRL(b.totalDespesasLocador)}</td></tr>
        <tr><td style="padding:4px 0;">(−) Taxa de administração (${b.taxaAdm}% sobre ${fmtBRL(b.aluguelBase)})</td><td style="text-align:right;font-weight:bold;">${fmtBRL(b.taxaAdmValor)}</td></tr>
        <tr style="border-top:2px solid #000;"><td style="padding:10px 0;font-size:15px;font-weight:bold;">LÍQUIDO A REPASSAR AO LOCADOR</td><td style="text-align:right;padding:10px 0;font-size:18px;font-weight:bold;color:#15803d;">${fmtBRL(b.liquidoLocador)}</td></tr>
      </table>
    </div>

    ${b.obs ? `<div style="margin-bottom:20px;font-size:13px;"><strong>Observações:</strong><br>${textToHtml(b.obs)}</div>` : ''}

    <p style="margin-top:30px;font-size:11px;color:#888;text-align:center;border-top:1px solid #ddd;padding-top:14px;">
      Enviado por ${escapeHtml(tenant.nome || 'DRG-Rently')} via DRG-Rently<br>
      ${tenant.cnpj ? 'CNPJ ' + escapeHtml(maskCNPJ(tenant.cnpj)) : ''}${tenant.creci ? ' · CRECI ' + escapeHtml(tenant.creci) : ''}
    </p>
  </div>
</body></html>`;
}

async function sendBalanceteEmail() {
  if (!_envioBalanceteContexto) return;
  const { id, b, contrato, locador, locatario, imovel, cfg } = _envioBalanceteContexto;

  const to = $('envio-to').value.trim();
  const bcc = $('envio-bcc').value.trim();
  const subject = $('envio-subject').value.trim();
  const mensagem = $('envio-mensagem').value;

  if (!to) { showAlert('envio-alert', 'Destinatário é obrigatório.'); return; }
  if (!subject) { showAlert('envio-alert', 'Assunto é obrigatório.'); return; }

  const cabecalho = mergeTemplate(cfg.balanceteCabecalho || '', { tenant: State.tenant });
  const html = buildBalanceteEmailHtml(b, contrato, locador, locatario, imovel, cabecalho, mensagem);

  const btn = $('btn-confirmar-envio');
  btn.disabled = true; btn.textContent = 'Enviando…';

  try {
    const res = await fetch(cfg.workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: cfg.emailFrom || 'onboarding@resend.dev',
        fromName: State.tenant.nome || 'DRG-Rently',
        to,
        bcc: bcc || undefined,
        replyTo: cfg.emailFrom !== 'onboarding@resend.dev' ? cfg.emailFrom : undefined,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      let errMsg = `Erro ${res.status}`;
      try { const j = await res.json(); if (j.error) errMsg = j.error; } catch (_) {}
      throw new Error(errMsg);
    }

    // Marca balancete como enviado
    await tenantPath().collection('balancetes').doc(id).update({
      status: 'enviado',
      emailEnviadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      emailEnviadoPara: to,
      emailEnviadoBcc: bcc || null,
    });

    closeEnvioBalancete();
    showAlert('balancete-alert', `✓ E-mail enviado para ${to}!`, 'success');
    $('balancete-status').value = 'enviado';
    aplicarStatusBalancete();
    loadBalancetes();
  } catch (err) {
    console.error('Erro ao enviar e-mail:', err);
    showAlert('envio-alert', 'Falha ao enviar: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '✉️ Enviar agora';
  }
}

async function gerarBalancete() {
  const id = $('balancete-id').value;
  if (!id) { showAlert('balancete-alert', 'Salve o balancete antes de gerar.'); return; }

  try {
    const bSnap = await tenantPath().collection('balancetes').doc(id).get();
    if (!bSnap.exists) { showAlert('balancete-alert', 'Balancete não encontrado.'); return; }
    const b = bSnap.data();

    const [contratoSnap, locadorSnap, locatarioSnap, imovelSnap, configSnap] = await Promise.all([
      b.contratoId  ? tenantPath().collection('contratos').doc(b.contratoId).get()  : Promise.resolve(null),
      b.locadorId   ? tenantPath().collection('locadores').doc(b.locadorId).get()   : Promise.resolve(null),
      b.locatarioId ? tenantPath().collection('locatarios').doc(b.locatarioId).get() : Promise.resolve(null),
      b.imovelId    ? tenantPath().collection('imoveis').doc(b.imovelId).get()    : Promise.resolve(null),
      tenantPath().collection('config').doc('site').get(),
    ]);

    const contrato  = (contratoSnap  && contratoSnap.exists)  ? contratoSnap.data()  : {};
    const locador   = (locadorSnap   && locadorSnap.exists)   ? locadorSnap.data()   : {};
    const locatario = (locatarioSnap && locatarioSnap.exists) ? locatarioSnap.data() : {};
    const imovel    = (imovelSnap    && imovelSnap.exists)    ? imovelSnap.data()    : {};
    const cfg = configSnap.exists ? configSnap.data() : {};

    const dadosCab = {
      tenant: { nome: State.tenant.nome, cnpj: State.tenant.cnpj ? maskCNPJ(State.tenant.cnpj) : '—', creci: State.tenant.creci || '—' },
    };
    const cabecalho = mergeTemplate(cfg.balanceteCabecalho || '', dadosCab);
    const rodape = mergeTemplate(cfg.balanceteRodape || '', dadosCab);

    const html = buildBalanceteHtml(b, contrato, locador, locatario, imovel, cabecalho, rodape);

    _contratoHtmlCache = html;
    $('contrato-preview-content').innerHTML = html;
    $('modal-contrato-preview-title').textContent = `Balancete · ${fmtMesAno(b.mes, b.ano)}`;
    $('modal-contrato-preview').style.display = 'flex';
  } catch (err) {
    console.error('Erro ao gerar balancete:', err);
    showAlert('balancete-alert', 'Erro: ' + err.message);
  }
}

function buildBalanceteHtml(b, contrato, locador, locatario, imovel, cabecalho, rodape) {
  const tenant = State.tenant || {};
  const mesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const periodoTxt = `${mesNomes[b.mes - 1]} de ${b.ano}`;

  // Linhas por bloco
  const rowsBloco = (bloco, mostrarComprovante = true) => {
    const linhas = (b.lancamentos || []).filter(l => l.bloco === bloco);
    if (linhas.length === 0) return '<tr><td colspan="' + (mostrarComprovante ? 4 : 3) + '" style="text-align:center; color:#888;">— sem lançamentos —</td></tr>';
    return linhas.map(l => `
      <tr>
        <td>${escapeHtml(LANC_CATEGORIA_LABEL[l.categoria] || l.categoria || '—')}</td>
        <td>${escapeHtml(l.descricao || '—')}</td>
        <td class="valor">${fmtBRL(l.valor)}</td>
        ${mostrarComprovante ? `<td>${l.comprovanteNome ? '📎' : ''}</td>` : ''}
      </tr>
    `).join('');
  };

  const totalRow = (label, valor, cols) => `
    <tr class="total-row">
      <td colspan="${cols - 1}">${label}</td>
      <td class="valor">${fmtBRL(valor)}</td>
    </tr>
  `;

  // Lista de anexos
  const anexos = (b.lancamentos || []).filter(l => l.comprovanteNome);

  return `
    <div class="contrato-header">
      <h1>BALANCETE DE LOCAÇÃO — ${escapeHtml(periodoTxt)}</h1>
      <p class="contrato-empresa">${escapeHtml(tenant.nome || 'DRG-Rently')}</p>
      ${tenant.cnpj ? `<p class="contrato-empresa-sub">CNPJ ${escapeHtml(maskCNPJ(tenant.cnpj))}${tenant.creci ? ' · CRECI ' + escapeHtml(tenant.creci) : ''}</p>` : ''}
    </div>

    ${cabecalho ? `<div class="contrato-conteudo">${textToHtml(cabecalho)}</div>` : ''}

    <div class="balancete-info-grid">
      <span class="lbl">Locador:</span>      <span>${escapeHtml(locador.nome || '—')} — ${locador.documento ? escapeHtml(locador.tipo === 'PJ' ? maskCNPJ(locador.documento) : maskCPF(locador.documento)) : '—'}</span>
      <span class="lbl">Locatário:</span>    <span>${escapeHtml(locatario.nome || '—')} — ${locatario.documento ? escapeHtml(locatario.tipo === 'PJ' ? maskCNPJ(locatario.documento) : maskCPF(locatario.documento)) : '—'}</span>
      <span class="lbl">Imóvel:</span>       <span>${escapeHtml(imovel.apelido || '—')}</span>
      <span class="lbl">Endereço:</span>     <span>${escapeHtml(formatEnderecoCompleto(imovel.endereco))}</span>
      <span class="lbl">Contrato:</span>     <span>${contrato.prazoMeses ? contrato.prazoMeses + ' meses' : '—'} · Início ${contrato.inicio ? fmtDataBR(contrato.inicio) : '—'} · Vencimento dia ${contrato.diaVencimento ?? '—'}</span>
    </div>

    <table class="balancete-table">
      <caption>⬆ Entradas (recebidas pela imobiliária)</caption>
      <thead><tr><th>Categoria</th><th>Descrição</th><th class="valor">Valor</th><th>Comp.</th></tr></thead>
      <tbody>
        ${rowsBloco('entrada')}
        ${totalRow('Total entradas', b.totalEntradas || 0, 4)}
      </tbody>
    </table>

    <table class="balancete-table">
      <caption>⬇ Despesas do locador (descontadas do repasse)</caption>
      <thead><tr><th>Categoria</th><th>Descrição</th><th class="valor">Valor</th><th>Comp.</th></tr></thead>
      <tbody>
        ${rowsBloco('despesa_locador')}
        ${totalRow('Total despesas do locador', b.totalDespesasLocador || 0, 4)}
      </tbody>
    </table>

    ${(b.lancamentos || []).filter(l => l.bloco === 'despesa_locatario').length > 0 ? `
    <table class="balancete-table">
      <caption>⬇ Despesas do locatário (pagas pela imobiliária — informativo)</caption>
      <thead><tr><th>Categoria</th><th>Descrição</th><th class="valor">Valor</th><th>Comp.</th></tr></thead>
      <tbody>
        ${rowsBloco('despesa_locatario')}
        ${totalRow('Total despesas do locatário', b.totalDespesasLocatario || 0, 4)}
      </tbody>
    </table>
    ` : ''}

    <div class="balancete-resumo-print">
      <div class="linha"><span>Total de entradas</span><strong>${fmtBRL(b.totalEntradas)}</strong></div>
      <div class="linha"><span>(−) Despesas do locador</span><strong>${fmtBRL(b.totalDespesasLocador)}</strong></div>
      <div class="linha"><span>(−) Taxa de administração (${b.taxaAdm}% sobre ${fmtBRL(b.aluguelBase)})</span><strong>${fmtBRL(b.taxaAdmValor)}</strong></div>
      <div class="linha final"><span>LÍQUIDO A REPASSAR AO LOCADOR</span><strong>${fmtBRL(b.liquidoLocador)}</strong></div>
    </div>

    ${b.obs ? `<div class="contrato-conteudo"><h3>Observações</h3>${textToHtml(b.obs)}</div>` : ''}

    ${anexos.length > 0 ? `
      <div class="balancete-anexos">
        <strong>Comprovantes anexados:</strong>
        <ul>${anexos.map(a => `<li>${escapeHtml(LANC_CATEGORIA_LABEL[a.categoria] || a.categoria)} — ${escapeHtml(a.descricao || '—')} — ${escapeHtml(a.comprovanteNome)}</li>`).join('')}</ul>
      </div>
    ` : ''}

    ${rodape ? `<div class="contrato-conteudo" style="margin-top:30px;">${textToHtml(rodape)}</div>` : ''}

    <div class="contrato-rodape">
      <p style="margin-top:30px;">${escapeHtml(imovel.endereco?.cidade || '—')}, ${fmtDataExtenso()}.</p>
      <div class="contrato-assinaturas">
        <div class="assinatura">
          <div class="assinatura-linha"></div>
          <strong>${escapeHtml(tenant.nome || 'DRG-Rently')}</strong><br>
          <span>Imobiliária</span>
        </div>
        <div class="assinatura">
          <div class="assinatura-linha"></div>
          <strong>${escapeHtml(locador.nome || '—')}</strong><br>
          <span>Locador (ciência)</span>
        </div>
      </div>
    </div>
  `;
}

async function deleteBalancete() {
  const id = $('balancete-id').value;
  if (!id) return;
  if (!confirm('Excluir este balancete? Os comprovantes anexados também serão removidos.')) return;
  try {
    // Apaga comprovantes do storage
    const folderRef = storageTenantRef().child(`balancetes/${id}/comprovantes`);
    try {
      const list = await folderRef.listAll();
      await Promise.all(list.items.map(item => item.delete()));
    } catch (_) {}
    await tenantPath().collection('balancetes').doc(id).delete();
    closeBalanceteModal();
    loadBalancetes();
  } catch (err) {
    showAlert('balancete-alert', 'Erro: ' + err.message);
  }
}

// =============================================================
// COMPRADORES — CRUD + análise + documentos
// =============================================================

const COMPRADOR_STATUS_LABEL = {
  pendente_analise: 'Pendente',
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
};

const FORMA_PAGAMENTO_LABEL = {
  a_vista: 'À vista',
  financiado: 'Financiado',
  fgts: 'FGTS',
  consorcio: 'Consórcio',
  permuta: 'Permuta',
  parcelado: 'Parcelado direto',
};

let _compradoresCache = null;
async function ensureCompradoresCache() {
  if (_compradoresCache) return _compradoresCache;
  const snap = await tenantPath().collection('compradores').orderBy('nome').get();
  _compradoresCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return _compradoresCache;
}
function invalidateCompradoresCache() { _compradoresCache = null; }

async function loadCompradores() {
  const tbody = $('tbody-compradores');
  tbody.innerHTML = `<tr><td colspan="7" class="empty">Carregando…</td></tr>`;

  try {
    const snap = await tenantPath().collection('compradores').orderBy('nome').get();
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">Nenhum comprador cadastrado.</td></tr>`;
      return;
    }
    const rows = snap.docs.map((doc, i) => {
      const c = doc.data();
      const docFmt = c.documento ? (c.tipo === 'PJ' ? maskCNPJ(c.documento) : maskCPF(c.documento)) : '—';
      const telFmt = c.telefone ? maskTelefone(c.telefone) : '—';
      const status = c.status || 'pendente_analise';
      const forma = FORMA_PAGAMENTO_LABEL[c.formaPagamento] || '—';
      return `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${c.nome || '—'}</strong>${c.tipo === 'PJ' ? ' <span class="muted" style="font-size:11px;">(PJ)</span>' : ''}</td>
          <td>${docFmt}</td>
          <td>${telFmt}</td>
          <td>${forma}</td>
          <td><span class="badge-status ${status}">${COMPRADOR_STATUS_LABEL[status] || status}</span></td>
          <td><div class="action-btns"><button class="btn btn-sm btn-secondary" onclick="openCompradorModal('${doc.id}')">Editar</button></div></td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join('');
  } catch (err) {
    console.error('Erro ao carregar compradores:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

async function buscarCEPComprador() {
  const input = $('comprador-cep');
  const status = $('comprador-cep-status');
  const cepRaw = (input.value || '').replace(/\D/g, '');
  if (cepRaw.length === 0) return;
  if (cepRaw.length !== 8) { showAlert('comprador-alert', 'CEP deve ter 8 dígitos.'); return; }

  input.value = cepRaw.replace(/(\d{5})(\d{3})/, '$1-$2');
  status.style.display = 'block';
  status.textContent = 'Buscando…';
  status.style.color = 'var(--primary)';
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepRaw}/json/`);
    const data = await res.json();
    if (data.erro) { status.textContent = 'CEP não encontrado'; status.style.color = 'var(--danger)'; return; }
    if (data.logradouro) $('comprador-logradouro').value = data.logradouro;
    if (data.bairro)     $('comprador-bairro').value     = data.bairro;
    if (data.localidade) $('comprador-cidade').value     = data.localidade;
    if (data.uf)         $('comprador-uf').value         = data.uf;
    status.textContent = '✓';
    status.style.color = 'var(--success)';
    $('comprador-numero').focus();
  } catch (err) {
    status.textContent = 'Erro de conexão';
    status.style.color = 'var(--danger)';
  }
}

function onCompradorTipoChange() {
  const tipo = $('comprador-tipo').value;
  const isPJ = tipo === 'PJ';
  $('comprador-nome-label').textContent = isPJ ? 'Razão social' : 'Nome completo';
  $('comprador-doc-label').textContent = isPJ ? 'CNPJ' : 'CPF';
  $('comprador-documento').placeholder = isPJ ? '00.000.000/0000-00' : '000.000.000-00';
  $('comprador-rg-group').style.display = isPJ ? 'none' : 'block';
  $('comprador-nascimento-group').style.display = isPJ ? 'none' : 'block';
  $('comprador-pf-extra').style.display = isPJ ? 'none' : 'grid';
  const docInput = $('comprador-documento');
  docInput.value = isPJ ? maskCNPJ(docInput.value) : maskCPF(docInput.value);
  onCompradorDocumentoInput();
}

function onCompradorDocumentoInput() {
  const tipo = $('comprador-tipo').value;
  const digits = $('comprador-documento').value.replace(/\D/g, '');
  const status = $('comprador-doc-status');
  if (digits.length === 0) { status.style.display = 'none'; return; }
  status.style.display = 'block';
  const isPJ = tipo === 'PJ';
  const max = isPJ ? 14 : 11;
  const valido = isPJ ? isCNPJValid(digits) : isCPFValid(digits);
  if (digits.length < max) {
    status.textContent = `${digits.length}/${max} dígitos`;
    status.style.color = 'var(--text-muted)';
  } else if (valido) {
    status.textContent = `✓ ${isPJ ? 'CNPJ' : 'CPF'} válido`;
    status.style.color = 'var(--success)';
  } else {
    status.textContent = `✗ ${isPJ ? 'CNPJ' : 'CPF'} inválido`;
    status.style.color = 'var(--danger)';
  }
}

async function onCompradorDocumentoBlur() {
  if ($('comprador-tipo').value !== 'PJ') return;
  const digits = $('comprador-documento').value.replace(/\D/g, '');
  if (digits.length !== 14 || !isCNPJValid(digits)) return;
  const nomeAtual = $('comprador-nome').value.trim();
  if (nomeAtual && !confirm('Buscar dados na Receita Federal pode sobrescrever a razão social e o endereço. Deseja prosseguir?')) return;
  const status = $('comprador-doc-status');
  status.style.display = 'block';
  status.textContent = 'Buscando na Receita…';
  status.style.color = 'var(--primary)';
  try {
    const data = await fetchCNPJ(digits);
    $('comprador-nome').value = data.razao_social || nomeAtual;
    if (data.logradouro)  $('comprador-logradouro').value  = data.logradouro;
    if (data.numero)      $('comprador-numero').value      = data.numero;
    if (data.complemento) $('comprador-complemento').value = data.complemento;
    if (data.bairro)      $('comprador-bairro').value      = data.bairro;
    if (data.municipio)   $('comprador-cidade').value      = data.municipio;
    if (data.uf)          $('comprador-uf').value          = data.uf;
    if (data.cep)         $('comprador-cep').value         = maskCEP(String(data.cep));
    if (data.email && !$('comprador-email').value)         $('comprador-email').value    = data.email;
    if (data.ddd_telefone_1 && !$('comprador-telefone').value) {
      $('comprador-telefone').value = maskTelefone(String(data.ddd_telefone_1));
    }
    const situacao = (data.descricao_situacao_cadastral || '').toUpperCase();
    if (situacao === 'ATIVA') {
      status.textContent = '✓ CNPJ ativo na Receita';
      status.style.color = 'var(--success)';
    } else if (situacao) {
      status.textContent = `⚠ Situação: ${situacao}`;
      status.style.color = 'var(--warning)';
    }
  } catch (err) {
    status.textContent = 'Erro: ' + err.message;
    status.style.color = 'var(--danger)';
  }
}

function onCompradorFormaChange() {
  const forma = $('comprador-forma-pagamento').value;
  $('comprador-financiado-extra').style.display = (forma === 'financiado' || forma === 'consorcio') ? 'grid' : 'none';
}

async function openCompradorModal(id) {
  clearAlert('comprador-alert');
  $('comprador-id').value = id || '';
  $('modal-comprador-title').textContent = id ? 'Editar Comprador' : 'Novo Comprador';
  $('btn-delete-comprador').style.display = id ? 'inline-block' : 'none';

  ['comprador-nome', 'comprador-documento', 'comprador-rg', 'comprador-nascimento',
   'comprador-profissao', 'comprador-email', 'comprador-telefone',
   'comprador-cep', 'comprador-logradouro', 'comprador-numero', 'comprador-complemento',
   'comprador-bairro', 'comprador-cidade', 'comprador-uf',
   'comprador-renda', 'comprador-banco-fin', 'comprador-valor-entrada',
   'comprador-obs', 'comprador-motivo-status'].forEach(f => $(f).value = '');
  $('comprador-tipo').value = 'PF';
  $('comprador-estado-civil').value = '';
  $('comprador-nacionalidade').value = 'Brasileira';
  $('comprador-forma-pagamento').value = 'a_vista';
  $('comprador-status').value = 'pendente_analise';
  $('comprador-cep-status').style.display = 'none';
  $('comprador-doc-status').style.display = 'none';
  onCompradorTipoChange();
  onCompradorFormaChange();

  if (id) {
    try {
      const snap = await tenantPath().collection('compradores').doc(id).get();
      if (snap.exists) {
        const c = snap.data();
        $('comprador-status').value = c.status || 'pendente_analise';
        $('comprador-motivo-status').value = c.motivoStatus || '';
        $('comprador-tipo').value = c.tipo || 'PF';
        $('comprador-nome').value = c.nome || '';
        $('comprador-documento').value = c.documento ? (c.tipo === 'PJ' ? maskCNPJ(c.documento) : maskCPF(c.documento)) : '';
        $('comprador-rg').value = c.rg || '';
        $('comprador-nascimento').value = c.nascimento || '';
        $('comprador-estado-civil').value = c.estadoCivil || '';
        $('comprador-profissao').value = c.profissao || '';
        $('comprador-nacionalidade').value = c.nacionalidade || 'Brasileira';
        $('comprador-email').value = c.email || '';
        $('comprador-telefone').value = c.telefone ? maskTelefone(c.telefone) : '';
        onCompradorTipoChange();
        const end = c.endereco || {};
        $('comprador-cep').value = end.cep ? maskCEP(end.cep) : '';
        $('comprador-logradouro').value = end.logradouro || '';
        $('comprador-numero').value = end.numero || '';
        $('comprador-complemento').value = end.complemento || '';
        $('comprador-bairro').value = end.bairro || '';
        $('comprador-cidade').value = end.cidade || '';
        $('comprador-uf').value = end.uf || '';
        $('comprador-forma-pagamento').value = c.formaPagamento || 'a_vista';
        $('comprador-renda').value = c.renda ?? '';
        $('comprador-banco-fin').value = c.bancoFinanceira || '';
        $('comprador-valor-entrada').value = c.valorEntrada ?? '';
        $('comprador-obs').value = c.obs || '';
        onCompradorFormaChange();
      }
    } catch (err) {
      console.error('Erro ao carregar comprador:', err);
      showAlert('comprador-alert', 'Erro ao carregar: ' + err.message);
    }
    $('comprador-docs-section').style.display = 'block';
    loadCompradorDocs(id);
  } else {
    $('comprador-docs-section').style.display = 'none';
  }
  $('modal-comprador').style.display = 'flex';
}

function closeCompradorModal() {
  $('modal-comprador').style.display = 'none';
}

async function saveComprador() {
  clearAlert('comprador-alert');
  const id = $('comprador-id').value;
  const nome = $('comprador-nome').value.trim();
  const documento = $('comprador-documento').value.trim();
  if (!nome) { showAlert('comprador-alert', 'Nome / Razão social é obrigatório.'); return; }
  if (!documento) { showAlert('comprador-alert', 'CPF / CNPJ é obrigatório.'); return; }

  const data = {
    status: $('comprador-status').value,
    motivoStatus: $('comprador-motivo-status').value.trim() || null,
    tipo: $('comprador-tipo').value,
    nome,
    documento: documento.replace(/\D/g, ''),
    rg: $('comprador-rg').value.trim() || null,
    nascimento: $('comprador-nascimento').value || null,
    estadoCivil: $('comprador-estado-civil').value || null,
    profissao: $('comprador-profissao').value.trim() || null,
    nacionalidade: $('comprador-nacionalidade').value.trim() || null,
    email: $('comprador-email').value.trim() || null,
    telefone: $('comprador-telefone').value.replace(/\D/g, '') || null,
    endereco: {
      cep: $('comprador-cep').value.replace(/\D/g, '') || null,
      logradouro: $('comprador-logradouro').value.trim() || null,
      numero: $('comprador-numero').value.trim() || null,
      complemento: $('comprador-complemento').value.trim() || null,
      bairro: $('comprador-bairro').value.trim() || null,
      cidade: $('comprador-cidade').value.trim() || null,
      uf: $('comprador-uf').value.trim().toUpperCase() || null,
    },
    formaPagamento: $('comprador-forma-pagamento').value,
    renda: parseFloat($('comprador-renda').value) || null,
    bancoFinanceira: $('comprador-banco-fin').value.trim() || null,
    valorEntrada: parseFloat($('comprador-valor-entrada').value) || null,
    obs: $('comprador-obs').value.trim() || null,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  };

  const btn = $('btn-save-comprador');
  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    if (id) {
      await tenantPath().collection('compradores').doc(id).update(data);
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('compradores').add(data);
      btn.disabled = false; btn.textContent = 'Salvar';
      invalidateCompradoresCache();
      await openCompradorModal(docRef.id);
      showAlert('comprador-alert', 'Comprador criado. Agora você pode anexar documentos.', 'success');
      loadCompradores();
      return;
    }
    invalidateCompradoresCache();
    closeCompradorModal();
    loadCompradores();
  } catch (err) {
    console.error('Erro ao salvar comprador:', err);
    showAlert('comprador-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar';
  }
}

async function deleteComprador() {
  const id = $('comprador-id').value;
  if (!id) return;
  if (!confirm('Excluir este comprador? Os documentos anexados também serão removidos.')) return;
  try {
    const folderRef = storageTenantRef().child(`compradores/${id}`);
    try {
      const list = await folderRef.listAll();
      await Promise.all(list.items.map(item => item.delete()));
    } catch (_) {}
    await tenantPath().collection('compradores').doc(id).delete();
    invalidateCompradoresCache();
    closeCompradorModal();
    loadCompradores();
  } catch (err) {
    console.error('Erro ao excluir:', err);
    showAlert('comprador-alert', 'Erro: ' + err.message);
  }
}

async function loadCompradorDocs(id) {
  const container = $('comprador-docs-list');
  container.innerHTML = `<p class="empty">Carregando documentos…</p>`;
  try {
    const folderRef = storageTenantRef().child(`compradores/${id}`);
    const list = await folderRef.listAll();
    if (list.items.length === 0) {
      container.innerHTML = `<p class="empty">Nenhum documento anexado.</p>`;
      return;
    }
    const items = await Promise.all(list.items.map(async (item) => {
      const meta = await item.getMetadata();
      const url = await item.getDownloadURL();
      const ext = (item.name.split('.').pop() || '').toLowerCase();
      const icon = (ext === 'pdf') ? '📄' : (['jpg','jpeg','png'].includes(ext) ? '🖼' : '📎');
      const sizeKb = (meta.size / 1024).toFixed(0);
      const date = new Date(meta.timeCreated).toLocaleDateString('pt-BR');
      return `
        <div class="doc-item">
          <span class="doc-icon">${icon}</span>
          <span class="doc-name">${item.name}</span>
          <span class="doc-meta">${sizeKb} KB · ${date}</span>
          <div class="doc-actions">
            <a class="btn-icon" href="${url}" target="_blank" title="Abrir">👁</a>
            <a class="btn-icon" href="${url}" download="${item.name}" title="Baixar">⬇</a>
            <button class="btn-icon btn-icon-danger" onclick="deleteCompradorDoc('${id}','${item.name}')" title="Excluir">🗑</button>
          </div>
        </div>
      `;
    }));
    container.innerHTML = items.join('');
  } catch (err) {
    container.innerHTML = `<p class="empty" style="color:var(--danger);">Erro: ${err.message}</p>`;
  }
}

async function uploadCompradorDocs() {
  const id = $('comprador-id').value;
  if (!id) { showAlert('comprador-alert', 'Salve o comprador antes de anexar documentos.'); return; }
  const input = $('comprador-doc-input');
  const files = Array.from(input.files || []);
  if (files.length === 0) { showAlert('comprador-alert', 'Selecione ao menos um arquivo.'); return; }
  const tooBig = files.find(f => f.size > 10 * 1024 * 1024);
  if (tooBig) { showAlert('comprador-alert', `Arquivo "${tooBig.name}" excede 10MB.`); return; }
  const folderRef = storageTenantRef().child(`compradores/${id}`);
  try {
    for (const file of files) {
      await folderRef.child(file.name).put(file, {
        contentType: file.type,
        customMetadata: { uploadedBy: State.user.uid },
      });
    }
    input.value = '';
    showAlert('comprador-alert', `${files.length} arquivo(s) enviado(s).`, 'success');
    loadCompradorDocs(id);
  } catch (err) {
    showAlert('comprador-alert', 'Erro: ' + err.message);
  }
}

async function deleteCompradorDoc(id, filename) {
  if (!confirm(`Excluir o arquivo "${filename}"?`)) return;
  try {
    await storageTenantRef().child(`compradores/${id}/${filename}`).delete();
    loadCompradorDocs(id);
  } catch (err) {
    showAlert('comprador-alert', 'Erro: ' + err.message);
  }
}

// =============================================================
// NEGOCIAÇÕES — propostas e contratos de compra/venda
// =============================================================

const NEGOCIACAO_STATUS_LABEL = {
  rascunho: 'Rascunho',
  em_negociacao: 'Em negociação',
  aceita: 'Aceita',
  fechada: 'Fechada',
  recusada: 'Recusada',
};

async function loadNegociacoes() {
  const tbody = $('tbody-negociacoes');
  tbody.innerHTML = `<tr><td colspan="6" class="empty">Carregando…</td></tr>`;
  try {
    const [snap, imoveis, compradores] = await Promise.all([
      tenantPath().collection('negociacoes').orderBy('criadoEm', 'desc').get(),
      ensureImoveisCache(),
      ensureCompradoresCache(),
    ]);
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhuma negociação cadastrada.</td></tr>`;
      return;
    }
    const imMap = Object.fromEntries(imoveis.map(i => [i.id, i.apelido]));
    const compMap = Object.fromEntries(compradores.map(c => [c.id, c.nome]));
    const rows = snap.docs.map((doc, i) => {
      const n = doc.data();
      const status = n.status || 'rascunho';
      return `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${imMap[n.imovelId] || '⚠ imóvel apagado'}</strong></td>
          <td>${compMap[n.compradorId] || '⚠ comprador apagado'}</td>
          <td>${fmtBRL(n.valor)}</td>
          <td><span class="badge-status ${status}">${NEGOCIACAO_STATUS_LABEL[status] || status}</span></td>
          <td><div class="action-btns"><button class="btn btn-sm btn-secondary" onclick="openNegociacaoModal('${doc.id}')">Editar</button></div></td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join('');
  } catch (err) {
    console.error('Erro ao carregar negociações:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

async function populateNegociacaoSelects(selected) {
  const [locadores, compradores, imoveis] = await Promise.all([
    ensureLocadoresCache(),
    ensureCompradoresCache(),
    ensureImoveisCache(),
  ]);

  // Imóveis: apenas com finalidade venda ou ambos
  const imoveisVenda = imoveis.filter(i => i.finalidade === 'venda' || i.finalidade === 'ambos');
  $('negociacao-imovel').innerHTML = ['<option value="">— Selecione —</option>']
    .concat(imoveisVenda.map(i => `<option value="${i.id}"${i.id === selected?.imovelId ? ' selected' : ''}>${i.apelido} · ${fmtBRL(i.valorVenda)}</option>`))
    .join('');

  $('negociacao-vendedor').innerHTML = ['<option value="">— Selecione —</option>']
    .concat(locadores.map(l => `<option value="${l.id}"${l.id === selected?.vendedorId ? ' selected' : ''}>${l.nome}${l.tipo === 'PJ' ? ' (PJ)' : ''}</option>`))
    .join('');

  $('negociacao-comprador').innerHTML = ['<option value="">— Selecione —</option>']
    .concat(compradores.map(c => {
      const ico = c.status === 'aprovado' ? ' ✓' : c.status === 'reprovado' ? ' ✗' : ' ⏳';
      return `<option value="${c.id}"${c.id === selected?.compradorId ? ' selected' : ''}>${c.nome}${ico}</option>`;
    }))
    .join('');
}

function onNegociacaoImovelChange() {
  const imovelId = $('negociacao-imovel').value;
  const info = $('negociacao-imovel-info');
  if (!imovelId) { info.style.display = 'none'; $('negociacao-valor-info').textContent = 'Anunciado: —'; return; }
  const imovel = (_imoveisCache || []).find(i => i.id === imovelId);
  if (!imovel) { info.style.display = 'none'; return; }
  if (imovel.locadorId) $('negociacao-vendedor').value = imovel.locadorId;
  const valorInput = $('negociacao-valor');
  if (!valorInput.value && imovel.valorVenda) {
    valorInput.value = imovel.valorVenda;
  }
  $('negociacao-valor-info').textContent = `Anunciado: ${fmtBRL(imovel.valorVenda)}`;
  const end = imovel.endereco || {};
  const endStr = [end.logradouro, end.numero, end.bairro, end.cidade, end.uf].filter(Boolean).join(', ');
  info.style.display = 'block';
  info.textContent = `${endStr || 'sem endereço'} · ${IMOVEL_STATUS_LABEL[imovel.status] || imovel.status}`;
  info.style.color = imovel.status === 'alugado' ? 'var(--warning)' : 'var(--text-muted)';
}

async function openNegociacaoModal(id) {
  clearAlert('negociacao-alert');
  $('negociacao-id').value = id || '';
  $('modal-negociacao-title').textContent = id ? 'Editar Negociação' : 'Nova Negociação';
  $('btn-delete-negociacao').style.display = id ? 'inline-block' : 'none';
  $('btn-gerar-negociacao').style.display = id ? 'inline-block' : 'none';

  ['negociacao-valor', 'negociacao-entrada', 'negociacao-data-aceite', 'negociacao-data-posse',
   'negociacao-clausulas', 'negociacao-obs', 'negociacao-motivo-status'].forEach(f => $(f).value = '');
  $('negociacao-status').value = 'rascunho';
  $('negociacao-forma-pagamento').value = 'a_vista';
  $('negociacao-comissao').value = '6';
  $('negociacao-imovel-info').style.display = 'none';
  $('negociacao-valor-info').textContent = 'Anunciado: —';

  invalidateImoveisCache();
  invalidateLocadoresCache();
  invalidateCompradoresCache();

  let selected = null;
  if (id) {
    try {
      const snap = await tenantPath().collection('negociacoes').doc(id).get();
      if (snap.exists) {
        const n = snap.data();
        selected = { imovelId: n.imovelId, vendedorId: n.vendedorId, compradorId: n.compradorId };
        $('negociacao-status').value = n.status || 'rascunho';
        $('negociacao-motivo-status').value = n.motivoStatus || '';
        $('negociacao-valor').value = n.valor ?? '';
        $('negociacao-forma-pagamento').value = n.formaPagamento || 'a_vista';
        $('negociacao-comissao').value = n.comissao ?? 6;
        $('negociacao-entrada').value = n.entrada ?? '';
        $('negociacao-data-aceite').value = n.dataAceite || '';
        $('negociacao-data-posse').value = n.dataPosse || '';
        $('negociacao-clausulas').value = n.clausulas || '';
        $('negociacao-obs').value = n.obs || '';
      }
    } catch (err) {
      console.error('Erro ao carregar negociação:', err);
    }
    $('negociacao-docs-section').style.display = 'block';
    loadNegociacaoDocs(id);
  } else {
    $('negociacao-docs-section').style.display = 'none';
  }
  await populateNegociacaoSelects(selected);
  onNegociacaoImovelChange();
  $('modal-negociacao').style.display = 'flex';
}

function closeNegociacaoModal() { $('modal-negociacao').style.display = 'none'; }

async function saveNegociacao() {
  clearAlert('negociacao-alert');
  const id = $('negociacao-id').value;
  const imovelId = $('negociacao-imovel').value;
  const vendedorId = $('negociacao-vendedor').value;
  const compradorId = $('negociacao-comprador').value;
  const valor = parseFloat($('negociacao-valor').value);
  const status = $('negociacao-status').value;

  if (!imovelId) { showAlert('negociacao-alert', 'Selecione o imóvel.'); return; }
  if (!vendedorId) { showAlert('negociacao-alert', 'Selecione o vendedor.'); return; }
  if (!compradorId) { showAlert('negociacao-alert', 'Selecione o comprador.'); return; }
  if (!valor || valor <= 0) { showAlert('negociacao-alert', 'Valor proposto é obrigatório.'); return; }

  let statusAnterior = null;
  if (id) {
    try {
      const prev = await tenantPath().collection('negociacoes').doc(id).get();
      if (prev.exists) statusAnterior = prev.data().status;
    } catch (_) {}
  }

  const data = {
    status,
    motivoStatus: $('negociacao-motivo-status').value.trim() || null,
    imovelId, vendedorId, compradorId,
    valor,
    formaPagamento: $('negociacao-forma-pagamento').value,
    comissao: parseFloat($('negociacao-comissao').value) || 0,
    entrada: parseFloat($('negociacao-entrada').value) || null,
    dataAceite: $('negociacao-data-aceite').value || null,
    dataPosse: $('negociacao-data-posse').value || null,
    clausulas: $('negociacao-clausulas').value.trim() || null,
    obs: $('negociacao-obs').value.trim() || null,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  };

  const btn = $('btn-save-negociacao');
  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    let negociacaoId = id;
    if (id) {
      await tenantPath().collection('negociacoes').doc(id).update(data);
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('negociacoes').add(data);
      negociacaoId = docRef.id;
    }
    await syncImovelStatusFromNegociacao(imovelId, status, statusAnterior);
    invalidateImoveisCache();
    if (!id) {
      btn.disabled = false; btn.textContent = 'Salvar';
      await openNegociacaoModal(negociacaoId);
      showAlert('negociacao-alert', 'Negociação criada. Agora você pode anexar documentos.', 'success');
      loadNegociacoes();
      return;
    }
    closeNegociacaoModal();
    loadNegociacoes();
  } catch (err) {
    console.error('Erro ao salvar negociação:', err);
    showAlert('negociacao-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar';
  }
}

async function syncImovelStatusFromNegociacao(imovelId, statusNovo, statusAnterior) {
  if (!imovelId) return;
  const imovelRef = tenantPath().collection('imoveis').doc(imovelId);
  if (statusNovo === 'fechada') {
    await imovelRef.update({ status: 'vendido' });
  } else if ((statusNovo === 'recusada' || statusNovo === 'rascunho') && statusAnterior === 'fechada') {
    await imovelRef.update({ status: 'disponivel' });
  }
}

async function deleteNegociacao() {
  const id = $('negociacao-id').value;
  if (!id) return;
  if (!confirm('Excluir esta negociação?')) return;
  try {
    const snap = await tenantPath().collection('negociacoes').doc(id).get();
    if (snap.exists) {
      const n = snap.data();
      if (n.status === 'fechada' && n.imovelId) {
        await tenantPath().collection('imoveis').doc(n.imovelId).update({ status: 'disponivel' });
        invalidateImoveisCache();
      }
    }
    const folderRef = storageTenantRef().child(`negociacoes/${id}`);
    try {
      const list = await folderRef.listAll();
      await Promise.all(list.items.map(item => item.delete()));
    } catch (_) {}
    await tenantPath().collection('negociacoes').doc(id).delete();
    closeNegociacaoModal();
    loadNegociacoes();
  } catch (err) {
    showAlert('negociacao-alert', 'Erro: ' + err.message);
  }
}

async function loadNegociacaoDocs(id) {
  const container = $('negociacao-docs-list');
  container.innerHTML = `<p class="empty">Carregando documentos…</p>`;
  try {
    const folderRef = storageTenantRef().child(`negociacoes/${id}`);
    const list = await folderRef.listAll();
    if (list.items.length === 0) {
      container.innerHTML = `<p class="empty">Nenhum documento anexado.</p>`;
      return;
    }
    const items = await Promise.all(list.items.map(async (item) => {
      const meta = await item.getMetadata();
      const url = await item.getDownloadURL();
      const ext = (item.name.split('.').pop() || '').toLowerCase();
      const icon = (ext === 'pdf') ? '📄' : (['jpg','jpeg','png'].includes(ext) ? '🖼' : '📎');
      const sizeKb = (meta.size / 1024).toFixed(0);
      const date = new Date(meta.timeCreated).toLocaleDateString('pt-BR');
      return `
        <div class="doc-item">
          <span class="doc-icon">${icon}</span>
          <span class="doc-name">${item.name}</span>
          <span class="doc-meta">${sizeKb} KB · ${date}</span>
          <div class="doc-actions">
            <a class="btn-icon" href="${url}" target="_blank" title="Abrir">👁</a>
            <a class="btn-icon" href="${url}" download="${item.name}" title="Baixar">⬇</a>
            <button class="btn-icon btn-icon-danger" onclick="deleteNegociacaoDoc('${id}','${item.name}')" title="Excluir">🗑</button>
          </div>
        </div>
      `;
    }));
    container.innerHTML = items.join('');
  } catch (err) {
    container.innerHTML = `<p class="empty" style="color:var(--danger);">Erro: ${err.message}</p>`;
  }
}

async function uploadNegociacaoDocs() {
  const id = $('negociacao-id').value;
  if (!id) { showAlert('negociacao-alert', 'Salve antes de anexar.'); return; }
  const input = $('negociacao-doc-input');
  const files = Array.from(input.files || []);
  if (files.length === 0) { showAlert('negociacao-alert', 'Selecione ao menos um arquivo.'); return; }
  const tooBig = files.find(f => f.size > 10 * 1024 * 1024);
  if (tooBig) { showAlert('negociacao-alert', `Arquivo "${tooBig.name}" excede 10MB.`); return; }
  const folderRef = storageTenantRef().child(`negociacoes/${id}`);
  try {
    for (const file of files) {
      await folderRef.child(file.name).put(file, {
        contentType: file.type,
        customMetadata: { uploadedBy: State.user.uid },
      });
    }
    input.value = '';
    showAlert('negociacao-alert', `${files.length} arquivo(s) enviado(s).`, 'success');
    loadNegociacaoDocs(id);
  } catch (err) {
    showAlert('negociacao-alert', 'Erro: ' + err.message);
  }
}

async function deleteNegociacaoDoc(id, filename) {
  if (!confirm(`Excluir o arquivo "${filename}"?`)) return;
  try {
    await storageTenantRef().child(`negociacoes/${id}/${filename}`).delete();
    loadNegociacaoDocs(id);
  } catch (err) {
    showAlert('negociacao-alert', 'Erro: ' + err.message);
  }
}

// Gerador de contrato de compra/venda
async function gerarContratoVenda() {
  const negociacaoId = $('negociacao-id').value;
  if (!negociacaoId) { showAlert('negociacao-alert', 'Salve a negociação antes de gerar.'); return; }

  try {
    const nSnap = await tenantPath().collection('negociacoes').doc(negociacaoId).get();
    if (!nSnap.exists) { showAlert('negociacao-alert', 'Negociação não encontrada.'); return; }
    const n = nSnap.data();

    const [vendedorSnap, compradorSnap, imovelSnap, configSnap] = await Promise.all([
      n.vendedorId  ? tenantPath().collection('locadores').doc(n.vendedorId).get()   : Promise.resolve(null),
      n.compradorId ? tenantPath().collection('compradores').doc(n.compradorId).get() : Promise.resolve(null),
      n.imovelId    ? tenantPath().collection('imoveis').doc(n.imovelId).get()      : Promise.resolve(null),
      tenantPath().collection('config').doc('site').get(),
    ]);

    const vendedor = (vendedorSnap && vendedorSnap.exists) ? vendedorSnap.data() : {};
    const comprador = (compradorSnap && compradorSnap.exists) ? compradorSnap.data() : {};
    const imovel = (imovelSnap && imovelSnap.exists) ? imovelSnap.data() : {};
    const cfg = configSnap.exists ? configSnap.data() : {};
    const template = cfg.templateVenda || '(Configure o template em Configurações)';

    const dados = {
      tenant: { nome: State.tenant.nome, cnpj: State.tenant.cnpj ? maskCNPJ(State.tenant.cnpj) : '—', creci: State.tenant.creci || '—' },
      vendedor: {
        nome: vendedor.nome || '—',
        documento: vendedor.documento ? (vendedor.tipo === 'PJ' ? maskCNPJ(vendedor.documento) : maskCPF(vendedor.documento)) : '—',
        rg: vendedor.rg || '—',
        nascimento: vendedor.nascimento ? fmtDataBR(vendedor.nascimento) : '—',
        estadoCivil: vendedor.estadoCivil || '—',
        profissao: vendedor.profissao || '—',
        nacionalidade: vendedor.nacionalidade || '—',
        email: vendedor.email || '—',
        telefone: vendedor.telefone ? maskTelefone(vendedor.telefone) : '—',
        enderecoCompleto: formatEnderecoCompleto(vendedor.endereco),
      },
      comprador: {
        nome: comprador.nome || '—',
        documento: comprador.documento ? (comprador.tipo === 'PJ' ? maskCNPJ(comprador.documento) : maskCPF(comprador.documento)) : '—',
        rg: comprador.rg || '—',
        nascimento: comprador.nascimento ? fmtDataBR(comprador.nascimento) : '—',
        estadoCivil: comprador.estadoCivil || '—',
        profissao: comprador.profissao || '—',
        nacionalidade: comprador.nacionalidade || '—',
        email: comprador.email || '—',
        telefone: comprador.telefone ? maskTelefone(comprador.telefone) : '—',
        enderecoCompleto: formatEnderecoCompleto(comprador.endereco),
        formaPagamento: FORMA_PAGAMENTO_LABEL[comprador.formaPagamento] || '—',
      },
      imovel: {
        apelido: imovel.apelido || '—',
        tipo: imovel.tipo || '—',
        subtipo: imovel.subtipo || '—',
        matricula: imovel.matricula || '—',
        iptu: imovel.iptu || '—',
        areaUtil: imovel.areaUtil ? imovel.areaUtil + ' m²' : '—',
        areaTotal: imovel.areaTotal ? imovel.areaTotal + ' m²' : '—',
        enderecoCompleto: formatEnderecoCompleto(imovel.endereco),
      },
      negociacao: {
        valor: fmtBRL(n.valor),
        formaPagamento: FORMA_PAGAMENTO_LABEL[n.formaPagamento] || '—',
        comissao: (n.comissao ?? 0) + '%',
        entrada: fmtBRL(n.entrada),
        dataAceite: n.dataAceite ? fmtDataBR(n.dataAceite) : '—',
        dataPosse: n.dataPosse ? fmtDataBR(n.dataPosse) : '—',
      },
    };

    const conteudoMerged = mergeTemplate(template, dados);
    const html = buildContratoHtml('COMPRA E VENDA DE IMÓVEL', dados, conteudoMerged, n.clausulas, vendedor.nome, comprador.nome);

    _contratoHtmlCache = html;
    $('contrato-preview-content').innerHTML = html;
    $('modal-contrato-preview-title').textContent = 'Preview do contrato de compra e venda';
    $('modal-contrato-preview').style.display = 'flex';
  } catch (err) {
    console.error('Erro ao gerar contrato de venda:', err);
    showAlert('negociacao-alert', 'Erro: ' + err.message);
  }
}

// =============================================================
// IMÓVEIS — CRUD + vínculo com Locador + documentos
// =============================================================

const IMOVEL_STATUS_LABEL = {
  disponivel: 'Disponível',
  alugado: 'Alugado',
  em_reforma: 'Em reforma',
  indisponivel: 'Indisponível',
};

const IMOVEL_TIPO_LABEL = {
  residencial: 'Residencial',
  comercial: 'Comercial',
};

// Cache de locadores para evitar refetch a cada abertura do modal
let _locadoresCache = null;

async function ensureLocadoresCache() {
  if (_locadoresCache) return _locadoresCache;
  const snap = await tenantPath().collection('locadores').orderBy('nome').get();
  _locadoresCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return _locadoresCache;
}

function invalidateLocadoresCache() { _locadoresCache = null; }

async function populateLocadorSelect(selectEl, selectedId) {
  selectEl.innerHTML = '<option value="">Carregando…</option>';
  try {
    const locs = await ensureLocadoresCache();
    if (locs.length === 0) {
      selectEl.innerHTML = '<option value="">— Nenhum locador cadastrado —</option>';
      return;
    }
    const options = ['<option value="">— Selecione —</option>'];
    locs.forEach(l => {
      const label = l.nome + (l.tipo === 'PJ' ? ' (PJ)' : '');
      const sel = l.id === selectedId ? ' selected' : '';
      options.push(`<option value="${l.id}"${sel}>${label}</option>`);
    });
    selectEl.innerHTML = options.join('');
  } catch (err) {
    console.error('Erro ao carregar locadores:', err);
    selectEl.innerHTML = '<option value="">Erro ao carregar</option>';
  }
}

async function loadImoveis() {
  const tbody = $('tbody-imoveis');
  tbody.innerHTML = `<tr><td colspan="7" class="empty">Carregando…</td></tr>`;

  try {
    const [imSnap, locs] = await Promise.all([
      tenantPath().collection('imoveis').orderBy('apelido').get(),
      ensureLocadoresCache(),
    ]);

    if (imSnap.empty) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">Nenhum imóvel cadastrado. Clique em "Novo Imóvel" para começar.</td></tr>`;
      return;
    }

    const locMap = Object.fromEntries(locs.map(l => [l.id, l.nome]));

    const rows = imSnap.docs.map((doc, i) => {
      const im = doc.data();
      const status = im.status || 'disponivel';
      const locNome = locMap[im.locadorId] || (im.locadorId ? '⚠ locador apagado' : '—');
      return `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${im.apelido || '—'}</strong></td>
          <td>${IMOVEL_TIPO_LABEL[im.tipo] || im.tipo || '—'}</td>
          <td>${locNome}</td>
          <td>${fmtBRL(im.aluguelSugerido)}</td>
          <td><span class="badge-status ${status}">${IMOVEL_STATUS_LABEL[status] || status}</span></td>
          <td>
            <div class="action-btns">
              <button class="btn btn-sm btn-secondary" onclick="openImovelModal('${doc.id}')">Editar</button>
            </div>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join('');
  } catch (err) {
    console.error('Erro ao carregar imóveis:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

function onImovelFinalidadeChange() {
  const fin = $('imovel-finalidade').value;
  $('imovel-loc-fields').style.display = (fin === 'venda') ? 'none' : 'grid';
  $('imovel-venda-fields').style.display = (fin === 'locacao') ? 'none' : 'grid';
}

async function buscarCEPImovel() {
  const input = $('imovel-cep');
  const status = $('imovel-cep-status');
  const cepRaw = (input.value || '').replace(/\D/g, '');

  if (cepRaw.length === 0) return;
  if (cepRaw.length !== 8) {
    showAlert('imovel-alert', 'CEP deve ter 8 dígitos.');
    return;
  }

  input.value = cepRaw.replace(/(\d{5})(\d{3})/, '$1-$2');
  status.style.display = 'block';
  status.textContent = 'Buscando…';
  status.style.color = 'var(--primary)';

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepRaw}/json/`);
    const data = await res.json();
    if (data.erro) {
      status.textContent = 'CEP não encontrado';
      status.style.color = 'var(--danger)';
      return;
    }
    if (data.logradouro) $('imovel-logradouro').value = data.logradouro;
    if (data.bairro)     $('imovel-bairro').value     = data.bairro;
    if (data.localidade) $('imovel-cidade').value     = data.localidade;
    if (data.uf)         $('imovel-uf').value         = data.uf;
    status.textContent = '✓';
    status.style.color = 'var(--success)';
    $('imovel-numero').focus();
  } catch (err) {
    console.error('Erro CEP:', err);
    status.textContent = 'Erro de conexão';
    status.style.color = 'var(--danger)';
  }
}

async function openImovelModal(id) {
  clearAlert('imovel-alert');

  $('imovel-id').value = id || '';
  $('modal-imovel-title').textContent = id ? 'Editar Imóvel' : 'Novo Imóvel';
  $('btn-delete-imovel').style.display = id ? 'inline-block' : 'none';

  ['imovel-apelido', 'imovel-cep', 'imovel-logradouro', 'imovel-numero',
   'imovel-complemento', 'imovel-bairro', 'imovel-cidade', 'imovel-uf',
   'imovel-area-util', 'imovel-area-total', 'imovel-andar',
   'imovel-matricula', 'imovel-iptu',
   'imovel-valor-mercado', 'imovel-aluguel-sugerido', 'imovel-valor-venda',
   'imovel-obs'].forEach(f => $(f).value = '');
  $('imovel-status').value = 'disponivel';
  $('imovel-tipo').value = 'residencial';
  $('imovel-subtipo').value = '';
  $('imovel-finalidade').value = 'locacao';
  $('imovel-aceita-financiamento').value = 'sim';
  $('imovel-permite-fgts').value = 'sim';
  $('imovel-quartos').value = '0';
  $('imovel-banheiros').value = '0';
  $('imovel-vagas').value = '0';
  $('imovel-mobiliado').value = 'nao';
  $('imovel-cep-status').style.display = 'none';
  // Toggles de privacidade padrão
  ['pub-mostrar-valor', 'pub-mostrar-bairro', 'pub-mostrar-area', 'pub-mostrar-comodos'].forEach(id => {
    const el = $(id); if (el) el.checked = true;
  });
  onImovelFinalidadeChange();

  // Refresh cache de locadores e popula select (deferido para após carregar dados)
  invalidateLocadoresCache();

  if (id) {
    try {
      const snap = await tenantPath().collection('imoveis').doc(id).get();
      if (snap.exists) {
        const im = snap.data();
        $('imovel-apelido').value = im.apelido || '';
        $('imovel-status').value = im.status || 'disponivel';
        $('imovel-tipo').value = im.tipo || 'residencial';
        $('imovel-subtipo').value = im.subtipo || '';
        await populateLocadorSelect($('imovel-locador'), im.locadorId);

        const end = im.endereco || {};
        $('imovel-cep').value = end.cep ? maskCEP(end.cep) : '';
        $('imovel-logradouro').value = end.logradouro || '';
        $('imovel-numero').value = end.numero || '';
        $('imovel-complemento').value = end.complemento || '';
        $('imovel-bairro').value = end.bairro || '';
        $('imovel-cidade').value = end.cidade || '';
        $('imovel-uf').value = end.uf || '';

        $('imovel-area-util').value = im.areaUtil ?? '';
        $('imovel-area-total').value = im.areaTotal ?? '';
        $('imovel-andar').value = im.andar || '';
        $('imovel-quartos').value = im.quartos ?? 0;
        $('imovel-banheiros').value = im.banheiros ?? 0;
        $('imovel-vagas').value = im.vagas ?? 0;
        $('imovel-mobiliado').value = im.mobiliado || 'nao';

        $('imovel-matricula').value = im.matricula || '';
        $('imovel-iptu').value = im.iptu || '';
        $('imovel-finalidade').value = im.finalidade || 'locacao';
        $('imovel-valor-mercado').value = im.valorMercado ?? '';
        $('imovel-aluguel-sugerido').value = im.aluguelSugerido ?? '';
        $('imovel-valor-venda').value = im.valorVenda ?? '';
        $('imovel-aceita-financiamento').value = im.aceitaFinanciamento || 'sim';
        $('imovel-permite-fgts').value = im.permiteFGTS || 'sim';
        $('imovel-obs').value = im.obs || '';
        onImovelFinalidadeChange();

        // Toggles de privacidade
        const pub = im.publicacao || {};
        $('pub-mostrar-valor').checked   = pub.mostrarValor   !== false;
        $('pub-mostrar-bairro').checked  = pub.mostrarBairro  !== false;
        $('pub-mostrar-area').checked    = pub.mostrarArea    !== false;
        $('pub-mostrar-comodos').checked = pub.mostrarComodos !== false;
      }
    } catch (err) {
      console.error('Erro ao carregar imóvel:', err);
      showAlert('imovel-alert', 'Erro ao carregar dados: ' + err.message);
    }
    $('imovel-docs-section').style.display = 'block';
    $('imovel-fotos-section').style.display = 'block';
    $('imovel-publicacao-section').style.display = 'block';
    loadImovelDocs(id);
    loadImovelFotos(id);

    // Estado do toggle de publicação
    try {
      const docSnap = await tenantPath().collection('imoveis').doc(id).get();
      const linkAtivo = !!(docSnap.data() || {}).linkPublico;
      $('imovel-link-publico').checked = linkAtivo;
      updateLinkPublicoUI(linkAtivo, id);
    } catch (_) {}

    // Default do checkbox de marca d'água conforme config global
    try {
      const cfgSnap = await tenantPath().collection('config').doc('site').get();
      const wm = cfgSnap.exists ? cfgSnap.data().watermarkDefault !== false : true;
      $('imovel-foto-watermark').checked = wm;
    } catch (_) {
      $('imovel-foto-watermark').checked = true;
    }
  } else {
    await populateLocadorSelect($('imovel-locador'), null);
    $('imovel-docs-section').style.display = 'none';
    $('imovel-fotos-section').style.display = 'none';
    $('imovel-publicacao-section').style.display = 'none';
  }

  $('modal-imovel').style.display = 'flex';
}

function closeImovelModal() {
  $('modal-imovel').style.display = 'none';
}

async function saveImovel() {
  clearAlert('imovel-alert');

  const id = $('imovel-id').value;
  const apelido = $('imovel-apelido').value.trim();
  const locadorId = $('imovel-locador').value;

  if (!apelido) { showAlert('imovel-alert', 'Apelido / Identificação é obrigatório.'); return; }
  if (!locadorId) { showAlert('imovel-alert', 'Selecione o locador (proprietário).'); return; }

  const data = {
    apelido,
    status: $('imovel-status').value,
    tipo: $('imovel-tipo').value,
    subtipo: $('imovel-subtipo').value || null,
    locadorId,
    endereco: {
      cep: $('imovel-cep').value.replace(/\D/g, '') || null,
      logradouro: $('imovel-logradouro').value.trim() || null,
      numero: $('imovel-numero').value.trim() || null,
      complemento: $('imovel-complemento').value.trim() || null,
      bairro: $('imovel-bairro').value.trim() || null,
      cidade: $('imovel-cidade').value.trim() || null,
      uf: $('imovel-uf').value.trim().toUpperCase() || null,
    },
    areaUtil: parseFloat($('imovel-area-util').value) || null,
    areaTotal: parseFloat($('imovel-area-total').value) || null,
    andar: $('imovel-andar').value.trim() || null,
    quartos: parseInt($('imovel-quartos').value, 10) || 0,
    banheiros: parseInt($('imovel-banheiros').value, 10) || 0,
    vagas: parseInt($('imovel-vagas').value, 10) || 0,
    mobiliado: $('imovel-mobiliado').value,
    matricula: $('imovel-matricula').value.trim() || null,
    iptu: $('imovel-iptu').value.trim() || null,
    finalidade: $('imovel-finalidade').value,
    valorMercado: parseFloat($('imovel-valor-mercado').value) || null,
    aluguelSugerido: parseFloat($('imovel-aluguel-sugerido').value) || null,
    valorVenda: parseFloat($('imovel-valor-venda').value) || null,
    aceitaFinanciamento: $('imovel-aceita-financiamento').value,
    permiteFGTS: $('imovel-permite-fgts').value,
    publicacao: {
      mostrarValor:   $('pub-mostrar-valor').checked,
      mostrarBairro:  $('pub-mostrar-bairro').checked,
      mostrarArea:    $('pub-mostrar-area').checked,
      mostrarComodos: $('pub-mostrar-comodos').checked,
    },
    obs: $('imovel-obs').value.trim() || null,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  };

  const btn = $('btn-save-imovel');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  try {
    if (id) {
      await tenantPath().collection('imoveis').doc(id).update(data);
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('imoveis').add(data);
      btn.disabled = false;
      btn.textContent = 'Salvar';
      invalidateImoveisCache();
      await openImovelModal(docRef.id);
      showAlert('imovel-alert', 'Imóvel criado. Agora você pode anexar documentos.', 'success');
      loadImoveis();
      return;
    }
    invalidateImoveisCache();
    closeImovelModal();
    loadImoveis();
  } catch (err) {
    console.error('Erro ao salvar:', err);
    showAlert('imovel-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function deleteImovel() {
  const id = $('imovel-id').value;
  if (!id) return;
  if (!confirm('Excluir este imóvel? Os documentos anexados também serão removidos. Esta ação não pode ser desfeita.')) return;

  try {
    const folderRef = storageTenantRef().child(`imoveis/${id}`);
    try {
      const list = await folderRef.listAll();
      await Promise.all(list.items.map(item => item.delete()));
    } catch (_) { /* pasta pode não existir */ }

    await tenantPath().collection('imoveis').doc(id).delete();
    invalidateImoveisCache();
    closeImovelModal();
    loadImoveis();
  } catch (err) {
    console.error('Erro ao excluir:', err);
    showAlert('imovel-alert', 'Erro: ' + err.message);
  }
}

async function loadImovelDocs(imovelId) {
  const container = $('imovel-docs-list');
  container.innerHTML = `<p class="empty">Carregando documentos…</p>`;

  try {
    const folderRef = storageTenantRef().child(`imoveis/${imovelId}`);
    const list = await folderRef.listAll();

    if (list.items.length === 0) {
      container.innerHTML = `<p class="empty">Nenhum documento anexado.</p>`;
      return;
    }

    const items = await Promise.all(list.items.map(async (item) => {
      const meta = await item.getMetadata();
      const url = await item.getDownloadURL();
      const ext = (item.name.split('.').pop() || '').toLowerCase();
      const icon = (ext === 'pdf') ? '📄' : (['jpg','jpeg','png'].includes(ext) ? '🖼' : '📎');
      const sizeKb = (meta.size / 1024).toFixed(0);
      const date = new Date(meta.timeCreated).toLocaleDateString('pt-BR');
      return `
        <div class="doc-item">
          <span class="doc-icon">${icon}</span>
          <span class="doc-name">${item.name}</span>
          <span class="doc-meta">${sizeKb} KB · ${date}</span>
          <div class="doc-actions">
            <a class="btn-icon" href="${url}" target="_blank" title="Abrir">👁</a>
            <a class="btn-icon" href="${url}" download="${item.name}" title="Baixar">⬇</a>
            <button class="btn-icon btn-icon-danger" onclick="deleteImovelDoc('${imovelId}','${item.name}')" title="Excluir">🗑</button>
          </div>
        </div>
      `;
    }));
    container.innerHTML = items.join('');
  } catch (err) {
    console.error('Erro ao listar docs:', err);
    container.innerHTML = `<p class="empty" style="color:var(--danger);">Erro: ${err.message}</p>`;
  }
}

async function uploadImovelDocs() {
  const imovelId = $('imovel-id').value;
  if (!imovelId) {
    showAlert('imovel-alert', 'Salve o imóvel antes de anexar documentos.');
    return;
  }

  const input = $('imovel-doc-input');
  const files = Array.from(input.files || []);
  if (files.length === 0) {
    showAlert('imovel-alert', 'Selecione ao menos um arquivo.');
    return;
  }

  const tooBig = files.find(f => f.size > 10 * 1024 * 1024);
  if (tooBig) {
    showAlert('imovel-alert', `Arquivo "${tooBig.name}" excede 10MB.`);
    return;
  }

  const folderRef = storageTenantRef().child(`imoveis/${imovelId}`);
  try {
    for (const file of files) {
      await folderRef.child(file.name).put(file, {
        contentType: file.type,
        customMetadata: { uploadedBy: State.user.uid },
      });
    }
    input.value = '';
    showAlert('imovel-alert', `${files.length} arquivo(s) enviado(s).`, 'success');
    loadImovelDocs(imovelId);
  } catch (err) {
    console.error('Erro no upload:', err);
    showAlert('imovel-alert', 'Erro: ' + err.message);
  }
}

async function deleteImovelDoc(imovelId, filename) {
  if (!confirm(`Excluir o arquivo "${filename}"?`)) return;
  try {
    await storageTenantRef().child(`imoveis/${imovelId}/${filename}`).delete();
    loadImovelDocs(imovelId);
  } catch (err) {
    console.error('Erro ao excluir doc:', err);
    showAlert('imovel-alert', 'Erro: ' + err.message);
  }
}

// ---------- Fotos do Imóvel (galeria pública) ----------

async function loadImovelFotos(imovelId) {
  const grid = $('imovel-fotos-grid');
  grid.innerHTML = `<p class="empty">Carregando fotos…</p>`;

  try {
    const snap = await tenantPath().collection('imoveis').doc(imovelId)
      .collection('fotos').orderBy('ordem').get();

    if (snap.empty) {
      grid.innerHTML = `<p class="empty">Nenhuma foto adicionada. Sem fotos, o imóvel publicado fica menos atrativo.</p>`;
      return;
    }

    grid.innerHTML = snap.docs.map(doc => {
      const f = doc.data();
      return `
        <div class="foto-item" onclick="window.open('${f.url}', '_blank')">
          <img src="${f.url}" alt="${f.nome || ''}" loading="lazy">
          <button class="foto-del" title="Excluir" onclick="event.stopPropagation(); deleteImovelFoto('${imovelId}','${doc.id}','${f.path || ''}');">×</button>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao listar fotos:', err);
    grid.innerHTML = `<p class="empty" style="color:var(--danger);">Erro: ${err.message}</p>`;
  }
}

// Aplica logo como marca d'água no canto inferior direito da imagem
async function applyWatermark(file, logoImg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // Tamanho da logo: 12% da menor dimensão
        const logoSize = Math.min(canvas.width, canvas.height) * 0.12;
        const padding = logoSize * 0.4;
        const x = canvas.width - logoSize - padding;
        const y = canvas.height - logoSize - padding;

        // Fundo branco semi-transparente atrás da logo (pra contraste)
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.arc(x + logoSize/2, y + logoSize/2, logoSize/2 + 4, 0, Math.PI*2);
        ctx.fill();

        ctx.globalAlpha = 0.85;
        ctx.drawImage(logoImg, x, y, logoSize, logoSize);
        ctx.globalAlpha = 1;

        canvas.toBlob(blob => {
          if (!blob) return reject(new Error('Falha ao gerar imagem'));
          resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
        }, 'image/jpeg', 0.88);
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('Falha ao carregar imagem'));
    img.src = URL.createObjectURL(file);
  });
}

// Carrega a logo uma vez e mantém em memória
let _logoImageCache = null;
function getLogoImage() {
  if (_logoImageCache) return Promise.resolve(_logoImageCache);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { _logoImageCache = img; resolve(img); };
    img.onerror = () => reject(new Error('Falha ao carregar logo'));
    img.src = 'logo.png?v=20260511d';
  });
}

async function uploadImovelFotos() {
  const imovelId = $('imovel-id').value;
  if (!imovelId) {
    showAlert('imovel-alert', 'Salve o imóvel antes de anexar fotos.');
    return;
  }

  const input = $('imovel-foto-input');
  const files = Array.from(input.files || []);
  if (files.length === 0) {
    showAlert('imovel-alert', 'Selecione ao menos uma foto.');
    return;
  }

  const tooBig = files.find(f => f.size > 10 * 1024 * 1024);
  if (tooBig) {
    showAlert('imovel-alert', `Arquivo "${tooBig.name}" excede 10MB.`);
    return;
  }

  const useWatermark = $('imovel-foto-watermark').checked;
  let logoImg = null;
  if (useWatermark) {
    try { logoImg = await getLogoImage(); }
    catch (e) {
      console.warn('Logo não carregou — upload sem marca d\'água:', e);
    }
  }

  const folderRef = storageTenantRef().child(`imoveis/${imovelId}/fotos`);
  const fotosColl = tenantPath().collection('imoveis').doc(imovelId).collection('fotos');

  // Pega ordem atual pra continuar a sequência
  const existSnap = await fotosColl.orderBy('ordem', 'desc').limit(1).get();
  let nextOrdem = existSnap.empty ? 0 : (existSnap.docs[0].data().ordem || 0) + 1;

  try {
    for (const original of files) {
      const fileToUpload = (useWatermark && logoImg)
        ? await applyWatermark(original, logoImg)
        : original;

      const cleanName = original.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const finalName = `${Date.now()}_${cleanName}`;
      const fileRef = folderRef.child(finalName);

      await fileRef.put(fileToUpload, {
        contentType: fileToUpload.type || 'image/jpeg',
        customMetadata: { uploadedBy: State.user.uid, watermarked: useWatermark ? 'true' : 'false' },
      });
      const url = await fileRef.getDownloadURL();

      await fotosColl.add({
        url,
        nome: original.name,
        path: `imoveis/${imovelId}/fotos/${finalName}`,
        watermark: useWatermark,
        ordem: nextOrdem++,
        criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    input.value = '';
    showAlert('imovel-alert', `${files.length} foto(s) enviada(s).`, 'success');
    loadImovelFotos(imovelId);
  } catch (err) {
    console.error('Erro no upload de fotos:', err);
    showAlert('imovel-alert', 'Erro: ' + err.message);
  }
}

async function deleteImovelFoto(imovelId, fotoDocId, storagePath) {
  if (!confirm('Excluir esta foto?')) return;
  try {
    await tenantPath().collection('imoveis').doc(imovelId).collection('fotos').doc(fotoDocId).delete();
    if (storagePath) {
      try { await storage.ref().child(storagePath).delete(); } catch (_) {}
    }
    loadImovelFotos(imovelId);
  } catch (err) {
    console.error('Erro ao excluir foto:', err);
    showAlert('imovel-alert', 'Erro: ' + err.message);
  }
}

// ---------- Publicação pública do Imóvel ----------

function imovelPublicUrl(imovelId, tenantId) {
  const base = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
  return `${base}imovel.html?id=${imovelId}&t=${tenantId}`;
}

async function onTogglePublicoImovel() {
  const imovelId = $('imovel-id').value;
  if (!imovelId) return;
  const ativo = $('imovel-link-publico').checked;

  try {
    await tenantPath().collection('imoveis').doc(imovelId).update({
      linkPublico: ativo,
      linkPublicoEm: ativo ? firebase.firestore.FieldValue.serverTimestamp() : null,
    });
    updateLinkPublicoUI(ativo, imovelId);
  } catch (err) {
    console.error('Erro ao atualizar publicação:', err);
    $('imovel-link-publico').checked = !ativo;
    showAlert('imovel-alert', 'Erro: ' + err.message);
  }
}

function updateLinkPublicoUI(ativo, imovelId) {
  const actions = $('imovel-link-actions');
  if (ativo) {
    actions.style.display = 'block';
    $('imovel-link-url').value = imovelPublicUrl(imovelId, State.tenant.id);
  } else {
    actions.style.display = 'none';
  }
}

function copyImovelLink() {
  const input = $('imovel-link-url');
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    showAlert('imovel-alert', 'Link copiado!', 'success');
  }).catch(() => {
    document.execCommand('copy');
    showAlert('imovel-alert', 'Link copiado!', 'success');
  });
}

function openImovelLink() {
  window.open($('imovel-link-url').value, '_blank');
}

// ---------- Configurações da imobiliária ----------

function vitrineUrl(tenantId) {
  const base = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
  return `${base}imoveis.html?t=${tenantId}`;
}

async function loadConfigImobiliaria() {
  if (!State.tenant) return;
  $('cfg-razao').value = State.tenant.nome || '';
  $('cfg-cnpj').value = State.tenant.cnpj || '';
  $('cfg-creci').value = State.tenant.creci || '';
  $('cfg-telefone').value = State.tenant.telefone ? maskTelefone(State.tenant.telefone) : '';
  $('cfg-email-contato').value = State.tenant.emailContato || '';
  $('cfg-vitrine-url').value = vitrineUrl(State.tenant.id);

  try {
    const snap = await tenantPath().collection('config').doc('site').get();
    const cfg = snap.exists ? snap.data() : {};
    $('cfg-watermark-default').checked = cfg.watermarkDefault !== false; // default true
    $('cfg-template-locacao').value = cfg.templateLocacao || '';
    $('cfg-template-venda').value = cfg.templateVenda || '';
    $('cfg-balancete-cabecalho').value = cfg.balanceteCabecalho || '';
    $('cfg-balancete-rodape').value = cfg.balanceteRodape || '';
    $('cfg-worker-url').value = cfg.workerUrl || '';
    $('cfg-worker-gemini-url').value = cfg.workerGeminiUrl || '';
    $('cfg-email-from').value = cfg.emailFrom || 'onboarding@resend.dev';
    $('cfg-email-template').value = cfg.emailTemplate || '';
  } catch (err) {
    console.warn('Sem config de site ainda:', err);
    $('cfg-watermark-default').checked = true;
    $('cfg-template-locacao').value = '';
    $('cfg-template-venda').value = '';
    $('cfg-balancete-cabecalho').value = '';
    $('cfg-balancete-rodape').value = '';
    $('cfg-worker-url').value = '';
    $('cfg-worker-gemini-url').value = '';
    $('cfg-email-from').value = 'onboarding@resend.dev';
    $('cfg-email-template').value = '';
  }
}

let _saveConfigDebounce = null;
async function saveConfigImobiliaria() {
  clearTimeout(_saveConfigDebounce);
  _saveConfigDebounce = setTimeout(async () => {
    try {
      // Tenant doc — telefone e e-mail de contato (públicos)
      const telefoneDigits = $('cfg-telefone').value.replace(/\D/g, '') || null;
      const emailContato = $('cfg-email-contato').value.trim() || null;
      await tenantPath().update({
        telefone: telefoneDigits,
        emailContato,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      });
      // Sincroniza no State pra a UI usar imediatamente
      State.tenant.telefone = telefoneDigits;
      State.tenant.emailContato = emailContato;

      // Subdoc config/site — watermark default e templates de cláusulas
      await tenantPath().collection('config').doc('site').set({
        watermarkDefault: $('cfg-watermark-default').checked,
        templateLocacao: $('cfg-template-locacao').value,
        templateVenda: $('cfg-template-venda').value,
        balanceteCabecalho: $('cfg-balancete-cabecalho').value,
        balanceteRodape: $('cfg-balancete-rodape').value,
        workerUrl: $('cfg-worker-url').value.trim(),
        workerGeminiUrl: $('cfg-worker-gemini-url').value.trim(),
        emailFrom: $('cfg-email-from').value.trim(),
        emailTemplate: $('cfg-email-template').value,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      showAlert('cfg-alert', 'Configuração salva.', 'success');
    } catch (err) {
      console.error('Erro ao salvar config:', err);
      showAlert('cfg-alert', 'Erro: ' + err.message);
    }
  }, 600);
}

function copyVitrineUrl() {
  const input = $('cfg-vitrine-url');
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    showAlert('cfg-alert', 'Link da vitrine copiado!', 'success');
  }).catch(() => {
    document.execCommand('copy');
    showAlert('cfg-alert', 'Link da vitrine copiado!', 'success');
  });
}

function openVitrinePublica() {
  if (!State.tenant) return;
  window.open(vitrineUrl(State.tenant.id), '_blank');
}

// =============================================================
// CONTRATOS — amarra locador + locatário + imóvel + garantia
// =============================================================

const CONTRATO_STATUS_LABEL = {
  rascunho: 'Rascunho',
  vigente: 'Vigente',
  encerrado: 'Encerrado',
  rescindido: 'Rescindido',
};

// Caches para os selects do modal de contrato
let _locatariosCache = null;
let _imoveisCache = null;
let _garantiasCache = null;

async function ensureLocatariosCache() {
  if (_locatariosCache) return _locatariosCache;
  const snap = await tenantPath().collection('locatarios').orderBy('nome').get();
  _locatariosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return _locatariosCache;
}
async function ensureImoveisCache() {
  if (_imoveisCache) return _imoveisCache;
  const snap = await tenantPath().collection('imoveis').orderBy('apelido').get();
  _imoveisCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return _imoveisCache;
}
async function ensureGarantiasCache() {
  if (_garantiasCache) return _garantiasCache;
  const snap = await tenantPath().collection('garantias').orderBy('criadoEm', 'desc').get();
  _garantiasCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return _garantiasCache;
}

function invalidateLocatariosCache() { _locatariosCache = null; }
function invalidateImoveisCache() { _imoveisCache = null; }
function invalidateGarantiasCache() { _garantiasCache = null; }

function fmtDataBR(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function calcDataFim(inicioISO, prazoMeses) {
  if (!inicioISO || !prazoMeses) return '';
  const d = new Date(inicioISO + 'T00:00:00');
  d.setMonth(d.getMonth() + parseInt(prazoMeses, 10));
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function loadContratos() {
  const tbody = $('tbody-contratos');
  tbody.innerHTML = `<tr><td colspan="7" class="empty">Carregando…</td></tr>`;

  try {
    const [snap, imoveis, locatarios] = await Promise.all([
      tenantPath().collection('contratos').orderBy('criadoEm', 'desc').get(),
      ensureImoveisCache(),
      ensureLocatariosCache(),
    ]);

    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">Nenhum contrato cadastrado. Clique em "Novo Contrato" para começar.</td></tr>`;
      return;
    }

    const imMap = Object.fromEntries(imoveis.map(i => [i.id, i.apelido]));
    const locMap = Object.fromEntries(locatarios.map(l => [l.id, l.nome]));

    const rows = snap.docs.map((doc, i) => {
      const c = doc.data();
      const status = c.status || 'rascunho';
      const imovelLabel = imMap[c.imovelId] || (c.imovelId ? '⚠ imóvel apagado' : '—');
      const locatarioLabel = locMap[c.locatarioId] || (c.locatarioId ? '⚠ locatário apagado' : '—');
      const periodo = (c.inicio && c.fim) ? `${fmtDataBR(c.inicio)} → ${fmtDataBR(c.fim)}` : '—';
      return `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${imovelLabel}</strong></td>
          <td>${locatarioLabel}</td>
          <td>${periodo}</td>
          <td>${fmtBRL(c.aluguel)}</td>
          <td><span class="badge-status ${status}">${CONTRATO_STATUS_LABEL[status] || status}</span></td>
          <td>
            <div class="action-btns">
              <button class="btn btn-sm btn-secondary" onclick="openContratoModal('${doc.id}')">Editar</button>
            </div>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join('');
  } catch (err) {
    console.error('Erro ao carregar contratos:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

async function populateContratoSelects(selected) {
  const [locadores, locatarios, imoveis, garantias] = await Promise.all([
    ensureLocadoresCache(),
    ensureLocatariosCache(),
    ensureImoveisCache(),
    ensureGarantiasCache(),
  ]);

  // Locador
  $('contrato-locador').innerHTML = ['<option value="">— Selecione —</option>']
    .concat(locadores.map(l => `<option value="${l.id}"${l.id === selected?.locadorId ? ' selected' : ''}>${l.nome}${l.tipo === 'PJ' ? ' (PJ)' : ''}</option>`))
    .join('');

  // Locatário (badge do status na label)
  $('contrato-locatario').innerHTML = ['<option value="">— Selecione —</option>']
    .concat(locatarios.map(l => {
      const stLabel = l.status === 'aprovado' ? ' ✓' : l.status === 'reprovado' ? ' ✗' : ' ⏳';
      return `<option value="${l.id}"${l.id === selected?.locatarioId ? ' selected' : ''}>${l.nome}${stLabel}</option>`;
    }))
    .join('');

  // Imóvel
  $('contrato-imovel').innerHTML = ['<option value="">— Selecione —</option>']
    .concat(imoveis.map(i => {
      const stLabel = i.status === 'disponivel' ? ' 🟢' : i.status === 'alugado' ? ' 🟠' : i.status === 'em_reforma' ? ' 🟡' : ' 🔴';
      return `<option value="${i.id}"${i.id === selected?.imovelId ? ' selected' : ''}>${i.apelido}${stLabel}</option>`;
    }))
    .join('');

  // Garantia
  $('contrato-garantia').innerHTML = ['<option value="">— Sem garantia (atípico) —</option>']
    .concat(garantias.filter(g => g.status !== 'encerrada').map(g => {
      return `<option value="${g.id}"${g.id === selected?.garantiaId ? ' selected' : ''}>${garantiaIdentificacao(g)} (${GARANTIA_TIPO_LABEL[g.tipo] || g.tipo})</option>`;
    }))
    .join('');
}

function onContratoImovelChange() {
  const imovelId = $('contrato-imovel').value;
  const info = $('contrato-imovel-info');
  if (!imovelId) { info.style.display = 'none'; return; }

  const imovel = (_imoveisCache || []).find(i => i.id === imovelId);
  if (!imovel) { info.style.display = 'none'; return; }

  // Auto-preenche locador se o imóvel já tem um (e o select estiver vazio ou diferente)
  if (imovel.locadorId) {
    $('contrato-locador').value = imovel.locadorId;
  }

  // Auto-preenche valor de aluguel se vazio
  const aluguelInput = $('contrato-aluguel');
  if (!aluguelInput.value && imovel.aluguelSugerido) {
    aluguelInput.value = imovel.aluguelSugerido;
    onContratoAluguelChange();
  }

  // Mostra info do imóvel
  const end = imovel.endereco || {};
  const endStr = [end.logradouro, end.numero, end.bairro, end.cidade, end.uf].filter(Boolean).join(', ');
  const statusLabel = IMOVEL_STATUS_LABEL[imovel.status] || imovel.status;
  info.style.display = 'block';
  info.textContent = `${endStr || 'sem endereço'} · ${statusLabel}`;
  info.style.color = imovel.status === 'alugado' ? 'var(--warning)' : 'var(--text-muted)';
}

function onContratoPrazoOrInicioChange() {
  const inicio = $('contrato-inicio').value;
  const prazo = $('contrato-prazo').value;
  const fimAtual = $('contrato-fim').value;
  const fimCalc = calcDataFim(inicio, prazo);
  // só sobrescreve se o user não editou manualmente (vazio ou igual ao cálculo antigo)
  if (!fimAtual || fimAtual === calcDataFim(inicio, parseInt(prazo, 10) - 1) || fimAtual === calcDataFim(inicio, parseInt(prazo, 10) + 1)) {
    $('contrato-fim').value = fimCalc;
  } else if (!fimAtual) {
    $('contrato-fim').value = fimCalc;
  }
  if (!fimAtual) $('contrato-fim').value = fimCalc;
}

function onContratoAluguelChange() {
  const aluguel = parseFloat($('contrato-aluguel').value) || 0;
  const multaInput = $('contrato-multa');
  // Só auto-preenche multa se ela estiver vazia
  if (!multaInput.value || parseFloat(multaInput.value) === 0) {
    multaInput.value = (aluguel * 3).toFixed(2);
  }
  $('contrato-multa-info').textContent = `Sugerido: 3× o aluguel = ${fmtBRL(aluguel * 3)}`;
}

async function openContratoModal(id) {
  clearAlert('contrato-alert');

  $('contrato-id').value = id || '';
  $('modal-contrato-title').textContent = id ? 'Editar Contrato' : 'Novo Contrato';
  $('btn-delete-contrato').style.display = id ? 'inline-block' : 'none';
  $('btn-gerar-contrato').style.display = id ? 'inline-block' : 'none';

  // Limpar
  ['contrato-inicio', 'contrato-fim', 'contrato-aluguel', 'contrato-multa',
   'contrato-clausulas', 'contrato-obs', 'contrato-motivo-status'].forEach(f => $(f).value = '');
  $('contrato-status').value = 'rascunho';
  $('contrato-prazo').value = '30';
  $('contrato-vencimento').value = '5';
  $('contrato-taxa-adm').value = '10';
  $('contrato-reajuste-indice').value = 'ipca';
  $('contrato-reajuste-periodicidade').value = 'anual';
  $('contrato-primeiro-aluguel-escritorio').checked = false;
  $('contrato-imovel-info').style.display = 'none';
  $('contrato-locatario-info').style.display = 'none';
  $('contrato-multa-info').textContent = 'Sugerido: 3× o aluguel';

  // Invalida caches pra pegar entidades atualizadas
  invalidateLocadoresCache();
  invalidateLocatariosCache();
  invalidateImoveisCache();
  invalidateGarantiasCache();

  let selected = null;
  if (id) {
    try {
      const snap = await tenantPath().collection('contratos').doc(id).get();
      if (snap.exists) {
        const c = snap.data();
        selected = {
          locadorId: c.locadorId,
          locatarioId: c.locatarioId,
          imovelId: c.imovelId,
          garantiaId: c.garantiaId,
        };
        $('contrato-status').value = c.status || 'rascunho';
        $('contrato-motivo-status').value = c.motivoStatus || '';
        $('contrato-prazo').value = c.prazoMeses ?? '30';
        $('contrato-inicio').value = c.inicio || '';
        $('contrato-fim').value = c.fim || '';
        $('contrato-aluguel').value = c.aluguel ?? '';
        $('contrato-vencimento').value = c.diaVencimento ?? 5;
        $('contrato-taxa-adm').value = c.taxaAdm ?? 10;
        $('contrato-multa').value = c.multaRescisoria ?? '';
        $('contrato-reajuste-indice').value = c.reajusteIndice || 'ipca';
        $('contrato-reajuste-periodicidade').value = c.reajustePeriodicidade || 'anual';
        $('contrato-primeiro-aluguel-escritorio').checked = !!c.primeiroAluguelEscritorio;
        $('contrato-clausulas').value = c.clausulas || '';
        $('contrato-obs').value = c.obs || '';
      }
    } catch (err) {
      console.error('Erro ao carregar contrato:', err);
      showAlert('contrato-alert', 'Erro ao carregar dados: ' + err.message);
    }
    $('contrato-docs-section').style.display = 'block';
    loadContratoDocs(id);
  } else {
    $('contrato-docs-section').style.display = 'none';
  }

  await populateContratoSelects(selected);
  onContratoImovelChange();
  onContratoAluguelChange();

  $('modal-contrato').style.display = 'flex';
}

function closeContratoModal() {
  $('modal-contrato').style.display = 'none';
}

async function saveContrato() {
  clearAlert('contrato-alert');

  const id = $('contrato-id').value;
  const imovelId = $('contrato-imovel').value;
  const locadorId = $('contrato-locador').value;
  const locatarioId = $('contrato-locatario').value;
  const inicio = $('contrato-inicio').value;
  const aluguel = parseFloat($('contrato-aluguel').value);
  const status = $('contrato-status').value;

  // Validações
  if (!imovelId) { showAlert('contrato-alert', 'Selecione o imóvel.'); return; }
  if (!locadorId) { showAlert('contrato-alert', 'Selecione o locador.'); return; }
  if (!locatarioId) { showAlert('contrato-alert', 'Selecione o locatário.'); return; }
  if (!inicio) { showAlert('contrato-alert', 'Data de início é obrigatória.'); return; }
  if (!aluguel || aluguel <= 0) { showAlert('contrato-alert', 'Aluguel mensal é obrigatório.'); return; }

  // Lê status anterior do imóvel pra decidir se libera/ocupa
  let statusImovelAnterior = null;
  if (id) {
    try {
      const prev = await tenantPath().collection('contratos').doc(id).get();
      if (prev.exists) statusImovelAnterior = prev.data().status;
    } catch (_) {}
  }

  const data = {
    status,
    motivoStatus: $('contrato-motivo-status').value.trim() || null,
    imovelId,
    locadorId,
    locatarioId,
    garantiaId: $('contrato-garantia').value || null,
    prazoMeses: parseInt($('contrato-prazo').value, 10),
    inicio,
    fim: $('contrato-fim').value || null,
    aluguel,
    diaVencimento: parseInt($('contrato-vencimento').value, 10) || 5,
    taxaAdm: parseFloat($('contrato-taxa-adm').value) || 10,
    multaRescisoria: parseFloat($('contrato-multa').value) || (aluguel * 3),
    reajusteIndice: $('contrato-reajuste-indice').value,
    reajustePeriodicidade: $('contrato-reajuste-periodicidade').value,
    primeiroAluguelEscritorio: $('contrato-primeiro-aluguel-escritorio').checked,
    clausulas: $('contrato-clausulas').value.trim() || null,
    obs: $('contrato-obs').value.trim() || null,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  };

  const btn = $('btn-save-contrato');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  try {
    let contratoId = id;
    if (id) {
      await tenantPath().collection('contratos').doc(id).update(data);
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('contratos').add(data);
      contratoId = docRef.id;
    }

    // Sincroniza status do imóvel
    await syncImovelStatusFromContrato(imovelId, status, statusImovelAnterior);
    invalidateImoveisCache();

    if (!id) {
      btn.disabled = false;
      btn.textContent = 'Salvar';
      await openContratoModal(contratoId);
      showAlert('contrato-alert', 'Contrato criado. Agora você pode anexar documentos.', 'success');
      loadContratos();
      return;
    }
    closeContratoModal();
    loadContratos();
  } catch (err) {
    console.error('Erro ao salvar contrato:', err);
    showAlert('contrato-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

// Atualiza imovel.status conforme o contrato muda de estado.
async function syncImovelStatusFromContrato(imovelId, statusNovo, statusAnterior) {
  if (!imovelId) return;
  const imovelRef = tenantPath().collection('imoveis').doc(imovelId);
  if (statusNovo === 'vigente') {
    await imovelRef.update({ status: 'alugado' });
  } else if ((statusNovo === 'encerrado' || statusNovo === 'rescindido') && statusAnterior === 'vigente') {
    await imovelRef.update({ status: 'disponivel' });
  }
}

async function deleteContrato() {
  const id = $('contrato-id').value;
  if (!id) return;
  if (!confirm('Excluir este contrato? Os documentos anexados também serão removidos. Esta ação não pode ser desfeita.')) return;

  try {
    // Liberar imóvel se contrato vigente
    const snap = await tenantPath().collection('contratos').doc(id).get();
    if (snap.exists) {
      const c = snap.data();
      if (c.status === 'vigente' && c.imovelId) {
        await tenantPath().collection('imoveis').doc(c.imovelId).update({ status: 'disponivel' });
        invalidateImoveisCache();
      }
    }

    // Apagar docs do Storage
    const folderRef = storageTenantRef().child(`contratos/${id}`);
    try {
      const list = await folderRef.listAll();
      await Promise.all(list.items.map(item => item.delete()));
    } catch (_) {}

    await tenantPath().collection('contratos').doc(id).delete();
    closeContratoModal();
    loadContratos();
  } catch (err) {
    console.error('Erro ao excluir:', err);
    showAlert('contrato-alert', 'Erro: ' + err.message);
  }
}

async function loadContratoDocs(contratoId) {
  const container = $('contrato-docs-list');
  container.innerHTML = `<p class="empty">Carregando documentos…</p>`;

  try {
    const folderRef = storageTenantRef().child(`contratos/${contratoId}`);
    const list = await folderRef.listAll();

    if (list.items.length === 0) {
      container.innerHTML = `<p class="empty">Nenhum documento anexado.</p>`;
      return;
    }

    const items = await Promise.all(list.items.map(async (item) => {
      const meta = await item.getMetadata();
      const url = await item.getDownloadURL();
      const ext = (item.name.split('.').pop() || '').toLowerCase();
      const icon = (ext === 'pdf') ? '📄' : (['jpg','jpeg','png'].includes(ext) ? '🖼' : '📎');
      const sizeKb = (meta.size / 1024).toFixed(0);
      const date = new Date(meta.timeCreated).toLocaleDateString('pt-BR');
      return `
        <div class="doc-item">
          <span class="doc-icon">${icon}</span>
          <span class="doc-name">${item.name}</span>
          <span class="doc-meta">${sizeKb} KB · ${date}</span>
          <div class="doc-actions">
            <a class="btn-icon" href="${url}" target="_blank" title="Abrir">👁</a>
            <a class="btn-icon" href="${url}" download="${item.name}" title="Baixar">⬇</a>
            <button class="btn-icon btn-icon-danger" onclick="deleteContratoDoc('${contratoId}','${item.name}')" title="Excluir">🗑</button>
          </div>
        </div>
      `;
    }));
    container.innerHTML = items.join('');
  } catch (err) {
    console.error('Erro ao listar docs:', err);
    container.innerHTML = `<p class="empty" style="color:var(--danger);">Erro: ${err.message}</p>`;
  }
}

async function uploadContratoDocs() {
  const contratoId = $('contrato-id').value;
  if (!contratoId) {
    showAlert('contrato-alert', 'Salve o contrato antes de anexar documentos.');
    return;
  }

  const input = $('contrato-doc-input');
  const files = Array.from(input.files || []);
  if (files.length === 0) {
    showAlert('contrato-alert', 'Selecione ao menos um arquivo.');
    return;
  }

  const tooBig = files.find(f => f.size > 10 * 1024 * 1024);
  if (tooBig) {
    showAlert('contrato-alert', `Arquivo "${tooBig.name}" excede 10MB.`);
    return;
  }

  const folderRef = storageTenantRef().child(`contratos/${contratoId}`);
  try {
    for (const file of files) {
      await folderRef.child(file.name).put(file, {
        contentType: file.type,
        customMetadata: { uploadedBy: State.user.uid },
      });
    }
    input.value = '';
    showAlert('contrato-alert', `${files.length} arquivo(s) enviado(s).`, 'success');
    loadContratoDocs(contratoId);
  } catch (err) {
    console.error('Erro no upload:', err);
    showAlert('contrato-alert', 'Erro: ' + err.message);
  }
}

async function deleteContratoDoc(contratoId, filename) {
  if (!confirm(`Excluir o arquivo "${filename}"?`)) return;
  try {
    await storageTenantRef().child(`contratos/${contratoId}/${filename}`).delete();
    loadContratoDocs(contratoId);
  } catch (err) {
    console.error('Erro ao excluir doc:', err);
    showAlert('contrato-alert', 'Erro: ' + err.message);
  }
}

// =============================================================
// GERADOR DE CONTRATO (locação) — mescla template + dados
// =============================================================

function fmtDataExtenso(d) {
  const meses = ['janeiro','fevereiro','março','abril','maio','junho',
                 'julho','agosto','setembro','outubro','novembro','dezembro'];
  const dt = d instanceof Date ? d : new Date();
  return `${dt.getDate()} de ${meses[dt.getMonth()]} de ${dt.getFullYear()}`;
}

function formatEnderecoCompleto(end) {
  if (!end) return '—';
  const parts = [];
  if (end.logradouro) parts.push(end.logradouro);
  if (end.numero) parts.push('nº ' + end.numero);
  if (end.complemento) parts.push(end.complemento);
  if (end.bairro) parts.push('Bairro ' + end.bairro);
  if (end.cidade && end.uf) parts.push(end.cidade + '/' + end.uf);
  if (end.cep) parts.push('CEP ' + maskCEP(end.cep));
  return parts.length ? parts.join(', ') : '—';
}

function descricaoGarantia(g) {
  if (!g || !g.tipo) return 'Sem garantia';
  if (g.tipo === 'fiador' && g.fiador) {
    return `Fiador: ${g.fiador.nome || '—'} (CPF ${g.fiador.cpf ? maskCPF(g.fiador.cpf) : '—'})`;
  }
  if (g.tipo === 'caucao' && g.caucao) {
    return `Caução em ${g.caucao.modalidade} no valor de ${fmtBRL(g.caucao.valor)}`;
  }
  if (g.tipo === 'seguro_fianca' && g.seguro) {
    return `Seguro fiança ${g.seguro.seguradora}, apólice ${g.seguro.apolice}, cobertura de ${fmtBRL(g.seguro.cobertura)}`;
  }
  return 'Não especificada';
}

// Substitui {{var.subvar}} no template usando o objeto de dados.
// Se a chave não existe, mantém o {{...}} pra revelar o problema ao usuário.
function mergeTemplate(template, dados) {
  return (template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, path) => {
    const parts = path.split('.');
    let val = dados;
    for (const p of parts) {
      if (val == null) return m;
      val = val[p];
    }
    return (val == null) ? m : String(val);
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// Converte texto puro com quebras de linha em HTML formatado (parágrafos)
function textToHtml(text) {
  if (!text) return '';
  const safe = escapeHtml(text);
  return safe.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

let _contratoHtmlCache = '';

async function gerarContratoLocacao() {
  const contratoId = $('contrato-id').value;
  if (!contratoId) {
    showAlert('contrato-alert', 'Salve o contrato antes de gerar.');
    return;
  }

  try {
    const cSnap = await tenantPath().collection('contratos').doc(contratoId).get();
    if (!cSnap.exists) { showAlert('contrato-alert', 'Contrato não encontrado.'); return; }
    const c = cSnap.data();

    const [locadorSnap, locatarioSnap, imovelSnap, garantiaSnap, configSnap] = await Promise.all([
      c.locadorId   ? tenantPath().collection('locadores').doc(c.locadorId).get()   : Promise.resolve(null),
      c.locatarioId ? tenantPath().collection('locatarios').doc(c.locatarioId).get() : Promise.resolve(null),
      c.imovelId    ? tenantPath().collection('imoveis').doc(c.imovelId).get()    : Promise.resolve(null),
      c.garantiaId  ? tenantPath().collection('garantias').doc(c.garantiaId).get()  : Promise.resolve(null),
      tenantPath().collection('config').doc('site').get(),
    ]);

    const locador = (locadorSnap && locadorSnap.exists) ? locadorSnap.data() : {};
    const locatario = (locatarioSnap && locatarioSnap.exists) ? locatarioSnap.data() : {};
    const imovel = (imovelSnap && imovelSnap.exists) ? imovelSnap.data() : {};
    const garantia = (garantiaSnap && garantiaSnap.exists) ? garantiaSnap.data() : {};
    const cfg = configSnap.exists ? configSnap.data() : {};

    const template = cfg.templateLocacao || '(Configure o template em Configurações)';

    const dados = {
      tenant: { nome: State.tenant.nome, cnpj: State.tenant.cnpj ? maskCNPJ(State.tenant.cnpj) : '—', creci: State.tenant.creci || '—' },
      locador: {
        nome: locador.nome || '—',
        documento: locador.documento ? (locador.tipo === 'PJ' ? maskCNPJ(locador.documento) : maskCPF(locador.documento)) : '—',
        rg: locador.rg || '—',
        nascimento: locador.nascimento ? fmtDataBR(locador.nascimento) : '—',
        estadoCivil: locador.estadoCivil || '—',
        profissao: locador.profissao || '—',
        nacionalidade: locador.nacionalidade || '—',
        email: locador.email || '—',
        telefone: locador.telefone ? maskTelefone(locador.telefone) : '—',
        enderecoCompleto: formatEnderecoCompleto(locador.endereco),
      },
      locatario: {
        nome: locatario.nome || '—',
        documento: locatario.documento ? (locatario.tipo === 'PJ' ? maskCNPJ(locatario.documento) : maskCPF(locatario.documento)) : '—',
        rg: locatario.rg || '—',
        nascimento: locatario.nascimento ? fmtDataBR(locatario.nascimento) : '—',
        estadoCivil: locatario.estadoCivil || '—',
        profissao: locatario.profissao || '—',
        nacionalidade: locatario.nacionalidade || '—',
        email: locatario.email || '—',
        telefone: locatario.telefone ? maskTelefone(locatario.telefone) : '—',
        enderecoCompleto: formatEnderecoCompleto(locatario.endereco),
        renda: fmtBRL(locatario.renda),
      },
      imovel: {
        apelido: imovel.apelido || '—',
        tipo: imovel.tipo || '—',
        subtipo: imovel.subtipo || '—',
        matricula: imovel.matricula || '—',
        iptu: imovel.iptu || '—',
        areaUtil: imovel.areaUtil ? imovel.areaUtil + ' m²' : '—',
        areaTotal: imovel.areaTotal ? imovel.areaTotal + ' m²' : '—',
        enderecoCompleto: formatEnderecoCompleto(imovel.endereco),
      },
      contrato: {
        aluguel: fmtBRL(c.aluguel),
        prazo: c.prazoMeses,
        inicio: c.inicio ? fmtDataBR(c.inicio) : '—',
        fim: c.fim ? fmtDataBR(c.fim) : '—',
        diaVencimento: c.diaVencimento,
        taxaAdm: (c.taxaAdm ?? '—') + '%',
        multa: fmtBRL(c.multaRescisoria),
        reajusteIndice: ({ ipca: 'IPCA', igpm: 'IGP-M', inpc: 'INPC', sem: 'sem reajuste' }[c.reajusteIndice] || '—'),
        reajustePeriodicidade: ({ anual: 'anual', bienal: 'bienal', sem: 'sem reajuste' }[c.reajustePeriodicidade] || '—'),
      },
      garantia: { descricao: descricaoGarantia(garantia) },
    };

    const conteudoMerged = mergeTemplate(template, dados);
    const html = buildContratoHtml('LOCAÇÃO DE IMÓVEL', dados, conteudoMerged, c.clausulas, locador.nome, locatario.nome);

    _contratoHtmlCache = html;
    $('contrato-preview-content').innerHTML = html;
    $('modal-contrato-preview-title').textContent = 'Preview do contrato de locação';
    $('modal-contrato-preview').style.display = 'flex';
  } catch (err) {
    console.error('Erro ao gerar contrato:', err);
    showAlert('contrato-alert', 'Erro: ' + err.message);
  }
}

function buildContratoHtml(titulo, dados, conteudoMerged, clausulasExtras, parteA, parteB) {
  const tenant = dados.tenant || {};
  const cidadeImovel = (dados.imovel.enderecoCompleto || '').split(',').slice(-2, -1).join(',').trim() || '—';

  return `
    <div class="contrato-header">
      <h1>CONTRATO DE ${titulo.toUpperCase()}</h1>
      <p class="contrato-empresa">${escapeHtml(tenant.nome || 'DRG-Rently')}</p>
      ${tenant.cnpj && tenant.cnpj !== '—' ? `<p class="contrato-empresa-sub">CNPJ ${escapeHtml(tenant.cnpj)}${tenant.creci && tenant.creci !== '—' ? ' · CRECI ' + escapeHtml(tenant.creci) : ''}</p>` : ''}
    </div>

    <div class="contrato-conteudo">
      ${textToHtml(conteudoMerged)}
    </div>

    ${clausulasExtras ? `
      <div class="contrato-conteudo">
        <h3>CLÁUSULAS PARTICULARES</h3>
        ${textToHtml(clausulasExtras)}
      </div>
    ` : ''}

    <div class="contrato-rodape">
      <p>${escapeHtml(cidadeImovel)}, ${fmtDataExtenso()}.</p>
      <div class="contrato-assinaturas">
        <div class="assinatura">
          <div class="assinatura-linha"></div>
          <strong>${escapeHtml(parteA || '—')}</strong><br>
          <span>${escapeHtml(titulo === 'LOCAÇÃO DE IMÓVEL' ? 'LOCADOR' : 'VENDEDOR')}</span>
        </div>
        <div class="assinatura">
          <div class="assinatura-linha"></div>
          <strong>${escapeHtml(parteB || '—')}</strong><br>
          <span>${escapeHtml(titulo === 'LOCAÇÃO DE IMÓVEL' ? 'LOCATÁRIO' : 'COMPRADOR')}</span>
        </div>
      </div>
      <div class="contrato-testemunhas">
        <p><strong>Testemunhas:</strong></p>
        <div class="contrato-assinaturas">
          <div class="assinatura">
            <div class="assinatura-linha"></div>
            <span>Nome / CPF</span>
          </div>
          <div class="assinatura">
            <div class="assinatura-linha"></div>
            <span>Nome / CPF</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function closeContratoPreview() {
  $('modal-contrato-preview').style.display = 'none';
}

function printContrato() {
  const win = window.open('', '_blank', 'width=900,height=900');
  if (!win) { alert('Bloqueador de popup impediu a impressão. Permita popups para este site.'); return; }
  win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Contrato</title>
  <style>
    body { font-family: 'Times New Roman', Georgia, serif; font-size: 12pt; line-height: 1.7; color: #000; max-width: 210mm; margin: 0 auto; padding: 20mm; }
    .contrato-header { text-align: center; margin-bottom: 30pt; }
    .contrato-header h1 { font-size: 16pt; margin-bottom: 8pt; }
    .contrato-empresa { font-weight: bold; margin: 0; }
    .contrato-empresa-sub { font-size: 10pt; margin-top: 2pt; }
    .contrato-conteudo { margin-bottom: 20pt; }
    .contrato-conteudo h3 { font-size: 13pt; margin: 20pt 0 10pt; }
    .contrato-conteudo p { margin: 8pt 0; text-align: justify; }
    .contrato-rodape { margin-top: 40pt; }
    .contrato-assinaturas { display: flex; gap: 40pt; margin: 50pt 0 30pt; }
    .assinatura { flex: 1; text-align: center; }
    .assinatura-linha { border-top: 1pt solid #000; margin-bottom: 6pt; }
    .assinatura strong { display: block; }
    .assinatura span { font-size: 10pt; color: #555; }
    .contrato-testemunhas { margin-top: 30pt; }
    .contrato-testemunhas p { margin-bottom: 0; }
    @page { margin: 20mm; }
  </style>
</head>
<body>${_contratoHtmlCache}</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { try { win.print(); } catch (_) {} }, 400);
}

function downloadContratoWord() {
  const filename = `Contrato_${new Date().toISOString().slice(0,10)}.doc`;
  const html = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office'
      xmlns:w='urn:schemas-microsoft-com:office:word'
      xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset='utf-8'>
  <title>Contrato</title>
  <!--[if gte mso 9]>
  <xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml>
  <![endif]-->
  <style>
    body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.7; }
    h1 { text-align: center; font-size: 16pt; }
    h3 { font-size: 13pt; }
    .contrato-header { text-align: center; margin-bottom: 24pt; }
    .contrato-assinaturas { margin-top: 40pt; }
    .assinatura { text-align: center; margin: 20pt 0; }
    .assinatura-linha { border-top: 1pt solid #000; margin-bottom: 4pt; width: 60%; margin-left: 20%; }
    p { text-align: justify; }
  </style>
</head>
<body>${_contratoHtmlCache}</body>
</html>`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function copyContratoTexto() {
  const tmp = document.createElement('div');
  tmp.innerHTML = _contratoHtmlCache;
  const text = (tmp.textContent || tmp.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  navigator.clipboard.writeText(text).then(() => {
    showAlert('contrato-alert', 'Texto do contrato copiado!', 'success');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showAlert('contrato-alert', 'Texto do contrato copiado!', 'success');
  });
}

// =============================================================
// Init
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
  $('btn-login').addEventListener('click', doLogin);
  $('btn-signup').addEventListener('click', doSignupTenant);
  $('btn-logout').addEventListener('click', doLogout);
  $('link-show-signup').addEventListener('click', () => {
    clearAlert('signup-alert');
    showScreen('screen-signup');
  });
  $('link-show-login').addEventListener('click', () => {
    clearAlert('login-alert');
    showScreen('screen-login');
  });

  document.querySelectorAll('.nav-link').forEach(el => {
    el.addEventListener('click', () => showSection(el.dataset.section));
  });

  ['login-email', 'login-senha'].forEach(id => {
    $(id).addEventListener('keypress', (e) => { if (e.key === 'Enter') doLogin(); });
  });

  // Máscaras de entrada (Locador)
  bindMask('locador-documento', (v) => $('locador-tipo').value === 'PJ' ? maskCNPJ(v) : maskCPF(v));
  bindMask('locador-telefone', maskTelefone);
  bindMask('locador-cep', maskCEP);

  // Validação em tempo real do CPF/CNPJ + busca BrasilAPI ao sair (CNPJ)
  $('locador-documento').addEventListener('input', onLocadorDocumentoInput);
  $('locador-documento').addEventListener('blur', onLocadorDocumentoBlur);

  // Máscaras e validação — Locatário
  bindMask('locatario-documento', (v) => $('locatario-tipo').value === 'PJ' ? maskCNPJ(v) : maskCPF(v));
  bindMask('locatario-telefone', maskTelefone);
  bindMask('locatario-cep', maskCEP);
  $('locatario-documento').addEventListener('input', onLocatarioDocumentoInput);
  $('locatario-documento').addEventListener('blur', onLocatarioDocumentoBlur);

  // Máscaras e validação — Garantia (fiador)
  bindMask('garantia-fiador-cpf', maskCPF);
  bindMask('garantia-fiador-conjuge-cpf', maskCPF);
  bindMask('garantia-fiador-telefone', maskTelefone);
  bindMask('garantia-fiador-cep', maskCEP);
  $('garantia-fiador-cpf').addEventListener('input', onGarantiaFiadorCPFInput);
  $('garantia-fiador-conjuge-cpf').addEventListener('input', onGarantiaConjugeCPFInput);

  // Máscara — Imóvel
  bindMask('imovel-cep', maskCEP);

  // Máscaras e validação — Comprador
  bindMask('comprador-documento', (v) => $('comprador-tipo').value === 'PJ' ? maskCNPJ(v) : maskCPF(v));
  bindMask('comprador-telefone', maskTelefone);
  bindMask('comprador-cep', maskCEP);
  $('comprador-documento').addEventListener('input', onCompradorDocumentoInput);
  $('comprador-documento').addEventListener('blur', onCompradorDocumentoBlur);

  // Máscara — Configurações
  bindMask('cfg-telefone', maskTelefone);
});
