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

  if (name === 'superadmin' && State.isSuperAdmin) {
    loadTenantsTable();
  }
  if (name === 'locadores' && State.tenant) {
    loadLocadores();
  }
  if (name === 'configuracoes' && State.tenant) {
    $('cfg-razao').value = State.tenant.nome || '';
    $('cfg-cnpj').value = State.tenant.cnpj || '';
    $('cfg-creci').value = State.tenant.creci || '';
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
      await openLocadorModal(docRef.id);
      showAlert('locador-alert', 'Locador criado. Agora você pode anexar documentos.', 'success');
      loadLocadores();
      return;
    }
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
});
