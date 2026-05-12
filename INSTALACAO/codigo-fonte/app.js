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
  userModulos: null,   // array de módulos permitidos (se perfil customizado)
  tenantOriginal: null, // backup do tenant quando super-admin atua como outro
};

// Lista de módulos disponíveis pra perfis customizados
const MODULOS_DISPONIVEIS = [
  { id: 'dashboard',     label: 'Dashboard',     grupo: 'Visão Geral' },
  { id: 'alertas',       label: 'Alertas',       grupo: 'Visão Geral' },
  { id: 'relatorios',    label: 'Relatórios',    grupo: 'Visão Geral' },
  { id: 'locadores',     label: 'Locadores',     grupo: 'Cadastros' },
  { id: 'locatarios',    label: 'Locatários',    grupo: 'Cadastros' },
  { id: 'compradores',   label: 'Compradores',   grupo: 'Cadastros' },
  { id: 'garantias',     label: 'Garantias',     grupo: 'Cadastros' },
  { id: 'imoveis',       label: 'Imóveis',       grupo: 'Cadastros' },
  { id: 'contratos',     label: 'Contratos',     grupo: 'Operação' },
  { id: 'negociacoes',   label: 'Negociações',   grupo: 'Operação' },
  { id: 'balancetes',    label: 'Balancetes',    grupo: 'Operação' },
  { id: 'vitrine',       label: 'Vitrine pública (abrir)', grupo: 'Operação' },
  { id: 'portais',       label: 'Portais imobiliários',    grupo: 'Operação' },
  { id: 'auditoria',     label: 'Auditoria',     grupo: 'Administração' },
  { id: 'importacao',    label: 'Importação CSV', grupo: 'Administração' },
  { id: 'configuracoes', label: 'Configurações', grupo: 'Administração' },
];

// Default de operadores (sem perfil customizado)
const OPERADOR_DEFAULT_MODULOS = [
  'dashboard','alertas','relatorios',
  'locadores','locatarios','compradores','garantias','imoveis',
  'contratos','negociacoes','balancetes','vitrine','portais'
];

// Pacotes pré-definidos de módulos habilitados pro tenant
// (define o que o tenant pode acessar — depois filtrado pelo perfil do operador)
const TENANT_PACOTES = {
  locacao: {
    label: '🏠 Locação',
    desc: 'Apenas o módulo de locação (sem vendas)',
    modulos: [
      'dashboard','alertas','relatorios',
      'locadores','locatarios','garantias','imoveis',
      'contratos','balancetes',
      'vitrine','portais',
      'auditoria','importacao','configuracoes'
    ],
  },
  venda: {
    label: '💼 Venda',
    desc: 'Apenas o módulo de venda (sem locações)',
    modulos: [
      'dashboard','alertas','relatorios',
      'compradores','imoveis',
      'negociacoes',
      'vitrine','portais',
      'auditoria','importacao','configuracoes'
    ],
  },
  completo: {
    label: '🌟 Completo (Locação + Venda)',
    desc: 'Acesso a todos os módulos do sistema',
    modulos: [
      'dashboard','alertas','relatorios',
      'locadores','locatarios','compradores','garantias','imoveis',
      'contratos','negociacoes','balancetes',
      'vitrine','portais',
      'auditoria','importacao','configuracoes'
    ],
  },
  custom: {
    label: '⚙️ Customizado',
    desc: 'Selecione manualmente os módulos abaixo',
    modulos: null, // marcado manualmente
  },
};

// Áreas administrativas DRG (Super Admin / Operador DRG)
// Usadas pra perfis customizáveis da equipe DRG (D.R. Global)
const MODULOS_DRG = [
  { id: 'drg_dashboard',          label: 'Dashboard / KPIs',           grupo: 'Visão Geral' },
  { id: 'drg_tenants_view',       label: 'Ver imobiliárias clientes',  grupo: 'Imobiliárias' },
  { id: 'drg_tenants_edit',       label: 'Editar plano e módulos',     grupo: 'Imobiliárias' },
  { id: 'drg_tenants_pagamentos', label: 'Gerenciar pagamentos',       grupo: 'Imobiliárias' },
  { id: 'drg_tenants_atuar_como', label: 'Atuar como cliente',         grupo: 'Imobiliárias' },
  { id: 'drg_equipe',             label: 'Gerenciar equipe DRG',       grupo: 'Administração' },
];

// Default de operadores DRG sem perfil customizado (só vê e não edita)
const OPERADOR_DRG_DEFAULT_MODULOS = [
  'drg_dashboard', 'drg_tenants_view'
];

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
    // Equipe DRG (interna): super_admin OU operador_drg
    State.isSuperAdmin = State.userDoc.role === 'super_admin' || State.userDoc.role === 'operador_drg';
    State.isDRGMaster = State.userDoc.role === 'super_admin'; // só super_admin pode gerenciar a própria equipe DRG

    // Conta desativada (operadores desativados pelo admin)
    if (State.userDoc.ativo === false) {
      await auth.signOut();
      showAlert('login-alert', 'Sua conta foi desativada. Contate o administrador da imobiliária.');
      return;
    }

    // Carrega perfil DRG (operador_drg com permissões customizáveis)
    State.userDrgModulos = null;
    if (State.userDoc.role === 'operador_drg' && State.userDoc.drgPerfilId) {
      try {
        const pSnap = await db.collection('drgPerfis').doc(State.userDoc.drgPerfilId).get();
        if (pSnap.exists) {
          State.userDrgModulos = pSnap.data().modulos || [];
        }
      } catch (_) {}
    }

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

      // Se o usuário tem perfil customizado, carrega os módulos
      State.userModulos = null;
      if (State.userDoc.perfilId) {
        try {
          const pSnap = await tenantPath().collection('perfis').doc(State.userDoc.perfilId).get();
          if (pSnap.exists) {
            State.userModulos = pSnap.data().modulos || [];
          }
        } catch (_) {}
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
    // Log de login bem-sucedido (não bloqueia o fluxo se falhar)
    logAuditoria('login', 'sessao', user.uid, { email: user.email });
    // Telemetria pra Modelo C (self-hosted): só dispara se for instância em Firebase de outro projeto
    enviarTelemetria();

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
// Alterna entre PJ (imobiliária) e PF (corretor autônomo) no signup
function setTipoPessoaSignup(tipo) {
  $('signup-tipo-pessoa').value = tipo;

  // Atualiza botões ativos
  document.querySelectorAll('.tipo-pessoa-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tipo === tipo);
  });

  if (tipo === 'PF') {
    $('signup-title').textContent = 'Cadastro de Corretor Autônomo';
    $('signup-subtitle').textContent = 'Crie sua conta no DRG-Rently como pessoa física';
    $('signup-bloco-titulo').textContent = 'Seus dados profissionais';
    $('label-razao').textContent = 'Nome completo';
    $('signup-razao').placeholder = 'Ex: João da Silva Santos';
    $('label-doc').textContent = 'CPF';
    $('signup-cnpj').placeholder = '000.000.000-00';
    $('signup-cnpj').maxLength = 14;
  } else {
    $('signup-title').textContent = 'Cadastrar imobiliária';
    $('signup-subtitle').textContent = 'Crie a conta da sua empresa no DRG-Rently';
    $('signup-bloco-titulo').textContent = 'Dados da imobiliária';
    $('label-razao').textContent = 'Razão social';
    $('signup-razao').placeholder = 'Ex: Imobiliária Exemplo Ltda';
    $('label-doc').textContent = 'CNPJ';
    $('signup-cnpj').placeholder = '00.000.000/0000-00';
    $('signup-cnpj').maxLength = 18;
  }

  // Limpa o campo do documento ao trocar
  $('signup-cnpj').value = '';
}

function validaCPF(cpf) {
  cpf = String(cpf).replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  let soma = 0, resto;
  for (let i = 1; i <= 9; i++) soma += parseInt(cpf.charAt(i - 1)) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.charAt(9))) return false;
  soma = 0;
  for (let i = 1; i <= 10; i++) soma += parseInt(cpf.charAt(i - 1)) * (12 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  return resto === parseInt(cpf.charAt(10));
}

function validaCNPJ(cnpj) {
  cnpj = String(cnpj).replace(/\D/g, '');
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  let tamanho = cnpj.length - 2;
  let numeros = cnpj.substring(0, tamanho);
  const digitos = cnpj.substring(tamanho);
  let soma = 0, pos = tamanho - 7;
  for (let i = tamanho; i >= 1; i--) {
    soma += numeros.charAt(tamanho - i) * pos--;
    if (pos < 2) pos = 9;
  }
  let resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
  if (resultado !== parseInt(digitos.charAt(0))) return false;
  tamanho = tamanho + 1;
  numeros = cnpj.substring(0, tamanho);
  soma = 0; pos = tamanho - 7;
  for (let i = tamanho; i >= 1; i--) {
    soma += numeros.charAt(tamanho - i) * pos--;
    if (pos < 2) pos = 9;
  }
  resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
  return resultado === parseInt(digitos.charAt(1));
}

function formataCPF(v) {
  v = String(v).replace(/\D/g, '').slice(0, 11);
  return v.replace(/(\d{3})(\d)/, '$1.$2')
          .replace(/(\d{3})(\d)/, '$1.$2')
          .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function formataCNPJ(v) {
  v = String(v).replace(/\D/g, '').slice(0, 14);
  return v.replace(/(\d{2})(\d)/, '$1.$2')
          .replace(/(\d{3})(\d)/, '$1.$2')
          .replace(/(\d{3})(\d)/, '$1/$2')
          .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

async function doSignupTenant() {
  clearAlert('signup-alert');

  const tipoPessoa = $('signup-tipo-pessoa').value || 'PJ';
  const razao = $('signup-razao').value.trim();
  const docNum = $('signup-cnpj').value.trim();
  const creci = $('signup-creci').value.trim();
  const nome = $('signup-nome').value.trim();
  const email = $('signup-email').value.trim();
  const senha = $('signup-senha').value;
  const senha2 = $('signup-senha2').value;

  const docLabel = tipoPessoa === 'PF' ? 'CPF' : 'CNPJ';
  const razaoLabel = tipoPessoa === 'PF' ? 'Nome completo' : 'Razão social';

  if (!razao || !docNum || !nome || !email || !senha) {
    showAlert('signup-alert', 'Preencha todos os campos obrigatórios.');
    return;
  }

  // Valida CPF ou CNPJ
  const docDigits = docNum.replace(/\D/g, '');
  if (tipoPessoa === 'PF') {
    if (docDigits.length !== 11) {
      showAlert('signup-alert', 'CPF deve ter 11 dígitos.');
      return;
    }
    if (!validaCPF(docDigits)) {
      showAlert('signup-alert', 'CPF inválido. Confira os números.');
      return;
    }
  } else {
    if (docDigits.length !== 14) {
      showAlert('signup-alert', 'CNPJ deve ter 14 dígitos.');
      return;
    }
    if (!validaCNPJ(docDigits)) {
      showAlert('signup-alert', 'CNPJ inválido. Confira os números.');
      return;
    }
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

    const docFormatado = tipoPessoa === 'PF' ? formataCPF(docDigits) : formataCNPJ(docDigits);

    const tenantData = {
      nome: razao,
      tipoPessoa,           // 'PF' ou 'PJ'
      creci: creci || null,
      plano: 'trial',
      ativo: true,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      criadoPor: createdUid,
    };
    if (tipoPessoa === 'PF') {
      tenantData.cpf = docFormatado;
    } else {
      tenantData.cnpj = docFormatado;
    }

    const batch = db.batch();
    batch.set(tenantRef, tenantData);
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

// Exposição global pra onclick do botão funcionar
window.setTipoPessoaSignup = setTipoPessoaSignup;
// Multi-comprovante (chamadas via onclick no HTML)
window.lerMultiComprovantes = function() { return lerMultiComprovantes(); };
window.toggleMultiLancar = function(id, checked) { return toggleMultiLancar(id, checked); };
window.toggleVincularContrato = function(id, checked) { return toggleVincularContrato(id, checked); };
window.updateMultiCampo = function(id, campo, valor) { return updateMultiCampo(id, campo, valor); };
window.confirmarMultiComprovantes = function() { return confirmarMultiComprovantes(); };

// =============================================================
// Logout
// =============================================================
async function doLogout() {
  await auth.signOut();
}

// =============================================================
// Render do app principal
// =============================================================
function userPodeVerModulo(modulo) {
  // Super admin / operador DRG vê tudo (mas tem painel próprio)
  if (State.isSuperAdmin) return true;

  // Filtro 1: o tenant tem esse módulo habilitado no plano?
  // Se modulosHabilitados não existir (legacy), considera todos habilitados.
  if (State.tenant?.modulosHabilitados && Array.isArray(State.tenant.modulosHabilitados)) {
    if (!State.tenant.modulosHabilitados.includes(modulo)) return false;
  }

  // Filtro 2: o usuário tem permissão pelo seu perfil/role?
  if (State.userDoc?.role === 'admin') return true;
  if (State.userModulos && Array.isArray(State.userModulos)) {
    return State.userModulos.includes(modulo);
  }
  return OPERADOR_DEFAULT_MODULOS.includes(modulo);
}

// Permissão pra áreas do Super Admin (equipe DRG interna)
function userDRGPodeVerArea(area) {
  if (State.userDoc?.role === 'super_admin') return true;
  if (State.userDoc?.role === 'operador_drg') {
    if (State.userDrgModulos && Array.isArray(State.userDrgModulos)) {
      return State.userDrgModulos.includes(area);
    }
    return OPERADOR_DRG_DEFAULT_MODULOS.includes(area);
  }
  return false;
}

// Define a marca exibida no canto superior esquerdo do sidebar.
// Lógica:
// - Equipe DRG navegando seções administrativas do SaaS (superadmin) → "DRG-Systems / DevOps"
// - Equipe DRG sem tenant ativo ainda → "DRG-Systems / DevOps"
// - Em qualquer outro caso (tenant normal OU equipe DRG atuando como tenant) → "DRG-Rently / nome do tenant"
function aplicarMarcaContexto() {
  const brandTitle = $('brand-title');
  const brandSub = $('brand-tenant-name');
  if (!brandTitle || !brandSub) return;

  const navegandoPainelSaaS = State.isSuperAdmin && !State.tenantOriginal && State.currentSection === 'superadmin';
  const semTenantAtivo = State.isSuperAdmin && !State.tenantOriginal && !State.tenant;
  const modoSaaS = navegandoPainelSaaS || semTenantAtivo;

  if (modoSaaS) {
    brandTitle.textContent = 'DRG-Systems';
    brandSub.textContent = 'DevOps';
  } else {
    brandTitle.textContent = 'DRG-Rently';
    brandSub.textContent = State.tenant ? State.tenant.nome : (State.isSuperAdmin ? 'Super Admin' : '—');
  }
}

function renderApp() {
  aplicarMarcaContexto();
  $('user-name').textContent = State.userDoc?.nome || State.user?.email || '—';
  $('footer-version').textContent = `v${APP_VERSION}`;

  // Logo customizada do tenant (se houver)
  aplicarLogoTenant();

  $('nav-superadmin').style.display = State.isSuperAdmin ? 'flex' : 'none';

  // Aplica visibilidade dos itens do sidebar conforme módulos permitidos
  document.querySelectorAll('.nav-link[data-section]').forEach(el => {
    const mod = el.dataset.section;
    if (mod === 'superadmin') return; // já tratado acima
    el.style.display = userPodeVerModulo(mod) ? 'flex' : 'none';
  });

  // Se a seção atual não é permitida, manda pro dashboard
  if (State.currentSection && !userPodeVerModulo(State.currentSection)) {
    State.currentSection = 'dashboard';
  }

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
    portais: 'Portais Imobiliários',
    superadmin: 'Super Admin — Tenants',
    configuracoes: 'Configurações',
  };
  $('topbar-title').textContent = titles[name] || name;

  // Marca + logo mudam conforme contexto: painel SaaS (Super Admin) vs tenant
  aplicarMarcaContexto();
  aplicarLogoTenant();

  if (name === 'dashboard' && State.tenant) {
    loadDashboard();
  }
  if (name === 'alertas' && State.tenant) {
    loadAlertas();
  }
  if (name === 'relatorios' && State.tenant) {
    initRelatorioFiltros();
    loadRelatorio();
  }
  if (name === 'superadmin' && State.isSuperAdmin) {
    aplicarPermissoesDRG();
    if (userDRGPodeVerArea('drg_tenants_view')) loadTenantsTable();
    if (userDRGPodeVerArea('drg_equipe')) loadEquipeDRG();
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
    loadUsuariosTenant();
    loadPerfis();
  }
  if (name === 'auditoria' && State.tenant) {
    loadAuditoria();
  }
  if (name === 'portais' && State.tenant) {
    renderPortais();
    loadPortaisStatus();
  }
}

// =============================================================
// SUPER ADMIN — gestão completa do SaaS
// =============================================================

let _tenantsCarregados = []; // cache pra filtros sem requery

const PLANO_LABEL = { trial: 'Trial', basic: 'Basic', pro: 'Pro' };

function diasAteData(isoDate) {
  if (!isoDate) return null;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const alvo = new Date(isoDate + 'T00:00:00');
  return Math.floor((alvo.getTime() - hoje.getTime()) / 86400000);
}

function tenantSituacao(t) {
  if (t.ativo === false) return 'suspenso';
  const trialDias = diasAteData(t.trialExpira);
  const vencDias = diasAteData(t.proximoVencimento);
  if (vencDias != null && vencDias < 0) return 'inadimplente';
  if (t.plano === 'trial' && trialDias != null && trialDias <= 7) return 'vencendo';
  if (t.plano === 'trial') return 'trial';
  return 'ativo';
}

async function loadTenantsTable() {
  const tbody = $('tbody-tenants');
  tbody.innerHTML = `<tr><td colspan="6" class="empty">Carregando…</td></tr>`;

  try {
    const snap = await db.collection('tenants').orderBy('criadoEm', 'desc').get();
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhum tenant cadastrado.</td></tr>`;
      renderSuperAdminKpis([]);
      return;
    }
    _tenantsCarregados = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSuperAdminKpis(_tenantsCarregados);
    renderTenantsTable();
  } catch (err) {
    console.error('Erro carregando tenants:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

function renderSuperAdminKpis(tenants) {
  const kpis = $('superadmin-kpis');
  if (!kpis) return;
  const total = tenants.length;
  const ativos = tenants.filter(t => tenantSituacao(t) === 'ativo' || tenantSituacao(t) === 'trial' || tenantSituacao(t) === 'vencendo').length;
  const trials = tenants.filter(t => t.plano === 'trial' && t.ativo !== false).length;
  const inadimplentes = tenants.filter(t => tenantSituacao(t) === 'inadimplente').length;
  const suspensos = tenants.filter(t => t.ativo === false).length;
  const mrr = tenants
    .filter(t => t.ativo !== false && t.plano !== 'trial')
    .reduce((acc, t) => acc + (t.valorMensalidade || 0), 0);

  kpis.innerHTML = `
    <div class="stat-card"><div class="stat-card-icon stat-icon-blue">🏢</div>
      <div class="stat-card-body"><div class="stat-card-value">${total}</div><div class="stat-card-label">Total de Tenants</div></div></div>
    <div class="stat-card"><div class="stat-card-icon stat-icon-green">✓</div>
      <div class="stat-card-body"><div class="stat-card-value">${ativos}</div><div class="stat-card-label">Ativos</div></div></div>
    <div class="stat-card"><div class="stat-card-icon stat-icon-amber">⏳</div>
      <div class="stat-card-body"><div class="stat-card-value">${trials}</div><div class="stat-card-label">Em Trial</div></div></div>
    <div class="stat-card"><div class="stat-card-icon stat-icon-rose">⚠</div>
      <div class="stat-card-body"><div class="stat-card-value">${inadimplentes}</div><div class="stat-card-label">Inadimplentes</div></div></div>
    <div class="stat-card"><div class="stat-card-icon stat-icon-purple">💰</div>
      <div class="stat-card-body"><div class="stat-card-value">${fmtBRL(mrr)}</div><div class="stat-card-label">MRR (mensal recorrente)</div></div></div>
  `;
}

function renderTenantsTable() {
  const tbody = $('tbody-tenants');
  const filtroStatus = $('filtro-tenant-status').value;
  const filtroPlano = $('filtro-tenant-plano').value;
  const filtroTipo = $('filtro-tenant-tipo')?.value || '';
  const filtroBusca = $('filtro-tenant-busca').value.trim().toLowerCase();

  let lista = _tenantsCarregados;
  if (filtroPlano) lista = lista.filter(t => t.plano === filtroPlano);
  if (filtroStatus) lista = lista.filter(t => tenantSituacao(t) === filtroStatus);
  if (filtroTipo) {
    lista = lista.filter(t => {
      const tp = t.tipoPessoa || (t.cpf ? 'PF' : 'PJ');
      return tp === filtroTipo;
    });
  }
  if (filtroBusca) lista = lista.filter(t => {
    const txt = (t.nome || '') + ' ' + (t.cnpj || '') + ' ' + (t.cpf || '');
    return txt.toLowerCase().includes(filtroBusca);
  });

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">Nenhum tenant corresponde aos filtros.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(t => {
    const sit = tenantSituacao(t);
    const sitBadge = {
      ativo: '<span class="badge-status ativo">Ativo</span>',
      suspenso: '<span class="badge-status suspenso">Suspenso</span>',
      trial: '<span class="badge-status pendente_analise">Trial</span>',
      vencendo: '<span class="badge-status em_reforma">Trial vencendo</span>',
      inadimplente: '<span class="badge-status reprovado">Inadimplente</span>',
    }[sit] || sit;
    const vencDias = diasAteData(t.proximoVencimento);
    const vencTxt = t.proximoVencimento
      ? `${fmtDataBR(t.proximoVencimento)}${vencDias < 0 ? ` <span style="color:var(--danger);font-size:11px;">(${Math.abs(vencDias)}d atraso)</span>` : (vencDias <= 7 && vencDias >= 0 ? ` <span style="color:var(--warning);font-size:11px;">(em ${vencDias}d)</span>` : '')}`
      : '—';
    const tipoPessoa = t.tipoPessoa || (t.cpf ? 'PF' : 'PJ');
    const tipoBadge = tipoPessoa === 'PF'
      ? '<span class="badge-status" style="background:#dbeafe;color:#1e40af;">👤 Corretor</span>'
      : '<span class="badge-status" style="background:#fef3c7;color:#92400e;">🏢 Imobiliária</span>';
    const documento = tipoPessoa === 'PF' ? (t.cpf || '—') : (t.cnpj || '—');
    return `
      <tr>
        <td><strong>${t.nome || '—'}</strong><br><span class="muted" style="font-size:11px;">${documento}</span></td>
        <td>${tipoBadge}</td>
        <td>${PLANO_LABEL[t.plano] || t.plano || '—'}</td>
        <td>${fmtBRL(t.valorMensalidade)}</td>
        <td>${vencTxt}</td>
        <td>${sitBadge}</td>
        <td>
          <div class="action-btns">
            <button class="btn btn-sm btn-secondary" onclick="openTenantModal('${t.id}')">⚙ Gerenciar</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function openTenantModal(tenantId) {
  clearAlert('tenant-alert');
  $('tenant-id').value = tenantId;

  try {
    const tSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tSnap.exists) { showAlert('tenant-alert', 'Tenant não encontrado.'); return; }
    const t = tSnap.data();

    const tipoPessoa = t.tipoPessoa || (t.cpf ? 'PF' : 'PJ');
    const tipoLabel = tipoPessoa === 'PF' ? '👤 Corretor Autônomo (PF)' : '🏢 Imobiliária (PJ)';
    $('modal-tenant-title').textContent = `Gestão · ${t.nome || tenantId} — ${tipoLabel}`;
    $('tenant-nome').value = t.nome || '';
    $('tenant-cnpj').value = tipoPessoa === 'PF' ? (t.cpf || '') : (t.cnpj || '');
    $('tenant-plano').value = t.plano || 'trial';
    $('tenant-valor').value = t.valorMensalidade ?? '';
    $('tenant-proximo-venc').value = t.proximoVencimento || '';
    $('tenant-trial-expira').value = t.trialExpira || '';
    $('tenant-ativo').value = String(t.ativo !== false);
    $('tenant-notas').value = t.notas || '';

    // Pacote de módulos
    const pacote = t.pacote || 'completo';
    $('tenant-pacote').value = pacote;
    renderTenantModulos(pacote, t.modulosHabilitados);

    // Admin do tenant
    const adminSnap = await db.collection('users')
      .where('tenantId', '==', tenantId).where('role', '==', 'admin').limit(1).get();
    $('tenant-admin').value = adminSnap.empty ? '—' : (adminSnap.docs[0].data().email || '—');

    // Métricas
    await loadTenantMetricas(tenantId);

    // Pagamentos
    loadTenantPagamentos(tenantId);

    // Limpa form de adicionar pagamento
    $('pag-data').value = new Date().toISOString().slice(0, 10);
    $('pag-metodo').value = 'pix';
    $('pag-valor').value = '';
    $('pag-obs').value = '';

    $('modal-tenant').style.display = 'flex';
  } catch (err) {
    console.error('Erro ao abrir tenant:', err);
    showAlert('tenant-alert', 'Erro: ' + err.message);
  }
}

function closeTenantModal() {
  $('modal-tenant').style.display = 'none';
}

// Renderiza checkboxes dos módulos disponíveis pro tenant
function renderTenantModulos(pacote, modulosHabilitados) {
  const container = $('tenant-modulos-container');
  if (!container) return;

  // Define a lista de módulos marcados:
  // - Se pacote = custom → usa modulosHabilitados (ou todos como fallback)
  // - Caso contrário → usa o array fixo do pacote
  let marcados;
  if (pacote === 'custom') {
    marcados = Array.isArray(modulosHabilitados) ? modulosHabilitados : MODULOS_DISPONIVEIS.map(m => m.id);
  } else {
    marcados = TENANT_PACOTES[pacote]?.modulos || MODULOS_DISPONIVEIS.map(m => m.id);
  }

  const grupos = {};
  MODULOS_DISPONIVEIS.forEach(m => {
    if (!grupos[m.grupo]) grupos[m.grupo] = [];
    grupos[m.grupo].push(m);
  });

  const isCustom = pacote === 'custom';
  const desc = TENANT_PACOTES[pacote]?.desc || '';

  container.innerHTML = `
    ${desc ? `<p class="muted" style="font-size:12px; margin: 0 0 12px;">${desc}</p>` : ''}
    ${Object.keys(grupos).map(g => `
      <div style="margin-bottom:12px;">
        <strong style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.4px;">${g}</strong>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:6px; margin-top:6px;">
          ${grupos[g].map(m => `
            <label style="display:flex; align-items:center; gap:8px; cursor:${isCustom ? 'pointer' : 'default'}; font-size:13px; opacity:${isCustom ? '1' : '0.85'};">
              <input type="checkbox" name="tenant-mod" value="${m.id}" ${marcados.includes(m.id) ? 'checked' : ''} ${isCustom ? '' : 'disabled'}>
              ${m.label}
            </label>
          `).join('')}
        </div>
      </div>
    `).join('')}
  `;
}

function onTenantPacoteChange() {
  const pacote = $('tenant-pacote').value;
  // Lê o estado atual de marcados antes de redesenhar (pra preservar em custom)
  const marcadosAtuais = Array.from(document.querySelectorAll('input[name="tenant-mod"]:checked')).map(c => c.value);
  renderTenantModulos(pacote, marcadosAtuais);
}

async function loadTenantMetricas(tenantId) {
  const container = $('tenant-metricas');
  container.innerHTML = '<p class="muted">Carregando…</p>';
  try {
    const tref = db.collection('tenants').doc(tenantId);
    const [imSnap, locSnap, ctSnap, balSnap] = await Promise.all([
      tref.collection('imoveis').get(),
      tref.collection('locatarios').get(),
      tref.collection('contratos').where('status', '==', 'vigente').get(),
      tref.collection('balancetes').get(),
    ]);
    container.innerHTML = `
      <div class="stat-card"><div class="stat-card-icon stat-icon-amber">🏢</div>
        <div class="stat-card-body"><div class="stat-card-value">${imSnap.size}</div><div class="stat-card-label">Imóveis</div></div></div>
      <div class="stat-card"><div class="stat-card-icon stat-icon-purple">👤</div>
        <div class="stat-card-body"><div class="stat-card-value">${locSnap.size}</div><div class="stat-card-label">Locatários</div></div></div>
      <div class="stat-card"><div class="stat-card-icon stat-icon-teal">📝</div>
        <div class="stat-card-body"><div class="stat-card-value">${ctSnap.size}</div><div class="stat-card-label">Contratos vigentes</div></div></div>
      <div class="stat-card"><div class="stat-card-icon stat-icon-green">💰</div>
        <div class="stat-card-body"><div class="stat-card-value">${balSnap.size}</div><div class="stat-card-label">Balancetes (total)</div></div></div>
    `;
  } catch (err) {
    container.innerHTML = `<p class="muted" style="color:var(--danger);">Erro ao carregar métricas.</p>`;
  }
}

async function loadTenantPagamentos(tenantId) {
  const tbody = $('tbody-pagamentos');
  tbody.innerHTML = `<tr><td colspan="5" class="empty">Carregando…</td></tr>`;
  try {
    const snap = await db.collection('tenants').doc(tenantId).collection('pagamentos').orderBy('data', 'desc').get();
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">Sem pagamentos registrados.</td></tr>`;
      return;
    }
    tbody.innerHTML = snap.docs.map(d => {
      const p = d.data();
      return `<tr>
        <td>${p.data ? fmtDataBR(p.data) : '—'}</td>
        <td>${(p.metodo || '').toUpperCase()}</td>
        <td>${fmtBRL(p.valor)}</td>
        <td>${p.obs || '—'}</td>
        <td><button class="btn-icon btn-icon-danger" onclick="deletePagamento('${tenantId}', '${d.id}')" title="Excluir">🗑</button></td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

async function addPagamento() {
  const tenantId = $('tenant-id').value;
  if (!tenantId) return;
  const data = $('pag-data').value;
  const metodo = $('pag-metodo').value;
  const valor = parseFloat($('pag-valor').value);
  const obs = $('pag-obs').value.trim();
  if (!data || !valor) { showAlert('tenant-alert', 'Informe data e valor.'); return; }

  try {
    await db.collection('tenants').doc(tenantId).collection('pagamentos').add({
      data, metodo, valor, obs: obs || null,
      registradoPor: State.user.uid,
      registradoEm: firebase.firestore.FieldValue.serverTimestamp(),
    });
    $('pag-valor').value = '';
    $('pag-obs').value = '';
    showAlert('tenant-alert', '✓ Pagamento registrado.', 'success');
    loadTenantPagamentos(tenantId);
  } catch (err) {
    showAlert('tenant-alert', 'Erro: ' + err.message);
  }
}

async function deletePagamento(tenantId, pagId) {
  if (!confirm('Excluir este pagamento do histórico?')) return;
  try {
    await db.collection('tenants').doc(tenantId).collection('pagamentos').doc(pagId).delete();
    loadTenantPagamentos(tenantId);
  } catch (err) {
    showAlert('tenant-alert', 'Erro: ' + err.message);
  }
}

async function saveTenantManagement() {
  const tenantId = $('tenant-id').value;
  if (!tenantId) return;

  // Pacote + módulos habilitados
  const pacote = $('tenant-pacote').value;
  let modulosHabilitados;
  if (pacote === 'custom') {
    modulosHabilitados = Array.from(document.querySelectorAll('input[name="tenant-mod"]:checked')).map(c => c.value);
  } else {
    modulosHabilitados = TENANT_PACOTES[pacote]?.modulos || [];
  }

  const data = {
    plano: $('tenant-plano').value,
    valorMensalidade: parseFloat($('tenant-valor').value) || null,
    proximoVencimento: $('tenant-proximo-venc').value || null,
    trialExpira: $('tenant-trial-expira').value || null,
    ativo: $('tenant-ativo').value === 'true',
    notas: $('tenant-notas').value.trim() || null,
    pacote,
    modulosHabilitados,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  };
  const btn = $('btn-save-tenant');
  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    await db.collection('tenants').doc(tenantId).update(data);
    closeTenantModal();
    showAlert('login-alert', '', 'success'); // limpa
    loadTenantsTable();
  } catch (err) {
    showAlert('tenant-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar alterações';
  }
}

// ----- "Atuar como" tenant -----
async function atuarComoTenant() {
  const tenantId = $('tenant-id').value;
  if (!tenantId) return;
  if (!State.isSuperAdmin) return;
  try {
    const snap = await db.collection('tenants').doc(tenantId).get();
    if (!snap.exists) return;
    // Guarda o tenant atual antes de trocar
    if (!State.tenantOriginal) State.tenantOriginal = State.tenant;
    State.tenant = { id: snap.id, ...snap.data() };
    // Invalida todos os caches
    invalidateLocadoresCache();
    invalidateLocatariosCache();
    invalidateImoveisCache();
    invalidateGarantiasCache();
    invalidateCompradoresCache();
    closeTenantModal();
    renderApp();
    showSection('dashboard');
    $('banner-atuando-como').style.display = 'flex';
    $('banner-atuando-nome').textContent = State.tenant.nome || '—';
    $('brand-tenant-name').textContent = State.tenant.nome || '—';
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

function voltarParaSuperAdmin() {
  if (!State.tenantOriginal) return;
  State.tenant = State.tenantOriginal;
  State.tenantOriginal = null;
  invalidateLocadoresCache();
  invalidateLocatariosCache();
  invalidateImoveisCache();
  invalidateGarantiasCache();
  invalidateCompradoresCache();
  $('banner-atuando-como').style.display = 'none';
  $('brand-tenant-name').textContent = State.tenant?.nome || 'Super Admin';
  renderApp();
  showSection('superadmin');
}

// Compat — função antiga usada em outras partes do código
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
      logAuditoria('update', 'locador', id, { nome: data.nome });
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('locadores').add(data);
      logAuditoria('create', 'locador', docRef.id, { nome: data.nome });
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
    logAuditoria('delete', 'locador', id);
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
      logAuditoria('update', 'locatario', id, { nome: data.nome, status: data.status });
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('locatarios').add(data);
      logAuditoria('create', 'locatario', docRef.id, { nome: data.nome });
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
    logAuditoria('delete', 'locatario', id);
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
      logAuditoria('update', 'garantia', id, { tipo: data.tipo });
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('garantias').add(data);
      logAuditoria('create', 'garantia', docRef.id, { tipo: data.tipo });
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
    logAuditoria('delete', 'garantia', id);
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

// Cache do contrato + locatário do balancete atual.
// Usado pra match automático nos cards multi-comprovante.
let _balanceteMatchInfo = null;

async function refreshBalanceteContratoInfo() {
  const contratoId = $('balancete-contrato').value;
  const info = $('balancete-contrato-info');
  _balanceteMatchInfo = null;
  if (!contratoId) { info.style.display = 'none'; $('balancete-aluguel-base').value = ''; $('balancete-taxa-adm').value = ''; recalcBalancete(); return; }

  try {
    const snap = await tenantPath().collection('contratos').doc(contratoId).get();
    if (!snap.exists) return;
    const c = snap.data();
    $('balancete-aluguel-base').value = (c.aluguel ?? 0).toFixed(2);
    if (!$('balancete-taxa-adm').value) $('balancete-taxa-adm').value = c.taxaAdm ?? 10;

    // Carrega dados do locatário + imóvel pra match no multi-comprovante
    try {
      const [locSnap, imSnap] = await Promise.all([
        c.locatarioId ? tenantPath().collection('locatarios').doc(c.locatarioId).get() : null,
        c.imovelId ? tenantPath().collection('imoveis').doc(c.imovelId).get() : null,
      ]);
      _balanceteMatchInfo = {
        contratoId,
        aluguelEsperado: c.aluguel || 0,
        diaVencimento: c.diaVencimento || null,
        locatarioId: c.locatarioId,
        locatarioNome: locSnap && locSnap.exists ? (locSnap.data().nome || '') : '',
        locatarioCpf: locSnap && locSnap.exists ? String(locSnap.data().cpf || '').replace(/\D/g, '') : '',
        imovelId: c.imovelId,
        imovelApelido: imSnap && imSnap.exists ? (imSnap.data().apelido || '') : '',
      };
    } catch (_) {}

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

  // Badge de vinculação ao contrato (se gerado por IA com match)
  let badge = '';
  if (l.contratoId) {
    const score = l.matchScore;
    if (score >= 2) {
      badge = '<span class="lanc-vinc-badge vinc-ok" title="Vinculado automaticamente ao contrato">🔗</span>';
    } else if (score === 1) {
      badge = '<span class="lanc-vinc-badge vinc-parcial" title="Match parcial — verificar">🔗⚠</span>';
    }
  } else if (l.iaConfidence != null) {
    // Foi criado por IA mas sem vinculação
    badge = '<span class="lanc-vinc-badge vinc-ia" title="Criado por IA">🤖</span>';
  }

  return `
    <div class="lanc-row" data-id="${l.id}">
      ${badge}
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

  // Apuração em tempo real (card no topo do modal de balancete)
  const apuRec = $('apuracao-receitas');
  const apuDes = $('apuracao-despesas');
  const apuTax = $('apuracao-taxa');
  const apuLiq = $('apuracao-liquido');
  if (apuRec) apuRec.textContent = fmtBRL(totalEntradas);
  if (apuDes) apuDes.textContent = fmtBRL(totalDespLocador);
  if (apuTax) apuTax.textContent = fmtBRL(taxaValor);
  if (apuLiq) apuLiq.textContent = fmtBRL(liquido);
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
  _multiContexto = null;
  // Reset visibilidade dos modos
  const s = $('revisao-single'); if (s) s.style.display = 'block';
  const m = $('revisao-multi'); if (m) m.style.display = 'none';
  const btnS = $('btn-confirmar-boleto'); if (btnS) btnS.style.display = 'inline-block';
  const btnM = $('btn-confirmar-multi'); if (btnM) btnM.style.display = 'none';
}

// =============================================================
// MULTI-COMPROVANTE — Gemini detecta vários documentos em UM arquivo
// =============================================================

let _multiContexto = null; // { file, comprovantes: [...] }

// Tenta detectar se um comprovante de pagamento bate com o contrato do balancete.
// Retorna um objeto { score: 0..3, motivos: [...], deveriaVincular: bool }
// Critérios:
//   +1 se a direção é "entrada" e categoria sugerida é "aluguel"
//   +1 se valor está dentro de ±5% do aluguel esperado
//   +1 se CPF do pagador bate (ignorando formatação)
function tentarMatchContrato(comp) {
  if (!_balanceteMatchInfo) return { score: 0, motivos: [], deveriaVincular: false };
  const info = _balanceteMatchInfo;
  const motivos = [];
  let score = 0;

  // Critério 1: categoria + direção
  if (comp.direcao === 'entrada' && comp.categoria_sugerida === 'aluguel') {
    score += 1;
    motivos.push('Pagamento de aluguel (entrada)');
  }

  // Critério 2: valor próximo ao aluguel esperado (±5%)
  const valor = parseFloat(comp.valor) || 0;
  if (valor > 0 && info.aluguelEsperado > 0) {
    const diff = Math.abs(valor - info.aluguelEsperado) / info.aluguelEsperado;
    if (diff <= 0.05) {
      score += 1;
      motivos.push(`Valor bate com aluguel (R$ ${valor.toFixed(2)} vs R$ ${info.aluguelEsperado.toFixed(2)})`);
    }
  }

  // Critério 3: CPF do pagador
  const cpfPagador = String(comp.pagador_documento || '').replace(/\D/g, '');
  if (cpfPagador && info.locatarioCpf && cpfPagador === info.locatarioCpf) {
    score += 1;
    motivos.push(`CPF bate com locatário (${info.locatarioNome})`);
  }

  return {
    score,
    motivos,
    deveriaVincular: score >= 2, // 2 de 3 critérios = vincula automaticamente
  };
}

// Mapeia categoria sugerida pelo Gemini → bloco do balancete
function blocoDeCategoria(categoria, direcao) {
  if (direcao === 'entrada') return 'entrada';
  // Saída: tenta inferir se é despesa do locador ou locatário
  const locador = ['iptu', 'condominio', 'manutencao', 'seguro', 'repasse_locador', 'taxa_administracao'];
  const locatario = ['agua', 'luz', 'gas', 'internet'];
  if (locador.includes(categoria)) return 'despesa_locador';
  if (locatario.includes(categoria)) return 'despesa_locatario';
  // Default: despesa do locador
  return 'despesa_locador';
}

// Mapeia categoria do Gemini → categoria interna do balancete
function mapearCategoria(categoriaGemini, bloco) {
  const validas = LANC_CATEGORIAS[bloco] || [];
  if (validas.includes(categoriaGemini)) return categoriaGemini;
  // Mapeamentos
  if (categoriaGemini === 'aluguel') return 'aluguel';
  if (categoriaGemini === 'multa_atraso') return bloco === 'entrada' ? 'multa_juros' : 'outros';
  if (categoriaGemini === 'deposito_caucao') return 'outros';
  if (categoriaGemini === 'taxa_administracao') return 'outros';
  if (categoriaGemini === 'repasse_locador') return 'outros';
  return validas[validas.length - 1] || 'outros'; // 'outros' como fallback
}

async function lerMultiComprovantes() {
  if ($('balancete-status').value !== 'aberto' && $('balancete-id').value) {
    showAlert('balancete-alert', 'Reabra o balancete para adicionar lançamentos.');
    return;
  }
  try {
    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (!cfg.workerGeminiUrl) {
      showAlert('balancete-alert', 'Configure a URL do Worker Gemini em Configurações antes de usar a análise.');
      return;
    }
  } catch (_) {}

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
    await processarMultiComprovantes(file);
  };
  input.click();
}

async function processarMultiComprovantes(file) {
  showAlert('balancete-alert', '🤖 Analisando arquivo com IA... pode levar 5-30 segundos pra detectar múltiplos comprovantes.', 'info');
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
        modo: 'multi',
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
    const comprovantes = result.data.comprovantes || [];
    const observacoes = result.data.observacoes_gerais || null;

    if (comprovantes.length === 0) {
      showAlert('balancete-alert', '⚠️ Nenhum documento financeiro foi detectado no arquivo.');
      return;
    }

    abrirRevisaoMulti(comprovantes, observacoes, file);
    clearAlert('balancete-alert');
  } catch (err) {
    console.error('Erro ao processar multi-comprovante:', err);
    showAlert('balancete-alert', 'Erro: ' + err.message);
  }
}

function abrirRevisaoMulti(comprovantes, observacoes, file) {
  // Atribui ID local pra cada um (pra controle no modal)
  comprovantes.forEach((c, idx) => {
    c._id = 'cmp_' + idx + '_' + Date.now();
    c._lancar = !!c.eh_pagamento_efetivado; // default: só pagamentos efetivados
    // Garante campos default
    c.direcao = c.direcao || 'ambiguo';
    c.bloco = blocoDeCategoria(c.categoria_sugerida, c.direcao);
    c.confidence_score = typeof c.confidence_score === 'number' ? c.confidence_score : 0.7;
    c.campos_duvidosos = c.campos_duvidosos || [];
    // Match com o contrato do balancete (se houver)
    c._match = tentarMatchContrato(c);
    c._vincularContrato = c._match.deveriaVincular; // default: vincula se match score >= 2
  });
  _multiContexto = { file, comprovantes };

  // Configura UI do modal
  $('boleto-revisao-titulo').textContent = '🤖 Documentos detectados pela IA';
  $('revisao-single').style.display = 'none';
  $('revisao-multi').style.display = 'block';
  $('btn-confirmar-boleto').style.display = 'none';
  $('btn-confirmar-multi').style.display = 'inline-block';

  $('multi-count').textContent = comprovantes.length;
  $('boleto-arquivo-nome-multi').textContent = file.name;

  const obsEl = $('multi-observacoes');
  if (observacoes && obsEl) {
    obsEl.style.display = 'block';
    obsEl.innerHTML = '⚠️ ' + escapeHtml(observacoes);
  } else if (obsEl) {
    obsEl.style.display = 'none';
  }

  renderMultiCards();
  $('modal-boleto-revisao').style.display = 'flex';
}

const TIPO_DOC_LABEL = {
  comprovante_pagamento: { label: '💰 Comprovante de pagamento', cor: '#16a34a', bg: '#d1fae5' },
  boleto_a_pagar:        { label: '📄 Boleto a pagar', cor: '#92400e', bg: '#fef3c7' },
  nota_fiscal:           { label: '🧾 Nota Fiscal', cor: '#1e40af', bg: '#dbeafe' },
  cupom_fiscal:          { label: '🧾 Cupom Fiscal', cor: '#1e40af', bg: '#dbeafe' },
  recibo:                { label: '📋 Recibo', cor: '#7c2d12', bg: '#fed7aa' },
  outro:                 { label: '❓ Outro', cor: '#374151', bg: '#e5e7eb' },
};

function renderMultiCards() {
  const container = $('multi-comprovantes-container');
  if (!container || !_multiContexto) return;
  const cs = _multiContexto.comprovantes;

  container.innerHTML = cs.map((c, idx) => {
    const tipoInfo = TIPO_DOC_LABEL[c.tipo_documento] || TIPO_DOC_LABEL.outro;
    const confPct = Math.round((c.confidence_score || 0) * 100);
    const lowConf = confPct < 85;
    const dirIco = c.direcao === 'entrada' ? '🟢 ENTRADA' : c.direcao === 'saida' ? '🔴 SAÍDA' : '⚠️ AMBÍGUO';
    const blocoLabel = c.bloco === 'entrada' ? '⬆ Entradas' : c.bloco === 'despesa_locador' ? '⬇ Despesa do locador' : '⬇ Despesa do locatário';
    const duvidoso = (campo) => c.campos_duvidosos.includes(campo);
    const hl = (campo) => duvidoso(campo) ? 'background:#fef3c7; border-color:#fcd34d;' : '';

    // Categorias possíveis do bloco
    const cats = LANC_CATEGORIAS[c.bloco] || [];
    const catSel = mapearCategoria(c.categoria_sugerida, c.bloco);
    const catOpts = cats.map(k =>
      `<option value="${k}"${k === catSel ? ' selected' : ''}>${LANC_CATEGORIA_LABEL[k] || k}</option>`
    ).join('');

    // Bloco de vinculação ao contrato (só quando há contrato selecionado no balancete)
    let vincBox = '';
    if (_balanceteMatchInfo && c._match) {
      const m = c._match;
      if (m.score >= 2) {
        // Match forte — vincular automaticamente
        vincBox = `
          <div class="vinculacao-box vinc-forte">
            <label class="vinc-toggle">
              <input type="checkbox" ${c._vincularContrato ? 'checked' : ''} onchange="toggleVincularContrato('${c._id}', this.checked)">
              <span>🔗 <strong>Vincular ao contrato</strong> — ${escapeHtml(_balanceteMatchInfo.imovelApelido)} / ${escapeHtml(_balanceteMatchInfo.locatarioNome)}</span>
            </label>
            <ul class="vinc-motivos">${m.motivos.map(mt => `<li>✓ ${escapeHtml(mt)}</li>`).join('')}</ul>
          </div>`;
      } else if (m.score === 1) {
        // Match parcial — sugerir mas operador decide
        vincBox = `
          <div class="vinculacao-box vinc-parcial">
            <label class="vinc-toggle">
              <input type="checkbox" ${c._vincularContrato ? 'checked' : ''} onchange="toggleVincularContrato('${c._id}', this.checked)">
              <span>🔗 Vincular ao contrato? — ${escapeHtml(_balanceteMatchInfo.imovelApelido)} / ${escapeHtml(_balanceteMatchInfo.locatarioNome)}</span>
            </label>
            <p class="vinc-aviso">⚠️ Match parcial (${m.score}/3 critérios). Confirme antes de vincular:</p>
            <ul class="vinc-motivos">${m.motivos.map(mt => `<li>✓ ${escapeHtml(mt)}</li>`).join('')}</ul>
          </div>`;
      } else if (c.direcao === 'entrada' && c.categoria_sugerida === 'aluguel') {
        // É um aluguel mas não bateu nada — alerta amarelo
        vincBox = `
          <div class="vinculacao-box vinc-nenhum">
            <p>⚠️ Este parece ser um pagamento de aluguel, mas <strong>não bate</strong> com o contrato deste balancete (valor ou CPF diferentes). Verifique antes de confirmar.</p>
          </div>`;
      }
    }

    return `
      <div class="multi-card ${c._lancar ? 'multi-card-active' : 'multi-card-skip'}" data-id="${c._id}">
        <div class="multi-card-header">
          <div>
            <span class="badge-tipo-doc" style="background:${tipoInfo.bg}; color:${tipoInfo.cor};">${tipoInfo.label}</span>
            <span class="muted" style="font-size:11px; margin-left:8px;">${dirIco} · Confiança: ${confPct}%${lowConf ? ' ⚠️' : ''}</span>
          </div>
          <label class="multi-card-toggle">
            <input type="checkbox" ${c._lancar ? 'checked' : ''} onchange="toggleMultiLancar('${c._id}', this.checked)">
            <span>Lançar este</span>
          </label>
        </div>
        ${vincBox}
        ${!c.eh_pagamento_efetivado ? `<p style="background:#fef3c7; color:#92400e; padding:6px 10px; border-radius:6px; font-size:12px; margin:0 0 10px;">⚠️ Este documento é apenas <strong>${tipoInfo.label}</strong> — não é comprovante de pagamento. Marque "Lançar" só se você confirmou que foi pago.</p>` : ''}
        <div class="form-row">
          <div class="form-group">
            <label>Bloco</label>
            <select onchange="updateMultiCampo('${c._id}', 'bloco', this.value)">
              <option value="entrada"${c.bloco === 'entrada' ? ' selected' : ''}>⬆ Entradas</option>
              <option value="despesa_locador"${c.bloco === 'despesa_locador' ? ' selected' : ''}>⬇ Despesa do locador</option>
              <option value="despesa_locatario"${c.bloco === 'despesa_locatario' ? ' selected' : ''}>⬇ Despesa do locatário</option>
            </select>
          </div>
          <div class="form-group">
            <label>Categoria</label>
            <select id="multi-cat-${c._id}" onchange="updateMultiCampo('${c._id}', 'categoria_sugerida', this.value)">${catOpts}</select>
          </div>
          <div class="form-group" style="${hl('valor')}">
            <label>Valor (R$) ${duvidoso('valor') ? '⚠️' : ''}</label>
            <input type="number" min="0" step="0.01" value="${c.valor || ''}" onchange="updateMultiCampo('${c._id}', 'valor', parseFloat(this.value) || 0)">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="${hl('data_pagamento')}">
            <label>Data de pagamento ${duvidoso('data_pagamento') ? '⚠️' : ''}</label>
            <input type="date" value="${c.data_pagamento || ''}" onchange="updateMultiCampo('${c._id}', 'data_pagamento', this.value)">
          </div>
          <div class="form-group">
            <label>Competência</label>
            <input type="month" value="${c.competencia || ''}" onchange="updateMultiCampo('${c._id}', 'competencia', this.value)">
          </div>
          <div class="form-group" style="${hl('metodo')}">
            <label>Método</label>
            <select onchange="updateMultiCampo('${c._id}', 'metodo', this.value)">
              <option value="">—</option>
              <option value="pix"${c.metodo === 'pix' ? ' selected' : ''}>PIX</option>
              <option value="ted"${c.metodo === 'ted' ? ' selected' : ''}>TED</option>
              <option value="doc"${c.metodo === 'doc' ? ' selected' : ''}>DOC</option>
              <option value="boleto"${c.metodo === 'boleto' ? ' selected' : ''}>Boleto</option>
              <option value="dinheiro"${c.metodo === 'dinheiro' ? ' selected' : ''}>Dinheiro</option>
              <option value="cartao"${c.metodo === 'cartao' ? ' selected' : ''}>Cartão</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="${hl(c.direcao === 'entrada' ? 'pagador_nome' : 'beneficiario')}">
            <label>${c.direcao === 'entrada' ? 'Pagador' : 'Beneficiário'} ${duvidoso(c.direcao === 'entrada' ? 'pagador_nome' : 'beneficiario') ? '⚠️' : ''}</label>
            <input type="text" value="${escapeHtml(c.direcao === 'entrada' ? (c.pagador_nome || '') : (c.beneficiario || ''))}"
                   oninput="updateMultiCampo('${c._id}', '${c.direcao === 'entrada' ? 'pagador_nome' : 'beneficiario'}', this.value)">
          </div>
          <div class="form-group">
            <label>${c.direcao === 'entrada' ? 'CPF/CNPJ pagador' : 'CPF/CNPJ beneficiário'}</label>
            <input type="text" value="${escapeHtml(c.direcao === 'entrada' ? (c.pagador_documento || '') : (c.documento_beneficiario || ''))}"
                   oninput="updateMultiCampo('${c._id}', '${c.direcao === 'entrada' ? 'pagador_documento' : 'documento_beneficiario'}', this.value)">
          </div>
        </div>
        <div class="form-group">
          <label>Descrição</label>
          <input type="text" value="${escapeHtml(c.descricao || '')}" oninput="updateMultiCampo('${c._id}', 'descricao', this.value)">
        </div>
      </div>
    `;
  }).join('');

  atualizarContadorMulti();
}

function toggleMultiLancar(id, checked) {
  if (!_multiContexto) return;
  const c = _multiContexto.comprovantes.find(x => x._id === id);
  if (!c) return;
  c._lancar = !!checked;
  // Atualiza só a classe do card (sem re-render completo)
  const card = document.querySelector(`.multi-card[data-id="${id}"]`);
  if (card) {
    card.classList.toggle('multi-card-active', c._lancar);
    card.classList.toggle('multi-card-skip', !c._lancar);
  }
  atualizarContadorMulti();
}

function toggleVincularContrato(id, checked) {
  if (!_multiContexto) return;
  const c = _multiContexto.comprovantes.find(x => x._id === id);
  if (!c) return;
  c._vincularContrato = !!checked;
}

function updateMultiCampo(id, campo, valor) {
  if (!_multiContexto) return;
  const c = _multiContexto.comprovantes.find(x => x._id === id);
  if (!c) return;
  c[campo] = valor;
  // Se mudou o bloco, precisa re-renderizar as categorias daquele card
  if (campo === 'bloco') renderMultiCards();
}

function atualizarContadorMulti() {
  if (!_multiContexto) return;
  const total = _multiContexto.comprovantes.filter(c => c._lancar).length;
  const el = $('multi-marcados');
  if (el) el.textContent = total;
}

async function confirmarMultiComprovantes() {
  if (!_multiContexto) return;
  const { file, comprovantes } = _multiContexto;
  const aLancar = comprovantes.filter(c => c._lancar);

  if (aLancar.length === 0) {
    showAlert('boleto-alert', 'Nenhum documento marcado pra lançar.');
    return;
  }

  const valido = aLancar.every(c => {
    const v = parseFloat(c.valor);
    return v && v > 0;
  });
  if (!valido) {
    showAlert('boleto-alert', 'Todos os documentos marcados precisam ter valor > 0.');
    return;
  }

  const btn = $('btn-confirmar-multi');
  btn.disabled = true; btn.textContent = 'Lançando…';

  // Cria os lançamentos
  const lancIds = [];
  for (const c of aLancar) {
    const lancId = cryptoRandomId();
    const bloco = c.bloco;
    const categoria = mapearCategoria(c.categoria_sugerida, bloco);
    const descricao = c.descricao || LANC_CATEGORIA_LABEL[categoria] || categoria;

    // Decide se vincula ao contrato do balancete (se operador marcou)
    let contratoIdVinculado = null;
    let matchScore = null;
    let matchMotivos = null;
    if (c._vincularContrato && _balanceteMatchInfo) {
      contratoIdVinculado = _balanceteMatchInfo.contratoId;
      matchScore = c._match?.score || null;
      matchMotivos = c._match?.motivos || null;
    }

    _balanceteLancamentos.push({
      id: lancId,
      bloco,
      categoria,
      descricao,
      valor: parseFloat(c.valor) || 0,
      comprovantePath: null,
      comprovanteNome: null,
      // Metadados Gemini multi
      boletoVencimento: c.vencimento || null,
      boletoCompetencia: c.competencia || null,
      boletoBeneficiario: c.beneficiario || c.pagador_nome || null,
      boletoDocBeneficiario: c.documento_beneficiario || c.pagador_documento || null,
      boletoLinhaDigitavel: c.linha_digitavel || null,
      tipoDocumento: c.tipo_documento || null,
      metodoPagamento: c.metodo || null,
      dataPagamento: c.data_pagamento || null,
      iaConfidence: c.confidence_score || null,
      // Vinculação ao contrato (Fase 3)
      contratoId: contratoIdVinculado,
      matchScore,
      matchMotivos,
    });
    lancIds.push(lancId);
  }

  // Faz upload de UMA cópia do arquivo, vinculada a TODOS os lançamentos
  // (todos compartilham o mesmo comprovante físico)
  const balanceteId = $('balancete-id').value || `temp_${Date.now()}`;
  try {
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `balancetes/${balanceteId}/comprovantes/multi_${Date.now()}_${cleanName}`;
    const ref = storageTenantRef().child(path);
    await ref.put(file, { contentType: file.type });
    // Vincula o mesmo arquivo a todos os lançamentos criados
    lancIds.forEach(id => {
      const idx = _balanceteLancamentos.findIndex(l => l.id === id);
      if (idx !== -1) {
        _balanceteLancamentos[idx].comprovantePath = path;
        _balanceteLancamentos[idx].comprovanteNome = file.name;
      }
    });
  } catch (err) {
    console.warn('Falha ao anexar arquivo (lançamentos criados mesmo assim):', err);
  }

  btn.disabled = false; btn.textContent = '✓ Lançar selecionados';
  closeBoletoRevisao();
  renderLancamentos();
  recalcBalancete();
  showAlert('balancete-alert', `✓ ${aLancar.length} lançamento(s) criado(s) a partir do arquivo.`, 'success');
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
    logAuditoria(existing.exists ? 'update' : 'create', 'balancete', id, {
      mes: data.mes, ano: data.ano, status: data.status, liquido: data.liquidoLocador,
    });

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

    logAuditoria('send_email', 'balancete', id, { to, mes: b.mes, ano: b.ano });
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
    logAuditoria('delete', 'balancete', id);
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
      logAuditoria('update', 'comprador', id, { nome: data.nome, status: data.status });
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('compradores').add(data);
      logAuditoria('create', 'comprador', docRef.id, { nome: data.nome });
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
    logAuditoria('delete', 'comprador', id);
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
      logAuditoria('update', 'negociacao', id, { status: data.status, valor: data.valor });
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('negociacoes').add(data);
      negociacaoId = docRef.id;
      logAuditoria('create', 'negociacao', negociacaoId, { status: data.status, valor: data.valor });
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
    logAuditoria('delete', 'negociacao', id);
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
   'imovel-obs', 'imovel-descricao-longa', 'imovel-video-url', 'imovel-tour-url'].forEach(f => {
     const el = $(f); if (el) el.value = '';
   });
  // Toggle do feed XML (default ON)
  const vfeedDefault = $('imovel-vitrine-feed'); if (vfeedDefault) vfeedDefault.checked = true;
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
  $('imovel-multiplas-unidades').checked = false;
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
        $('imovel-multiplas-unidades').checked = !!im.multiplasUnidades;

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

        // Conteúdo extra pros portais
        if ($('imovel-descricao-longa')) $('imovel-descricao-longa').value = im.descricaoLonga || '';
        if ($('imovel-video-url')) $('imovel-video-url').value = im.videoUrl || '';
        if ($('imovel-tour-url')) $('imovel-tour-url').value = im.tourUrl || '';
        if ($('imovel-vitrine-feed')) $('imovel-vitrine-feed').checked = im.vitrineFeed !== false;
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
    multiplasUnidades: $('imovel-multiplas-unidades').checked,
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
    // Conteúdo extra pros portais (XML feed)
    descricaoLonga: $('imovel-descricao-longa')?.value.trim() || null,
    videoUrl: $('imovel-video-url')?.value.trim() || null,
    tourUrl: $('imovel-tour-url')?.value.trim() || null,
    vitrineFeed: $('imovel-vitrine-feed')?.checked !== false,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  };

  const btn = $('btn-save-imovel');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  try {
    if (id) {
      await tenantPath().collection('imoveis').doc(id).update(data);
      logAuditoria('update', 'imovel', id, { apelido: data.apelido, status: data.status });
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('imoveis').add(data);
      logAuditoria('create', 'imovel', docRef.id, { apelido: data.apelido });
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
    logAuditoria('delete', 'imovel', id);
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
    img.src = 'logo.png?v=20260513a';
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
  const slugOrId = (State.tenant && State.tenant.slug) ? State.tenant.slug : tenantId;
  return `${base}imovel.html?id=${imovelId}&t=${slugOrId}`;
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

function vitrineUrl(tenantIdOrSlug) {
  const base = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
  return `${base}imoveis.html?t=${tenantIdOrSlug}`;
}

function isSlugValid(slug) {
  if (!slug) return true; // vazio é OK (desativa slug)
  return /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/.test(slug);
}

let _slugCheckDebounce = null;
function onSlugInput() {
  const slug = $('cfg-slug').value.trim().toLowerCase();
  $('cfg-slug').value = slug; // normaliza pra lowercase
  const status = $('cfg-slug-status');
  if (!slug) {
    status.style.display = 'none';
    return;
  }
  status.style.display = 'block';
  if (!isSlugValid(slug)) {
    status.textContent = '✗ Apenas letras minúsculas, números e hífen (3 a 30 caracteres)';
    status.style.color = 'var(--danger)';
    return;
  }
  status.textContent = 'Verificando disponibilidade…';
  status.style.color = 'var(--text-muted)';

  clearTimeout(_slugCheckDebounce);
  _slugCheckDebounce = setTimeout(async () => {
    try {
      const snap = await db.collection('tenants').where('slug', '==', slug).limit(1).get();
      const ocupado = !snap.empty && snap.docs[0].id !== State.tenant.id;
      if (ocupado) {
        status.textContent = '✗ Esse apelido já está em uso por outra imobiliária';
        status.style.color = 'var(--danger)';
      } else {
        status.textContent = '✓ Disponível';
        status.style.color = 'var(--success)';
      }
    } catch (err) {
      console.warn('Erro ao verificar slug:', err);
    }
  }, 400);
}

async function loadConfigImobiliaria() {
  if (!State.tenant) return;
  const tipoPessoa = State.tenant.tipoPessoa || 'PJ';
  // Tenants legados sem tipoPessoa: presume PJ se tem CNPJ, PF se tem CPF
  const ehPF = tipoPessoa === 'PF' || (!State.tenant.cnpj && State.tenant.cpf);

  // Ajusta labels conforme tipo
  if ($('cfg-razao-label')) $('cfg-razao-label').textContent = ehPF ? 'Nome completo' : 'Razão social';
  if ($('cfg-doc-label')) $('cfg-doc-label').textContent = ehPF ? 'CPF' : 'CNPJ';
  if ($('cfg-tipo-pessoa')) $('cfg-tipo-pessoa').value = ehPF ? 'Pessoa Física' : 'Pessoa Jurídica';

  $('cfg-razao').value = State.tenant.nome || '';
  $('cfg-cnpj').value = ehPF ? (State.tenant.cpf || '') : (State.tenant.cnpj || '');
  $('cfg-creci').value = State.tenant.creci || '';
  $('cfg-telefone').value = State.tenant.telefone ? maskTelefone(State.tenant.telefone) : '';
  $('cfg-email-contato').value = State.tenant.emailContato || '';
  $('cfg-slug').value = State.tenant.slug || '';
  $('cfg-vitrine-url').value = vitrineUrl(State.tenant.slug || State.tenant.id);
  $('cfg-slug-status').style.display = 'none';

  // Logo
  $('cfg-logo-img').src = State.tenant.logoUrl || 'logo.png';
  $('btn-remover-logo').style.display = State.tenant.logoUrl ? 'inline-block' : 'none';

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
    const feedEl = $('cfg-worker-feed-url');
    if (feedEl) feedEl.value = cfg.workerFeedUrl || '';
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
    const feedEl = $('cfg-worker-feed-url');
    if (feedEl) feedEl.value = '';
    $('cfg-email-from').value = 'onboarding@resend.dev';
    $('cfg-email-template').value = '';
  }
}

let _saveConfigDebounce = null;
async function saveConfigImobiliaria() {
  clearTimeout(_saveConfigDebounce);
  _saveConfigDebounce = setTimeout(async () => {
    try {
      // Tenant doc — telefone, e-mail e slug (públicos)
      const telefoneDigits = $('cfg-telefone').value.replace(/\D/g, '') || null;
      const emailContato = $('cfg-email-contato').value.trim() || null;
      const slug = $('cfg-slug').value.trim().toLowerCase() || null;

      // Valida slug se preenchido
      if (slug) {
        if (!isSlugValid(slug)) {
          showAlert('cfg-alert', 'Slug inválido. Use apenas letras minúsculas, números e hífen (3 a 30 caracteres).');
          return;
        }
        // Confere unicidade
        const slugSnap = await db.collection('tenants').where('slug', '==', slug).limit(1).get();
        if (!slugSnap.empty && slugSnap.docs[0].id !== State.tenant.id) {
          showAlert('cfg-alert', 'Esse slug já está em uso por outra imobiliária.');
          return;
        }
      }

      await tenantPath().update({
        telefone: telefoneDigits,
        emailContato,
        slug,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      });
      // Sincroniza no State pra a UI usar imediatamente
      State.tenant.telefone = telefoneDigits;
      State.tenant.emailContato = emailContato;
      State.tenant.slug = slug;
      $('cfg-vitrine-url').value = vitrineUrl(slug || State.tenant.id);

      // Subdoc config/site — watermark default e templates de cláusulas
      await tenantPath().collection('config').doc('site').set({
        watermarkDefault: $('cfg-watermark-default').checked,
        templateLocacao: $('cfg-template-locacao').value,
        templateVenda: $('cfg-template-venda').value,
        balanceteCabecalho: $('cfg-balancete-cabecalho').value,
        balanceteRodape: $('cfg-balancete-rodape').value,
        workerUrl: $('cfg-worker-url').value.trim(),
        workerGeminiUrl: $('cfg-worker-gemini-url').value.trim(),
        workerFeedUrl: $('cfg-worker-feed-url')?.value.trim() || '',
        emailFrom: $('cfg-email-from').value.trim(),
        emailTemplate: $('cfg-email-template').value,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      // Invalida cache local (usado por renderPortais)
      State._configCache = null;

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
  window.open(vitrineUrl(State.tenant.slug || State.tenant.id), '_blank');
}

// =============================================================
// PORTAIS IMOBILIÁRIOS — Feed XML (Fase 2)
// =============================================================

// Lista de portais (renderizado dinamicamente nos cards)
const PORTAIS_LIST = [
  {
    id: 'zap',
    nome: 'ZAP Imóveis',
    icone: '🏠',
    gradiente: '#ff6b35, #f7931e',
    tag: 'Líder de mercado',
    desc: 'Maior portal imobiliário do Brasil. Altíssima visibilidade urbana e nacional. Mesmo grupo do Viva Real (publicação compartilhada).',
    mensalidade: 'R$ 500–2.500',
    formato: 'XML Zap 1.0',
    feedFormat: 'zap',
    siteUrl: 'https://www.zapimoveis.com.br/anuncie',
    siteLabel: 'Contratar plano',
  },
  {
    id: 'vivareal',
    nome: 'Viva Real',
    icone: '🏘',
    gradiente: '#00a868, #0bbf6a',
    tag: 'Líder de mercado',
    desc: 'Um dos maiores do Brasil, mesmo grupo do ZAP. Use o MESMO XML do Zap — ele publica nos dois portais.',
    mensalidade: 'R$ 500–2.500',
    formato: 'XML Zap/Viva 1.0',
    feedFormat: 'zap',
    siteUrl: 'https://www.vivareal.com.br/anuncie/',
    siteLabel: 'Contratar plano',
  },
  {
    id: 'imovelweb',
    nome: 'Imovelweb',
    icone: '🏢',
    gradiente: '#ff5722, #ff7043',
    tag: 'Top 3 nacional',
    desc: 'Forte presença em todo Brasil. Pertence ao mesmo grupo do OLX. Excelente custo-benefício pra imobiliárias médias.',
    mensalidade: 'R$ 200–800',
    formato: 'XML Imovelweb',
    feedFormat: 'imovelweb',
    siteUrl: 'https://www.imovelweb.com.br/anuncie-seu-imovel-sp.html',
    siteLabel: 'Contratar plano',
  },
  {
    id: 'olx',
    nome: 'OLX Imóveis',
    icone: '🔍',
    gradiente: '#6e3cbc, #8e44ad',
    tag: 'Alto tráfego',
    desc: 'Conhecido pelo giro rápido de imóveis e alto tráfego. Bom canal pra captação de leads em volume.',
    mensalidade: 'R$ 200–700',
    formato: 'XML OLX',
    feedFormat: 'olx',
    siteUrl: 'https://imobiliarias.olx.com.br/',
    siteLabel: 'Contratar plano',
  },
  {
    id: 'chavesnamao',
    nome: 'Chaves na Mão',
    icone: '🔑',
    gradiente: '#d4a017, #f1c40f',
    tag: 'Tradicional',
    desc: 'Muito utilizado por corretores e imobiliárias tradicionais. Aceita o padrão Wimoveis (formato genérico).',
    mensalidade: 'R$ 100–300',
    formato: 'XML Wimoveis',
    feedFormat: 'wimoveis',
    siteUrl: 'https://www.chavesnamao.com.br/anuncie-conosco/',
    siteLabel: 'Contratar plano',
  },
  {
    id: 'orulo',
    nome: 'Órulo',
    icone: '🏗',
    gradiente: '#e74c3c, #c0392b',
    tag: 'Lançamentos',
    desc: 'Especializado em lançamentos de imóveis novos. Trabalha com construtoras e incorporadoras.',
    mensalidade: 'Sob consulta',
    formato: 'XML Wimoveis',
    feedFormat: 'wimoveis',
    siteUrl: 'https://www.orulo.com.br/contato',
    siteLabel: 'Falar com Órulo',
  },
  {
    id: 'dfimoveis',
    nome: 'DF Imóveis',
    icone: '🏛',
    gradiente: '#1abc9c, #16a085',
    tag: 'Regional DF',
    desc: 'Portal de referência no Distrito Federal. Indispensável para imobiliárias que atuam em Brasília, Águas Claras e região.',
    mensalidade: 'R$ 150–500',
    formato: 'XML Wimoveis',
    feedFormat: 'wimoveis',
    siteUrl: 'https://www.dfimoveis.com.br/',
    siteLabel: 'Contratar plano',
  },
  {
    id: 'spimovel',
    nome: 'SP Imóvel',
    icone: '🌆',
    gradiente: '#3498db, #2980b9',
    tag: 'Regional SP',
    desc: 'Focado na região metropolitana de São Paulo. Forte para imobiliárias paulistanas e do ABC.',
    mensalidade: 'R$ 150–400',
    formato: 'XML Wimoveis',
    feedFormat: 'wimoveis',
    siteUrl: 'https://www.spimovel.com.br/',
    siteLabel: 'Contratar plano',
  },
  {
    id: 'dwv',
    nome: 'DWV',
    icone: '🏗',
    gradiente: '#9b59b6, #8e44ad',
    tag: 'Construtoras',
    desc: 'Plataforma especializada em construtoras e lançamentos. Usado por incorporadoras pra escoar estoque de novos.',
    mensalidade: 'Sob consulta',
    formato: 'XML Wimoveis',
    feedFormat: 'wimoveis',
    siteUrl: 'https://dwv.com.br/contato',
    siteLabel: 'Falar com DWV',
  },
  {
    id: 'casamineira',
    nome: 'Casa Mineira',
    icone: '⛰',
    gradiente: '#e67e22, #d35400',
    tag: 'Regional MG',
    desc: 'Principal portal imobiliário de Minas Gerais. Essencial para imobiliárias de BH, Contagem e região.',
    mensalidade: 'R$ 150–500',
    formato: 'XML Wimoveis',
    feedFormat: 'wimoveis',
    siteUrl: 'https://www.casamineira.com.br/',
    siteLabel: 'Contratar plano',
  },
  {
    id: 'loft',
    nome: 'Loft',
    icone: '🏙',
    gradiente: '#2c3e50, #34495e',
    tag: 'Captação direta',
    desc: 'Plataforma digital completa. Trabalha com captação direta e curadoria — <strong>não aceita XML de terceiros</strong>. Cadastro manual no painel.',
    mensalidade: 'Cadastro manual',
    formato: 'Não aceita XML',
    feedFormat: null,
    siteUrl: 'https://loft.com.br/anuncie',
    siteLabel: 'Acessar Loft',
    unavailable: true,
  },
  {
    id: 'mercadolivre',
    nome: 'Mercado Livre Imóveis',
    icone: '🛒',
    gradiente: '#999, #bbb',
    tag: 'Descontinuado',
    desc: 'A categoria de Imóveis do Mercado Livre foi <strong>descontinuada em 2022</strong>. Recomendamos focar nos portais especializados.',
    mensalidade: 'Inativo desde 2022',
    formato: 'Categoria fechada',
    feedFormat: null,
    siteUrl: null,
    siteLabel: 'Indisponível',
    unavailable: true,
  },
];

// Constrói a URL do feed pra um portal específico
function buildFeedUrl(feedFormat) {
  const tenantSlugOrId = State.tenant?.slug || State.tenant?.id;
  if (!tenantSlugOrId) return '';
  // Worker URL configurado em Configurações
  const workerUrl = (State._configCache?.workerFeedUrl || '').trim();
  if (!workerUrl) return '';
  const u = workerUrl.replace(/\/+$/, '');
  return `${u}/?tenant=${encodeURIComponent(tenantSlugOrId)}&format=${feedFormat}`;
}

// Cache da config pra evitar leituras repetidas
async function ensureConfigCache() {
  if (State._configCache) return State._configCache;
  try {
    const snap = await tenantPath().collection('config').doc('site').get();
    State._configCache = snap.exists ? snap.data() : {};
  } catch (_) {
    State._configCache = {};
  }
  return State._configCache;
}

async function renderPortais() {
  await ensureConfigCache();
  const container = $('portais-grid-container');
  if (!container) return;

  const workerConfigured = !!(State._configCache?.workerFeedUrl || '').trim();

  container.innerHTML = PORTAIS_LIST.map(p => {
    const feedUrl = p.feedFormat ? buildFeedUrl(p.feedFormat) : null;

    // Bloco de status / botão de copiar
    let statusBlock;
    if (p.unavailable) {
      statusBlock = `<div class="portal-card-status status-unavailable">⚠ ${p.id === 'mercadolivre' ? '❌ Categoria descontinuada' : 'Sem integração automática'}</div>`;
    } else if (!workerConfigured) {
      statusBlock = `<div class="portal-card-status status-soon">⚙ Configure o Worker em Configurações</div>`;
    } else if (feedUrl) {
      statusBlock = `
        <div class="portal-card-status status-active">✅ Feed XML pronto</div>
        <div class="feed-url-row">
          <input type="text" class="feed-url-input" value="${feedUrl}" readonly id="feed-url-${p.id}">
          <button class="btn btn-primary btn-sm" onclick="copyFeedUrl('${p.id}')" title="Copiar URL">📋 Copiar</button>
        </div>
      `;
    } else {
      statusBlock = `<div class="portal-card-status status-soon">🚧 Em breve</div>`;
    }

    const ctaButton = p.siteUrl
      ? `<a href="${p.siteUrl}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="width:100%;">${p.siteLabel} →</a>`
      : `<button class="btn btn-secondary btn-sm" disabled style="width:100%; opacity:0.5; cursor:not-allowed;">${p.siteLabel}</button>`;

    return `
      <div class="portal-card ${p.unavailable ? 'portal-card-unavailable' : ''}">
        <div class="portal-card-header">
          <div class="portal-card-icon" style="background:linear-gradient(135deg, ${p.gradiente});">${p.icone}</div>
          <div>
            <h4>${p.nome}</h4>
            <span class="portal-card-tag">${p.tag}</span>
          </div>
        </div>
        <p class="portal-card-desc">${p.desc}</p>
        <div class="portal-card-meta">
          <div><span class="portal-meta-label">Mensalidade aprox.</span><strong>${p.mensalidade}</strong></div>
          <div><span class="portal-meta-label">Formato aceito</span><strong>${p.formato}</strong></div>
        </div>
        ${statusBlock}
        ${ctaButton}
      </div>
    `;
  }).join('');
}

async function copyFeedUrl(portalId) {
  const input = $(`feed-url-${portalId}`);
  if (!input) return;
  try {
    await navigator.clipboard.writeText(input.value);
    const btn = input.nextElementSibling;
    const original = btn.textContent;
    btn.textContent = '✓ Copiado!';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2000);
  } catch (_) {
    input.select();
    document.execCommand('copy');
    alert('URL copiada!');
  }
}

async function loadPortaisStatus() {
  if (!State.tenant) return;
  const countEl = $('feed-status-count');
  if (!countEl) return;
  countEl.textContent = '…';
  try {
    // Conta imóveis publicados + com vitrineFeed (default true)
    const snap = await tenantPath().collection('imoveis').where('linkPublico', '==', true).get();
    const total = snap.docs.filter(d => {
      const im = d.data();
      return im.vitrineFeed !== false;
    }).length;
    countEl.textContent = String(total);

    // Atualiza status card conforme
    const card = $('feed-status-card');
    if (!card) return;

    await ensureConfigCache();
    const workerConfigured = !!(State._configCache?.workerFeedUrl || '').trim();

    if (!workerConfigured) {
      card.style.background = 'linear-gradient(135deg, #fef3c7, #fde68a)';
      card.style.borderColor = '#fcd34d';
      card.querySelector('h4').innerHTML = '⚙ Worker do feed XML ainda não configurado';
      card.querySelector('h4').style.color = '#92400e';
      card.querySelector('p').innerHTML = `Para publicar nos portais, vá em <strong>Configurações → XML Feed para portais</strong> e cole a URL do Worker Cloudflare. Veja <code>cloudflare-worker-feed.js</code> no repo pro código a publicar no Cloudflare.`;
    } else if (total === 0) {
      card.style.background = 'linear-gradient(135deg, #fef3c7, #fde68a)';
      card.style.borderColor = '#fcd34d';
      card.querySelector('h4').innerHTML = '⚠ Nenhum imóvel no feed';
      card.querySelector('h4').style.color = '#92400e';
      card.querySelector('p').innerHTML = `Nenhum imóvel marcado como "publicar no feed". Marque em <strong>Imóveis → editar → Publicação pública → 📤 Incluir no XML feed</strong>.`;
    } else {
      card.style.background = 'linear-gradient(135deg, #d1fae5, #a7f3d0)';
      card.style.borderColor = '#86efac';
      card.querySelector('h4').innerHTML = '✅ Feed XML ativo';
      card.querySelector('h4').style.color = '#065f46';
      card.querySelector('p').innerHTML = `<span id="feed-status-count">${total}</span> imóveis publicados estão sendo expostos aos portais. URLs prontas pra colar no painel de cada portal.`;
    }
  } catch (err) {
    countEl.textContent = '—';
    console.warn('Erro ao carregar status do feed:', err);
  }
}

function previewFeedXml() {
  const url = buildFeedUrl('wimoveis');
  if (!url) {
    alert('Configure a URL do Worker em Configurações → XML Feed primeiro.');
    return;
  }
  window.open(url, '_blank');
}

// ---------- Upload da logo do tenant ----------

async function uploadLogoTenant() {
  const input = $('cfg-logo-input');
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 1024 * 1024) {
    showAlert('cfg-alert', 'Arquivo excede 1MB.');
    return;
  }

  try {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `tenants/${State.tenant.id}/branding/logo.${ext}`;
    const ref = storage.ref().child(path);
    await ref.put(file, { contentType: file.type, customMetadata: { uploadedBy: State.user.uid } });
    const url = await ref.getDownloadURL();

    await tenantPath().update({ logoUrl: url, logoPath: path });
    State.tenant.logoUrl = url;
    State.tenant.logoPath = path;

    // Aplica em toda a UI
    $('cfg-logo-img').src = url;
    aplicarLogoTenant();
    $('btn-remover-logo').style.display = 'inline-block';
    input.value = '';
    showAlert('cfg-alert', '✓ Logo atualizada.', 'success');
    logAuditoria('update', 'config', 'logo', { acao: 'logo_atualizada' });
  } catch (err) {
    console.error('Erro upload logo:', err);
    showAlert('cfg-alert', 'Erro: ' + err.message);
  }
}

async function removerLogoTenant() {
  if (!confirm('Voltar pra logo padrão (D.R. Global)?')) return;
  try {
    // Apaga do storage se possível
    if (State.tenant.logoPath) {
      try { await storage.ref().child(State.tenant.logoPath).delete(); } catch (_) {}
    }
    await tenantPath().update({
      logoUrl: firebase.firestore.FieldValue.delete(),
      logoPath: firebase.firestore.FieldValue.delete(),
    });
    State.tenant.logoUrl = null;
    State.tenant.logoPath = null;
    $('cfg-logo-img').src = 'logo.png';
    aplicarLogoTenant();
    $('btn-remover-logo').style.display = 'none';
    showAlert('cfg-alert', 'Logo padrão restaurada.', 'success');
    logAuditoria('update', 'config', 'logo', { acao: 'logo_removida' });
  } catch (err) {
    showAlert('cfg-alert', 'Erro: ' + err.message);
  }
}

function aplicarLogoTenant() {
  // No modo SaaS (equipe DRG no painel Super Admin sem atuar como tenant),
  // sempre exibe a logo D.R. Global padrão — não a logo customizada do tenant.
  const navegandoPainelSaaS = State.isSuperAdmin && !State.tenantOriginal && State.currentSection === 'superadmin';
  const semTenantAtivo = State.isSuperAdmin && !State.tenantOriginal && !State.tenant;
  const modoSaaS = navegandoPainelSaaS || semTenantAtivo;

  const url = modoSaaS ? 'logo.png' : (State.tenant?.logoUrl || 'logo.png');
  document.querySelectorAll('.brand-logo, .auth-logo').forEach(img => { img.src = url; });
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
      logAuditoria('update', 'contrato', id, { status: data.status, aluguel: data.aluguel });
    } else {
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('contratos').add(data);
      contratoId = docRef.id;
      logAuditoria('create', 'contrato', contratoId, { status: data.status, aluguel: data.aluguel });
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
// Pula a sincronização se o imóvel tem múltiplas unidades (caso de prédio de kitnet).
async function syncImovelStatusFromContrato(imovelId, statusNovo, statusAnterior) {
  if (!imovelId) return;
  const imovelRef = tenantPath().collection('imoveis').doc(imovelId);
  // Verifica flag multiplasUnidades antes de mexer no status
  try {
    const snap = await imovelRef.get();
    if (snap.exists && snap.data().multiplasUnidades) return; // skip
  } catch (_) {}

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
    logAuditoria('delete', 'contrato', id);
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
// IMPORTAÇÃO CSV — cadastro em massa
// =============================================================

const IMPORT_SCHEMAS = {
  locadores: {
    label: 'Locadores',
    cols: ['tipo','nome','documento','rg','nascimento','estado_civil','profissao','email','telefone','cep','logradouro','numero','complemento','bairro','cidade','uf','pix','banco','obs'],
    sample: ['PF','João Silva','12345678901','12345678','1980-05-15','casado','Engenheiro','joao@exemplo.com','11999998888','01310100','Av. Paulista','100','Apto 50','Bela Vista','São Paulo','SP','12345678901','341 / 1234 / 56789-0','Cliente preferencial'],
    obrigatorios: ['tipo','nome','documento'],
  },
  locatarios: {
    label: 'Locatários',
    cols: ['tipo','nome','documento','rg','nascimento','estado_civil','profissao','email','telefone','cep','logradouro','numero','complemento','bairro','cidade','uf','empresa','cargo','renda','dependentes','status','obs'],
    sample: ['PF','Maria Santos','98765432101','98765432','1990-03-22','solteiro','Analista','maria@exemplo.com','11988887777','04567000','Rua das Flores','200','','Vila Mariana','São Paulo','SP','Empresa X','Gerente','8500','0','aprovado','Boa pagadora'],
    obrigatorios: ['tipo','nome','documento'],
  },
  imoveis: {
    label: 'Imóveis',
    cols: ['apelido','tipo','subtipo','finalidade','cep','logradouro','numero','complemento','bairro','cidade','uf','area_util','area_total','quartos','banheiros','vagas','mobiliado','andar','matricula','iptu','valor_mercado','aluguel_sugerido','valor_venda','locador_email','obs'],
    sample: ['Apto 301 Solar do Lago','residencial','apartamento','locacao','01310100','Av. Paulista','100','Apto 301','Bela Vista','São Paulo','SP','75','85','2','1','1','nao','3','12345-RI','98765432','450000','2500','','joao@exemplo.com','Pronto para alugar'],
    obrigatorios: ['apelido','tipo','locador_email'],
  },
};

let _importParsed = null; // { rows, errosPorLinha, valid }

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 1) return { header: [], rows: [] };
  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current); current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  };
  const header = parseLine(lines[0]).map(h => h.trim().toLowerCase().replace(/^﻿/, ''));
  const rows = lines.slice(1).map(l => {
    const cols = parseLine(l);
    const obj = {};
    header.forEach((h, i) => { obj[h] = (cols[i] || '').trim(); });
    return obj;
  });
  return { header, rows };
}

function onImportTipoChange() {
  cancelarImportacao();
}

function baixarTemplateImport() {
  const tipo = $('import-tipo').value;
  const sch = IMPORT_SCHEMAS[tipo];
  if (!sch) return;
  const csv = [sch.cols.join(','), sch.sample.map(v => {
    const s = String(v);
    if (s.includes(',') || s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }).join(',')].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `template_${tipo}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function processarArquivoImport() {
  const file = $('import-arquivo').files?.[0];
  if (!file) return;
  const tipo = $('import-tipo').value;
  const sch = IMPORT_SCHEMAS[tipo];
  if (!sch) return;

  const text = await file.text();
  const { header, rows } = parseCSV(text);

  if (rows.length === 0) { alert('Arquivo vazio ou sem dados.'); return; }
  if (rows.length > 100) { alert('Limite de 100 linhas por importação. Divida o arquivo.'); return; }

  // Valida cada linha
  const errosPorLinha = rows.map(row => {
    const erros = [];
    sch.obrigatorios.forEach(col => {
      if (!row[col] || row[col].trim() === '') erros.push(`Campo obrigatório '${col}' vazio`);
    });
    if (row.tipo && !['PF','PJ'].includes(row.tipo.toUpperCase())) erros.push('Tipo deve ser PF ou PJ');
    return erros;
  });

  _importParsed = { tipo, schema: sch, rows, errosPorLinha };
  renderImportPreview();
}

function renderImportPreview() {
  const { tipo, schema, rows, errosPorLinha } = _importParsed;
  $('import-preview-container').style.display = 'block';
  $('import-preview-titulo').textContent = `Pré-visualização — ${schema.label} (${rows.length} linhas)`;

  const totalValidas = errosPorLinha.filter(e => e.length === 0).length;
  const totalErros = rows.length - totalValidas;

  $('import-stats').innerHTML = `
    <div class="linha"><span>Linhas válidas (serão importadas)</span><strong style="color:#15803d;">${totalValidas}</strong></div>
    <div class="linha"><span>Linhas com erro (serão ignoradas)</span><strong style="color:#b91c1c;">${totalErros}</strong></div>
    <div class="linha final"><span>Total no arquivo</span><strong>${rows.length}</strong></div>
  `;

  const cols = schema.cols.slice(0, 6); // mostra 6 primeiras pra caber
  $('import-thead').innerHTML = '<tr>' +
    '<th style="width:30px;">#</th>' +
    '<th style="width:60px;">Status</th>' +
    cols.map(c => `<th>${c}</th>`).join('') +
    '<th>Erros</th></tr>';

  $('import-tbody').innerHTML = rows.map((r, i) => {
    const erros = errosPorLinha[i];
    const ok = erros.length === 0;
    const statusBadge = ok
      ? '<span style="color:#15803d;">✓</span>'
      : '<span style="color:#b91c1c;">✗</span>';
    return `<tr style="${ok ? '' : 'background: var(--danger-light);'}">
      <td>${i + 2}</td>
      <td>${statusBadge}</td>
      ${cols.map(c => `<td>${(r[c] || '').slice(0, 40)}</td>`).join('')}
      <td style="color:var(--danger); font-size:11px;">${erros.join('; ') || '—'}</td>
    </tr>`;
  }).join('');

  $('btn-confirmar-import').disabled = totalValidas === 0;
  $('btn-confirmar-import').textContent = `✓ Importar ${totalValidas} linha(s) válida(s)`;
}

function cancelarImportacao() {
  _importParsed = null;
  $('import-preview-container').style.display = 'none';
  $('import-arquivo').value = '';
}

async function confirmarImportacao() {
  if (!_importParsed) return;
  const { tipo, schema, rows, errosPorLinha } = _importParsed;

  const validas = rows.filter((_, i) => errosPorLinha[i].length === 0);
  if (validas.length === 0) { alert('Nenhuma linha válida pra importar.'); return; }

  if (!confirm(`Importar ${validas.length} registro(s) de ${schema.label}? Esta ação não pode ser desfeita.`)) return;

  const btn = $('btn-confirmar-import');
  btn.disabled = true; btn.textContent = 'Importando…';

  let sucesso = 0, falhas = 0;

  try {
    // Pra imóveis, precisa resolver locador_email → locadorId
    let locadorByEmail = {};
    if (tipo === 'imoveis') {
      const locs = await ensureLocadoresCache();
      locadorByEmail = Object.fromEntries(locs.filter(l => l.email).map(l => [l.email.toLowerCase(), l.id]));
    }

    for (const row of validas) {
      try {
        if (tipo === 'locadores') {
          await tenantPath().collection('locadores').add({
            tipo: row.tipo.toUpperCase(),
            nome: row.nome,
            documento: row.documento.replace(/\D/g, ''),
            rg: row.rg || null,
            nascimento: row.nascimento || null,
            estadoCivil: row.estado_civil || null,
            profissao: row.profissao || null,
            email: row.email || null,
            telefone: row.telefone ? row.telefone.replace(/\D/g, '') : null,
            endereco: {
              cep: row.cep ? row.cep.replace(/\D/g, '') : null,
              logradouro: row.logradouro || null,
              numero: row.numero || null,
              complemento: row.complemento || null,
              bairro: row.bairro || null,
              cidade: row.cidade || null,
              uf: row.uf ? row.uf.toUpperCase() : null,
            },
            pix: row.pix || null,
            banco: row.banco || null,
            obs: row.obs || null,
            criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
            criadoPor: State.user.uid,
            importadoEm: firebase.firestore.FieldValue.serverTimestamp(),
          });
        } else if (tipo === 'locatarios') {
          await tenantPath().collection('locatarios').add({
            tipo: row.tipo.toUpperCase(),
            nome: row.nome,
            documento: row.documento.replace(/\D/g, ''),
            rg: row.rg || null,
            nascimento: row.nascimento || null,
            estadoCivil: row.estado_civil || null,
            profissao: row.profissao || null,
            email: row.email || null,
            telefone: row.telefone ? row.telefone.replace(/\D/g, '') : null,
            endereco: {
              cep: row.cep ? row.cep.replace(/\D/g, '') : null,
              logradouro: row.logradouro || null,
              numero: row.numero || null,
              complemento: row.complemento || null,
              bairro: row.bairro || null,
              cidade: row.cidade || null,
              uf: row.uf ? row.uf.toUpperCase() : null,
            },
            empresa: row.empresa || null,
            cargo: row.cargo || null,
            renda: parseFloat(row.renda) || null,
            dependentes: parseInt(row.dependentes, 10) || 0,
            status: row.status || 'pendente_analise',
            obs: row.obs || null,
            criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
            criadoPor: State.user.uid,
            importadoEm: firebase.firestore.FieldValue.serverTimestamp(),
          });
        } else if (tipo === 'imoveis') {
          const locadorId = locadorByEmail[(row.locador_email || '').toLowerCase()];
          if (!locadorId) { falhas++; continue; }
          await tenantPath().collection('imoveis').add({
            apelido: row.apelido,
            tipo: row.tipo || 'residencial',
            subtipo: row.subtipo || null,
            finalidade: row.finalidade || 'locacao',
            locadorId,
            endereco: {
              cep: row.cep ? row.cep.replace(/\D/g, '') : null,
              logradouro: row.logradouro || null,
              numero: row.numero || null,
              complemento: row.complemento || null,
              bairro: row.bairro || null,
              cidade: row.cidade || null,
              uf: row.uf ? row.uf.toUpperCase() : null,
            },
            areaUtil: parseFloat(row.area_util) || null,
            areaTotal: parseFloat(row.area_total) || null,
            quartos: parseInt(row.quartos, 10) || 0,
            banheiros: parseInt(row.banheiros, 10) || 0,
            vagas: parseInt(row.vagas, 10) || 0,
            mobiliado: row.mobiliado || 'nao',
            andar: row.andar || null,
            matricula: row.matricula || null,
            iptu: row.iptu || null,
            valorMercado: parseFloat(row.valor_mercado) || null,
            aluguelSugerido: parseFloat(row.aluguel_sugerido) || null,
            valorVenda: parseFloat(row.valor_venda) || null,
            status: 'disponivel',
            obs: row.obs || null,
            criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
            criadoPor: State.user.uid,
            importadoEm: firebase.firestore.FieldValue.serverTimestamp(),
          });
        }
        sucesso++;
      } catch (err) {
        console.error('Erro na linha:', err, row);
        falhas++;
      }
    }

    // Invalidar caches
    if (tipo === 'locadores') invalidateLocadoresCache();
    if (tipo === 'locatarios') invalidateLocatariosCache();
    if (tipo === 'imoveis') invalidateImoveisCache();

    logAuditoria('create', tipo === 'imoveis' ? 'imovel' : tipo.slice(0, -1), null, { importacao: true, sucesso, falhas });

    alert(`✓ Importação concluída.\n${sucesso} registro(s) criado(s).\n${falhas} falha(s).`);
    cancelarImportacao();
  } catch (err) {
    console.error('Erro na importação:', err);
    alert('Erro: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

// =============================================================
// ALERTAS — pendências e situações que exigem atenção
// =============================================================

function diasEntre(d1, d2) {
  return Math.floor((d2.getTime() - d1.getTime()) / 86400000);
}

async function loadAlertas() {
  const container = $('alertas-container');
  if (!container || !State.tenant) return;
  container.innerHTML = '<p class="muted">Carregando alertas…</p>';

  try {
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();

    const [contratosSnap, locatariosSnap, imoveisSnap, negociacoesSnap, balancetesMesSnap, fotosByImovel] = await Promise.all([
      tenantPath().collection('contratos').get(),
      tenantPath().collection('locatarios').get(),
      tenantPath().collection('imoveis').get(),
      tenantPath().collection('negociacoes').get(),
      tenantPath().collection('balancetes').where('mes', '==', mesAtual).where('ano', '==', anoAtual).get(),
      // contagem de fotos por imóvel publicado
      (async () => {
        const imSnap = await tenantPath().collection('imoveis').where('linkPublico', '==', true).get();
        const result = {};
        for (const d of imSnap.docs) {
          try {
            const fSnap = await tenantPath().collection('imoveis').doc(d.id).collection('fotos').limit(1).get();
            result[d.id] = !fSnap.empty;
          } catch (_) { result[d.id] = false; }
        }
        return result;
      })(),
    ]);

    const imovelMap = Object.fromEntries(imoveisSnap.docs.map(d => [d.id, d.data().apelido]));

    // CRÍTICOS
    const criticos = [];

    // Contratos vencendo em <= 30 dias
    contratosSnap.docs.forEach(d => {
      const c = d.data();
      if (c.status !== 'vigente' || !c.fim) return;
      const fimDt = new Date(c.fim + 'T00:00:00');
      const dias = diasEntre(hoje, fimDt);
      if (dias < 0) {
        criticos.push({ icone: '⏰', titulo: `Contrato VENCIDO há ${Math.abs(dias)} dias`, sub: imovelMap[c.imovelId] || '—', secao: 'contratos', id: d.id });
      } else if (dias <= 30) {
        criticos.push({ icone: '⏳', titulo: `Contrato vence em ${dias} dias`, sub: imovelMap[c.imovelId] || '—', secao: 'contratos', id: d.id });
      }
    });

    // ATENÇÃO
    const atencao = [];

    // Contratos vencendo em 31-90 dias
    contratosSnap.docs.forEach(d => {
      const c = d.data();
      if (c.status !== 'vigente' || !c.fim) return;
      const fimDt = new Date(c.fim + 'T00:00:00');
      const dias = diasEntre(hoje, fimDt);
      if (dias > 30 && dias <= 90) {
        atencao.push({ icone: '📅', titulo: `Contrato vence em ${dias} dias`, sub: imovelMap[c.imovelId] || '—', secao: 'contratos', id: d.id });
      }
    });

    // Locatários pendentes
    locatariosSnap.docs.forEach(d => {
      const l = d.data();
      if (l.status !== 'pendente_analise') return;
      const criado = l.criadoEm?.toDate ? l.criadoEm.toDate() : null;
      const dias = criado ? diasEntre(criado, hoje) : 0;
      if (dias >= 5) {
        atencao.push({ icone: '⏳', titulo: `Locatário pendente de análise há ${dias} dias`, sub: l.nome || '—', secao: 'locatarios', id: d.id });
      }
    });

    // Negociações em aberto há mais de 15 dias
    negociacoesSnap.docs.forEach(d => {
      const n = d.data();
      if (n.status !== 'em_negociacao' && n.status !== 'aceita') return;
      const criado = n.criadoEm?.toDate ? n.criadoEm.toDate() : null;
      const dias = criado ? diasEntre(criado, hoje) : 0;
      if (dias >= 15) {
        atencao.push({ icone: '🤝', titulo: `Negociação aberta há ${dias} dias`, sub: imovelMap[n.imovelId] || '—', secao: 'negociacoes', id: d.id });
      }
    });

    // INFORMATIVO
    const info = [];

    // Imóveis publicados sem fotos
    Object.entries(fotosByImovel).forEach(([imId, temFoto]) => {
      if (!temFoto) {
        info.push({ icone: '📷', titulo: 'Imóvel publicado sem fotos', sub: imovelMap[imId] || '—', secao: 'imoveis', id: imId });
      }
    });

    // Contratos vigentes sem balancete no mês corrente
    const balancetesPorContrato = new Set(balancetesMesSnap.docs.map(d => d.data().contratoId));
    contratosSnap.docs.forEach(d => {
      const c = d.data();
      if (c.status !== 'vigente') return;
      if (!balancetesPorContrato.has(d.id)) {
        info.push({ icone: '💰', titulo: 'Sem balancete deste mês', sub: imovelMap[c.imovelId] || '—', secao: 'balancetes', id: null });
      }
    });

    // Render
    container.innerHTML = renderGrupoAlertas('Críticos', 'critico', criticos)
      + renderGrupoAlertas('Atenção', 'atencao', atencao)
      + renderGrupoAlertas('Informativo', 'info', info);

  } catch (err) {
    console.error('Erro ao carregar alertas:', err);
    container.innerHTML = `<p style="color:var(--danger);">Erro: ${err.message}</p>`;
  }
}

function renderGrupoAlertas(titulo, tipo, lista) {
  if (lista.length === 0) {
    return `<div class="alerta-grupo alerta-grupo-${tipo}">
      <div class="alerta-grupo-titulo">${titulo} (0)</div>
      <div class="alerta-vazio">Nenhum alerta nesta categoria.</div>
    </div>`;
  }
  return `<div class="alerta-grupo alerta-grupo-${tipo}">
    <div class="alerta-grupo-titulo">${titulo} (${lista.length})</div>
    ${lista.map(a => `
      <div class="alerta-card ${tipo}" onclick="showSection('${a.secao}')">
        <span class="alerta-icone">${a.icone}</span>
        <div class="alerta-conteudo">
          <div class="alerta-titulo">${a.titulo}</div>
          <div class="alerta-sub">${a.sub}</div>
        </div>
      </div>
    `).join('')}
  </div>`;
}

// =============================================================
// RELATÓRIOS — análises e exportações CSV
// =============================================================

let _relatorioDados = null; // pra export CSV

function initRelatorioFiltros() {
  const hoje = new Date();
  if (!$('relatorio-mes').value) $('relatorio-mes').value = hoje.getMonth() + 1;
  if (!$('relatorio-ano').value) $('relatorio-ano').value = hoje.getFullYear();
}

async function loadRelatorio() {
  const tipo = $('relatorio-tipo').value;
  const thead = $('thead-relatorio');
  const tbody = $('tbody-relatorio');
  const resumo = $('relatorio-resumo');
  resumo.style.display = 'none';
  thead.innerHTML = ''; tbody.innerHTML = `<tr><td colspan="6" class="empty">Carregando…</td></tr>`;

  // Mostra/esconde filtro de imóvel só pra histórico
  $('relatorio-imovel-grupo').style.display = (tipo === 'historico_imovel') ? 'block' : 'none';
  if (tipo === 'historico_imovel') {
    await populateRelatorioImovel();
  }

  try {
    if (tipo === 'faturamento') await relatorioFaturamento();
    else if (tipo === 'receita_imobiliaria') await relatorioReceitaImobiliaria();
    else if (tipo === 'balancetes_pendentes') await relatorioBalancetesPendentes();
    else if (tipo === 'contratos_vigentes') await relatorioContratosVigentes();
    else if (tipo === 'locatarios_status') await relatorioLocatariosStatus();
    else if (tipo === 'imoveis_status') await relatorioImoveisStatus();
    else if (tipo === 'historico_imovel') await relatorioHistoricoImovel();
  } catch (err) {
    console.error('Erro no relatório:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

async function populateRelatorioImovel() {
  const sel = $('relatorio-imovel');
  if (sel.options.length > 0) return;
  const imoveis = await ensureImoveisCache();
  sel.innerHTML = '<option value="">— Selecione —</option>' +
    imoveis.map(i => `<option value="${i.id}">${i.apelido}</option>`).join('');
}

async function relatorioFaturamento() {
  const mes = parseInt($('relatorio-mes').value, 10);
  const ano = parseInt($('relatorio-ano').value, 10);
  const [snap, imoveis, locadores] = await Promise.all([
    tenantPath().collection('balancetes').where('mes', '==', mes).where('ano', '==', ano).get(),
    ensureImoveisCache(),
    ensureLocadoresCache(),
  ]);
  const imMap = Object.fromEntries(imoveis.map(i => [i.id, i.apelido]));
  const locMap = Object.fromEntries(locadores.map(l => [l.id, l.nome]));

  const linhas = snap.docs.map(d => {
    const b = d.data();
    return {
      imovel: imMap[b.imovelId] || '—',
      locador: locMap[b.locadorId] || '—',
      aluguel: b.aluguelBase || 0,
      entradas: b.totalEntradas || 0,
      despesas: b.totalDespesasLocador || 0,
      taxaAdm: b.taxaAdmValor || 0,
      liquido: b.liquidoLocador || 0,
      status: BALANCETE_STATUS_LABEL[b.status] || b.status,
    };
  });
  const totalLiquido = linhas.reduce((acc, l) => acc + l.liquido, 0);
  const totalTaxa = linhas.reduce((acc, l) => acc + l.taxaAdm, 0);

  $('thead-relatorio').innerHTML = `<tr>
    <th>Imóvel</th><th>Locador</th><th class="valor">Aluguel</th>
    <th class="valor">Entradas</th><th class="valor">Despesas</th>
    <th class="valor">Taxa Adm</th><th class="valor">Líquido</th><th>Status</th>
  </tr>`;
  $('tbody-relatorio').innerHTML = linhas.length === 0
    ? '<tr><td colspan="8" class="empty">Sem balancetes neste período.</td></tr>'
    : linhas.map(l => `<tr>
        <td>${l.imovel}</td><td>${l.locador}</td>
        <td class="valor">${fmtBRL(l.aluguel)}</td>
        <td class="valor">${fmtBRL(l.entradas)}</td>
        <td class="valor">${fmtBRL(l.despesas)}</td>
        <td class="valor">${fmtBRL(l.taxaAdm)}</td>
        <td class="valor"><strong>${fmtBRL(l.liquido)}</strong></td>
        <td>${l.status}</td>
      </tr>`).join('');

  $('relatorio-resumo').style.display = 'block';
  $('relatorio-resumo').innerHTML = `
    <div class="linha"><span>Total repassado aos locadores</span><strong>${fmtBRL(totalLiquido)}</strong></div>
    <div class="linha"><span>Total de taxa de administração</span><strong>${fmtBRL(totalTaxa)}</strong></div>
    <div class="linha final"><span>${linhas.length} balancete(s) no período</span><strong>${fmtBRL(totalLiquido + totalTaxa)} movimentado</strong></div>
  `;

  _relatorioDados = { titulo: `Faturamento ${fmtMesAno(mes, ano)}`, cabecalho: ['Imóvel','Locador','Aluguel','Entradas','Despesas','Taxa Adm','Líquido','Status'], linhas: linhas.map(l => [l.imovel, l.locador, l.aluguel, l.entradas, l.despesas, l.taxaAdm, l.liquido, l.status]) };
}

async function relatorioReceitaImobiliaria() {
  const mes = parseInt($('relatorio-mes').value, 10);
  const ano = parseInt($('relatorio-ano').value, 10);
  const [snap, imoveis] = await Promise.all([
    tenantPath().collection('balancetes').where('mes', '==', mes).where('ano', '==', ano).get(),
    ensureImoveisCache(),
  ]);
  const imMap = Object.fromEntries(imoveis.map(i => [i.id, i.apelido]));
  const linhas = snap.docs.map(d => {
    const b = d.data();
    return { imovel: imMap[b.imovelId] || '—', aluguel: b.aluguelBase || 0, taxaPercent: b.taxaAdm || 0, taxaValor: b.taxaAdmValor || 0 };
  });
  const total = linhas.reduce((acc, l) => acc + l.taxaValor, 0);
  $('thead-relatorio').innerHTML = '<tr><th>Imóvel</th><th class="valor">Aluguel base</th><th class="valor">Taxa %</th><th class="valor">Receita imobiliária</th></tr>';
  $('tbody-relatorio').innerHTML = linhas.length === 0
    ? '<tr><td colspan="4" class="empty">Sem balancetes neste período.</td></tr>'
    : linhas.map(l => `<tr><td>${l.imovel}</td><td class="valor">${fmtBRL(l.aluguel)}</td><td class="valor">${l.taxaPercent}%</td><td class="valor"><strong>${fmtBRL(l.taxaValor)}</strong></td></tr>`).join('');
  $('relatorio-resumo').style.display = 'block';
  $('relatorio-resumo').innerHTML = `<div class="linha final"><span>Receita total da imobiliária no período</span><strong>${fmtBRL(total)}</strong></div>`;
  _relatorioDados = { titulo: `Receita Imobiliaria ${fmtMesAno(mes, ano)}`, cabecalho: ['Imóvel','Aluguel base','Taxa %','Receita'], linhas: linhas.map(l => [l.imovel, l.aluguel, l.taxaPercent, l.taxaValor]) };
}

async function relatorioBalancetesPendentes() {
  const mes = parseInt($('relatorio-mes').value, 10);
  const ano = parseInt($('relatorio-ano').value, 10);
  const [snap, imoveis] = await Promise.all([
    tenantPath().collection('balancetes').where('mes', '==', mes).where('ano', '==', ano).get(),
    ensureImoveisCache(),
  ]);
  const imMap = Object.fromEntries(imoveis.map(i => [i.id, i.apelido]));
  const linhas = snap.docs.filter(d => d.data().status !== 'enviado').map(d => {
    const b = d.data();
    return { imovel: imMap[b.imovelId] || '—', status: BALANCETE_STATUS_LABEL[b.status] || b.status, liquido: b.liquidoLocador || 0 };
  });
  $('thead-relatorio').innerHTML = '<tr><th>Imóvel</th><th>Status</th><th class="valor">Líquido</th></tr>';
  $('tbody-relatorio').innerHTML = linhas.length === 0
    ? '<tr><td colspan="3" class="empty">Todos os balancetes foram enviados. 🎉</td></tr>'
    : linhas.map(l => `<tr><td>${l.imovel}</td><td>${l.status}</td><td class="valor">${fmtBRL(l.liquido)}</td></tr>`).join('');
  _relatorioDados = { titulo: `Balancetes Pendentes ${fmtMesAno(mes, ano)}`, cabecalho: ['Imóvel','Status','Líquido'], linhas: linhas.map(l => [l.imovel, l.status, l.liquido]) };
}

async function relatorioContratosVigentes() {
  const [snap, imoveis, locatarios] = await Promise.all([
    tenantPath().collection('contratos').where('status', '==', 'vigente').get(),
    ensureImoveisCache(),
    ensureLocatariosCache(),
  ]);
  const imMap = Object.fromEntries(imoveis.map(i => [i.id, i.apelido]));
  const locMap = Object.fromEntries(locatarios.map(l => [l.id, l.nome]));
  const linhas = snap.docs.map(d => {
    const c = d.data();
    return {
      imovel: imMap[c.imovelId] || '—',
      locatario: locMap[c.locatarioId] || '—',
      inicio: c.inicio ? fmtDataBR(c.inicio) : '—',
      fim: c.fim ? fmtDataBR(c.fim) : '—',
      aluguel: c.aluguel || 0,
    };
  });
  const totalAluguel = linhas.reduce((acc, l) => acc + l.aluguel, 0);
  $('thead-relatorio').innerHTML = '<tr><th>Imóvel</th><th>Locatário</th><th>Início</th><th>Fim</th><th class="valor">Aluguel</th></tr>';
  $('tbody-relatorio').innerHTML = linhas.length === 0
    ? '<tr><td colspan="5" class="empty">Nenhum contrato vigente.</td></tr>'
    : linhas.map(l => `<tr><td>${l.imovel}</td><td>${l.locatario}</td><td>${l.inicio}</td><td>${l.fim}</td><td class="valor">${fmtBRL(l.aluguel)}</td></tr>`).join('');
  $('relatorio-resumo').style.display = 'block';
  $('relatorio-resumo').innerHTML = `<div class="linha final"><span>${linhas.length} contrato(s) vigentes · Faturamento mensal total</span><strong>${fmtBRL(totalAluguel)}</strong></div>`;
  _relatorioDados = { titulo: 'Contratos Vigentes', cabecalho: ['Imóvel','Locatário','Início','Fim','Aluguel'], linhas: linhas.map(l => [l.imovel, l.locatario, l.inicio, l.fim, l.aluguel]) };
}

async function relatorioLocatariosStatus() {
  const snap = await tenantPath().collection('locatarios').get();
  const grupos = { aprovado: 0, reprovado: 0, pendente_analise: 0 };
  const linhas = snap.docs.map(d => { const l = d.data(); grupos[l.status] = (grupos[l.status] || 0) + 1; return l; });
  $('thead-relatorio').innerHTML = '<tr><th>Status</th><th class="valor">Quantidade</th></tr>';
  $('tbody-relatorio').innerHTML = Object.entries(grupos).map(([s, q]) => `<tr><td>${LOCATARIO_STATUS_LABEL[s] || s}</td><td class="valor">${q}</td></tr>`).join('');
  $('relatorio-resumo').style.display = 'block';
  $('relatorio-resumo').innerHTML = `<div class="linha final"><span>Total de locatários cadastrados</span><strong>${linhas.length}</strong></div>`;
  _relatorioDados = { titulo: 'Locatários por Status', cabecalho: ['Status','Quantidade'], linhas: Object.entries(grupos).map(([s, q]) => [LOCATARIO_STATUS_LABEL[s] || s, q]) };
}

async function relatorioImoveisStatus() {
  const snap = await tenantPath().collection('imoveis').get();
  const grupos = {};
  snap.docs.forEach(d => { const s = d.data().status || 'disponivel'; grupos[s] = (grupos[s] || 0) + 1; });
  $('thead-relatorio').innerHTML = '<tr><th>Status</th><th class="valor">Quantidade</th></tr>';
  $('tbody-relatorio').innerHTML = Object.entries(grupos).map(([s, q]) => `<tr><td>${IMOVEL_STATUS_LABEL[s] || s}</td><td class="valor">${q}</td></tr>`).join('');
  $('relatorio-resumo').style.display = 'block';
  $('relatorio-resumo').innerHTML = `<div class="linha final"><span>Total de imóveis</span><strong>${snap.size}</strong></div>`;
  _relatorioDados = { titulo: 'Imóveis por Status', cabecalho: ['Status','Quantidade'], linhas: Object.entries(grupos).map(([s, q]) => [IMOVEL_STATUS_LABEL[s] || s, q]) };
}

async function relatorioHistoricoImovel() {
  const imovelId = $('relatorio-imovel').value;
  const thead = $('thead-relatorio');
  const tbody = $('tbody-relatorio');
  if (!imovelId) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Selecione um imóvel.</td></tr>';
    return;
  }
  const snap = await tenantPath().collection('balancetes').where('imovelId', '==', imovelId).get();
  const linhas = snap.docs.map(d => d.data()).sort((a, b) => (b.ano - a.ano) || (b.mes - a.mes));
  const totalLiquido = linhas.reduce((acc, b) => acc + (b.liquidoLocador || 0), 0);
  thead.innerHTML = '<tr><th>Mês/Ano</th><th class="valor">Aluguel</th><th class="valor">Despesas</th><th class="valor">Líquido</th><th>Status</th></tr>';
  tbody.innerHTML = linhas.length === 0
    ? '<tr><td colspan="5" class="empty">Sem histórico para este imóvel.</td></tr>'
    : linhas.map(b => `<tr>
        <td>${fmtMesAno(b.mes, b.ano)}</td>
        <td class="valor">${fmtBRL(b.aluguelBase)}</td>
        <td class="valor">${fmtBRL(b.totalDespesasLocador)}</td>
        <td class="valor"><strong>${fmtBRL(b.liquidoLocador)}</strong></td>
        <td>${BALANCETE_STATUS_LABEL[b.status] || b.status}</td>
      </tr>`).join('');
  $('relatorio-resumo').style.display = 'block';
  $('relatorio-resumo').innerHTML = `<div class="linha final"><span>${linhas.length} balancete(s) · Total repassado historicamente</span><strong>${fmtBRL(totalLiquido)}</strong></div>`;
  _relatorioDados = { titulo: 'Histórico de Imóvel', cabecalho: ['Mês/Ano','Aluguel','Despesas','Líquido','Status'], linhas: linhas.map(b => [fmtMesAno(b.mes, b.ano), b.aluguelBase, b.totalDespesasLocador, b.liquidoLocador, BALANCETE_STATUS_LABEL[b.status] || b.status]) };
}

function exportarRelatorioCsv() {
  if (!_relatorioDados) { alert('Nenhum relatório carregado.'); return; }
  const { titulo, cabecalho, linhas } = _relatorioDados;
  const escape = v => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = [cabecalho.join(','), ...linhas.map(l => l.map(escape).join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${titulo.replace(/[^a-zA-Z0-9_-]+/g, '_')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// =============================================================
// AUDITORIA — log de ações sensíveis (LGPD)
// =============================================================

// Registra uma ação no log de auditoria do tenant.
// Falha silenciosamente pra não impactar o fluxo principal do usuário.
async function logAuditoria(acao, entidade, entidadeId, detalhe = null) {
  if (!State.tenant || !State.user) return;
  try {
    const safeDetalhe = detalhe ? JSON.parse(JSON.stringify(detalhe).slice(0, 5000)) : null;
    await tenantPath().collection('auditoria').add({
      acao,           // 'create' | 'update' | 'delete' | 'login' | 'send_email' | 'gerar_contrato'
      entidade,       // 'locador' | 'locatario' | 'imovel' | etc.
      entidadeId: entidadeId || null,
      userId: State.user.uid,
      userNome: State.userDoc?.nome || '',
      userEmail: State.user.email || '',
      userRole: State.userDoc?.role || '',
      detalhe: safeDetalhe,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn('Falha ao logar auditoria (' + acao + '/' + entidade + '):', err);
  }
}

// =============================================================
// TELEMETRIA — Modelo C (self-hosted)
// =============================================================
// Envia metadados não-pessoais pra o Super Admin da D.R. Global
// monitorar instalações self-hosted. Só dispara se a instância
// está rodando em um Firebase DIFERENTE do drg-rently principal.
//
// Dados coletados: projectId, tenantId, nome empresa, CNPJ,
// imoveisCount, usuariosCount, versão do app.
// NÃO coleta dados pessoais (LGPD ok).
//
// Cliente pode desabilitar com:
//   window.DISABLE_TELEMETRY = true;
// em firebase-config.js
// =============================================================

const TELEMETRIA_ENDPOINT = 'https://drg-rently-telemetria.zett-romao.workers.dev';
const SAAS_PRINCIPAL_PROJECT_ID = 'drg-rently';

async function enviarTelemetria() {
  if (window.DISABLE_TELEMETRY === true) return;
  if (!State.tenant) return;
  try {
    const projectId = firebase.app().options.projectId;
    if (projectId === SAAS_PRINCIPAL_PROJECT_ID) return; // SaaS principal já está no painel direto
    const [imSnap, usSnap] = await Promise.all([
      tenantPath().collection('imoveis').get().catch(() => ({ size: 0 })),
      db.collection('users').where('tenantId', '==', State.tenant.id).get().catch(() => ({ size: 0 })),
    ]);
    await fetch(TELEMETRIA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        tenantId: State.tenant.id,
        nome: State.tenant.nome || '',
        cnpj: State.tenant.cnpj || '',
        imoveisCount: imSnap.size || 0,
        usuariosCount: usSnap.size || 0,
        versao: APP_VERSION,
      }),
      keepalive: true,
    });
  } catch (_) {
    // Silently fail — telemetria não pode quebrar o app jamais
  }
}

const AUDIT_ACAO_LABEL = {
  create: '✚ Criação',
  update: '✎ Atualização',
  delete: '✗ Exclusão',
  login: '🔑 Login',
  send_email: '✉️ E-mail enviado',
  gerar_contrato: '📄 Contrato gerado',
  toggle_ativo: '🔄 Status alterado',
};

const AUDIT_ENTIDADE_LABEL = {
  locador: 'Locador',
  locatario: 'Locatário',
  comprador: 'Comprador',
  garantia: 'Garantia',
  imovel: 'Imóvel',
  contrato: 'Contrato',
  negociacao: 'Negociação',
  balancete: 'Balancete',
  usuario: 'Usuário',
  config: 'Configurações',
  sessao: 'Sessão',
};

async function loadAuditoria() {
  const tbody = $('tbody-auditoria');
  tbody.innerHTML = `<tr><td colspan="6" class="empty">Carregando…</td></tr>`;
  if (!State.tenant) { tbody.innerHTML = `<tr><td colspan="6" class="empty">—</td></tr>`; return; }

  const entFiltro = $('filtro-auditoria-entidade').value;
  const acFiltro = $('filtro-auditoria-acao').value;

  try {
    let q = tenantPath().collection('auditoria').orderBy('timestamp', 'desc').limit(200);
    const snap = await q.get();
    let docs = snap.docs;
    if (entFiltro) docs = docs.filter(d => d.data().entidade === entFiltro);
    if (acFiltro)  docs = docs.filter(d => d.data().acao === acFiltro);

    if (docs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhum registro encontrado.</td></tr>`;
      return;
    }

    const rows = docs.map(doc => {
      const a = doc.data();
      const dt = a.timestamp?.toDate ? a.timestamp.toDate() : null;
      const dataTxt = dt ? `${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR')}` : '—';
      const detalhe = a.detalhe ? (typeof a.detalhe === 'string' ? a.detalhe : JSON.stringify(a.detalhe).slice(0, 80) + '…') : '—';
      return `
        <tr>
          <td><span style="font-family:'Courier New',monospace; font-size:12px;">${dataTxt}</span></td>
          <td>${a.userNome || a.userEmail || '—'}</td>
          <td>${AUDIT_ACAO_LABEL[a.acao] || a.acao}</td>
          <td>${AUDIT_ENTIDADE_LABEL[a.entidade] || a.entidade}</td>
          <td><span style="font-family:'Courier New',monospace; font-size:11px; color:var(--text-muted);">${a.entidadeId || '—'}</span></td>
          <td style="font-size:11px; color:var(--text-muted); max-width:300px; overflow:hidden; text-overflow:ellipsis;">${detalhe}</td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join('');
  } catch (err) {
    console.error('Erro ao carregar auditoria:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

// =============================================================
// USUÁRIOS DO TENANT (operadores) — gerenciamento pelo admin
// =============================================================

function gerarSenhaAleatoria(len = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function gerarSenhaUsuario() {
  $('usuario-senha').value = gerarSenhaAleatoria(10);
}

// ----- Perfis customizados -----

async function loadPerfis() {
  const tbody = $('tbody-perfis');
  if (!tbody) return;
  if (!State.tenant) return;
  tbody.innerHTML = `<tr><td colspan="3" class="empty">Carregando…</td></tr>`;
  try {
    const snap = await tenantPath().collection('perfis').get();
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty">Nenhum perfil customizado. Operadores usam o padrão.</td></tr>`;
      return;
    }
    tbody.innerHTML = snap.docs.map(d => {
      const p = d.data();
      const modsLabel = (p.modulos || []).map(m => MODULOS_DISPONIVEIS.find(x => x.id === m)?.label || m).join(' · ') || '—';
      return `<tr>
        <td><strong>${p.nome || '—'}</strong></td>
        <td style="font-size:11px; color:var(--text-muted);">${modsLabel}</td>
        <td><button class="btn btn-sm btn-secondary" onclick="openPerfilModal('${d.id}')">Editar</button></td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

function renderPerfilModulosCheckboxes(selecionados = []) {
  const container = $('perfil-modulos-container');
  const grupos = {};
  MODULOS_DISPONIVEIS.forEach(m => {
    if (!grupos[m.grupo]) grupos[m.grupo] = [];
    grupos[m.grupo].push(m);
  });
  container.innerHTML = Object.entries(grupos).map(([grupo, mods]) => `
    <div class="perfil-grupo">
      <div class="perfil-grupo-titulo">${grupo}</div>
      <div class="perfil-grupo-itens">
        ${mods.map(m => `
          <label class="perfil-item-checkbox">
            <input type="checkbox" data-modulo="${m.id}" ${selecionados.includes(m.id) ? 'checked' : ''}>
            <span>${m.label}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

async function openPerfilModal(id) {
  clearAlert('perfil-alert');
  $('perfil-id').value = id || '';
  $('modal-perfil-title').textContent = id ? 'Editar perfil' : 'Novo perfil';
  $('btn-delete-perfil').style.display = id ? 'inline-block' : 'none';
  $('perfil-nome').value = '';

  let modulosSelecionados = OPERADOR_DEFAULT_MODULOS;
  if (id) {
    try {
      const snap = await tenantPath().collection('perfis').doc(id).get();
      if (snap.exists) {
        const p = snap.data();
        $('perfil-nome').value = p.nome || '';
        modulosSelecionados = p.modulos || [];
      }
    } catch (_) {}
  }

  renderPerfilModulosCheckboxes(modulosSelecionados);
  $('modal-perfil').style.display = 'flex';
}

function closePerfilModal() { $('modal-perfil').style.display = 'none'; }

async function savePerfil() {
  clearAlert('perfil-alert');
  const id = $('perfil-id').value;
  const nome = $('perfil-nome').value.trim();
  if (!nome) { showAlert('perfil-alert', 'Nome do perfil é obrigatório.'); return; }
  const modulos = Array.from(document.querySelectorAll('#perfil-modulos-container input[type="checkbox"]'))
    .filter(c => c.checked).map(c => c.dataset.modulo);

  try {
    if (id) {
      await tenantPath().collection('perfis').doc(id).update({ nome, modulos });
      logAuditoria('update', 'config', 'perfil:' + id, { nome });
    } else {
      const ref = await tenantPath().collection('perfis').add({
        nome, modulos,
        criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        criadoPor: State.user.uid,
      });
      logAuditoria('create', 'config', 'perfil:' + ref.id, { nome });
    }
    closePerfilModal();
    loadPerfis();
    showAlert('cfg-alert', 'Perfil salvo.', 'success');
  } catch (err) {
    showAlert('perfil-alert', 'Erro: ' + err.message);
  }
}

async function deletePerfil() {
  const id = $('perfil-id').value;
  if (!id) return;
  if (!confirm('Excluir este perfil? Usuários vinculados voltarão ao padrão.')) return;
  try {
    await tenantPath().collection('perfis').doc(id).delete();
    logAuditoria('delete', 'config', 'perfil:' + id);
    closePerfilModal();
    loadPerfis();
  } catch (err) {
    showAlert('perfil-alert', 'Erro: ' + err.message);
  }
}

async function populateUsuarioPerfilSelect() {
  const sel = $('usuario-perfil');
  sel.innerHTML = '<option value="">— Padrão (todos os cadastros e operação)</option>';
  try {
    const snap = await tenantPath().collection('perfis').get();
    sel.innerHTML += snap.docs.map(d => `<option value="${d.id}">${d.data().nome}</option>`).join('');
  } catch (_) {}
}

function onUsuarioRoleChange() {
  $('usuario-perfil-group').style.display = $('usuario-role').value === 'operador' ? 'block' : 'none';
}

async function loadUsuariosTenant() {
  const tbody = $('tbody-usuarios-tenant');
  if (!tbody) return;
  if (!State.tenant) { tbody.innerHTML = `<tr><td colspan="5" class="empty">—</td></tr>`; return; }

  tbody.innerHTML = `<tr><td colspan="5" class="empty">Carregando…</td></tr>`;
  try {
    const snap = await db.collection('users').where('tenantId', '==', State.tenant.id).get();
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">Nenhum usuário cadastrado.</td></tr>`;
      return;
    }
    const rows = snap.docs.map(doc => {
      const u = doc.data();
      const isSelf = doc.id === State.user.uid;
      const ativo = u.ativo !== false;
      const roleLabel = u.role === 'admin' ? 'Administrador' : 'Operador';
      const statusBadge = ativo
        ? '<span class="badge-status ativo">Ativo</span>'
        : '<span class="badge-status suspenso">Desativado</span>';
      const toggleLabel = ativo ? 'Desativar' : 'Reativar';
      const toggleClass = ativo ? 'btn-danger' : 'btn-primary';
      return `
        <tr>
          <td><strong>${u.nome || '—'}</strong>${isSelf ? ' <span class="muted" style="font-size:11px;">(você)</span>' : ''}</td>
          <td>${u.email || '—'}</td>
          <td>${roleLabel}</td>
          <td>${statusBadge}</td>
          <td>
            ${isSelf ? '<span class="muted" style="font-size:11px;">—</span>' : `
              <button class="btn btn-sm ${toggleClass}" onclick="toggleUsuarioAtivo('${doc.id}', ${!ativo})">${toggleLabel}</button>
            `}
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join('');
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    tbody.innerHTML = `<tr><td colspan="5" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

async function openUsuarioTenantModal() {
  clearAlert('usuario-alert');
  $('usuario-uid').value = '';
  $('usuario-nome').value = '';
  $('usuario-email').value = '';
  $('usuario-role').value = 'operador';
  $('usuario-senha').value = gerarSenhaAleatoria(10);
  $('usuario-enviar-email').checked = true;
  await populateUsuarioPerfilSelect();
  $('usuario-perfil').value = '';
  onUsuarioRoleChange();
  $('modal-usuario-tenant').style.display = 'flex';
}

function closeUsuarioTenantModal() {
  $('modal-usuario-tenant').style.display = 'none';
}

async function saveUsuarioTenant() {
  clearAlert('usuario-alert');

  const nome = $('usuario-nome').value.trim();
  const email = $('usuario-email').value.trim().toLowerCase();
  const role = $('usuario-role').value;
  const senha = $('usuario-senha').value;
  const enviarEmail = $('usuario-enviar-email').checked;

  if (!nome) { showAlert('usuario-alert', 'Nome é obrigatório.'); return; }
  if (!email) { showAlert('usuario-alert', 'E-mail é obrigatório.'); return; }
  if (!senha || senha.length < 6) { showAlert('usuario-alert', 'Senha deve ter no mínimo 6 caracteres.'); return; }

  const btn = $('btn-save-usuario');
  btn.disabled = true; btn.textContent = 'Criando…';

  try {
    const apiKey = firebase.app().options.apiKey;
    // 1) Cria conta no Firebase Auth via REST (não desloga o admin)
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: senha, returnSecureToken: false }),
    });
    const data = await res.json();
    if (!res.ok) {
      let msg = data?.error?.message || 'Erro ao criar conta';
      if (msg === 'EMAIL_EXISTS') msg = 'Já existe uma conta com este e-mail.';
      if (msg === 'WEAK_PASSWORD : Password should be at least 6 characters') msg = 'Senha muito fraca (mín 6 caracteres).';
      throw new Error(msg);
    }
    const uid = data.localId;

    // 2) Cria doc no Firestore vinculando ao tenant atual
    const perfilId = role === 'operador' ? ($('usuario-perfil').value || null) : null;
    await db.collection('users').doc(uid).set({
      nome,
      email,
      tenantId: State.tenant.id,
      role,
      perfilId,
      ativo: true,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      criadoPor: State.user.uid,
    });

    // 3) (Opcional) envia e-mail com a senha via Worker do Resend
    if (enviarEmail) {
      try {
        const cfgSnap = await tenantPath().collection('config').doc('site').get();
        const cfg = cfgSnap.exists ? cfgSnap.data() : {};
        if (cfg.workerUrl) {
          const html = `<html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;max-width:600px;margin:0 auto;padding:20px;">
            <h2 style="color:#475569;">Acesso ao DRG-Rently</h2>
            <p>Olá <strong>${escapeHtml(nome)}</strong>,</p>
            <p>Você foi adicionado como <strong>${role === 'admin' ? 'administrador' : 'operador'}</strong> da imobiliária <strong>${escapeHtml(State.tenant.nome)}</strong> no sistema DRG-Rently.</p>
            <p>Seus dados de acesso:</p>
            <table style="border-collapse:collapse;margin:14px 0;">
              <tr><td style="padding:6px 12px;background:#f0f0f0;border:1px solid #ccc;"><strong>Link</strong></td><td style="padding:6px 12px;border:1px solid #ccc;"><a href="https://zett-romao.github.io/drg-rently/">https://zett-romao.github.io/drg-rently/</a></td></tr>
              <tr><td style="padding:6px 12px;background:#f0f0f0;border:1px solid #ccc;"><strong>E-mail</strong></td><td style="padding:6px 12px;border:1px solid #ccc;">${escapeHtml(email)}</td></tr>
              <tr><td style="padding:6px 12px;background:#f0f0f0;border:1px solid #ccc;"><strong>Senha inicial</strong></td><td style="padding:6px 12px;border:1px solid #ccc;font-family:'Courier New',monospace;"><strong>${escapeHtml(senha)}</strong></td></tr>
            </table>
            <p style="font-size:12px;color:#666;">Recomendamos que você troque a senha no primeiro acesso pelo botão "Esqueci minha senha".</p>
            <p style="margin-top:24px;">— ${escapeHtml(State.tenant.nome)}</p>
          </body></html>`;
          await fetch(cfg.workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: cfg.emailFrom || 'onboarding@resend.dev',
              fromName: State.tenant.nome || 'DRG-Rently',
              to: email,
              subject: `Acesso ao DRG-Rently — ${State.tenant.nome}`,
              html,
            }),
          });
        }
      } catch (e) { console.warn('Falha ao enviar e-mail (usuário criado mesmo assim):', e); }
    }

    logAuditoria('create', 'usuario', uid, { nome, email, role });
    closeUsuarioTenantModal();
    showAlert('cfg-alert', `✓ Usuário ${nome} criado. Senha inicial: ${senha}`, 'success');
    loadUsuariosTenant();
  } catch (err) {
    console.error('Erro ao criar usuário:', err);
    showAlert('usuario-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Criar usuário';
  }
}

async function toggleUsuarioAtivo(uid, novoAtivo) {
  const acao = novoAtivo ? 'reativar' : 'desativar';
  if (!confirm(`Confirma ${acao} este usuário?`)) return;
  try {
    await db.collection('users').doc(uid).update({ ativo: novoAtivo });
    logAuditoria('toggle_ativo', 'usuario', uid, { ativo: novoAtivo });
    showAlert('cfg-alert', `Usuário ${novoAtivo ? 'reativado' : 'desativado'}.`, 'success');
    loadUsuariosTenant();
  } catch (err) {
    showAlert('cfg-alert', 'Erro: ' + err.message);
  }
}

// =============================================================
// EQUIPE DRG — operadores internos da D.R. Global
// (users sem tenantId, role = super_admin ou operador_drg)
// =============================================================

// Aplica permissões granulares no painel Super Admin
function aplicarPermissoesDRG() {
  // Esconde card de imobiliárias se não pode ver
  const cardTenants = document.querySelector('#section-superadmin .card:first-of-type');
  if (cardTenants) {
    cardTenants.style.display = userDRGPodeVerArea('drg_tenants_view') ? 'block' : 'none';
  }

  // Esconde card de equipe DRG se não pode ver
  const cardEquipe = $('card-equipe-drg');
  if (cardEquipe) {
    cardEquipe.style.display = userDRGPodeVerArea('drg_equipe') ? 'block' : 'none';
  }

  // Esconde botões de edição/ação se for só "visualizar"
  document.querySelectorAll('#section-superadmin button[onclick*="openDRGUsuarioModal"], #section-superadmin button[onclick*="openDRGPerfilModal"]').forEach(btn => {
    btn.style.display = State.isDRGMaster ? 'inline-block' : 'none';
  });
}

async function loadEquipeDRG() {
  if (!State.isSuperAdmin) return;
  await Promise.all([
    loadEquipeDRGUsuarios(),
    loadEquipeDRGPerfis(),
    loadInstalacoesSelfHosted(),
  ]);
}

// =============================================================
// Instâncias Self-hosted (Modelo C — telemetria)
// =============================================================

async function loadInstalacoesSelfHosted() {
  const tbody = $('tbody-self-hosted');
  const kpis = $('self-hosted-kpis');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="9" class="empty">Carregando…</td></tr>`;
  if (kpis) kpis.innerHTML = '';

  try {
    const snap = await db.collection('instalacoesSelfHosted').get();
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty">Nenhuma instalação self-hosted registrada ainda. Quando você vender um pendrive e o cliente fizer login, ele aparecerá aqui automaticamente.</td></tr>`;
      return;
    }

    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // KPIs
    const total = docs.length;
    const agora = Date.now();
    const ativos = docs.filter(d => {
      const last = d.ultimoPing ? new Date(d.ultimoPing.seconds ? d.ultimoPing.seconds * 1000 : d.ultimoPing).getTime() : 0;
      return (agora - last) < 7 * 24 * 60 * 60 * 1000; // ativo nos últimos 7 dias
    }).length;
    const totalImoveis = docs.reduce((acc, d) => acc + (d.imoveisCount || 0), 0);
    const totalUsuarios = docs.reduce((acc, d) => acc + (d.usuariosCount || 0), 0);

    if (kpis) {
      kpis.innerHTML = `
        <div class="stat-card"><div class="stat-card-icon stat-icon-blue">📡</div>
          <div class="stat-card-body"><div class="stat-card-value">${total}</div><div class="stat-card-label">Instalações</div></div></div>
        <div class="stat-card"><div class="stat-card-icon stat-icon-green">✅</div>
          <div class="stat-card-body"><div class="stat-card-value">${ativos}</div><div class="stat-card-label">Ativas (últimos 7d)</div></div></div>
        <div class="stat-card"><div class="stat-card-icon stat-icon-amber">🏢</div>
          <div class="stat-card-body"><div class="stat-card-value">${totalImoveis}</div><div class="stat-card-label">Imóveis nas inst.</div></div></div>
        <div class="stat-card"><div class="stat-card-icon stat-icon-purple">👤</div>
          <div class="stat-card-body"><div class="stat-card-value">${totalUsuarios}</div><div class="stat-card-label">Usuários nas inst.</div></div></div>
      `;
    }

    tbody.innerHTML = docs.map(d => {
      const last = d.ultimoPing ? new Date(d.ultimoPing.seconds ? d.ultimoPing.seconds * 1000 : d.ultimoPing).getTime() : 0;
      const first = d.primeiroPing ? new Date(d.primeiroPing.seconds ? d.primeiroPing.seconds * 1000 : d.primeiroPing).getTime() : 0;
      const diasUltimo = last ? Math.floor((agora - last) / 86400000) : null;

      let status, statusClass;
      if (diasUltimo == null) { status = '— sem ping'; statusClass = 'suspenso'; }
      else if (diasUltimo <= 1) { status = '🟢 Online'; statusClass = 'ativo'; }
      else if (diasUltimo <= 7) { status = '🟡 Recente'; statusClass = ''; }
      else if (diasUltimo <= 30) { status = '🟠 Inativo ' + diasUltimo + 'd'; statusClass = ''; }
      else { status = '🔴 Inativo ' + diasUltimo + 'd'; statusClass = 'suspenso'; }

      return `<tr>
        <td><strong>${escapeHtml(d.nome || '—')}</strong></td>
        <td style="font-size:11px;">${escapeHtml(d.cnpj || '—')}</td>
        <td style="font-size:11px; font-family:'Courier New', monospace; color:var(--text-muted);">${escapeHtml(d.projectId || '—')}</td>
        <td>${d.imoveisCount || 0}</td>
        <td>${d.usuariosCount || 0}</td>
        <td style="font-size:11px;">${escapeHtml(d.versaoApp || '—')}</td>
        <td style="font-size:11px;">${first ? fmtDataBR(new Date(first).toISOString().slice(0,10)) : '—'}</td>
        <td style="font-size:11px;">${last ? fmtDataBR(new Date(last).toISOString().slice(0,10)) : '—'}</td>
        <td><span class="badge-status ${statusClass}">${status}</span></td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('Erro ao listar instalações self-hosted:', err);
    tbody.innerHTML = `<tr><td colspan="9" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

async function loadEquipeDRGUsuarios() {
  const tbody = $('tbody-equipe-drg');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="empty">Carregando…</td></tr>`;
  try {
    // Busca todos os usuários sem tenantId (equipe DRG)
    // Firestore não tem operador "is null", então buscamos por role
    const [snapSA, snapOP] = await Promise.all([
      db.collection('users').where('role', '==', 'super_admin').get(),
      db.collection('users').where('role', '==', 'operador_drg').get(),
    ]);
    const docs = [...snapSA.docs, ...snapOP.docs];
    if (docs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhum membro cadastrado.</td></tr>`;
      return;
    }

    // Carrega nomes de perfis DRG pra exibir
    const perfisSnap = await db.collection('drgPerfis').get();
    const perfilNome = {};
    perfisSnap.docs.forEach(d => { perfilNome[d.id] = d.data().nome || '—'; });

    tbody.innerHTML = docs.map(doc => {
      const u = doc.data();
      const isSelf = doc.id === State.user.uid;
      const ativo = u.ativo !== false;
      const roleLabel = u.role === 'super_admin'
        ? '<span class="badge-status ativo" title="Acesso total">👑 Super Admin</span>'
        : '<span class="badge-status" style="background:#dbeafe; color:#1e40af;">🛠 Operador DRG</span>';
      const perfilLabel = u.role === 'super_admin' ? '—' : (perfilNome[u.drgPerfilId] || '<span class="muted">Padrão (visualização)</span>');
      const statusBadge = ativo
        ? '<span class="badge-status ativo">Ativo</span>'
        : '<span class="badge-status suspenso">Desativado</span>';
      const toggleLabel = ativo ? 'Desativar' : 'Reativar';
      const toggleClass = ativo ? 'btn-danger' : 'btn-primary';
      return `
        <tr>
          <td><strong>${u.nome || '—'}</strong>${isSelf ? ' <span class="muted" style="font-size:11px;">(você)</span>' : ''}</td>
          <td>${u.email || '—'}</td>
          <td>${roleLabel}</td>
          <td style="font-size:12px;">${perfilLabel}</td>
          <td>${statusBadge}</td>
          <td>
            ${isSelf ? '<span class="muted" style="font-size:11px;">—</span>' : `
              <button class="btn btn-sm ${toggleClass}" onclick="toggleDRGUsuarioAtivo('${doc.id}', ${!ativo})">${toggleLabel}</button>
            `}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao listar equipe DRG:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

async function toggleDRGUsuarioAtivo(uid, novoAtivo) {
  const acao = novoAtivo ? 'reativar' : 'desativar';
  if (!confirm(`Confirma ${acao} este membro da equipe DRG?`)) return;
  try {
    await db.collection('users').doc(uid).update({ ativo: novoAtivo });
    logAuditoria('toggle_ativo', 'usuario_drg', uid, { ativo: novoAtivo });
    loadEquipeDRGUsuarios();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

// ----- Modal: criar usuário DRG -----

async function openDRGUsuarioModal() {
  if (!State.isDRGMaster) {
    alert('Apenas Super Admin pode criar membros da equipe DRG.');
    return;
  }
  clearAlert('drg-usuario-alert');
  $('drg-usuario-nome').value = '';
  $('drg-usuario-email').value = '';
  $('drg-usuario-role').value = 'operador_drg';
  $('drg-usuario-senha').value = gerarSenhaAleatoria(12);
  $('drg-usuario-enviar-email').checked = true;
  await populateDRGUsuarioPerfilSelect();
  $('drg-usuario-perfil').value = '';
  onDRGUsuarioRoleChange();
  $('modal-drg-usuario').style.display = 'flex';
}

function closeDRGUsuarioModal() {
  $('modal-drg-usuario').style.display = 'none';
}

function gerarSenhaDRG() {
  $('drg-usuario-senha').value = gerarSenhaAleatoria(12);
}

function onDRGUsuarioRoleChange() {
  const role = $('drg-usuario-role').value;
  // Super Admin não usa perfil — vê tudo
  $('drg-usuario-perfil-group').style.display = (role === 'operador_drg') ? 'block' : 'none';
}

async function populateDRGUsuarioPerfilSelect() {
  const sel = $('drg-usuario-perfil');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Padrão (apenas visualização)</option>';
  try {
    const snap = await db.collection('drgPerfis').get();
    snap.docs.forEach(d => {
      const p = d.data();
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = p.nome || '(sem nome)';
      sel.appendChild(opt);
    });
  } catch (err) {
    console.warn('Falha ao listar perfis DRG:', err);
  }
}

async function saveDRGUsuario() {
  clearAlert('drg-usuario-alert');

  const nome = $('drg-usuario-nome').value.trim();
  const email = $('drg-usuario-email').value.trim().toLowerCase();
  const role = $('drg-usuario-role').value;
  const senha = $('drg-usuario-senha').value;
  const enviarEmail = $('drg-usuario-enviar-email').checked;

  if (!nome) { showAlert('drg-usuario-alert', 'Nome é obrigatório.'); return; }
  if (!email) { showAlert('drg-usuario-alert', 'E-mail é obrigatório.'); return; }
  if (!senha || senha.length < 6) { showAlert('drg-usuario-alert', 'Senha deve ter no mínimo 6 caracteres.'); return; }

  const btn = $('btn-save-drg-usuario');
  btn.disabled = true; btn.textContent = 'Criando…';

  try {
    const apiKey = firebase.app().options.apiKey;
    // 1) Cria conta no Auth via REST (não desloga o admin atual)
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: senha, returnSecureToken: false }),
    });
    const data = await res.json();
    if (!res.ok) {
      let msg = data?.error?.message || 'Erro ao criar conta';
      if (msg === 'EMAIL_EXISTS') msg = 'Já existe uma conta com este e-mail.';
      if (msg === 'WEAK_PASSWORD : Password should be at least 6 characters') msg = 'Senha muito fraca (mín 6 caracteres).';
      throw new Error(msg);
    }
    const uid = data.localId;

    // 2) Cria doc no Firestore SEM tenantId (equipe DRG)
    const drgPerfilId = role === 'operador_drg' ? ($('drg-usuario-perfil').value || null) : null;
    await db.collection('users').doc(uid).set({
      nome,
      email,
      tenantId: null,           // EQUIPE DRG: sem tenant
      role,                     // super_admin ou operador_drg
      drgPerfilId,              // permissões DRG (só pra operador_drg)
      ativo: true,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      criadoPor: State.user.uid,
    });

    // 3) (Opcional) envia e-mail com a senha
    if (enviarEmail) {
      try {
        // Busca config global do tenant ativo (se houver) pra usar Worker
        let workerUrl = null, emailFrom = null;
        if (State.tenant) {
          const cfgSnap = await tenantPath().collection('config').doc('site').get();
          if (cfgSnap.exists) {
            workerUrl = cfgSnap.data().workerUrl || null;
            emailFrom = cfgSnap.data().emailFrom || null;
          }
        }
        if (workerUrl) {
          const roleLabel = role === 'super_admin' ? 'Super Administrador' : 'Operador DRG';
          const html = `<html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;max-width:600px;margin:0 auto;padding:20px;">
            <h2 style="color:#475569;">Acesso ao DRG-Rently</h2>
            <p>Olá <strong>${escapeHtml(nome)}</strong>,</p>
            <p>Você foi adicionado à equipe interna da <strong>D.R. Global</strong> no sistema DRG-Rently como <strong>${roleLabel}</strong>.</p>
            <p>Seus dados de acesso:</p>
            <table style="border-collapse:collapse;margin:14px 0;">
              <tr><td style="padding:6px 12px;background:#f0f0f0;border:1px solid #ccc;"><strong>Link</strong></td><td style="padding:6px 12px;border:1px solid #ccc;"><a href="https://zett-romao.github.io/drg-rently/">https://zett-romao.github.io/drg-rently/</a></td></tr>
              <tr><td style="padding:6px 12px;background:#f0f0f0;border:1px solid #ccc;"><strong>E-mail</strong></td><td style="padding:6px 12px;border:1px solid #ccc;">${escapeHtml(email)}</td></tr>
              <tr><td style="padding:6px 12px;background:#f0f0f0;border:1px solid #ccc;"><strong>Senha inicial</strong></td><td style="padding:6px 12px;border:1px solid #ccc;font-family:'Courier New',monospace;"><strong>${escapeHtml(senha)}</strong></td></tr>
            </table>
            <p style="font-size:12px;color:#666;">Recomendamos trocar a senha no primeiro acesso pelo "Esqueci minha senha".</p>
            <p style="margin-top:24px;">— D.R. Global</p>
          </body></html>`;
          await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: emailFrom || 'onboarding@resend.dev',
              fromName: 'D.R. Global',
              to: email,
              subject: `Acesso ao DRG-Rently — Equipe DRG`,
              html,
            }),
          });
        }
      } catch (e) { console.warn('Falha ao enviar e-mail (membro DRG criado mesmo assim):', e); }
    }

    logAuditoria('create', 'usuario_drg', uid, { nome, email, role });
    closeDRGUsuarioModal();
    alert(`✓ Membro ${nome} criado.\nSenha inicial: ${senha}`);
    loadEquipeDRGUsuarios();
  } catch (err) {
    console.error('Erro ao criar membro DRG:', err);
    showAlert('drg-usuario-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Criar membro';
  }
}

// ----- Perfis DRG (coleção global drgPerfis) -----

async function loadEquipeDRGPerfis() {
  const tbody = $('tbody-drg-perfis');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="3" class="empty">Carregando…</td></tr>`;
  try {
    const snap = await db.collection('drgPerfis').get();
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty">Nenhum perfil DRG. Operadores DRG sem perfil veem apenas dashboard e lista de tenants.</td></tr>`;
      return;
    }
    tbody.innerHTML = snap.docs.map(d => {
      const p = d.data();
      const modsLabel = (p.modulos || []).map(m => MODULOS_DRG.find(x => x.id === m)?.label || m).join(' · ') || '—';
      return `<tr>
        <td><strong>${p.nome || '—'}</strong></td>
        <td style="font-size:11px; color:var(--text-muted);">${modsLabel}</td>
        <td><button class="btn btn-sm btn-secondary" onclick="openDRGPerfilModal('${d.id}')">Editar</button></td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

async function openDRGPerfilModal(id) {
  if (!State.isDRGMaster) {
    alert('Apenas Super Admin pode editar perfis DRG.');
    return;
  }
  clearAlert('drg-perfil-alert');
  $('drg-perfil-id').value = id || '';
  $('drg-perfil-nome').value = '';
  $('btn-delete-drg-perfil').style.display = id ? 'inline-block' : 'none';
  $('modal-drg-perfil-title').textContent = id ? 'Editar perfil DRG' : 'Novo perfil DRG';

  let modulosSelecionados = [];
  if (id) {
    try {
      const pSnap = await db.collection('drgPerfis').doc(id).get();
      if (pSnap.exists) {
        const p = pSnap.data();
        $('drg-perfil-nome').value = p.nome || '';
        modulosSelecionados = p.modulos || [];
      }
    } catch (err) { showAlert('drg-perfil-alert', 'Erro ao carregar: ' + err.message); return; }
  }

  renderDRGPerfilModulosCheckboxes(modulosSelecionados);
  $('modal-drg-perfil').style.display = 'flex';
}

function closeDRGPerfilModal() {
  $('modal-drg-perfil').style.display = 'none';
}

function renderDRGPerfilModulosCheckboxes(selecionados = []) {
  const container = $('drg-perfil-modulos-container');
  const grupos = {};
  MODULOS_DRG.forEach(m => {
    if (!grupos[m.grupo]) grupos[m.grupo] = [];
    grupos[m.grupo].push(m);
  });
  container.innerHTML = Object.keys(grupos).map(g => `
    <div class="perfil-grupo">
      <div class="perfil-grupo-titulo">${g}</div>
      <div class="perfil-grupo-itens">
        ${grupos[g].map(m => `
          <label class="perfil-item-checkbox">
            <input type="checkbox" name="drg-perfil-mod" value="${m.id}" ${selecionados.includes(m.id) ? 'checked' : ''}>
            <span>${m.label}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

async function saveDRGPerfil() {
  if (!State.isDRGMaster) return;
  clearAlert('drg-perfil-alert');
  const id = $('drg-perfil-id').value;
  const nome = $('drg-perfil-nome').value.trim();
  if (!nome) { showAlert('drg-perfil-alert', 'Nome do perfil é obrigatório.'); return; }
  const modulos = Array.from(document.querySelectorAll('input[name="drg-perfil-mod"]:checked')).map(c => c.value);

  const btn = $('btn-save-drg-perfil');
  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    if (id) {
      await db.collection('drgPerfis').doc(id).update({
        nome, modulos,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      });
      logAuditoria('update', 'drg_perfil', id, { nome, modulos });
    } else {
      const ref = await db.collection('drgPerfis').add({
        nome, modulos,
        criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        criadoPor: State.user.uid,
      });
      logAuditoria('create', 'drg_perfil', ref.id, { nome, modulos });
    }
    closeDRGPerfilModal();
    loadEquipeDRGPerfis();
  } catch (err) {
    showAlert('drg-perfil-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar';
  }
}

async function deleteDRGPerfil() {
  if (!State.isDRGMaster) return;
  const id = $('drg-perfil-id').value;
  if (!id) return;
  if (!confirm('Excluir este perfil DRG? Operadores vinculados voltarão ao padrão (apenas visualização).')) return;
  try {
    await db.collection('drgPerfis').doc(id).delete();
    logAuditoria('delete', 'drg_perfil', id, {});
    closeDRGPerfilModal();
    loadEquipeDRGPerfis();
  } catch (err) {
    showAlert('drg-perfil-alert', 'Erro: ' + err.message);
  }
}

// =============================================================
// Init
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
  // =============================================================
  // PWA — Registra Service Worker + handler de instalação
  // =============================================================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js?v=20260513f', { scope: './' })
        .then(reg => {
          // Detecta nova versão e oferece atualizar
          reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener('statechange', () => {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                // Mostra banner discreto pedindo refresh
                mostrarBannerAtualizacao();
              }
            });
          });
        })
        .catch(err => console.warn('[SW] Falha ao registrar:', err));
    });
  }

  // Captura evento de instalação (Android Chrome / Edge)
  let _deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    // Mostra botão "Instalar" só se ainda não está instalado
    if (!window.matchMedia('(display-mode: standalone)').matches) {
      setTimeout(() => mostrarBannerInstalar(), 2000); // espera 2s pra não atrapalhar login
    }
  });
  window.addEventListener('appinstalled', () => {
    _deferredInstallPrompt = null;
    const banner = $('pwa-install-banner');
    if (banner) banner.style.display = 'none';
  });
  // Expor pra onclick do banner conseguir disparar
  window.acionarInstalacaoPWA = async function() {
    if (!_deferredInstallPrompt) return;
    _deferredInstallPrompt.prompt();
    try { await _deferredInstallPrompt.userChoice; } catch (_) {}
    _deferredInstallPrompt = null;
    const banner = $('pwa-install-banner');
    if (banner) banner.style.display = 'none';
  };
  window.fecharBannerInstalar = function() {
    const banner = $('pwa-install-banner');
    if (banner) banner.style.display = 'none';
    // Lembra escolha por 7 dias
    try { localStorage.setItem('drg_install_dismissed', String(Date.now())); } catch (_) {}
  };

  function mostrarBannerInstalar() {
    // Não mostra se dismissed nos últimos 7 dias
    try {
      const last = parseInt(localStorage.getItem('drg_install_dismissed') || '0', 10);
      if (Date.now() - last < 7 * 24 * 60 * 60 * 1000) return;
    } catch (_) {}
    const banner = $('pwa-install-banner');
    if (banner && _deferredInstallPrompt) banner.style.display = 'flex';
  }

  function mostrarBannerAtualizacao() {
    // Banner discreto avisando que tem versão nova (recarregar pra pegar)
    const existing = $('pwa-update-banner');
    if (existing) return; // já mostrado
    const div = document.createElement('div');
    div.id = 'pwa-update-banner';
    div.className = 'pwa-update-banner';
    div.innerHTML = `
      <span>🔄 Nova versão disponível!</span>
      <button onclick="location.reload()" class="btn btn-sm" style="background:#fff;color:var(--primary-dark);">Atualizar</button>
    `;
    document.body.appendChild(div);
  }

  // =============================================================
  // Listeners normais
  // =============================================================
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

  // Abre direto na tela de signup se o link vier com ?signup=1 ou ?cadastro=1
  // Útil pra divulgação comercial: drg-rently.../?signup=1
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('signup') === '1' || urlParams.get('cadastro') === '1') {
    showScreen('screen-signup');
  }
  // Tipo via query (?tipo=PF ou ?tipo=PJ) — útil pra landing pages segmentadas
  const tipoParam = urlParams.get('tipo');
  if (tipoParam === 'PF' || tipoParam === 'PJ') {
    setTipoPessoaSignup(tipoParam);
  }

  // Auto-formatação CPF/CNPJ no signup conforme tipo selecionado
  const signupDoc = $('signup-cnpj');
  if (signupDoc) {
    signupDoc.addEventListener('input', () => {
      const tipo = $('signup-tipo-pessoa').value || 'PJ';
      signupDoc.value = tipo === 'PF' ? formataCPF(signupDoc.value) : formataCNPJ(signupDoc.value);
    });
  }

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
