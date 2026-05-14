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
  navHistory: [],      // pilha de seções visitadas (pra botão Voltar)
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
    'auth/invalid-email': 'E-mail inválido. Verifique o formato.',
    'auth/user-not-found': 'Não encontramos uma conta com esse e-mail.',
    'auth/wrong-password': 'Senha incorreta. Tente novamente ou clique em "Esqueci minha senha".',
    'auth/invalid-credential': 'E-mail ou senha incorretos. Confira os dados ou use "Esqueci minha senha".',
    'auth/invalid-login-credentials': 'E-mail ou senha incorretos.',
    'auth/missing-password': 'Digite sua senha.',
    'auth/missing-email': 'Digite seu e-mail.',
    'auth/user-disabled': 'Esta conta foi desativada. Contate o administrador.',
    'auth/email-already-in-use': 'Este e-mail já está cadastrado. Faça login ou recupere a senha.',
    'auth/weak-password': 'Senha muito fraca (mínimo 6 caracteres).',
    'auth/too-many-requests': 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.',
    'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.',
    'auth/operation-not-allowed': 'Operação não permitida. Contate o suporte.',
    'auth/internal-error': 'Erro interno do servidor. Tente novamente.',
    'auth/popup-closed-by-user': 'Janela fechada antes de concluir.',
  };
  return map[code] || `Erro de autenticação (${code || 'desconhecido'}).`;
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

    // Super Admin: localStorage tem PRIORIDADE MÁXIMA (mesmo se userDoc.tenantId existir)
    // Isso permite ao Super Admin escolher qual tenant operar sem editar o userDoc.
    let tenantSuperAdmin = null;
    if (State.isSuperAdmin) {
      try {
        const ultimoId = localStorage.getItem(`drg-tenant-ativo-${user.uid}`);
        if (ultimoId) {
          const snap = await db.collection('tenants').doc(ultimoId).get();
          if (snap.exists && !snap.data().arquivado) {
            tenantSuperAdmin = { id: snap.id, ...snap.data() };
          } else {
            localStorage.removeItem(`drg-tenant-ativo-${user.uid}`);
          }
        }
      } catch (_) {}
    }

    if (tenantSuperAdmin) {
      State.tenant = tenantSuperAdmin;
    } else if (State.userDoc.tenantId) {
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
      // Super-admin sem tenantId nem escolha salva: fallback automático.
      //   1. Tenant marcado como donoSuperAdmin === true (tenant próprio da DRG)
      //   2. Primeiro tenant ativo NÃO arquivado
      let tenantEscolhido = null;
      try {
        const donoSnap = await db.collection('tenants').where('donoSuperAdmin', '==', true).limit(1).get();
        if (!donoSnap.empty) {
          const t = donoSnap.docs[0];
          tenantEscolhido = { id: t.id, ...t.data() };
        }
      } catch (_) {}

      if (!tenantEscolhido) {
        const tenantsSnap = await db.collection('tenants').where('ativo', '==', true).limit(10).get();
        const candidatos = tenantsSnap.docs.filter(d => !d.data().arquivado);
        if (candidatos.length > 0) {
          const t = candidatos[0];
          tenantEscolhido = { id: t.id, ...t.data() };
        }
      }

      if (tenantEscolhido) {
        State.tenant = tenantEscolhido;
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
  // Limpa histórico de navegação pra próximo login começar limpo
  State.navHistory = [];
  atualizarBotaoVoltar();
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

async function renderApp() {
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

  // Aplica ordem customizada do sidebar (preferência do usuário) e habilita drag & drop
  await applySidebarOrder();
  enableSidebarDnD();

  // Se a seção atual não é permitida, manda pro dashboard
  if (State.currentSection && !userPodeVerModulo(State.currentSection)) {
    State.currentSection = 'dashboard';
  }

  showSection(State.currentSection || 'dashboard');
}

// =============================================================
// Navegação entre seções
// =============================================================
// =============================================================
// Mobile: sidebar drawer
// =============================================================
function toggleSidebarMobile() {
  const sidebar = $('sidebar-main');
  const overlay = $('sidebar-overlay');
  if (!sidebar || !overlay) return;
  const open = sidebar.classList.toggle('sidebar-open');
  overlay.classList.toggle('sidebar-overlay-active', open);
  // Bloqueia scroll do body quando aberto
  document.body.style.overflow = open ? 'hidden' : '';
}

function fecharSidebarMobile() {
  const sidebar = $('sidebar-main');
  const overlay = $('sidebar-overlay');
  if (!sidebar || !overlay) return;
  sidebar.classList.remove('sidebar-open');
  overlay.classList.remove('sidebar-overlay-active');
  document.body.style.overflow = '';
}

window.toggleSidebarMobile = toggleSidebarMobile;
window.fecharSidebarMobile = fecharSidebarMobile;

function showSection(name, _opts = {}) {
  // _opts.skipHistory: true quando vier de voltarSection (evita re-push)
  const anterior = State.currentSection;
  if (anterior && anterior !== name && !_opts.skipHistory) {
    State.navHistory.push(anterior);
    // Limita histórico a 20 (suficiente, evita memory leak)
    if (State.navHistory.length > 20) State.navHistory.shift();
  }
  State.currentSection = name;
  atualizarBotaoVoltar();
  // Fecha sidebar mobile ao trocar de seção
  fecharSidebarMobile();

  document.querySelectorAll('.nav-link').forEach(el => {
    el.classList.toggle('active', el.dataset.section === name);
  });

  document.querySelectorAll('.section').forEach(el => {
    el.style.display = (el.id === `section-${name}`) ? 'block' : 'none';
  });

  const titles = {
    dashboard: 'Dashboard',
    locadores: 'Locadores / Vendedores',
    locatarios: 'Locatários',
    garantias: 'Garantias',
    imoveis: 'Imóveis',
    'elab-contrato': 'Elaborar contrato',
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
    if (State.isDRGMaster) loadDRGCobrancaConfig();
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
// Voltar à seção anterior (botão global no topbar)
// =============================================================
function voltarSection() {
  if (State.navHistory.length === 0) return;
  const anterior = State.navHistory.pop();
  if (!anterior) return;
  showSection(anterior, { skipHistory: true });
}

function atualizarBotaoVoltar() {
  const btn = document.getElementById('btn-voltar-section');
  if (!btn) return;
  btn.style.display = State.navHistory.length > 0 ? 'inline-flex' : 'none';
}

// =============================================================
// Toggle visibilidade de senha (olho)
// =============================================================
function togglePasswordVisibility(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    if (btn) {
      btn.textContent = '🙈';
      btn.title = 'Esconder senha';
    }
  } else {
    inp.type = 'password';
    if (btn) {
      btn.textContent = '👁';
      btn.title = 'Mostrar senha';
    }
  }
}

// =============================================================
// Reset de senha (Esqueci minha senha) — inline na tela de login
// =============================================================
function abrirEsqueciSenha() {
  const box = document.getElementById('forgot-password-box');
  if (!box) return;
  box.style.display = 'block';
  // Pré-preenche com o e-mail que está no campo de login
  const emailLogin = document.getElementById('login-email')?.value.trim();
  const inp = document.getElementById('forgot-email');
  if (inp) {
    if (emailLogin) inp.value = emailLogin;
    inp.focus();
  }
  clearAlert('forgot-alert');
}

function fecharEsqueciSenha() {
  const box = document.getElementById('forgot-password-box');
  if (box) box.style.display = 'none';
  clearAlert('forgot-alert');
}

async function enviarResetSenha() {
  const email = document.getElementById('forgot-email')?.value.trim();
  if (!email) {
    showAlert('forgot-alert', 'Digite seu e-mail.');
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    showAlert('forgot-alert', 'E-mail inválido. Verifique o formato.');
    return;
  }

  const btn = document.getElementById('btn-enviar-reset');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Enviando…';
  }

  try {
    await auth.sendPasswordResetEmail(email);
    showAlert(
      'forgot-alert',
      `✅ Enviamos um link de redefinição para ${email}. Confira sua caixa de entrada (e a pasta de spam).`,
      'success'
    );
    // Esconde o formulário após 6s
    setTimeout(() => {
      fecharEsqueciSenha();
    }, 6000);
  } catch (err) {
    console.error('Erro ao enviar reset:', err);
    // Por segurança, o Firebase pode retornar success mesmo pra emails inexistentes
    // dependendo das configs. Aqui mostramos a mensagem real.
    let msg = translateAuthError(err.code);
    // Códigos específicos de reset
    if (err.code === 'auth/user-not-found') {
      msg = 'Não encontramos conta com este e-mail. Confirme o endereço ou crie uma nova conta.';
    }
    showAlert('forgot-alert', msg);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '📧 Enviar link';
    }
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
  // KPIs ignoram tenants arquivados — eles estão fora da operação
  const ativosLista = tenants.filter(t => !t.arquivado);
  const total = ativosLista.length;
  const ativos = ativosLista.filter(t => tenantSituacao(t) === 'ativo' || tenantSituacao(t) === 'trial' || tenantSituacao(t) === 'vencendo').length;
  const trials = ativosLista.filter(t => t.plano === 'trial' && t.ativo !== false).length;
  const inadimplentes = ativosLista.filter(t => tenantSituacao(t) === 'inadimplente').length;
  const suspensos = ativosLista.filter(t => t.ativo === false).length;
  const mrr = ativosLista
    .filter(t => t.ativo !== false && t.plano !== 'trial')
    .reduce((acc, t) => acc + (t.valorMensalidade || 0), 0);

  kpis.innerHTML = `
    <div class="stat-card" onclick="filtrarTenantsPorKpi('', this)" title="Mostrar todos os tenants">
      <div class="stat-card-icon stat-icon-blue">🏢</div>
      <div class="stat-card-body"><div class="stat-card-value">${total}</div><div class="stat-card-label">Total de Tenants</div></div>
    </div>
    <div class="stat-card" onclick="filtrarTenantsPorKpi('ativo', this)" title="Filtrar apenas tenants ativos">
      <div class="stat-card-icon stat-icon-green">✓</div>
      <div class="stat-card-body"><div class="stat-card-value">${ativos}</div><div class="stat-card-label">Ativos</div></div>
    </div>
    <div class="stat-card" onclick="filtrarTenantsPorKpi('trial', this)" title="Filtrar tenants em período de teste">
      <div class="stat-card-icon stat-icon-amber">⏳</div>
      <div class="stat-card-body"><div class="stat-card-value">${trials}</div><div class="stat-card-label">Em Trial</div></div>
    </div>
    <div class="stat-card" onclick="filtrarTenantsPorKpi('inadimplente', this)" title="Filtrar tenants inadimplentes">
      <div class="stat-card-icon stat-icon-rose">⚠</div>
      <div class="stat-card-body"><div class="stat-card-value">${inadimplentes}</div><div class="stat-card-label">Inadimplentes</div></div>
    </div>
    <div class="stat-card" onclick="filtrarTenantsPorKpi('mrr', this)" title="Mostrar apenas tenants pagantes (que compõem o MRR)">
      <div class="stat-card-icon stat-icon-purple">💰</div>
      <div class="stat-card-body"><div class="stat-card-value is-money">${fmtBRL(mrr)}</div><div class="stat-card-label">MRR (mensal recorrente)</div></div>
    </div>
  `;
}

// Filtra a tabela de tenants ao clicar num KPI card
function filtrarTenantsPorKpi(filtroStatus, cardEl) {
  // Marca o card clicado como ativo (visual)
  document.querySelectorAll('#superadmin-kpis .stat-card').forEach(c => c.classList.remove('is-active-filter'));
  if (cardEl) cardEl.classList.add('is-active-filter');

  const selStatus = $('filtro-tenant-status');
  const selPlano = $('filtro-tenant-plano');
  if (!selStatus) return;

  if (filtroStatus === 'mrr') {
    // MRR: tenants pagantes (qualquer plano exceto trial), e ativos
    selStatus.value = '';
    if (selPlano) {
      // Não temos opção "não trial", então deixa vazio e filtra via outra lógica abaixo
      selPlano.value = '';
    }
    // Aplica filtro custom: ativos não-trial. Reusa _tenantsCarregados.
    const tbody = $('tbody-tenants');
    if (tbody && Array.isArray(_tenantsCarregados)) {
      const lista = _tenantsCarregados.filter(t => t.ativo !== false && t.plano !== 'trial');
      if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty">Nenhum tenant pagante (todos em trial ou desativados).</td></tr>`;
      } else {
        // Re-renderiza usando a função padrão temporariamente trocando _tenantsCarregados
        const backup = _tenantsCarregados;
        _tenantsCarregados = lista;
        renderTenantsTable();
        _tenantsCarregados = backup;
      }
    }
  } else {
    selStatus.value = filtroStatus || '';
    if (selPlano) selPlano.value = '';
    renderTenantsTable();
  }

  // Rola até a tabela "Imobiliárias clientes" (card que contém #tbody-tenants)
  const tbody = document.getElementById('tbody-tenants');
  if (tbody) {
    const cardTabela = tbody.closest('.card');
    if (cardTabela) {
      cardTabela.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

function renderTenantsTable() {
  const tbody = $('tbody-tenants');
  const filtroStatus = $('filtro-tenant-status').value;
  const filtroPlano = $('filtro-tenant-plano').value;
  const filtroTipo = $('filtro-tenant-tipo')?.value || '';
  const filtroBusca = $('filtro-tenant-busca').value.trim().toLowerCase();
  const filtroArq = $('filtro-tenant-arquivado')?.value || 'ativos';

  let lista = _tenantsCarregados;

  // Arquivados: por padrão oculta. "todos" mostra ambos. "so_arquivados" filtra
  if (filtroArq === 'ativos') {
    lista = lista.filter(t => !t.arquivado);
  } else if (filtroArq === 'so_arquivados') {
    lista = lista.filter(t => !!t.arquivado);
  }

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
    const sitBadge = t.arquivado
      ? '<span class="badge-status" style="background:#E5E7EB;color:#374151;">🗄 Arquivado</span>'
      : ({
        ativo: '<span class="badge-status ativo">Ativo</span>',
        suspenso: '<span class="badge-status suspenso">Suspenso</span>',
        trial: '<span class="badge-status pendente_analise">Trial</span>',
        vencendo: '<span class="badge-status em_reforma">Trial vencendo</span>',
        inadimplente: '<span class="badge-status reprovado">Inadimplente</span>',
      }[sit] || sit);
    const vencDias = diasAteData(t.proximoVencimento);
    const vencTxt = t.proximoVencimento
      ? `${fmtDataBR(t.proximoVencimento)}${vencDias < 0 ? ` <span style="color:var(--danger);font-size:11px;">(${Math.abs(vencDias)}d atraso)</span>` : (vencDias <= 7 && vencDias >= 0 ? ` <span style="color:var(--warning);font-size:11px;">(em ${vencDias}d)</span>` : '')}`
      : '—';
    const tipoPessoa = t.tipoPessoa || (t.cpf ? 'PF' : 'PJ');
    const tipoBadge = tipoPessoa === 'PF'
      ? '<span class="badge-status" style="background:#dbeafe;color:#1e40af;">👤 Corretor</span>'
      : '<span class="badge-status" style="background:#fef3c7;color:#92400e;">🏢 Imobiliária</span>';
    const documento = tipoPessoa === 'PF' ? (t.cpf || '—') : (t.cnpj || '—');

    // Indicador se é o tenant ativo atual OU o tenant dono do Super Admin
    const isAtivo = State.tenant?.id === t.id;
    const isDono = !!t.donoSuperAdmin;
    const indicadorDono = isDono ? ' <span class="papel-chip" style="background:#FEF3C7;color:#92400E;">🏠 meu tenant</span>' : '';
    const indicadorAtivo = isAtivo ? ' <span class="papel-chip" style="background:#DCFCE7;color:#166534;">🎯 ativo agora</span>' : '';

    // Botões de ação: Gerenciar + Atuar como + Marcar como meu + Arquivar/Restaurar + Excluir
    const acoes = t.arquivado
      ? `
        <button class="btn btn-sm btn-secondary" onclick="openTenantModal('${t.id}')" title="Ver detalhes (somente leitura)">⚙ Ver</button>
        <button class="btn btn-sm btn-secondary" onclick="restaurarTenant('${t.id}')" title="Reativar este tenant">↻ Restaurar</button>
        <button class="btn btn-sm" onclick="excluirTenantDefinitivo('${t.id}', '${escapeHtml((t.nome || '').replace(/'/g, '&#39;'))}')" title="Excluir definitivamente" style="background:var(--danger); color:white; border-color:var(--danger);">🗑 Excluir</button>
      `
      : `
        <button class="btn btn-sm btn-secondary" onclick="openTenantModal('${t.id}')">⚙ Gerenciar</button>
        ${!isAtivo ? `<button class="btn btn-sm" onclick="definirTenantAtivoSuperAdmin('${t.id}')" title="Operar neste tenant nesta sessão (persistido pra próximos logins)" style="background:var(--primary); color:white; border-color:var(--primary);">🎯 Operar aqui</button>` : ''}
        ${!isDono ? `<button class="btn btn-sm btn-secondary" onclick="marcarComoTenantDono('${t.id}')" title="Marcar como tenant padrão da DRG Global (fallback)">🏠 Marcar como meu</button>` : ''}
        <button class="btn btn-sm btn-secondary" onclick="arquivarTenant('${t.id}', '${escapeHtml((t.nome || '').replace(/'/g, '&#39;'))}')" title="Mover pra arquivo (pode restaurar depois)">🗄 Arquivar</button>
      `;

    return `
      <tr ${t.arquivado ? 'style="opacity:0.6;"' : (isAtivo ? 'style="background:rgba(220, 252, 231, 0.4);"' : '')}>
        <td><strong>${escapeHtml(t.nome || '—')}</strong>${indicadorAtivo}${indicadorDono}<br><span class="muted" style="font-size:11px;">${documento}</span></td>
        <td>${tipoBadge}</td>
        <td>${PLANO_LABEL[t.plano] || t.plano || '—'}</td>
        <td>${fmtBRL(t.valorMensalidade)}</td>
        <td>${vencTxt}</td>
        <td>${sitBadge}</td>
        <td>
          <div class="action-btns" style="flex-wrap:wrap; gap:4px;">${acoes}</div>
        </td>
      </tr>
    `;
  }).join('');
}

// =============================================================
// Arquivar / Restaurar / Excluir tenants (Super Admin)
// =============================================================
async function arquivarTenant(tenantId, nome) {
  if (!confirm(`Arquivar o cliente "${nome}"?\n\n✅ Os dados ficam preservados.\n✅ Você pode RESTAURAR depois.\n⚠️ O tenant some das listagens padrão (mostre o filtro "Mostrar arquivados" pra ver).\n\nConfirmar?`)) return;
  try {
    await db.collection('tenants').doc(tenantId).update({
      arquivado: true,
      arquivadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      arquivadoPor: State.user?.uid || null,
    });
    if (typeof logAuditoria === 'function') {
      logAuditoria('arquivar', 'tenant', tenantId, { nome });
    }
    await loadTenantsTable();
  } catch (err) {
    console.error('Erro ao arquivar tenant:', err);
    alert('Erro ao arquivar: ' + err.message);
  }
}

async function restaurarTenant(tenantId) {
  try {
    await db.collection('tenants').doc(tenantId).update({
      arquivado: false,
      arquivadoEm: null,
      restauradoEm: firebase.firestore.FieldValue.serverTimestamp(),
      restauradoPor: State.user?.uid || null,
    });
    if (typeof logAuditoria === 'function') {
      logAuditoria('restaurar', 'tenant', tenantId, {});
    }
    await loadTenantsTable();
  } catch (err) {
    console.error('Erro ao restaurar tenant:', err);
    alert('Erro ao restaurar: ' + err.message);
  }
}

async function excluirTenantDefinitivo(tenantId, nome) {
  // Confirmação dupla — operação irreversível
  const confirma1 = confirm(
    `⚠️ EXCLUSÃO DEFINITIVA\n\n` +
    `Cliente: ${nome}\n\n` +
    `Esta ação:\n` +
    `• Marca o tenant como EXCLUÍDO (não aparece em lugar nenhum)\n` +
    `• Apaga o documento principal do Firestore\n` +
    `• Os dados das SUBCOLEÇÕES (locadores, contratos, imóveis, fotos, etc) ficam\n` +
    `  órfãos no Firestore. Pra remoção total (compliance LGPD pesado), use o\n` +
    `  script de limpeza recursiva no painel administrativo do Firebase.\n\n` +
    `Esta operação é IRREVERSÍVEL. Continuar?`
  );
  if (!confirma1) return;

  // Pede confirmação digitando o nome
  const digite = prompt(`Pra confirmar a EXCLUSÃO, digite EXATAMENTE o nome do cliente abaixo:\n\n"${nome}"`);
  if (!digite || digite.trim() !== nome.trim()) {
    alert('Nome digitado não confere. Operação CANCELADA.');
    return;
  }

  try {
    // Log antes de deletar
    if (typeof logAuditoria === 'function') {
      logAuditoria('excluir_definitivo', 'tenant', tenantId, { nome });
    }
    // Marca como excluído ANTES de deletar (audit trail)
    await db.collection('tenants').doc(tenantId).update({
      excluido: true,
      excluidoEm: firebase.firestore.FieldValue.serverTimestamp(),
      excluidoPor: State.user?.uid || null,
      nome: `[EXCLUÍDO ${new Date().toISOString().slice(0, 10)}] ${nome}`,
    }).catch(() => {});
    // Deleta o doc principal
    await db.collection('tenants').doc(tenantId).delete();
    alert(`✅ Tenant "${nome}" excluído.\n\nObservação: subcoleções (imóveis, contratos, etc) podem ter ficado órfãs. Use o painel do Firebase pra limpeza profunda se necessário.`);
    await loadTenantsTable();
  } catch (err) {
    console.error('Erro ao excluir tenant:', err);
    alert('Erro ao excluir: ' + err.message);
  }
}

window.arquivarTenant = arquivarTenant;
window.restaurarTenant = restaurarTenant;
window.excluirTenantDefinitivo = excluirTenantDefinitivo;

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

    // Cobrança Asaas (só super_admin)
    if (State.isSuperAdmin) carregarBlocoAsaas(tenantId);

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

// Super Admin define qual tenant é o "principal" dele (persistido por uid).
// Usado pra acabar com o bug "logo do tenant errado no header" quando o
// fallback automático escolhia o primeiro tenant em ordem aleatória.
async function definirTenantAtivoSuperAdmin(tenantId) {
  if (!State.isSuperAdmin || !State.user) return;
  if (!tenantId) {
    if (!confirm('Limpar a escolha de tenant ativo? Você ficará SEM tenant até escolher de novo.')) return;
    localStorage.removeItem(`drg-tenant-ativo-${State.user.uid}`);
    State.tenant = null;
    State.tenantOriginal = null;
    invalidateLocadoresCache(); invalidateLocatariosCache(); invalidateImoveisCache();
    invalidateGarantiasCache(); invalidateCompradoresCache();
    await renderApp();
    return;
  }
  try {
    const snap = await db.collection('tenants').doc(tenantId).get();
    if (!snap.exists) { alert('Tenant não encontrado.'); return; }
    State.tenant = { id: snap.id, ...snap.data() };
    State.tenantOriginal = null;
    localStorage.setItem(`drg-tenant-ativo-${State.user.uid}`, tenantId);
    invalidateLocadoresCache(); invalidateLocatariosCache(); invalidateImoveisCache();
    invalidateGarantiasCache(); invalidateCompradoresCache();
    const banner = $('banner-atuando-como');
    if (banner) banner.style.display = 'none';
    await renderApp();
    showSection('dashboard');
  } catch (err) {
    alert('Erro ao trocar tenant: ' + err.message);
  }
}

// Marca um tenant como "dono Super Admin" (fallback futuro).
// Apenas 1 tenant pode ser o dono — se já existir, desmarca os outros.
async function marcarComoTenantDono(tenantId) {
  if (!State.isSuperAdmin) return;
  if (!confirm('Marcar este tenant como o "dono" da DRG Global?\n\nEm futuros logins do Super Admin (sem escolha salva), este será o tenant padrão.\n\nApenas 1 tenant pode ser dono — qualquer outro será automaticamente desmarcado.')) return;
  try {
    // Desmarca todos os outros (batch leve — limit 50 é mais que suficiente)
    const outrosSnap = await db.collection('tenants').where('donoSuperAdmin', '==', true).limit(50).get();
    const batch = db.batch();
    outrosSnap.docs.forEach(d => {
      if (d.id !== tenantId) batch.update(d.ref, { donoSuperAdmin: false });
    });
    batch.update(db.collection('tenants').doc(tenantId), { donoSuperAdmin: true });
    await batch.commit();
    alert('✅ Tenant marcado como dono. Próximos logins vão usar ele por padrão.');
    await loadTenantsTable();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

window.definirTenantAtivoSuperAdmin = definirTenantAtivoSuperAdmin;
window.marcarComoTenantDono = marcarComoTenantDono;

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

// =============================================================
// Sidebar — drag & drop pra reordenar itens do menu
// =============================================================
let _dndSidebarEnabled = false;

function enableSidebarDnD() {
  if (_dndSidebarEnabled) return;

  document.querySelectorAll('.nav-group[data-nav-group]').forEach(group => {
    let dragged = null;
    let startedAt = 0;

    group.querySelectorAll('.nav-link').forEach(link => {
      link.setAttribute('draggable', 'true');

      link.addEventListener('dragstart', (e) => {
        dragged = link;
        startedAt = Date.now();
        link.classList.add('dragging-nav');
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', link.dataset.section || '');
        } catch (_) {}
      });

      link.addEventListener('dragend', () => {
        if (dragged) dragged.classList.remove('dragging-nav');
        dragged = null;
        group.querySelectorAll('.nav-link').forEach(l => l.classList.remove('drag-over-nav'));
      });

      link.addEventListener('dragover', (e) => {
        if (!dragged || dragged === link) return;
        // Só permite drop no mesmo grupo
        if (link.parentElement !== dragged.parentElement) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        link.classList.add('drag-over-nav');
      });

      link.addEventListener('dragleave', () => {
        link.classList.remove('drag-over-nav');
      });

      link.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        link.classList.remove('drag-over-nav');
        if (!dragged || dragged === link) return;
        if (link.parentElement !== dragged.parentElement) return;

        // Decide inserir antes ou depois baseado na posição vertical
        const rect = link.getBoundingClientRect();
        const insertBefore = e.clientY < rect.top + rect.height / 2;
        if (insertBefore) {
          group.insertBefore(dragged, link);
        } else {
          group.insertBefore(dragged, link.nextSibling);
        }
        saveSidebarOrder();
      });

      // Bloqueia click logo após drag pra não navegar acidentalmente
      link.addEventListener('click', (e) => {
        if (Date.now() - startedAt < 250) {
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);
    });
  });

  _dndSidebarEnabled = true;
}

async function saveSidebarOrder() {
  if (!State.user) return;
  const sidebarOrder = {};
  document.querySelectorAll('.nav-group[data-nav-group]').forEach(group => {
    const key = group.dataset.navGroup;
    const items = Array.from(group.querySelectorAll('.nav-link'))
      .map(l => l.dataset.section || l.id || '')
      .filter(Boolean);
    sidebarOrder[key] = items;
  });
  try {
    await db.collection('users').doc(State.user.uid).set({
      sidebarOrder,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error('Erro ao salvar ordem da sidebar:', err);
  }
}

async function applySidebarOrder() {
  if (!State.user) return;
  try {
    const snap = await db.collection('users').doc(State.user.uid).get();
    if (!snap.exists) return;
    const data = snap.data() || {};
    const order = data.sidebarOrder;
    if (!order || typeof order !== 'object') return;

    Object.entries(order).forEach(([groupKey, items]) => {
      if (!Array.isArray(items)) return;
      const group = document.querySelector(`.nav-group[data-nav-group="${groupKey}"]`);
      if (!group) return;
      const links = Array.from(group.querySelectorAll('.nav-link'));
      const byKey = {};
      links.forEach(l => {
        const key = l.dataset.section || l.id || '';
        if (key) byKey[key] = l;
      });
      // Reordena: primeiro os que estão na ordem salva, depois novos
      items.forEach(key => {
        if (byKey[key]) {
          group.appendChild(byKey[key]);
          delete byKey[key];
        }
      });
      // Restantes (novos não previstos) ficam no final (já estão lá)
    });
  } catch (err) {
    console.error('Erro ao aplicar ordem da sidebar:', err);
  }
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
               'stat-balancetes-mes', 'stat-contratos-atrasados',
               'stat-ia-contratos', 'stat-ia-comprovantes'];
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

    // Contagem de contratos atrasados (não bloqueia o resto do dashboard se falhar)
    try {
      const atrasados = await detectarContratosAtrasados();
      const el = $('stat-contratos-atrasados');
      if (el) el.textContent = atrasados.length;
    } catch (_) {
      const el = $('stat-contratos-atrasados');
      if (el) el.textContent = '—';
    }

    // Stats IA do mês (não bloqueia o dashboard se falhar)
    try {
      const stats = await contarUsosIaDoMes(contratosSnap, negociacoesSnap, balancetesMesSnap);
      const elC = $('stat-ia-contratos');
      const elP = $('stat-ia-comprovantes');
      if (elC) elC.textContent = stats.contratosIa;
      if (elP) elP.textContent = stats.comprovantesIa;
    } catch (e) {
      console.warn('Erro ao contar stats IA:', e);
      const elC = $('stat-ia-contratos'); if (elC) elC.textContent = '—';
      const elP = $('stat-ia-comprovantes'); if (elP) elP.textContent = '—';
    }
  } catch (err) {
    console.error('Erro ao carregar dashboard:', err);
    ids.forEach(id => { const el = $(id); if (el) el.textContent = '—'; });
  }

  // Painel de alertas resumo (não bloqueia o resto do dashboard)
  loadAlertasResumoDashboard().catch(e => console.warn('Alertas resumo falhou:', e));
}

// =============================================================
// Painel de alertas resumo no Dashboard (versão compacta)
// =============================================================
async function loadAlertasResumoDashboard() {
  const container = document.getElementById('dashboard-alertas-painel');
  if (!container || !State.tenant) return;

  try {
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();

    const [contratosSnap, locatariosSnap, imoveisSnap, negociacoesSnap, balancetesMesSnap, garantiasSnap] = await Promise.all([
      tenantPath().collection('contratos').get(),
      tenantPath().collection('locatarios').get(),
      tenantPath().collection('imoveis').get(),
      tenantPath().collection('negociacoes').get(),
      tenantPath().collection('balancetes').where('mes', '==', mesAtual).where('ano', '==', anoAtual).get(),
      tenantPath().collection('garantias').get(),
    ]);

    const imovelMap = Object.fromEntries(imoveisSnap.docs.map(d => [d.id, d.data().apelido]));

    let qtdCriticos = 0;
    let qtdAtencao = 0;
    let qtdInfo = 0;
    const topAlertas = []; // top 5 (priorizando críticos > atenção > info)

    // CRÍTICOS — contratos vencidos / vencendo em <=30 dias
    contratosSnap.docs.forEach(d => {
      const c = d.data();
      if (c.status !== 'vigente' || !c.fim) return;
      const fimDt = new Date(c.fim + 'T00:00:00');
      const dias = diasEntre(hoje, fimDt);
      if (dias < 0) {
        qtdCriticos++;
        topAlertas.push({ nivel: 'critico', icone: '🚨', titulo: `Contrato VENCIDO há ${Math.abs(dias)} dia(s)`, sub: imovelMap[c.imovelId] || '—', secao: 'contratos' });
      } else if (dias <= 30) {
        qtdCriticos++;
        topAlertas.push({ nivel: 'critico', icone: '⏰', titulo: `Contrato vence em ${dias} dia(s)`, sub: imovelMap[c.imovelId] || '—', secao: 'contratos' });
      } else if (dias <= 90) {
        qtdAtencao++;
        topAlertas.push({ nivel: 'atencao', icone: '📅', titulo: `Contrato vence em ${dias} dias`, sub: imovelMap[c.imovelId] || '—', secao: 'contratos' });
      }
    });

    // ATENÇÃO — locatários pendentes há >5 dias
    locatariosSnap.docs.forEach(d => {
      const l = d.data();
      if (l.status !== 'pendente_analise') return;
      const criado = l.criadoEm?.toDate ? l.criadoEm.toDate() : null;
      const dias = criado ? diasEntre(criado, hoje) : 0;
      if (dias >= 5) {
        qtdAtencao++;
        topAlertas.push({ nivel: 'atencao', icone: '⏳', titulo: `Locatário pendente há ${dias} dias`, sub: l.nome || '—', secao: 'locatarios' });
      }
    });

    // ATENÇÃO — negociações abertas há >15 dias
    negociacoesSnap.docs.forEach(d => {
      const n = d.data();
      if (n.status !== 'em_negociacao' && n.status !== 'aceita') return;
      const criado = n.criadoEm?.toDate ? n.criadoEm.toDate() : null;
      const dias = criado ? diasEntre(criado, hoje) : 0;
      if (dias >= 15) {
        qtdAtencao++;
        topAlertas.push({ nivel: 'atencao', icone: '🤝', titulo: `Negociação aberta há ${dias} dias`, sub: imovelMap[n.imovelId] || '—', secao: 'negociacoes' });
      }
    });

    // INFO — contratos vigentes sem balancete do mês
    const balancetesPorContrato = new Set(balancetesMesSnap.docs.map(d => d.data().contratoId));
    contratosSnap.docs.forEach(d => {
      const c = d.data();
      if (c.status !== 'vigente') return;
      if (!balancetesPorContrato.has(d.id)) {
        qtdInfo++;
        topAlertas.push({ nivel: 'info', icone: '💰', titulo: 'Sem balancete deste mês', sub: imovelMap[c.imovelId] || '—', secao: 'balancetes' });
      }
    });

    // INFO — imóveis rascunho (criados via H2 mas não finalizados)
    imoveisSnap.docs.forEach(d => {
      const im = d.data();
      if (im.rascunho === true) {
        qtdInfo++;
        topAlertas.push({ nivel: 'info', icone: '📝', titulo: 'Imóvel em rascunho — complete o cadastro', sub: im.apelido || d.id, secao: 'imoveis' });
      }
    });

    // INFO — garantias vencendo nos próximos 60 dias
    garantiasSnap.docs.forEach(d => {
      const g = d.data();
      const fim = g.validadeAte || g.fim || g.vencimento;
      if (!fim) return;
      try {
        const fimDt = new Date(fim + 'T00:00:00');
        const dias = diasEntre(hoje, fimDt);
        if (dias >= 0 && dias <= 60) {
          qtdAtencao++;
          topAlertas.push({ nivel: 'atencao', icone: '🛡', titulo: `Garantia vence em ${dias} dia(s)`, sub: g.identificacao || g.tipo || '—', secao: 'garantias' });
        }
      } catch (_) {}
    });

    // Ordena: críticos primeiro, depois atenção, depois info
    const ordem = { critico: 0, atencao: 1, info: 2 };
    topAlertas.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);

    const total = qtdCriticos + qtdAtencao + qtdInfo;
    if (total === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:24px 14px;">
          <div style="font-size:42px; margin-bottom:6px;">✅</div>
          <div style="font-weight:600; color:var(--success); margin-bottom:4px;">Tudo em dia!</div>
          <div class="muted" style="font-size:12px;">Nenhuma pendência detectada no momento.</div>
        </div>
      `;
      return;
    }

    // Contadores
    const contadoresHtml = `
      <div class="alertas-contadores">
        <div class="alerta-contador nivel-critico" onclick="showSection('alertas')" title="Itens críticos exigem ação imediata">
          <div class="alerta-contador-num">${qtdCriticos}</div>
          <div class="alerta-contador-label">🚨 Crítico</div>
        </div>
        <div class="alerta-contador nivel-atencao" onclick="showSection('alertas')" title="Itens de atenção">
          <div class="alerta-contador-num">${qtdAtencao}</div>
          <div class="alerta-contador-label">⚠️ Atenção</div>
        </div>
        <div class="alerta-contador nivel-info" onclick="showSection('alertas')" title="Avisos informativos">
          <div class="alerta-contador-num">${qtdInfo}</div>
          <div class="alerta-contador-label">ℹ️ Info</div>
        </div>
      </div>
    `;

    // Top 5 alertas em cards mini
    const top = topAlertas.slice(0, 5);
    const cardsHtml = `
      <div class="alertas-mini-grid">
        ${top.map(a => `
          <div class="alerta-mini nivel-${a.nivel}" onclick="showSection('${a.secao}')">
            <div class="alerta-mini-icone">${a.icone}</div>
            <div class="alerta-mini-body">
              <div class="alerta-mini-titulo">${escapeHtml(a.titulo)}</div>
              <div class="alerta-mini-sub">${escapeHtml(a.sub || '')}</div>
            </div>
            <div class="alerta-mini-arrow">→</div>
          </div>
        `).join('')}
      </div>
    `;

    const restanteHtml = topAlertas.length > 5
      ? `<p class="muted" style="text-align:center; font-size:12px; margin-top:10px;">+${topAlertas.length - 5} alertas. <a onclick="showSection('alertas')" style="cursor:pointer; text-decoration:underline; color:var(--primary);">Ver todos →</a></p>`
      : '';

    container.innerHTML = contadoresHtml + cardsHtml + restanteHtml;
  } catch (err) {
    console.error('Erro ao carregar alertas resumo:', err);
    container.innerHTML = '<p class="muted" style="color:var(--danger); text-align:center; padding:14px;">Erro ao carregar alertas: ' + err.message + '</p>';
  }
}

// Conta uso de IA no mês corrente (contratos+negociações criados via IA
// + comprovantes lidos pelo Gemini multi-comprovante).
async function contarUsosIaDoMes(contratosSnap, negociacoesSnap, balancetesMesSnap) {
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const inicioMesMs = inicioMes.getTime();

  // Contratos + Negociações criados via IA (importadoPorIA ou geradoPorWizard)
  // este mês.
  const ehEsteMes = (d) => {
    const t = d.criadoEm?.toMillis?.() || d.criadoEm?.seconds * 1000 || 0;
    return t >= inicioMesMs;
  };
  const isIA = (d) => d.importadoPorIA === true || d.geradoPorWizard === true;

  let contratosIa = 0;
  contratosSnap.docs.forEach(doc => {
    const d = doc.data();
    if (ehEsteMes(d) && isIA(d)) contratosIa++;
  });
  negociacoesSnap.docs.forEach(doc => {
    const d = doc.data();
    if (ehEsteMes(d) && isIA(d)) contratosIa++;
  });

  // Comprovantes lidos pela IA este mês: lançamentos em balancetes do mês corrente
  // que têm iaConfidence != null.
  let comprovantesIa = 0;
  balancetesMesSnap.docs.forEach(doc => {
    const lancs = doc.data().lancamentos || [];
    lancs.forEach(l => {
      if (l && l.iaConfidence != null) comprovantesIa++;
    });
  });

  return { contratosIa, comprovantesIa };
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

// Estado do filtro de papéis (locador/vendedor/todos)
let _locadoresFiltroPapel = 'todos';
let _locadoresCarregados = [];

function setFiltroPapel(papel) {
  _locadoresFiltroPapel = papel;
  document.querySelectorAll('.papel-filtro-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.papel === papel);
  });
  renderLocadoresTable();
}

function getPapeis(l) {
  // Compatibilidade: cadastros antigos sem .papeis assumem ambos true
  return l.papeis || { locador: true, vendedor: true };
}

function renderLocadoresTable() {
  const tbody = $('tbody-locadores');
  if (!tbody) return;

  const filtrados = _locadoresCarregados.filter(l => {
    if (_locadoresFiltroPapel === 'todos') return true;
    const p = getPapeis(l);
    if (_locadoresFiltroPapel === 'locador') return !!p.locador;
    if (_locadoresFiltroPapel === 'vendedor') return !!p.vendedor;
    return true;
  });

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhum registro com esse filtro.</td></tr>`;
    return;
  }

  const rows = filtrados.map((l, i) => {
    const docFmt = l.documento ? (l.tipo === 'PJ' ? maskCNPJ(l.documento) : maskCPF(l.documento)) : '—';
    const telFmt = l.telefone ? maskTelefone(l.telefone) : '—';
    const p = getPapeis(l);
    let chip = '';
    if (p.locador && p.vendedor) chip = '<span class="papel-chip ambos">🏠 + 💼 ambos</span>';
    else if (p.locador) chip = '<span class="papel-chip locador">🏠 locador</span>';
    else if (p.vendedor) chip = '<span class="papel-chip vendedor">💼 vendedor</span>';
    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${l.nome || '—'}</strong>${l.tipo === 'PJ' ? ' <span class="muted" style="font-size:11px;">(PJ)</span>' : ''} ${chip}</td>
        <td>${docFmt}</td>
        <td>${telFmt}</td>
        <td>${l.email || '—'}</td>
        <td>
          <div class="action-btns">
            <button class="btn btn-sm btn-secondary" onclick="openLocadorModal('${l._id}')">Editar</button>
          </div>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = rows.join('');
}

async function loadLocadores() {
  const tbody = $('tbody-locadores');
  tbody.innerHTML = `<tr><td colspan="6" class="empty">Carregando…</td></tr>`;

  try {
    const snap = await tenantPath().collection('locadores').orderBy('nome').get();
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhum cadastro ainda. Clique em "Novo Locador/Vendedor" para começar.</td></tr>`;
      _locadoresCarregados = [];
      return;
    }
    _locadoresCarregados = snap.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
    renderLocadoresTable();
  } catch (err) {
    console.error('Erro ao carregar locadores:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--danger);">Erro: ${err.message}</td></tr>`;
  }
}

window.setFiltroPapel = setFiltroPapel;

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
  $('modal-locador-title').textContent = id ? 'Editar Proprietário' : 'Novo Proprietário';
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
  // Por padrão, novo cadastro pode atuar como locador E vendedor (compatibilidade total)
  $('locador-papel-locador').checked = true;
  $('locador-papel-vendedor').checked = true;
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
        // Papéis (compatibilidade com cadastros antigos sem o campo: assume ambos true)
        const papeis = l.papeis || { locador: true, vendedor: true };
        $('locador-papel-locador').checked = papeis.locador !== false;
        $('locador-papel-vendedor').checked = papeis.vendedor !== false;
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
  const papelLocador = $('locador-papel-locador').checked;
  const papelVendedor = $('locador-papel-vendedor').checked;
  if (!papelLocador && !papelVendedor) {
    showAlert('locador-alert', 'Marque pelo menos um papel: Locador ou Vendedor.');
    return;
  }

  const data = {
    tipo: $('locador-tipo').value,
    nome,
    papeis: { locador: papelLocador, vendedor: papelVendedor },
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

// =============================================================
// G3 — IA preenche cadastro automaticamente a partir de documento
//      (RG, CNH, CPF, contrato social, cartão CNPJ, comprovante)
// =============================================================

// Mapeamento alvo → prefixo de campos no modal
const PESSOA_PREFIX = {
  locador: 'locador',
  locatario: 'locatario',
  comprador: 'comprador',
};

async function processarDocumentoPessoa(file, alvo) {
  if (!file) return;
  const prefix = PESSOA_PREFIX[alvo];
  if (!prefix) return;
  const statusEl = $(`${alvo}-ia-status`);
  const inputEl = $(`${alvo}-ia-input`);

  const setStatus = (msg, cls = '') => {
    if (!statusEl) return;
    statusEl.className = 'ia-dropzone-status ' + cls;
    statusEl.textContent = msg;
  };

  // Validações
  const maxBytes = 10 * 1024 * 1024;
  if (file.size > maxBytes) {
    setStatus('❌ Arquivo excede 10 MB.', 'is-error');
    return;
  }

  try {
    setStatus('🤖 Lendo o documento…', 'is-loading');

    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (!cfg.workerGeminiUrl) {
      setStatus('❌ Worker Gemini não configurado (Configurações).', 'is-error');
      return;
    }

    const fileBase64 = await fileToBase64(file);
    const mimeType = file.type || 'application/pdf';

    const res = await fetch(cfg.workerGeminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileBase64, mimeType, modo: 'documento_pessoa' }),
    });

    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
      throw new Error(msg);
    }
    const result = await res.json();
    if (!result.success || !result.data) throw new Error('Resposta inválida do Worker.');

    const dados = result.data;
    const conf = dados.campos_confianca || {};

    // Preenche os campos do modal
    const preenchidos = [];
    const setField = (suffix, valor, mascara) => {
      if (valor === null || valor === undefined || valor === '') return;
      const el = $(`${prefix}-${suffix}`);
      if (!el) return;
      el.value = mascara ? mascara(valor) : valor;
      preenchidos.push(suffix);
    };

    // Tipo de pessoa
    if (dados.tipo_pessoa === 'PJ' || dados.tipo_pessoa === 'PF') {
      const tipoEl = $(`${prefix}-tipo`);
      if (tipoEl) {
        tipoEl.value = dados.tipo_pessoa;
        // Dispara o onChange do tipo (PJ esconde campos PF e vice-versa)
        if (alvo === 'locador' && typeof onLocadorTipoChange === 'function') onLocadorTipoChange();
        else if (alvo === 'locatario' && typeof onLocatarioTipoChange === 'function') onLocatarioTipoChange();
        else if (alvo === 'comprador' && typeof onCompradorTipoChange === 'function') onCompradorTipoChange();
        preenchidos.push('tipo');
      }
    }

    setField('nome', dados.nome);
    if (dados.documento) {
      const docFmt = dados.tipo_pessoa === 'PJ' ? maskCNPJ(dados.documento) : maskCPF(dados.documento);
      setField('documento', docFmt);
    }
    setField('rg', dados.rg);
    setField('nascimento', dados.nascimento);
    setField('estado-civil', dados.estado_civil);
    setField('profissao', dados.profissao);
    setField('nacionalidade', dados.nacionalidade);
    setField('email', dados.email);
    if (dados.telefone) setField('telefone', maskTelefone(dados.telefone));

    const end = dados.endereco || {};
    if (end.cep) setField('cep', maskCEP(end.cep));
    setField('logradouro', end.logradouro);
    setField('numero', end.numero);
    setField('complemento', end.complemento);
    setField('bairro', end.bairro);
    setField('cidade', end.cidade);
    setField('uf', end.uf);

    // Mensagem de sucesso com resumo
    const tipoDoc = dados.tipo_documento_detectado || 'documento';
    const confResumo = [
      conf.nome && `nome: ${conf.nome}`,
      conf.documento && `doc: ${conf.documento}`,
      conf.endereco && `endereço: ${conf.endereco}`,
    ].filter(Boolean).join(' · ');

    let msgFinal = `✅ ${tipoDoc} lido. ${preenchidos.length} campo(s) preenchido(s).`;
    if (confResumo) msgFinal += ` (Confiança: ${confResumo})`;
    if (dados.observacoes) msgFinal += ` ⚠️ ${dados.observacoes}`;
    setStatus(msgFinal, 'is-success');

    // Limpa o input pra permitir re-upload do mesmo arquivo
    if (inputEl) inputEl.value = '';
  } catch (err) {
    console.error('Erro ao processar documento:', err);
    setStatus(`❌ Erro: ${err.message}`, 'is-error');
    if (inputEl) inputEl.value = '';
  }
}

window.processarDocumentoPessoa = processarDocumentoPessoa;

// =============================================================
// Helper genérico — status contextual inline
// Mostra a mensagem PRÓXIMA ao botão/ação que disparou, em vez de
// pulando pro topo do modal/página.
//   showInlineStatus('id-do-div', 'msg', 'loading'|'success'|'error'|'info')
//   clearInlineStatus('id-do-div')
// =============================================================
function showInlineStatus(elementId, msg, kind = 'info', autoHideMs = 0) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = 'status-inline is-' + kind;
  el.innerHTML = msg;
  el.style.display = 'block';
  // Scroll suave até o elemento se estiver fora do viewport (especialmente útil
  // em modais longos onde a mensagem fica próxima do botão Salvar lá embaixo).
  try {
    const rect = el.getBoundingClientRect();
    const fora = rect.bottom < 0 || rect.top > (window.innerHeight || document.documentElement.clientHeight);
    if (fora) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch (_) {}
  if (autoHideMs > 0) {
    if (el._hideTimer) clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, autoHideMs);
  }
}
function clearInlineStatus(elementId) {
  const el = document.getElementById(elementId);
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}
window.showInlineStatus = showInlineStatus;
window.clearInlineStatus = clearInlineStatus;

// =============================================================
// G4 — Asaas: cobrar locatário + pagar locador (no balancete)
// =============================================================

async function getCfgAsaas() {
  const snap = await tenantPath().collection('config').doc('site').get();
  const cfg = snap.exists ? snap.data() : {};
  return {
    url: (cfg.workerAsaasUrl || '').replace(/\/+$/, ''),
    token: cfg.asaasTenantToken || '',
  };
}

function asaasHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'X-Tenant-Asaas-Token': token,
  };
}

async function testarAsaasTenant() {
  const SID = 'asaas-tenant-status';
  showInlineStatus(SID, '🔄 Testando…', 'loading');
  try {
    const { url, token } = await getCfgAsaas();
    if (!url) throw new Error('URL do Worker Asaas não configurada.');
    if (!token) throw new Error('Chave Asaas não configurada.');
    const res = await fetch(`${url}/tenant/health`, { headers: asaasHeaders(token) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Chave inválida');
    showInlineStatus(SID, `✅ <strong>${data.account.name}</strong> (${data.ambiente}) — chave válida.`, 'success');
  } catch (err) {
    showInlineStatus(SID, `❌ ${err.message}`, 'error');
  }
}

async function verSaldoAsaas() {
  const SID = 'asaas-tenant-status';
  showInlineStatus(SID, '🔄 Consultando saldo…', 'loading');
  try {
    const { url, token } = await getCfgAsaas();
    if (!url || !token) throw new Error('Configure URL e chave Asaas primeiro.');
    const res = await fetch(`${url}/tenant/balance`, { headers: asaasHeaders(token) });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Erro ao consultar saldo');
    const saldo = data.balance.balance || 0;
    showInlineStatus(SID, `💰 Saldo disponível: <strong>${fmtBRL(saldo)}</strong>`, 'success');
  } catch (err) {
    showInlineStatus(SID, `❌ ${err.message}`, 'error');
  }
}

// Cria customer Asaas se não existir e salva o customerId no locatário
async function garantirCustomerAsaas(locatarioId) {
  const docRef = tenantPath().collection('locatarios').doc(locatarioId);
  const snap = await docRef.get();
  if (!snap.exists) throw new Error('Locatário não encontrado.');
  const l = snap.data();
  if (l.asaasCustomerId) return l.asaasCustomerId;

  const { url, token } = await getCfgAsaas();
  if (!url || !token) throw new Error('Configure Asaas em Configurações primeiro.');
  if (!l.documento) throw new Error('Locatário sem CPF/CNPJ — não dá pra criar cliente Asaas.');

  const res = await fetch(`${url}/tenant/customers`, {
    method: 'POST',
    headers: asaasHeaders(token),
    body: JSON.stringify({
      name: l.nome,
      email: l.email || undefined,
      cpfCnpj: l.documento,
      phone: l.telefone || undefined,
      mobilePhone: l.telefone || undefined,
      externalReference: locatarioId,
    }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Erro ao criar cliente Asaas');
  await docRef.update({ asaasCustomerId: data.customer.id });
  return data.customer.id;
}

async function cobrarLocatarioAsaas() {
  // Mostra status NA CAIXA Asaas (próximo ao botão), não no topo do modal
  const STATUS_ID = 'asaas-balancete-status';
  if (!_balanceteLocadorInfo) {
    showInlineStatus(STATUS_ID, 'Selecione um contrato primeiro.', 'error');
    return;
  }
  const contratoId = $('balancete-contrato').value;
  if (!contratoId) {
    showInlineStatus(STATUS_ID, 'Selecione um contrato.', 'error');
    return;
  }

  // Soma entradas pra cobrança
  const totalEntradas = _balanceteLancamentos
    .filter(l => l.bloco === 'entrada' || l.bloco === 'despesa_locatario')
    .reduce((acc, l) => acc + (parseFloat(l.valor) || 0), 0);
  if (totalEntradas <= 0) {
    showInlineStatus(STATUS_ID, 'Adicione lançamentos de entrada antes de cobrar.', 'error');
    return;
  }

  try {
    const cSnap = await tenantPath().collection('contratos').doc(contratoId).get();
    const c = cSnap.data();
    const locatarioId = c.locatarioId;
    if (!locatarioId) throw new Error('Contrato sem locatário.');

    showInlineStatus(STATUS_ID, '🔄 Criando cliente no Asaas (se necessário)…', 'loading');
    const customerId = await garantirCustomerAsaas(locatarioId);

    showInlineStatus(STATUS_ID, '🔄 Gerando cobrança PIX…', 'loading');
    const venc = new Date();
    venc.setDate(venc.getDate() + 10);
    const dueDate = venc.toISOString().slice(0, 10);

    const mes = parseInt($('balancete-mes').value, 10);
    const ano = parseInt($('balancete-ano').value, 10);

    const { url, token } = await getCfgAsaas();
    const res = await fetch(`${url}/tenant/payments`, {
      method: 'POST',
      headers: asaasHeaders(token),
      body: JSON.stringify({
        customer: customerId,
        billingType: 'PIX',
        value: totalEntradas.toFixed(2),
        dueDate,
        description: `Aluguel + encargos — ${fmtMesAno(mes, ano)}`,
        externalReference: `balancete:${$('balancete-id').value || `${ano}-${mes}-${contratoId}`}`,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Erro Asaas');
    const link = data.payment.invoiceUrl || data.payment.bankSlipUrl || '';
    showInlineStatus(
      STATUS_ID,
      `✅ Cobrança criada: <strong>${fmtBRL(totalEntradas)}</strong>. Vencimento ${dueDate}. ${link ? `<a href="${link}" target="_blank" rel="noopener">📄 Abrir fatura</a>` : ''}`,
      'success'
    );
  } catch (err) {
    console.error('Erro ao cobrar locatário:', err);
    showInlineStatus(STATUS_ID, `❌ ${err.message}`, 'error');
  }
}

async function pagarLocadorAsaas() {
  const STATUS_ID = 'asaas-balancete-status';
  if (!_balanceteLocadorInfo) {
    showInlineStatus(STATUS_ID, 'Selecione um contrato primeiro.', 'error');
    return;
  }
  const liquidoStr = ($('resumo-liquido').textContent || '').replace(/[^\d,.-]/g, '').replace('.', '').replace(',', '.');
  const liquido = parseFloat(liquidoStr) || 0;
  if (liquido <= 0) {
    showInlineStatus(STATUS_ID, 'Líquido a repassar é zero ou negativo.', 'error');
    return;
  }
  const locador = _balanceteLocadorInfo;
  if (!locador.pix) {
    showInlineStatus(STATUS_ID, 'Locador sem chave PIX cadastrada. Cadastre antes de pagar.', 'error');
    return;
  }
  if (!confirm(`Transferir ${fmtBRL(liquido)} via PIX para ${locador.nome}?\n\nChave PIX: ${locador.pix}\n\nEssa operação é IRREVERSÍVEL.`)) return;

  // Detecta tipo da chave PIX
  let tipo = 'EVP';
  const pix = locador.pix.trim();
  if (/^\d{11}$/.test(pix.replace(/\D/g, ''))) tipo = 'CPF';
  else if (/^\d{14}$/.test(pix.replace(/\D/g, ''))) tipo = 'CNPJ';
  else if (pix.includes('@')) tipo = 'EMAIL';
  else if (/^\+?\d{10,13}$/.test(pix.replace(/\D/g, ''))) tipo = 'PHONE';

  try {
    showInlineStatus(STATUS_ID, '🔄 Enviando PIX…', 'loading');
    const { url, token } = await getCfgAsaas();
    if (!url || !token) throw new Error('Configure Asaas primeiro.');
    const res = await fetch(`${url}/tenant/transfers`, {
      method: 'POST',
      headers: asaasHeaders(token),
      body: JSON.stringify({
        value: liquido.toFixed(2),
        pixAddressKey: pix,
        pixAddressKeyType: tipo,
        description: `Repasse aluguel — ${locador.nome}`,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Erro Asaas');
    showInlineStatus(
      STATUS_ID,
      `✅ Transferência criada: <strong>${fmtBRL(liquido)}</strong> via PIX ${tipo} → ${locador.nome}.`,
      'success'
    );
  } catch (err) {
    console.error('Erro ao pagar locador:', err);
    showInlineStatus(STATUS_ID, `❌ ${err.message}`, 'error');
  }
}

window.testarAsaasTenant = testarAsaasTenant;
window.verSaldoAsaas = verSaldoAsaas;
window.cobrarLocatarioAsaas = cobrarLocatarioAsaas;
window.pagarLocadorAsaas = pagarLocadorAsaas;

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
  _balanceteTaxaIncideIds = new Set();
  $('balancete-aluguel-base').value = '';
  $('balancete-taxa-adm').value = '';
  $('balancete-taxa-valor').value = '';
  $('balancete-obs').value = '';
  $('balancete-status').value = 'aberto';
  if ($('balancete-taxa-incidencia')) $('balancete-taxa-incidencia').value = 'aluguel';
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
  $('btn-enviar-balancete-locatario').style.display = id ? 'inline-block' : 'none';

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
        // Modo de incidência (default: aluguel — compat com balancetes antigos)
        if ($('balancete-taxa-incidencia')) {
          $('balancete-taxa-incidencia').value = b.taxaIncidencia || 'aluguel';
        }
        _balanceteTaxaIncideIds = new Set(b.taxaIncideIds || []);
        if ((b.taxaIncidencia || 'aluguel') !== 'aluguel') onTaxaIncidenciaChange();
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

// Estado: ids dos lançamentos sobre os quais a taxa incide (modo "selecionadas")
let _balanceteTaxaIncideIds = new Set();

function onTaxaIncidenciaChange() {
  const modo = $('balancete-taxa-incidencia').value;
  const help = $('balancete-taxa-incidencia-help');
  const lista = $('balancete-taxa-verbas-lista');

  if (modo === 'aluguel') {
    help.innerHTML = '💡 A taxa é calculada apenas sobre o valor do aluguel-base do contrato.';
    lista.style.display = 'none';
  } else if (modo === 'todas') {
    help.innerHTML = '💡 A taxa é calculada sobre <strong>TODAS as receitas</strong> do locador (entradas + reembolsos de despesas do locatário).';
    lista.style.display = 'none';
  } else if (modo === 'selecionadas') {
    help.innerHTML = '💡 Marque abaixo quais receitas devem servir de base para o cálculo da taxa.';
    lista.style.display = 'block';
    renderTaxaVerbasChecks();
  }
  recalcBalancete();
}

function renderTaxaVerbasChecks() {
  const container = $('balancete-taxa-verbas-checks');
  if (!container) return;
  // Lista todas as entradas (receitas) do balancete
  const entradas = _balanceteLancamentos.filter(l => l.bloco === 'entrada');
  const despesasLocatario = _balanceteLancamentos.filter(l => l.bloco === 'despesa_locatario');
  const todas = [...entradas, ...despesasLocatario];

  if (todas.length === 0) {
    container.innerHTML = '<p class="muted" style="font-size:12px;">Nenhuma receita lançada ainda. Adicione lançamentos primeiro.</p>';
    return;
  }

  container.innerHTML = todas.map(l => {
    const checked = _balanceteTaxaIncideIds.has(l.id) ? 'checked' : '';
    const tipo = l.bloco === 'entrada' ? '🟢' : '🟡';
    const blocoLabel = l.bloco === 'entrada' ? 'Receita' : 'Reembolso (locatário)';
    return `
      <label style="display:flex; align-items:center; gap:8px; padding:6px 0; cursor:pointer;">
        <input type="checkbox" ${checked} onchange="toggleTaxaIncide('${l.id}', this.checked)">
        <span>${tipo} <strong>${escapeHtml(l.categoria || '—')}</strong> ${escapeHtml(l.descricao || '')} — ${fmtBRL(parseFloat(l.valor) || 0)}</span>
        <span class="muted" style="font-size:10px; margin-left:auto;">${blocoLabel}</span>
      </label>
    `;
  }).join('');
}

function toggleTaxaIncide(id, checked) {
  if (checked) _balanceteTaxaIncideIds.add(id);
  else _balanceteTaxaIncideIds.delete(id);
  recalcBalancete();
}

window.onTaxaIncidenciaChange = onTaxaIncidenciaChange;
window.toggleTaxaIncide = toggleTaxaIncide;

function recalcBalancete() {
  const sum = (bloco) => _balanceteLancamentos.filter(l => l.bloco === bloco)
    .reduce((acc, l) => acc + (parseFloat(l.valor) || 0), 0);

  const totalEntradas = sum('entrada');
  const totalDespLocador = sum('despesa_locador');
  const totalDespLocatario = sum('despesa_locatario');

  // Regra de negócio (definida pelo Donizete):
  // - Despesas lançadas para o locatário (pagas pela imobiliária) ENTRAM como
  //   receita do locador (porque o locatário pagou esse valor à imobiliária).
  // - Todos os valores pagos pela imobiliária (locador + locatário) SAEM
  //   como despesa que desconta do líquido.
  const receitaTotalLocador = totalEntradas + totalDespLocatario;
  const despesaTotalLocador = totalDespLocador + totalDespLocatario;

  // Base da taxa depende do modo de incidência configurado
  const modoIncidencia = $('balancete-taxa-incidencia')?.value || 'aluguel';
  const aluguelBase = parseFloat($('balancete-aluguel-base').value) || 0;
  const taxaPercent = parseFloat($('balancete-taxa-adm').value) || 0;

  let baseTaxa = aluguelBase;
  if (modoIncidencia === 'todas') {
    baseTaxa = receitaTotalLocador;
  } else if (modoIncidencia === 'selecionadas') {
    baseTaxa = _balanceteLancamentos
      .filter(l => _balanceteTaxaIncideIds.has(l.id))
      .reduce((acc, l) => acc + (parseFloat(l.valor) || 0), 0);
  }
  const taxaValor = baseTaxa * taxaPercent / 100;

  // Re-renderiza checkboxes se modo for "selecionadas" (lançamentos podem ter mudado)
  if (modoIncidencia === 'selecionadas') renderTaxaVerbasChecks();

  const liquido = receitaTotalLocador - despesaTotalLocador - taxaValor;

  $('total-entradas').textContent = fmtBRL(totalEntradas);
  $('total-despesas-locador').textContent = fmtBRL(totalDespLocador);
  $('total-despesas-locatario').textContent = fmtBRL(totalDespLocatario);
  $('balancete-taxa-valor').value = taxaValor.toFixed(2);

  $('resumo-entradas').textContent = fmtBRL(receitaTotalLocador);
  $('resumo-despesas-locador').textContent = fmtBRL(despesaTotalLocador);
  $('resumo-taxa-adm').textContent = fmtBRL(taxaValor);
  $('resumo-liquido').textContent = fmtBRL(liquido);

  // Apuração em tempo real (card no topo do modal de balancete)
  const apuRec = $('apuracao-receitas');
  const apuDes = $('apuracao-despesas');
  const apuTax = $('apuracao-taxa');
  const apuLiq = $('apuracao-liquido');
  if (apuRec) apuRec.textContent = fmtBRL(receitaTotalLocador);
  if (apuDes) apuDes.textContent = fmtBRL(despesaTotalLocador);
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
  // Regra: despesa do locatário entra como receita E como despesa do locador
  const receitaTotalLocador = totalEntradas + totalDespLocatario;
  const despesaTotalLocador = totalDespLocador + totalDespLocatario;
  const aluguelBase = c.aluguel || 0;
  const taxaAdm = parseFloat($('balancete-taxa-adm').value) || 0;

  // Modo de incidência da taxa (G2)
  const taxaIncidencia = $('balancete-taxa-incidencia')?.value || 'aluguel';
  const taxaIncideIds = Array.from(_balanceteTaxaIncideIds || []);
  let baseTaxa = aluguelBase;
  if (taxaIncidencia === 'todas') {
    baseTaxa = receitaTotalLocador;
  } else if (taxaIncidencia === 'selecionadas') {
    baseTaxa = _balanceteLancamentos
      .filter(l => _balanceteTaxaIncideIds.has(l.id))
      .reduce((acc, l) => acc + (parseFloat(l.valor) || 0), 0);
  }
  const taxaAdmValor = baseTaxa * taxaAdm / 100;
  const liquidoLocador = receitaTotalLocador - despesaTotalLocador - taxaAdmValor;

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
    taxaIncidencia,
    taxaIncideIds,
    taxaBase: baseTaxa,
    totalEntradas,
    totalDespesasLocador: totalDespLocador,
    totalDespesasLocatario: totalDespLocatario,
    receitaTotalLocador,
    despesaTotalLocador,
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

async function openEnvioBalancete(destinatario) {
  destinatario = destinatario || 'locador';
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

    if (destinatario === 'locatario') {
      if (!locatario.email) {
        showAlert('balancete-alert', `O locatário "${locatario.nome || 'sem nome'}" não tem e-mail cadastrado.`);
        return;
      }
      const semDespesasLoc = (b.lancamentos || []).filter(l => l.bloco === 'despesa_locatario').length === 0;
      if (semDespesasLoc) {
        showAlert('balancete-alert', 'Não há despesas do locatário neste balancete — nada a enviar.');
        return;
      }
    } else {
      if (!locador.email) {
        showAlert('balancete-alert', `O locador "${locador.nome || 'sem nome'}" não tem e-mail cadastrado.`);
        return;
      }
    }

    _envioBalanceteContexto = { id, b, contrato, locador, locatario, imovel, cfg, destinatario };

    // Atualiza o título do modal
    const titulo = $('modal-envio-balancete-titulo');
    if (titulo) titulo.textContent = destinatario === 'locatario'
      ? 'Enviar demonstrativo ao locatário'
      : 'Enviar balancete ao locador';

    // Preenche campos do modal
    const mesAno = fmtMesAno(b.mes, b.ano);
    if (destinatario === 'locatario') {
      $('envio-to').value = locatario.email;
      $('envio-bcc').value = '';
      $('envio-subject').value = `Demonstrativo ${mesAno} — ${imovel.apelido || 'Imóvel'} — ${State.tenant.nome}`;

      const dadosMsg = {
        tenant: { nome: State.tenant.nome },
        locatario: { nome: locatario.nome || '' },
        imovel: { apelido: imovel.apelido || '' },
        periodo: mesAno,
        totalDespesas: fmtBRL(b.totalDespesasLocatario || 0),
      };
      const mensagemPadrao = cfg.emailTemplateLocatario ||
        `Prezado(a) {{locatario.nome}},\n\nSegue o demonstrativo das despesas do imóvel "{{imovel.apelido}}" pagas pela imobiliária no mês {{periodo}}.\n\nValor total a reembolsar: {{totalDespesas}}.\n\nQualquer dúvida ficamos à disposição.\n\nAtenciosamente,\n{{tenant.nome}}`;
      $('envio-mensagem').value = mergeTemplate(mensagemPadrao, dadosMsg);

      // Preview HTML versão locatário
      const cabecalho = mergeTemplate(cfg.balanceteCabecalho || '', { tenant: State.tenant });
      const rodape = mergeTemplate(cfg.balanceteRodape || '', { tenant: State.tenant });
      const htmlBalancete = buildBalanceteHtmlLocatario(b, contrato, locatario, imovel, cabecalho, rodape);
      $('envio-preview').innerHTML = htmlBalancete;
    } else {
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

      // Preview HTML versão locador
      const cabecalho = mergeTemplate(cfg.balanceteCabecalho || '', { tenant: State.tenant });
      const rodape = mergeTemplate(cfg.balanceteRodape || '', { tenant: State.tenant });
      const htmlBalancete = buildBalanceteHtml(b, contrato, locador, locatario, imovel, cabecalho, rodape);
      $('envio-preview').innerHTML = htmlBalancete;
    }

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

    ${(b.totalDespesasLocatario || 0) > 0 ? `
    <h3 style="margin:24px 0 8px;color:#b91c1c;font-size:14px;">⬇ DESPESAS DO LOCATÁRIO (pagas pela imobiliária)</h3>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f0f0f0;">
        <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;">Categoria</th>
        <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;">Descrição</th>
        <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;">Valor</th>
      </tr></thead>
      <tbody>
        ${rowsBloco('despesa_locatario')}
        <tr style="background:#f9f9f9;font-weight:bold;border-top:2px solid #000;">
          <td colspan="2" style="padding:8px;">Total despesas do locatário</td>
          <td style="padding:8px;text-align:right;">${fmtBRL(b.totalDespesasLocatario)}</td>
        </tr>
      </tbody>
    </table>
    ` : ''}

    <div style="border:2px solid #000;padding:14px 18px;margin:24px 0;background:#fafafa;">
      <table style="width:100%;font-size:13px;">
        <tr><td style="padding:4px 0;">Total de entradas</td><td style="text-align:right;font-weight:bold;">${fmtBRL(b.totalEntradas)}</td></tr>
        ${(b.totalDespesasLocatario || 0) > 0 ? `<tr><td style="padding:4px 0;">(+) Despesas do locatário (recebidas via imobiliária)</td><td style="text-align:right;font-weight:bold;">${fmtBRL(b.totalDespesasLocatario)}</td></tr>` : ''}
        <tr><td style="padding:4px 0;">(−) Despesas do locador (pagas pela imobiliária)</td><td style="text-align:right;font-weight:bold;">${fmtBRL(b.totalDespesasLocador)}</td></tr>
        ${(b.totalDespesasLocatario || 0) > 0 ? `<tr><td style="padding:4px 0;">(−) Despesas do locatário (pagas pela imobiliária)</td><td style="text-align:right;font-weight:bold;">${fmtBRL(b.totalDespesasLocatario)}</td></tr>` : ''}
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

// ----- Versão "para o locatário" do balancete -----
// Mostra APENAS as despesas do locatário pagas pela imobiliária.
// Omite dados do locador e mantém os dados da imobiliária.

function buildBalanceteHtmlLocatario(b, contrato, locatario, imovel, cabecalho, rodape) {
  const tenant = State.tenant || {};
  const mesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const periodoTxt = `${mesNomes[b.mes - 1]} de ${b.ano}`;

  const rowsLocatario = () => {
    const linhas = (b.lancamentos || []).filter(l => l.bloco === 'despesa_locatario');
    if (linhas.length === 0) {
      return '<tr><td colspan="3" style="text-align:center; color:#888;">— nenhuma despesa do locatário neste período —</td></tr>';
    }
    return linhas.map(l => `
      <tr>
        <td>${escapeHtml(LANC_CATEGORIA_LABEL[l.categoria] || l.categoria || '—')}</td>
        <td>${escapeHtml(l.descricao || '—')}</td>
        <td class="valor">${fmtBRL(l.valor)}</td>
      </tr>
    `).join('');
  };

  const anexos = (b.lancamentos || []).filter(l => l.bloco === 'despesa_locatario' && l.comprovanteNome);

  return `
    <div class="contrato-header">
      <h1>DEMONSTRATIVO DE DESPESAS — ${escapeHtml(periodoTxt)}</h1>
      <p class="contrato-empresa">${escapeHtml(tenant.nome || 'DRG-Rently')}</p>
      ${tenant.cnpj ? `<p class="contrato-empresa-sub">CNPJ ${escapeHtml(maskCNPJ(tenant.cnpj))}${tenant.creci ? ' · CRECI ' + escapeHtml(tenant.creci) : ''}</p>` : ''}
    </div>

    ${cabecalho ? `<div class="contrato-conteudo">${textToHtml(cabecalho)}</div>` : ''}

    <div class="balancete-info-grid">
      <span class="lbl">Locatário:</span>    <span>${escapeHtml(locatario.nome || '—')} — ${locatario.documento ? escapeHtml(locatario.tipo === 'PJ' ? maskCNPJ(locatario.documento) : maskCPF(locatario.documento)) : '—'}</span>
      <span class="lbl">Imóvel:</span>       <span>${escapeHtml(imovel.apelido || '—')}</span>
      <span class="lbl">Endereço:</span>     <span>${escapeHtml(formatEnderecoCompleto(imovel.endereco))}</span>
      <span class="lbl">Contrato:</span>     <span>${contrato.prazoMeses ? contrato.prazoMeses + ' meses' : '—'} · Início ${contrato.inicio ? fmtDataBR(contrato.inicio) : '—'} · Vencimento dia ${contrato.diaVencimento ?? '—'}</span>
    </div>

    <table class="balancete-table">
      <caption>Despesas do imóvel pagas pela imobiliária no período</caption>
      <thead><tr><th>Categoria</th><th>Descrição</th><th class="valor">Valor</th></tr></thead>
      <tbody>
        ${rowsLocatario()}
        <tr class="total-row">
          <td colspan="2">Total a ser reembolsado pelo locatário</td>
          <td class="valor">${fmtBRL(b.totalDespesasLocatario || 0)}</td>
        </tr>
      </tbody>
    </table>

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
          <strong>${escapeHtml(locatario.nome || '—')}</strong><br>
          <span>Locatário (ciência)</span>
        </div>
      </div>
    </div>
  `;
}

function buildBalanceteEmailHtmlLocatario(b, contrato, locatario, imovel, cabecalho, mensagem) {
  const tenant = State.tenant || {};
  const mesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const periodoTxt = `${mesNomes[b.mes - 1]} de ${b.ano}`;

  const rowsLocatario = () => {
    const linhas = (b.lancamentos || []).filter(l => l.bloco === 'despesa_locatario');
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
<html><head><meta charset="UTF-8"><title>Demonstrativo de despesas</title></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f4;color:#111;">
  <div style="max-width:680px;margin:0 auto;background:white;padding:30px;">

    <div style="text-align:center;border-bottom:2px solid #475569;padding-bottom:14px;margin-bottom:20px;">
      <h1 style="margin:0;color:#334155;font-size:20px;">DEMONSTRATIVO DE DESPESAS</h1>
      <p style="margin:4px 0 0;color:#666;font-size:14px;">${escapeHtml(periodoTxt)}</p>
      <p style="margin:8px 0 0;font-weight:bold;color:#475569;">${escapeHtml(tenant.nome || 'DRG-Rently')}</p>
    </div>

    <div style="margin-bottom:20px;font-size:14px;color:#333;">
      ${mensagemHtml}
    </div>

    ${cabecalho ? `<div style="margin-bottom:18px;font-size:13px;color:#444;padding:12px;background:#f8fafc;border-left:3px solid #475569;">${textToHtml(cabecalho)}</div>` : ''}

    <table style="width:100%;border-collapse:collapse;margin-bottom:6px;font-size:13px;">
      <tr><td style="padding:3px 0;color:#666;width:120px;">Locatário:</td><td style="padding:3px 0;">${escapeHtml(locatario.nome || '—')}</td></tr>
      <tr><td style="padding:3px 0;color:#666;">Imóvel:</td><td style="padding:3px 0;">${escapeHtml(imovel.apelido || '—')}</td></tr>
      <tr><td style="padding:3px 0;color:#666;">Endereço:</td><td style="padding:3px 0;">${escapeHtml(formatEnderecoCompleto(imovel.endereco))}</td></tr>
    </table>

    <h3 style="margin:24px 0 8px;color:#b91c1c;font-size:14px;">Despesas pagas pela imobiliária no período</h3>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f0f0f0;">
        <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;">Categoria</th>
        <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;">Descrição</th>
        <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;">Valor</th>
      </tr></thead>
      <tbody>
        ${rowsLocatario()}
      </tbody>
    </table>

    <div style="border:2px solid #000;padding:14px 18px;margin:24px 0;background:#fafafa;">
      <table style="width:100%;font-size:13px;">
        <tr style="border-top:2px solid #000;"><td style="padding:10px 0;font-size:15px;font-weight:bold;">TOTAL A REEMBOLSAR</td><td style="text-align:right;padding:10px 0;font-size:18px;font-weight:bold;color:#b91c1c;">${fmtBRL(b.totalDespesasLocatario || 0)}</td></tr>
      </table>
    </div>

    <p style="margin-top:30px;font-size:11px;color:#888;text-align:center;border-top:1px solid #ddd;padding-top:14px;">
      Enviado por ${escapeHtml(tenant.nome || 'DRG-Rently')} via DRG-Rently<br>
      ${tenant.cnpj ? 'CNPJ ' + escapeHtml(maskCNPJ(tenant.cnpj)) : ''}${tenant.creci ? ' · CRECI ' + escapeHtml(tenant.creci) : ''}
    </p>
  </div>
</body></html>`;
}

async function sendBalanceteEmail() {
  if (!_envioBalanceteContexto) return;
  const { id, b, contrato, locador, locatario, imovel, cfg, destinatario } = _envioBalanceteContexto;

  const to = $('envio-to').value.trim();
  const bcc = $('envio-bcc').value.trim();
  const subject = $('envio-subject').value.trim();
  const mensagem = $('envio-mensagem').value;

  if (!to) { showAlert('envio-alert', 'Destinatário é obrigatório.'); return; }
  if (!subject) { showAlert('envio-alert', 'Assunto é obrigatório.'); return; }

  const cabecalho = mergeTemplate(cfg.balanceteCabecalho || '', { tenant: State.tenant });
  const html = destinatario === 'locatario'
    ? buildBalanceteEmailHtmlLocatario(b, contrato, locatario, imovel, cabecalho, mensagem)
    : buildBalanceteEmailHtml(b, contrato, locador, locatario, imovel, cabecalho, mensagem);

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

    // Marca balancete como enviado.
    // - locador: muda status do balancete para "enviado" (fluxo principal)
    // - locatario: só registra envio adicional, não altera status
    const updatePayload = destinatario === 'locatario' ? {
      emailLocatarioEnviadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      emailLocatarioEnviadoPara: to,
      emailLocatarioEnviadoBcc: bcc || null,
    } : {
      status: 'enviado',
      emailEnviadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      emailEnviadoPara: to,
      emailEnviadoBcc: bcc || null,
    };
    await tenantPath().collection('balancetes').doc(id).update(updatePayload);

    logAuditoria('send_email', 'balancete', id, { to, destinatario: destinatario || 'locador', mes: b.mes, ano: b.ano });
    closeEnvioBalancete();
    showAlert('balancete-alert', `✓ E-mail enviado para ${to}!`, 'success');
    if (destinatario !== 'locatario') {
      $('balancete-status').value = 'enviado';
      aplicarStatusBalancete();
    }
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
      <caption>⬇ Despesas do locatário (pagas pela imobiliária — descontadas do repasse)</caption>
      <thead><tr><th>Categoria</th><th>Descrição</th><th class="valor">Valor</th><th>Comp.</th></tr></thead>
      <tbody>
        ${rowsBloco('despesa_locatario')}
        ${totalRow('Total despesas do locatário', b.totalDespesasLocatario || 0, 4)}
      </tbody>
    </table>
    ` : ''}

    <div class="balancete-resumo-print">
      <div class="linha"><span>Total de entradas</span><strong>${fmtBRL(b.totalEntradas)}</strong></div>
      ${(b.totalDespesasLocatario || 0) > 0 ? `<div class="linha"><span>(+) Despesas do locatário (recebidas via imobiliária)</span><strong>${fmtBRL(b.totalDespesasLocatario)}</strong></div>` : ''}
      <div class="linha"><span>(−) Despesas do locador (pagas pela imobiliária)</span><strong>${fmtBRL(b.totalDespesasLocador)}</strong></div>
      ${(b.totalDespesasLocatario || 0) > 0 ? `<div class="linha"><span>(−) Despesas do locatário (pagas pela imobiliária)</span><strong>${fmtBRL(b.totalDespesasLocatario)}</strong></div>` : ''}
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
          <td><strong>${n.numero || '—'}</strong></td>
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

  // Filtra apenas quem pode atuar como vendedor (compat: sem papeis = pode tudo)
  const vendedoresElegiveis = locadores.filter(l => {
    const p = l.papeis || { locador: true, vendedor: true };
    return p.vendedor !== false;
  });
  $('negociacao-vendedor').innerHTML = ['<option value="">— Selecione —</option>']
    .concat(vendedoresElegiveis.map(l => `<option value="${l.id}"${l.id === selected?.vendedorId ? ' selected' : ''}>${l.nome}${l.tipo === 'PJ' ? ' (PJ)' : ''}</option>`))
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

  // Status ZapSign da negociação (carrega assíncrono)
  carregarStatusZapSignNegociacao(id).catch(() => {});

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
      const seq = await proximoNumeroSequencial('negociacoes');
      data.numero = seq.numero;
      data.numeroSequencial = seq.numeroSequencial;
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('negociacoes').add(data);
      negociacaoId = docRef.id;
      logAuditoria('create', 'negociacao', negociacaoId, { numero: data.numero, status: data.status, valor: data.valor });
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
    habilitarDropUploadFotos();

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
    // Em modo CRIAÇÃO mantemos a seção de fotos VISÍVEL (cria rascunho on-demand
    // quando user faz primeiro upload). Docs e publicação ficam ocultos porque
    // não fazem sentido antes do save completo.
    $('imovel-docs-section').style.display = 'none';
    $('imovel-fotos-section').style.display = 'block';
    $('imovel-publicacao-section').style.display = 'none';
    const grid = $('imovel-fotos-grid');
    if (grid) {
      grid.innerHTML = `<p class="empty">📷 Anexe fotos aqui — o imóvel será salvo automaticamente como rascunho no primeiro upload.<br><span class="muted" style="font-size:12px;">💡 Você pode arrastar arquivos direto pra esta área.</span></p>`;
    }
    habilitarDropUploadFotos();
  }

  $('modal-imovel').style.display = 'flex';
}

function closeImovelModal() {
  $('modal-imovel').style.display = 'none';
}

async function saveImovel() {
  clearAlert('imovel-alert');
  clearInlineStatus('imovel-acoes-status');

  const id = $('imovel-id').value;
  const apelido = $('imovel-apelido').value.trim();
  const locadorId = $('imovel-locador').value;

  // Validações com foco automático no campo + scroll suave
  if (!apelido) {
    showInlineStatus('imovel-acoes-status', '⚠️ <strong>Apelido / Identificação</strong> é obrigatório. Preencha o campo no topo do modal.', 'error');
    const inp = $('imovel-apelido');
    if (inp) {
      inp.focus({ preventScroll: false });
      try { inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
      inp.classList.add('input-erro-pulse');
      setTimeout(() => inp.classList.remove('input-erro-pulse'), 2000);
    }
    return;
  }
  if (!locadorId) {
    showInlineStatus('imovel-acoes-status', '⚠️ Selecione o <strong>locador (proprietário)</strong> do imóvel.', 'error');
    const sel = $('imovel-locador');
    if (sel) {
      sel.focus({ preventScroll: false });
      try { sel.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
      sel.classList.add('input-erro-pulse');
      setTimeout(() => sel.classList.remove('input-erro-pulse'), 2000);
    }
    return;
  }

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
      showInlineStatus('imovel-acoes-status', '✅ Imóvel criado. Agora você pode anexar documentos e fotos.', 'success', 5000);
      loadImoveis();
      return;
    }
    invalidateImoveisCache();
    closeImovelModal();
    loadImoveis();
  } catch (err) {
    console.error('Erro ao salvar:', err);
    showInlineStatus('imovel-acoes-status', `❌ Erro ao salvar: ${err.message}`, 'error');
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
      grid.innerHTML = `<p class="empty">Nenhuma foto adicionada. Sem fotos, o imóvel publicado fica menos atrativo. <br><span class="muted" style="font-size:12px;">💡 Você pode <strong>arrastar arquivos diretamente</strong> aqui dentro.</span></p>`;
      return;
    }

    grid.innerHTML = snap.docs.map((doc, idx) => {
      const f = doc.data();
      const isCapa = idx === 0;
      return `
        <div class="foto-item ${isCapa ? 'is-capa' : ''}" draggable="true" data-foto-id="${doc.id}" data-ordem="${f.ordem || 0}">
          ${isCapa ? '<div class="foto-capa-badge" title="Primeira foto = capa do anúncio">👑 Capa</div>' : ''}
          <img src="${f.url}" alt="${f.nome || ''}" loading="lazy" onclick="window.open('${f.url}', '_blank')">
          <div class="foto-actions">
            <button class="foto-del" title="Excluir" onclick="event.stopPropagation(); deleteImovelFoto('${imovelId}','${doc.id}','${f.path || ''}');">×</button>
          </div>
        </div>
      `;
    }).join('');

    // Habilita drag & drop pra reordenar (a primeira foto vira capa)
    habilitarReordenacaoFotos(imovelId);
  } catch (err) {
    console.error('Erro ao listar fotos:', err);
    grid.innerHTML = `<p class="empty" style="color:var(--danger);">Erro: ${err.message}</p>`;
  }
}

// Drag & drop pra reordenar fotos do imóvel
function habilitarReordenacaoFotos(imovelId) {
  const grid = $('imovel-fotos-grid');
  if (!grid) return;
  let arrastando = null;

  grid.querySelectorAll('.foto-item[draggable="true"]').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      arrastando = item;
      item.classList.add('arrastando');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.dataset.fotoId); } catch (_) {}
    });

    item.addEventListener('dragend', () => {
      if (arrastando) arrastando.classList.remove('arrastando');
      grid.querySelectorAll('.foto-item').forEach(el => el.classList.remove('drop-target'));
      arrastando = null;
    });

    item.addEventListener('dragover', (e) => {
      if (!arrastando || arrastando === item) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drop-target');
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drop-target');
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('drop-target');
      if (!arrastando || arrastando === item) return;

      // Insere antes ou depois conforme posição do cursor
      const rect = item.getBoundingClientRect();
      const insertBefore = (e.clientY < rect.top + rect.height / 2);
      if (insertBefore) grid.insertBefore(arrastando, item);
      else grid.insertBefore(arrastando, item.nextSibling);

      await salvarNovaOrdemFotos(imovelId);
    });
  });
}

async function salvarNovaOrdemFotos(imovelId) {
  const grid = $('imovel-fotos-grid');
  const items = Array.from(grid.querySelectorAll('.foto-item[data-foto-id]'));
  if (items.length === 0) return;
  const fotosColl = tenantPath().collection('imoveis').doc(imovelId).collection('fotos');
  // Atualiza ordem de TODAS (batch)
  const batch = db.batch();
  items.forEach((el, idx) => {
    batch.update(fotosColl.doc(el.dataset.fotoId), { ordem: idx });
  });
  try {
    await batch.commit();
    // Re-renderiza pra atualizar badge "Capa"
    loadImovelFotos(imovelId);
  } catch (err) {
    console.error('Erro ao salvar ordem das fotos:', err);
    showAlert('imovel-alert', 'Erro ao salvar nova ordem: ' + err.message);
  }
}

// Drag & drop pra fazer UPLOAD direto (arrastar arquivos do desktop)
function habilitarDropUploadFotos() {
  const grid = $('imovel-fotos-grid');
  const dropZone = grid?.closest('#imovel-fotos-section');
  if (!dropZone || dropZone._dropHandlersInstalled) return;
  dropZone._dropHandlersInstalled = true;

  ['dragenter', 'dragover'].forEach(ev => {
    dropZone.addEventListener(ev, (e) => {
      // Só ativa se o que está sendo arrastado é arquivo (não outra foto interna)
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dropping-files');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropZone.addEventListener(ev, (e) => {
      if (e.target !== dropZone && dropZone.contains(e.target) && ev === 'dragleave') return;
      dropZone.classList.remove('dropping-files');
    });
  });
  dropZone.addEventListener('drop', async (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files || []).filter(f => /^image\//.test(f.type));
    if (files.length === 0) return;
    // Coloca os arquivos no input pra reusar a lógica existente
    const input = $('imovel-foto-input');
    // FileList é read-only, usamos DataTransfer
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    input.files = dt.files;
    await uploadImovelFotos();
  });
}

window.salvarNovaOrdemFotos = salvarNovaOrdemFotos;

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
  let imovelId = $('imovel-id').value;

  // Se ainda não tem id (modo criação), cria um rascunho automaticamente
  // assim o user pode anexar fotos sem ter preenchido tudo ainda.
  if (!imovelId) {
    const apelido = $('imovel-apelido').value.trim();
    if (!apelido) {
      showAlert('imovel-alert', 'Antes de subir fotos, preencha pelo menos o "Apelido" do imóvel.');
      return;
    }
    try {
      const rascunho = {
        apelido,
        rascunho: true,
        criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        criadoPor: State.user?.uid || null,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      };
      const docRef = await tenantPath().collection('imoveis').add(rascunho);
      imovelId = docRef.id;
      $('imovel-id').value = imovelId;
      logAuditoria('create', 'imovel-rascunho', imovelId, { apelido });
      invalidateImoveisCache();
      // Aciona estado de "modo edição" pra liberar docs/publicação após save completo
      $('imovel-docs-section').style.display = 'block';
      $('imovel-publicacao-section').style.display = 'block';
      // Avisa o operador
      showAlert(
        'imovel-alert',
        '📋 Imóvel salvo como <strong>rascunho</strong>. Complete os campos e clique "Salvar" pra publicar.',
        'info',
      );
    } catch (err) {
      showAlert('imovel-alert', 'Erro ao criar rascunho: ' + err.message);
      return;
    }
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

function vitrineUrl(tenantIdOrSlug, finalidade) {
  const base = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
  let url = `${base}imoveis.html?t=${tenantIdOrSlug}`;
  if (finalidade === 'locacao' || finalidade === 'venda') {
    url += `&finalidade=${finalidade}`;
  }
  return url;
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
  // Carrega editor de templates do wizard em paralelo (não bloqueia se falhar)
  carregarTplEditor().catch(() => {});
  // Editor de perguntas do wizard (Fase F item 4)
  carregarPergEditor().catch(() => {});
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
  const slugAtivo = State.tenant.slug || State.tenant.id;
  $('cfg-vitrine-url').value = vitrineUrl(slugAtivo);
  const inputAluguel = $('cfg-vitrine-url-aluguel');
  if (inputAluguel) inputAluguel.value = vitrineUrl(slugAtivo, 'locacao');
  const inputVenda = $('cfg-vitrine-url-venda');
  if (inputVenda) inputVenda.value = vitrineUrl(slugAtivo, 'venda');
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
    const zsUrl = $('cfg-worker-zapsign-url');
    if (zsUrl) zsUrl.value = cfg.workerZapsignUrl || '';
    const zsTok = $('cfg-zapsign-token');
    if (zsTok) zsTok.value = cfg.zapsignToken || '';
    const asUrl = $('cfg-worker-asaas-url');
    if (asUrl) asUrl.value = cfg.workerAsaasUrl || '';
    const asTok = $('cfg-asaas-tenant-token');
    if (asTok) asTok.value = cfg.asaasTenantToken || '';
    const lgUrl = $('cfg-worker-legis-url');
    if (lgUrl) lgUrl.value = cfg.workerLegisUrl || '';
    const lgTok = $('cfg-legis-admin-token');
    if (lgTok) lgTok.value = cfg.legisAdminToken || '';
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
    const zsUrl = $('cfg-worker-zapsign-url');
    if (zsUrl) zsUrl.value = '';
    const zsTok = $('cfg-zapsign-token');
    if (zsTok) zsTok.value = '';
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
      const slugAtivoSave = slug || State.tenant.id;
      $('cfg-vitrine-url').value = vitrineUrl(slugAtivoSave);
      const inputAluguelS = $('cfg-vitrine-url-aluguel');
      if (inputAluguelS) inputAluguelS.value = vitrineUrl(slugAtivoSave, 'locacao');
      const inputVendaS = $('cfg-vitrine-url-venda');
      if (inputVendaS) inputVendaS.value = vitrineUrl(slugAtivoSave, 'venda');

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
        workerZapsignUrl: $('cfg-worker-zapsign-url')?.value.trim() || '',
        workerLegisUrl: $('cfg-worker-legis-url')?.value.trim() || '',
        legisAdminToken: $('cfg-legis-admin-token')?.value.trim() || '',
        zapsignToken: $('cfg-zapsign-token')?.value.trim() || '',
        workerAsaasUrl: $('cfg-worker-asaas-url')?.value.trim() || '',
        asaasTenantToken: $('cfg-asaas-tenant-token')?.value.trim() || '',
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

function copyVitrineUrl(finalidade) {
  const inputId = finalidade === 'locacao' ? 'cfg-vitrine-url-aluguel'
    : finalidade === 'venda' ? 'cfg-vitrine-url-venda'
    : 'cfg-vitrine-url';
  const input = $(inputId);
  if (!input) return;
  input.select();
  const label = finalidade === 'locacao' ? 'Link de Aluguel'
    : finalidade === 'venda' ? 'Link de Venda'
    : 'Link da vitrine';
  navigator.clipboard.writeText(input.value).then(() => {
    showAlert('cfg-alert', `${label} copiado!`, 'success');
  }).catch(() => {
    document.execCommand('copy');
    showAlert('cfg-alert', `${label} copiado!`, 'success');
  });
}

function openVitrinePublica(finalidade) {
  if (!State.tenant) return;
  window.open(vitrineUrl(State.tenant.slug || State.tenant.id, finalidade), '_blank');
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
          <td><strong>${c.numero || '—'}</strong></td>
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

  // Locador — filtra apenas quem pode atuar como locador (compat: sem papeis = pode tudo)
  const locadoresElegiveis = locadores.filter(l => {
    const p = l.papeis || { locador: true, vendedor: true };
    return p.locador !== false;
  });
  $('contrato-locador').innerHTML = ['<option value="">— Selecione —</option>']
    .concat(locadoresElegiveis.map(l => `<option value="${l.id}"${l.id === selected?.locadorId ? ' selected' : ''}>${l.nome}${l.tipo === 'PJ' ? ' (PJ)' : ''}</option>`))
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
  $('btn-gerar-distrato').style.display = id ? 'inline-block' : 'none';
  $('btn-cobranca-debito').style.display = id ? 'inline-block' : 'none';

  // Status ZapSign (carrega assíncrono — não bloqueia abertura)
  carregarStatusZapSign(id).catch(() => {});

  // Limpar
  ['contrato-inicio', 'contrato-fim', 'contrato-entrega-chaves', 'contrato-aluguel', 'contrato-multa',
   'contrato-clausulas', 'contrato-obs', 'contrato-motivo-status'].forEach(f => $(f).value = '');
  $('contrato-status').value = 'rascunho';
  $('contrato-prazo').value = '30';
  $('contrato-vencimento').value = '5';
  $('contrato-taxa-adm').value = '10';
  $('contrato-reajuste-indice').value = 'ipca';
  $('contrato-reajuste-periodicidade').value = 'anual';
  $('contrato-primeiro-aluguel-escritorio').checked = false;
  $('contrato-inadimplente').checked = false;
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
        $('contrato-entrega-chaves').value = c.dataEntregaChaves || '';
        $('contrato-aluguel').value = c.aluguel ?? '';
        $('contrato-vencimento').value = c.diaVencimento ?? 5;
        $('contrato-taxa-adm').value = c.taxaAdm ?? 10;
        $('contrato-multa').value = c.multaRescisoria ?? '';
        $('contrato-reajuste-indice').value = c.reajusteIndice || 'ipca';
        $('contrato-reajuste-periodicidade').value = c.reajustePeriodicidade || 'anual';
        $('contrato-primeiro-aluguel-escritorio').checked = !!c.primeiroAluguelEscritorio;
        $('contrato-inadimplente').checked = !!c.inadimplente;

        // Banner de versionamento — só aparece se o contrato foi gerado pelo wizard
        if (c.geradoPorWizard) {
          const data = c.criadoEm?.toDate ? fmtDataBR(c.criadoEm.toDate().toISOString().slice(0, 10)) : '—';
          const info = `Template <code>${c.templateId || 'desconhecido'}</code> (v${c.templateVersao || '?'}) em ${data}`;
          $('contrato-wizard-info').innerHTML = info;
          $('contrato-wizard-badge').style.display = 'block';
          $('contrato-wizard-badge').dataset.htmlSalvo = c.contratoHtml || '';
        } else {
          $('contrato-wizard-badge').style.display = 'none';
        }
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

// =============================================================
// Numeração sequencial automática por tipo (contratos / negociacoes).
// Usa transaction Firestore — atomic mesmo com usuários concorrentes.
// Contador vive em tenants/{tenantId}/contadores/{tipo}.valor.
// Retorna { numero: "00001", numeroSequencial: 1 }.
// =============================================================
async function proximoNumeroSequencial(tipo) {
  const counterRef = tenantPath().collection('contadores').doc(tipo);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const atual = snap.exists ? (snap.data().valor || 0) : 0;
    const proximo = atual + 1;
    tx.set(counterRef, {
      valor: proximo,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      numero: String(proximo).padStart(5, '0'),
      numeroSequencial: proximo,
    };
  });
}

// =============================================================
// RENUMERAR — operação admin pra alinhar contratos antigos
// =============================================================
// Ordena docs da coleção por criadoEm ASC e renumera de 1 em diante.
// Atualiza o contador também pra próximas inserções continuarem do certo.
async function renumerarRegistros(colecao) {
  if (!State.tenant) { alert('Carregue um tenant antes.'); return; }
  if (State.userDoc?.role !== 'admin' && !State.isSuperAdmin) {
    alert('Apenas administradores podem renumerar.');
    return;
  }
  const label = colecao === 'contratos' ? 'Contratos' : 'Negociações';
  const confirma1 = confirm(
    `⚠️ Renumerar TODOS os ${label}\n\n` +
    `Esta ação:\n` +
    `• Ordena os ${label.toLowerCase()} por data de criação\n` +
    `• Atribui números 00001, 00002, 00003... em sequência\n` +
    `• Sobrescreve os números atuais (NÃO é reversível)\n` +
    `• Atualiza o contador pra próximas inserções\n\n` +
    `Recomendação: fazer backup antes via Firebase Console.\n\n` +
    `Quer continuar?`
  );
  if (!confirma1) return;
  const confirma2 = prompt(`Pra confirmar, digite RENUMERAR (maiúsculas):`);
  if (confirma2 !== 'RENUMERAR') {
    alert('Operação cancelada (texto incorreto).');
    return;
  }

  try {
    const snap = await tenantPath().collection(colecao).get();
    if (snap.empty) {
      alert(`Nenhum ${label.toLowerCase()} pra renumerar.`);
      return;
    }

    // Ordena por criadoEm (mais antigo primeiro). Docs sem criadoEm vão pro fim.
    const docs = snap.docs.map(d => ({ id: d.id, ref: d.ref, data: d.data() }));
    docs.sort((a, b) => {
      const ta = a.data.criadoEm?.toMillis?.() || a.data.criadoEm?.seconds * 1000 || Number.MAX_SAFE_INTEGER;
      const tb = b.data.criadoEm?.toMillis?.() || b.data.criadoEm?.seconds * 1000 || Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });

    // Firestore: batch máx 500 ops. Vamos em chunks.
    const chunks = [];
    for (let i = 0; i < docs.length; i += 400) chunks.push(docs.slice(i, i + 400));

    let total = 0;
    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach((doc, idxInChunk) => {
        const globalIdx = total + idxInChunk + 1;
        batch.update(doc.ref, {
          numero: String(globalIdx).padStart(5, '0'),
          numeroSequencial: globalIdx,
          renumeradoEm: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      total += chunk.length;
    }

    // Atualiza o contador pra próximas inserções
    await tenantPath().collection('contadores').doc(colecao).set({
      valor: total,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    logAuditoria('renumerar', colecao, 'todos', { total });
    alert(`✅ ${total} ${label.toLowerCase()} renumerados com sucesso!\n\nÚltimo número: ${String(total).padStart(5, '0')}\nPróxima inserção será ${String(total + 1).padStart(5, '0')}.`);
    if (colecao === 'contratos') {
      if (typeof loadContratos === 'function') loadContratos();
    } else {
      if (typeof loadNegociacoes === 'function') loadNegociacoes();
    }
  } catch (err) {
    console.error('Erro ao renumerar:', err);
    alert('❌ Erro ao renumerar: ' + err.message);
  }
}
window.renumerarRegistros = renumerarRegistros;

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
    dataEntregaChaves: $('contrato-entrega-chaves').value || null,
    aluguel,
    diaVencimento: parseInt($('contrato-vencimento').value, 10) || 5,
    taxaAdm: parseFloat($('contrato-taxa-adm').value) || 10,
    multaRescisoria: parseFloat($('contrato-multa').value) || (aluguel * 3),
    reajusteIndice: $('contrato-reajuste-indice').value,
    reajustePeriodicidade: $('contrato-reajuste-periodicidade').value,
    primeiroAluguelEscritorio: $('contrato-primeiro-aluguel-escritorio').checked,
    inadimplente: $('contrato-inadimplente').checked,
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
      const seq = await proximoNumeroSequencial('contratos');
      data.numero = seq.numero;
      data.numeroSequencial = seq.numeroSequencial;
      data.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      data.criadoPor = State.user.uid;
      const docRef = await tenantPath().collection('contratos').add(data);
      contratoId = docRef.id;
      logAuditoria('create', 'contrato', contratoId, { numero: data.numero, status: data.status, aluguel: data.aluguel });
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
// COBRANÇA AUTOMÁTICA — Integração Asaas (super_admin)
// =============================================================
// Configuração global armazenada em drgConfig/cobranca (Firestore).
// Só super_admin lê/escreve via regras.

let _drgCobrancaCache = null;

async function loadDRGCobrancaConfig() {
  if (!State.isDRGMaster) return;
  try {
    const snap = await db.collection('drgConfig').doc('cobranca').get();
    const cfg = snap.exists ? snap.data() : {};
    _drgCobrancaCache = cfg;
    const urlEl = $('drg-cfg-asaas-url');
    const tokEl = $('drg-cfg-asaas-token');
    if (urlEl) urlEl.value = cfg.asaasWorkerUrl || '';
    if (tokEl) tokEl.value = cfg.asaasAdminToken || '';
    const status = $('drg-cobranca-status');
    if (status) {
      if (cfg.asaasWorkerUrl && cfg.asaasAdminToken) {
        status.textContent = '✅ Cobrança automática configurada.';
        status.style.color = 'var(--success)';
      } else {
        status.textContent = '⚠️ Configure URL e token pra habilitar cobrança automática.';
        status.style.color = 'var(--warning)';
      }
    }
  } catch (err) {
    console.warn('Erro ao carregar drgConfig/cobranca:', err);
  }
}

let _drgCobrancaSaveDebounce = null;
async function saveDRGCobrancaConfig() {
  if (!State.isDRGMaster) return;
  clearTimeout(_drgCobrancaSaveDebounce);
  _drgCobrancaSaveDebounce = setTimeout(async () => {
    try {
      const data = {
        asaasWorkerUrl: $('drg-cfg-asaas-url')?.value.trim() || '',
        asaasAdminToken: $('drg-cfg-asaas-token')?.value.trim() || '',
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        atualizadoPor: State.user.uid,
      };
      await db.collection('drgConfig').doc('cobranca').set(data, { merge: true });
      _drgCobrancaCache = data;
      const status = $('drg-cobranca-status');
      if (status) {
        status.textContent = '✅ Configuração salva.';
        status.style.color = 'var(--success)';
      }
    } catch (err) {
      const status = $('drg-cobranca-status');
      if (status) {
        status.textContent = 'Erro: ' + err.message;
        status.style.color = 'var(--danger)';
      }
    }
  }, 800);
}

async function ensureCobrancaConfig() {
  if (_drgCobrancaCache && _drgCobrancaCache.asaasWorkerUrl) return _drgCobrancaCache;
  try {
    const snap = await db.collection('drgConfig').doc('cobranca').get();
    if (snap.exists) {
      _drgCobrancaCache = snap.data();
      return _drgCobrancaCache;
    }
  } catch (_) {}
  return null;
}

async function chamarAsaas(method, path, body = null) {
  const cfg = await ensureCobrancaConfig();
  if (!cfg || !cfg.asaasWorkerUrl || !cfg.asaasAdminToken) {
    throw new Error('Cobrança Asaas não configurada. Configure URL e token no painel Super Admin.');
  }
  const url = cfg.asaasWorkerUrl.replace(/\/+$/, '') + path;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-DRG-Admin-Token': cfg.asaasAdminToken,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

// --- Carrega bloco Asaas no modal do tenant ---

async function carregarBlocoAsaas(tenantId) {
  const box = $('asaas-bloco-content');
  if (!box || !State.isSuperAdmin) return;

  const cfg = await ensureCobrancaConfig();
  if (!cfg || !cfg.asaasWorkerUrl) {
    box.innerHTML = `<p class="muted" style="font-size:12px; margin:0;">⚠️ Cobrança automática Asaas não está configurada. Configure no card superior do painel Super Admin.</p>`;
    return;
  }

  try {
    const tSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tSnap.exists) return;
    const t = tSnap.data();
    const asaas = t.asaas || {};

    if (!asaas.customerId) {
      // Tenant sem customer Asaas — botão "Criar cliente"
      box.innerHTML = `
        <p style="margin:0 0 10px; font-size:13px;">📌 Este tenant ainda <strong>não tem cliente Asaas vinculado</strong>.</p>
        <p class="muted" style="font-size:12px; margin: 0 0 12px;">Ao criar, o tenant vira customer no Asaas com nome/CNPJ/CPF/email. Depois você cria a assinatura recorrente.</p>
        <button class="btn btn-primary btn-sm" onclick="criarCustomerAsaas('${tenantId}')">+ Criar cliente Asaas</button>
      `;
      return;
    }

    if (!asaas.subscriptionId) {
      // Tem customer mas sem subscription
      box.innerHTML = `
        <p style="margin:0 0 10px; font-size:13px;">📌 Cliente Asaas criado: <strong>${escapeHtml(asaas.customerId)}</strong></p>
        <p class="muted" style="font-size:12px; margin: 0 0 12px;">Crie agora a assinatura recorrente (valor da mensalidade, periodicidade e método de cobrança).</p>
        <div class="form-row">
          <div class="form-group">
            <label>Método de cobrança</label>
            <select id="asaas-billing-type">
              <option value="PIX">PIX (sem boleto físico)</option>
              <option value="BOLETO">Boleto</option>
              <option value="UNDEFINED">Cliente escolhe na hora</option>
              <option value="CREDIT_CARD">Cartão de crédito</option>
            </select>
          </div>
          <div class="form-group">
            <label>Valor mensal (R$)</label>
            <input type="number" id="asaas-sub-valor" min="0" step="0.01" value="${t.valorMensalidade || ''}" placeholder="${t.valorMensalidade || '250.00'}">
          </div>
          <div class="form-group">
            <label>Primeiro vencimento</label>
            <input type="date" id="asaas-sub-data" value="${t.proximoVencimento || ''}">
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="criarSubscriptionAsaas('${tenantId}')">+ Criar assinatura recorrente</button>
          <button class="btn btn-secondary btn-sm" onclick="cobrancaAvulsaAsaas('${tenantId}')">➕ Cobrança avulsa única</button>
        </div>
        <p class="muted" style="font-size:11px; margin-top:8px;">
          💡 Use <strong>assinatura recorrente</strong> pra mensalidade fixa. Use <strong>cobrança avulsa</strong> pra setup, consultoria ou serviços únicos.
        </p>
      `;
      return;
    }

    // Tem subscription ativa — mostra status + opção de cancelar
    const statusLabel = {
      ACTIVE: '🟢 Ativa',
      INACTIVE: '🔴 Inativa',
      EXPIRED: '⏰ Expirada',
    }[asaas.subscriptionStatus] || asaas.subscriptionStatus || '—';

    box.innerHTML = `
      <p style="margin:0 0 6px; font-size:13px;"><strong>💳 Assinatura recorrente:</strong> ${statusLabel}</p>
      <p class="muted" style="font-size:11px; margin: 0 0 4px;">
        Customer: ${escapeHtml(asaas.customerId)}<br>
        Subscription: ${escapeHtml(asaas.subscriptionId)}<br>
        Valor: ${fmtBRL(asaas.subscriptionValue)} ${asaas.subscriptionCycle ? '· ' + asaas.subscriptionCycle : ''}
      </p>
      <div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" onclick="atualizarStatusAsaas('${tenantId}')">🔄 Atualizar status</button>
        <button class="btn btn-secondary btn-sm" onclick="reajustarSubscriptionAsaas('${tenantId}')">💰 Reajustar valor</button>
        <button class="btn btn-secondary btn-sm" onclick="cobrancaAvulsaAsaas('${tenantId}')">➕ Cobrança avulsa</button>
        <button class="btn btn-secondary btn-sm" onclick="listarPagamentosAsaas('${tenantId}')">📋 Ver pagamentos</button>
        <button class="btn btn-danger btn-sm" onclick="cancelarSubscriptionAsaas('${tenantId}')">🗑 Cancelar assinatura</button>
      </div>
    `;
  } catch (err) {
    box.innerHTML = `<p class="muted" style="color:var(--danger); font-size:12px; margin:0;">Erro: ${escapeHtml(err.message)}</p>`;
  }
}

async function criarCustomerAsaas(tenantId) {
  if (!confirm('Criar cliente Asaas pra este tenant? Os dados (nome, CNPJ/CPF, email, telefone) serão enviados.')) return;
  try {
    const tSnap = await db.collection('tenants').doc(tenantId).get();
    const t = tSnap.data();
    const cpfCnpj = (t.cnpj || t.cpf || '').replace(/\D/g, '');
    if (!cpfCnpj) throw new Error('Tenant não tem CPF nem CNPJ cadastrado.');

    // Busca email do admin do tenant (no users)
    let email = t.emailContato || '';
    if (!email) {
      const uSnap = await db.collection('users').where('tenantId', '==', tenantId).where('role', '==', 'admin').limit(1).get();
      if (!uSnap.empty) email = uSnap.docs[0].data().email || '';
    }
    if (!email) throw new Error('Tenant não tem email cadastrado.');

    const result = await chamarAsaas('POST', '/customers', {
      name: t.nome,
      email,
      cpfCnpj,
      phone: t.telefone || '',
      tenantId,
    });

    // Salva no tenant
    await db.collection('tenants').doc(tenantId).update({
      'asaas.customerId': result.customer.id,
      'asaas.customerCreatedAt': firebase.firestore.FieldValue.serverTimestamp(),
    });
    logAuditoria('asaas_customer_create', 'tenant', tenantId, { customerId: result.customer.id });
    alert(`✅ Cliente Asaas criado!\n\nID: ${result.customer.id}\nNome: ${t.nome}`);
    carregarBlocoAsaas(tenantId);
  } catch (err) {
    console.error('Erro ao criar customer Asaas:', err);
    alert('❌ Erro ao criar cliente Asaas:\n\n' + err.message);
  }
}

async function criarSubscriptionAsaas(tenantId) {
  const billingType = $('asaas-billing-type').value;
  const valor = parseFloat($('asaas-sub-valor').value);
  const dataVenc = $('asaas-sub-data').value;
  if (!valor || valor <= 0) { showAlert('tenant-alert', 'Informe o valor mensal.'); return; }
  if (!dataVenc) { showAlert('tenant-alert', 'Informe a data do primeiro vencimento.'); return; }

  if (!confirm(`Criar assinatura recorrente?\n\nValor: ${fmtBRL(valor)}/mês\nMétodo: ${billingType}\nPrimeiro vencimento: ${dataVenc}\n\nO cliente vai começar a receber cobranças automaticamente.`)) return;

  try {
    const tSnap = await db.collection('tenants').doc(tenantId).get();
    const t = tSnap.data();
    if (!t.asaas?.customerId) throw new Error('Tenant não tem customer Asaas. Crie o cliente primeiro.');

    const result = await chamarAsaas('POST', '/subscriptions', {
      customer: t.asaas.customerId,
      value: valor,
      nextDueDate: dataVenc,
      billingType,
      cycle: 'MONTHLY',
      description: `DRG-Rently - ${t.nome}`,
      tenantId,
    });

    await db.collection('tenants').doc(tenantId).update({
      'asaas.subscriptionId': result.subscription.id,
      'asaas.subscriptionStatus': result.subscription.status,
      'asaas.subscriptionValue': result.subscription.value,
      'asaas.subscriptionCycle': result.subscription.cycle,
      'asaas.subscriptionBillingType': billingType,
      'asaas.subscriptionCreatedAt': firebase.firestore.FieldValue.serverTimestamp(),
      valorMensalidade: valor,
      proximoVencimento: dataVenc,
    });
    logAuditoria('asaas_subscription_create', 'tenant', tenantId, { subscriptionId: result.subscription.id, valor });
    alert(`✅ Assinatura criada com sucesso!\n\nCliente: ${t.nome}\nValor: ${fmtBRL(valor)}/mês\nMétodo: ${billingType}\nID: ${result.subscription.id}\n\nO cliente vai receber a primeira cobrança em breve.`);
    loadTenantPagamentos(tenantId);
    carregarBlocoAsaas(tenantId);
  } catch (err) {
    console.error('Erro ao criar subscription Asaas:', err);
    alert('❌ Erro ao criar assinatura:\n\n' + err.message);
  }
}

// ----- REAJUSTAR valor da subscription -----

async function reajustarSubscriptionAsaas(tenantId) {
  try {
    const tSnap = await db.collection('tenants').doc(tenantId).get();
    const t = tSnap.data();
    if (!t.asaas?.subscriptionId) {
      alert('Tenant não tem assinatura Asaas ativa.');
      return;
    }
    const valorAtual = t.asaas.subscriptionValue || t.valorMensalidade || 0;
    const novoValorStr = prompt(`Reajustar valor da assinatura\n\nValor atual: ${fmtBRL(valorAtual)}\n\nDigite o novo valor mensal (R$):`, valorAtual.toFixed(2));
    if (!novoValorStr) return;
    const novoValor = parseFloat(novoValorStr.replace(',', '.'));
    if (!novoValor || novoValor <= 0) { alert('Valor inválido.'); return; }

    const aplicarPendentes = confirm(`Aplicar também a cobranças JÁ GERADAS mas ainda PENDENTES?\n\nOK = sim (cliente recebe nova cobrança com valor reajustado)\nCancelar = não (só vale a partir do próximo ciclo)`);

    const result = await chamarAsaas('PUT', `/subscriptions/${t.asaas.subscriptionId}`, {
      value: novoValor,
      updatePendingPayments: aplicarPendentes,
    });

    await db.collection('tenants').doc(tenantId).update({
      'asaas.subscriptionValue': novoValor,
      valorMensalidade: novoValor,
    });
    logAuditoria('asaas_subscription_update', 'tenant', tenantId, { de: valorAtual, para: novoValor, aplicarPendentes });
    alert(`✅ Valor atualizado!\n\nDe: ${fmtBRL(valorAtual)}\nPara: ${fmtBRL(novoValor)}\n\nPróximas cobranças sairão com novo valor.`);
    carregarBlocoAsaas(tenantId);
  } catch (err) {
    console.error('Erro ao reajustar:', err);
    alert('❌ Erro ao reajustar:\n\n' + err.message);
  }
}

// ----- COBRANÇA AVULSA (não-recorrente) -----

async function cobrancaAvulsaAsaas(tenantId) {
  try {
    const tSnap = await db.collection('tenants').doc(tenantId).get();
    const t = tSnap.data();
    if (!t.asaas?.customerId) {
      alert('Tenant não tem cliente Asaas vinculado. Crie o cliente primeiro.');
      return;
    }

    const descricao = prompt('💼 Cobrança avulsa\n\nDescrição (ex: "Setup self-hosted", "Hora consultoria"):', 'Cobrança extra DRG-Rently');
    if (!descricao) return;

    const valorStr = prompt('Valor (R$):', '500.00');
    if (!valorStr) return;
    const valor = parseFloat(valorStr.replace(',', '.'));
    if (!valor || valor <= 0) { alert('Valor inválido.'); return; }

    const hoje = new Date();
    const venc = new Date(hoje.getTime() + 5 * 24 * 60 * 60 * 1000); // +5 dias
    const dataPadraoISO = venc.toISOString().slice(0, 10);
    const dataVencBR = prompt('Data de vencimento (DD/MM/AAAA):', fmtDataBR(dataPadraoISO));
    if (!dataVencBR) return;
    const mBR = dataVencBR.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!mBR) { alert('Data inválida. Use o formato DD/MM/AAAA.'); return; }
    const dataVenc = `${mBR[3]}-${mBR[2]}-${mBR[1]}`;
    const dataCheck = new Date(dataVenc + 'T00:00:00');
    if (isNaN(dataCheck.getTime()) || dataCheck.toISOString().slice(0,10) !== dataVenc) {
      alert('Data inválida.'); return;
    }

    const metodo = prompt('Método (PIX, BOLETO, CREDIT_CARD ou UNDEFINED = cliente escolhe):', 'PIX');
    if (!metodo) return;

    if (!confirm(`Confirmar cobrança avulsa?\n\nCliente: ${t.nome}\nDescrição: ${descricao}\nValor: ${fmtBRL(valor)}\nVencimento: ${fmtDataBR(dataVenc)}\nMétodo: ${metodo.toUpperCase()}\n\nO cliente vai receber por e-mail.`)) return;

    const result = await chamarAsaas('POST', '/payments', {
      customer: t.asaas.customerId,
      value: valor,
      dueDate: dataVenc,
      description: descricao,
      billingType: metodo.toUpperCase(),
      tenantId,
    });

    // Registra no histórico local
    await tenantPath().collection('pagamentos').add({
      asaasPaymentId: result.payment.id,
      data: dataVenc,
      valor,
      metodo: metodo.toLowerCase(),
      obs: `📌 Avulso: ${descricao}`,
      status: result.payment.status,
      registradoPor: State.user.uid,
      registradoEm: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});

    logAuditoria('asaas_payment_avulso', 'tenant', tenantId, { paymentId: result.payment.id, valor, descricao });
    alert(`✅ Cobrança avulsa criada!\n\nValor: ${fmtBRL(valor)}\nVencimento: ${fmtDataBR(dataVenc)}\nID: ${result.payment.id}\n\nO cliente recebeu por e-mail.${result.payment.invoiceUrl ? '\n\nLink da fatura:\n' + result.payment.invoiceUrl : ''}`);
    loadTenantPagamentos(tenantId);
  } catch (err) {
    console.error('Erro ao criar cobrança avulsa:', err);
    alert('❌ Erro ao criar cobrança avulsa:\n\n' + err.message);
  }
}

async function atualizarStatusAsaas(tenantId) {
  try {
    const tSnap = await db.collection('tenants').doc(tenantId).get();
    const t = tSnap.data();
    if (!t.asaas?.subscriptionId) return;

    const result = await chamarAsaas('GET', `/subscriptions/${t.asaas.subscriptionId}`);
    await db.collection('tenants').doc(tenantId).update({
      'asaas.subscriptionStatus': result.subscription.status,
      'asaas.subscriptionValue': result.subscription.value,
      'asaas.subscriptionNextDueDate': result.subscription.nextDueDate,
    });
    showAlert('tenant-alert', `Status atualizado: ${result.subscription.status}`, 'success');
    carregarBlocoAsaas(tenantId);
  } catch (err) {
    showAlert('tenant-alert', 'Erro: ' + err.message);
  }
}

async function listarPagamentosAsaas(tenantId) {
  try {
    const tSnap = await db.collection('tenants').doc(tenantId).get();
    const t = tSnap.data();
    if (!t.asaas?.subscriptionId) return;

    const result = await chamarAsaas('GET', `/subscriptions/${t.asaas.subscriptionId}/payments`);
    const pgs = result.payments || [];
    if (pgs.length === 0) {
      alert('Nenhum pagamento gerado ainda pra essa assinatura.');
      return;
    }
    const linhas = pgs.map(p =>
      `${p.dueDate || '—'} · ${fmtBRL(p.value)} · ${p.status} ${p.invoiceUrl ? '· Link: ' + p.invoiceUrl : ''}`
    ).join('\n');
    alert(`Pagamentos da assinatura (${pgs.length}):\n\n${linhas}`);
  } catch (err) {
    showAlert('tenant-alert', 'Erro: ' + err.message);
  }
}

async function cancelarSubscriptionAsaas(tenantId) {
  if (!confirm('⚠️ Cancelar assinatura recorrente no Asaas?\n\nO cliente para de receber cobranças automáticas. Pagamentos já gerados continuam válidos.')) return;
  try {
    const tSnap = await db.collection('tenants').doc(tenantId).get();
    const t = tSnap.data();
    if (!t.asaas?.subscriptionId) return;

    await chamarAsaas('DELETE', `/subscriptions/${t.asaas.subscriptionId}`);
    await db.collection('tenants').doc(tenantId).update({
      'asaas.subscriptionId': firebase.firestore.FieldValue.delete(),
      'asaas.subscriptionStatus': 'CANCELLED',
      'asaas.canceladoEm': firebase.firestore.FieldValue.serverTimestamp(),
    });
    logAuditoria('asaas_subscription_cancel', 'tenant', tenantId, {});
    showAlert('tenant-alert', '✅ Assinatura cancelada.', 'success');
    carregarBlocoAsaas(tenantId);
  } catch (err) {
    showAlert('tenant-alert', 'Erro: ' + err.message);
  }
}

// Expor globalmente
window.saveDRGCobrancaConfig = saveDRGCobrancaConfig;
window.criarCustomerAsaas = criarCustomerAsaas;
window.criarSubscriptionAsaas = criarSubscriptionAsaas;
window.atualizarStatusAsaas = atualizarStatusAsaas;
window.listarPagamentosAsaas = listarPagamentosAsaas;
window.cancelarSubscriptionAsaas = cancelarSubscriptionAsaas;
window.reajustarSubscriptionAsaas = reajustarSubscriptionAsaas;
window.cobrancaAvulsaAsaas = cobrancaAvulsaAsaas;

// =============================================================
// ASSINATURA ELETRÔNICA — Integração ZapSign
// =============================================================

let _zapsignContexto = null; // { contratoId, signers: [...] }

// Abre o modal de envio: monta signatários a partir do contrato atual
async function abrirEnvioZapSign() {
  const contratoId = $('contrato-id').value;
  if (!contratoId) {
    showAlert('contrato-alert', 'Salve o contrato antes de enviar pra assinatura.');
    return;
  }

  // Confere config ZapSign
  const cfgSnap = await tenantPath().collection('config').doc('site').get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  if (!cfg.workerZapsignUrl || !cfg.zapsignToken) {
    showAlert('contrato-alert', 'Configure URL do Worker ZapSign + Token em Configurações → Assinatura Eletrônica.');
    return;
  }

  try {
    const cSnap = await tenantPath().collection('contratos').doc(contratoId).get();
    if (!cSnap.exists) { showAlert('contrato-alert', 'Contrato não encontrado.'); return; }
    const c = cSnap.data();

    // Busca dados dos signatários
    const [locadorSnap, locatarioSnap, garantiaSnap, imovelSnap] = await Promise.all([
      c.locadorId   ? tenantPath().collection('locadores').doc(c.locadorId).get()   : Promise.resolve(null),
      c.locatarioId ? tenantPath().collection('locatarios').doc(c.locatarioId).get() : Promise.resolve(null),
      c.garantiaId  ? tenantPath().collection('garantias').doc(c.garantiaId).get()  : Promise.resolve(null),
      c.imovelId    ? tenantPath().collection('imoveis').doc(c.imovelId).get()    : Promise.resolve(null),
    ]);
    const locador = locadorSnap && locadorSnap.exists ? locadorSnap.data() : null;
    const locatario = locatarioSnap && locatarioSnap.exists ? locatarioSnap.data() : null;
    const garantia = garantiaSnap && garantiaSnap.exists ? garantiaSnap.data() : null;
    const imovel = imovelSnap && imovelSnap.exists ? imovelSnap.data() : null;

    const signers = [];
    if (locador && locador.email) {
      signers.push({ name: locador.nome, email: locador.email, cpf: (locador.documento || '').replace(/\D/g, ''), role: 'Locador' });
    }
    if (locatario && locatario.email) {
      signers.push({ name: locatario.nome, email: locatario.email, cpf: (locatario.cpf || '').replace(/\D/g, ''), role: 'Locatário' });
    }
    // Se garantia for fiador com e-mail, adiciona
    if (garantia && garantia.tipo === 'fiador' && garantia.fiadorEmail) {
      signers.push({ name: garantia.fiadorNome || 'Fiador', email: garantia.fiadorEmail, cpf: (garantia.fiadorCpf || '').replace(/\D/g, ''), role: 'Fiador' });
    }

    _zapsignContexto = { contratoId, signers, contrato: c, imovel };

    $('zapsign-doc-name').value = `Contrato de Locação - ${imovel?.apelido || 'Imóvel'}`;
    $('zapsign-message').value = 'Por favor, leia e assine o contrato de locação. Em caso de dúvidas, entre em contato com nossa imobiliária.';

    renderSignersZapSign();
    clearAlert('zapsign-alert');
    $('modal-zapsign').style.display = 'flex';
  } catch (err) {
    console.error('Erro ao abrir modal ZapSign:', err);
    showAlert('contrato-alert', 'Erro: ' + err.message);
  }
}

function closeEnvioZapSign() {
  $('modal-zapsign').style.display = 'none';
  _zapsignContexto = null;
}

function renderSignersZapSign() {
  if (!_zapsignContexto) return;
  const container = $('zapsign-signers-list');
  container.innerHTML = _zapsignContexto.signers.map((s, idx) => `
    <div class="zapsign-signer-row" data-idx="${idx}">
      <div class="form-row" style="margin-bottom:6px;">
        <div class="form-group">
          <label>Nome ${s.role ? `(${s.role})` : ''}</label>
          <input type="text" value="${escapeHtml(s.name || '')}" onchange="updateSignerZapSign(${idx}, 'name', this.value)">
        </div>
        <div class="form-group">
          <label>E-mail</label>
          <input type="email" value="${escapeHtml(s.email || '')}" onchange="updateSignerZapSign(${idx}, 'email', this.value)">
        </div>
        <div class="form-group" style="max-width:160px;">
          <label>CPF (opcional)</label>
          <input type="text" value="${escapeHtml(s.cpf || '')}" onchange="updateSignerZapSign(${idx}, 'cpf', this.value)">
        </div>
        <div class="form-group" style="max-width:40px; display:flex; align-items:flex-end;">
          <button class="btn btn-danger btn-sm" type="button" onclick="removerSignerZapSign(${idx})" title="Remover">×</button>
        </div>
      </div>
    </div>
  `).join('');
}

function addSignerZapSign() {
  if (!_zapsignContexto) return;
  _zapsignContexto.signers.push({ name: '', email: '', cpf: '', role: 'Testemunha' });
  renderSignersZapSign();
}

function updateSignerZapSign(idx, campo, valor) {
  if (!_zapsignContexto) return;
  if (!_zapsignContexto.signers[idx]) return;
  _zapsignContexto.signers[idx][campo] = valor;
}

function removerSignerZapSign(idx) {
  if (!_zapsignContexto) return;
  _zapsignContexto.signers.splice(idx, 1);
  renderSignersZapSign();
}

async function enviarParaZapSign() {
  if (!_zapsignContexto) return;
  clearAlert('zapsign-alert');
  const docName = $('zapsign-doc-name').value.trim();
  const message = $('zapsign-message').value.trim();

  if (!docName) { showAlert('zapsign-alert', 'Nome do documento é obrigatório.'); return; }
  const signers = _zapsignContexto.signers.filter(s => s.name && s.email);
  if (signers.length === 0) { showAlert('zapsign-alert', 'Pelo menos 1 signatário com nome e e-mail é obrigatório.'); return; }

  const btn = $('btn-enviar-zapsign');
  btn.disabled = true; btn.textContent = '⏳ Gerando PDF...';

  try {
    // 1) Gera o HTML do contrato (chama função existente sem mostrar modal)
    showAlert('zapsign-alert', '📄 Gerando PDF do contrato...', 'info');
    const pdfBase64 = await gerarPdfContratoBase64();
    if (!pdfBase64) throw new Error('Falha ao gerar PDF do contrato. Tente gerar manualmente primeiro (botão 📄 Gerar contrato).');

    btn.textContent = '⏳ Enviando ao ZapSign...';
    showAlert('zapsign-alert', '✍️ Enviando ao ZapSign...', 'info');

    // 2) Busca config
    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.data();

    // 3) Chama Worker
    const workerUrl = (cfg.workerZapsignUrl || '').replace(/\/+$/, '');
    const res = await fetch(`${workerUrl}/docs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ZapSign-Token': cfg.zapsignToken,
      },
      body: JSON.stringify({
        name: docName,
        pdfBase64,
        signers: signers.map(s => ({
          name: s.name,
          email: s.email,
          cpf: s.cpf || undefined,
        })),
        externalId: _zapsignContexto.contratoId,
        brandColor: '#475569',
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Erro ${res.status} ao chamar ZapSign`);
    }

    const result = await res.json();

    // 4) Salva no contrato ou na negociação (depende do tipo)
    const ehNegociacao = _zapsignContexto.tipo === 'negociacao';
    const colecao = ehNegociacao ? 'negociacoes' : 'contratos';
    const entidadeAuditoria = ehNegociacao ? 'negociacao' : 'contrato';
    const alertEl = ehNegociacao ? 'negociacao-alert' : 'contrato-alert';

    await tenantPath().collection(colecao).doc(_zapsignContexto.contratoId).update({
      zapsign: {
        openId: result.openId,
        token: result.token,
        name: result.name,
        status: result.status || 'pending',
        signers: result.signers || [],
        enviadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        enviadoPor: State.user.uid,
        externalId: _zapsignContexto.contratoId,
      },
    });

    logAuditoria('zapsign_envio', entidadeAuditoria, _zapsignContexto.contratoId, { signers: signers.length });

    closeEnvioZapSign();
    // Recarrega status no modal correspondente
    if (ehNegociacao) {
      await carregarStatusZapSignNegociacao(_zapsignContexto.contratoId);
    } else {
      await carregarStatusZapSign(_zapsignContexto.contratoId);
    }
    showAlert(alertEl, `✅ ${ehNegociacao ? 'Contrato de venda' : 'Contrato'} enviado pra ZapSign! ${signers.length} signatário(s) vão receber e-mail.`, 'success');
  } catch (err) {
    console.error('Erro ao enviar ZapSign:', err);
    showAlert('zapsign-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '📧 Enviar para assinatura';
  }
}

// Gera o PDF do contrato em base64 usando html2pdf.js
async function gerarPdfContratoBase64() {
  // 1) Garante que o HTML do contrato está renderizado em #contrato-preview-content
  const preview = $('contrato-preview-content');
  if (!preview || !preview.innerHTML.trim()) {
    // Detecta se é negociação (venda) ou contrato (locação) pelo contexto.
    const ehNegociacao = _zapsignContexto?.tipo === 'negociacao';
    try {
      if (ehNegociacao && typeof gerarContratoVenda === 'function') {
        await gerarContratoVenda();
      } else if (typeof gerarContratoLocacao === 'function') {
        await gerarContratoLocacao();
      }
      $('modal-contrato-preview').style.display = 'none'; // não queremos abrir o preview pro usuário
    } catch (_) {
      return null;
    }
  }
  if (!preview.innerHTML.trim()) return null;
  if (!window.html2pdf) {
    showAlert('zapsign-alert', 'Biblioteca html2pdf não carregou. Recarregue a página.');
    return null;
  }

  // 2) Cria container temporário com o conteúdo do preview (estilos inline pra pdf)
  const wrapper = document.createElement('div');
  wrapper.style.width = '210mm';
  wrapper.style.padding = '20mm';
  wrapper.style.background = '#fff';
  wrapper.style.color = '#111';
  wrapper.style.fontFamily = 'Georgia, "Times New Roman", serif';
  wrapper.style.fontSize = '12pt';
  wrapper.style.lineHeight = '1.6';
  wrapper.innerHTML = preview.innerHTML;

  const opt = {
    margin: 0,
    filename: 'contrato.pdf',
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };

  // 3) Gera PDF como Blob → converte pra base64
  const pdfBlob = await html2pdf().set(opt).from(wrapper).outputPdf('blob');
  return await blobToBase64(pdfBlob);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // remove o prefixo "data:application/pdf;base64,"
      const base64 = result.substring(result.indexOf(',') + 1);
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Falha ao converter blob'));
    reader.readAsDataURL(blob);
  });
}

// Carrega e exibe status atual da assinatura ZapSign do contrato
async function carregarStatusZapSign(contratoId) {
  const box = $('zapsign-status-box');
  const btnEnviar = $('btn-zapsign-contrato');
  const btnStatus = $('btn-zapsign-status');
  if (!box || !btnEnviar) return;

  if (!contratoId) {
    box.style.display = 'none';
    btnEnviar.style.display = 'none';
    btnStatus.style.display = 'none';
    return;
  }

  try {
    const cSnap = await tenantPath().collection('contratos').doc(contratoId).get();
    if (!cSnap.exists) return;
    const c = cSnap.data();

    // Verifica config ZapSign
    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    const zapsignConfigurado = !!(cfg.workerZapsignUrl && cfg.zapsignToken);

    if (!zapsignConfigurado) {
      btnEnviar.style.display = 'none';
      btnStatus.style.display = 'none';
      box.style.display = 'none';
      return;
    }

    // Sem assinatura enviada ainda → mostra botão "Enviar pra assinatura"
    if (!c.zapsign || !c.zapsign.openId) {
      btnEnviar.style.display = 'inline-block';
      btnStatus.style.display = 'none';
      box.style.display = 'none';
      return;
    }

    // Já tem envio → mostra status + botão atualizar
    btnEnviar.style.display = 'none';
    btnStatus.style.display = 'inline-block';
    box.style.display = 'block';

    const zs = c.zapsign;
    const statusLabels = { pending: '⏳ Aguardando assinaturas', signed: '✅ Totalmente assinado', refused: '❌ Recusado', expired: '⏰ Expirado' };
    const statusLabel = statusLabels[zs.status] || zs.status;

    const signersHtml = (zs.signers || []).map(s => {
      const ico = s.status === 'signed' ? '✅' : s.status === 'refused' ? '❌' : '⏳';
      return `<div style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:12px;">
        ${ico} <strong>${escapeHtml(s.name)}</strong>
        <span class="muted">${escapeHtml(s.email)}</span>
        <span style="margin-left:auto; font-size:11px;">${s.status === 'signed' ? 'Assinou' : s.status === 'refused' ? 'Recusou' : 'Pendente'}</span>
      </div>`;
    }).join('');

    let downloadBtn = '';
    if (zs.status === 'signed' || zs.signedFileUrl) {
      const url = zs.signedFileUrl;
      downloadBtn = url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="margin-top:8px;">📄 Baixar PDF assinado</a>`
        : `<button class="btn btn-primary btn-sm" onclick="baixarPdfAssinadoZapSign()" style="margin-top:8px;">📄 Baixar PDF assinado</button>`;
    }

    $('zapsign-status-content').innerHTML = `
      <div style="margin-bottom:8px;"><strong>Status:</strong> ${statusLabel}</div>
      <div style="margin-bottom:4px;"><strong>Documento:</strong> ${escapeHtml(zs.name || '—')}</div>
      ${signersHtml}
      ${downloadBtn}
    `;
  } catch (err) {
    console.warn('Erro ao carregar status ZapSign:', err);
  }
}

async function atualizarStatusZapSign() {
  const contratoId = $('contrato-id').value;
  if (!contratoId) return;
  const btn = $('btn-zapsign-status');
  btn.disabled = true; btn.textContent = '⏳ Consultando...';
  try {
    const cSnap = await tenantPath().collection('contratos').doc(contratoId).get();
    const c = cSnap.data();
    if (!c.zapsign || !c.zapsign.openId) { showAlert('contrato-alert', 'Sem assinatura registrada.'); return; }

    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.data();
    const workerUrl = (cfg.workerZapsignUrl || '').replace(/\/+$/, '');

    const res = await fetch(`${workerUrl}/docs/${c.zapsign.openId}`, {
      headers: { 'X-ZapSign-Token': cfg.zapsignToken },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erro ao consultar status');
    }
    const data = await res.json();

    // Atualiza Firestore
    const updateData = {
      'zapsign.status': data.status,
      'zapsign.signers': data.signers || [],
    };
    if (data.signedFileUrl) updateData['zapsign.signedFileUrl'] = data.signedFileUrl;
    await tenantPath().collection('contratos').doc(contratoId).update(updateData);

    // Se totalmente assinado, atualiza status do contrato pra vigente (se ainda for rascunho)
    if (data.status === 'signed' && c.status === 'rascunho') {
      await tenantPath().collection('contratos').doc(contratoId).update({ status: 'vigente' });
      logAuditoria('zapsign_signed', 'contrato', contratoId, {});
    }

    await carregarStatusZapSign(contratoId);
    showAlert('contrato-alert', `Status atualizado: ${data.status === 'signed' ? '✅ Totalmente assinado' : '⏳ Aguardando assinaturas'}`, 'success');
  } catch (err) {
    showAlert('contrato-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '🔄 Atualizar status';
  }
}

async function baixarPdfAssinadoZapSign() {
  const contratoId = $('contrato-id').value;
  if (!contratoId) return;
  try {
    const cSnap = await tenantPath().collection('contratos').doc(contratoId).get();
    const c = cSnap.data();
    if (!c.zapsign || !c.zapsign.openId) return;

    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.data();
    const workerUrl = (cfg.workerZapsignUrl || '').replace(/\/+$/, '');

    const res = await fetch(`${workerUrl}/docs/${c.zapsign.openId}/pdf`, {
      headers: { 'X-ZapSign-Token': cfg.zapsignToken },
    });
    const data = await res.json();
    if (!res.ok || !data.signedFileUrl) {
      throw new Error(data.error || 'PDF assinado ainda não disponível.');
    }
    window.open(data.signedFileUrl, '_blank');
  } catch (err) {
    showAlert('contrato-alert', 'Erro: ' + err.message);
  }
}

// =============================================================
// ZAPSIGN PARA NEGOCIAÇÕES (Compra e Venda) — Fase F item 7
// =============================================================
// Reutiliza o mesmo modal #modal-zapsign do contrato. A diferença
// está nos dados: vendedor (em vez de locador), comprador (em vez de
// locatário) e o título "Compra e Venda" no documento.

async function abrirEnvioZapSignNegociacao() {
  const negociacaoId = $('negociacao-id').value;
  if (!negociacaoId) {
    showAlert('negociacao-alert', 'Salve a negociação antes de enviar pra assinatura.');
    return;
  }

  const cfgSnap = await tenantPath().collection('config').doc('site').get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  if (!cfg.workerZapsignUrl || !cfg.zapsignToken) {
    showAlert('negociacao-alert', 'Configure URL do Worker ZapSign + Token em Configurações → Assinatura Eletrônica.');
    return;
  }

  try {
    const nSnap = await tenantPath().collection('negociacoes').doc(negociacaoId).get();
    if (!nSnap.exists) { showAlert('negociacao-alert', 'Negociação não encontrada.'); return; }
    const n = nSnap.data();

    // Busca dados dos signatários: vendedor + comprador + imóvel
    const [vendedorSnap, compradorSnap, imovelSnap] = await Promise.all([
      n.vendedorId  ? tenantPath().collection('locadores').doc(n.vendedorId).get() : Promise.resolve(null),
      n.compradorId ? tenantPath().collection('compradores').doc(n.compradorId).get() : Promise.resolve(null),
      n.imovelId    ? tenantPath().collection('imoveis').doc(n.imovelId).get() : Promise.resolve(null),
    ]);
    const vendedor = vendedorSnap && vendedorSnap.exists ? vendedorSnap.data() : null;
    const comprador = compradorSnap && compradorSnap.exists ? compradorSnap.data() : null;
    const imovel = imovelSnap && imovelSnap.exists ? imovelSnap.data() : null;

    const signers = [];
    if (vendedor && vendedor.email) {
      signers.push({
        name: vendedor.nome,
        email: vendedor.email,
        cpf: (vendedor.documento || '').replace(/\D/g, ''),
        role: 'Vendedor',
      });
    }
    if (comprador && comprador.email) {
      signers.push({
        name: comprador.nome,
        email: comprador.email,
        cpf: (comprador.documento || comprador.cpf || '').replace(/\D/g, ''),
        role: 'Comprador',
      });
    }

    // Marca o contexto como negociação (tipo: 'negociacao')
    _zapsignContexto = {
      contratoId: negociacaoId, // reusa o nome do campo pra simplificar funções compartilhadas
      tipo: 'negociacao',
      signers,
      negociacao: n,
      imovel,
    };

    $('zapsign-doc-name').value = `Contrato de Compra e Venda - ${imovel?.apelido || 'Imóvel'}`;
    $('zapsign-message').value = 'Por favor, leia e assine o contrato de compra e venda. Em caso de dúvidas, entre em contato com nossa imobiliária.';

    renderSignersZapSign();
    clearAlert('zapsign-alert');
    $('modal-zapsign').style.display = 'flex';
  } catch (err) {
    console.error('Erro ao abrir modal ZapSign (negociação):', err);
    showAlert('negociacao-alert', 'Erro: ' + err.message);
  }
}

// Atualiza status ZapSign da negociação
async function atualizarStatusZapSignNegociacao() {
  const negociacaoId = $('negociacao-id').value;
  if (!negociacaoId) return;
  const btn = $('btn-zapsign-negociacao-status');
  btn.disabled = true; btn.textContent = '⏳ Consultando...';
  try {
    const nSnap = await tenantPath().collection('negociacoes').doc(negociacaoId).get();
    const n = nSnap.data();
    if (!n.zapsign || !n.zapsign.openId) {
      showAlert('negociacao-alert', 'Sem assinatura registrada.');
      return;
    }

    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.data();
    const workerUrl = (cfg.workerZapsignUrl || '').replace(/\/+$/, '');

    const res = await fetch(`${workerUrl}/docs/${n.zapsign.openId}`, {
      headers: { 'X-ZapSign-Token': cfg.zapsignToken },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erro ao consultar status');
    }
    const data = await res.json();

    const updateData = {
      'zapsign.status': data.status,
      'zapsign.signers': data.signers || [],
    };
    if (data.signedFileUrl) updateData['zapsign.signedFileUrl'] = data.signedFileUrl;
    await tenantPath().collection('negociacoes').doc(negociacaoId).update(updateData);

    // Se 100% assinado e negociação ainda em rascunho/em_negociacao → marca "aceita"
    if (data.status === 'signed' && (n.status === 'rascunho' || n.status === 'em_negociacao')) {
      await tenantPath().collection('negociacoes').doc(negociacaoId).update({ status: 'aceita' });
      logAuditoria('zapsign_signed', 'negociacao', negociacaoId, {});
    }

    await carregarStatusZapSignNegociacao(negociacaoId);
    showAlert('negociacao-alert', `Status atualizado: ${data.status === 'signed' ? '✅ Totalmente assinado' : '⏳ Aguardando assinaturas'}`, 'success');
  } catch (err) {
    showAlert('negociacao-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '🔄 Atualizar status';
  }
}

// Carrega status atual da assinatura da negociação
async function carregarStatusZapSignNegociacao(negociacaoId) {
  const box = $('zapsign-negociacao-status-box');
  const btnEnviar = $('btn-zapsign-negociacao');
  const btnStatus = $('btn-zapsign-negociacao-status');
  if (!box || !btnEnviar) return;

  if (!negociacaoId) {
    box.style.display = 'none';
    btnEnviar.style.display = 'none';
    btnStatus.style.display = 'none';
    return;
  }

  try {
    const nSnap = await tenantPath().collection('negociacoes').doc(negociacaoId).get();
    if (!nSnap.exists) return;
    const n = nSnap.data();

    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    const zapsignConfigurado = !!(cfg.workerZapsignUrl && cfg.zapsignToken);

    if (!zapsignConfigurado) {
      btnEnviar.style.display = 'none';
      btnStatus.style.display = 'none';
      box.style.display = 'none';
      return;
    }

    if (!n.zapsign || !n.zapsign.openId) {
      btnEnviar.style.display = 'inline-block';
      btnStatus.style.display = 'none';
      box.style.display = 'none';
      return;
    }

    btnEnviar.style.display = 'none';
    btnStatus.style.display = 'inline-block';
    box.style.display = 'block';

    const zs = n.zapsign;
    const statusLabels = { pending: '⏳ Aguardando assinaturas', signed: '✅ Totalmente assinado', refused: '❌ Recusado', expired: '⏰ Expirado' };
    const statusLabel = statusLabels[zs.status] || zs.status;

    const signersHtml = (zs.signers || []).map(s => {
      const ico = s.status === 'signed' ? '✅' : s.status === 'refused' ? '❌' : '⏳';
      return `<div style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:12px;">
        ${ico} <strong>${escapeHtml(s.name)}</strong>
        <span class="muted">${escapeHtml(s.email)}</span>
        <span style="margin-left:auto; font-size:11px;">${s.status === 'signed' ? 'Assinou' : s.status === 'refused' ? 'Recusou' : 'Pendente'}</span>
      </div>`;
    }).join('');

    let downloadBtn = '';
    if (zs.status === 'signed' || zs.signedFileUrl) {
      const url = zs.signedFileUrl;
      downloadBtn = url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="margin-top:8px;">📄 Baixar PDF assinado</a>`
        : `<button class="btn btn-primary btn-sm" onclick="baixarPdfAssinadoZapSignNegociacao()" style="margin-top:8px;">📄 Baixar PDF assinado</button>`;
    }

    $('zapsign-negociacao-status-content').innerHTML = `
      <div style="margin-bottom:8px;"><strong>Status:</strong> ${statusLabel}</div>
      <div style="margin-bottom:4px;"><strong>Documento:</strong> ${escapeHtml(zs.name || '—')}</div>
      ${signersHtml}
      ${downloadBtn}
    `;
  } catch (err) {
    console.warn('Erro ao carregar status ZapSign da negociação:', err);
  }
}

async function baixarPdfAssinadoZapSignNegociacao() {
  const negociacaoId = $('negociacao-id').value;
  if (!negociacaoId) return;
  try {
    const nSnap = await tenantPath().collection('negociacoes').doc(negociacaoId).get();
    const n = nSnap.data();
    if (!n.zapsign || !n.zapsign.openId) return;

    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.data();
    const workerUrl = (cfg.workerZapsignUrl || '').replace(/\/+$/, '');

    const res = await fetch(`${workerUrl}/docs/${n.zapsign.openId}/pdf`, {
      headers: { 'X-ZapSign-Token': cfg.zapsignToken },
    });
    const data = await res.json();
    if (!res.ok || !data.signedFileUrl) {
      throw new Error(data.error || 'PDF assinado ainda não disponível.');
    }
    window.open(data.signedFileUrl, '_blank');
  } catch (err) {
    showAlert('negociacao-alert', 'Erro: ' + err.message);
  }
}

// Exposição global pra onclick funcionar
window.abrirEnvioZapSign = abrirEnvioZapSign;
window.closeEnvioZapSign = closeEnvioZapSign;
window.addSignerZapSign = addSignerZapSign;
window.updateSignerZapSign = updateSignerZapSign;
window.removerSignerZapSign = removerSignerZapSign;
window.abrirEnvioZapSignNegociacao = abrirEnvioZapSignNegociacao;
window.atualizarStatusZapSignNegociacao = atualizarStatusZapSignNegociacao;
window.baixarPdfAssinadoZapSignNegociacao = baixarPdfAssinadoZapSignNegociacao;
window.enviarParaZapSign = enviarParaZapSign;
window.atualizarStatusZapSign = atualizarStatusZapSign;
window.baixarPdfAssinadoZapSign = baixarPdfAssinadoZapSign;

// =============================================================
// PASSKEY (WebAuthn) — login biométrico
// =============================================================

// URL padrão do Worker passkey (override possível via Configurações futuras)
const PASSKEY_WORKER_URL_DEFAULT = 'https://drg-rently-passkey.zett-romao.workers.dev';

function getPasskeyWorkerUrl() {
  return localStorage.getItem('drg-passkey-worker-url') || PASSKEY_WORKER_URL_DEFAULT;
}

// Detecta se o navegador/dispositivo suporta Passkeys
async function isPasskeySupported() {
  if (!window.PublicKeyCredential) return false;
  try {
    const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return !!available;
  } catch (_) {
    return false;
  }
}

// Mostra/esconde o botão de login com biometria conforme suporte
async function atualizarBotaoBiometria() {
  const btn = document.getElementById('btn-login-biometria');
  if (!btn) return;
  const supported = await isPasskeySupported();
  btn.style.display = supported ? 'block' : 'none';
}

// ----- Converters base64url ↔ ArrayBuffer -----
function b64uToBuf(b64u) {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}
function bufToB64u(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Converte options recebidas do Worker (base64url strings) para ArrayBuffers
// no formato que navigator.credentials.create() espera.
function optionsCreationToBuffer(opts) {
  return {
    ...opts,
    challenge: b64uToBuf(opts.challenge),
    user: { ...opts.user, id: b64uToBuf(opts.user.id) },
    excludeCredentials: (opts.excludeCredentials || []).map(c => ({ ...c, id: b64uToBuf(c.id) })),
  };
}
function optionsRequestToBuffer(opts) {
  return {
    ...opts,
    challenge: b64uToBuf(opts.challenge),
    allowCredentials: (opts.allowCredentials || []).map(c => ({ ...c, id: b64uToBuf(c.id) })),
  };
}

// Converte PublicKeyCredential (resposta do navegador) para JSON serializável
function attestationToJson(cred) {
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufToB64u(cred.response.clientDataJSON),
      attestationObject: bufToB64u(cred.response.attestationObject),
      transports: typeof cred.response.getTransports === 'function' ? cred.response.getTransports() : [],
    },
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
  };
}
function assertionToJson(cred) {
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufToB64u(cred.response.clientDataJSON),
      authenticatorData: bufToB64u(cred.response.authenticatorData),
      signature: bufToB64u(cred.response.signature),
      userHandle: cred.response.userHandle ? bufToB64u(cred.response.userHandle) : null,
    },
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
  };
}

// =============================================================
// Cadastrar nova passkey (usuário precisa estar logado)
// =============================================================
async function passkeyCadastrar() {
  const SID = 'passkey-status';
  if (!State.user) {
    showInlineStatus(SID, 'Faça login antes de cadastrar uma passkey.', 'error');
    return;
  }
  const supported = await isPasskeySupported();
  if (!supported) {
    showInlineStatus(SID, 'Seu dispositivo não suporta biometria. Configure Windows Hello / TouchID / FaceID primeiro.', 'error');
    return;
  }

  const url = getPasskeyWorkerUrl();
  if (!url) {
    showInlineStatus(SID, 'URL do Worker Passkey não configurada.', 'error');
    return;
  }

  const btn = document.getElementById('btn-cadastrar-passkey');
  if (btn) { btn.disabled = true; btn.textContent = 'Cadastrando…'; }
  showInlineStatus(SID, '🔄 Iniciando cadastro…', 'loading');

  try {
    // 1. Pede options ao Worker
    const beginResp = await fetch(`${url.replace(/\/+$/, '')}/register/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: State.user.uid,
        email: State.user.email,
        displayName: State.userDoc?.nome || State.user.email,
      }),
    });
    const beginData = await beginResp.json();
    if (!beginData.ok) throw new Error(beginData.error || 'Erro no /register/begin');

    // 2. Chama navigator.credentials.create (SO pede biometria aqui)
    const options = optionsCreationToBuffer(beginData.options);
    const cred = await navigator.credentials.create({ publicKey: options });
    if (!cred) throw new Error('Cadastro cancelado pelo usuário.');

    // 3. Envia attestation pro Worker validar e salvar
    const completeResp = await fetch(`${url.replace(/\/+$/, '')}/register/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: State.user.uid,
        attestationResponse: attestationToJson(cred),
      }),
    });
    const completeData = await completeResp.json();
    if (!completeData.ok) throw new Error(completeData.error || 'Erro no /register/complete');

    showInlineStatus('passkey-status', '✅ Passkey cadastrada com sucesso! Use "Entrar com biometria" no próximo login.', 'success', 8000);
    await carregarPasskeysList();
  } catch (e) {
    console.error('Erro ao cadastrar passkey:', e);
    showInlineStatus('passkey-status', `❌ ${e.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔐 Cadastrar biometria neste dispositivo'; }
  }
}

// =============================================================
// Login com passkey (na tela de login, antes da sessão)
// =============================================================
async function passkeyLogin() {
  const supported = await isPasskeySupported();
  if (!supported) {
    showAlert('login-alert', 'Seu dispositivo não suporta biometria.');
    return;
  }

  const url = getPasskeyWorkerUrl();
  if (!url) {
    showAlert('login-alert', 'URL do Worker Passkey não configurada.');
    return;
  }

  const btn = document.getElementById('btn-login-biometria');
  if (btn) { btn.disabled = true; btn.textContent = 'Aguardando biometria…'; }

  try {
    // 1. Pede options ao Worker (discoverable — sem uid)
    const beginResp = await fetch(`${url.replace(/\/+$/, '')}/login/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const beginData = await beginResp.json();
    if (!beginData.ok) throw new Error(beginData.error || 'Erro no /login/begin');

    // 2. navigator.credentials.get (SO pede biometria)
    const options = optionsRequestToBuffer(beginData.options);
    const cred = await navigator.credentials.get({ publicKey: options });
    if (!cred) throw new Error('Login cancelado.');

    // 3. Envia assertion pro Worker validar
    const completeResp = await fetch(`${url.replace(/\/+$/, '')}/login/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: beginData.sessionId,
        assertionResponse: assertionToJson(cred),
      }),
    });
    const completeData = await completeResp.json();
    if (!completeData.ok) throw new Error(completeData.error || 'Erro no /login/complete');

    // 4. Sign-in com custom token Firebase → onAuthStateChanged cuida do resto
    await auth.signInWithCustomToken(completeData.customToken);
  } catch (e) {
    console.error('Erro no login com passkey:', e);
    showAlert('login-alert', `Erro ao logar com biometria: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔐 Entrar com biometria'; }
  }
}

// =============================================================
// Listar passkeys do user (Configurações)
// =============================================================
async function carregarPasskeysList() {
  const div = document.getElementById('passkeys-list');
  if (!div || !State.user) return;
  const url = getPasskeyWorkerUrl();
  if (!url) { div.innerHTML = '<p class="muted">Worker passkey não configurado.</p>'; return; }

  div.innerHTML = '<p class="muted">Carregando…</p>';
  try {
    const resp = await fetch(`${url.replace(/\/+$/, '')}/credentials/list?uid=${encodeURIComponent(State.user.uid)}`);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error);
    if (!data.credentials || data.credentials.length === 0) {
      div.innerHTML = '<p class="muted">Nenhuma passkey cadastrada ainda. Clique em "🔐 Cadastrar biometria" acima.</p>';
      return;
    }
    div.innerHTML = data.credentials.map(c => {
      const dt = new Date(c.createdAt).toLocaleString('pt-BR');
      const tipo = c.deviceType === 'multiDevice' ? '☁️ Sincronizada (cloud)' : '🔒 Apenas este dispositivo';
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border:1px solid var(--border); border-radius:8px; margin-bottom:8px; background:var(--card-bg);">
          <div>
            <div style="font-weight:600;">🔑 Passkey</div>
            <div class="muted" style="font-size:12px;">Cadastrada em ${dt} · ${tipo}</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="passkeyRemover('${c.id}')">🗑 Remover</button>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Erro ao listar passkeys:', e);
    div.innerHTML = `<p class="alert alert-error" style="display:block;">Erro: ${e.message}</p>`;
  }
}

async function passkeyRemover(credId) {
  if (!confirm('Remover esta passkey? Você não poderá mais logar com biometria deste dispositivo.')) return;
  const url = getPasskeyWorkerUrl();
  const SID = 'passkey-status';
  showInlineStatus(SID, '🔄 Removendo…', 'loading');
  try {
    const resp = await fetch(`${url.replace(/\/+$/, '')}/credentials/${encodeURIComponent(credId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: State.user.uid }),
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error);
    showInlineStatus(SID, '✅ Passkey removida.', 'success', 5000);
    await carregarPasskeysList();
  } catch (e) {
    console.error('Erro ao remover:', e);
    showInlineStatus(SID, `❌ ${e.message}`, 'error');
  }
}

// Expor pra HTML onclick
window.passkeyCadastrar = passkeyCadastrar;
window.passkeyLogin = passkeyLogin;
window.passkeyRemover = passkeyRemover;
window.carregarPasskeysList = carregarPasskeysList;

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

  // Mostra/esconde botão de login com biometria conforme suporte
  atualizarBotaoBiometria();
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
    el.addEventListener('click', () => {
      // Se nav-link tem data-section, navega. Se tem onclick inline (ex: vitrine pública), só fecha o menu.
      if (el.dataset.section) {
        showSection(el.dataset.section);
      } else {
        fecharSidebarMobile();
      }
    });
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

// =============================================================================
// IMPORTAÇÃO DE CONTRATO VIA IA (Gemini)
// =============================================================================
// Fluxo: usuário escolhe arquivo (PDF/DOCX/imagem) → mammoth.js (se DOCX) →
// Worker Gemini (modo "contrato") → detecção de duplicatas → modal de revisão
// → batch atômico gravando locadores/locatários/imóvel/contrato no Firestore.
// =============================================================================

let _importContrato = null;

async function importarContratoPorIA(tipoHint) {
  if (!State.tenant) {
    alert('Selecione um tenant antes de importar contratos (você está no painel Super Admin ou ainda não escolheu uma conta).');
    return;
  }
  try {
    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (!cfg.workerGeminiUrl) {
      alert('Configure a URL do Worker Gemini em Configurações antes de usar a importação por IA.');
      return;
    }
  } catch (err) {
    alert('Erro ao verificar configuração: ' + err.message);
    return;
  }

  _importContrato = {
    tipoHint: tipoHint || 'locacao',
    arquivo: null,
    dadosIA: null,
    resolucoes: null,
    abaAtual: 'partes',
    contratoCriadoId: null,
    contratoCriadoTipo: null,
  };

  $('importar-contrato-file').value = '';
  $('importar-etapa-upload').style.display = 'block';
  $('importar-etapa-revisao').style.display = 'none';
  $('importar-etapa-sucesso').style.display = 'none';
  $('importar-contrato-progress').style.display = 'none';
  $('importar-contrato-alert').style.display = 'none';

  // Reset visual da dropzone
  const dz = $('importar-dropzone');
  if (dz) {
    dz.classList.remove('dragover', 'has-file');
    const ico = dz.querySelector('.dropzone-icon');
    if (ico) ico.textContent = '📂';
    const txt = dz.querySelector('.dropzone-text strong');
    if (txt) txt.textContent = 'Arraste o arquivo aqui';
  }

  $('importar-contrato-file').onchange = (e) => {
    const file = e.target.files?.[0];
    if (file) processarArquivoContrato(file);
  };

  // === Drag & drop ===
  if (dz && !dz.dataset.dnd) {
    dz.dataset.dnd = '1';
    // Previne o navegador de abrir o arquivo se soltar fora
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
      dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); });
    });
    ['dragenter', 'dragover'].forEach(ev => {
      dz.addEventListener(ev, () => dz.classList.add('dragover'));
    });
    ['dragleave', 'drop'].forEach(ev => {
      dz.addEventListener(ev, () => dz.classList.remove('dragover'));
    });
    dz.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        // Visual: marca como "tem arquivo"
        dz.classList.add('has-file');
        const ico = dz.querySelector('.dropzone-icon');
        if (ico) ico.textContent = '✅';
        const txt = dz.querySelector('.dropzone-text strong');
        if (txt) txt.textContent = file.name;
        processarArquivoContrato(file);
      }
    });
  }

  $('modal-importar-contrato').style.display = 'flex';
}

function fecharImportarContrato() {
  if (_importContrato && _importContrato.dadosIA && !_importContrato.contratoCriadoId) {
    if (!confirm('Descartar os dados extraídos? O contrato NÃO será salvo.')) return;
  }
  $('modal-importar-contrato').style.display = 'none';
  _importContrato = null;
}

async function processarArquivoContrato(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isDocx = ext === 'docx';
  const isDoc = ext === 'doc';

  const maxBytes = 15 * 1024 * 1024;
  if (file.size > maxBytes) {
    importarContratoErro(`Arquivo excede ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`);
    return;
  }

  _importContrato.arquivo = file;
  $('importar-contrato-progress').style.display = 'block';
  $('importar-contrato-alert').style.display = 'none';
  $('importar-progress-titulo').textContent = isDocx ? '📄 Extraindo texto do Word…'
    : isDoc ? '📄 Convertendo Word antigo (.doc)…'
    : '🤖 Lendo o contrato com IA…';
  $('importar-progress-subtitulo').textContent = 'Pode levar 15-40 segundos para PDFs longos.';

  try {
    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (!cfg.workerGeminiUrl) throw new Error('URL do Worker Gemini não configurada.');

    let fileBase64;
    let mimeType;

    if (isDocx) {
      if (typeof mammoth === 'undefined') {
        throw new Error('Biblioteca mammoth.js não carregou. Recarregue a página (F5).');
      }
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      const html = result.value || '';
      if (!html.trim()) throw new Error('Não foi possível extrair texto deste DOCX.');
      fileBase64 = btoa(unescape(encodeURIComponent(html)));
      mimeType = 'text/html';
      $('importar-progress-titulo').textContent = '🤖 Lendo o contrato com IA…';
    } else if (isDoc) {
      // .doc antigo (Word 97-2003, formato binário CFBF).
      // Não há lib JS robusta pra extrair texto direto no browser.
      // Tentamos 2 caminhos:
      // 1) Enviar o binário direto pro Gemini como application/msword
      //    (o modelo às vezes consegue ler — vale a tentativa).
      // 2) Se Gemini falhar com erro específico de formato, mostramos
      //    instruções amigáveis de conversão.
      $('importar-progress-titulo').textContent = '🤖 Tentando ler .doc com IA…';
      $('importar-progress-subtitulo').textContent = 'Formato antigo do Word — pode demorar mais ou falhar. Se falhar, tem botão pra converter online.';
      fileBase64 = await fileToBase64(file);
      mimeType = file.type || 'application/msword';
    } else {
      fileBase64 = await fileToBase64(file);
      mimeType = file.type || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg');
    }

    const res = await fetch(cfg.workerGeminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileBase64,
        mimeType,
        modo: 'contrato',
        tipoOperacaoHint: _importContrato.tipoHint,
      }),
    });

    if (!res.ok) {
      let errMsg = `Erro ${res.status}`;
      try { const j = await res.json(); if (j.error) errMsg = j.error; } catch (_) {}
      // Mensagem amigável + sugestão de conversão pra .doc antigos
      if (isDoc) {
        importarContratoErroDocAntigo(errMsg);
        return;
      }
      throw new Error(errMsg);
    }

    const result = await res.json();
    if (!result.success || !result.data) {
      if (isDoc) {
        importarContratoErroDocAntigo('A IA não conseguiu ler este arquivo .doc antigo.');
        return;
      }
      throw new Error('Resposta inválida do Worker.');
    }

    const dados = result.data;

    if (dados.tipo_operacao === 'outro') {
      importarContratoErro('Não identificamos um contrato de locação ou venda neste arquivo. Verifique se enviou o documento correto.');
      return;
    }

    // Hint vs detectado — confirmar com usuário se conflitar
    const detectado = dados.tipo_operacao;
    const hint = _importContrato.tipoHint;
    if (detectado && hint && detectado !== hint) {
      const detectadoLabel = detectado === 'locacao' ? 'LOCAÇÃO' : 'VENDA';
      const hintLabel = hint === 'locacao' ? 'locação' : 'venda';
      const ok = confirm(`⚠️ Conflito detectado.\n\nVocê clicou em "Importar contrato" na seção de ${hintLabel}, mas a IA identificou este documento como um contrato de ${detectadoLabel}.\n\nClique OK para seguir com ${detectadoLabel} (recomendado) ou Cancelar para abortar.`);
      if (!ok) {
        $('importar-contrato-progress').style.display = 'none';
        return;
      }
      _importContrato.tipoHint = detectado;
    }

    _importContrato.dadosIA = dados;
    await montarResolucoesIniciais();
    await renderRevisaoImportar();
  } catch (err) {
    console.error('Erro ao processar contrato:', err);
    importarContratoErro(err.message || 'Erro desconhecido.');
  }
}

function importarContratoErro(msg) {
  $('importar-contrato-progress').style.display = 'none';
  const el = $('importar-contrato-alert');
  el.textContent = '❌ ' + msg;
  el.style.display = 'block';
}

// Erro específico pra .doc antigos — não suportados pela IA. Mostra
// 3 opções de conversão pro usuário.
function importarContratoErroDocAntigo(detalheErro) {
  $('importar-contrato-progress').style.display = 'none';
  const el = $('importar-contrato-alert');
  el.style.display = 'block';
  el.innerHTML = `
    <strong>⚠️ Formato .doc antigo não suportado bem pela IA</strong><br>
    <span style="font-size:12px;">Detalhe: ${escapeHtml(detalheErro || 'A IA não conseguiu extrair o conteúdo')}.</span>
    <p style="margin:8px 0 4px;"><strong>O que fazer:</strong></p>
    <ul style="margin:0; padding-left:20px; font-size:12px; line-height:1.6;">
      <li><strong>Opção 1 (recomendado):</strong> abre o arquivo no Word, vai em <code>Arquivo → Salvar como</code> e escolhe <code>Documento do Word (*.docx)</code>. Tenta de novo aqui.</li>
      <li><strong>Opção 2:</strong> abre no Word, vai em <code>Arquivo → Salvar como</code> e escolhe <code>PDF</code>. Sobe o PDF aqui.</li>
      <li><strong>Opção 3:</strong> usa um conversor online como
        <a href="https://cloudconvert.com/doc-to-docx" target="_blank" rel="noopener" style="color:#1d4ed8; font-weight:600;">cloudconvert.com</a>
        (gratuito, sem cadastro). Converte pra .docx e sobe aqui.
      </li>
    </ul>
    <p style="margin-top:8px; font-size:11px; color:var(--text-muted);">
      💡 Documentos novos (Word 2007+) já vêm em .docx por padrão. Só arquivos
      antigos (Word 97-2003) usam .doc.
    </p>
  `;
}

// ----- Detecção de duplicatas -----

async function detectarDuplicatasPessoa(colecao, documentoLimpo) {
  if (!documentoLimpo) return [];
  try {
    const snap = await tenantPath().collection(colecao)
      .where('documento', '==', documentoLimpo).limit(3).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn(`Erro ao buscar duplicatas em ${colecao}:`, err);
    return [];
  }
}

async function detectarDuplicatasImovel(matricula, cep, numero) {
  if (matricula) {
    try {
      const snap = await tenantPath().collection('imoveis')
        .where('matricula', '==', matricula).limit(3).get();
      const matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (matches.length) return matches;
    } catch (_) {}
  }
  if (cep && numero) {
    try {
      const snap = await tenantPath().collection('imoveis')
        .where('endereco.cep', '==', cep)
        .where('endereco.numero', '==', String(numero)).limit(3).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn('Busca de duplicata de imóvel exige índice composto (endereco.cep + endereco.numero). Crie no Firebase Console.', err);
    }
  }
  return [];
}

async function detectarDuplicataFiador(cpfLimpo) {
  if (!cpfLimpo) return [];
  try {
    const snap = await tenantPath().collection('garantias')
      .where('tipo', '==', 'fiador')
      .where('fiador.cpf', '==', cpfLimpo).limit(3).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('Busca de fiador duplicado:', err);
    return [];
  }
}

async function montarResolucoesIniciais() {
  const d = _importContrato.dadosIA;
  const ehLocacao = _importContrato.tipoHint === 'locacao';

  const resolverPessoa = async (colecao, dados) => ({
    acao: 'reusar',  // default
    duplicatas: await detectarDuplicatasPessoa(colecao, (dados.documento || '').replace(/\D/g, '')),
    dados,
  });

  const locadores = ehLocacao ? (d.locadores || []) : (d.vendedores || []);
  const locatarios = ehLocacao ? (d.locatarios || []) : (d.compradores || []);
  const colecaoLoc = ehLocacao ? 'locadores' : 'locadores';
  const colecaoLat = ehLocacao ? 'locatarios' : 'compradores';

  const resolucoes = {
    locadores: await Promise.all(locadores.map(p => resolverPessoa(colecaoLoc, p))),
    locatarios: await Promise.all(locatarios.map(p => resolverPessoa(colecaoLat, p))),
    imovel: null,
    garantia: null,
  };

  // Sem duplicata → default "criar"
  ['locadores', 'locatarios'].forEach(g => {
    resolucoes[g].forEach(r => { if (!r.duplicatas.length) r.acao = 'criar'; });
  });

  // Imóvel
  if (d.imovel) {
    const imovelDups = await detectarDuplicatasImovel(
      d.imovel.matricula,
      d.imovel.endereco?.cep,
      d.imovel.endereco?.numero,
    );
    resolucoes.imovel = {
      acao: imovelDups.length ? 'reusar' : 'criar',
      duplicatas: imovelDups,
      dados: d.imovel,
    };
  }

  // Garantia (só locação)
  if (ehLocacao && d.garantia && d.garantia.tipo && d.garantia.tipo !== 'nenhuma') {
    const fiadorDups = d.garantia.tipo === 'fiador' && d.garantia.fiador
      ? await detectarDuplicataFiador((d.garantia.fiador.cpf || '').replace(/\D/g, ''))
      : [];
    resolucoes.garantia = {
      acao: fiadorDups.length ? 'reusar' : 'criar',
      duplicatas: fiadorDups,
      dados: d.garantia,
    };
  }

  _importContrato.resolucoes = resolucoes;
}

// ----- Renderização do modal de revisão -----

async function renderRevisaoImportar() {
  $('importar-etapa-upload').style.display = 'none';
  $('importar-etapa-revisao').style.display = 'block';
  $('importar-contrato-progress').style.display = 'none';

  // Banner de confiança
  const conf = _importContrato.dadosIA.confidence_global ?? 1;
  const banner = $('importar-banner-confianca');
  if (conf < 0.5) {
    banner.style.display = 'block';
    banner.style.background = '#ffebee';
    banner.style.color = '#c62828';
    banner.innerHTML = `⚠️ <strong>Confiança baixa</strong> (${(conf * 100).toFixed(0)}%). Revise TODOS os campos com atenção antes de salvar.`;
  } else if (conf < 0.8) {
    banner.style.display = 'block';
    banner.style.background = '#fff8e1';
    banner.style.color = '#e65100';
    banner.innerHTML = `🔎 <strong>Confiança média</strong> (${(conf * 100).toFixed(0)}%). Confira os campos destacados em amarelo.`;
  } else {
    banner.style.display = 'block';
    banner.style.background = '#e8f5e9';
    banner.style.color = '#2e7d32';
    banner.innerHTML = `✅ <strong>Confiança alta</strong> (${(conf * 100).toFixed(0)}%). Confira rapidamente e salve.`;
  }

  if (_importContrato.dadosIA.observacoes) {
    banner.innerHTML += `<div style="margin-top:6px;font-size:12px;font-weight:normal;">💬 ${_importContrato.dadosIA.observacoes}</div>`;
  }

  _importContrato.abaAtual = 'partes';
  trocarTabImportar('partes');
  renderCardsPartes();
  renderCardImovel();
  renderCardContrato();
}

function trocarTabImportar(tab) {
  _importContrato.abaAtual = tab;
  ['partes', 'imovel', 'contrato'].forEach(t => {
    $('importar-tab-' + t).style.display = (t === tab ? 'block' : 'none');
    document.querySelectorAll(`.tab-btn[data-tab="${t}"]`).forEach(b => {
      b.classList.toggle('active', t === tab);
    });
  });
  $('btn-importar-voltar').style.display = tab === 'partes' ? 'none' : 'inline-block';
  $('btn-importar-proximo').style.display = tab === 'contrato' ? 'none' : 'inline-block';
  $('btn-importar-salvar').style.display = tab === 'contrato' ? 'inline-block' : 'none';
}

function navegarTabImportar(direcao) {
  const ordem = ['partes', 'imovel', 'contrato'];
  const idx = ordem.indexOf(_importContrato.abaAtual);
  const novo = ordem[idx + direcao];
  if (novo) trocarTabImportar(novo);
}

// ----- Cards das abas -----

function renderCardsPartes() {
  const ehLocacao = _importContrato.tipoHint === 'locacao';
  const labelLoc = ehLocacao ? 'Locador' : 'Vendedor';
  const labelLat = ehLocacao ? 'Locatário' : 'Comprador';
  const container = $('importar-cards-partes');

  let html = '';
  html += `<h4 style="margin:8px 0 10px;">👤 ${labelLoc}${_importContrato.resolucoes.locadores.length > 1 ? 'es' : ''} (${_importContrato.resolucoes.locadores.length})</h4>`;
  _importContrato.resolucoes.locadores.forEach((r, i) => {
    html += renderCardPessoa('locadores', i, r, labelLoc);
  });

  html += `<h4 style="margin:20px 0 10px;">👤 ${labelLat}${_importContrato.resolucoes.locatarios.length > 1 ? 's' : ''} (${_importContrato.resolucoes.locatarios.length})</h4>`;
  _importContrato.resolucoes.locatarios.forEach((r, i) => {
    html += renderCardPessoa('locatarios', i, r, labelLat);
  });

  if (_importContrato.resolucoes.garantia) {
    html += `<h4 style="margin:20px 0 10px;">🛡️ Garantia</h4>`;
    html += renderCardGarantia();
  }

  container.innerHTML = html;
}

function renderCardPessoa(grupo, idx, resolucao, label) {
  const d = resolucao.dados;
  const docFmt = d.documento_formatado || d.documento || '—';
  const duplicado = resolucao.duplicatas && resolucao.duplicatas.length;
  const conf = d.confidence_score ?? 1;
  const duvidosos = new Set(d.campos_duvidosos || []);

  let badge = '';
  if (duplicado) badge = `<span class="importar-badge duplicado">♻️ Já existe no cadastro</span>`;
  else badge = `<span class="importar-badge novo">🆕 Novo</span>`;
  if (conf < 0.7) badge += ` <span class="importar-badge confianca-baixa">⚠️ Confiança ${(conf * 100).toFixed(0)}%</span>`;

  let resolucaoHtml = '';
  if (duplicado) {
    const dup = resolucao.duplicatas[0];
    resolucaoHtml = `
      <div class="importar-resolucao">
        ⚠️ <strong>Já existe:</strong> ${dup.nome} (${dup.documento ? formataCPFCNPJ(dup.documento) : '—'})
        <div style="margin-top:8px;">
          <label><input type="radio" name="resol-${grupo}-${idx}" value="reusar" ${resolucao.acao === 'reusar' ? 'checked' : ''} onchange="onImportarResolucaoChange('${grupo}', ${idx}, 'reusar', '${dup.id}')"> Reusar o cadastro existente</label>
          <label><input type="radio" name="resol-${grupo}-${idx}" value="criar" ${resolucao.acao === 'criar' ? 'checked' : ''} onchange="onImportarResolucaoChange('${grupo}', ${idx}, 'criar', null)"> Criar um cadastro novo</label>
        </div>
      </div>`;
  }

  const ehReusar = resolucao.acao === 'reusar';
  const camposHtml = ehReusar ? '<p class="muted" style="font-size:12px;">Dados extraídos do contrato serão ignorados — usaremos o cadastro existente.</p>' : `
    <div class="importar-campos-grid">
      ${campoTexto(grupo, idx, 'nome', 'Nome / Razão social', d.nome, duvidosos)}
      ${campoTexto(grupo, idx, 'documento_formatado', 'CPF / CNPJ', d.documento_formatado, duvidosos)}
      ${campoTexto(grupo, idx, 'rg', 'RG', d.rg, duvidosos)}
      ${campoTexto(grupo, idx, 'nascimento', 'Nascimento (AAAA-MM-DD)', d.nascimento, duvidosos)}
      ${campoTexto(grupo, idx, 'profissao', 'Profissão', d.profissao, duvidosos)}
      ${campoSelect(grupo, idx, 'estado_civil', 'Estado civil', d.estado_civil, ['solteiro','casado','divorciado','viuvo','uniao_estavel'], duvidosos)}
      ${campoTexto(grupo, idx, 'email', 'E-mail', d.email, duvidosos)}
      ${campoTexto(grupo, idx, 'telefone', 'Telefone', d.telefone, duvidosos)}
    </div>
    <details style="margin-top:8px;"><summary style="cursor:pointer;font-size:13px;color:var(--muted);">Endereço</summary>
      <div class="importar-campos-grid" style="margin-top:8px;">
        ${campoTextoEndereco(grupo, idx, 'cep', 'CEP', d.endereco?.cep, duvidosos)}
        ${campoTextoEndereco(grupo, idx, 'logradouro', 'Logradouro', d.endereco?.logradouro, duvidosos)}
        ${campoTextoEndereco(grupo, idx, 'numero', 'Número', d.endereco?.numero, duvidosos)}
        ${campoTextoEndereco(grupo, idx, 'complemento', 'Complemento', d.endereco?.complemento, duvidosos)}
        ${campoTextoEndereco(grupo, idx, 'bairro', 'Bairro', d.endereco?.bairro, duvidosos)}
        ${campoTextoEndereco(grupo, idx, 'cidade', 'Cidade', d.endereco?.cidade, duvidosos)}
        ${campoTextoEndereco(grupo, idx, 'uf', 'UF', d.endereco?.uf, duvidosos)}
      </div>
    </details>
  `;

  return `
    <div class="importar-card" id="card-${grupo}-${idx}">
      <div class="importar-card-header">
        <div>
          <strong>${label} #${idx + 1}: ${d.nome || '(sem nome)'}</strong>
          <div class="importar-confidence">CPF/CNPJ: ${docFmt}</div>
        </div>
        <div>${badge}</div>
      </div>
      ${resolucaoHtml}
      ${camposHtml}
    </div>`;
}

function campoTexto(grupo, idx, campo, label, valor, duvidosos) {
  const cls = duvidosos.has(campo) ? 'importar-campo-duvidoso' : '';
  return `<div class="form-group ${cls}">
    <label>${label}</label>
    <input type="text" value="${escHtml(valor)}" oninput="onImportarCampoChange('${grupo}', ${idx}, '${campo}', this.value)" />
  </div>`;
}

function campoTextoEndereco(grupo, idx, campo, label, valor, duvidosos) {
  const cls = duvidosos.has('endereco.' + campo) || duvidosos.has(campo) ? 'importar-campo-duvidoso' : '';
  return `<div class="form-group ${cls}">
    <label>${label}</label>
    <input type="text" value="${escHtml(valor)}" oninput="onImportarCampoEnderecoChange('${grupo}', ${idx}, '${campo}', this.value)" />
  </div>`;
}

function campoSelect(grupo, idx, campo, label, valor, opcoes, duvidosos) {
  const cls = duvidosos.has(campo) ? 'importar-campo-duvidoso' : '';
  return `<div class="form-group ${cls}">
    <label>${label}</label>
    <select onchange="onImportarCampoChange('${grupo}', ${idx}, '${campo}', this.value)">
      <option value="">—</option>
      ${opcoes.map(o => `<option value="${o}" ${o === valor ? 'selected' : ''}>${o}</option>`).join('')}
    </select>
  </div>`;
}

function escHtml(v) {
  if (v == null) return '';
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formataCPFCNPJ(d) {
  d = (d || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}

function renderCardGarantia() {
  const r = _importContrato.resolucoes.garantia;
  const d = r.dados;
  const tipo = d.tipo;
  const duplicado = r.duplicatas && r.duplicatas.length;
  const tipoLabel = { fiador: 'Fiador', caucao: 'Caução', seguro_fianca: 'Seguro fiança' }[tipo] || tipo;

  let badge = duplicado
    ? `<span class="importar-badge duplicado">♻️ Fiador já cadastrado</span>`
    : `<span class="importar-badge novo">🆕 Nova garantia</span>`;

  let resolucaoHtml = '';
  if (duplicado) {
    const dup = r.duplicatas[0];
    resolucaoHtml = `
      <div class="importar-resolucao">
        ⚠️ <strong>Garantia com fiador igual já existe:</strong> ${dup.fiador?.nome} (${formataCPFCNPJ(dup.fiador?.cpf)})
        <div style="margin-top:8px;">
          <label><input type="radio" name="resol-garantia" value="reusar" ${r.acao === 'reusar' ? 'checked' : ''} onchange="onImportarResolucaoChange('garantia', 0, 'reusar', '${dup.id}')"> Reusar a garantia existente</label>
          <label><input type="radio" name="resol-garantia" value="criar" ${r.acao === 'criar' ? 'checked' : ''} onchange="onImportarResolucaoChange('garantia', 0, 'criar', null)"> Criar uma nova garantia</label>
        </div>
      </div>`;
  }

  let detalhes = '';
  if (tipo === 'fiador' && d.fiador) {
    const f = d.fiador;
    detalhes = `
      <div class="importar-campos-grid">
        <div class="form-group"><label>Nome do fiador</label><input type="text" value="${escHtml(f.nome)}" oninput="onImportarGarantiaChange('fiador.nome', this.value)" /></div>
        <div class="form-group"><label>CPF</label><input type="text" value="${escHtml(formataCPFCNPJ(f.cpf))}" oninput="onImportarGarantiaChange('fiador.cpf', this.value)" /></div>
        <div class="form-group"><label>Telefone</label><input type="text" value="${escHtml(f.telefone)}" oninput="onImportarGarantiaChange('fiador.telefone', this.value)" /></div>
        <div class="form-group"><label>Renda mensal</label><input type="number" step="0.01" value="${escHtml(f.renda)}" oninput="onImportarGarantiaChange('fiador.renda', this.value)" /></div>
      </div>`;
  } else if (tipo === 'caucao' && d.caucao) {
    const c = d.caucao;
    detalhes = `
      <div class="importar-campos-grid">
        <div class="form-group"><label>Modalidade</label><input type="text" value="${escHtml(c.modalidade)}" oninput="onImportarGarantiaChange('caucao.modalidade', this.value)" /></div>
        <div class="form-group"><label>Valor</label><input type="number" step="0.01" value="${escHtml(c.valor)}" oninput="onImportarGarantiaChange('caucao.valor', this.value)" /></div>
      </div>`;
  } else if (tipo === 'seguro_fianca' && d.seguro) {
    const s = d.seguro;
    detalhes = `
      <div class="importar-campos-grid">
        <div class="form-group"><label>Seguradora</label><input type="text" value="${escHtml(s.seguradora)}" oninput="onImportarGarantiaChange('seguro.seguradora', this.value)" /></div>
        <div class="form-group"><label>Apólice</label><input type="text" value="${escHtml(s.apolice)}" oninput="onImportarGarantiaChange('seguro.apolice', this.value)" /></div>
        <div class="form-group"><label>Cobertura</label><input type="number" step="0.01" value="${escHtml(s.cobertura)}" oninput="onImportarGarantiaChange('seguro.cobertura', this.value)" /></div>
        <div class="form-group"><label>Prêmio</label><input type="number" step="0.01" value="${escHtml(s.premio)}" oninput="onImportarGarantiaChange('seguro.premio', this.value)" /></div>
      </div>`;
  }

  return `
    <div class="importar-card">
      <div class="importar-card-header">
        <div><strong>${tipoLabel}</strong></div>
        <div>${badge}</div>
      </div>
      ${resolucaoHtml}
      ${r.acao === 'reusar' ? '<p class="muted" style="font-size:12px;">Garantia existente será reaproveitada.</p>' : detalhes}
    </div>`;
}

function renderCardImovel() {
  const r = _importContrato.resolucoes.imovel;
  if (!r) {
    $('importar-card-imovel').innerHTML = '<p class="muted">A IA não detectou dados do imóvel. Você precisará selecionar manualmente ao salvar.</p>';
    return;
  }
  const d = r.dados;
  const duplicado = r.duplicatas && r.duplicatas.length;
  const duvidosos = new Set(d.campos_duvidosos || []);

  let badge = duplicado ? `<span class="importar-badge duplicado">♻️ Já existe</span>` : `<span class="importar-badge novo">🆕 Novo</span>`;

  let resolucaoHtml = '';
  if (duplicado) {
    const dup = r.duplicatas[0];
    resolucaoHtml = `
      <div class="importar-resolucao">
        ⚠️ <strong>Imóvel já existe:</strong> ${dup.apelido} ${dup.matricula ? `(Matrícula ${dup.matricula})` : ''}
        <div style="margin-top:8px;">
          <label><input type="radio" name="resol-imovel" value="reusar" ${r.acao === 'reusar' ? 'checked' : ''} onchange="onImportarResolucaoChange('imovel', 0, 'reusar', '${dup.id}')"> Reusar o imóvel existente</label>
          <label><input type="radio" name="resol-imovel" value="criar" ${r.acao === 'criar' ? 'checked' : ''} onchange="onImportarResolucaoChange('imovel', 0, 'criar', null)"> Cadastrar um novo imóvel</label>
        </div>
      </div>`;
  }

  const detalhes = r.acao === 'reusar' ? '<p class="muted" style="font-size:12px;">Dados serão ignorados — usaremos o imóvel já cadastrado.</p>' : `
    <div class="importar-campos-grid">
      <div class="form-group ${duvidosos.has('apelido_sugerido') ? 'importar-campo-duvidoso' : ''}">
        <label>Apelido (curto)</label>
        <input type="text" value="${escHtml(d.apelido_sugerido)}" oninput="onImportarImovelChange('apelido_sugerido', this.value)" />
      </div>
      <div class="form-group">
        <label>Matrícula</label>
        <input type="text" value="${escHtml(d.matricula)}" oninput="onImportarImovelChange('matricula', this.value)" />
      </div>
      <div class="form-group"><label>Tipo</label>
        <select onchange="onImportarImovelChange('tipo', this.value)">
          ${['apartamento','casa','comercial','terreno','rural','outro'].map(t => `<option value="${t}" ${t === d.tipo ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Quartos</label><input type="number" value="${escHtml(d.quartos)}" oninput="onImportarImovelChange('quartos', this.value)" /></div>
      <div class="form-group"><label>Banheiros</label><input type="number" value="${escHtml(d.banheiros)}" oninput="onImportarImovelChange('banheiros', this.value)" /></div>
      <div class="form-group"><label>Vagas</label><input type="number" value="${escHtml(d.vagas)}" oninput="onImportarImovelChange('vagas', this.value)" /></div>
      <div class="form-group"><label>Área útil (m²)</label><input type="number" step="0.01" value="${escHtml(d.area_util)}" oninput="onImportarImovelChange('area_util', this.value)" /></div>
      <div class="form-group"><label>Andar</label><input type="text" value="${escHtml(d.andar)}" oninput="onImportarImovelChange('andar', this.value)" /></div>
    </div>
    <details style="margin-top:8px;"><summary style="cursor:pointer;font-size:13px;color:var(--muted);">Endereço completo</summary>
      <div class="importar-campos-grid" style="margin-top:8px;">
        <div class="form-group"><label>CEP</label><input type="text" value="${escHtml(d.endereco?.cep)}" oninput="onImportarImovelEnderecoChange('cep', this.value)" /></div>
        <div class="form-group"><label>Logradouro</label><input type="text" value="${escHtml(d.endereco?.logradouro)}" oninput="onImportarImovelEnderecoChange('logradouro', this.value)" /></div>
        <div class="form-group"><label>Número</label><input type="text" value="${escHtml(d.endereco?.numero)}" oninput="onImportarImovelEnderecoChange('numero', this.value)" /></div>
        <div class="form-group"><label>Complemento</label><input type="text" value="${escHtml(d.endereco?.complemento)}" oninput="onImportarImovelEnderecoChange('complemento', this.value)" /></div>
        <div class="form-group"><label>Bairro</label><input type="text" value="${escHtml(d.endereco?.bairro)}" oninput="onImportarImovelEnderecoChange('bairro', this.value)" /></div>
        <div class="form-group"><label>Cidade</label><input type="text" value="${escHtml(d.endereco?.cidade)}" oninput="onImportarImovelEnderecoChange('cidade', this.value)" /></div>
        <div class="form-group"><label>UF</label><input type="text" value="${escHtml(d.endereco?.uf)}" oninput="onImportarImovelEnderecoChange('uf', this.value)" /></div>
      </div>
    </details>
  `;

  $('importar-card-imovel').innerHTML = `
    <div class="importar-card">
      <div class="importar-card-header">
        <div><strong>🏠 ${d.apelido_sugerido || 'Imóvel objeto do contrato'}</strong></div>
        <div>${badge}</div>
      </div>
      ${resolucaoHtml}
      ${detalhes}
    </div>`;
}

function renderCardContrato() {
  const d = _importContrato.dadosIA;
  const ehLocacao = _importContrato.tipoHint === 'locacao';
  const c = ehLocacao ? (d.contrato_locacao || {}) : (d.contrato_venda || {});
  const com = d.comissao || {};

  let html = '';
  if (ehLocacao) {
    html = `
      <div class="importar-card">
        <div class="importar-card-header"><strong>📋 Dados do contrato de locação</strong></div>
        <div class="importar-campos-grid">
          <div class="form-group"><label>Prazo (meses)</label><input type="number" value="${escHtml(c.prazo_meses)}" oninput="onImportarContratoChange('prazo_meses', this.value)" /></div>
          <div class="form-group"><label>Início (AAAA-MM-DD)</label><input type="text" value="${escHtml(c.inicio)}" oninput="onImportarContratoChange('inicio', this.value)" /></div>
          <div class="form-group"><label>Fim (AAAA-MM-DD)</label><input type="text" value="${escHtml(c.fim)}" oninput="onImportarContratoChange('fim', this.value)" /></div>
          <div class="form-group"><label>Aluguel (R$)</label><input type="number" step="0.01" value="${escHtml(c.aluguel)}" oninput="onImportarContratoChange('aluguel', this.value)" /></div>
          <div class="form-group"><label>Dia de vencimento</label><input type="number" value="${escHtml(c.dia_vencimento || 5)}" oninput="onImportarContratoChange('dia_vencimento', this.value)" /></div>
          <div class="form-group"><label>Taxa adm. (%)</label><input type="number" step="0.01" value="${escHtml(c.taxa_adm || 10)}" oninput="onImportarContratoChange('taxa_adm', this.value)" /></div>
          <div class="form-group"><label>Multa rescisória (R$)</label><input type="number" step="0.01" value="${escHtml(c.multa_rescisoria)}" oninput="onImportarContratoChange('multa_rescisoria', this.value)" /></div>
          <div class="form-group"><label>Índice reajuste</label>
            <select onchange="onImportarContratoChange('reajuste_indice', this.value)">
              ${['','IPCA','IGPM','INCC','INPC'].map(o => `<option value="${o.toLowerCase()}" ${(c.reajuste_indice || '').toLowerCase() === o.toLowerCase() ? 'selected' : ''}>${o || '—'}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group" style="margin-top:8px;">
          <label>Cláusulas relevantes / observações</label>
          <textarea rows="4" oninput="onImportarContratoChange('clausulas_relevantes', this.value)">${escHtml(c.clausulas_relevantes)}</textarea>
        </div>
      </div>`;
  } else {
    html = `
      <div class="importar-card">
        <div class="importar-card-header"><strong>📋 Dados da negociação (venda)</strong></div>
        <div class="importar-campos-grid">
          <div class="form-group"><label>Valor total (R$)</label><input type="number" step="0.01" value="${escHtml(c.valor)}" oninput="onImportarContratoChange('valor', this.value)" /></div>
          <div class="form-group"><label>Forma de pagamento</label>
            <select onchange="onImportarContratoChange('forma_pagamento', this.value)">
              ${['','a_vista','financiamento','permuta','misto'].map(o => `<option value="${o}" ${c.forma_pagamento === o ? 'selected' : ''}>${o || '—'}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Entrada (R$)</label><input type="number" step="0.01" value="${escHtml(c.entrada)}" oninput="onImportarContratoChange('entrada', this.value)" /></div>
          <div class="form-group"><label>Data de aceite (AAAA-MM-DD)</label><input type="text" value="${escHtml(c.data_aceite)}" oninput="onImportarContratoChange('data_aceite', this.value)" /></div>
          <div class="form-group"><label>Data de posse (AAAA-MM-DD)</label><input type="text" value="${escHtml(c.data_posse)}" oninput="onImportarContratoChange('data_posse', this.value)" /></div>
          <div class="form-group"><label>Comissão (%)</label><input type="number" step="0.01" value="${escHtml(com.percentual || 6)}" oninput="onImportarComissaoChange('percentual', this.value)" /></div>
        </div>
        <div class="form-group" style="margin-top:8px;">
          <label>Cláusulas relevantes / observações</label>
          <textarea rows="4" oninput="onImportarContratoChange('clausulas_relevantes', this.value)">${escHtml(c.clausulas_relevantes)}</textarea>
        </div>
      </div>`;
  }

  $('importar-card-contrato').innerHTML = html;
}

// ----- Handlers de mudança de campo -----

function onImportarCampoChange(grupo, idx, campo, valor) {
  _importContrato.resolucoes[grupo][idx].dados[campo] = valor || null;
}

function onImportarCampoEnderecoChange(grupo, idx, campo, valor) {
  const d = _importContrato.resolucoes[grupo][idx].dados;
  if (!d.endereco) d.endereco = {};
  d.endereco[campo] = valor || null;
}

function onImportarResolucaoChange(grupo, idx, novaAcao, idReusado) {
  if (grupo === 'garantia' || grupo === 'imovel') {
    _importContrato.resolucoes[grupo].acao = novaAcao;
    _importContrato.resolucoes[grupo].idReusado = idReusado;
  } else {
    _importContrato.resolucoes[grupo][idx].acao = novaAcao;
    _importContrato.resolucoes[grupo][idx].idReusado = idReusado;
  }
  // Re-renderiza só a aba afetada
  if (grupo === 'imovel') renderCardImovel();
  else renderCardsPartes();
}

function onImportarImovelChange(campo, valor) {
  _importContrato.resolucoes.imovel.dados[campo] = valor || null;
}

function onImportarImovelEnderecoChange(campo, valor) {
  const d = _importContrato.resolucoes.imovel.dados;
  if (!d.endereco) d.endereco = {};
  d.endereco[campo] = valor || null;
}

function onImportarGarantiaChange(path, valor) {
  const [sub, campo] = path.split('.');
  const g = _importContrato.resolucoes.garantia.dados;
  if (!g[sub]) g[sub] = {};
  g[sub][campo] = valor || null;
}

function onImportarContratoChange(campo, valor) {
  const ehLocacao = _importContrato.tipoHint === 'locacao';
  const chave = ehLocacao ? 'contrato_locacao' : 'contrato_venda';
  if (!_importContrato.dadosIA[chave]) _importContrato.dadosIA[chave] = {};
  _importContrato.dadosIA[chave][campo] = valor || null;
}

function onImportarComissaoChange(campo, valor) {
  if (!_importContrato.dadosIA.comissao) _importContrato.dadosIA.comissao = {};
  _importContrato.dadosIA.comissao[campo] = valor || null;
}

// ----- Persistência atômica -----

async function salvarContratoImportado() {
  const btn = $('btn-importar-salvar');
  btn.disabled = true;
  btn.textContent = '💾 Salvando…';

  try {
    // Validações
    const ehLocacao = _importContrato.tipoHint === 'locacao';
    const r = _importContrato.resolucoes;

    if (!r.locadores.length) throw new Error('Pelo menos um locador/vendedor é obrigatório.');
    if (!r.locatarios.length) throw new Error('Pelo menos um locatário/comprador é obrigatório.');
    if (!r.imovel) throw new Error('Dados do imóvel não detectados — não é possível salvar.');

    r.locadores.concat(r.locatarios).forEach((p, i) => {
      if (p.acao !== 'reusar') {
        if (!p.dados.nome) throw new Error(`Nome da parte #${i + 1} é obrigatório.`);
        if (!(p.dados.documento || p.dados.documento_formatado)) {
          throw new Error(`CPF/CNPJ da parte "${p.dados.nome}" é obrigatório (não detectado pela IA).`);
        }
      }
    });

    if (r.imovel.acao !== 'reusar' && !r.imovel.dados.apelido_sugerido) {
      throw new Error('Apelido do imóvel é obrigatório.');
    }

    // Pré-gera IDs e monta batch
    const batch = db.batch();
    const colecaoLoc = 'locadores';
    const colecaoLat = ehLocacao ? 'locatarios' : 'compradores';

    const locadorIds = r.locadores.map(p => {
      if (p.acao === 'reusar') return p.idReusado;
      const ref = tenantPath().collection(colecaoLoc).doc();
      batch.set(ref, pessoaParaFirestore(p.dados, false));
      return ref.id;
    });
    const locatarioIds = r.locatarios.map(p => {
      if (p.acao === 'reusar') return p.idReusado;
      const ref = tenantPath().collection(colecaoLat).doc();
      batch.set(ref, pessoaParaFirestore(p.dados, colecaoLat === 'compradores'));
      return ref.id;
    });

    let garantiaId = null;
    if (ehLocacao && r.garantia) {
      if (r.garantia.acao === 'reusar') {
        garantiaId = r.garantia.idReusado;
      } else {
        const ref = tenantPath().collection('garantias').doc();
        batch.set(ref, garantiaParaFirestore(r.garantia.dados));
        garantiaId = ref.id;
      }
    }

    let imovelId;
    if (r.imovel.acao === 'reusar') {
      imovelId = r.imovel.idReusado;
    } else {
      const ref = tenantPath().collection('imoveis').doc();
      batch.set(ref, imovelParaFirestore(r.imovel.dados, locadorIds[0], ehLocacao));
      imovelId = ref.id;
    }

    // Número sequencial (fora do batch porque é transaction)
    const tipoContador = ehLocacao ? 'contratos' : 'negociacoes';
    const seq = await proximoNumeroSequencial(tipoContador);

    // Contrato / negociação
    const docFinalRef = tenantPath().collection(tipoContador).doc();
    const dadosFinal = ehLocacao
      ? contratoLocacaoParaFirestore(_importContrato.dadosIA, locadorIds, locatarioIds, imovelId, garantiaId, seq)
      : negociacaoParaFirestore(_importContrato.dadosIA, locadorIds, locatarioIds, imovelId, seq);
    batch.set(docFinalRef, dadosFinal);

    await batch.commit();
    _importContrato.contratoCriadoId = docFinalRef.id;
    _importContrato.contratoCriadoTipo = tipoContador;

    // Side-effects pós-commit
    try {
      if (ehLocacao) {
        await syncImovelStatusFromContrato(imovelId, dadosFinal.status, null);
      } else {
        await syncImovelStatusFromNegociacao(imovelId, dadosFinal.status, null);
      }
      invalidateImoveisCache();
    } catch (e) { console.warn('Sync status imóvel falhou (não crítico):', e); }

    // Upload do arquivo original
    if (_importContrato.arquivo) {
      try {
        const f = _importContrato.arquivo;
        const ext = (f.name.split('.').pop() || 'pdf').toLowerCase();
        const fname = `contrato-importado-${Date.now()}.${ext}`;
        const ref = storageTenantRef().child(`${tipoContador}/${docFinalRef.id}/${fname}`);
        await ref.put(f);
      } catch (e) { console.warn('Upload do arquivo original falhou (não crítico):', e); }
    }

    logAuditoria('create', 'importacao_contrato', docFinalRef.id, {
      numero: seq.numero,
      tipo: tipoContador,
      arquivo: _importContrato.arquivo?.name,
      partesNovas: r.locadores.filter(p => p.acao !== 'reusar').length + r.locatarios.filter(p => p.acao !== 'reusar').length,
      imovelNovo: r.imovel.acao !== 'reusar',
    });

    // Etapa de sucesso
    $('importar-etapa-revisao').style.display = 'none';
    $('importar-etapa-sucesso').style.display = 'block';
    const tipoLabel = ehLocacao ? 'Contrato de locação' : 'Negociação de venda';
    $('importar-sucesso-resumo').innerHTML = `${tipoLabel} <strong>nº ${seq.numero}</strong> criada.`;
  } catch (err) {
    console.error('Erro ao salvar contrato importado:', err);
    importarContratoErro(err.message || 'Erro ao salvar.');
    btn.disabled = false;
    btn.textContent = '💾 Salvar tudo';
  }
}

// ----- Mappers: schema da IA → schema do Firestore -----

function pessoaParaFirestore(d, ehComprador) {
  const doc = (d.documento || d.documento_formatado || '').replace(/\D/g, '');
  const base = {
    tipo: d.tipo_pessoa || 'PF',
    nome: d.nome || '',
    documento: doc,
    rg: d.rg || null,
    nascimento: d.nascimento || null,
    estadoCivil: d.estado_civil || null,
    profissao: d.profissao || null,
    nacionalidade: d.nacionalidade || 'brasileiro(a)',
    email: d.email || null,
    telefone: (d.telefone || '').replace(/\D/g, '') || null,
    endereco: {
      cep: (d.endereco?.cep || '').replace(/\D/g, '') || null,
      logradouro: d.endereco?.logradouro || null,
      numero: d.endereco?.numero ? String(d.endereco.numero) : null,
      complemento: d.endereco?.complemento || null,
      bairro: d.endereco?.bairro || null,
      cidade: d.endereco?.cidade || null,
      uf: d.endereco?.uf || null,
    },
    obs: 'Importado via IA',
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    criadoPor: State.user.uid,
  };
  if (ehComprador) {
    base.formaPagamento = d.forma_pagamento || null;
    base.renda = d.renda || null;
    base.bancoFinanceira = d.banco_financeira || null;
    base.valorEntrada = d.valor_entrada || null;
    base.status = 'em_analise';
  }
  return base;
}

function imovelParaFirestore(d, locadorId, ehLocacao) {
  return {
    apelido: d.apelido_sugerido || 'Imóvel importado',
    status: 'disponivel',
    tipo: d.tipo || null,
    finalidade: d.finalidade || (ehLocacao ? 'locacao' : 'venda'),
    locadorId,
    endereco: {
      cep: (d.endereco?.cep || '').replace(/\D/g, '') || null,
      logradouro: d.endereco?.logradouro || null,
      numero: d.endereco?.numero ? String(d.endereco.numero) : null,
      complemento: d.endereco?.complemento || null,
      bairro: d.endereco?.bairro || null,
      cidade: d.endereco?.cidade || null,
      uf: d.endereco?.uf || null,
    },
    areaUtil: parseFloat(d.area_util) || null,
    areaTotal: parseFloat(d.area_total) || null,
    andar: d.andar || null,
    quartos: parseInt(d.quartos, 10) || null,
    banheiros: parseInt(d.banheiros, 10) || null,
    vagas: parseInt(d.vagas, 10) || null,
    mobiliado: d.mobiliado || null,
    matricula: d.matricula || null,
    iptu: d.iptu || null,
    valorMercado: parseFloat(d.valor_mercado) || null,
    aluguelSugerido: parseFloat(d.aluguel_sugerido) || null,
    valorVenda: parseFloat(d.valor_venda) || null,
    obs: 'Importado via IA',
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    criadoPor: State.user.uid,
  };
}

function garantiaParaFirestore(d) {
  const base = {
    tipo: d.tipo,
    status: 'ativa',
    obs: 'Importado via IA',
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    criadoPor: State.user.uid,
  };
  if (d.tipo === 'fiador' && d.fiador) {
    base.fiador = {
      nome: d.fiador.nome || '',
      cpf: (d.fiador.cpf || '').replace(/\D/g, ''),
      rg: d.fiador.rg || null,
      nascimento: d.fiador.nascimento || null,
      profissao: d.fiador.profissao || null,
      estadoCivil: d.fiador.estado_civil || null,
      email: d.fiador.email || null,
      telefone: (d.fiador.telefone || '').replace(/\D/g, '') || null,
      endereco: d.fiador.endereco || null,
      renda: parseFloat(d.fiador.renda) || null,
      bens: d.fiador.bens || null,
      conjugeNome: d.fiador.conjuge_nome || null,
      conjugeCpf: (d.fiador.conjuge_cpf || '').replace(/\D/g, '') || null,
    };
  } else if (d.tipo === 'caucao' && d.caucao) {
    base.caucao = {
      modalidade: d.caucao.modalidade || 'dinheiro',
      data: d.caucao.data || null,
      valor: parseFloat(d.caucao.valor) || null,
      banco: d.caucao.banco || null,
      agencia: d.caucao.agencia || null,
      conta: d.caucao.conta || null,
      bemDescricao: d.caucao.bem_descricao || null,
    };
  } else if (d.tipo === 'seguro_fianca' && d.seguro) {
    base.seguro = {
      seguradora: d.seguro.seguradora || null,
      apolice: d.seguro.apolice || null,
      vigenciaInicio: d.seguro.vigencia_inicio || null,
      vigenciaFim: d.seguro.vigencia_fim || null,
      cobertura: parseFloat(d.seguro.cobertura) || null,
      premio: parseFloat(d.seguro.premio) || null,
      formaPagamento: d.seguro.forma_pagamento || null,
      parcelas: parseInt(d.seguro.parcelas, 10) || null,
    };
  }
  return base;
}

function contratoLocacaoParaFirestore(d, locadorIds, locatarioIds, imovelId, garantiaId, seq) {
  const c = d.contrato_locacao || {};
  const aluguel = parseFloat(c.aluguel) || 0;
  const extras = [];
  if (locadorIds.length > 1) extras.push('Co-locadores: ' + locadorIds.slice(1).map((_, i) => `[${i + 2}]`).join(', ') + ' (ver cadastros)');
  if (locatarioIds.length > 1) extras.push('Co-locatários: ' + locatarioIds.slice(1).length + ' adicionais (ver cadastros)');
  if (c.clausulas_relevantes) extras.push(c.clausulas_relevantes);

  return {
    numero: seq.numero,
    numeroSequencial: seq.numeroSequencial,
    status: 'rascunho',
    motivoStatus: null,
    imovelId,
    locadorId: locadorIds[0],
    locatarioId: locatarioIds[0],
    locadoresAdicionais: locadorIds.slice(1),
    locatariosAdicionais: locatarioIds.slice(1),
    garantiaId,
    prazoMeses: parseInt(c.prazo_meses, 10) || 30,
    inicio: c.inicio || null,
    fim: c.fim || null,
    aluguel,
    diaVencimento: parseInt(c.dia_vencimento, 10) || 5,
    taxaAdm: parseFloat(c.taxa_adm) || 10,
    multaRescisoria: parseFloat(c.multa_rescisoria) || (aluguel * 3),
    reajusteIndice: (c.reajuste_indice || 'ipca').toLowerCase(),
    reajustePeriodicidade: c.reajuste_periodicidade || 'anual',
    primeiroAluguelEscritorio: false,
    clausulas: extras.join('\n\n') || null,
    obs: 'Importado via IA',
    importadoPorIA: true,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    criadoPor: State.user.uid,
  };
}

function negociacaoParaFirestore(d, vendedorIds, compradorIds, imovelId, seq) {
  const c = d.contrato_venda || {};
  const com = d.comissao || {};
  const extras = [];
  if (vendedorIds.length > 1) extras.push('Co-vendedores: ' + vendedorIds.slice(1).length + ' adicionais (ver cadastros)');
  if (compradorIds.length > 1) extras.push('Co-compradores: ' + compradorIds.slice(1).length + ' adicionais (ver cadastros)');
  if (c.clausulas_relevantes) extras.push(c.clausulas_relevantes);

  return {
    numero: seq.numero,
    numeroSequencial: seq.numeroSequencial,
    status: 'rascunho',
    motivoStatus: null,
    imovelId,
    vendedorId: vendedorIds[0],
    compradorId: compradorIds[0],
    vendedoresAdicionais: vendedorIds.slice(1),
    compradoresAdicionais: compradorIds.slice(1),
    valor: parseFloat(c.valor) || 0,
    formaPagamento: c.forma_pagamento || 'a_vista',
    comissao: parseFloat(com.percentual) || 6,
    entrada: parseFloat(c.entrada) || null,
    dataAceite: c.data_aceite || null,
    dataPosse: c.data_posse || null,
    clausulas: extras.join('\n\n') || null,
    obs: 'Importado via IA',
    importadoPorIA: true,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    criadoPor: State.user.uid,
  };
}

async function abrirContratoImportado() {
  if (!_importContrato || !_importContrato.contratoCriadoId) return;
  const tipo = _importContrato.contratoCriadoTipo;
  const id = _importContrato.contratoCriadoId;
  fecharImportarContrato();
  if (tipo === 'contratos') {
    showSection('section-contratos');
    if (typeof openContratoModal === 'function') openContratoModal(id);
  } else {
    showSection('section-negociacoes');
    if (typeof openNegociacaoModal === 'function') openNegociacaoModal(id);
  }
}

// =============================================================================
// ELABORAR CONTRATO (wizard guiado: locação ou venda → preview → PDF/Word/ZapSign)
// =============================================================================
// Templates base com aviso amarelo de revisão jurídica.
// Schema de perguntas condicionais — campo `condicao: { campoY: 'valor' }` só
// mostra a pergunta se respostas[campoY] === valor.
// =============================================================================

const ELAB_AVISO_REVISAO = `<div style="background:#fff8e1; border:2px solid #ffc107; padding:12px 16px; margin:0 0 20px 0; font-size:13px; color:#444;"><strong>⚠️ MODELO BASE</strong> — Este template é um exemplo. Recomendamos revisão jurídica antes de uso comercial. Edite livremente o texto após gerar.</div>`;

const ELAB_TEMPLATES = {
  locacao: {
    id: 'locacao_residencial_v1',
    versao: 1,
    modalidade: 'locacao',
    nome: 'Contrato de Locação Residencial',
    perguntas: [
      { id: 'locador_id', tipo: 'select_entidade', colecao: 'locadores', label: 'Quem é o locador?', obrigatorio: true },
      { id: 'locatario_id', tipo: 'select_entidade', colecao: 'locatarios', label: 'Quem é o locatário?', obrigatorio: true },
      { id: 'imovel_id', tipo: 'select_entidade', colecao: 'imoveis', label: 'Qual é o imóvel?', obrigatorio: true },
      { id: 'finalidade', tipo: 'select', label: 'Finalidade da locação', opcoes: [
        { v: 'residencial', l: 'Residencial' },
        { v: 'comercial', l: 'Comercial' },
        { v: 'temporada', l: 'Temporada' },
      ], default: 'residencial' },
      { id: 'inicio', tipo: 'date', label: 'Data de início', obrigatorio: true },
      { id: 'prazo_meses', tipo: 'number', label: 'Prazo (meses)', default: 30, obrigatorio: true },
      { id: 'aluguel', tipo: 'money', label: 'Valor do aluguel mensal (R$)', obrigatorio: true },
      { id: 'dia_vencimento', tipo: 'number', label: 'Dia de vencimento do aluguel (1-31)', default: 5 },
      { id: 'reajuste_indice', tipo: 'select', label: 'Índice de reajuste', opcoes: [
        { v: 'IPCA', l: 'IPCA (IBGE) — recomendado' },
        { v: 'IGPM', l: 'IGP-M (FGV)' },
        { v: 'INPC', l: 'INPC (IBGE)' },
        { v: 'INCC', l: 'INCC (FGV)' },
      ], default: 'IPCA' },
      { id: 'reajuste_periodicidade', tipo: 'select', label: 'Periodicidade do reajuste', opcoes: [
        { v: 'anual', l: 'Anual' },
        { v: 'semestral', l: 'Semestral' },
      ], default: 'anual' },
      { id: 'multa_atraso', tipo: 'number', label: 'Multa por atraso (%)', default: 10 },
      { id: 'juros_atraso', tipo: 'number', label: 'Juros mora (% ao mês)', default: 1 },
      { id: 'honorarios_advocaticios', tipo: 'number', label: 'Honorários advocatícios em cobrança (%)', default: 20 },
      { id: 'multa_rescisoria_meses', tipo: 'number', label: 'Multa rescisória (em meses de aluguel proporcionais)', default: 3 },
      { id: 'tem_garantia', tipo: 'yesno', label: 'Há garantia locatícia?', default: 'sim' },
      { id: 'garantia_id', tipo: 'select_entidade', colecao: 'garantias', label: 'Selecione a garantia', condicao: { tem_garantia: 'sim' } },
      { id: 'foro', tipo: 'text', label: 'Foro (comarca de eleição para disputas)', obrigatorio: true },
      { id: 'clausulas_extras', tipo: 'textarea', label: 'Cláusulas adicionais (opcional)' },
    ],
    template: `${ELAB_AVISO_REVISAO}
<h1 style="text-align:center;">CONTRATO DE LOCAÇÃO {{finalidade_upper}}</h1>

<p>Pelo presente instrumento particular de locação, as partes abaixo qualificadas têm entre si justo e contratado:</p>

<p><strong>LOCADOR:</strong> {{locador.nome}}, {{locador.nacionalidade_or}}, {{locador.estadoCivil_or}}, {{locador.profissao_or}}, portador do documento de identidade nº {{locador.rg_or}} e inscrito no CPF/CNPJ sob o nº {{locador.documento_fmt}}, residente e domiciliado em {{locador.endereco_completo}}, doravante denominado simplesmente <strong>LOCADOR</strong>.</p>

<p><strong>LOCATÁRIO:</strong> {{locatario.nome}}, {{locatario.nacionalidade_or}}, {{locatario.estadoCivil_or}}, {{locatario.profissao_or}}, portador do documento de identidade nº {{locatario.rg_or}} e inscrito no CPF/CNPJ sob o nº {{locatario.documento_fmt}}, residente e domiciliado em {{locatario.endereco_completo}}, doravante denominado simplesmente <strong>LOCATÁRIO</strong>.</p>

{{#if garantia}}<p><strong>{{garantia.papel_upper}}:</strong> {{garantia.identificacao}}, na qualidade de {{garantia.tipo_label}} solidário, doravante denominado <strong>{{garantia.papel_upper}}</strong>.</p>{{/if}}

<h3>CLÁUSULA 1ª — DO OBJETO</h3>
<p>O LOCADOR dá em locação ao LOCATÁRIO o imóvel localizado em <strong>{{imovel.endereco_completo}}</strong>{{#if imovel.matricula}}, matrícula nº {{imovel.matricula}} no Registro de Imóveis competente{{/if}}{{#if imovel.iptu}}, inscrição municipal (IPTU) nº {{imovel.iptu}}{{/if}}, doravante denominado <strong>IMÓVEL</strong>, que será destinado exclusivamente à finalidade <strong>{{finalidade}}</strong>.</p>

<h3>CLÁUSULA 2ª — DO PRAZO</h3>
<p>A presente locação vigorará pelo prazo de {{prazo_meses}} ({{prazo_meses}}) meses, iniciando-se em <strong>{{inicio_br}}</strong> e terminando em <strong>{{fim_br}}</strong>, independentemente de aviso ou notificação.</p>

<h3>CLÁUSULA 3ª — DO ALUGUEL</h3>
<p>O aluguel mensal é de <strong>{{aluguel_fmt}}</strong>, a ser pago pelo LOCATÁRIO ao LOCADOR até o dia <strong>{{dia_vencimento}}</strong> de cada mês subsequente ao vencido, por meio de depósito ou transferência bancária em conta indicada pelo LOCADOR, ou via boleto/PIX emitido pela administradora.</p>

<h3>CLÁUSULA 4ª — DO REAJUSTE</h3>
<p>O valor do aluguel será reajustado a cada {{reajuste_periodicidade}} pela variação acumulada do <strong>{{reajuste_indice}}</strong> no período, observada a periodicidade mínima legal. Em caso de extinção do índice, será adotado o que vier a substituí-lo oficialmente.</p>

<h3>CLÁUSULA 5ª — DA MORA, MULTA E JUROS</h3>
<p>O atraso no pagamento do aluguel ou de qualquer encargo importará na aplicação de multa moratória de <strong>{{multa_atraso}}%</strong> sobre o valor devido, acrescida de juros de mora de <strong>{{juros_atraso}}% ao mês</strong>, calculados <em>pro rata die</em>, e correção monetária pelo índice contratual.</p>

<h3>CLÁUSULA 6ª — DOS ENCARGOS</h3>
<p>Ficam a cargo do LOCATÁRIO, durante toda a vigência do contrato, o pagamento de: (a) taxa de água, esgoto, energia elétrica, gás, telefone, internet e demais serviços individuais; (b) taxas de condomínio ordinárias; (c) IPTU; e (d) demais encargos exigíveis durante a locação.</p>
<p>Caberão ao LOCADOR os encargos extraordinários de condomínio, assim definidos pela Lei 8.245/91, art. 22, X.</p>

<h3>CLÁUSULA 7ª — DA CONSERVAÇÃO E DEVOLUÇÃO</h3>
<p>O LOCATÁRIO recebe o IMÓVEL em perfeito estado de conservação, conforme vistoria de entrada, comprometendo-se a devolvê-lo nas mesmas condições ao final da locação, respondendo por quaisquer danos causados por uso indevido.</p>

<h3>CLÁUSULA 8ª — DAS BENFEITORIAS</h3>
<p>Qualquer obra, reforma ou benfeitoria — necessária, útil ou voluptuária — somente poderá ser realizada pelo LOCATÁRIO mediante autorização prévia e por escrito do LOCADOR, ficando incorporada ao IMÓVEL sem direito a retenção ou indenização, salvo disposição expressa em contrário.</p>

<h3>CLÁUSULA 9ª — DA RESCISÃO ANTECIPADA</h3>
<p>Em caso de devolução antecipada do IMÓVEL pelo LOCATÁRIO, será devida multa proporcional de até <strong>{{multa_rescisoria_meses}}</strong> alugueres, na forma do art. 4º da Lei 8.245/91.</p>

{{#if garantia}}<h3>CLÁUSULA 10ª — DA GARANTIA</h3>
<p>{{garantia.clausula_detalhada}}</p>{{/if}}

<h3>CLÁUSULA {{n_clausula_finais}}ª — DO FORO</h3>
<p>As partes elegem o foro da comarca de <strong>{{foro}}</strong> como competente para dirimir quaisquer dúvidas ou litígios decorrentes do presente contrato, renunciando a qualquer outro, por mais privilegiado que seja.</p>

{{#if clausulas_extras}}<h3>CLÁUSULA {{n_clausula_extras}}ª — DISPOSIÇÕES ADICIONAIS</h3>
<p>{{clausulas_extras_html}}</p>{{/if}}

<p style="margin-top:30px;">E, por estarem justas e contratadas, as partes assinam o presente instrumento em duas vias de igual teor.</p>

<p style="text-align:right; margin-top:20px;">{{cidade}}, {{data_hoje_extenso}}.</p>

<div style="margin-top:60px; display:flex; justify-content:space-around; gap:30px;">
  <div style="text-align:center; flex:1;">
    <div style="border-top:1px solid #000; padding-top:6px;">{{locador.nome}}</div>
    <div style="font-size:11px;">LOCADOR</div>
  </div>
  <div style="text-align:center; flex:1;">
    <div style="border-top:1px solid #000; padding-top:6px;">{{locatario.nome}}</div>
    <div style="font-size:11px;">LOCATÁRIO</div>
  </div>
</div>

{{#if garantia}}<div style="margin-top:30px; text-align:center;">
  <div style="border-top:1px solid #000; padding-top:6px; max-width:260px; margin:0 auto;">{{garantia.identificacao_curta}}</div>
  <div style="font-size:11px;">{{garantia.papel_upper}}</div>
</div>{{/if}}

<div style="margin-top:40px; font-size:11px; color:#888;">Testemunhas:</div>
<div style="margin-top:20px; display:flex; gap:30px;">
  <div style="flex:1; border-top:1px solid #000; padding-top:6px; font-size:11px;">Nome / CPF</div>
  <div style="flex:1; border-top:1px solid #000; padding-top:6px; font-size:11px;">Nome / CPF</div>
</div>
`,
  },

  venda: {
    id: 'compra_venda_v1',
    versao: 1,
    modalidade: 'venda',
    nome: 'Contrato de Compra e Venda',
    perguntas: [
      { id: 'vendedor_id', tipo: 'select_entidade', colecao: 'locadores', label: 'Quem é o vendedor?', obrigatorio: true },
      { id: 'comprador_id', tipo: 'select_entidade', colecao: 'compradores', label: 'Quem é o comprador?', obrigatorio: true },
      { id: 'imovel_id', tipo: 'select_entidade', colecao: 'imoveis', label: 'Qual é o imóvel?', obrigatorio: true },
      { id: 'valor_total', tipo: 'money', label: 'Valor total da venda (R$)', obrigatorio: true },
      { id: 'forma_pagamento', tipo: 'select', label: 'Forma de pagamento', opcoes: [
        { v: 'a_vista', l: 'À vista' },
        { v: 'financiamento', l: 'Financiamento bancário' },
        { v: 'parcelado_direto', l: 'Parcelado direto com o vendedor' },
        { v: 'permuta', l: 'Permuta' },
        { v: 'misto', l: 'Misto (entrada + financiamento)' },
      ], obrigatorio: true },
      { id: 'tem_entrada', tipo: 'yesno', label: 'Há entrada/sinal?', default: 'sim' },
      { id: 'valor_entrada', tipo: 'money', label: 'Valor da entrada (R$)', condicao: { tem_entrada: 'sim' } },
      { id: 'data_pagamento_entrada', tipo: 'date', label: 'Data do pagamento da entrada', condicao: { tem_entrada: 'sim' } },
      { id: 'tem_financiamento', tipo: 'yesno', label: 'O comprador usará financiamento bancário?', default: 'nao' },
      { id: 'banco_financiamento', tipo: 'text', label: 'Banco financiador', condicao: { tem_financiamento: 'sim' } },
      { id: 'prazo_quitacao', tipo: 'text', label: 'Prazo para quitação (ex: "60 dias da assinatura")', condicao: { tem_financiamento: 'sim' } },
      { id: 'data_posse', tipo: 'date', label: 'Data prevista para entrega da posse' },
      { id: 'tem_comissao', tipo: 'yesno', label: 'Há comissão de corretagem?', default: 'sim' },
      { id: 'percentual_comissao', tipo: 'number', label: 'Percentual da comissão (%)', default: 6, condicao: { tem_comissao: 'sim' } },
      { id: 'responsavel_comissao', tipo: 'select', label: 'Quem paga a comissão?', condicao: { tem_comissao: 'sim' }, opcoes: [
        { v: 'vendedor', l: 'Vendedor' },
        { v: 'comprador', l: 'Comprador' },
        { v: 'ambos', l: 'Vendedor e comprador (50%/50%)' },
      ], default: 'vendedor' },
      { id: 'multa_inadimplencia', tipo: 'number', label: 'Multa em caso de inadimplência (%)', default: 10 },
      { id: 'foro', tipo: 'text', label: 'Foro (comarca de eleição)', obrigatorio: true },
      { id: 'clausulas_extras', tipo: 'textarea', label: 'Cláusulas adicionais (opcional)' },
    ],
    template: `${ELAB_AVISO_REVISAO}
<h1 style="text-align:center;">INSTRUMENTO PARTICULAR DE COMPROMISSO DE COMPRA E VENDA</h1>

<p>Pelo presente instrumento particular, as partes abaixo qualificadas têm entre si justo e contratado:</p>

<p><strong>VENDEDOR:</strong> {{vendedor.nome}}, {{vendedor.nacionalidade_or}}, {{vendedor.estadoCivil_or}}, {{vendedor.profissao_or}}, portador do CPF/CNPJ nº {{vendedor.documento_fmt}}, residente e domiciliado em {{vendedor.endereco_completo}}, doravante denominado <strong>VENDEDOR</strong>.</p>

<p><strong>COMPRADOR:</strong> {{comprador.nome}}, {{comprador.nacionalidade_or}}, {{comprador.estadoCivil_or}}, {{comprador.profissao_or}}, portador do CPF/CNPJ nº {{comprador.documento_fmt}}, residente e domiciliado em {{comprador.endereco_completo}}, doravante denominado <strong>COMPRADOR</strong>.</p>

<h3>CLÁUSULA 1ª — DO OBJETO</h3>
<p>O VENDEDOR, na condição de legítimo proprietário, promete vender ao COMPRADOR, que promete adquirir, o imóvel situado em <strong>{{imovel.endereco_completo}}</strong>{{#if imovel.matricula}}, matrícula nº {{imovel.matricula}} no Registro de Imóveis competente{{/if}}{{#if imovel.iptu}}, inscrição municipal (IPTU) nº {{imovel.iptu}}{{/if}}, doravante denominado <strong>IMÓVEL</strong>, livre e desembaraçado de quaisquer ônus reais.</p>

<h3>CLÁUSULA 2ª — DO PREÇO E FORMA DE PAGAMENTO</h3>
<p>O preço total da compra é de <strong>{{valor_total_fmt}}</strong>, a ser pago da seguinte forma:</p>
<ul>
{{#if tem_entrada}}<li>Entrada/sinal de <strong>{{valor_entrada_fmt}}</strong>, paga em <strong>{{data_pagamento_entrada_br}}</strong>, dando-se as partes mutuamente quitação;</li>{{/if}}
{{#if tem_financiamento}}<li>Saldo de <strong>{{saldo_fmt}}</strong> a ser pago pelo COMPRADOR através de financiamento bancário junto ao <strong>{{banco_financiamento}}</strong>, no prazo de <strong>{{prazo_quitacao}}</strong>;</li>{{/if}}
{{#if !tem_financiamento}}<li>Saldo de <strong>{{saldo_fmt}}</strong> conforme acordado entre as partes, na modalidade <strong>{{forma_pagamento_label}}</strong>.</li>{{/if}}
</ul>

<h3>CLÁUSULA 3ª — DA POSSE</h3>
<p>A posse plena do IMÓVEL será entregue ao COMPRADOR em <strong>{{data_posse_br}}</strong>, mediante quitação total do preço ajustado, ressalvadas as hipóteses de antecipação ou prorrogação por acordo mútuo formalizado por escrito.</p>

<h3>CLÁUSULA 4ª — DA ESCRITURA</h3>
<p>Cumpridas todas as obrigações pelo COMPRADOR, especialmente o pagamento integral do preço, será outorgada a respectiva escritura pública de compra e venda, com todas as despesas (ITBI, escritura, registro) por conta do COMPRADOR, salvo disposição em contrário.</p>

<h3>CLÁUSULA 5ª — DAS DECLARAÇÕES DO VENDEDOR</h3>
<p>O VENDEDOR declara, sob as penas da lei, que: (a) o IMÓVEL é de sua exclusiva propriedade e está livre e desembaraçado de quaisquer ônus, gravames, hipotecas ou pendências judiciais; (b) não há ações reais ou pessoais reipersecutórias relativas ao bem; (c) o IPTU, taxas e tributos estão quitados até a data de assinatura.</p>

<h3>CLÁUSULA 6ª — DA INADIMPLÊNCIA</h3>
<p>O descumprimento de qualquer obrigação pecuniária por parte do COMPRADOR sujeitará a parte inadimplente à multa de <strong>{{multa_inadimplencia}}%</strong> sobre o valor em mora, acrescida de juros legais e correção monetária, sem prejuízo da rescisão deste contrato a critério da parte prejudicada.</p>

{{#if tem_comissao}}<h3>CLÁUSULA 7ª — DA CORRETAGEM</h3>
<p>As partes reconhecem a intermediação prestada pela imobiliária <strong>{{tenant.nome}}</strong> ({{tenant.creci_or}}), à qual será devida comissão de corretagem no percentual de <strong>{{percentual_comissao}}%</strong> sobre o valor total da venda, a ser paga pelo(a) <strong>{{responsavel_comissao_label}}</strong> no ato da assinatura deste instrumento ou da escritura definitiva, conforme acordado.</p>{{/if}}

<h3>CLÁUSULA {{n_clausula_finais}}ª — DO FORO</h3>
<p>As partes elegem o foro da comarca de <strong>{{foro}}</strong> como competente para dirimir quaisquer dúvidas ou litígios decorrentes deste contrato, renunciando a qualquer outro, por mais privilegiado que seja.</p>

{{#if clausulas_extras}}<h3>CLÁUSULA {{n_clausula_extras}}ª — DISPOSIÇÕES ADICIONAIS</h3>
<p>{{clausulas_extras_html}}</p>{{/if}}

<p style="margin-top:30px;">E, por estarem justas e contratadas, as partes assinam o presente instrumento em duas vias de igual teor.</p>

<p style="text-align:right; margin-top:20px;">{{cidade}}, {{data_hoje_extenso}}.</p>

<div style="margin-top:60px; display:flex; justify-content:space-around; gap:30px;">
  <div style="text-align:center; flex:1;">
    <div style="border-top:1px solid #000; padding-top:6px;">{{vendedor.nome}}</div>
    <div style="font-size:11px;">VENDEDOR</div>
  </div>
  <div style="text-align:center; flex:1;">
    <div style="border-top:1px solid #000; padding-top:6px;">{{comprador.nome}}</div>
    <div style="font-size:11px;">COMPRADOR</div>
  </div>
</div>

<div style="margin-top:40px; font-size:11px; color:#888;">Testemunhas:</div>
<div style="margin-top:20px; display:flex; gap:30px;">
  <div style="flex:1; border-top:1px solid #000; padding-top:6px; font-size:11px;">Nome / CPF</div>
  <div style="flex:1; border-top:1px solid #000; padding-top:6px; font-size:11px;">Nome / CPF</div>
</div>
`,
  },
};

let _elabContrato = null;

async function elabIniciar(modalidade) {
  if (!State.tenant) {
    showAlert('elab-alert', 'Selecione um tenant antes de elaborar contratos.');
    return;
  }
  const tpl = ELAB_TEMPLATES[modalidade];
  if (!tpl) return;

  // Carrega perguntas com overrides (Fase F item 4)
  const perguntas = await getElabPerguntasMescladas(modalidade);

  _elabContrato = {
    modalidade,
    templateId: tpl.id,
    versao: tpl.versao,
    respostas: {},
    htmlGerado: null,
    contratoSalvoId: null,
    perguntas, // ← mescladas com override do tenant
  };
  // Preenche defaults
  perguntas.forEach(p => {
    if (p.default !== undefined) _elabContrato.respostas[p.id] = p.default;
  });

  $('elab-etapa-escolha').style.display = 'none';
  $('elab-etapa-wizard').style.display = 'block';
  $('elab-etapa-preview').style.display = 'none';
  $('btn-elab-reiniciar').style.display = 'inline-block';
  $('elab-wizard-titulo').textContent = tpl.nome;

  elabRenderWizard();
}

function elabReiniciar() {
  _elabContrato = null;
  $('elab-etapa-escolha').style.display = 'block';
  $('elab-etapa-wizard').style.display = 'none';
  $('elab-etapa-preview').style.display = 'none';
  $('btn-elab-reiniciar').style.display = 'none';
  clearAlert('elab-alert');
}

function elabVoltarWizard() {
  $('elab-etapa-wizard').style.display = 'block';
  $('elab-etapa-preview').style.display = 'none';
}

function elabAvaliarCondicao(p) {
  if (!p.condicao) return true;
  return Object.entries(p.condicao).every(([campo, valor]) => _elabContrato.respostas[campo] === valor);
}

async function elabRenderWizard() {
  const perguntas = _elabContrato.perguntas || ELAB_TEMPLATES[_elabContrato.modalidade].perguntas;
  const visiveis = perguntas.filter(elabAvaliarCondicao);
  const respondidas = visiveis.filter(p => _elabContrato.respostas[p.id] !== undefined && _elabContrato.respostas[p.id] !== '').length;
  const total = visiveis.length;
  const percent = total ? Math.round((respondidas / total) * 100) : 0;
  $('elab-wizard-progresso').textContent = `${respondidas} de ${total} respondidas`;
  $('elab-wizard-barra').style.width = `${percent}%`;
  const elPercent = $('elab-wizard-percent');
  if (elPercent) elPercent.innerHTML = `${percent}<small>%</small>`;

  // Pre-carrega caches de entidades usadas
  await ensureLocadoresCache();
  await ensureLocatariosCache();
  await ensureImoveisCache();
  await ensureGarantiasCache();
  if (typeof ensureCompradoresCache === 'function') await ensureCompradoresCache();

  const container = $('elab-perguntas-container');
  container.innerHTML = visiveis.map(p => elabHtmlPergunta(p)).join('');
}

function elabHtmlPergunta(p) {
  const valor = _elabContrato.respostas[p.id] ?? '';
  const requiredMark = p.obrigatorio ? '<span style="color:var(--danger);"> *</span>' : '';
  const isEmpty = valor === '' || valor === null || valor === undefined;
  const isFilled = !isEmpty;
  let inputHtml = '';
  let fullWidth = false;
  switch (p.tipo) {
    case 'text':
      inputHtml = `<input type="text" value="${escapeHtml(valor)}" oninput="elabResposta('${p.id}', this.value)">`;
      break;
    case 'textarea':
      inputHtml = `<textarea rows="3" oninput="elabResposta('${p.id}', this.value)">${escapeHtml(valor)}</textarea>`;
      fullWidth = true;
      break;
    case 'number':
      inputHtml = `<input type="number" step="any" value="${escapeHtml(valor)}" oninput="elabResposta('${p.id}', this.value)">`;
      break;
    case 'money':
      inputHtml = `<input type="number" step="0.01" min="0" value="${escapeHtml(valor)}" oninput="elabResposta('${p.id}', this.value)">`;
      break;
    case 'date':
      inputHtml = `<input type="date" value="${escapeHtml(valor)}" oninput="elabResposta('${p.id}', this.value)">`;
      break;
    case 'yesno':
      inputHtml = `<select onchange="elabResposta('${p.id}', this.value)">
        <option value="">— selecione —</option>
        <option value="sim" ${valor === 'sim' ? 'selected' : ''}>Sim</option>
        <option value="nao" ${valor === 'nao' ? 'selected' : ''}>Não</option>
      </select>`;
      break;
    case 'select':
      inputHtml = `<select onchange="elabResposta('${p.id}', this.value)">
        <option value="">— selecione —</option>
        ${p.opcoes.map(o => `<option value="${o.v}" ${valor === o.v ? 'selected' : ''}>${escapeHtml(o.l)}</option>`).join('')}
      </select>`;
      break;
    case 'select_entidade':
      const cache = elabGetCache(p.colecao);
      inputHtml = `<select onchange="elabResposta('${p.id}', this.value)">
        <option value="">— selecione —</option>
        ${cache.map(e => `<option value="${e.id}" ${valor === e.id ? 'selected' : ''}>${escapeHtml(elabLabelEntidade(p.colecao, e))}</option>`).join('')}
      </select>`;
      break;
    default:
      inputHtml = `<input type="text" value="${escapeHtml(valor)}" oninput="elabResposta('${p.id}', this.value)">`;
  }
  const classes = ['elab-pergunta'];
  if (fullWidth) classes.push('full-width');
  if (p.obrigatorio && isEmpty) classes.push('is-empty-required');
  if (isFilled) classes.push('is-filled');
  return `<div class="${classes.join(' ')}">
    <label>${escapeHtml(p.label)}${requiredMark}</label>
    ${inputHtml}
  </div>`;
}

function elabGetCache(colecao) {
  if (colecao === 'locadores') return (typeof _locadoresCache !== 'undefined' && _locadoresCache) || [];
  if (colecao === 'locatarios') return (typeof _locatariosCache !== 'undefined' && _locatariosCache) || [];
  if (colecao === 'imoveis') return (typeof _imoveisCache !== 'undefined' && _imoveisCache) || [];
  if (colecao === 'garantias') return (typeof _garantiasCache !== 'undefined' && _garantiasCache) || [];
  if (colecao === 'compradores') return (typeof _compradoresCache !== 'undefined' && _compradoresCache) || [];
  return [];
}

function elabLabelEntidade(colecao, e) {
  if (colecao === 'imoveis') return e.apelido || e.id;
  if (colecao === 'garantias') {
    const tipoLabel = GARANTIA_TIPO_LABEL?.[e.tipo] || e.tipo;
    if (typeof garantiaIdentificacao === 'function') return `${garantiaIdentificacao(e)} (${tipoLabel})`;
    return `${e.tipo}`;
  }
  return e.nome || e.id;
}

function elabResposta(id, valor) {
  if (!_elabContrato) return;
  _elabContrato.respostas[id] = valor;
  // Se a resposta afeta condicionais, re-renderiza o wizard inteiro
  const perguntas = _elabContrato.perguntas || ELAB_TEMPLATES[_elabContrato.modalidade].perguntas;
  const afetaCondicao = perguntas.some(p => p.condicao && p.condicao[id] !== undefined);
  if (afetaCondicao) elabRenderWizard();
  else {
    // Só atualiza barra de progresso
    const visiveis = perguntas.filter(elabAvaliarCondicao);
    const respondidas = visiveis.filter(p => _elabContrato.respostas[p.id] !== undefined && _elabContrato.respostas[p.id] !== '').length;
    $('elab-wizard-progresso').textContent = `${respondidas} de ${visiveis.length} respondidas`;
    $('elab-wizard-barra').style.width = visiveis.length ? `${(respondidas / visiveis.length) * 100}%` : '0%';
  }
}

async function elabValidarEGerar() {
  clearAlert('elab-alert');
  const perguntas = _elabContrato.perguntas || ELAB_TEMPLATES[_elabContrato.modalidade].perguntas;
  const visiveis = perguntas.filter(elabAvaliarCondicao);
  const faltando = visiveis.filter(p => p.obrigatorio && (!_elabContrato.respostas[p.id] || _elabContrato.respostas[p.id] === ''));
  if (faltando.length) {
    showAlert('elab-alert', `Preencha os campos obrigatórios: ${faltando.map(p => p.label).join(', ')}`);
    return;
  }

  try {
    const dados = await elabResolverDados();
    const templateAtivo = await obterTemplate(_elabContrato.modalidade);
    const html = elabRenderizarTemplate(templateAtivo, dados);
    _elabContrato.htmlGerado = html;
    _elabContrato.templateUsado = (_tplOverridesCache && _tplOverridesCache[_elabContrato.modalidade]) ? 'customizado' : 'padrao';
    _elabContrato.dadosResolvidos = dados;
    $('elab-preview-container').innerHTML = html;
    $('elab-etapa-wizard').style.display = 'none';
    $('elab-etapa-preview').style.display = 'block';
  } catch (err) {
    console.error('Erro ao gerar contrato:', err);
    showAlert('elab-alert', 'Erro ao gerar contrato: ' + err.message);
  }
}

// Resolve as respostas em um objeto pronto pro template (busca entidades por id)
async function elabResolverDados() {
  const r = _elabContrato.respostas;
  const tenant = State.tenant || {};
  const dados = {
    ...r,
    tenant: {
      ...tenant,
      creci_or: tenant.creci ? `CRECI ${tenant.creci}` : 'imobiliária',
    },
    cidade: 'São Paulo',
    data_hoje_extenso: fmtDataExtenso(),
    finalidade: r.finalidade || 'residencial',
    finalidade_upper: (r.finalidade || 'residencial').toUpperCase(),
  };

  // Resolve entidades
  const tplPerguntas = _elabContrato.perguntas || ELAB_TEMPLATES[_elabContrato.modalidade].perguntas;
  for (const p of tplPerguntas) {
    if (p.tipo === 'select_entidade' && r[p.id]) {
      const snap = await tenantPath().collection(p.colecao).doc(r[p.id]).get();
      if (snap.exists) {
        const ent = snap.data();
        // Mapeia o nome de variável pra forma "limpa": locador_id -> locador
        const baseName = p.id.replace(/_id$/, '');
        dados[baseName] = elabFormatarEntidade(ent, p.colecao);
        if (p.colecao === 'imoveis' && ent.endereco?.cidade) dados.cidade = ent.endereco.cidade;
      }
    }
  }

  // Formatação de valores
  if (r.aluguel) dados.aluguel_fmt = fmtBRL(r.aluguel);
  if (r.valor_total) {
    dados.valor_total_fmt = fmtBRL(r.valor_total);
    const entrada = parseFloat(r.valor_entrada) || 0;
    dados.saldo_fmt = fmtBRL((parseFloat(r.valor_total) || 0) - entrada);
  }
  if (r.valor_entrada) dados.valor_entrada_fmt = fmtBRL(r.valor_entrada);

  // Datas BR
  if (r.inicio) dados.inicio_br = fmtDataBR(r.inicio);
  if (r.inicio && r.prazo_meses) {
    const fim = calcDataFim(r.inicio, r.prazo_meses);
    dados.fim_br = fmtDataBR(fim);
  }
  if (r.data_pagamento_entrada) dados.data_pagamento_entrada_br = fmtDataBR(r.data_pagamento_entrada);
  if (r.data_posse) dados.data_posse_br = fmtDataBR(r.data_posse);

  // Form pagamento label
  const fpMap = { a_vista: 'à vista', financiamento: 'financiamento', parcelado_direto: 'parcelado direto', permuta: 'permuta', misto: 'misto' };
  if (r.forma_pagamento) dados.forma_pagamento_label = fpMap[r.forma_pagamento] || r.forma_pagamento;

  // Responsável comissão label
  const rcMap = { vendedor: 'VENDEDOR', comprador: 'COMPRADOR', ambos: 'VENDEDOR e COMPRADOR (50%/50%)' };
  if (r.responsavel_comissao) dados.responsavel_comissao_label = rcMap[r.responsavel_comissao] || r.responsavel_comissao;

  // Cláusulas extras como HTML
  if (r.clausulas_extras) {
    dados.clausulas_extras_html = (typeof textToHtml === 'function' ? textToHtml(r.clausulas_extras) : escapeHtml(r.clausulas_extras).replace(/\n/g, '<br>'));
  }

  // Numeração de cláusulas finais (após eventuais opcionais)
  if (_elabContrato.modalidade === 'locacao') {
    let n = 10;
    if (r.tem_garantia === 'sim') n = 11;
    dados.n_clausula_finais = n;
    dados.n_clausula_extras = n + 1;
  } else {
    let n = 7;
    if (r.tem_comissao === 'sim') n = 8;
    dados.n_clausula_finais = n;
    dados.n_clausula_extras = n + 1;
  }

  // Garantia: monta blocos derivados
  if (r.garantia_id && dados.garantia) {
    const g = dados.garantia;
    const tipoLabel = (typeof GARANTIA_TIPO_LABEL !== 'undefined' && GARANTIA_TIPO_LABEL[g.tipo]) || g.tipo;
    g.tipo_label = tipoLabel;
    g.papel_upper = g.tipo === 'fiador' ? 'FIADOR' : (g.tipo === 'seguro_fianca' ? 'GARANTIA' : 'CAUÇÃO');
    g.identificacao = typeof garantiaIdentificacao === 'function' ? garantiaIdentificacao(g) : (g.fiador?.nome || tipoLabel);
    g.identificacao_curta = g.fiador?.nome || tipoLabel;
    g.clausula_detalhada = elabClausulaGarantia(g);
  }

  return dados;
}

function elabClausulaGarantia(g) {
  if (g.tipo === 'fiador' && g.fiador) {
    return `Fica constituído como FIADOR e principal pagador, com renúncia expressa aos benefícios dos artigos 827 e 838 do Código Civil, <strong>${escapeHtml(g.fiador.nome || '')}</strong>, CPF nº ${formataCPFCNPJ(g.fiador.cpf || '')}, que responderá solidariamente por todas as obrigações decorrentes deste contrato, inclusive durante eventual prorrogação por prazo indeterminado.`;
  }
  if (g.tipo === 'caucao' && g.caucao) {
    return `Fica entregue, a título de CAUÇÃO, ${g.caucao.modalidade === 'dinheiro' ? `o valor de ${fmtBRL(g.caucao.valor || 0)} em dinheiro` : 'o bem descrito a seguir'}: ${escapeHtml(g.caucao.bemDescricao || '')}, a ser restituído ao final da locação, atualizado, descontadas eventuais pendências.`;
  }
  if (g.tipo === 'seguro_fianca' && g.seguro) {
    return `A garantia locatícia será o SEGURO-FIANÇA contratado junto à seguradora ${escapeHtml(g.seguro.seguradora || '')}, apólice nº ${escapeHtml(g.seguro.apolice || '')}, com vigência de ${g.seguro.vigenciaInicio ? fmtDataBR(g.seguro.vigenciaInicio) : '—'} a ${g.seguro.vigenciaFim ? fmtDataBR(g.seguro.vigenciaFim) : '—'} e cobertura de ${fmtBRL(g.seguro.cobertura || 0)}.`;
  }
  return '';
}

function elabFormatarEntidade(e, colecao) {
  if (colecao === 'imoveis') {
    return {
      ...e,
      endereco_completo: typeof formatEnderecoCompleto === 'function' ? formatEnderecoCompleto(e.endereco) : (e.endereco?.logradouro || ''),
    };
  }
  // Pessoas (locador/locatario/comprador) + garantias
  const docMasked = e.documento ? formataCPFCNPJ(e.documento) : '';
  return {
    ...e,
    documento_fmt: docMasked,
    endereco_completo: typeof formatEnderecoCompleto === 'function' ? formatEnderecoCompleto(e.endereco) : '',
    nacionalidade_or: e.nacionalidade || 'brasileiro(a)',
    estadoCivil_or: e.estadoCivil || 'estado civil não informado',
    profissao_or: e.profissao || 'profissão não informada',
    rg_or: e.rg || 's/n',
  };
}

// Template engine simples: {{var}}, {{a.b.c}}, {{#if var}}...{{/if}}, {{#if !var}}...{{/if}}
function elabRenderizarTemplate(template, dados) {
  // Processa {{#if condicao}}...{{/if}} (sem aninhamento profundo)
  let out = template.replace(/\{\{#if (!?)([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (m, neg, path, content) => {
    const v = elabGetPath(dados, path);
    const truthy = !!v && v !== 'nao' && v !== 'não' && v !== 'false' && v !== '0';
    return (neg === '!' ? !truthy : truthy) ? content : '';
  });
  // Substitui variáveis {{var}}, {{a.b}}
  out = out.replace(/\{\{([\w.]+)\}\}/g, (m, path) => {
    const v = elabGetPath(dados, path);
    if (v === undefined || v === null) return '';
    return String(v);
  });
  return out;
}

function elabGetPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

async function elabBaixarPDF() {
  if (!_elabContrato?.htmlGerado) return;
  if (!window.html2pdf) {
    showAlert('elab-alert', 'Biblioteca html2pdf não carregou. Recarregue a página.');
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.style.padding = '20mm';
  wrapper.style.fontFamily = 'Georgia, serif';
  wrapper.style.fontSize = '12pt';
  wrapper.style.color = '#000';
  wrapper.innerHTML = _elabContrato.htmlGerado;
  const tpl = ELAB_TEMPLATES[_elabContrato.modalidade];
  const filename = `${tpl.nome.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
  await html2pdf().set({
    margin: 0,
    filename,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  }).from(wrapper).save();
}

function elabBaixarWord() {
  if (!_elabContrato?.htmlGerado) return;
  // .doc com HTML embutido — Word abre sem problemas.
  const tpl = ELAB_TEMPLATES[_elabContrato.modalidade];
  const filename = `${tpl.nome.replace(/\s+/g, '_')}_${Date.now()}.doc`;
  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${escapeHtml(tpl.nome)}</title></head><body style="font-family: Georgia, serif; font-size: 12pt;">${_elabContrato.htmlGerado}</body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function elabSalvarContrato() {
  if (!_elabContrato?.htmlGerado) return;
  const btnAlert = 'elab-alert';
  clearAlert(btnAlert);
  try {
    const r = _elabContrato.respostas;
    const ehLocacao = _elabContrato.modalidade === 'locacao';
    const colecao = ehLocacao ? 'contratos' : 'negociacoes';

    const seq = await proximoNumeroSequencial(colecao);

    let payload;
    if (ehLocacao) {
      payload = {
        numero: seq.numero,
        numeroSequencial: seq.numeroSequencial,
        status: 'rascunho',
        imovelId: r.imovel_id,
        locadorId: r.locador_id,
        locatarioId: r.locatario_id,
        garantiaId: r.garantia_id || null,
        prazoMeses: parseInt(r.prazo_meses, 10) || 30,
        inicio: r.inicio || null,
        fim: r.inicio && r.prazo_meses ? calcDataFim(r.inicio, r.prazo_meses) : null,
        aluguel: parseFloat(r.aluguel) || 0,
        diaVencimento: parseInt(r.dia_vencimento, 10) || 5,
        reajusteIndice: (r.reajuste_indice || 'IPCA').toLowerCase(),
        reajustePeriodicidade: r.reajuste_periodicidade || 'anual',
        multaRescisoria: (parseFloat(r.aluguel) || 0) * (parseInt(r.multa_rescisoria_meses, 10) || 3),
        taxaAdm: 10,
        clausulas: r.clausulas_extras || null,
        foro: r.foro || null,
        obs: 'Gerado pelo wizard Elaborar contrato',
        geradoPorWizard: true,
        templateId: _elabContrato.templateId,
        templateVersao: _elabContrato.versao,
        contratoHtml: _elabContrato.htmlGerado,
        criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        criadoPor: State.user.uid,
      };
    } else {
      payload = {
        numero: seq.numero,
        numeroSequencial: seq.numeroSequencial,
        status: 'rascunho',
        imovelId: r.imovel_id,
        vendedorId: r.vendedor_id,
        compradorId: r.comprador_id,
        valor: parseFloat(r.valor_total) || 0,
        formaPagamento: r.forma_pagamento || 'a_vista',
        entrada: parseFloat(r.valor_entrada) || null,
        comissao: parseFloat(r.percentual_comissao) || 0,
        dataPosse: r.data_posse || null,
        clausulas: r.clausulas_extras || null,
        foro: r.foro || null,
        obs: 'Gerado pelo wizard Elaborar contrato',
        geradoPorWizard: true,
        templateId: _elabContrato.templateId,
        templateVersao: _elabContrato.versao,
        contratoHtml: _elabContrato.htmlGerado,
        criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        criadoPor: State.user.uid,
      };
    }

    const ref = await tenantPath().collection(colecao).add(payload);
    _elabContrato.contratoSalvoId = ref.id;
    logAuditoria('create', colecao, ref.id, { numero: seq.numero, geradoPorWizard: true });
    showAlert(btnAlert, `✓ Contrato nº ${seq.numero} salvo. Você pode acessar pela seção de ${ehLocacao ? 'Contratos' : 'Negociações'}.`, 'success');
  } catch (err) {
    console.error('Erro ao salvar contrato do wizard:', err);
    showAlert(btnAlert, 'Erro ao salvar: ' + err.message);
  }
}

// =============================================================================
// MONITOR LEGISLATIVO — UI cliente (busca status do worker drg-rently-legis-monitor)
// =============================================================================

async function legisAtualizarStatus() {
  const url = $('cfg-worker-legis-url').value.trim();
  const box = $('legis-status');
  if (!url) {
    box.innerHTML = '<span style="color:#b91c1c;">Informe a URL do worker primeiro.</span>';
    box.style.display = 'block';
    return;
  }
  box.style.display = 'block';
  box.innerHTML = '⏳ Buscando status…';
  try {
    const res = await fetch(url.replace(/\/$/, '') + '/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    box.innerHTML = renderLegisStatus(data);
  } catch (err) {
    box.innerHTML = `<span style="color:#b91c1c;">Erro: ${escapeHtml(err.message)}</span>`;
  }
}

function renderLegisStatus(data) {
  const ultimoCheck = data.historico?.[0];
  const ultimoCheckTxt = ultimoCheck
    ? `Última verificação: <strong>${new Date(ultimoCheck.executadoEm).toLocaleString('pt-BR')}</strong> · ${ultimoCheck.urlsVerificadas} URL(s) checadas · ${ultimoCheck.alertas} alerta(s) novos`
    : 'Nenhuma verificação ainda. Aguarde o cron diário (~7h Brasília) ou clique em "Verificar agora".';

  let urlsHtml = '';
  if (data.urlsMonitoradas?.length) {
    urlsHtml = `<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:12px;color:var(--primary);">📋 ${data.urlsMonitoradas.length} URL(s) monitoradas</summary><ul style="margin-top:6px; font-size:12px; padding-left:18px;">` +
      data.urlsMonitoradas.map(u => `<li><strong>${escapeHtml(u.nome)}</strong> · <a href="${escapeHtml(u.url)}" target="_blank" rel="noopener">${escapeHtml(u.url)}</a> · afeta: ${(u.templatesAfetados || []).join(', ')}</li>`).join('') +
      '</ul></details>';
  }

  let alertasHtml = '';
  if (data.alertas?.length) {
    alertasHtml = `<details style="margin-top:8px;" open><summary style="cursor:pointer; font-size:12px; color:#b91c1c; font-weight:bold;">🚨 ${data.alertas.length} alerta(s) histórico(s)</summary>` +
      data.alertas.slice(0, 10).map(a => `
        <div style="margin:8px 0; padding:10px; background:#fff8e1; border-left:3px solid #ffc107; border-radius:4px; font-size:12px;">
          <strong>${escapeHtml(a.entrada?.nome || '')}</strong><br>
          <span class="muted">${new Date(a.detectadoEm).toLocaleString('pt-BR')} · impacto: ${escapeHtml(a.analise?.impacto || '—')}</span>
          <p style="margin:6px 0 0;">${escapeHtml(a.analise?.resumo_mudancas || '')}</p>
          ${(a.analise?.patches_sugeridos || []).length ? `<p style="margin:4px 0 0; font-size:11px;"><strong>${a.analise.patches_sugeridos.length} patch(es) sugerido(s)</strong> — abra Templates do wizard para aplicar.</p>` : ''}
        </div>
      `).join('') +
      (data.alertas.length > 10 ? `<p class="muted" style="font-size:11px;">… e mais ${data.alertas.length - 10} alertas anteriores.</p>` : '') +
      '</details>';
  } else {
    alertasHtml = `<p style="margin-top:8px; font-size:12px; color:#16a34a;">✅ Nenhum alerta legislativo no histórico.</p>`;
  }

  return `<div>${ultimoCheckTxt}${urlsHtml}${alertasHtml}</div>`;
}

async function legisDispararCheck() {
  const url = $('cfg-worker-legis-url').value.trim();
  const box = $('legis-status');
  if (!url) { box.innerHTML = '<span style="color:#b91c1c;">Informe a URL primeiro.</span>'; box.style.display = 'block'; return; }
  if (!confirm('Disparar verificação imediata? Pode levar 30-60 segundos para responder.')) return;
  box.style.display = 'block';
  box.innerHTML = '⏳ Verificando agora… (pode levar 30-60s)';
  try {
    const res = await fetch(url.replace(/\/$/, '') + '/check', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const exec = await res.json();
    box.innerHTML = `<p>✅ Verificação concluída em ${exec.duracaoMs}ms. ${exec.alertas} alerta(s) novos.</p>`;
    // Re-atualiza status completo
    setTimeout(() => legisAtualizarStatus(), 500);
  } catch (err) {
    box.innerHTML = `<span style="color:#b91c1c;">Erro: ${escapeHtml(err.message)}</span>`;
  }
}

// =============================================================
// EDITOR DE URLs DO MONITOR LEGISLATIVO (Fase F item 3)
// =============================================================

let _legisUrlsEditor = { urls: [], customizadas: false, dirty: false };

function legisWorkerUrlNormalizada() {
  const u = $('cfg-worker-legis-url')?.value.trim();
  if (!u) throw new Error('Configure a URL do Worker Legis Monitor primeiro.');
  return u.replace(/\/+$/, '');
}

async function legisCarregarUrls() {
  const SID = 'legis-urls-status';
  showInlineStatus(SID, '⏳ Carregando…', 'loading');
  try {
    const url = legisWorkerUrlNormalizada();
    const res = await fetch(url + '/urls');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _legisUrlsEditor.urls = (data.urls || []).map(u => ({ ...u }));
    _legisUrlsEditor.customizadas = !!data.customizadas;
    _legisUrlsEditor.dirty = false;
    renderLegisUrlsLista();
    $('legis-urls-aviso').textContent = _legisUrlsEditor.customizadas
      ? '⚠️ Você está editando uma lista customizada (salva no KV). Pra voltar ao padrão, clique "Restaurar URLs padrão".'
      : 'Usando lista padrão hardcoded no Worker. Edite e clique "Salvar" pra customizar.';
    showInlineStatus(SID, `✅ ${_legisUrlsEditor.urls.length} URL(s) carregadas.`, 'success', 5000);
  } catch (err) {
    showInlineStatus(SID, `❌ ${err.message}`, 'error');
  }
}

function renderLegisUrlsLista() {
  const lista = $('legis-urls-lista');
  if (!lista) return;
  lista.innerHTML = _legisUrlsEditor.urls.map((u, idx) => `
    <div class="card" style="margin-bottom:10px; padding:12px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:6px;">
        <strong style="font-size:12px;">#${idx + 1}</strong>
        <button class="btn btn-danger btn-sm" type="button" onclick="legisRemoverUrl(${idx})" title="Remover">✕</button>
      </div>
      <div class="form-group" style="margin-bottom:6px;">
        <label style="font-size:11px;">ID (interno, sem espaços)</label>
        <input type="text" value="${escapeHtml(u.id || '')}" oninput="legisUpdateUrl(${idx}, 'id', this.value)" placeholder="ex: lei_inquilinato">
      </div>
      <div class="form-group" style="margin-bottom:6px;">
        <label style="font-size:11px;">Nome (descrição)</label>
        <input type="text" value="${escapeHtml(u.nome || '')}" oninput="legisUpdateUrl(${idx}, 'nome', this.value)" placeholder="ex: Lei do Inquilinato">
      </div>
      <div class="form-group" style="margin-bottom:6px;">
        <label style="font-size:11px;">URL completa (http/https)</label>
        <input type="url" value="${escapeHtml(u.url || '')}" oninput="legisUpdateUrl(${idx}, 'url', this.value)" placeholder="https://www.planalto.gov.br/...">
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label style="font-size:11px;">Templates afetados (separados por vírgula: locacao, venda, distrato)</label>
        <input type="text" value="${escapeHtml((u.templatesAfetados || []).join(', '))}" oninput="legisUpdateTemplatesAfetados(${idx}, this.value)" placeholder="locacao, distrato">
      </div>
    </div>
  `).join('');
}

function legisUpdateUrl(idx, campo, valor) {
  if (!_legisUrlsEditor.urls[idx]) return;
  _legisUrlsEditor.urls[idx][campo] = valor;
  _legisUrlsEditor.dirty = true;
  showInlineStatus('legis-urls-status', '✏️ Alterações não salvas', 'info');
}

function legisUpdateTemplatesAfetados(idx, raw) {
  if (!_legisUrlsEditor.urls[idx]) return;
  _legisUrlsEditor.urls[idx].templatesAfetados = raw.split(',').map(s => s.trim()).filter(Boolean);
  _legisUrlsEditor.dirty = true;
  showInlineStatus('legis-urls-status', '✏️ Alterações não salvas', 'info');
}

function legisAddUrl() {
  _legisUrlsEditor.urls.push({
    id: 'nova_lei_' + Date.now().toString(36).slice(-5),
    nome: 'Nova lei monitorada',
    url: '',
    templatesAfetados: [],
  });
  _legisUrlsEditor.dirty = true;
  renderLegisUrlsLista();
}

function legisRemoverUrl(idx) {
  if (!confirm(`Remover a URL "${_legisUrlsEditor.urls[idx]?.nome || idx + 1}" da lista?`)) return;
  _legisUrlsEditor.urls.splice(idx, 1);
  _legisUrlsEditor.dirty = true;
  renderLegisUrlsLista();
}

async function legisSalvarUrls() {
  const SID = 'legis-urls-status';
  try {
    const workerUrl = legisWorkerUrlNormalizada();
    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (!cfg.legisAdminToken) {
      throw new Error('Configure o "Token administrativo do Worker" antes (campo logo acima).');
    }
    const invalidas = _legisUrlsEditor.urls.filter(u => !u.url || !/^https?:\/\//i.test(u.url));
    if (invalidas.length) {
      throw new Error(`${invalidas.length} URL(s) inválida(s). Toda URL deve começar com http:// ou https://`);
    }
    showInlineStatus(SID, '⏳ Salvando…', 'loading');
    const res = await fetch(workerUrl + '/urls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DRG-Admin-Token': cfg.legisAdminToken,
      },
      body: JSON.stringify({ urls: _legisUrlsEditor.urls }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    _legisUrlsEditor.dirty = false;
    _legisUrlsEditor.customizadas = true;
    showInlineStatus(SID, `✅ ${data.salvas} URL(s) salvas no Worker (próxima execução já usa).`, 'success', 6000);
    $('legis-urls-aviso').textContent = '⚠️ Você está editando uma lista customizada (salva no KV).';
  } catch (err) {
    showInlineStatus(SID, `❌ ${err.message}`, 'error');
  }
}

async function legisRestaurarUrls() {
  if (!confirm('Restaurar URLs padrão (hardcoded)? A lista customizada será removida do KV.')) return;
  const SID = 'legis-urls-status';
  try {
    const workerUrl = legisWorkerUrlNormalizada();
    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (!cfg.legisAdminToken) throw new Error('Configure o "Token administrativo do Worker" antes.');
    showInlineStatus(SID, '⏳ Restaurando…', 'loading');
    const res = await fetch(workerUrl + '/urls', {
      method: 'DELETE',
      headers: { 'X-DRG-Admin-Token': cfg.legisAdminToken },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    _legisUrlsEditor.urls = (data.urls || []).map(u => ({ ...u }));
    _legisUrlsEditor.customizadas = false;
    _legisUrlsEditor.dirty = false;
    renderLegisUrlsLista();
    $('legis-urls-aviso').textContent = 'Usando lista padrão hardcoded no Worker.';
    showInlineStatus(SID, '↻ Restaurado. Próxima execução usa as URLs padrão.', 'success', 6000);
  } catch (err) {
    showInlineStatus(SID, `❌ ${err.message}`, 'error');
  }
}

window.legisCarregarUrls = legisCarregarUrls;
window.legisUpdateUrl = legisUpdateUrl;
window.legisUpdateTemplatesAfetados = legisUpdateTemplatesAfetados;
window.legisAddUrl = legisAddUrl;
window.legisRemoverUrl = legisRemoverUrl;
window.legisSalvarUrls = legisSalvarUrls;
window.legisRestaurarUrls = legisRestaurarUrls;

function abrirHtmlGeradoContrato() {
  const html = $('contrato-wizard-badge').dataset.htmlSalvo;
  if (!html) { alert('HTML gerado não foi salvo neste contrato.'); return; }
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Contrato gerado</title><style>body{font-family:Georgia,serif;font-size:12pt;padding:30px;max-width:800px;margin:0 auto;color:#000;}h1,h3{color:#333;}</style></head><body>${html}</body></html>`);
    win.document.close();
  } else {
    alert('Não foi possível abrir nova janela. Verifique bloqueio de pop-up.');
  }
}

// =============================================================================
// EDITOR DE TEMPLATES (CUSTOMIZAÇÃO POR TENANT) + VERSIONAMENTO
// =============================================================================
// Override armazenado em tenants/{id}/templatesContrato/{templateKey}.
// templateKey ∈ { 'locacao', 'venda', 'distrato' }.
// Quando o wizard ou o gerador de distrato precisam do template,
// chamam obterTemplate(key) — busca override primeiro, fallback para inline.
// =============================================================================

let _tplEditor = { tabAtual: 'locacao', customizado: false, dirty: false };

const TPL_PLACEHOLDERS = {
  locacao: [
    { ph: '{{locador.nome}}', d: 'Nome do locador' },
    { ph: '{{locador.documento_fmt}}', d: 'CPF/CNPJ formatado' },
    { ph: '{{locador.endereco_completo}}', d: 'Endereço completo do locador' },
    { ph: '{{locatario.nome}}', d: 'Nome do locatário' },
    { ph: '{{locatario.documento_fmt}}', d: 'CPF/CNPJ formatado' },
    { ph: '{{imovel.endereco_completo}}', d: 'Endereço do imóvel' },
    { ph: '{{imovel.matricula}}', d: 'Matrícula do registro' },
    { ph: '{{imovel.iptu}}', d: 'Inscrição IPTU' },
    { ph: '{{prazo_meses}}', d: 'Prazo em meses' },
    { ph: '{{inicio_br}} / {{fim_br}}', d: 'Datas formato BR' },
    { ph: '{{aluguel_fmt}}', d: 'Aluguel em R$' },
    { ph: '{{dia_vencimento}}', d: 'Dia de vencimento' },
    { ph: '{{reajuste_indice}} / {{reajuste_periodicidade}}', d: 'Reajuste' },
    { ph: '{{multa_atraso}}, {{juros_atraso}}, {{honorarios_advocaticios}}', d: 'Multa, juros, honorários (%)' },
    { ph: '{{multa_rescisoria_meses}}', d: 'Multa rescisória em meses' },
    { ph: '{{garantia.identificacao}}, {{garantia.clausula_detalhada}}', d: 'Dados da garantia (se houver)' },
    { ph: '{{foro}}, {{cidade}}, {{data_hoje_extenso}}', d: 'Foro, cidade, data por extenso' },
    { ph: '{{#if garantia}}...{{/if}}', d: 'Condicional — só mostra se há garantia' },
    { ph: '{{#if clausulas_extras}}...{{/if}}', d: 'Condicional — cláusulas extras opcionais' },
  ],
  venda: [
    { ph: '{{vendedor.nome}}, {{vendedor.documento_fmt}}', d: 'Vendedor' },
    { ph: '{{comprador.nome}}, {{comprador.documento_fmt}}', d: 'Comprador' },
    { ph: '{{imovel.endereco_completo}}, {{imovel.matricula}}, {{imovel.iptu}}', d: 'Imóvel' },
    { ph: '{{valor_total_fmt}}, {{valor_entrada_fmt}}, {{saldo_fmt}}', d: 'Valores' },
    { ph: '{{forma_pagamento_label}}', d: 'Forma de pagamento por extenso' },
    { ph: '{{banco_financiamento}}, {{prazo_quitacao}}', d: 'Financiamento (se houver)' },
    { ph: '{{data_pagamento_entrada_br}}, {{data_posse_br}}', d: 'Datas' },
    { ph: '{{multa_inadimplencia}}, {{percentual_comissao}}', d: 'Percentuais' },
    { ph: '{{responsavel_comissao_label}}', d: 'Quem paga a comissão' },
    { ph: '{{foro}}, {{cidade}}, {{data_hoje_extenso}}', d: 'Foro, cidade, data' },
    { ph: '{{#if tem_entrada}} / {{tem_financiamento}} / {{tem_comissao}}', d: 'Condicionais' },
  ],
  distrato: [
    { ph: '{{contrato.numero}}, {{contrato.inicio_br}}', d: 'Contrato original' },
    { ph: '{{locador.nome}}, {{locador.documento_fmt}}', d: 'Locador' },
    { ph: '{{locatario.nome}}, {{locatario.documento_fmt}}', d: 'Locatário' },
    { ph: '{{imovel.endereco_completo}}', d: 'Imóvel' },
    { ph: '{{data_efetiva_br}}, {{data_entrega_chaves_br}}', d: 'Datas' },
    { ph: '{{motivo_label}}', d: 'Motivo do distrato' },
    { ph: '{{multa_fmt}}, {{pendencias_fmt}}', d: 'Valores' },
    { ph: '{{#if multa}}...{{/if}} / {{#if pendencias}}...{{/if}}', d: 'Condicionais' },
    { ph: '{{cidade}}, {{data_hoje_extenso}}', d: 'Cidade e data' },
  ],
};

const TPL_DEFAULTS = {
  get locacao()  { return ELAB_TEMPLATES.locacao.template; },
  get venda()    { return ELAB_TEMPLATES.venda.template; },
  get distrato() { return DISTRATO_TEMPLATE; },
};

// Cache do override do tenant atual
let _tplOverridesCache = null;

async function carregarOverridesTemplates() {
  if (!State.tenant) return {};
  try {
    const snap = await tenantPath().collection('templatesContrato').get();
    const out = {};
    snap.docs.forEach(d => { out[d.id] = d.data(); });
    _tplOverridesCache = out;
    return out;
  } catch (err) {
    console.warn('Falha ao carregar overrides de template:', err);
    return {};
  }
}

async function obterTemplate(templateKey) {
  if (_tplOverridesCache && _tplOverridesCache[templateKey]?.template) {
    return _tplOverridesCache[templateKey].template;
  }
  if (_tplOverridesCache === null) {
    await carregarOverridesTemplates();
    if (_tplOverridesCache[templateKey]?.template) return _tplOverridesCache[templateKey].template;
  }
  return TPL_DEFAULTS[templateKey] || '';
}

// =============================================================
// EDITOR DE PERGUNTAS DO WIZARD (Fase F item 4)
// =============================================================
// Override em tenants/{id}/elabPerguntas/{modalidade}.
// Cliente pode mudar: label, default, obrigatorio, opcoes (se select).
// NÃO pode mudar: id, tipo, colecao, condicao (mexem na lógica do template).

let _perguntasOverridesCache = null;

async function carregarOverridesPerguntas() {
  if (!State.tenant) return {};
  try {
    const snap = await tenantPath().collection('elabPerguntas').get();
    const out = {};
    snap.docs.forEach(d => { out[d.id] = d.data(); });
    _perguntasOverridesCache = out;
    return out;
  } catch (err) {
    console.warn('Falha ao carregar overrides de perguntas:', err);
    return {};
  }
}

// Editor de perguntas — estado da UI
let _pergEditor = { tab: 'locacao', dirty: false, customizado: false, perguntas: [] };

async function carregarPergEditor() {
  await carregarOverridesPerguntas();
  await trocarTabPerguntas(_pergEditor.tab || 'locacao');
}

async function trocarTabPerguntas(tab) {
  if (_pergEditor.dirty) {
    if (!confirm('Há alterações não salvas. Trocar de aba mesmo assim?')) return;
  }
  _pergEditor.tab = tab;
  _pergEditor.dirty = false;
  document.querySelectorAll('#section-configuracoes .tab-btn[data-tab-perg]').forEach(b => {
    b.classList.toggle('active', b.dataset.tabPerg === tab);
  });
  const perguntas = await getElabPerguntasMescladas(tab);
  _pergEditor.perguntas = JSON.parse(JSON.stringify(perguntas)); // deep clone
  _pergEditor.customizado = !!(_perguntasOverridesCache && _perguntasOverridesCache[tab]?.perguntas?.length);
  renderPergEditor();
}

function renderPergEditor() {
  const lista = $('perg-editor-lista');
  const aviso = $('perg-aviso');
  if (!lista) return;
  aviso.style.display = _pergEditor.customizado ? 'block' : 'none';

  lista.innerHTML = _pergEditor.perguntas.map((p, idx) => {
    const tipoLabel = {
      text: 'Texto', textarea: 'Texto longo', number: 'Número',
      money: 'Valor (R$)', date: 'Data', select: 'Lista',
      select_entidade: 'Cadastro (' + (p.colecao || '') + ')',
      yesno: 'Sim/Não',
    }[p.tipo] || p.tipo;

    let opcoesHtml = '';
    if (p.tipo === 'select' && Array.isArray(p.opcoes)) {
      opcoesHtml = `
        <div class="form-group" style="margin-top:6px;">
          <label style="font-size:11px;">Opções (uma por linha — formato <code>valor | rótulo</code>)</label>
          <textarea rows="${Math.max(2, p.opcoes.length)}"
            oninput="pergUpdateOpcoes(${idx}, this.value)"
            style="font-family:Consolas,Monaco,monospace; font-size:11px;"
          >${p.opcoes.map(o => (o.v || '') + ' | ' + (o.l || '')).join('\n')}</textarea>
        </div>`;
    }

    let defaultHtml = '';
    if (p.tipo === 'text' || p.tipo === 'textarea') {
      defaultHtml = `<input type="text" value="${escapeHtml(p.default || '')}" oninput="pergUpdate(${idx}, 'default', this.value)">`;
    } else if (p.tipo === 'number' || p.tipo === 'money') {
      defaultHtml = `<input type="number" step="any" value="${p.default ?? ''}" oninput="pergUpdate(${idx}, 'default', this.value)">`;
    } else if (p.tipo === 'date') {
      defaultHtml = `<input type="date" value="${p.default || ''}" oninput="pergUpdate(${idx}, 'default', this.value)">`;
    } else if (p.tipo === 'yesno') {
      defaultHtml = `<select onchange="pergUpdate(${idx}, 'default', this.value)">
        <option value="">— sem padrão —</option>
        <option value="sim" ${p.default === 'sim' ? 'selected' : ''}>Sim</option>
        <option value="nao" ${p.default === 'nao' ? 'selected' : ''}>Não</option>
      </select>`;
    } else if (p.tipo === 'select') {
      defaultHtml = `<input type="text" value="${escapeHtml(p.default || '')}" oninput="pergUpdate(${idx}, 'default', this.value)" placeholder="Ex: IPCA">`;
    } else {
      defaultHtml = '<span class="muted" style="font-size:11px;">— sem padrão pra este tipo —</span>';
    }

    return `
      <div class="card" style="margin-bottom:12px; padding:14px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">
          <div>
            <strong style="font-size:13px;">#${idx + 1} · <code style="font-size:11px;">${p.id}</code></strong>
            <span class="muted" style="font-size:11px; margin-left:6px;">Tipo: ${tipoLabel}</span>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:6px;">
          <label style="font-size:11px;">Rótulo (texto que aparece no wizard)</label>
          <input type="text" value="${escapeHtml(p.label || '')}" oninput="pergUpdate(${idx}, 'label', this.value)">
        </div>
        <div class="form-row" style="margin-bottom:0;">
          <div class="form-group" style="margin-bottom:0;">
            <label style="font-size:11px;">Valor padrão</label>
            ${defaultHtml}
          </div>
          <div class="form-group" style="margin-bottom:0; align-self:end;">
            <label class="toggle-row" style="font-size:12px;">
              <input type="checkbox" ${p.obrigatorio ? 'checked' : ''} onchange="pergUpdate(${idx}, 'obrigatorio', this.checked)">
              <span>Obrigatória</span>
            </label>
          </div>
        </div>
        ${opcoesHtml}
      </div>
    `;
  }).join('');
}

function pergUpdate(idx, campo, valor) {
  if (!_pergEditor.perguntas[idx]) return;
  _pergEditor.perguntas[idx][campo] = valor;
  _pergEditor.dirty = true;
  $('perg-status').textContent = '✏️ Alterações não salvas';
  $('perg-status').style.color = '#92400e';
}

function pergUpdateOpcoes(idx, raw) {
  if (!_pergEditor.perguntas[idx]) return;
  const opcoes = raw.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const [v, ...resto] = l.split('|').map(s => s.trim());
      return { v, l: resto.join(' | ') || v };
    });
  _pergEditor.perguntas[idx].opcoes = opcoes;
  _pergEditor.dirty = true;
  $('perg-status').textContent = '✏️ Alterações não salvas';
  $('perg-status').style.color = '#92400e';
}

async function pergSalvar() {
  if (!State.tenant) return;
  // Salva só os campos que diferem do padrão (pra economizar)
  const tplOriginal = ELAB_TEMPLATES[_pergEditor.tab].perguntas;
  const overrides = [];
  _pergEditor.perguntas.forEach(p => {
    const orig = tplOriginal.find(o => o.id === p.id);
    if (!orig) return;
    const diff = { id: p.id };
    let alterou = false;
    if (p.label !== orig.label) { diff.label = p.label; alterou = true; }
    if ((p.default ?? '') !== (orig.default ?? '')) { diff.default = p.default; alterou = true; }
    if (!!p.obrigatorio !== !!orig.obrigatorio) { diff.obrigatorio = !!p.obrigatorio; alterou = true; }
    if (p.tipo === 'select' && JSON.stringify(p.opcoes || []) !== JSON.stringify(orig.opcoes || [])) {
      diff.opcoes = p.opcoes; alterou = true;
    }
    if (alterou) overrides.push(diff);
  });

  try {
    if (overrides.length === 0) {
      // Sem diffs → apaga o doc (volta ao padrão)
      await tenantPath().collection('elabPerguntas').doc(_pergEditor.tab).delete().catch(() => {});
    } else {
      await tenantPath().collection('elabPerguntas').doc(_pergEditor.tab).set({
        perguntas: overrides,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        atualizadoPor: State.user.uid,
      });
    }
    logAuditoria('update', 'elabPerguntas', _pergEditor.tab, { count: overrides.length });
    _pergEditor.dirty = false;
    _pergEditor.customizado = overrides.length > 0;
    _perguntasOverridesCache = null; // força reload na próxima abertura do wizard
    showInlineStatus('perg-status', `✅ Customização salva (${overrides.length} pergunta(s) modificada(s)).`, 'success', 6000);
    $('perg-aviso').style.display = overrides.length > 0 ? 'block' : 'none';
  } catch (err) {
    console.error('Erro ao salvar perguntas:', err);
    showInlineStatus('perg-status', `❌ Erro ao salvar: ${err.message}`, 'error');
  }
}

async function pergRestaurarPadrao() {
  if (!confirm(`Restaurar perguntas padrão da modalidade "${_pergEditor.tab}"?\n\nTodas as customizações desta aba serão perdidas.`)) return;
  try {
    await tenantPath().collection('elabPerguntas').doc(_pergEditor.tab).delete().catch(() => {});
    _perguntasOverridesCache = null;
    logAuditoria('delete', 'elabPerguntas', _pergEditor.tab, {});
    await trocarTabPerguntas(_pergEditor.tab);
    showInlineStatus('perg-status', '↻ Perguntas restauradas ao padrão.', 'success', 5000);
  } catch (err) {
    showInlineStatus('perg-status', `❌ Erro: ${err.message}`, 'error');
  }
}

window.trocarTabPerguntas = trocarTabPerguntas;
window.pergUpdate = pergUpdate;
window.pergUpdateOpcoes = pergUpdateOpcoes;
window.pergSalvar = pergSalvar;
window.pergRestaurarPadrao = pergRestaurarPadrao;

// Retorna perguntas (de ELAB_TEMPLATES) com overrides aplicados (mesclados por id).
async function getElabPerguntasMescladas(modalidade) {
  const tpl = ELAB_TEMPLATES[modalidade];
  if (!tpl) return [];
  if (_perguntasOverridesCache === null) {
    await carregarOverridesPerguntas();
  }
  const override = _perguntasOverridesCache?.[modalidade];
  const overrideById = {};
  (override?.perguntas || []).forEach(p => { if (p.id) overrideById[p.id] = p; });
  return tpl.perguntas.map(p => {
    const ov = overrideById[p.id];
    if (!ov) return p;
    // Mescla campos seguros (não permite mudar id, tipo, colecao, condicao)
    return {
      ...p,
      label: ov.label !== undefined ? ov.label : p.label,
      default: ov.default !== undefined ? ov.default : p.default,
      obrigatorio: ov.obrigatorio !== undefined ? !!ov.obrigatorio : p.obrigatorio,
      opcoes: Array.isArray(ov.opcoes) && ov.opcoes.length > 0 ? ov.opcoes : p.opcoes,
    };
  });
}

async function carregarTplEditor() {
  await carregarOverridesTemplates();
  await trocarTabTpl(_tplEditor.tabAtual || 'locacao');
}

async function trocarTabTpl(tab) {
  _tplEditor.tabAtual = tab;
  document.querySelectorAll('#section-configuracoes .tab-btn[data-tab]').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  const override = _tplOverridesCache && _tplOverridesCache[tab];
  _tplEditor.customizado = !!(override && override.template);
  _tplEditor.dirty = false;

  const editor = $('tpl-editor');
  if (editor) editor.value = _tplEditor.customizado ? override.template : (TPL_DEFAULTS[tab] || '');

  const aviso = $('tpl-aviso');
  if (aviso) aviso.style.display = _tplEditor.customizado ? 'block' : 'none';

  const status = $('tpl-status');
  if (status) {
    status.textContent = _tplEditor.customizado
      ? `Customizado em ${override.atualizadoEm?.toDate ? fmtDataBR(override.atualizadoEm.toDate().toISOString().slice(0, 10)) : '—'}`
      : 'Usando template padrão do sistema.';
  }

  const placeholdersDiv = $('tpl-placeholders');
  if (placeholdersDiv) {
    placeholdersDiv.innerHTML = (TPL_PLACEHOLDERS[tab] || []).map(p =>
      `<div style="margin-bottom:4px;"><code>${escapeHtml(p.ph)}</code> — <span class="muted">${escapeHtml(p.d)}</span></div>`
    ).join('');
  }
}

function onTplEditorInput() {
  _tplEditor.dirty = true;
  const status = $('tpl-status');
  if (status) status.textContent = '✏️ Alterações não salvas — clique em "Salvar customização".';
}

async function tplSalvar() {
  if (!State.tenant) { alert('Selecione um tenant antes.'); return; }
  const tab = _tplEditor.tabAtual;
  const conteudo = $('tpl-editor').value;
  if (!conteudo.trim()) { alert('O conteúdo do template não pode ficar vazio.'); return; }

  try {
    await tenantPath().collection('templatesContrato').doc(tab).set({
      template: conteudo,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      atualizadoPor: State.user.uid,
    }, { merge: true });
    _tplOverridesCache = null; // força recarga na próxima leitura
    await carregarOverridesTemplates();
    _tplEditor.customizado = true;
    _tplEditor.dirty = false;
    logAuditoria('update', 'template_contrato', tab, { tamanho: conteudo.length });
    showAlert('cfg-alert', `✓ Template de ${tab} salvo.`, 'success');
    $('tpl-aviso').style.display = 'block';
    $('tpl-status').textContent = 'Customização salva.';
  } catch (err) {
    console.error('Erro ao salvar template:', err);
    showAlert('cfg-alert', 'Erro ao salvar template: ' + err.message);
  }
}

async function tplRestaurarPadrao() {
  if (!confirm('Restaurar o template padrão? A customização atual será apagada.')) return;
  if (!State.tenant) { alert('Selecione um tenant antes.'); return; }
  const tab = _tplEditor.tabAtual;
  try {
    await tenantPath().collection('templatesContrato').doc(tab).delete();
    _tplOverridesCache = null;
    await carregarOverridesTemplates();
    await trocarTabTpl(tab);
    logAuditoria('delete', 'template_contrato', tab, { motivo: 'restaurar_padrao' });
    showAlert('cfg-alert', `✓ Template de ${tab} restaurado ao padrão.`, 'success');
  } catch (err) {
    console.error('Erro ao restaurar template:', err);
    showAlert('cfg-alert', 'Erro: ' + err.message);
  }
}

function tplPreview() {
  const conteudo = $('tpl-editor').value;
  if (!conteudo.trim()) { alert('Edite o template antes de visualizar.'); return; }
  // Renderiza com dados de exemplo
  const dadosExemplo = {
    locador: { nome: 'João da Silva', documento_fmt: '123.456.789-00', endereco_completo: 'Rua Exemplo, 100, São Paulo/SP', nacionalidade_or: 'brasileiro', estadoCivil_or: 'casado', profissao_or: 'engenheiro', rg_or: '12.345.678' },
    locatario: { nome: 'Maria Souza', documento_fmt: '987.654.321-00', endereco_completo: 'Av. Modelo, 200, São Paulo/SP', nacionalidade_or: 'brasileira', estadoCivil_or: 'solteira', profissao_or: 'médica', rg_or: '98.765.432' },
    vendedor: { nome: 'João da Silva', documento_fmt: '123.456.789-00', endereco_completo: 'Rua Exemplo, 100', nacionalidade_or: 'brasileiro', estadoCivil_or: 'casado', profissao_or: 'engenheiro' },
    comprador: { nome: 'Maria Souza', documento_fmt: '987.654.321-00', endereco_completo: 'Av. Modelo, 200', nacionalidade_or: 'brasileira', estadoCivil_or: 'solteira', profissao_or: 'médica' },
    imovel: { endereco_completo: 'Rua das Flores, 123 — Vila Mariana, São Paulo/SP', apelido: 'Apto 302', matricula: '12345', iptu: '67890' },
    contrato: { numero: '00007', inicio_br: '01/06/2026' },
    finalidade: 'residencial', finalidade_upper: 'RESIDENCIAL',
    prazo_meses: 30, inicio_br: '01/06/2026', fim_br: '30/11/2028',
    aluguel_fmt: 'R$ 2.500,00', dia_vencimento: 5,
    reajuste_indice: 'IPCA', reajuste_periodicidade: 'anual',
    multa_atraso: 10, juros_atraso: 1, honorarios_advocaticios: 20,
    multa_rescisoria_meses: 3,
    valor_total_fmt: 'R$ 450.000,00', valor_entrada_fmt: 'R$ 100.000,00', saldo_fmt: 'R$ 350.000,00',
    forma_pagamento_label: 'financiamento', banco_financiamento: 'Caixa Econômica', prazo_quitacao: '60 dias',
    data_pagamento_entrada_br: '15/06/2026', data_posse_br: '15/08/2026',
    multa_inadimplencia: 10, percentual_comissao: 6, responsavel_comissao_label: 'VENDEDOR',
    tem_entrada: true, tem_financiamento: true, tem_comissao: true,
    multa: true, multa_fmt: 'R$ 7.500,00', pendencias: false,
    data_efetiva_br: '30/06/2026', data_entrega_chaves_br: '01/07/2026',
    motivo_label: 'rescisão antecipada pelo LOCATÁRIO',
    n_clausula_finais: 11, n_clausula_extras: 12, n_clausula_pendencias: null, n_clausula_quitacao: 5, n_clausula_obs: null,
    foro: 'São Paulo', cidade: 'São Paulo', data_hoje_extenso: fmtDataExtenso(),
    tenant: { nome: State.tenant?.nome || 'Sua Imobiliária', creci_or: 'CRECI 0000' },
    garantia: { papel_upper: 'FIADOR', tipo_label: 'fiador', identificacao: 'Fiador João Souza (CPF 111.222.333-44)', identificacao_curta: 'João Souza', clausula_detalhada: 'O FIADOR responde solidariamente por todas as obrigações...' },
  };
  const html = elabRenderizarTemplate(conteudo, dadosExemplo);
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Preview do template</title><style>body{font-family:Georgia,serif;font-size:12pt;padding:30px;max-width:800px;margin:0 auto;color:#000;}h1,h3{color:#333;}</style></head><body><div style="padding:8px 12px; background:#fff8e1; border-left:3px solid #ffc107; margin-bottom:20px; font-size:11px;">⚠️ Preview com dados de exemplo. Os valores reais serão substituídos quando um contrato for elaborado pelo wizard.</div>${html}</body></html>`);
    win.document.close();
  } else {
    alert('Não foi possível abrir nova janela. Verifique bloqueio de pop-up.');
  }
}

// =============================================================================
// DETECÇÃO DE CONTRATOS ATRASADOS
// =============================================================================
// Regra: contrato com status='vigente' é considerado atrasado se:
// - Flag `inadimplente: true` no doc do contrato (override manual), OU
// - Não há balancete do mês anterior com lançamento de aluguel (entrada/aluguel).
// Usamos mês -1 como referência porque o mês atual pode ainda estar em curso
// (o aluguel pode ainda não ter sido lançado).
// =============================================================================

async function detectarContratosAtrasados() {
  if (!State.tenant) return [];

  const hoje = new Date();
  // Mês de referência = mês anterior ao atual
  let mesRef = hoje.getMonth(); // já é 0-based; getMonth+1 seria atual, então sem +1 = anterior
  let anoRef = hoje.getFullYear();
  if (mesRef === 0) { mesRef = 12; anoRef -= 1; } else { /* mesRef já está em 1-12 do anterior */ }

  const [contratosSnap, balancetesSnap, locatariosSnap, imoveisSnap] = await Promise.all([
    tenantPath().collection('contratos').where('status', '==', 'vigente').get(),
    tenantPath().collection('balancetes').where('mes', '==', mesRef).where('ano', '==', anoRef).get(),
    ensureLocatariosCache(),
    ensureImoveisCache(),
  ]);

  const locMap = Object.fromEntries((locatariosSnap || []).map(l => [l.id, l]));
  const imMap = Object.fromEntries((imoveisSnap || []).map(i => [i.id, i]));

  // Mapa contratoId → balancete com aluguel lançado
  const balanceteOk = new Set();
  balancetesSnap.docs.forEach(b => {
    const d = b.data();
    const temAluguel = (d.lancamentos || []).some(l => l.bloco === 'entrada' && l.categoria === 'aluguel');
    if (temAluguel && d.contratoId) balanceteOk.add(d.contratoId);
  });

  const atrasados = [];
  contratosSnap.docs.forEach(doc => {
    const c = doc.data();
    let motivo = null;
    if (c.inadimplente) motivo = 'Marcado manualmente como inadimplente';
    else if (!balanceteOk.has(doc.id)) motivo = `Sem aluguel lançado no balancete de ${String(mesRef).padStart(2, '0')}/${anoRef}`;
    if (motivo) {
      atrasados.push({
        id: doc.id,
        numero: c.numero || '—',
        contrato: c,
        locatario: locMap[c.locatarioId] || { nome: '(locatário apagado)' },
        imovel: imMap[c.imovelId] || { apelido: '(imóvel apagado)' },
        aluguel: c.aluguel || 0,
        motivo,
      });
    }
  });

  // Ordena por número do contrato
  atrasados.sort((a, b) => (a.numeroSequencial || 0) - (b.numeroSequencial || 0));
  return atrasados;
}

async function abrirContratosAtrasados() {
  if (!State.tenant) { alert('Selecione um tenant.'); return; }
  $('atrasados-loading').style.display = 'block';
  $('atrasados-vazio').style.display = 'none';
  $('atrasados-table-wrap').style.display = 'none';
  $('modal-atrasados').style.display = 'flex';

  try {
    const lista = await detectarContratosAtrasados();
    $('atrasados-loading').style.display = 'none';

    if (lista.length === 0) {
      $('atrasados-vazio').style.display = 'block';
      return;
    }

    const tbody = $('tbody-atrasados');
    tbody.innerHTML = lista.map(a => `
      <tr style="cursor:pointer;" onclick="abrirContratoAtrasado('${a.id}')">
        <td><strong>${a.numero}</strong></td>
        <td>${escapeHtml(a.locatario.nome || '—')}${a.locatario.documento ? `<br><span class="muted" style="font-size:11px;">${escapeHtml(formataCPFCNPJ(a.locatario.documento))}</span>` : ''}</td>
        <td>${escapeHtml(a.imovel.apelido || '—')}</td>
        <td>${fmtBRL(a.aluguel)}</td>
        <td><span style="font-size:12px;color:#b91c1c;">${escapeHtml(a.motivo)}</span></td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); abrirContratoAtrasado('${a.id}', true)">💰 Calcular cobrança</button>
        </td>
      </tr>
    `).join('');
    $('atrasados-table-wrap').style.display = 'block';
  } catch (err) {
    console.error('Erro ao listar atrasados:', err);
    $('atrasados-loading').style.display = 'none';
    $('tbody-atrasados').innerHTML = `<tr><td colspan="6" style="color:var(--danger); text-align:center;">Erro: ${err.message}</td></tr>`;
    $('atrasados-table-wrap').style.display = 'block';
  }
}

function fecharContratosAtrasados() {
  $('modal-atrasados').style.display = 'none';
}

async function abrirContratoAtrasado(contratoId, abrirCalculoDireto) {
  fecharContratosAtrasados();
  showSection('contratos');
  if (typeof openContratoModal === 'function') {
    await openContratoModal(contratoId);
    if (abrirCalculoDireto) {
      // Pequeno timeout pra garantir que o modal abriu
      setTimeout(() => abrirCobrancaDebito(), 200);
    }
  }
}

// =============================================================================
// CÁLCULO DE DÉBITO ATUALIZADO (correção + multa + juros + honorários)
// =============================================================================
// Busca índices no BCB (api.bcb.gov.br — CORS aberto, gratuito) e calcula
// componentes do débito. Operador pode editar manualmente cada linha.
// Cache em Firestore: tenants/{id}/indicesCache/{indice}-{ano-mes} pra evitar
// requests repetidos.
// =============================================================================

const BCB_SERIE = {
  IPCA: 433,
  INPC: 188,
  IGPM: 189,
  INCC: 192,
};

let _cobrancaContexto = null;

async function buscarIndiceBCB(indice, dataInicio, dataFim) {
  if (indice === 'nenhum') return { acumulado: 0, meses: [] };
  const codigo = BCB_SERIE[indice];
  if (!codigo) return { acumulado: 0, meses: [] };

  const fmt = (iso) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=${fmt(dataInicio)}&dataFinal=${fmt(dataFim)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`BCB retornou ${res.status}`);
    const dados = await res.json();
    // dados é array de {data: "01/05/2026", valor: "0.46"} — valor é o % do mês
    let fator = 1;
    const meses = [];
    for (const d of dados) {
      const v = parseFloat(d.valor) || 0;
      fator *= (1 + v / 100);
      meses.push({ data: d.data, valor: v });
    }
    const acumulado = (fator - 1) * 100;
    return { acumulado, meses };
  } catch (err) {
    console.warn('Falha ao buscar índice BCB:', err);
    return { acumulado: 0, meses: [], erro: err.message };
  }
}

async function abrirCobrancaDebito() {
  const contratoId = $('contrato-id').value;
  if (!contratoId) {
    showAlert('contrato-alert', 'Salve o contrato antes de calcular o débito.');
    return;
  }
  if (!State.tenant) { alert('Selecione um tenant antes.'); return; }

  try {
    const cSnap = await tenantPath().collection('contratos').doc(contratoId).get();
    if (!cSnap.exists) { showAlert('contrato-alert', 'Contrato não encontrado.'); return; }
    const c = cSnap.data();

    const [locadorSnap, locatarioSnap, imovelSnap] = await Promise.all([
      c.locadorId   ? tenantPath().collection('locadores').doc(c.locadorId).get()   : Promise.resolve(null),
      c.locatarioId ? tenantPath().collection('locatarios').doc(c.locatarioId).get() : Promise.resolve(null),
      c.imovelId    ? tenantPath().collection('imoveis').doc(c.imovelId).get()    : Promise.resolve(null),
    ]);

    _cobrancaContexto = {
      contratoId,
      contrato: c,
      locador: (locadorSnap && locadorSnap.exists) ? locadorSnap.data() : {},
      locatario: (locatarioSnap && locatarioSnap.exists) ? locatarioSnap.data() : {},
      imovel: (imovelSnap && imovelSnap.exists) ? imovelSnap.data() : {},
      ultimoCalculo: null,
    };

    // Pré-preenche com dados do contrato
    const hojeISO = new Date().toISOString().slice(0, 10);
    $('cobranca-valor-base').value = c.aluguel || '';
    $('cobranca-data-vencimento').value = '';
    $('cobranca-data-calculo').value = hojeISO;
    const indice = (c.reajusteIndice || 'ipca').toUpperCase();
    $('cobranca-indice').value = BCB_SERIE[indice] ? indice : 'IPCA';
    $('cobranca-multa-pct').value = c.multaAtrasoPct ?? '10';
    $('cobranca-juros-pct').value = c.jurosAtrasoPct ?? '1';
    $('cobranca-honor-pct').value = c.honorariosPct ?? '20';

    $('cobranca-resultado').style.display = 'none';
    $('btn-cobranca-pdf').style.display = 'none';
    $('btn-cobranca-word').style.display = 'none';
    $('btn-cobranca-envio-locador').style.display = 'none';
    $('btn-cobranca-envio-locatario').style.display = 'none';
    clearAlert('cobranca-alert');

    $('modal-cobranca').style.display = 'flex';
  } catch (err) {
    console.error('Erro ao abrir cálculo de débito:', err);
    showAlert('contrato-alert', 'Erro: ' + err.message);
  }
}

function fecharCobrancaDebito() {
  $('modal-cobranca').style.display = 'none';
  _cobrancaContexto = null;
}

async function cobrancaRecalcular() {
  clearAlert('cobranca-alert');
  const ctx = _cobrancaContexto;
  if (!ctx) return;

  const base = parseFloat($('cobranca-valor-base').value) || 0;
  const dataVenc = $('cobranca-data-vencimento').value;
  const dataCalc = $('cobranca-data-calculo').value || new Date().toISOString().slice(0, 10);
  const indice = $('cobranca-indice').value;
  const pctMulta = parseFloat($('cobranca-multa-pct').value) || 0;
  const pctJurosMes = parseFloat($('cobranca-juros-pct').value) || 0;
  const pctHonor = parseFloat($('cobranca-honor-pct').value) || 0;

  if (base <= 0) { return; }
  if (!dataVenc) { return; }
  if (new Date(dataCalc) <= new Date(dataVenc)) {
    showAlert('cobranca-alert', 'A data do cálculo deve ser posterior à data do vencimento.');
    return;
  }

  $('cobranca-loading').style.display = 'block';
  $('cobranca-resultado').style.display = 'none';

  // Busca índice acumulado
  const idxRes = await buscarIndiceBCB(indice, dataVenc, dataCalc);
  $('cobranca-loading').style.display = 'none';

  if (idxRes.erro) {
    showAlert('cobranca-alert', `Falha ao buscar índice no BCB: ${idxRes.erro}. Você pode editar os valores manualmente abaixo.`);
  }

  // Cálculo
  const correcao = base * (idxRes.acumulado / 100);
  const baseCorrigido = base + correcao;
  const multa = baseCorrigido * (pctMulta / 100);
  // Juros: pro rata por dia, baseado em % mensal
  const diasAtraso = Math.max(0, Math.floor((new Date(dataCalc) - new Date(dataVenc)) / (1000 * 60 * 60 * 24)));
  const jurosTotal = baseCorrigido * (pctJurosMes / 100) * (diasAtraso / 30);
  const subtotal = baseCorrigido + multa + jurosTotal;
  const honor = subtotal * (pctHonor / 100);
  const total = subtotal + honor;

  // Preenche resultado
  $('cobranca-base-edit').value = base.toFixed(2);
  $('cobranca-corr-edit').value = correcao.toFixed(2);
  $('cobranca-multa-edit').value = multa.toFixed(2);
  $('cobranca-juros-edit').value = jurosTotal.toFixed(2);
  $('cobranca-honor-edit').value = honor.toFixed(2);
  $('cobranca-corr-info').textContent = indice === 'nenhum' ? '(sem correção)' : `(${indice} ${idxRes.acumulado.toFixed(4)}%)`;
  $('cobranca-multa-info').textContent = `(${pctMulta}% sobre R$ ${baseCorrigido.toFixed(2)})`;
  $('cobranca-juros-info').textContent = `(${pctJurosMes}% a.m. × ${diasAtraso} dias)`;
  $('cobranca-honor-info').textContent = `(${pctHonor}% sobre R$ ${subtotal.toFixed(2)})`;

  ctx.ultimoCalculo = {
    base, dataVenc, dataCalc, indice, pctMulta, pctJurosMes, pctHonor,
    diasAtraso, indiceAcumulado: idxRes.acumulado,
    componentes: { base, correcao, multa, juros: jurosTotal, honor },
    total,
  };

  $('cobranca-total').textContent = fmtBRL(total);
  $('cobranca-resultado').style.display = 'block';
  $('btn-cobranca-pdf').style.display = 'inline-block';
  $('btn-cobranca-word').style.display = 'inline-block';
  $('btn-cobranca-envio-locador').style.display = 'inline-block';
  $('btn-cobranca-envio-locatario').style.display = 'inline-block';
}

// Recalcular do zero quando a base muda (refaz tudo do início)
function cobrancaRecalcularDoZero() {
  const novaBase = parseFloat($('cobranca-base-edit').value) || 0;
  $('cobranca-valor-base').value = novaBase;
  cobrancaRecalcular();
}

// Quando edita só componentes individuais, só refaz o total (não chama BCB de novo)
function cobrancaTotalSomente() {
  const base = parseFloat($('cobranca-base-edit').value) || 0;
  const corr = parseFloat($('cobranca-corr-edit').value) || 0;
  const multa = parseFloat($('cobranca-multa-edit').value) || 0;
  const juros = parseFloat($('cobranca-juros-edit').value) || 0;
  const honor = parseFloat($('cobranca-honor-edit').value) || 0;
  const total = base + corr + multa + juros + honor;
  if (_cobrancaContexto?.ultimoCalculo) {
    _cobrancaContexto.ultimoCalculo.componentes = { base, correcao: corr, multa, juros, honor };
    _cobrancaContexto.ultimoCalculo.total = total;
  }
  $('cobranca-total').textContent = fmtBRL(total);
}

function cobrancaGerarHtml(ehLocatario) {
  const ctx = _cobrancaContexto;
  if (!ctx || !ctx.ultimoCalculo) return '';
  const ulc = ctx.ultimoCalculo;
  const tenant = State.tenant || {};
  const c = ctx.contrato;
  const cn = ulc.componentes;

  const cabecalhoPartes = ehLocatario
    ? `<tr><td style="padding:3px 0;color:#666;width:140px;">Locatário:</td><td style="padding:3px 0;">${escapeHtml(ctx.locatario.nome || '—')}</td></tr>
       <tr><td style="padding:3px 0;color:#666;">CPF/CNPJ:</td><td style="padding:3px 0;">${ctx.locatario.documento ? escapeHtml(formataCPFCNPJ(ctx.locatario.documento)) : '—'}</td></tr>
       <tr><td style="padding:3px 0;color:#666;">Imóvel:</td><td style="padding:3px 0;">${escapeHtml(ctx.imovel.apelido || '—')}</td></tr>
       <tr><td style="padding:3px 0;color:#666;">Endereço:</td><td style="padding:3px 0;">${escapeHtml(formatEnderecoCompleto(ctx.imovel.endereco))}</td></tr>
       <tr><td style="padding:3px 0;color:#666;">Contrato:</td><td style="padding:3px 0;">nº ${c.numero || '—'}</td></tr>`
    : `<tr><td style="padding:3px 0;color:#666;width:140px;">Locador:</td><td style="padding:3px 0;">${escapeHtml(ctx.locador.nome || '—')}</td></tr>
       <tr><td style="padding:3px 0;color:#666;">Locatário:</td><td style="padding:3px 0;">${escapeHtml(ctx.locatario.nome || '—')}</td></tr>
       <tr><td style="padding:3px 0;color:#666;">Imóvel:</td><td style="padding:3px 0;">${escapeHtml(ctx.imovel.apelido || '—')}</td></tr>
       <tr><td style="padding:3px 0;color:#666;">Endereço:</td><td style="padding:3px 0;">${escapeHtml(formatEnderecoCompleto(ctx.imovel.endereco))}</td></tr>
       <tr><td style="padding:3px 0;color:#666;">Contrato:</td><td style="padding:3px 0;">nº ${c.numero || '—'}</td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Cobrança</title></head>
<body style="margin:0; padding:0; font-family:Arial,Helvetica,sans-serif; color:#111;">
<div style="max-width:680px; margin:0 auto; padding:30px;">
  <div style="text-align:center; border-bottom:2px solid #b91c1c; padding-bottom:14px; margin-bottom:20px;">
    <h1 style="margin:0; color:#b91c1c; font-size:22px;">NOTIFICAÇÃO DE COBRANÇA</h1>
    <p style="margin:6px 0 0; color:#666; font-size:13px;">Débito vencido — atualizado em ${fmtDataBR(ulc.dataCalc)}</p>
    <p style="margin:8px 0 0; font-weight:bold; color:#333;">${escapeHtml(tenant.nome || 'DRG-Rently')}</p>
  </div>

  <table style="width:100%; border-collapse:collapse; margin-bottom:12px; font-size:13px;">
    ${cabecalhoPartes}
  </table>

  <p style="font-size:14px; margin:18px 0 6px;">
    ${ehLocatario
      ? `Prezado(a) <strong>${escapeHtml(ctx.locatario.nome || '')}</strong>, conforme contrato de locação acima identificado, consta em nossos registros o seguinte débito vencido. Solicitamos a regularização o quanto antes para evitar acréscimos adicionais.`
      : `Prezado(a) <strong>${escapeHtml(ctx.locador.nome || '')}</strong>, segue demonstrativo do débito do locatário no contrato acima identificado, com correção monetária, multa, juros e honorários conforme cláusulas contratuais.`}
  </p>

  <table style="width:100%; border-collapse:collapse; margin:18px 0; font-size:14px; border:1px solid #ddd;">
    <tr style="background:#fafafa;"><td style="padding:8px 12px;">Valor base devido</td><td style="padding:8px 12px; text-align:right;">${fmtBRL(cn.base)}</td></tr>
    <tr><td style="padding:8px 12px;">(+) Correção monetária ${ulc.indice === 'nenhum' ? '' : `(${ulc.indice} ${ulc.indiceAcumulado.toFixed(4)}%)`}</td><td style="padding:8px 12px; text-align:right;">${fmtBRL(cn.correcao)}</td></tr>
    <tr style="background:#fafafa;"><td style="padding:8px 12px;">(+) Multa (${ulc.pctMulta}%)</td><td style="padding:8px 12px; text-align:right;">${fmtBRL(cn.multa)}</td></tr>
    <tr><td style="padding:8px 12px;">(+) Juros mora (${ulc.pctJurosMes}% a.m. × ${ulc.diasAtraso} dias)</td><td style="padding:8px 12px; text-align:right;">${fmtBRL(cn.juros)}</td></tr>
    <tr style="background:#fafafa;"><td style="padding:8px 12px;">(+) Honorários (${ulc.pctHonor}%)</td><td style="padding:8px 12px; text-align:right;">${fmtBRL(cn.honor)}</td></tr>
    <tr style="border-top:3px solid #b91c1c; background:#fff5f5;"><td style="padding:14px 12px; font-size:16px; font-weight:bold;">TOTAL A PAGAR ATÉ ${fmtDataBR(ulc.dataCalc)}</td><td style="padding:14px 12px; text-align:right; font-size:20px; font-weight:bold; color:#b91c1c;">${fmtBRL(ulc.total)}</td></tr>
  </table>

  <p style="font-size:12px; color:#666;">
    Vencimento original: <strong>${fmtDataBR(ulc.dataVenc)}</strong> · Dias em atraso: <strong>${ulc.diasAtraso}</strong>${ulc.indice !== 'nenhum' ? ` · Índice: ${ulc.indice}` : ''}
  </p>

  <p style="font-size:12px; color:#666; margin-top:14px;">
    Os valores acima são atualizados diariamente. Em caso de pagamento em data
    diferente da informada, novos cálculos serão realizados.
  </p>

  <p style="margin-top:30px; font-size:11px; color:#888; text-align:center; border-top:1px solid #ddd; padding-top:14px;">
    Emitido por ${escapeHtml(tenant.nome || 'DRG-Rently')}${tenant.cnpj ? ' · CNPJ ' + escapeHtml(maskCNPJ(tenant.cnpj)) : ''}${tenant.creci ? ' · CRECI ' + escapeHtml(tenant.creci) : ''}
  </p>
</div>
</body></html>`;
}

async function cobrancaBaixarPDF() {
  if (!_cobrancaContexto?.ultimoCalculo) return;
  if (!window.html2pdf) {
    showAlert('cobranca-alert', 'Biblioteca html2pdf não carregou. Recarregue a página.');
    return;
  }
  const html = cobrancaGerarHtml(false);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const filename = `Cobranca_contrato_${_cobrancaContexto.contrato.numero || _cobrancaContexto.contratoId}_${Date.now()}.pdf`;
  await html2pdf().set({
    margin: 0,
    filename,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  }).from(wrapper).save();
}

function cobrancaBaixarWord() {
  if (!_cobrancaContexto?.ultimoCalculo) return;
  const html = cobrancaGerarHtml(false);
  const filename = `Cobranca_contrato_${_cobrancaContexto.contrato.numero || _cobrancaContexto.contratoId}_${Date.now()}.doc`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function cobrancaEnviar(destinatario) {
  if (!_cobrancaContexto?.ultimoCalculo) return;
  const ctx = _cobrancaContexto;

  const cfgSnap = await tenantPath().collection('config').doc('site').get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  if (!cfg.workerUrl) {
    showAlert('cobranca-alert', 'Configure a URL do Worker (Resend) em Configurações.');
    return;
  }

  const ehLocatario = destinatario === 'locatario';
  const dest = ehLocatario ? ctx.locatario : ctx.locador;
  if (!dest.email) {
    showAlert('cobranca-alert', `O ${ehLocatario ? 'locatário' : 'locador'} não tem e-mail cadastrado.`);
    return;
  }

  const html = cobrancaGerarHtml(ehLocatario);
  const subject = ehLocatario
    ? `Cobrança de aluguel em atraso — Contrato nº ${ctx.contrato.numero || ''}`
    : `Demonstrativo de cobrança do locatário — Contrato nº ${ctx.contrato.numero || ''}`;

  try {
    const res = await fetch(cfg.workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: cfg.emailFrom || 'onboarding@resend.dev',
        fromName: State.tenant.nome || 'DRG-Rently',
        to: dest.email,
        replyTo: cfg.emailFrom && cfg.emailFrom !== 'onboarding@resend.dev' ? cfg.emailFrom : undefined,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      let errMsg = `Erro ${res.status}`;
      try { const j = await res.json(); if (j.error) errMsg = j.error; } catch (_) {}
      throw new Error(errMsg);
    }
    logAuditoria('send_email', 'cobranca', ctx.contratoId, {
      to: dest.email, destinatario, total: ctx.ultimoCalculo.total,
    });
    showAlert('cobranca-alert', `✓ Notificação enviada para ${dest.email}`, 'success');
  } catch (err) {
    console.error('Erro ao enviar cobrança:', err);
    showAlert('cobranca-alert', 'Falha ao enviar: ' + err.message);
  }
}

// =============================================================================
// DISTRATO (encerramento antecipado/natural de contrato de locação)
// =============================================================================

const DISTRATO_MOTIVO_LABEL = {
  termino_natural: 'término natural do prazo contratual',
  rescisao_locatario: 'rescisão antecipada pelo LOCATÁRIO',
  rescisao_locador: 'rescisão antecipada pelo LOCADOR',
  acordo_mutuo: 'acordo mútuo entre as partes',
  inadimplencia: 'inadimplência reiterada do LOCATÁRIO',
  outro: 'motivo declarado pelas partes',
};

const DISTRATO_TEMPLATE = `${ELAB_AVISO_REVISAO}
<h1 style="text-align:center;">TERMO DE DISTRATO DE CONTRATO DE LOCAÇÃO</h1>

<p>Pelo presente Termo de Distrato, as partes abaixo qualificadas, já identificadas no <strong>Contrato de Locação nº {{contrato.numero}}</strong>, datado de {{contrato.inicio_br}}, têm entre si justo e contratado o seguinte:</p>

<p><strong>LOCADOR:</strong> {{locador.nome}}, CPF/CNPJ nº {{locador.documento_fmt}}.</p>
<p><strong>LOCATÁRIO:</strong> {{locatario.nome}}, CPF/CNPJ nº {{locatario.documento_fmt}}.</p>

<h3>CLÁUSULA 1ª — DO OBJETO</h3>
<p>As partes resolvem, por este instrumento, encerrar o contrato de locação celebrado entre si, referente ao imóvel situado em <strong>{{imovel.endereco_completo}}</strong>, com efeitos a partir de <strong>{{data_efetiva_br}}</strong>.</p>

<h3>CLÁUSULA 2ª — DO MOTIVO</h3>
<p>O encerramento decorre de {{motivo_label}}.</p>

<h3>CLÁUSULA 3ª — DA ENTREGA DO IMÓVEL</h3>
<p>O LOCATÁRIO entrega ao LOCADOR a posse do imóvel objeto da locação na data de <strong>{{data_entrega_chaves_br}}</strong>, declarando o LOCADOR tê-lo recebido nas condições verificadas em vistoria final.</p>

{{#if multa}}<h3>CLÁUSULA 4ª — DA MULTA RESCISÓRIA</h3>
<p>Em razão da rescisão antecipada, foi aplicada a multa proporcional, prevista no contrato original e no art. 4º da Lei 8.245/91, no valor de <strong>{{multa_fmt}}</strong>, valor este que o LOCATÁRIO se compromete a pagar.</p>{{/if}}

{{#if pendencias}}<h3>CLÁUSULA {{n_clausula_pendencias}}ª — DAS PENDÊNCIAS</h3>
<p>O LOCATÁRIO reconhece a existência de pendências financeiras no valor total de <strong>{{pendencias_fmt}}</strong>, comprometendo-se a quitá-las até a data de entrega das chaves.</p>{{/if}}

<h3>CLÁUSULA {{n_clausula_quitacao}}ª — DA QUITAÇÃO</h3>
<p>{{#if quitacao_total}}Cumpridas todas as obrigações deste distrato, as partes se outorgam mútua, plena, geral, rasa e irrevogável quitação de todas as obrigações decorrentes do contrato de locação ora distratado, nada mais tendo a reclamar uma da outra a qualquer título.{{/if}}{{#if !quitacao_total}}A quitação mútua, plena, geral, rasa e irrevogável dependerá do efetivo cumprimento das obrigações pecuniárias previstas neste instrumento. Após o pagamento integral, as partes nada mais terão a reclamar entre si.{{/if}}</p>

{{#if obs}}<h3>CLÁUSULA {{n_clausula_obs}}ª — DISPOSIÇÕES ADICIONAIS</h3>
<p>{{obs_html}}</p>{{/if}}

<p style="margin-top:30px;">E, por estarem assim justas e contratadas, as partes firmam o presente em duas vias de igual teor.</p>

<p style="text-align:right; margin-top:20px;">{{cidade}}, {{data_hoje_extenso}}.</p>

<div style="margin-top:60px; display:flex; justify-content:space-around; gap:30px;">
  <div style="text-align:center; flex:1;">
    <div style="border-top:1px solid #000; padding-top:6px;">{{locador.nome}}</div>
    <div style="font-size:11px;">LOCADOR</div>
  </div>
  <div style="text-align:center; flex:1;">
    <div style="border-top:1px solid #000; padding-top:6px;">{{locatario.nome}}</div>
    <div style="font-size:11px;">LOCATÁRIO</div>
  </div>
</div>

<div style="margin-top:40px; font-size:11px; color:#888;">Testemunhas:</div>
<div style="margin-top:20px; display:flex; gap:30px;">
  <div style="flex:1; border-top:1px solid #000; padding-top:6px; font-size:11px;">Nome / CPF</div>
  <div style="flex:1; border-top:1px solid #000; padding-top:6px; font-size:11px;">Nome / CPF</div>
</div>
`;

let _distratoContexto = null;

async function abrirDistrato() {
  const contratoId = $('contrato-id').value;
  if (!contratoId) {
    showAlert('contrato-alert', 'Salve o contrato antes de gerar o distrato.');
    return;
  }
  if (!State.tenant) {
    alert('Selecione um tenant antes.');
    return;
  }

  try {
    const cSnap = await tenantPath().collection('contratos').doc(contratoId).get();
    if (!cSnap.exists) { showAlert('contrato-alert', 'Contrato não encontrado.'); return; }
    const c = cSnap.data();

    const [locadorSnap, locatarioSnap, imovelSnap] = await Promise.all([
      c.locadorId   ? tenantPath().collection('locadores').doc(c.locadorId).get()   : Promise.resolve(null),
      c.locatarioId ? tenantPath().collection('locatarios').doc(c.locatarioId).get() : Promise.resolve(null),
      c.imovelId    ? tenantPath().collection('imoveis').doc(c.imovelId).get()    : Promise.resolve(null),
    ]);
    const locador = locadorSnap && locadorSnap.exists ? locadorSnap.data() : {};
    const locatario = locatarioSnap && locatarioSnap.exists ? locatarioSnap.data() : {};
    const imovel = imovelSnap && imovelSnap.exists ? imovelSnap.data() : {};

    _distratoContexto = {
      contratoId,
      contrato: c,
      locador, locatario, imovel,
      htmlGerado: null,
    };

    // Defaults
    const hojeISO = new Date().toISOString().slice(0, 10);
    $('distrato-data-efetiva').value = c.dataEntregaChaves || hojeISO;
    $('distrato-entrega-chaves').value = c.dataEntregaChaves || hojeISO;
    $('distrato-motivo').value = '';
    $('distrato-multa').value = '';
    $('distrato-pendencias').value = '';
    $('distrato-obs').value = '';

    $('distrato-etapa-perguntas').style.display = 'block';
    $('distrato-etapa-preview').style.display = 'none';
    $('distrato-acoes-perguntas').style.display = 'block';
    $('distrato-acoes-preview').style.display = 'none';
    clearAlert('distrato-alert');

    $('modal-distrato').style.display = 'flex';
  } catch (err) {
    console.error('Erro ao abrir distrato:', err);
    showAlert('contrato-alert', 'Erro: ' + err.message);
  }
}

function fecharDistrato() {
  $('modal-distrato').style.display = 'none';
  _distratoContexto = null;
}

function distratoVoltarPerguntas() {
  $('distrato-etapa-perguntas').style.display = 'block';
  $('distrato-etapa-preview').style.display = 'none';
  $('distrato-acoes-perguntas').style.display = 'block';
  $('distrato-acoes-preview').style.display = 'none';
}

async function distratoGerarPreview() {
  clearAlert('distrato-alert');
  const ctx = _distratoContexto;
  if (!ctx) return;

  const dataEfetiva = $('distrato-data-efetiva').value;
  const entregaChaves = $('distrato-entrega-chaves').value;
  const motivo = $('distrato-motivo').value;
  const multa = parseFloat($('distrato-multa').value) || 0;
  const pendencias = parseFloat($('distrato-pendencias').value) || 0;
  const obs = $('distrato-obs').value.trim();

  if (!dataEfetiva) { showAlert('distrato-alert', 'Informe a data efetiva do distrato.'); return; }
  if (!motivo) { showAlert('distrato-alert', 'Selecione o motivo do distrato.'); return; }

  // Numeração dinâmica das cláusulas
  let n = 4;
  let nPendencias = null, nQuitacao, nObs = null;
  if (multa > 0) { n = 5; }
  if (pendencias > 0) { nPendencias = n; n++; }
  nQuitacao = n;
  if (obs) { n++; nObs = n; }

  const dados = {
    contrato: {
      ...ctx.contrato,
      numero: ctx.contrato.numero || '—',
      inicio_br: ctx.contrato.inicio ? fmtDataBR(ctx.contrato.inicio) : '—',
    },
    locador: elabFormatarEntidade(ctx.locador, 'locadores'),
    locatario: elabFormatarEntidade(ctx.locatario, 'locatarios'),
    imovel: elabFormatarEntidade(ctx.imovel, 'imoveis'),
    data_efetiva_br: fmtDataBR(dataEfetiva),
    data_entrega_chaves_br: fmtDataBR(entregaChaves || dataEfetiva),
    motivo_label: DISTRATO_MOTIVO_LABEL[motivo] || motivo,
    multa: multa > 0 ? true : false,
    multa_fmt: fmtBRL(multa),
    pendencias: pendencias > 0 ? true : false,
    pendencias_fmt: fmtBRL(pendencias),
    obs: obs || null,
    obs_html: obs ? (typeof textToHtml === 'function' ? textToHtml(obs) : escapeHtml(obs).replace(/\n/g, '<br>')) : '',
    quitacao_total: pendencias === 0 && multa === 0,
    n_clausula_pendencias: nPendencias,
    n_clausula_quitacao: nQuitacao,
    n_clausula_obs: nObs,
    cidade: ctx.imovel?.endereco?.cidade || 'São Paulo',
    data_hoje_extenso: fmtDataExtenso(),
  };

  const templateAtivo = await obterTemplate('distrato');
  const html = elabRenderizarTemplate(templateAtivo, dados);
  ctx.htmlGerado = html;
  ctx.respostas = { dataEfetiva, entregaChaves, motivo, multa, pendencias, obs };

  $('distrato-preview-container').innerHTML = html;
  $('distrato-etapa-perguntas').style.display = 'none';
  $('distrato-etapa-preview').style.display = 'block';
  $('distrato-acoes-perguntas').style.display = 'none';
  $('distrato-acoes-preview').style.display = 'block';
}

async function distratoBaixarPDF() {
  if (!_distratoContexto?.htmlGerado) return;
  if (!window.html2pdf) {
    showAlert('distrato-alert', 'Biblioteca html2pdf não carregou. Recarregue a página.');
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.style.padding = '20mm';
  wrapper.style.fontFamily = 'Georgia, serif';
  wrapper.style.fontSize = '12pt';
  wrapper.style.color = '#000';
  wrapper.innerHTML = _distratoContexto.htmlGerado;
  const filename = `Distrato_contrato_${_distratoContexto.contrato.numero || _distratoContexto.contratoId}_${Date.now()}.pdf`;
  await html2pdf().set({
    margin: 0,
    filename,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  }).from(wrapper).save();
}

function distratoBaixarWord() {
  if (!_distratoContexto?.htmlGerado) return;
  const filename = `Distrato_contrato_${_distratoContexto.contrato.numero || _distratoContexto.contratoId}_${Date.now()}.doc`;
  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Distrato</title></head><body style="font-family: Georgia, serif; font-size: 12pt;">${_distratoContexto.htmlGerado}</body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function distratoSalvar() {
  if (!_distratoContexto?.htmlGerado) return;
  const ctx = _distratoContexto;
  clearAlert('distrato-alert');

  try {
    // 1) Atualiza contrato com status rescindido + dataEntregaChaves
    const updatePayload = {
      status: 'rescindido',
      dataEntregaChaves: ctx.respostas.entregaChaves || ctx.respostas.dataEfetiva,
      distrato: {
        dataEfetiva: ctx.respostas.dataEfetiva,
        motivo: ctx.respostas.motivo,
        motivoLabel: DISTRATO_MOTIVO_LABEL[ctx.respostas.motivo],
        multa: ctx.respostas.multa,
        pendencias: ctx.respostas.pendencias,
        obs: ctx.respostas.obs || null,
        htmlGerado: ctx.htmlGerado,
        geradoEm: firebase.firestore.FieldValue.serverTimestamp(),
        geradoPor: State.user.uid,
      },
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    };
    await tenantPath().collection('contratos').doc(ctx.contratoId).update(updatePayload);

    // 2) Side-effect: libera imóvel se estava alugado
    if (ctx.contrato.imovelId) {
      try {
        const imovelRef = tenantPath().collection('imoveis').doc(ctx.contrato.imovelId);
        const snap = await imovelRef.get();
        if (snap.exists && !snap.data().multiplasUnidades) {
          await imovelRef.update({ status: 'disponivel' });
          invalidateImoveisCache();
        }
      } catch (_) {}
    }

    logAuditoria('create', 'distrato', ctx.contratoId, {
      motivo: ctx.respostas.motivo,
      multa: ctx.respostas.multa,
      pendencias: ctx.respostas.pendencias,
    });

    showAlert('contrato-alert', `✓ Distrato gerado e contrato encerrado. Status atualizado para "rescindido".`, 'success');
    $('contrato-status').value = 'rescindido';
    fecharDistrato();
    loadContratos();
  } catch (err) {
    console.error('Erro ao salvar distrato:', err);
    showAlert('distrato-alert', 'Erro: ' + err.message);
  }
}

async function elabEnviarZapSign() {
  if (!_elabContrato?.htmlGerado) return;
  // Salva primeiro (precisa do contratoId pro fluxo do ZapSign)
  if (!_elabContrato.contratoSalvoId) {
    await elabSalvarContrato();
    if (!_elabContrato.contratoSalvoId) return;
  }
  // Reusa o fluxo existente: seta contrato-id (mesmo sem o modal de contrato aberto) e chama abrirEnvioZapSign
  if (_elabContrato.modalidade !== 'locacao') {
    showAlert('elab-alert', 'Envio para ZapSign disponível apenas para contratos de locação na Fase A. Vendas usam o módulo de Negociações.');
    return;
  }
  $('contrato-id').value = _elabContrato.contratoSalvoId;
  if (typeof abrirEnvioZapSign === 'function') {
    await abrirEnvioZapSign();
  } else {
    showAlert('elab-alert', 'Função de envio ZapSign não disponível.');
  }
}
