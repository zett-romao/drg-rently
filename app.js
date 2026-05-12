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
  if (name === 'garantias' && State.tenant) {
    loadGarantias();
  }
  if (name === 'imoveis' && State.tenant) {
    loadImoveis();
  }
  if (name === 'contratos' && State.tenant) {
    loadContratos();
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
// DASHBOARD — contagens das entidades principais
// =============================================================

async function loadDashboard() {
  const ids = ['stat-locadores', 'stat-locatarios', 'stat-imoveis-alugados',
               'stat-imoveis-disponiveis', 'stat-contratos-vigentes', 'stat-garantias-ativas'];
  ids.forEach(id => { const el = $(id); if (el) el.textContent = '…'; });

  if (!State.tenant) return;

  try {
    const [locadoresSnap, locatariosSnap, imoveisSnap, contratosSnap, garantiasSnap] = await Promise.all([
      tenantPath().collection('locadores').get(),
      tenantPath().collection('locatarios').get(),
      tenantPath().collection('imoveis').get(),
      tenantPath().collection('contratos').get(),
      tenantPath().collection('garantias').get(),
    ]);

    const imoveisAlugados = imoveisSnap.docs.filter(d => d.data().status === 'alugado').length;
    const imoveisDisponiveis = imoveisSnap.docs.filter(d => d.data().status === 'disponivel').length;
    const contratosVigentes = contratosSnap.docs.filter(d => d.data().status === 'vigente').length;
    const garantiasAtivas = garantiasSnap.docs.filter(d => (d.data().status || 'ativa') === 'ativa').length;

    $('stat-locadores').textContent = locadoresSnap.size;
    $('stat-locatarios').textContent = locatariosSnap.size;
    $('stat-imoveis-alugados').textContent = imoveisAlugados;
    $('stat-imoveis-disponiveis').textContent = imoveisDisponiveis;
    $('stat-contratos-vigentes').textContent = contratosVigentes;
    $('stat-garantias-ativas').textContent = garantiasAtivas;
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
  } catch (err) {
    console.warn('Sem config de site ainda:', err);
    $('cfg-watermark-default').checked = true;
    $('cfg-template-locacao').value = '';
    $('cfg-template-venda').value = '';
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

  // Máscara — Configurações
  bindMask('cfg-telefone', maskTelefone);
});
