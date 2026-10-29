// Carteira de corretores (28/10/2026, pedido do dono — inspirado no Univen):
//   1. Distribuição automática de leads (captador do imóvel → rodízio/sorteio; cliente que volta
//      vai para o mesmo corretor). Config em tenants/{t}/config/distribuicaoLeads.
//   2. Transferir carteira (imóveis captados, proprietários e leads abertos) de um corretor
//      para outro — usado ao desligar alguém.
// Carregado depois do rede.js (usa listarCorretoresAtivos, gravarLeadDoCorretor, sincronizarFichaRede).
//
// ⚠️ A distribuição roda NO NAVEGADOR de quem é da equipe e tem "✅ Pode" em editar Leads:
// enquanto alguém assim estiver com o Rently aberto, confere a cada 2 minutos. Lead que chega
// com todo mundo fora é distribuído quando o primeiro abrir o sistema. Não há servidor rodando
// de madrugada — o aviso no card diz isso ao cliente.

const DIST_PADRAO = {
  ativo: false,
  regra: 'captador',        // 'captador' = captador do imóvel primeiro | 'reserva' = vai direto pra reserva
  reserva: 'rodizio',       // 'rodizio' | 'sorteio' | 'manual'
  retornoSemanas: 4,        // cliente que volta em até N semanas → mesmo corretor (0 = desliga)
  participantes: 'todos',   // 'todos' | 'equipe' | 'parceiro'
  incluirProprietarios: false, // "Anuncie seu imóvel" (proprietário querendo anunciar) também
  ativadoEm: null,          // só distribui lead que chegou depois de ligar
  rodizioUltimoUid: null,
};
const DIST_MOTIVO = { retorno: 'cliente voltou', captador: 'captador do imóvel', rodizio: 'rodízio', sorteio: 'sorteio' };
const DIST_INTERVALO_MS = 2 * 60 * 1000;
const STATUS_LEAD_FECHADO = ['convertido', 'descartado', 'devolvido'];

function _distRef() { return tenantPath().collection('config').doc('distribuicaoLeads'); }
async function getDistribuicao() {
  try { const s = await _distRef().get(); return { ...DIST_PADRAO, ...(s.exists ? s.data() : {}) }; }
  catch (_) { return { ...DIST_PADRAO }; }
}
function _ms(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  const d = new Date(ts); return isNaN(d) ? 0 : d.getTime();
}
function _distTel(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return d.length >= 10 ? d : '';
}

// =============================================================
// 1a. Card de configuração (tela Corretores)
// =============================================================
async function renderCardDistribuicao() {
  const box = $('card-distribuicao-leads');
  if (!box) return;
  const c = await getDistribuicao();
  const sel = (v, atual) => (v === atual ? 'selected' : '');
  box.innerHTML = `
    <h3>🎯 Distribuição automática de leads</h3>
    <p class="muted">Quem atende cada cliente novo, sem ninguém precisar repassar à mão.</p>
    <div style="font-size:12.5px; background:#EFF6FF; color:#1E3A8A; border-left:3px solid #2563EB; padding:10px 12px; margin:8px 0 14px; line-height:1.65;">
      <strong>ℹ️ Como funciona</strong><br>
      1. Chegou um lead novo (site, portal, lead manual) e ele está <strong>sem corretor</strong>.<br>
      2. <strong>Cliente que volta</strong>: se o mesmo telefone/e-mail falou com um corretor nas últimas <em>N</em> semanas, vai para <strong>o mesmo corretor</strong>.<br>
      3. Senão, se a regra for <strong>“captador primeiro”</strong> e o lead veio de um imóvel captado por corretor ativo, vai para <strong>quem captou</strong>.<br>
      4. Senão, vai para a <strong>reserva</strong>: <strong>rodízio</strong> (um de cada vez, em ordem alfabética), <strong>sorteio</strong>, ou fica para <strong>repasse manual</strong>.<br>
      5. O corretor vê em <strong>📥 Meus leads</strong> (com o selo vermelho de novo) — <strong>sem telefone/e-mail do cliente</strong>, como sempre. Na tela Leads aparece <strong>🤖 automático</strong> e o motivo; dá para trocar com <strong>👤 Trocar</strong>.<br>
      ⚠️ <strong>Quando roda:</strong> a conferência é feita pelo Rently aberto de alguém da equipe com permissão de editar Leads, a cada 2 minutos.
      Lead que chega com todo mundo fora (de madrugada, por exemplo) é distribuído assim que o primeiro abrir o sistema.
      Só entram leads que chegarem <strong>depois de ligar</strong>; corretor suspenso ou pendente nunca recebe.
    </div>
    <div class="form-group"><label class="toggle-row" style="cursor:pointer;"><input type="checkbox" id="dist-ativo" ${c.ativo ? 'checked' : ''}>
      <span><strong>Ligar a distribuição automática</strong></span></label></div>
    <div class="form-row">
      <div class="form-group"><label for="dist-regra">Primeiro critério</label>
        <select id="dist-regra">
          <option value="captador" ${sel('captador', c.regra)}>⭐ Captador do imóvel primeiro</option>
          <option value="reserva" ${sel('reserva', c.regra)}>Ignorar captador — direto para a reserva</option>
        </select></div>
      <div class="form-group"><label for="dist-reserva">Reserva (sem captador)</label>
        <select id="dist-reserva">
          <option value="rodizio" ${sel('rodizio', c.reserva)}>🔄 Rodízio entre os ativos</option>
          <option value="sorteio" ${sel('sorteio', c.reserva)}>🎲 Sorteio entre os ativos</option>
          <option value="manual" ${sel('manual', c.reserva)}>✋ Deixar para repasse manual</option>
        </select></div>
      <div class="form-group"><label for="dist-retorno">Cliente que volta (semanas)</label>
        <input type="number" id="dist-retorno" min="0" max="52" value="${Number(c.retornoSemanas) || 0}">
        <small class="muted">0 = não considerar</small></div>
      <div class="form-group"><label for="dist-participantes">Quem participa</label>
        <select id="dist-participantes">
          <option value="todos" ${sel('todos', c.participantes)}>Todos os corretores ativos</option>
          <option value="equipe" ${sel('equipe', c.participantes)}>Só corretores da equipe</option>
          <option value="parceiro" ${sel('parceiro', c.participantes)}>Só parceiros</option>
        </select></div>
    </div>
    <div class="form-group"><label class="toggle-row" style="cursor:pointer;"><input type="checkbox" id="dist-proprietarios" ${c.incluirProprietarios ? 'checked' : ''}>
      <span>Distribuir também os proprietários que pedem para anunciar (“Anuncie seu imóvel”)</span></label></div>
    ${c.ativo && c.ativadoEm ? `<p class="muted" style="font-size:11.5px;">Ligada desde ${escapeHtml(new Date(_ms(c.ativadoEm)).toLocaleString('pt-BR'))}.</p>` : ''}
    <div id="dist-status" style="margin-top:8px;"></div>
    <button class="btn btn-primary" id="btn-dist-salvar" onclick="salvarDistribuicao()">💾 Salvar distribuição</button>`;
}

async function salvarDistribuicao() {
  if (!exigirPode('corretores', 'editar', 'dist-status')) return;
  const btn = $('btn-dist-salvar');
  const atual = await getDistribuicao();
  const ativo = $('dist-ativo').checked;
  const dados = {
    ativo,
    regra: $('dist-regra').value,
    reserva: $('dist-reserva').value,
    retornoSemanas: Math.max(0, Math.min(52, parseInt($('dist-retorno').value, 10) || 0)),
    participantes: $('dist-participantes').value,
    incluirProprietarios: $('dist-proprietarios').checked,
    // ligou agora → só leads daqui pra frente (não despeja o histórico em ninguém)
    ativadoEm: ativo ? (atual.ativo && atual.ativadoEm ? atual.ativadoEm : firebase.firestore.FieldValue.serverTimestamp()) : null,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    atualizadoPor: State.user.uid,
  };
  btn.disabled = true; btn.textContent = '⏳ Salvando…';
  try {
    await _distRef().set(dados, { merge: true });
    logAuditoria('update', 'config', 'distribuicaoLeads', { ativo, regra: dados.regra, reserva: dados.reserva, retornoSemanas: dados.retornoSemanas });
    showInlineStatus('dist-status', ativo ? '✓ Distribuição automática ligada.' : '✓ Salvo — distribuição desligada.', 'success', 5000);
    renderCardDistribuicao();
    if (ativo) distribuirLeadsPendentes();
  } catch (err) {
    showInlineStatus('dist-status', `❌ ${escapeHtml(err.message)}`, 'error');
  } finally { btn.disabled = false; btn.textContent = '💾 Salvar distribuição'; }
}

// =============================================================
// 1b. Distribuidor
// =============================================================
let _distTimer = null;
let _distRodando = false;

function iniciarDistribuicaoLeads() {
  if (_distTimer || !State.tenant || isCorretor()) return;
  if (typeof nivelPermissao === 'function' && nivelPermissao('leads', 'editar') !== 'sim') return;
  setTimeout(distribuirLeadsPendentes, 8000);   // deixa o app terminar de abrir
  _distTimer = setInterval(distribuirLeadsPendentes, DIST_INTERVALO_MS);
}

async function _participantes(cfg) {
  _corretoresAtivosCache = null;
  const todos = await listarCorretoresAtivos();
  return todos.filter(c => !c.semConta && (cfg.participantes === 'todos' || (c.tipo || 'parceiro') === cfg.participantes));
}

async function _escolherCorretor(lead, cfg, corretores, recentes) {
  const ativos = new Set(corretores.map(c => c.uid));
  if (cfg.retornoSemanas > 0) {
    const tel = _distTel(lead.telefone);
    const email = String(lead.email || '').trim().toLowerCase();
    const limite = _ms(lead.criadoEm || Date.now()) - cfg.retornoSemanas * 7 * 86400000;
    const anterior = recentes.find(l => l._id !== lead._id && l.corretorUid && ativos.has(l.corretorUid)
      && _ms(l.criadoEm) >= limite
      && ((tel && _distTel(l.telefone) === tel) || (email && String(l.email || '').trim().toLowerCase() === email)));
    if (anterior) return { uid: anterior.corretorUid, motivo: 'retorno' };
  }
  if (cfg.regra === 'captador' && lead.imovelId) {
    try {
      const im = await tenantPath().collection('imoveis').doc(lead.imovelId).get();
      const cap = im.exists ? im.data().criadoPor : null;
      if (cap && ativos.has(cap)) return { uid: cap, motivo: 'captador' };
    } catch (_) {}
  }
  if (!corretores.length || cfg.reserva === 'manual') return null;
  if (cfg.reserva === 'sorteio') {
    const a = new Uint32Array(1); crypto.getRandomValues(a);
    return { uid: corretores[a[0] % corretores.length].uid, motivo: 'sorteio' };
  }
  return { uid: null, motivo: 'rodizio' };   // o próximo da fila é decidido dentro da transação
}

function _leadElegivel(l, cfg) {
  if (l.corretorUid || l.distribuicaoAuto) return false;
  if ((l.status || 'novo') !== 'novo') return false;
  if (_ms(l.criadoEm) < _ms(cfg.ativadoEm)) return false;
  const proprietario = l.origem === 'vitrine_publica' || l.tipoLead === 'proprietario';
  return !proprietario || cfg.incluirProprietarios;
}

async function distribuirLeadsPendentes() {
  if (_distRodando || !State.tenant || isCorretor()) return;
  _distRodando = true;
  try {
    const cfg = await getDistribuicao();
    if (!cfg.ativo || !cfg.ativadoEm) return;
    const snap = await tenantPath().collection('leadsImoveis').orderBy('criadoEm', 'desc').limit(300).get();
    const recentes = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    const pendentes = recentes.filter(l => _leadElegivel(l, cfg)).reverse();   // mais antigo primeiro
    if (!pendentes.length) return;
    const corretores = await _participantes(cfg);
    let feitos = 0;
    for (const lead of pendentes) {
      const escolha = await _escolherCorretor(lead, cfg, corretores, recentes);
      const r = await _atribuirAuto(lead, escolha, corretores);
      if (r && r.uid) {
        feitos++;
        lead.corretorUid = r.uid;   // vale para o "cliente que volta" dos próximos desta rodada
      }
    }
    if (feitos && $('section-leads')?.style.display !== 'none' && typeof loadLeads === 'function') loadLeads();
  } catch (e) {
    console.warn('Distribuição automática de leads:', e);
  } finally { _distRodando = false; }
}

// Grava a atribuição numa transação: se outra pessoa da equipe (outra aba) já distribuiu, não faz nada.
async function _atribuirAuto(lead, escolha, corretores) {
  const leadRef = tenantPath().collection('leadsImoveis').doc(lead._id);
  const cfgRef = _distRef();
  const res = await db.runTransaction(async (tx) => {
    const ls = await tx.get(leadRef);
    const cs = await tx.get(cfgRef);
    if (!ls.exists) return null;
    const atual = ls.data();
    if (atual.corretorUid || atual.distribuicaoAuto || (atual.status || 'novo') !== 'novo') return null;
    let uid = escolha ? escolha.uid : null;
    const motivo = escolha ? escolha.motivo : null;
    if (motivo === 'rodizio') {
      const fila = corretores.map(c => c.uid);
      const ultimo = cs.exists ? cs.data().rodizioUltimoUid : null;
      uid = fila.length ? fila[(fila.indexOf(ultimo) + 1) % fila.length] : null;
      if (uid) tx.set(cfgRef, { rodizioUltimoUid: uid }, { merge: true });
    }
    const marca = { em: new Date().toISOString(), por: State.user.uid, motivo: uid ? motivo : 'sem_corretor' };
    if (!uid) { tx.update(leadRef, { distribuicaoAuto: marca }); return { uid: null }; }
    const corretor = corretores.find(c => c.uid === uid) || {};
    const historico = Array.isArray(atual.historico) ? atual.historico.slice(-30) : [];
    historico.push(entradaHistoricoLead('repassado', { paraUid: uid, paraNome: corretor.nome || null, auto: true, motivo }));
    const dados = {
      corretorUid: uid,
      corretorNome: corretor.nome || null,
      atribuidoEm: firebase.firestore.FieldValue.serverTimestamp(),
      atribuidoPor: 'auto',
      notaRepasse: `🤖 Distribuído automaticamente (${DIST_MOTIVO[motivo] || motivo}).`,
      historico,
      distribuicaoAuto: marca,
    };
    tx.update(leadRef, dados);
    return { uid, dados, corretor };
  });
  if (res && res.uid) {
    await gravarLeadDoCorretor(lead._id, { ...lead, ...res.dados, atribuidoEm: new Date() }, res.uid);
    logAuditoria('repassar', 'lead', lead._id, { para: res.uid, paraNome: res.corretor.nome || null, automatico: true, motivo: escolha.motivo });
  }
  return res;
}

// =============================================================
// 2. Transferir carteira
// =============================================================
async function openTransferirCarteira(uid) {
  if (!exigirPode('corretores', 'editar', 'corretores-status')) return;
  let m = $('modal-carteira');
  if (!m) {
    m = document.createElement('div');
    m.className = 'modal-overlay'; m.id = 'modal-carteira';
    document.body.appendChild(m);
  }
  m.innerHTML = `<div class="modal"><div class="modal-header"><h3>🔁 Transferir carteira</h3>
    <button class="modal-close" onclick="$('modal-carteira').style.display='none'">×</button></div>
    <div class="modal-body"><p class="muted">⏳ Levantando a carteira…</p></div></div>`;
  m.style.display = 'flex';

  const T = tenantPath();
  const [cartaoSnap, imSnap, locSnap, leadSnap, corretores] = await Promise.all([
    T.collection('corretores').doc(uid).get(),
    T.collection('imoveis').where('criadoPor', '==', uid).get(),
    T.collection('locadores').where('criadoPor', '==', uid).get(),
    T.collection('leadsImoveis').where('corretorUid', '==', uid).get(),
    (async () => { _corretoresAtivosCache = null; return listarCorretoresAtivos(); })(),
  ]);
  const nome = cartaoSnap.exists ? (cartaoSnap.data().nome || 'corretor') : 'corretor';
  const leadsAbertos = leadSnap.docs.filter(d => !STATUS_LEAD_FECHADO.includes(d.data().status || 'novo'));
  const destinos = corretores.filter(c => c.uid !== uid && !c.semConta);
  const opcoes = destinos.map(c => `<option value="${c.uid}">${escapeHtml(c.nome || c.email || c.uid)}</option>`).join('');
  window._carteiraAtual = { uid, nome, imoveis: imSnap.docs.map(d => d.id), locadores: locSnap.docs.map(d => d.id), leads: leadsAbertos.map(d => ({ _id: d.id, ...d.data() })) };

  m.querySelector('.modal-body').innerHTML = `
    <p>Carteira de <strong>${escapeHtml(nome)}</strong>:</p>
    <ul style="margin:6px 0 12px 18px; line-height:1.7;">
      <li>🏠 <strong>${imSnap.size}</strong> imóvel(is) captado(s)</li>
      <li>👤 <strong>${locSnap.size}</strong> proprietário(s) cadastrado(s) por ele</li>
      <li>📥 <strong>${leadsAbertos.length}</strong> lead(s) em aberto</li>
    </ul>
    <div style="font-size:12.5px; background:#EFF6FF; color:#1E3A8A; border-left:3px solid #2563EB; padding:8px 10px; margin-bottom:12px; line-height:1.6;">
      ℹ️ Os imóveis e proprietários passam a ser do novo corretor (ele vê e edita como se tivesse captado; a ficha da rede é refeita).
      Os leads abertos mudam de dono e somem do “Meus leads” de ${escapeHtml(nome)}. Comissões de negócios já fechados <strong>não mudam</strong>.
      Tudo fica na Auditoria.
    </div>
    <div id="carteira-alert" class="alert alert-error" style="display:none;"></div>
    <div class="form-group"><label>Imóveis e proprietários vão para</label>
      <select id="carteira-dest-imoveis"><option value="">— Não transferir —</option><option value="__imob">🏢 A imobiliária (equipe interna)</option>${opcoes}</select></div>
    <div class="form-group"><label>Leads em aberto vão para</label>
      <select id="carteira-dest-leads"><option value="">— Não transferir —</option><option value="__imob">🏢 Voltar para a imobiliária (sem corretor)</option>${opcoes}</select></div>
    <div id="carteira-status"></div>`;
  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  footer.innerHTML = `<button class="btn btn-secondary" onclick="$('modal-carteira').style.display='none'">Cancelar</button>
    <button class="btn btn-primary" id="btn-carteira" onclick="confirmarTransferirCarteira()">🔁 Transferir</button>`;
  m.querySelector('.modal').appendChild(footer);
}

async function confirmarTransferirCarteira() {
  const cart = window._carteiraAtual;
  if (!cart) return;
  const destIm = $('carteira-dest-imoveis').value;
  const destLd = $('carteira-dest-leads').value;
  if (!destIm && !destLd) { showAlert('carteira-alert', 'Escolha para onde vai pelo menos uma parte da carteira.'); return; }
  const corretores = _corretoresAtivosCache || [];
  const nomeDe = (v) => v === '__imob' ? 'a imobiliária' : (corretores.find(c => c.uid === v)?.nome || 'corretor');
  if (!(await confirmar({
    titulo: 'Transferir a carteira?',
    mensagem: [destIm ? `🏠 ${cart.imoveis.length} imóvel(is) e 👤 ${cart.locadores.length} proprietário(s) → <strong>${escapeHtml(nomeDe(destIm))}</strong>` : '',
      destLd ? `📥 ${cart.leads.length} lead(s) → <strong>${escapeHtml(nomeDe(destLd))}</strong>` : ''].filter(Boolean).join('<br>'),
    detalhe: `Sai da carteira de ${escapeHtml(cart.nome)}.`,
    confirmar: '🔁 Transferir', aviso: true,
  }))) return;

  const btn = $('btn-carteira');
  btn.disabled = true;
  const T = tenantPath();
  const st = (t) => showInlineStatus('carteira-status', t, 'loading');
  const agora = new Date().toISOString();
  let feitos = { imoveis: 0, locadores: 0, leads: 0 };
  try {
    if (destIm) {
      const novoDono = destIm === '__imob' ? State.user.uid : destIm;
      for (const id of cart.imoveis) {
        st(`⏳ Imóveis ${++feitos.imoveis}/${cart.imoveis.length}…`);
        await T.collection('imoveis').doc(id).update({ criadoPor: novoDono, carteiraAnterior: { uid: cart.uid, nome: cart.nome, transferidoEm: agora, por: State.user.uid } });
        if (typeof sincronizarFichaRede === 'function') await sincronizarFichaRede(id).catch(e => console.warn('ficha', id, e));
      }
      for (const id of cart.locadores) {
        st(`⏳ Proprietários ${++feitos.locadores}/${cart.locadores.length}…`);
        await T.collection('locadores').doc(id).update({ criadoPor: novoDono, carteiraAnterior: { uid: cart.uid, nome: cart.nome, transferidoEm: agora } });
      }
    }
    if (destLd) {
      const paraUid = destLd === '__imob' ? null : destLd;
      const para = paraUid ? corretores.find(c => c.uid === paraUid) : null;
      for (const lead of cart.leads) {
        st(`⏳ Leads ${++feitos.leads}/${cart.leads.length}…`);
        const historico = Array.isArray(lead.historico) ? lead.historico.slice(-30) : [];
        historico.push(entradaHistoricoLead(paraUid ? 'transferido' : 'retirado', { deNome: cart.nome, paraUid, paraNome: para?.nome || null, carteira: true }));
        const dados = {
          corretorUid: paraUid, corretorNome: para?.nome || null,
          atribuidoEm: paraUid ? firebase.firestore.FieldValue.serverTimestamp() : null,
          atribuidoPor: paraUid ? State.user.uid : null,
          notaRepasse: paraUid ? `Carteira transferida de ${cart.nome}.` : null,
          historico,
        };
        await T.collection('leadsImoveis').doc(lead._id).update(dados);
        await gravarLeadDoCorretor(lead._id, { ...lead, ...dados, atribuidoEm: new Date() }, paraUid);
      }
    }
    logAuditoria('transferir_carteira', 'corretor', cart.uid, {
      de: cart.nome, imoveisPara: destIm || null, leadsPara: destLd || null,
      imoveis: destIm ? cart.imoveis.length : 0, proprietarios: destIm ? cart.locadores.length : 0, leads: destLd ? cart.leads.length : 0,
    });
    $('modal-carteira').style.display = 'none';
    showInlineStatus('corretores-status', `✅ Carteira de ${escapeHtml(cart.nome)} transferida.`, 'success', 8000);
    if (typeof invalidateImoveisCache === 'function') invalidateImoveisCache();
    if (typeof invalidateLocadoresCache === 'function') invalidateLocadoresCache();
    loadCorretores();
  } catch (err) {
    console.error('Transferir carteira:', err);
    showAlert('carteira-alert', `Parou no meio (${feitos.imoveis} imóveis, ${feitos.locadores} proprietários, ${feitos.leads} leads já foram). Erro: ${err.message}. Abra de novo para terminar o resto.`);
    btn.disabled = false;
  }
}

window.renderCardDistribuicao = renderCardDistribuicao;
window.salvarDistribuicao = salvarDistribuicao;
window.iniciarDistribuicaoLeads = iniciarDistribuicaoLeads;
window.distribuirLeadsPendentes = distribuirLeadsPendentes;
window.openTransferirCarteira = openTransferirCarteira;
window.confirmarTransferirCarteira = confirmarTransferirCarteira;
