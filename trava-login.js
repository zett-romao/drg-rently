// =============================================================
// 🔒 TRAVA DE LOGIN (03/11/2026)
// Do dono: "quero um mecanismo para impedir todos os logins com exceção do meu ou dos quais
// eu permitir dentre os cadastrados".
//
// plataforma/acesso = { travado: bool, permitidos: [uid], atualizadoEm, atualizadoPor }
//  · travado → só entra o super_admin e quem está em `permitidos`;
//  · a SEGURANÇA de verdade está nas regras do Firestore (userExists() → liberadoNaTrava()) e no
//    Worker Asaas (verificarIdTokenComTrava): quem está fora não lê nem grava nada, mesmo
//    contornando a tela. Aqui o app só explica e tira a pessoa da sessão;
//  · quem já estava logado sai na hora em que a trava liga (onSnapshot), com o aviso na tela de login;
//  · cadastro de imobiliária nova também fica fechado enquanto travado.
// 🔒 O super_admin nunca é barrado (piso anti-lockout).
// =============================================================

const TRAVA_MSG = '🔒 O acesso ao sistema está temporariamente restrito pelo administrador da plataforma. Fale com o administrador para ser liberado.';
const travaRef = () => db.collection('plataforma').doc('acesso');
let _travaUnsub = null;
let _travaDados = null;      // último plataforma/acesso lido no painel
let _travaUsuarios = [];     // [{ id, nome, email, role, tenantId, ativo }]
let _travaMarcados = new Set();

function travaBarra(dados, uid, role) {
  if (role === 'super_admin') return false;
  if (!dados || dados.travado !== true) return false;
  return !(Array.isArray(dados.permitidos) && dados.permitidos.includes(uid));
}

// Chamado no login (loadProfileAndShow). Se não der para ler (regras novas ainda não coladas no
// Console), deixa passar: quem segura de verdade são as regras.
async function passaNaTravaDeLogin(uid, role) {
  if (role === 'super_admin') return true;
  try {
    const snap = await travaRef().get();
    return !travaBarra(snap.exists ? snap.data() : null, uid, role);
  } catch (e) {
    console.warn('Trava de login não lida (regras antigas?):', e.code || e.message);
    return true;
  }
}

// Sessão aberta: se a trava ligar (ou a pessoa sair da lista), sai na hora.
function vigiarTravaDeLogin(uid, role) {
  pararVigiaTrava();
  if (role === 'super_admin') return;
  _travaUnsub = travaRef().onSnapshot((snap) => {
    if (!travaBarra(snap.exists ? snap.data() : null, uid, role)) return;
    pararVigiaTrava();
    auth.signOut().finally(() => showAlert('login-alert', TRAVA_MSG));
  }, () => { /* sem leitura = regras antigas; as regras novas é que barram */ });
}
function pararVigiaTrava() {
  if (_travaUnsub) { _travaUnsub(); _travaUnsub = null; }
}

// Cadastro de imobiliária nova: travado = fechado.
async function cadastroFechadoPelaTrava() {
  try {
    const snap = await travaRef().get();
    return snap.exists && snap.data().travado === true;
  } catch (_) { return false; }
}

// ---------------- Painel (Super Admin) ----------------
const TRAVA_ROTULO_ROLE = {
  super_admin: '👑 Super Admin', operador_drg: '🛠 Operador DRG', admin: 'Administrador',
  operador: 'Operador', corretor: 'Corretor',
};

async function loadTravaLogin() {
  const card = $('card-trava-login');
  if (!card) return;
  card.style.display = State.isDRGMaster ? 'block' : 'none';
  if (!State.isDRGMaster) return;
  const lista = $('trava-lista');
  lista.innerHTML = '<p class="muted">Carregando cadastrados…</p>';
  try {
    const [snapTrava, snapUsers, snapTenants] = await Promise.all([
      travaRef().get(),
      db.collection('users').get(),
      db.collection('tenants').get(),
    ]);
    _travaDados = snapTrava.exists ? snapTrava.data() : { travado: false, permitidos: [] };
    _travaMarcados = new Set(_travaDados.permitidos || []);
    const nomeTenant = {};
    snapTenants.docs.forEach((d) => { nomeTenant[d.id] = d.data().nome || d.id; });
    _travaUsuarios = snapUsers.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => u.situacao !== 'lixeira')
      .map((u) => ({ id: u.id, nome: u.nome || '—', email: u.email || '—', role: u.role || '—',
        empresa: u.tenantId ? (nomeTenant[u.tenantId] || '—') : 'Equipe DR Systems', ativo: u.ativo !== false }))
      .sort((a, b) => (a.role === 'super_admin' ? -1 : 0) - (b.role === 'super_admin' ? -1 : 0)
        || a.nome.localeCompare(b.nome, 'pt-BR'));
    renderTravaLogin();
  } catch (e) {
    console.error('Trava de login:', e);
    lista.innerHTML = '';
    showAlert('trava-alert', e.code === 'permission-denied'
      ? 'Sem permissão para ler a trava. As regras novas do Firestore (firestore.rules de 03/11/2026) ainda não foram coladas no Console.'
      : 'Erro ao carregar: ' + e.message);
  }
}

function renderTravaLogin() {
  const travado = _travaDados && _travaDados.travado === true;
  const nPerm = _travaUsuarios.filter((u) => u.role !== 'super_admin' && _travaMarcados.has(u.id)).length;
  const st = $('trava-status');
  st.className = 'trava-status ' + (travado ? 'trava-on' : 'trava-off');
  st.innerHTML = travado
    ? `🔒 <strong>TRAVADO</strong> — só você (Super Admin) e <strong>${nPerm}</strong> pessoa(s) liberada(s) conseguem entrar. Cadastro de imobiliária nova fechado.`
    : `🔓 <strong>Liberado</strong> — todo cadastrado ativo entra normalmente. Marque abaixo quem continua entrando e clique em travar.`;
  const bt = $('btn-trava-toggle');
  bt.textContent = travado ? '🔓 Destravar — liberar todos' : '🔒 Travar logins agora';
  bt.className = 'btn ' + (travado ? 'btn-primary' : 'btn-danger');

  const termo = ($('trava-busca').value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const visiveis = _travaUsuarios.filter((u) => !termo
    || `${u.nome} ${u.email} ${u.empresa} ${TRAVA_ROTULO_ROLE[u.role] || u.role}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(termo));
  $('trava-contagem').textContent = `${nPerm} liberado(s) de ${_travaUsuarios.filter((u) => u.role !== 'super_admin').length} cadastrado(s)`;
  $('trava-lista').innerHTML = visiveis.length ? visiveis.map((u) => {
    const sempre = u.role === 'super_admin';
    return `<label class="trava-linha${sempre ? ' trava-sempre' : ''}">
      <input type="checkbox" ${sempre || _travaMarcados.has(u.id) ? 'checked' : ''} ${sempre ? 'disabled' : ''}
        onchange="marcarTravaLogin('${u.id}', this.checked)">
      <span class="trava-quem"><strong>${escapeHtml(u.nome)}</strong>${u.id === State.user.uid ? ' <span class="muted">(você)</span>' : ''}<br>
        <span class="muted">${escapeHtml(u.email)}</span></span>
      <span class="trava-onde">${escapeHtml(TRAVA_ROTULO_ROLE[u.role] || u.role)}<br><span class="muted">${escapeHtml(u.empresa)}</span></span>
      <span class="trava-sit">${sempre ? '<span class="badge-status ativo">sempre entra</span>' : (u.ativo ? '' : '<span class="badge-status suspenso">desativado</span>')}</span>
    </label>`;
  }).join('') : '<p class="muted">Ninguém com esse nome, e-mail ou empresa.</p>';
}

function marcarTravaLogin(uid, marcado) {
  if (marcado) _travaMarcados.add(uid); else _travaMarcados.delete(uid);
  renderTravaLogin();
}

function permitidosMarcados() {
  // só uids que existem (quem foi excluído some da lista ao salvar)
  return _travaUsuarios.filter((u) => u.role !== 'super_admin' && _travaMarcados.has(u.id)).map((u) => u.id);
}

async function gravarTravaLogin(btn, travado, aguarde, okMsg) {
  clearAlert('trava-alert');
  const permitidos = permitidosMarcados();
  try {
    const r = await drgSubmit(btn, aguarde, async () => {
      const dados = {
        travado, permitidos,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        atualizadoPor: State.user.uid,
      };
      await travaRef().set(dados, { merge: true });
      _travaDados = { ..._travaDados, travado, permitidos };
      if (typeof logAuditoria === 'function') logAuditoria(travado ? 'trava_login_ligada' : 'trava_login_salva', 'drg_trava_login', 'acesso', { travado, permitidos: permitidos.length });
    }, { destravar: true });
    if (r === DRG_IGNORADO) return;
    renderTravaLogin();
    showAlert('trava-alert', okMsg(permitidos.length), 'success');
  } catch (e) {
    console.error('Trava de login:', e);
    showAlert('trava-alert', e.code === 'permission-denied'
      ? 'Não gravou: as regras novas do Firestore (firestore.rules de 03/11/2026) ainda não foram coladas no Console.'
      : 'Não gravou: ' + e.message);
  }
}

async function alternarTravaLogin(btn) {
  const travar = !(_travaDados && _travaDados.travado === true);
  const n = permitidosMarcados().length;
  const ok = await confirmar(travar ? {
    titulo: 'Travar os logins?', icone: '🔒', perigo: true, confirmar: '🔒 Travar agora',
    mensagem: `Só você e <strong>${n}</strong> pessoa(s) marcada(s) vão conseguir entrar. Quem estiver usando o sistema agora <strong>sai na hora</strong>, e o cadastro de imobiliária nova fica fechado.`,
  } : {
    titulo: 'Destravar os logins?', icone: '🔓', confirmar: '🔓 Liberar todos',
    mensagem: 'Todo cadastrado ativo volta a entrar normalmente. A lista de marcados fica guardada para a próxima vez.',
  });
  if (!ok) return;
  await gravarTravaLogin(btn, travar, travar ? '⏳ Travando... aguarde' : '⏳ Liberando... aguarde',
    (k) => travar ? `✓ Logins travados — só você e ${k} pessoa(s) liberada(s) entram.` : '✓ Logins liberados — todos os cadastrados ativos entram de novo.');
}

async function salvarPermitidosTrava(btn) {
  const travado = !!(_travaDados && _travaDados.travado === true);
  await gravarTravaLogin(btn, travado, '⏳ Salvando... aguarde',
    (k) => `✓ Lista salva — ${k} pessoa(s) liberada(s)${travado ? '. Quem saiu da lista foi desconectado.' : ' (vale quando você travar).'}`);
}

window.loadTravaLogin = loadTravaLogin;
window.renderTravaLogin = renderTravaLogin;
window.marcarTravaLogin = marcarTravaLogin;
window.alternarTravaLogin = alternarTravaLogin;
window.salvarPermitidosTrava = salvarPermitidosTrava;
