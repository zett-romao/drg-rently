// =============================================================
// DRG-Rently — alcance.js
// "Alcance" de cada módulo no perfil (dono, 29/10/2026): além de Ver/Criar/
// Editar/Excluir, QUAIS registros a pessoa enxerga naquele módulo:
//   'proprios'   → só os vinculados a ela
//   'escolhidos' → os dela + os dos corretores escolhidos (e, se marcado, os da equipe)
//   'rede'       → todos (padrão da equipe interna — como sempre foi)
//
// Vínculo de um registro = quem cadastrou/captou (criadoPor); lead = corretor a quem
// foi repassado (corretorUid). Contrato, negociação e balancete herdam o vínculo do
// imóvel; proprietário, locatário, garantia e comprador também ficam vinculados a
// quem captou o imóvel do contrato/negociação deles.
//
// ⚠️ Corretor: o servidor já limita a "só os dele" (blindagem 🔒) — aqui não amplia nada.
// ⚠️ Equipe interna: é filtro de TELA; as regras do Firestore liberam o tenant à equipe.
// =============================================================

const ALCANCES = ['proprios', 'escolhidos', 'rede'];
const ALCANCE_LABEL = {
  proprios: '👤 Só os vinculados a ele',
  escolhidos: '👥 Dele + corretores escolhidos',
  rede: '🌐 Toda a rede (todos)',
};
// Pseudo-corretor da lista: "o que a equipe da imobiliária cadastrou (sem corretor)"
const ALCANCE_IMOBILIARIA = '__imobiliaria';
function rankAlcance(a) { const i = ALCANCES.indexOf(a); return i < 0 ? ALCANCES.length - 1 : i; }

function alcancePadrao(role) { return role === 'corretor' ? 'proprios' : 'rede'; }

// Lê o alcance salvo no perfil (chamado pelo normalizarPerfil)
function normalizarAlcance(p, role) {
  const alcance = ALCANCES.includes(p && p.alcance) ? p.alcance : alcancePadrao(role);
  const lista = (p && Array.isArray(p.alcanceCorretores)) ? p.alcanceCorretores.filter(s => typeof s === 'string' && s) : [];
  return { alcance, alcanceCorretores: alcance === 'escolhidos' ? [...new Set(lista)] : [] };
}

// Delegação: ninguém concede alcance maior que o próprio. Retorna o texto do excesso ou ''.
function excessoAlcance(p, eu) {
  const a = p.alcance || 'rede', meu = eu.alcance || 'rede';
  if (rankAlcance(a) > rankAlcance(meu)) return ALCANCE_LABEL[a];
  if (a === 'escolhidos' && meu === 'escolhidos') {
    const fora = (p.alcanceCorretores || []).filter(u => !(eu.alcanceCorretores || []).includes(u));
    if (fora.length) return `${fora.length} corretor(es) fora do seu alcance`;
  }
  return '';
}

// Alcance em vigor para o usuário logado num módulo. null = sem filtro.
// Corretor: null aqui porque a consulta dele já vem cortada pelo servidor (queryDoUsuario/regras).
function alcanceDoModulo(modulo) {
  const role = State.userDoc?.role;
  if (role === 'super_admin' || role === 'corretor') return null;
  const p = perfilAtual().permissoes?.[modulo];
  if (!p || !p.alcance || p.alcance === 'rede') return null;
  const uids = new Set([State.user.uid]);
  if (p.alcance === 'escolhidos') (p.alcanceCorretores || []).forEach(u => uids.add(u));
  return { tipo: p.alcance, uids };
}

// ---------- Índice de vínculos (1 leitura por coleção, vale 60s) ----------
let _alcanceIdx = null;
let _alcanceIdxEm = 0;
function invalidarIndiceAlcance() { _alcanceIdx = null; }

async function indiceVinculos() {
  if (_alcanceIdx && Date.now() - _alcanceIdxEm < 60000) return _alcanceIdx;
  const ler = (c) => tenantPath().collection(c).get().then(s => s.docs).catch(() => []);
  const [imoveis, contratos, negociacoes, corretores] = await Promise.all(
    ['imoveis', 'contratos', 'negociacoes', 'corretores'].map(ler));

  const mapa = {};   // 'colecao/id' → Set(uids)
  const add = (col, id, ...uids) => {
    if (!id) return;
    const k = col + '/' + id;
    const s = mapa[k] || (mapa[k] = new Set());
    uids.flat().forEach(u => { if (u) s.add(u); });
  };
  const doImovel = {};
  imoveis.forEach(d => {
    const im = d.data();
    doImovel[d.id] = im.criadoPor || null;
    add('imoveis', d.id, im.criadoPor);
    add('locadores', im.locadorId, im.criadoPor);
  });
  contratos.forEach(d => {
    const c = d.data();
    const quem = [c.criadoPor, doImovel[c.imovelId]];
    add('contratos', d.id, quem);
    add('locatarios', c.locatarioId, quem);
    add('garantias', c.garantiaId, quem);
    add('locadores', c.locadorId, quem);
    (c.locadoresAdicionais || []).forEach(l => add('locadores', l, quem));
  });
  negociacoes.forEach(d => {
    const n = d.data();
    const div = n.divisaoComissao || {};
    const quem = [n.criadoPor, doImovel[n.imovelId], div.captadorUid, div.vendedorUid];
    add('negociacoes', d.id, quem);
    add('compradores', n.compradorId, quem);
    add('locadores', n.vendedorId, quem);
  });
  _alcanceIdx = { mapa, doImovel, corretores: new Set(corretores.map(d => d.id)) };
  _alcanceIdxEm = Date.now();
  return _alcanceIdx;
}

// Os uids vinculados a um registro (o próprio criadoPor/corretorUid + o que vem pelo índice)
function vinculosDe(idx, colecao, id, dados) {
  const s = new Set(idx.mapa[colecao + '/' + id] || []);
  if (colecao === 'leadsImoveis') { if (dados.corretorUid) s.add(dados.corretorUid); return s; }
  if (dados.criadoPor) s.add(dados.criadoPor);
  if (dados.imovelId && idx.doImovel[dados.imovelId]) s.add(idx.doImovel[dados.imovelId]);
  if (dados.contratoId) (idx.mapa['contratos/' + dados.contratoId] || []).forEach(u => s.add(u));
  return s;
}

function dentroDoAlcance(idx, al, colecao, id, dados) {
  const vs = vinculosDe(idx, colecao, id, dados || {});
  for (const u of vs) if (al.uids.has(u)) return true;
  // "Equipe da imobiliária": registro sem nenhum corretor vinculado (lead sem corretor também)
  if (al.uids.has(ALCANCE_IMOBILIARIA) && ![...vs].some(u => idx.corretores.has(u))) return true;
  return false;
}

// Corta um QuerySnapshot (ou objeto { docs }) pelo alcance do módulo.
// Devolve a mesma forma ({ docs, empty, size }) — os loaders não mudam.
async function aplicarAlcance(modulo, colecao, snap) {
  const al = alcanceDoModulo(modulo);
  if (!al) return snap;
  const idx = await indiceVinculos();
  const docs = snap.docs.filter(d => dentroDoAlcance(idx, al, colecao, d.id, d.data()));
  return { docs, empty: docs.length === 0, size: docs.length };
}

// Para listas de alertas/eventos: cada item diz de qual coleção/registro nasceu ({ colecao, id, dados }).
async function filtroAlcanceItens(modulo) {
  const al = alcanceDoModulo(modulo);
  if (!al) return () => true;
  const idx = await indiceVinculos();
  return (colecao, id, dados) => dentroDoAlcance(idx, al, colecao, id, dados);
}

// Aviso discreto acima da lista: "mostrando só os vinculados a você"
function avisoAlcanceHtml(modulo) {
  const al = alcanceDoModulo(modulo);
  if (!al) return '';
  const txt = al.tipo === 'proprios' ? 'só os vinculados a você'
    : `os seus + ${al.uids.size - 1} escolhido(s) no seu perfil`;
  return `<div class="alcance-aviso">👁 Mostrando ${txt} (alcance definido no seu perfil de permissões).</div>`;
}
function mostrarAvisoAlcance(modulo, ancoraId) {
  const ancora = $(ancoraId);
  if (!ancora) return;
  const tabela = ancora.closest('table') || ancora;
  let box = tabela.parentElement.querySelector(':scope > .alcance-aviso[data-mod="' + modulo + '"]');
  const html = avisoAlcanceHtml(modulo);
  if (!html) { if (box) box.remove(); return; }
  if (!box) {
    tabela.insertAdjacentHTML('beforebegin', html);
    box = tabela.previousElementSibling;
    box.dataset.mod = modulo;
  }
}

// ---------- Editor de perfil ----------
let _alcanceCorretoresLista = null;   // [{ uid, nome }]
async function carregarCorretoresParaAlcance() {
  if (_alcanceCorretoresLista) return _alcanceCorretoresLista;
  try {
    const snap = await tenantPath().collection('corretores').get();
    _alcanceCorretoresLista = snap.docs.map(d => ({ uid: d.id, nome: d.data().nome || d.data().email || d.id, status: d.data().status || '' }))
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  } catch (_) { _alcanceCorretoresLista = []; }
  return _alcanceCorretoresLista;
}

// Bloco "Mostrar" dentro do card do módulo. limite = alcance de quem está editando.
function renderAlcanceModulo(m, p, limite, travado) {
  const souSuper = State.userDoc?.role === 'super_admin';
  const limiteRank = souSuper ? 2 : rankAlcance(limite.alcance || 'rede');
  const atual = p.alcance || 'rede';
  const dis = (travado || !p.ver) ? 'disabled' : '';
  const opts = ALCANCES.map(a => {
    const acima = rankAlcance(a) > limiteRank;
    return `<option value="${a}" ${a === atual ? 'selected' : ''} ${acima ? 'disabled' : ''}>${ALCANCE_LABEL[a]}${acima ? ' (acima do seu)' : ''}</option>`;
  }).join('');
  const marcados = new Set(p.alcanceCorretores || []);
  const meusEscolhidos = (!souSuper && limite.alcance === 'escolhidos') ? new Set(limite.alcanceCorretores || []) : null;
  const corretores = [{ uid: ALCANCE_IMOBILIARIA, nome: '🏢 Equipe da imobiliária (sem corretor)' }, ...(_alcanceCorretoresLista || [])];
  const lista = corretores.map(c => {
    const bloqueado = meusEscolhidos && !meusEscolhidos.has(c.uid);
    return `<label class="alcance-corretor${bloqueado ? ' bloqueado' : ''}">
      <input type="checkbox" class="chk-alcance-corretor" data-modulo="${m.id}" value="${escapeHtml(c.uid)}"
        ${marcados.has(c.uid) ? 'checked' : ''} ${(travado || bloqueado) ? 'disabled' : ''}>
      <span>${escapeHtml(c.nome)}${c.status && c.status !== 'ativo' ? ` <em class="muted">(${escapeHtml(c.status)})</em>` : ''}</span>
    </label>`;
  }).join('') || '<span class="muted">Nenhum corretor cadastrado.</span>';
  return `
    <div class="perfil-alcance">
      <label class="perfil-op"><span>Mostrar</span>
        <select class="sel-alcance" data-modulo="${m.id}" ${dis} onchange="onAlcanceChange('${m.id}')">${opts}</select>
      </label>
      <div class="alcance-corretores" data-modulo="${m.id}" style="${atual === 'escolhidos' && p.ver ? '' : 'display:none;'}">
        ${lista}
      </div>
    </div>`;
}

function onAlcanceChange(moduloId) {
  const sel = document.querySelector(`.sel-alcance[data-modulo="${moduloId}"]`);
  const box = document.querySelector(`.alcance-corretores[data-modulo="${moduloId}"]`);
  if (box) box.style.display = (sel && !sel.disabled && sel.value === 'escolhidos') ? '' : 'none';
}
window.onAlcanceChange = onAlcanceChange;

function lerAlcanceDoEditor(moduloId) {
  const sel = document.querySelector(`.sel-alcance[data-modulo="${moduloId}"]`);
  if (!sel) return null;
  const alcance = ALCANCES.includes(sel.value) ? sel.value : 'rede';
  const alcanceCorretores = alcance === 'escolhidos'
    ? [...document.querySelectorAll(`.chk-alcance-corretor[data-modulo="${moduloId}"]:checked`)].map(c => c.value)
    : [];
  return { alcance, alcanceCorretores };
}

window.aplicarAlcance = aplicarAlcance;
window.filtroAlcanceItens = filtroAlcanceItens;
window.invalidarIndiceAlcance = invalidarIndiceAlcance;

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
window.travarAlcanceCorretor = travarAlcanceCorretor;
