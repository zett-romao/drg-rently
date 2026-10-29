// =============================================================
// DRG-Rently — alcance.js
// "Mostrar" de cada módulo no perfil (dono, 29/10/2026): QUAIS registros a pessoa enxerga.
//   'proprios'   → só os vinculados a ela
//   'equipe'     → os dela + os da(s) equipe(s) a que ela pertence
//   'escolhidos' → os dela + equipes/corretores marcados (e, se marcado, a equipe dela
//                  e o que a imobiliária cadastrou sem corretor)
//   'rede'       → todos (padrão da equipe interna — como sempre foi)
//
// 🔒 Travado no SERVIDOR (firestore.rules → dentroDoAlcance): cada registro carrega
// `vinculos` (uids ligados a ele + '__imobiliaria' quando nenhum é corretor). Quem tem
// alcance limitado só consegue ler, editar e excluir o que bate com a lista dele — por
// isso as telas consultam por colecaoNoAlcance(), que pede ao servidor só o permitido.
//
// Vínculo = quem cadastrou/captou; lead = corretor a quem foi repassado. Negócio fechado
// vira um "grupo": contrato (ou negociação) + imóvel + proprietário(s) + locatário/comprador
// + garantia + balancetes compartilham os vínculos — quem enxerga o contrato enxerga o resto.
//
// ⚠️ Corretor: continua "só os dele" pela blindagem 🔒 (regras próprias) — aqui não amplia nada.
// =============================================================

const ALCANCES = ['proprios', 'equipe', 'escolhidos', 'rede'];
const ALCANCE_LABEL = {
  proprios: '👤 Só os vinculados a ele',
  equipe: '👥 Dele + a(s) equipe(s) dele',
  escolhidos: '🎯 Dele + equipes/corretores escolhidos',
  rede: '🌐 Toda a rede (todos)',
};
const ALCANCE_IMOBILIARIA = '__imobiliaria';   // registro sem nenhum corretor vinculado
const ALCANCE_MINHA_EQUIPE = '__minhaEquipe';  // "a(s) equipe(s) dele", dentro de 'escolhidos'
// Coleção → módulo (espelho de colecaoComAlcance/moduloDaColecao no firestore.rules)
const COLECOES_ALCANCE = {
  locadores: 'locadores', locatarios: 'locatarios', garantias: 'garantias', compradores: 'compradores',
  negociacoes: 'negociacoes', imoveis: 'imoveis', contratos: 'contratos', balancetes: 'balancetes',
  leadsImoveis: 'leads',
};
function rankAlcance(a) { const i = ALCANCES.indexOf(a); return i < 0 ? ALCANCES.length - 1 : i; }
function alcancePadrao(role) { return role === 'corretor' ? 'proprios' : 'rede'; }

// Lê o alcance salvo no perfil (chamado pelo normalizarPerfil)
function normalizarAlcance(p, role) {
  const alcance = ALCANCES.includes(p && p.alcance) ? p.alcance : alcancePadrao(role);
  if (alcance !== 'escolhidos') return { alcance, alcanceCorretores: [], alcanceEquipes: [], alcanceUids: [], alcanceMinhaEquipe: false };
  const lista = (v) => Array.isArray(v) ? [...new Set(v.filter(s => typeof s === 'string' && s))] : [];
  const alcanceCorretores = lista(p.alcanceCorretores);
  return {
    alcance,
    alcanceCorretores,
    alcanceEquipes: lista(p.alcanceEquipes),
    alcanceUids: Array.isArray(p.alcanceUids) ? lista(p.alcanceUids) : alcanceCorretores.filter(u => u !== ALCANCE_MINHA_EQUIPE),
    alcanceMinhaEquipe: alcanceCorretores.includes(ALCANCE_MINHA_EQUIPE),
  };
}

// Delegação: ninguém concede alcance maior que o próprio. Retorna o texto do excesso ou ''.
function excessoAlcance(p, eu) {
  const a = p.alcance || 'rede', meu = eu.alcance || 'rede';
  if (rankAlcance(a) > rankAlcance(meu)) return ALCANCE_LABEL[a];
  if (a === 'escolhidos' && meu === 'escolhidos') {
    const fora = (p.alcanceUids || []).filter(u => !(eu.alcanceUids || []).includes(u));
    if (fora.length) return `${fora.length} pessoa(s) fora do seu alcance`;
    if (p.alcanceMinhaEquipe && !eu.alcanceMinhaEquipe) return 'a equipe dele';
  }
  return '';
}

// ---------- Lista do usuário logado (espelho da regra dentroDoAlcance) ----------
// null = sem limite. Set = uids/marcadores que ele pode enxergar naquele módulo.
function listaAlcance(modulo) {
  const role = State.userDoc?.role;
  if (!State.user || !State.tenant || ['admin', 'super_admin', 'operador_drg', 'corretor'].includes(role)) return null;
  if (State.tenantOriginal) return null;   // equipe DRG atuando como o cliente
  const p = perfilAtual().permissoes?.[modulo];
  if (!p || !['proprios', 'equipe', 'escolhidos'].includes(p.alcance)) return null;
  const s = new Set([State.user.uid]);
  if (p.alcance === 'escolhidos') (p.alcanceUids || []).forEach(u => s.add(u));
  if (p.alcance === 'equipe' || (p.alcance === 'escolhidos' && p.alcanceMinhaEquipe)) (State.minhaEquipeUids || []).forEach(u => s.add(u));
  return s;
}
function alcanceDoModulo(modulo) {   // compat (avisos)
  const uids = listaAlcance(modulo);
  return uids ? { tipo: perfilAtual().permissoes[modulo].alcance, uids } : null;
}

// Membros das equipes do usuário (o servidor lê o mesmo doc: equipesMembro/{uid})
async function carregarMinhaEquipe() {
  State.minhaEquipeUids = [];
  State.minhasEquipes = [];
  if (!State.user || !State.tenant || State.userDoc?.role === 'super_admin') return;
  try {
    const s = await tenantPath().collection('equipesMembro').doc(State.user.uid).get();
    if (s.exists) { State.minhaEquipeUids = s.data().uids || []; State.minhasEquipes = s.data().equipes || []; }
  } catch (_) {}
}

function dentroDaLista(dados, lista) {
  if (!lista) return true;
  if (dados.criadoPor && dados.criadoPor === State.user?.uid) return true;
  return (dados.vinculos || []).some(u => lista.has(u));
}

// ---------- Consulta no alcance ----------
// Mesmo jeito de usar de tenantPath().collection(x): .where/.orderBy/.limit/.get.
// Sem limite → consulta normal. Com limite → pede ao servidor só "vinculos contém algum
// da minha lista" (+ o que eu cadastrei) e aplica where/orderBy/limit aqui (sem índice novo).
class ConsultaAlcance {
  constructor(colecao, ops = []) { this.colecao = colecao; this.ops = ops; }
  _mais(op) { return new ConsultaAlcance(this.colecao, [...this.ops, op]); }
  where(...a) { return this._mais(['where', ...a]); }
  orderBy(...a) { return this._mais(['orderBy', ...a]); }
  limit(n) { return this._mais(['limit', n]); }
  async get() {
    const ref = tenantPath().collection(this.colecao);
    const lista = listaAlcance(COLECOES_ALCANCE[this.colecao]);
    if (!lista) {
      let q = ref;
      this.ops.forEach(([t, ...a]) => { q = q[t](...a); });
      return q.get();
    }
    const uids = [...lista];
    const consultas = [ref.where('criadoPor', '==', State.user.uid).get()];
    for (let i = 0; i < uids.length; i += 30) consultas.push(ref.where('vinculos', 'array-contains-any', uids.slice(i, i + 30)).get());
    const porId = new Map();
    (await Promise.all(consultas)).forEach(s => s.docs.forEach(d => porId.set(d.id, d)));
    let docs = [...porId.values()];
    const ordens = [];
    let limite = null;
    this.ops.forEach(([t, ...a]) => {
      if (t === 'where') docs = docs.filter(d => condicaoOk(campoDe(d.data(), a[0]), a[1], a[2]));
      else if (t === 'orderBy') ordens.push([a[0], a[1] === 'desc' ? -1 : 1]);
      else if (t === 'limit') limite = a[0];
    });
    if (ordens.length) {
      docs = docs.filter(d => ordens.every(([c]) => campoDe(d.data(), c) !== undefined));   // como o Firestore
      docs.sort((x, y) => {
        for (const [c, dir] of ordens) { const r = compararValores(campoDe(x.data(), c), campoDe(y.data(), c)); if (r) return r * dir; }
        return 0;
      });
    }
    if (limite != null) docs = docs.slice(0, limite);
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
  }
}
function colecaoNoAlcance(colecao) { return new ConsultaAlcance(colecao); }

function campoDe(obj, caminho) {
  return String(caminho).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function valorComparavel(v) {
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return v;
}
function compararValores(a, b) {
  a = valorComparavel(a); b = valorComparavel(b);
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : 1;   // ordem binária, como o Firestore
  return a < b ? -1 : (a > b ? 1 : 0);
}
function condicaoOk(v, op, alvo) {
  const igual = (x, y) => compararValores(x, y) === 0;
  switch (op) {
    case '==': return igual(v, alvo);
    case '!=': return v !== undefined && !igual(v, alvo);
    case '<': return v != null && compararValores(v, alvo) < 0;
    case '<=': return v != null && compararValores(v, alvo) <= 0;
    case '>': return v != null && compararValores(v, alvo) > 0;
    case '>=': return v != null && compararValores(v, alvo) >= 0;
    case 'in': return (alvo || []).some(x => igual(v, x));
    case 'not-in': return v !== undefined && !(alvo || []).some(x => igual(v, x));
    case 'array-contains': return Array.isArray(v) && v.some(x => igual(x, alvo));
    case 'array-contains-any': return Array.isArray(v) && v.some(x => (alvo || []).some(y => igual(x, y)));
    default: return true;
  }
}

// Corta uma lista já lida pelo alcance de OUTRO módulo (ex.: Alertas lê contratos).
async function filtroAlcanceItens(modulo) {
  const lista = listaAlcance(modulo);
  return (colecao, id, dados) => dentroDaLista(dados || {}, lista);
}
async function aplicarAlcance(modulo, colecao, snap) {
  const lista = listaAlcance(modulo);
  if (!lista) return snap;
  const docs = snap.docs.filter(d => dentroDaLista(d.data(), lista));
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}

// Aviso discreto acima da lista: "mostrando só os vinculados a você"
function avisoAlcanceHtml(modulo) {
  const al = alcanceDoModulo(modulo);
  if (!al) return '';
  const txt = { proprios: 'só os vinculados a você', equipe: 'os seus + os da sua equipe', escolhidos: 'os seus + as equipes/corretores escolhidos no seu perfil' }[al.tipo];
  return `<div class="alcance-aviso">👁 Mostrando ${txt} (alcance definido no seu perfil de permissões).</div>`;
}
function mostrarAvisoAlcance(modulo, ancoraId) {
  const ancora = $(ancoraId);
  if (!ancora) return;
  const tabela = ancora.closest('table') || ancora;
  const box = tabela.parentElement.querySelector(':scope > .alcance-aviso[data-mod="' + modulo + '"]');
  const html = avisoAlcanceHtml(modulo);
  if (!html) { if (box) box.remove(); return; }
  if (!box) {
    tabela.insertAdjacentHTML('beforebegin', html);
    tabela.previousElementSibling.dataset.mod = modulo;
  }
}

// ---------- Vínculos gravados em cada registro ----------
let _uidsCorretores = null;
async function uidsCorretores() {
  if (_uidsCorretores) return _uidsCorretores;
  try { _uidsCorretores = new Set((await tenantPath().collection('corretores').get()).docs.map(d => d.id)); }
  catch (_) { _uidsCorretores = new Set(); }
  return _uidsCorretores;
}
function marcarImobiliaria(set, corretores) {
  set.delete(ALCANCE_IMOBILIARIA);
  if (![...set].some(u => corretores.has(u))) set.add(ALCANCE_IMOBILIARIA);
  return [...set].filter(Boolean).sort();
}

// Registro novo (gravar → criar): quem cria + o captador do imóvel ligado + o corretor do lead
async function vinculosNovoRegistro(colecao, dados) {
  const s = new Set();
  if (colecao === 'leadsImoveis') { if (dados.corretorUid) s.add(dados.corretorUid); }
  else s.add(dados.criadoPor || State.user?.uid);
  if (dados.imovelId) {
    try {
      const im = await tenantPath().collection('imoveis').doc(dados.imovelId).get();
      if (im.exists && im.data().criadoPor) s.add(im.data().criadoPor);
    } catch (_) {}
  }
  if (dados.divisaoComissao) { s.add(dados.divisaoComissao.captadorUid); s.add(dados.divisaoComissao.vendedorUid); }
  s.delete(null); s.delete(undefined);
  return marcarImobiliaria(s, await uidsCorretores());
}

// Recalcula os vínculos do tenant inteiro e grava só o que mudou.
// Só quem enxerga tudo (sem limite) consegue — é quem o servidor deixa mexer em `vinculos`.
async function calcularVinculosTenant() {
  const T = tenantPath();
  const cols = Object.keys(COLECOES_ALCANCE);
  const [snaps, corretores] = await Promise.all([Promise.all(cols.map(c => T.collection(c).get())), (_uidsCorretores = null, uidsCorretores())]);
  const docs = {};
  cols.forEach((c, i) => { docs[c] = snaps[i].docs; });
  const alvo = {};
  const add = (col, id, uids) => {
    if (!id) return;
    const k = col + '/' + id;
    const s = alvo[k] || (alvo[k] = new Set());
    uids.forEach(u => { if (u) s.add(u); });
  };
  cols.forEach(c => docs[c].forEach(d => { const x = d.data(); add(c, d.id, [c === 'leadsImoveis' ? x.corretorUid : x.criadoPor]); }));
  const captador = Object.fromEntries(docs.imoveis.map(d => [d.id, d.data().criadoPor || null]));
  docs.imoveis.forEach(d => { const x = d.data(); add('locadores', x.locadorId, [x.criadoPor]); });
  const grupoContrato = {};
  docs.contratos.forEach(d => {
    const c = d.data();
    const g = [c.criadoPor, captador[c.imovelId]];
    grupoContrato[d.id] = g;
    add('contratos', d.id, g); add('imoveis', c.imovelId, g); add('locatarios', c.locatarioId, g);
    add('garantias', c.garantiaId, g); add('locadores', c.locadorId, g);
    (c.locadoresAdicionais || []).forEach(l => add('locadores', l, g));
  });
  docs.negociacoes.forEach(d => {
    const n = d.data();
    const dv = n.divisaoComissao || {};
    const g = [n.criadoPor, captador[n.imovelId], dv.captadorUid, dv.vendedorUid];
    add('negociacoes', d.id, g); add('imoveis', n.imovelId, g); add('compradores', n.compradorId, g); add('locadores', n.vendedorId, g);
  });
  docs.balancetes.forEach(d => { const b = d.data(); add('balancetes', d.id, [...(grupoContrato[b.contratoId] || []), captador[b.imovelId]]); });

  const mudancas = [];
  cols.forEach(c => docs[c].forEach(d => {
    const novo = marcarImobiliaria(alvo[c + '/' + d.id] || new Set(), corretores);
    const atual = Array.isArray(d.data().vinculos) ? [...d.data().vinculos].sort() : null;
    if (!atual || atual.join('|') !== novo.join('|')) mudancas.push([d.ref, novo]);
  }));
  for (let i = 0; i < mudancas.length; i += 400) {
    const b = db.batch();
    mudancas.slice(i, i + 400).forEach(([ref, v]) => b.update(ref, { vinculos: v }));
    await b.commit();
  }
  return { atualizados: mudancas.length };
}

// Quem pode recalcular: enxerga tudo em todos os módulos com alcance
function podeRecalcularVinculos() {
  if (!State.tenant || State.userDoc?.role === 'corretor') return false;
  return Object.values(COLECOES_ALCANCE).every(m => !listaAlcance(m));
}
let _vincTimer = null;
function agendarSincronizacaoVinculos(ms = 4000) {
  if (!podeRecalcularVinculos()) return;
  clearTimeout(_vincTimer);
  _vincTimer = setTimeout(() => calcularVinculosTenant().catch(e => console.warn('Vínculos não recalculados:', e)), ms);
}
// Ao entrar: gestor/administrador mantém os vínculos em dia (no máximo 1x a cada 10 min por aparelho)
function sincronizarVinculosAoEntrar() {
  if (!podeRecalcularVinculos()) return;
  if (!(State.userDoc?.role === 'admin' || pode('gerenciarUsuariosPerfis'))) return;
  const chave = 'drg-vinculos-' + State.tenant.id;
  const ultimo = parseInt(localStorage.getItem(chave) || '0', 10);
  if (Date.now() - ultimo < 10 * 60000) return;
  localStorage.setItem(chave, String(Date.now()));
  agendarSincronizacaoVinculos(6000);
}

// ---------- Equipes ----------
let _equipesCache = null;   // [{ id, nome, membros:[uid] }]
async function carregarEquipes(forcar) {
  if (_equipesCache && !forcar) return _equipesCache;
  try {
    const snap = await tenantPath().collection('equipes').get();
    _equipesCache = snap.docs.map(d => ({ id: d.id, ...d.data(), membros: d.data().membros || [] }))
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
  } catch (_) { _equipesCache = []; }
  return _equipesCache;
}
let _usuariosTenantCache = null;
async function carregarUsuariosParaEquipe(forcar) {
  if (_usuariosTenantCache && !forcar) return _usuariosTenantCache;
  const snap = await db.collection('users').where('tenantId', '==', State.tenant.id).get();
  _usuariosTenantCache = snap.docs.map(d => ({ uid: d.id, nome: d.data().nome || d.data().email || d.id, role: d.data().role || 'operador', ativo: d.data().ativo !== false }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  return _usuariosTenantCache;
}
const ROLE_NOME_EQUIPE = { admin: 'Administrador', corretor: 'Corretor', operador: 'Equipe interna' };

function resolverAlcanceUids(selecao, equipesIds, equipes) {
  const s = new Set((selecao || []).filter(u => u !== ALCANCE_MINHA_EQUIPE));
  (equipesIds || []).forEach(id => { const e = equipes.find(x => x.id === id); (e ? e.membros : []).forEach(u => s.add(u)); });
  return [...s].sort();
}

// Depois de mexer numa equipe: refaz equipesMembro/{uid} de todo mundo e o alcanceUids dos perfis.
async function recalcularAlcanceDerivado() {
  const T = tenantPath();
  const [equipes, membroSnap, perfisSnap] = await Promise.all([
    carregarEquipes(true), T.collection('equipesMembro').get(), T.collection('perfis').get(),
  ]);
  const b = db.batch();
  let n = 0;
  const atuais = Object.fromEntries(membroSnap.docs.map(d => [d.id, d.data()]));
  const pessoas = new Set([...Object.keys(atuais), ...equipes.flatMap(e => e.membros)]);
  pessoas.forEach(uid => {
    const minhas = equipes.filter(e => e.membros.includes(uid));
    const ref = T.collection('equipesMembro').doc(uid);
    if (!minhas.length) { if (atuais[uid]) { b.delete(ref); n++; } return; }
    const novo = { equipes: minhas.map(e => e.id).sort(), uids: [...new Set(minhas.flatMap(e => e.membros))].sort() };
    const at = atuais[uid];
    if (!at || (at.equipes || []).join() !== novo.equipes.join() || (at.uids || []).join() !== novo.uids.join()) { b.set(ref, novo); n++; }
  });
  perfisSnap.docs.forEach(d => {
    const perms = d.data().permissoes;
    if (!perms || typeof perms !== 'object') return;
    const upd = {};
    Object.entries(perms).forEach(([mod, p]) => {
      if (!p || p.alcance !== 'escolhidos') return;
      const novo = resolverAlcanceUids(p.alcanceCorretores, p.alcanceEquipes, equipes);
      if ((p.alcanceUids || []).slice().sort().join() !== novo.join()) upd[`permissoes.${mod}.alcanceUids`] = novo;
    });
    if (Object.keys(upd).length) { b.update(d.ref, upd); n++; }
  });
  if (n) await b.commit();
  return n;
}

async function loadEquipesTenant() {
  const tbody = $('tbody-equipes');
  if (!tbody || !State.tenant) return;
  tbody.innerHTML = '<tr><td colspan="3" class="empty">Carregando…</td></tr>';
  try {
    const [equipes, usuarios] = await Promise.all([carregarEquipes(true), carregarUsuariosParaEquipe(true).catch(() => [])]);
    const nome = (u) => (usuarios.find(x => x.uid === u) || {}).nome || '(sem acesso)';
    const gerencia = pode('gerenciarUsuariosPerfis');
    tbody.innerHTML = equipes.length ? equipes.map(e => `
      <tr>
        <td><strong>${escapeHtml(e.nome || '—')}</strong></td>
        <td style="font-size:12px;">${e.membros.length ? escapeHtml(e.membros.map(nome).join(', ')) : '<span class="muted">sem ninguém</span>'}</td>
        <td>${gerencia ? `<button class="btn btn-sm btn-secondary" onclick="openEquipeModal('${e.id}')">Editar</button>` : ''}</td>
      </tr>`).join('')
      : '<tr><td colspan="3" class="empty">Nenhuma equipe ainda. Crie a primeira para agrupar corretores e equipe interna.</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty" style="color:var(--danger);">Erro: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function openEquipeModal(id) {
  if (!pode('gerenciarUsuariosPerfis')) { avisoSemPermissao('configuracoes', 'editar'); return; }
  clearAlert('equipe-alert');
  const [equipes, usuarios] = await Promise.all([carregarEquipes(true), carregarUsuariosParaEquipe(true)]);
  const e = id ? equipes.find(x => x.id === id) : null;
  $('equipe-id').value = id || '';
  $('equipe-nome').value = e ? (e.nome || '') : '';
  $('modal-equipe-title').textContent = e ? 'Equipe: ' + (e.nome || '') : 'Nova equipe';
  $('btn-delete-equipe').style.display = e ? 'inline-block' : 'none';
  const marcados = new Set(e ? e.membros : []);
  const outras = (uid) => equipes.filter(x => x.id !== id && x.membros.includes(uid)).map(x => x.nome);
  $('equipe-membros').innerHTML = usuarios.filter(u => u.role !== 'admin').map(u => {
    const o = outras(u.uid);
    return `<label class="alcance-corretor" data-busca="${escapeHtml(u.nome.toLowerCase())}">
      <input type="checkbox" class="chk-equipe-membro" value="${escapeHtml(u.uid)}" ${marcados.has(u.uid) ? 'checked' : ''}>
      <span>${escapeHtml(u.nome)} <em class="muted">· ${ROLE_NOME_EQUIPE[u.role] || u.role}${u.ativo ? '' : ' (desativado)'}${o.length ? ' · também em ' + escapeHtml(o.join(', ')) : ''}</em></span>
    </label>`;
  }).join('') || '<span class="muted">Nenhum usuário além do administrador.</span>';
  $('equipe-busca').value = '';
  const btn = $('btn-save-equipe');
  btn.disabled = false; btn.innerHTML = 'Salvar';
  $('modal-equipe').style.display = 'flex';
  setTimeout(() => $('equipe-nome').focus(), 50);
}
function closeEquipeModal() { $('modal-equipe').style.display = 'none'; }
function filtrarMembrosEquipe(txt) {
  const t = String(txt || '').toLowerCase().trim();
  document.querySelectorAll('#equipe-membros .alcance-corretor').forEach(l => { l.style.display = !t || l.dataset.busca.includes(t) ? '' : 'none'; });
}

async function saveEquipe() {
  clearAlert('equipe-alert');
  const id = $('equipe-id').value;
  const nome = $('equipe-nome').value.trim();
  const membros = [...document.querySelectorAll('.chk-equipe-membro:checked')].map(c => c.value);
  if (!nome) { showAlert('equipe-alert', 'Dê um nome à equipe.'); return; }
  const equipes = await carregarEquipes(true);
  if (equipes.some(e => e.id !== id && String(e.nome || '').toLowerCase() === nome.toLowerCase())) {
    showAlert('equipe-alert', `Já existe uma equipe chamada "${escapeHtml(nome)}".`); return;
  }
  const btn = $('btn-save-equipe');
  try {
    const r = await drgSubmit(btn, '⏳ Salvando... aguarde', async () => {
      const agora = firebase.firestore.FieldValue.serverTimestamp();
      const ref = id ? tenantPath().collection('equipes').doc(id) : tenantPath().collection('equipes').doc();
      await ref.set({ nome, membros, atualizadoEm: agora, atualizadoPor: State.user.uid, ...(id ? {} : { criadoEm: agora, criadoPor: State.user.uid }) }, { merge: true });
      await recalcularAlcanceDerivado();
      logAuditoria(id ? 'update' : 'create', 'config', 'equipe:' + ref.id, { nome, membros: membros.length });
    });
    if (r === DRG_IGNORADO) return;
    btn.innerHTML = '✓ Salvo';
    showAlert('equipe-alert', `✓ Equipe "${escapeHtml(nome)}" salva com ${membros.length} pessoa(s). Vale no próximo acesso de cada um.`, 'success');
    loadEquipesTenant();
    setTimeout(closeEquipeModal, 1100);
  } catch (err) {
    showAlert('equipe-alert', 'Erro: ' + escapeHtml(err.message));
  }
}

async function deleteEquipe() {
  const id = $('equipe-id').value;
  if (!id) return;
  const ok = await confirmar({
    titulo: 'Excluir a equipe?',
    mensagem: `A equipe <strong>${escapeHtml($('equipe-nome').value)}</strong> deixa de existir.`,
    detalhe: 'Quem via "a equipe dele" passa a ver só os próprios registros; perfis que escolheram esta equipe deixam de incluí-la.',
    confirmar: '🗑 Excluir', aviso: true,
  });
  if (!ok) return;
  const btn = $('btn-delete-equipe');
  try {
    const r = await drgSubmit(btn, '⏳ Excluindo... aguarde', async () => {
      await tenantPath().collection('equipes').doc(id).delete();
      await recalcularAlcanceDerivado();
      logAuditoria('delete', 'config', 'equipe:' + id, {});
    });
    if (r === DRG_IGNORADO) return;
    showAlert('equipe-alert', '✓ Equipe excluída.', 'success');
    loadEquipesTenant();
    setTimeout(closeEquipeModal, 900);
  } catch (err) {
    showAlert('equipe-alert', 'Erro: ' + escapeHtml(err.message));
  }
}

async function recalcularVinculosAgora(btn) {
  const SID = 'equipes-status';
  if (!podeRecalcularVinculos()) {
    showInlineStatus(SID, '⛔ Só quem enxerga toda a rede em todos os módulos pode recalcular.', 'error');
    return;
  }
  try {
    let res;
    const r = await drgSubmit(btn, '⏳ Recalculando... aguarde', async () => {
      await recalcularAlcanceDerivado();
      res = await calcularVinculosTenant();
    }, { destravar: true });
    if (r === DRG_IGNORADO) return;
    showInlineStatus(SID, `✓ Vínculos conferidos: ${res.atualizados} registro(s) atualizado(s).`, 'success', 8000);
  } catch (err) {
    showInlineStatus(SID, '❌ ' + escapeHtml(err.message), 'error');
  }
}

// ---------- Editor de perfil ----------
let _alcanceCorretoresLista = null;   // [{ uid, nome, status }]
async function carregarCorretoresParaAlcance() {
  await carregarEquipes(true);
  try {
    const snap = await tenantPath().collection('corretores').get();
    _alcanceCorretoresLista = snap.docs.map(d => ({ uid: d.id, nome: d.data().nome || d.data().email || d.id, status: d.data().status || '' }))
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  } catch (_) { _alcanceCorretoresLista = []; }
  return _alcanceCorretoresLista;
}

// Bloco "Mostrar" dentro do card do módulo. limite = permissão de quem está editando.
function renderAlcanceModulo(m, p, limite, travado) {
  const souSuper = State.userDoc?.role === 'super_admin';
  const limiteRank = souSuper ? ALCANCES.length - 1 : rankAlcance(limite.alcance || 'rede');
  const atual = p.alcance || 'rede';
  const dis = (travado || !p.ver) ? 'disabled' : '';
  const opts = ALCANCES.map(a => {
    const acima = rankAlcance(a) > limiteRank;
    return `<option value="${a}" ${a === atual ? 'selected' : ''} ${acima ? 'disabled' : ''}>${ALCANCE_LABEL[a]}${acima ? ' (acima do seu)' : ''}</option>`;
  }).join('');
  const marcados = new Set([...(p.alcanceCorretores || []), ...(p.alcanceEquipes || []).map(e => 'eq:' + e)]);
  const meuLimite = (!souSuper && limite.alcance === 'escolhidos') ? new Set(limite.alcanceUids || []) : null;
  const item = (valor, rotulo, classe, bloqueado) => `
    <label class="alcance-corretor${bloqueado ? ' bloqueado' : ''}">
      <input type="checkbox" class="${classe}" data-modulo="${m.id}" value="${escapeHtml(valor)}"
        ${marcados.has(classe === 'chk-alcance-equipe' ? 'eq:' + valor : valor) ? 'checked' : ''} ${(travado || bloqueado) ? 'disabled' : ''}>
      <span>${rotulo}</span>
    </label>`;
  const equipes = _equipesCache || [];
  const corretores = _alcanceCorretoresLista || [];
  const html = `
    <div class="alcance-sub">Atalhos</div>
    ${item(ALCANCE_MINHA_EQUIPE, '👥 A(s) equipe(s) dele', 'chk-alcance-corretor', meuLimite && !limite.alcanceMinhaEquipe)}
    ${item(ALCANCE_IMOBILIARIA, '🏢 Cadastrados pela imobiliária (sem corretor)', 'chk-alcance-corretor', meuLimite && !meuLimite.has(ALCANCE_IMOBILIARIA))}
    <div class="alcance-sub">Equipes</div>
    ${equipes.length ? equipes.map(e => item(e.id, `👥 ${escapeHtml(e.nome || '—')} <em class="muted">(${e.membros.length})</em>`, 'chk-alcance-equipe',
        meuLimite && e.membros.some(u => !meuLimite.has(u)))).join('') : '<span class="muted" style="font-size:12px;">Nenhuma equipe criada (Configurações → Equipes).</span>'}
    <div class="alcance-sub">Corretores</div>
    ${corretores.length ? corretores.map(c => item(c.uid, `${escapeHtml(c.nome)}${c.status && c.status !== 'ativo' ? ` <em class="muted">(${escapeHtml(c.status)})</em>` : ''}`, 'chk-alcance-corretor',
        meuLimite && !meuLimite.has(c.uid))).join('') : '<span class="muted" style="font-size:12px;">Nenhum corretor cadastrado.</span>'}`;
  return `
    <div class="perfil-alcance">
      <label class="perfil-op"><span>Mostrar</span>
        <select class="sel-alcance" data-modulo="${m.id}" ${dis} onchange="onAlcanceChange('${m.id}')">${opts}</select>
      </label>
      <div class="alcance-corretores" data-modulo="${m.id}" style="${atual === 'escolhidos' && p.ver ? '' : 'display:none;'}">${html}</div>
    </div>`;
}

function onAlcanceChange(moduloId) {
  const sel = document.querySelector(`.sel-alcance[data-modulo="${moduloId}"]`);
  const box = document.querySelector(`.alcance-corretores[data-modulo="${moduloId}"]`);
  if (box) box.style.display = (sel && !sel.disabled && sel.value === 'escolhidos') ? '' : 'none';
}

function lerAlcanceDoEditor(moduloId) {
  const sel = document.querySelector(`.sel-alcance[data-modulo="${moduloId}"]`);
  if (!sel) return null;
  const alcance = ALCANCES.includes(sel.value) ? sel.value : 'rede';
  if (alcance !== 'escolhidos') return { alcance, alcanceCorretores: [], alcanceEquipes: [], alcanceUids: [], alcanceMinhaEquipe: false };
  const marc = (cls) => [...document.querySelectorAll(`.${cls}[data-modulo="${moduloId}"]:checked`)].map(c => c.value);
  const alcanceCorretores = marc('chk-alcance-corretor');
  const alcanceEquipes = marc('chk-alcance-equipe');
  return {
    alcance, alcanceCorretores, alcanceEquipes,
    alcanceUids: resolverAlcanceUids(alcanceCorretores, alcanceEquipes, _equipesCache || []),
    alcanceMinhaEquipe: alcanceCorretores.includes(ALCANCE_MINHA_EQUIPE),
  };
}

// Perfil de corretor: o servidor só entrega "os dele" (blindagem 🔒). Opção maior
// na tela seria mentira — fica travada e explicada.
function travarAlcanceCorretor() {
  document.querySelectorAll('#perfil-modulos-container .sel-alcance').forEach(sel => {
    [...sel.options].forEach(o => {
      if (o.value !== 'proprios') { o.disabled = true; o.textContent = ALCANCE_LABEL[o.value] + ' (🔒 corretor)'; }
    });
    sel.value = 'proprios';
    onAlcanceChange(sel.dataset.modulo);
  });
}

Object.assign(window, {
  colecaoNoAlcance, aplicarAlcance, filtroAlcanceItens, onAlcanceChange, travarAlcanceCorretor,
  openEquipeModal, closeEquipeModal, saveEquipe, deleteEquipe, filtrarMembrosEquipe, loadEquipesTenant,
  recalcularVinculosAgora, agendarSincronizacaoVinculos,
});
