// =============================================================
// ✅ CHECKLIST DE DILIGÊNCIA — venda e compra (12/11/2026, pedido do dono)
//
// "precisamos de um local para anexar estes documentos para ficar registrado e
//  isso já deve fazer parte de um check list de venda e compra lá no rently"
//
// Mora DENTRO da negociação (Operação › Negociações), porque a diligência é
// daquela venda, daquele vendedor, naquele momento: certidão vence.
//
//  - Firestore: negociacoes/{id}.checklist = { itemId: {...} }   (mapa, não array:
//    cada item grava sozinho por `checklist.<itemId>` e duas pessoas mexendo em
//    itens diferentes não se atropelam).
//  - Storage:   negociacoes/{id}/checklist/{itemId}/{arquivo}
//    (subpasta: a lista geral de "Documentos" da negociação continua só com os
//    arquivos soltos, e o certificado fica preso ao item que ele prova).
//
// Cada item tem situação, nº do pedido, observação e anexos. A situação
// "⚠️ Positiva" existe de propósito: certidão que CONSTA alguma coisa não é
// "feito" — é o que o advogado precisa olhar antes de assinar.
// =============================================================

const CHK_STATUS = {
  pendente:  { rotulo: '⏳ Pendente',            cor: '#64748B', fundo: '#F1F5F9' },
  pedida:    { rotulo: '📨 Pedida / aguardando', cor: '#1E40AF', fundo: '#DBEAFE' },
  negativa:  { rotulo: '✓ Negativa (ok)',        cor: '#166534', fundo: '#DCFCE7' },
  positiva:  { rotulo: '⚠️ Positiva — analisar', cor: '#92400E', fundo: '#FEF3C7' },
  nao_aplica:{ rotulo: '— Não se aplica',        cor: '#6B7280', fundo: '#F3F4F6' },
};
const CHK_CONCLUIDOS = ['negativa', 'positiva', 'nao_aplica'];

// Certidões por PESSOA (vendedor e, se casado, o cônjuge). São Paulo: TJSP/TRF3/TRT2.
const CHK_PESSOA = [
  { k: 'doc_id',     t: 'RG/CNH e CPF',                                            l: '' },
  { k: 'civil',      t: 'Certidão de casamento/nascimento atualizada (≤ 90 dias)', l: 'https://registrocivil.org.br/' },
  { k: 'rfb',        t: 'CND federal — Receita/PGFN',                              l: 'https://servicos.receitafederal.gov.br/servico/certidoes/#/home/cpf' },
  { k: 'cndt',       t: 'CNDT — débitos trabalhistas (TST)',                       l: 'https://cndt-certidao.tst.jus.br/inicio.faces' },
  { k: 'trt2',       t: 'TRT-2 — ações trabalhistas',                              l: 'https://pje.trt2.jus.br/certidoes/trabalhista/emissao' },
  { k: 'trf3_civ',   t: 'TRF-3 — cível (inclui execuções fiscais)',                l: 'https://web.trf3.jus.br/certidao-regional/CertidaoCivelEleitoralCriminal/SolicitarDadosCertidao' },
  { k: 'trf3_crim',  t: 'TRF-3 — criminal',                                        l: 'https://web.trf3.jus.br/certidao-regional/CertidaoCivelEleitoralCriminal/SolicitarDadosCertidao' },
  { k: 'tj_civel',   t: 'TJSP (SAJ) — distribuição cível em geral',                l: 'https://esaj.tjsp.jus.br/sco/abrirCadastro.do' },
  { k: 'tj_falen',   t: 'TJSP (SAJ) — falências e recuperações',                   l: 'https://esaj.tjsp.jus.br/sco/abrirCadastro.do' },
  { k: 'tj_crim',    t: 'TJSP (SAJ) — ações criminais',                            l: 'https://esaj.tjsp.jus.br/sco/abrirCadastro.do' },
  { k: 'tj_execcr',  t: 'TJSP (SAJ) — execuções criminais',                        l: 'https://esaj.tjsp.jus.br/sco/abrirCadastro.do' },
  { k: 'tj_eproc',   t: 'TJSP (eproc) — cível e criminal (complementa o SAJ)',     l: 'https://www.tjsp.jus.br/Certidoes' },
  { k: 'protesto',   t: 'Protestos — CENPROT (5 anos)',                            l: 'https://www.pesquisaprotesto.com.br/' },
  { k: 'pge',        t: 'Dívida ativa estadual — PGE-SP',                          l: 'https://www.dividaativa.pge.sp.gov.br/sc/pages/crda/emitirCrda.jsf' },
  { k: 'cnib',       t: 'Indisponibilidade de bens — CNIB',                        l: 'https://indisponibilidade.onr.org.br/' },
];
const CHK_IMOVEL = [
  { k: 'matricula',  t: 'Matrícula atualizada c/ ônus e ações reais e pessoais reipersecutórias (≤ 30 dias)', l: 'https://www.registradores.org.br/' },
  { k: 'iptu_cnd',   t: 'CND de IPTU do imóvel (Prefeitura)',                      l: '' },
  { k: 'iptu_capa',  t: 'Capa/espelho do IPTU do ano (titular cadastrado bate com a matrícula?)', l: '' },
  { k: 'condominio', t: 'Declaração de quitação do condomínio + ata de eleição do síndico', l: '' },
  { k: 'consumo',    t: 'Contas de água/luz/gás quitadas',                          l: '' },
];
const CHK_COMPRADOR = [
  { k: 'doc_id',     t: 'RG/CNH e CPF',                                             l: '' },
  { k: 'civil',      t: 'Certidão de casamento/nascimento',                         l: '' },
];

let _chkNegId = null;
let _chkItens = {};      // espelho do mapa gravado
let _chkArquivos = {};   // itemId → [{nome, url}]

function chkId(grupo, k) { return (grupo + '_' + k).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60); }
function chkEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s == null ? '' : String(s)) : String(s || ''); }
function chkAlert(msg, tipo) { if (typeof showAlert === 'function') showAlert('negociacao-alert', msg, tipo); }

// Grava UM item (ou vários) na negociação, respeitando perfis/aprovação (gravar()).
async function chkGravar(itens, titulo) {
  const dados = {};
  for (const [id, it] of Object.entries(itens)) dados['checklist.' + id] = it;
  dados.atualizadoEm = firebase.firestore.FieldValue.serverTimestamp();
  return gravar({ modulo: 'negociacoes', colecao: 'negociacoes', op: 'editar', id: _chkNegId, dados,
    antes: null, titulo: titulo || 'Checklist da negociação' });
}

async function carregarChecklistVenda(negId) {
  _chkNegId = negId;
  _chkItens = {};
  _chkArquivos = {};
  const box = $('chk-venda-lista');
  if (!box) return;
  box.innerHTML = '<p class="empty">Carregando checklist…</p>';
  try {
    const snap = await tenantPath().collection('negociacoes').doc(negId).get();
    const n = snap.exists ? snap.data() : {};
    _chkItens = n.checklist || {};
    // Sugestões para "montar": nomes de vendedor e comprador
    const [vend, comp] = await Promise.all([
      n.vendedorId ? tenantPath().collection('locadores').doc(n.vendedorId).get() : null,
      n.compradorId ? tenantPath().collection('compradores').doc(n.compradorId).get() : null,
    ]);
    const vd = vend && vend.exists ? vend.data() : {};
    const cd = comp && comp.exists ? comp.data() : {};
    $('chk-venda-vendedor-nome').textContent = vd.nome || '(vendedor não escolhido)';
    $('chk-venda-comprador-nome').textContent = cd.nome || '(comprador não escolhido)';
    const conj = $('chk-venda-conjuge');
    if (conj && !conj.value) conj.value = vd.conjugeNome || '';
    await chkCarregarArquivos();
  } catch (err) {
    box.innerHTML = `<p class="empty" style="color:var(--danger);">Erro ao carregar o checklist: ${chkEsc(err.message)}</p>`;
    return;
  }
  renderChecklistVenda();
}

async function chkCarregarArquivos() {
  _chkArquivos = {};
  try {
    const raiz = await storageTenantRef().child(`negociacoes/${_chkNegId}/checklist`).listAll();
    await Promise.all(raiz.prefixes.map(async (pasta) => {
      const l = await pasta.listAll();
      _chkArquivos[pasta.name] = await Promise.all(l.items.map(async (it) => ({ nome: it.name, url: await it.getDownloadURL() })));
    }));
  } catch (_) { /* pasta ainda não existe */ }
}

function renderChecklistVenda() {
  const box = $('chk-venda-lista');
  if (!box) return;
  const itens = Object.entries(_chkItens).map(([id, it]) => ({ id, ...it }))
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  const prog = $('chk-venda-progresso');
  if (!itens.length) {
    box.innerHTML = '<p class="empty">Checklist ainda não montado. Confira o cônjuge acima e toque em <strong>⚙ Montar checklist padrão</strong>.</p>';
    if (prog) prog.innerHTML = '';
    return;
  }
  const feitos = itens.filter(i => CHK_CONCLUIDOS.includes(i.status)).length;
  const positivas = itens.filter(i => i.status === 'positiva');
  const pct = Math.round(feitos * 100 / itens.length);
  if (prog) {
    prog.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
        <strong>${feitos} de ${itens.length} concluídos (${pct}%)</strong>
        ${positivas.length ? `<a class="link-btn" style="color:#92400E; font-weight:700; cursor:pointer;" onclick="chkIrPara('${positivas[0].id}')">⚠️ ${positivas.length} positiva(s) para analisar</a>` : ''}
      </div>
      <div style="height:8px; background:#E5E7EB; border-radius:4px; overflow:hidden;">
        <div style="height:100%; width:${pct}%; background:${positivas.length ? '#D97706' : '#16A34A'};"></div>
      </div>`;
  }
  // agrupa por grupo (Imóvel / Vendedor — Fulano / Cônjuge — Fulana / Comprador — …)
  const grupos = [];
  for (const it of itens) {
    let g = grupos.find(x => x.nome === it.grupo);
    if (!g) { g = { nome: it.grupo, itens: [] }; grupos.push(g); }
    g.itens.push(it);
  }
  box.innerHTML = grupos.map(g => `
    <div class="chk-grupo">
      <div class="chk-grupo-titulo">${chkEsc(g.nome)}</div>
      ${g.itens.map(chkLinha).join('')}
    </div>`).join('');
}

function chkLinha(it) {
  const st = CHK_STATUS[it.status] || CHK_STATUS.pendente;
  const arqs = _chkArquivos[it.id] || [];
  const quando = it.atualizadoEm ? new Date(it.atualizadoEm).toLocaleDateString('pt-BR') : '';
  return `
  <div class="chk-item" id="chk-${it.id}" style="border-left:4px solid ${st.cor};">
    <div class="chk-cab">
      <span class="chk-titulo">${chkEsc(it.titulo)}</span>
      ${it.link ? `<a href="${chkEsc(it.link)}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" title="Abrir o portal desta certidão">🔗 Portal</a>` : ''}
    </div>
    <div class="chk-campos">
      <select onchange="chkMudou('${it.id}', 'status', this.value)" style="background:${st.fundo}; color:${st.cor}; font-weight:600;">
        ${Object.entries(CHK_STATUS).map(([k, v]) => `<option value="${k}"${k === (it.status || 'pendente') ? ' selected' : ''}>${v.rotulo}</option>`).join('')}
      </select>
      <input type="text" placeholder="Nº do pedido / protocolo" value="${chkEsc(it.pedido || '')}" onchange="chkMudou('${it.id}', 'pedido', this.value)">
      <input type="text" placeholder="Observação (o que consta, validade…)" value="${chkEsc(it.obs || '')}" onchange="chkMudou('${it.id}', 'obs', this.value)">
    </div>
    <div class="chk-anexos">
      ${arqs.map(a => `<span class="chk-arq"><a href="${chkEsc(a.url)}" target="_blank" rel="noopener">📄 ${chkEsc(a.nome)}</a><button type="button" class="btn-icon btn-icon-danger" title="Excluir arquivo" onclick="chkApagarArquivo('${it.id}', '${chkEsc(a.nome).replace(/'/g, '&#39;')}')">🗑</button></span>`).join('')}
      <label class="btn btn-sm btn-secondary chk-anexar" id="chk-anexar-${it.id}">📎 Anexar certidão
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple style="display:none;" onchange="chkAnexar('${it.id}', this)">
      </label>
      <span class="chk-salvo" id="chk-salvo-${it.id}">${quando ? `atualizado ${quando}${it.atualizadoPorNome ? ' · ' + chkEsc(it.atualizadoPorNome) : ''}` : ''}</span>
    </div>
  </div>`;
}

function chkIrPara(id) {
  const el = $('chk-' + id);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('chk-piscar'); setTimeout(() => el.classList.remove('chk-piscar'), 1600); }
}

// Cada campo grava sozinho, com resposta visível na própria linha (regra nº 1)
async function chkMudou(id, campo, valor) {
  const it = _chkItens[id];
  if (!it) return;
  const aviso = $('chk-salvo-' + id);
  if (aviso) { aviso.textContent = '⏳ Salvando…'; aviso.style.color = ''; }
  const novo = { ...it, [campo]: (valor || '').trim(), atualizadoEm: Date.now(),
    atualizadoPor: State.user?.uid || null, atualizadoPorNome: State.userDoc?.nome || State.user?.email || '' };
  try {
    const r = await chkGravar({ [id]: novo }, `Checklist — ${it.titulo}`);
    if (r && r.pendente) {
      if (aviso) { aviso.textContent = '🕓 Enviado para aprovação'; aviso.style.color = '#92400E'; }
      return;
    }
    _chkItens[id] = novo;
    if (campo === 'status') { renderChecklistVenda(); chkIrPara(id); }
    const a2 = $('chk-salvo-' + id);
    if (a2) { a2.textContent = '✓ Salvo'; a2.style.color = '#166534'; }
  } catch (err) {
    if (aviso) { aviso.textContent = '❌ ' + err.message; aviso.style.color = 'var(--danger)'; }
  }
}

async function chkAnexar(id, input) {
  if (!exigirNivelAnexo('negociacoes', 'criar', 'negociacao-alert')) { input.value = ''; return; }
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const grande = files.find(f => f.size > 10 * 1024 * 1024);
  if (grande) { chkAlert(`Arquivo "${grande.name}" passa de 10MB.`); input.value = ''; return; }
  const lbl = $('chk-anexar-' + id);
  const aviso = $('chk-salvo-' + id);
  if (lbl) { lbl.style.pointerEvents = 'none'; lbl.style.opacity = '.6'; }
  if (aviso) { aviso.textContent = `⏳ Enviando ${files.length} arquivo(s)… aguarde`; aviso.style.color = ''; }
  try {
    const pasta = storageTenantRef().child(`negociacoes/${_chkNegId}/checklist/${id}`);
    for (const f of files) {
      await pasta.child(f.name).put(f, { contentType: f.type, customMetadata: { uploadedBy: State.user.uid } });
    }
    // Anexou e o item estava pendente/pedido → passa a "Negativa" só se o usuário confirmar; aqui só registra
    await chkCarregarArquivos();
    renderChecklistVenda();
    const a2 = $('chk-salvo-' + id);
    if (a2) { a2.textContent = `✓ ${files.length} arquivo(s) anexado(s) — confira a situação`; a2.style.color = '#166534'; }
    chkIrPara(id);
  } catch (err) {
    if (aviso) { aviso.textContent = '❌ ' + err.message; aviso.style.color = 'var(--danger)'; }
  } finally {
    if (lbl) { lbl.style.pointerEvents = ''; lbl.style.opacity = ''; }
    input.value = '';
  }
}

async function chkApagarArquivo(id, nome) {
  if (!exigirNivelAnexo('negociacoes', 'excluir', 'negociacao-alert')) return;
  if (!(await confirmar({ titulo: 'Excluir arquivo?', mensagem: `Remover <strong>${chkEsc(nome)}</strong> deste item do checklist?`, detalhe: 'Não pode ser desfeito.', confirmar: '🗑 Excluir', perigo: true }))) return;
  try {
    await storageTenantRef().child(`negociacoes/${_chkNegId}/checklist/${id}/${nome}`).delete();
    await chkCarregarArquivos();
    renderChecklistVenda();
    chkIrPara(id);
  } catch (err) { chkAlert('Erro: ' + err.message); }
}

// Monta (ou completa) o checklist padrão. Nunca apaga nem sobrescreve item que já existe.
async function montarChecklistVenda() {
  const btn = $('btn-chk-montar');
  if (!_chkNegId) { chkAlert('Salve a negociação antes de montar o checklist.'); return; }
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Montando… aguarde';
  try {
    const vend = $('chk-venda-vendedor-nome').textContent.replace(/^\(.*\)$/, '').trim() || 'Vendedor';
    const comp = $('chk-venda-comprador-nome').textContent.replace(/^\(.*\)$/, '').trim() || 'Comprador';
    const conj = ($('chk-venda-conjuge').value || '').trim();
    const blocos = [
      { grupo: '🏠 Imóvel', prefixo: 'imovel', lista: CHK_IMOVEL },
      { grupo: `👤 Vendedor — ${vend}`, prefixo: 'vend', lista: CHK_PESSOA },
    ];
    if (conj) blocos.push({ grupo: `💍 Cônjuge do vendedor — ${conj}`, prefixo: 'conj', lista: CHK_PESSOA });
    blocos.push({ grupo: `🧾 Comprador — ${comp}`, prefixo: 'comp', lista: CHK_COMPRADOR });

    let ordem = Object.values(_chkItens).reduce((m, i) => Math.max(m, i.ordem || 0), 0);
    const novos = {};
    for (const b of blocos) {
      for (const x of b.lista) {
        const id = chkId(b.prefixo, x.k);
        if (_chkItens[id]) { // já existe: só atualiza o nome do grupo (ex.: cônjuge informado depois)
          if (_chkItens[id].grupo !== b.grupo) novos[id] = { ..._chkItens[id], grupo: b.grupo };
          continue;
        }
        novos[id] = { grupo: b.grupo, titulo: x.t, link: x.l || '', status: 'pendente', pedido: '', obs: '', ordem: ++ordem };
      }
    }
    if (!Object.keys(novos).length) { chkAlert('✓ O checklist já está completo — nada novo para incluir.', 'success'); return; }
    const r = await chkGravar(novos, 'Checklist da negociação — montar padrão');
    if (r && r.pendente) { chkAlert('🕓 Checklist enviado para aprovação. Aparece assim que um gestor aprovar.', 'success'); return; }
    Object.assign(_chkItens, novos);
    renderChecklistVenda();
    chkAlert(`✓ Checklist montado: ${Object.keys(novos).length} item(ns) incluído(s).`, 'success');
  } catch (err) {
    chkAlert('Erro ao montar o checklist: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

// Item avulso (ex.: "Certidão de objeto e pé do processo X")
async function adicionarItemChecklistVenda() {
  const inp = $('chk-venda-novo');
  const titulo = (inp.value || '').trim();
  if (!titulo) { chkAlert('Escreva o nome do item a incluir.'); inp.focus(); return; }
  const btn = $('btn-chk-novo');
  btn.disabled = true; const original = btn.textContent; btn.textContent = '⏳ Incluindo…';
  try {
    const id = 'extra_' + Date.now().toString(36);
    const ordem = Object.values(_chkItens).reduce((m, i) => Math.max(m, i.ordem || 0), 0) + 1;
    const item = { grupo: '➕ Outros', titulo, link: '', status: 'pendente', pedido: '', obs: '', ordem };
    const r = await chkGravar({ [id]: item }, `Checklist — ${titulo}`);
    if (r && r.pendente) { chkAlert('🕓 Item enviado para aprovação.', 'success'); return; }
    _chkItens[id] = item;
    inp.value = '';
    renderChecklistVenda();
    chkIrPara(id);
  } catch (err) {
    chkAlert('Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

// Excluir a negociação leva junto os anexos do checklist (subpastas)
async function apagarAnexosChecklistVenda(negId) {
  try {
    const raiz = await storageTenantRef().child(`negociacoes/${negId}/checklist`).listAll();
    for (const pasta of raiz.prefixes) {
      const l = await pasta.listAll();
      await Promise.all(l.items.map(i => i.delete()));
    }
  } catch (_) {}
}

window.carregarChecklistVenda = carregarChecklistVenda;
window.montarChecklistVenda = montarChecklistVenda;
window.adicionarItemChecklistVenda = adicionarItemChecklistVenda;
window.apagarAnexosChecklistVenda = apagarAnexosChecklistVenda;
window.chkMudou = chkMudou;
window.chkAnexar = chkAnexar;
window.chkApagarArquivo = chkApagarArquivo;
window.chkIrPara = chkIrPara;
