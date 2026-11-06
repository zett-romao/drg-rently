// =============================================================
// 💰 FINANCEIRO DO MÊS — DRG-Rently (06/11/2026)
// =============================================================
// Pedido do dono: "ao importar, abra uma tela para eu marcar quais são as despesas do
// proprietário e quais são as do locatário … gerar boleto ao locatário, PIX ao proprietário
// retendo a comissão, planilha ao proprietário, baixa do boleto pago, despesa fixa/variável
// e repetir nos próximos meses, painel com os valores aguardando pagamento (Asaas),
// reajuste pelos índices oficiais".
//
// Este arquivo liga as peças que já existiam soltas (balancete, Asaas, repasse S4, Livro
// Caixa, índices BCB). FASE 1 (aqui): 📥 Importar conta → 🧮 Distribuir despesas.
//
// Regras de negócio que este fluxo segue (não mudam as existentes):
//  • Despesa do LOCATÁRIO paga pela imobiliária entra como receita E como despesa do
//    proprietário (regra do dono no recalcBalancete) — não mexe no repasse, só na cobrança.
//  • Despesa do PROPRIETÁRIO desconta do repasse.
//  • Se o LOCATÁRIO paga o boleto direto ao condomínio, a parte do proprietário vira
//    ABATIMENTO (entrada negativa): diminui a cobrança do locatário e o repasse, uma vez só.
//  • Sugestão de quem arca vem da IA pela Lei 8.245 (art. 22 X / art. 23 XII); quem decide
//    é o operador, item a item.
// =============================================================

const FIN_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const FIN_CATS = ['condominio', 'agua', 'luz', 'gas', 'iptu', 'fundo_reserva', 'obras', 'taxa_cobranca', 'seguro', 'manutencao', 'internet', 'outros'];

function finR2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function finNorm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function finDig(s) { return String(s || '').replace(/\D/g, ''); }
function finComp(mes, ano) { return `${ano}-${String(mes).padStart(2, '0')}`; }
function finMesAno(mes, ano) { return `${FIN_MESES[mes - 1]}/${ano}`; }

// ---------- Totais do balancete (mesma conta do recalcBalancete/saveBalancete, sem tela) ----------
function finCalcularTotais(b) {
  const L = b.lancamentos || [];
  const soma = (bl) => L.filter(l => l.bloco === bl).reduce((a, l) => a + (parseFloat(l.valor) || 0), 0);
  const totalEntradas = soma('entrada');
  const dLoc = soma('despesa_locador');
  const dLt = soma('despesa_locatario');
  const receita = totalEntradas + dLt;
  const despesa = dLoc + dLt;
  const inc = b.taxaIncidencia || 'aluguel';
  let base = Number(b.aluguelBase) || 0;
  if (inc === 'todas') base = receita;
  else if (inc === 'selecionadas') {
    const ids = new Set(b.taxaIncideIds || []);
    base = L.filter(l => ids.has(l.id)).reduce((a, l) => a + (parseFloat(l.valor) || 0), 0);
  }
  const taxa = base * (Number(b.taxaAdm) || 0) / 100;
  return {
    totalEntradas: finR2(totalEntradas),
    totalDespesasLocador: finR2(dLoc),
    totalDespesasLocatario: finR2(dLt),
    receitaTotalLocador: finR2(receita),
    despesaTotalLocador: finR2(despesa),
    taxaBase: finR2(base),
    taxaAdmValor: finR2(taxa),
    liquidoLocador: finR2(receita - despesa - taxa),
  };
}
// Quanto o locatário paga no mês: entradas (aluguel, multas, abatimentos) + despesas dele
function finValorCobrarLocatario(b) {
  const L = b.lancamentos || [];
  return finR2(L.filter(l => l.bloco === 'entrada' || l.bloco === 'despesa_locatario')
    .reduce((a, l) => a + (parseFloat(l.valor) || 0), 0));
}

// Balancete novo de um contrato (mesmo ponto de partida do "+ Novo Balancete")
async function finNovoBalanceteBase(c, contratoId, mes, ano) {
  const padroes = await getPadroesTenant();
  return {
    contratoId, imovelId: c.imovelId || null, locadorId: c.locadorId || null, locatarioId: c.locatarioId || null,
    mes, ano, status: 'aberto',
    aluguelBase: Number(c.aluguel) || 0,
    taxaAdm: c.taxaAdm ?? padroes.taxaAdm ?? 10,
    taxaIncidencia: 'aluguel', taxaIncideIds: [],
    lancamentos: [{
      id: cryptoRandomId(), bloco: 'entrada', categoria: 'aluguel', descricao: 'Aluguel mensal',
      valor: Number(c.aluguel) || 0, comprovantePath: null, comprovanteNome: null,
    }],
    obs: null,
  };
}

// Grava o balancete pelo gravar() (respeita perfil/fila de aprovação). Recalcula os totais.
async function finGravarBalancete(id, b, existe, antes, titulo) {
  const dados = { ...b, ...finCalcularTotais(b), atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() };
  if (!existe) { dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp(); dados.criadoPor = State.user.uid; }
  return gravar({ modulo: 'balancetes', colecao: 'balancetes', op: existe ? 'editar' : 'criar', id,
    dados, antes: existe ? antes : null, titulo: titulo || `Balancete ${finMesAno(b.mes, b.ano)}` });
}

// =============================================================
// 📥 IMPORTAR CONTA → 🧮 DISTRIBUIR DESPESAS
// =============================================================
let _finImp = null;   // estado da tela de distribuição

async function finImportarConta() {
  if (!State.tenant) return;
  if (nivelPermissao('balancetes', 'criar') === 'nao' && nivelPermissao('balancetes', 'editar') === 'nao') {
    finAvisoSecao('⛔ Seu perfil não permite lançar em Balancetes. Peça a quem gerencia a equipe.', 'error');
    return;
  }
  let cfg = {};
  try { cfg = (await tenantPath().collection('config').doc('site').get()).data() || {}; } catch (_) {}
  if (!cfg.workerGeminiUrl) {
    finAvisoSecao('Configure a URL do Worker de IA (Gemini) em ⚙ Configurações antes de importar.', 'error');
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.jpg,.jpeg,.png,.webp';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { finAvisoSecao('❌ Arquivo maior que 8 MB.', 'error'); return; }
    finLerContaComIA(file, cfg.workerGeminiUrl);
  };
  input.click();
}

function finAvisoSecao(msg, tipo) {
  const el = $('fin-secao-status');
  if (el) showInlineStatus('fin-secao-status', msg, tipo || 'info', tipo === 'success' ? 8000 : 0);
  else alert(msg.replace(/<[^>]+>/g, ''));
}

function finGarantirModal() {
  if ($('modal-fin-import')) return;
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.id = 'modal-fin-import';
  div.style.display = 'none';
  div.innerHTML = `
    <div class="modal modal-xl fin-modal">
      <div class="modal-header">
        <h3>🧮 Distribuir despesas do boleto</h3>
        <button class="modal-close" onclick="finFecharImport()" title="Fechar">×</button>
      </div>
      <div class="modal-body" id="fin-imp-body"></div>
      <div class="modal-footer fin-imp-footer">
        <div id="fin-imp-status" class="status-inline" style="display:none;"></div>
        <div class="fin-imp-botoes">
          <button class="btn btn-secondary" onclick="finFecharImport()">Cancelar</button>
          <button class="btn btn-primary" id="btn-fin-imp-lancar" onclick="finConfirmarImport(this)">✓ Lançar no balancete</button>
        </div>
      </div>
    </div>`;
  div.addEventListener('mousedown', (e) => { if (e.target === div) finFecharImport(); });
  document.body.appendChild(div);
}

function finFecharImport() {
  const m = $('modal-fin-import');
  if (m) m.style.display = 'none';
  if (_finImp?.fileUrl) { try { URL.revokeObjectURL(_finImp.fileUrl); } catch (_) {} }
  _finImp = null;
}
window.finFecharImport = finFecharImport;

async function finLerContaComIA(file, workerUrl) {
  finGarantirModal();
  $('fin-imp-body').innerHTML = `<div class="fin-lendo">⏳ Lendo o boleto com IA… aguarde ~20s<br><span class="muted">${escapeHtml(file.name)}</span></div>`;
  $('fin-imp-status').style.display = 'none';
  $('btn-fin-imp-lancar').disabled = true;
  $('btn-fin-imp-lancar').innerHTML = '✓ Lançar no balancete';
  $('modal-fin-import').style.display = 'flex';
  try {
    const res = await fetch(workerUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileBase64: await fileToBase64(file), mimeType: file.type || 'application/pdf', modo: 'boleto_itens' }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success || !j.data) throw new Error(j.error || `Erro ${res.status} na leitura`);
    await finMontarDistribuicao(j.data, file);
  } catch (err) {
    console.error('Importar conta:', err);
    $('fin-imp-body').innerHTML = `<div class="fin-lendo" style="color:var(--danger);">❌ Não consegui ler o arquivo: ${escapeHtml(err.message)}<br><br>
      <button class="btn btn-secondary" onclick="finFecharImport(); finImportarConta();">📥 Tentar outro arquivo</button></div>`;
  }
}

// Acha o contrato pelo pagador (CPF/CNPJ → nome) e, por último, pelo número da unidade
async function finAcharContrato(d, contratos, locatarios, imoveis) {
  const vig = contratos.filter(c => c.status === 'vigente');
  const docPag = finDig(d.pagador_documento);
  const porLoc = (lid) => vig.filter(c => c.locatarioId === lid);
  if (docPag.length >= 11) {
    const l = locatarios.find(x => [x.documento, x.cpf, x.cnpj].some(v => finDig(v) === docPag));
    if (l && porLoc(l.id).length === 1) return { id: porLoc(l.id)[0].id, como: `🔗 achado pelo CPF/CNPJ do pagador (${escapeHtml(l.nome || '')})` };
  }
  const nPag = finNorm(d.pagador_nome);
  if (nPag) {
    const l = locatarios.find(x => finNorm(x.nome) === nPag);
    if (l && porLoc(l.id).length === 1) return { id: porLoc(l.id)[0].id, como: `🔗 achado pelo nome do pagador (${escapeHtml(l.nome || '')})` };
  }
  const nums = (String(d.unidade || '').match(/\d+/g) || []).filter(n => n.length >= 2);
  if (nums.length) {
    const ap = nums[nums.length - 1];
    const cand = vig.filter(c => {
      const im = imoveis.find(i => i.id === c.imovelId) || {};
      const txt = ` ${finNorm([im.apelido, im.complemento, im.endereco?.complemento, im.unidade].filter(Boolean).join(' '))} `;
      return txt.includes(` ${ap} `) || txt.includes(`ap ${ap}`) || txt.includes(`apto ${ap}`);
    });
    if (cand.length === 1) return { id: cand[0].id, como: `🔗 achado pela unidade (${escapeHtml(d.unidade)}) — confira` };
  }
  return { id: '', como: '⚠ Não achei o contrato sozinha — escolha abaixo' };
}

async function finMontarDistribuicao(d, file) {
  const [contratosSnap, locatarios, imoveis] = await Promise.all([
    colecaoNoAlcance('contratos').get(), ensureLocatariosCache(), ensureImoveisCache(),
  ]);
  const contratos = contratosSnap.docs.map(x => ({ id: x.id, ...x.data() }));
  const achado = await finAcharContrato(d, contratos, locatarios, imoveis);

  // Competência: a do documento; senão o mês do vencimento; senão o mês corrente
  const hoje = new Date();
  const compTxt = (d.competencia && /^\d{4}-\d{2}$/.test(d.competencia)) ? d.competencia
    : (d.vencimento && /^\d{4}-\d{2}/.test(d.vencimento)) ? d.vencimento.slice(0, 7)
      : finComp(hoje.getMonth() + 1, hoje.getFullYear());
  const recorrente = d.tipo_documento === 'boleto_condominio';
  let itens = (Array.isArray(d.itens) ? d.itens : []).filter(i => Number(i.valor));
  if (!itens.length && Number(d.valor_total)) {
    itens = [{ descricao: d.condominio ? `Condomínio ${d.condominio}` : 'Conta importada', valor: d.valor_total, categoria: 'outros', quem_paga_sugerido: 'locador', motivo: 'sem discriminativo — confira', variavel: false, confianca: 0.4 }];
  }

  _finImp = {
    dados: d, file, fileUrl: URL.createObjectURL(file),
    contratos, locatarios, imoveis,
    contratoId: achado.id, comoAchou: achado.como,
    ano: parseInt(compTxt.slice(0, 4), 10), mes: parseInt(compTxt.slice(5, 7), 10),
    modo: 'imobiliaria',
    itens: itens.map(i => ({
      id: cryptoRandomId(),
      descricao: String(i.descricao || '').trim() || 'Item',
      valor: finR2(i.valor),
      categoria: FIN_CATS.includes(i.categoria) ? i.categoria : 'outros',
      quem: i.quem_paga_sugerido === 'locatario' ? 'locatario' : 'locador',
      tipoValor: i.variavel ? 'variavel' : 'fixa',
      repetir: recorrente ? 'sempre' : 'nao',
      ate: '',
      sug: { quem: i.quem_paga_sugerido, motivo: i.motivo || '', confianca: Number(i.confianca) || 0, natureza: i.natureza || '', detalhe: i.detalhe || '' },
    })),
  };
  finRenderDistribuicao();
  $('btn-fin-imp-lancar').disabled = false;
}

function finRenderDistribuicao() {
  const F = _finImp;
  if (!F) return;
  const d = F.dados;
  const imMap = Object.fromEntries(F.imoveis.map(i => [i.id, i.apelido]));
  const ltMap = Object.fromEntries(F.locatarios.map(l => [l.id, l.nome]));
  const opts = F.contratos.filter(c => c.status === 'vigente' || c.id === F.contratoId)
    .map(c => `<option value="${c.id}"${c.id === F.contratoId ? ' selected' : ''}>${escapeHtml(imMap[c.imovelId] || 'Imóvel')} · ${escapeHtml(ltMap[c.locatarioId] || 'Locatário')} · ${fmtBRL(c.aluguel)}</option>`).join('');
  const anos = [F.ano - 1, F.ano, F.ano + 1];
  const venc = d.vencimento ? d.vencimento.split('-').reverse().join('/') : '—';

  $('fin-imp-body').innerHTML = `
    <div class="fin-doc">
      <div class="fin-doc-info">
        <div><span class="muted">Documento</span><strong>${escapeHtml(d.condominio || d.emissor || d.beneficiario || 'Conta importada')}</strong>
          ${d.unidade ? `<span class="muted">${escapeHtml(d.unidade)}</span>` : ''}</div>
        <div><span class="muted">Pagador</span><strong>${escapeHtml(d.pagador_nome || '—')}</strong></div>
        <div><span class="muted">Vencimento</span><strong>${venc}</strong></div>
        <div><span class="muted">Total do documento</span><strong class="fin-doc-total">${fmtBRL(d.valor_total)}</strong></div>
      </div>
      <div class="fin-doc-acoes">
        <a class="btn btn-sm btn-secondary" href="${F.fileUrl}" target="_blank" rel="noopener">📄 Ver arquivo</a>
        ${d.linha_digitavel ? `<button type="button" class="btn btn-sm btn-secondary" onclick="finCopiar(this, ${escapeHtml(JSON.stringify(d.linha_digitavel))})" title="${escapeHtml(d.linha_digitavel)}">📋 Linha digitável</button>` : ''}
      </div>
      ${d.observacoes ? `<div class="fin-doc-obs">⚠ ${escapeHtml(d.observacoes)}</div>` : ''}
    </div>

    <div class="form-row fin-destino">
      <div class="form-group" style="flex:2;">
        <label>Contrato</label>
        <select id="fin-imp-contrato" onchange="_finImp.contratoId=this.value; finAtualizarResumo();">
          <option value="">— Escolha o contrato —</option>${opts}
        </select>
        <small class="${F.contratoId ? 'fin-ok' : 'fin-alerta'}">${F.comoAchou}</small>
      </div>
      <div class="form-group">
        <label>Lançar no balancete de</label>
        <div style="display:flex; gap:6px;">
          <select id="fin-imp-mes" onchange="_finImp.mes=parseInt(this.value,10); finAtualizarResumo();">
            ${FIN_MESES.map((m, i) => `<option value="${i + 1}"${i + 1 === F.mes ? ' selected' : ''}>${m}</option>`).join('')}
          </select>
          <select id="fin-imp-ano" onchange="_finImp.ano=parseInt(this.value,10); finAtualizarResumo();">
            ${anos.map(a => `<option${a === F.ano ? ' selected' : ''}>${a}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <div class="fin-modo">
      <label class="fin-modo-op${F.modo === 'imobiliaria' ? ' ativo' : ''}">
        <input type="radio" name="fin-modo" value="imobiliaria" ${F.modo === 'imobiliaria' ? 'checked' : ''} onchange="finSetModo(this.value)">
        <span><strong>🏢 A imobiliária paga este boleto</strong><br><small>Cobramos do locatário a parte dele junto com o aluguel; a parte do proprietário sai do repasse. Fica em "Contas a pagar".</small></span>
      </label>
      <label class="fin-modo-op${F.modo === 'locatario' ? ' ativo' : ''}">
        <input type="radio" name="fin-modo" value="locatario" ${F.modo === 'locatario' ? 'checked' : ''} onchange="finSetModo(this.value)">
        <span><strong>👤 O locatário paga direto</strong><br><small>Só a parte do proprietário entra: abatida do aluguel do locatário e descontada do repasse.</small></span>
      </label>
    </div>

    <div class="fin-itens-topo">
      <strong>Itens do boleto</strong>
      <div class="fin-itens-massa">
        <button type="button" class="btn btn-sm btn-secondary" onclick="finTodos('quem','locatario')">Tudo 👤 locatário</button>
        <button type="button" class="btn btn-sm btn-secondary" onclick="finTodos('quem','locador')">Tudo 🏠 proprietário</button>
        <button type="button" class="btn btn-sm btn-secondary" onclick="finTodos('repetir','sempre')">🔁 Repetir tudo</button>
        <button type="button" class="btn btn-sm btn-secondary" onclick="finTodos('repetir','nao')">Só este mês</button>
      </div>
    </div>
    <div class="fin-itens" id="fin-itens"></div>
    <button type="button" class="btn btn-sm btn-secondary" style="margin-top:8px;" onclick="finAddItem()">➕ Adicionar linha</button>
    <div class="fin-resumo" id="fin-resumo"></div>`;
  finRenderItens();
}

function finRenderItens() {
  const F = _finImp;
  const box = $('fin-itens');
  if (!F || !box) return;
  box.innerHTML = F.itens.map(i => {
    const s = i.sug || {};
    const ia = s.quem ? `<small class="fin-ia${s.quem !== i.quem ? ' fin-ia-diverge' : ''}" title="${escapeHtml(s.motivo || '')}">🤖 sugere ${s.quem === 'locatario' ? 'locatário' : 'proprietário'}${s.motivo ? ' — ' + escapeHtml(s.motivo) : ''}${s.confianca && s.confianca < 0.7 ? ' (dúvida)' : ''}</small>` : '';
    return `
    <div class="fin-item" data-id="${i.id}">
      <div class="fin-item-desc">
        <input type="text" value="${escapeHtml(i.descricao)}" oninput="finSetItem('${i.id}','descricao',this.value)" aria-label="Descrição">
        <div class="fin-item-sub">
          <select onchange="finSetItem('${i.id}','categoria',this.value)" aria-label="Categoria">
            ${FIN_CATS.map(c => `<option value="${c}"${c === i.categoria ? ' selected' : ''}>${escapeHtml(LANC_CATEGORIA_LABEL[c] || c)}</option>`).join('')}
          </select>
          ${s.detalhe ? `<small class="muted">${escapeHtml(s.detalhe)}</small>` : ''}
        </div>
        ${ia}
      </div>
      <input type="text" data-moeda class="fin-item-valor" value="${i.valor}" oninput="finSetItem('${i.id}','valor',parseFloat(this.value)||0)" aria-label="Valor">
      <div class="fin-seg" role="group" aria-label="Quem arca">
        <button type="button" class="${i.quem === 'locador' ? 'ativo prop' : ''}" onclick="finSetItem('${i.id}','quem','locador',true)">🏠 Proprietário</button>
        <button type="button" class="${i.quem === 'locatario' ? 'ativo loc' : ''}" onclick="finSetItem('${i.id}','quem','locatario',true)">👤 Locatário</button>
      </div>
      <select class="fin-item-tipo" onchange="finSetItem('${i.id}','tipoValor',this.value)" aria-label="Fixa ou variável">
        <option value="fixa"${i.tipoValor === 'fixa' ? ' selected' : ''}>Fixa</option>
        <option value="variavel"${i.tipoValor === 'variavel' ? ' selected' : ''}>Variável</option>
      </select>
      <div class="fin-item-rep">
        <select onchange="finSetItem('${i.id}','repetir',this.value,true)" aria-label="Repetir">
          <option value="nao"${i.repetir === 'nao' ? ' selected' : ''}>Só este mês</option>
          <option value="sempre"${i.repetir === 'sempre' ? ' selected' : ''}>🔁 Todo mês</option>
          <option value="ate"${i.repetir === 'ate' ? ' selected' : ''}>🔁 Até…</option>
        </select>
        ${i.repetir === 'ate' ? `<input type="month" value="${i.ate || ''}" onchange="finSetItem('${i.id}','ate',this.value)" aria-label="Repetir até">` : ''}
      </div>
      <button type="button" class="fin-item-del" title="Remover linha" onclick="finRemoverItem('${i.id}')">🗑</button>
    </div>`;
  }).join('') || '<div class="empty-lanc">Nenhum item. Clique em ➕ Adicionar linha.</div>';
  finAtualizarResumo();
}

function finSetItem(id, campo, valor, rerender) {
  const it = _finImp?.itens.find(x => x.id === id);
  if (!it) return;
  it[campo] = valor;
  if (rerender) finRenderItens(); else finAtualizarResumo();
}
function finTodos(campo, valor) { (_finImp?.itens || []).forEach(i => { i[campo] = valor; }); finRenderItens(); }
function finAddItem() {
  _finImp.itens.push({ id: cryptoRandomId(), descricao: '', valor: 0, categoria: 'outros', quem: 'locador', tipoValor: 'fixa', repetir: 'nao', ate: '', sug: {} });
  finRenderItens();
}
function finRemoverItem(id) { _finImp.itens = _finImp.itens.filter(i => i.id !== id); finRenderItens(); }
function finSetModo(m) {
  _finImp.modo = m;
  document.querySelectorAll('.fin-modo-op').forEach(el => el.classList.toggle('ativo', el.querySelector('input').value === m));
  finAtualizarResumo();
}
async function finCopiar(btn, txt) {
  try { await navigator.clipboard.writeText(txt); btn.textContent = '✓ Copiado'; } catch (_) { btn.textContent = '❌ não copiou'; }
}
window.finSetItem = finSetItem; window.finTodos = finTodos; window.finAddItem = finAddItem;
window.finRemoverItem = finRemoverItem; window.finSetModo = finSetModo; window.finCopiar = finCopiar;

// Explica, em reais, o que vai acontecer no balancete (antes de gravar)
function finAtualizarResumo() {
  const F = _finImp, box = $('fin-resumo');
  if (!F || !box) return;
  const somaLt = finR2(F.itens.filter(i => i.quem === 'locatario').reduce((a, i) => a + (Number(i.valor) || 0), 0));
  const somaPr = finR2(F.itens.filter(i => i.quem === 'locador').reduce((a, i) => a + (Number(i.valor) || 0), 0));
  const total = finR2(somaLt + somaPr);
  const doc = finR2(F.dados.valor_total);
  const dif = finR2(total - doc);
  const confere = !doc || Math.abs(dif) < 0.01;
  const ref = finMesAno(F.mes, F.ano);
  const linhas = F.modo === 'imobiliaria'
    ? [`👤 <strong>${fmtBRL(somaLt)}</strong> entram na cobrança do locatário de ${ref} (não mexem no repasse).`,
       `🏠 <strong>${fmtBRL(somaPr)}</strong> são descontados do repasse ao proprietário.`,
       `🏢 Conta a pagar de <strong>${fmtBRL(doc || total)}</strong>${F.dados.vencimento ? ` com vencimento em ${F.dados.vencimento.split('-').reverse().join('/')}` : ''} — a imobiliária paga.`]
    : [`👤 ${fmtBRL(somaLt)} do locatário: ele já paga direto — não entram no balancete.`,
       `🏠 <strong>${fmtBRL(somaPr)}</strong> do proprietário: abatidos da cobrança do locatário e descontados do repasse.`];
  const rep = F.itens.filter(i => i.repetir !== 'nao').length;
  if (rep) linhas.push(`🔁 ${rep} item(ns) se repetem nos próximos meses (os variáveis voltam com ⚠ para conferir o valor).`);
  box.innerHTML = `
    <div class="fin-soma ${confere ? 'ok' : 'erro'}">${confere ? '✓ A soma dos itens confere com o total do documento' : `⚠ A soma dos itens (${fmtBRL(total)}) não bate com o total do documento (${fmtBRL(doc)}) — diferença de ${fmtBRL(dif)}`}</div>
    <ul>${linhas.map(l => `<li>${l}</li>`).join('')}</ul>`;
}
window.finAtualizarResumo = finAtualizarResumo;

async function finConfirmarImport(btn) {
  const F = _finImp;
  if (!F) return;
  const st = (m, k) => showInlineStatus('fin-imp-status', m, k);
  if (!F.contratoId) { st('❌ Escolha o contrato.', 'error'); $('fin-imp-contrato')?.focus(); return; }
  if (!F.itens.length) { st('❌ Não há itens para lançar.', 'error'); return; }
  if (F.itens.some(i => !(Number(i.valor) > 0))) { st('❌ Há item com valor zerado — corrija ou remova a linha.', 'error'); return; }
  if (F.itens.some(i => i.repetir === 'ate' && !i.ate)) { st('❌ Informe até quando repetir (mês/ano).', 'error'); return; }
  const c = F.contratos.find(x => x.id === F.contratoId);
  const bid = balanceteId(F.ano, F.mes, F.contratoId);
  const ref = finMesAno(F.mes, F.ano);

  // Já existe? Fechado não recebe lançamento; mesmo boleto 2× pede confirmação
  const snap = await tenantPath().collection('balancetes').doc(bid).get();
  const antes = snap.exists ? snap.data() : null;
  if (antes && (antes.status || 'aberto') !== 'aberto') { st(`❌ O balancete de ${ref} já está ${antes.status}. Reabra-o antes de importar.`, 'error'); return; }
  const linha = finDig(F.dados.linha_digitavel);
  if (antes && linha && (antes.lancamentos || []).some(l => finDig(l.boletoLinhaDigitavel) === linha)) {
    if (!(await confirmar({ titulo: 'Boleto já lançado?', mensagem: `Este boleto (mesma linha digitável) já foi lançado no balancete de ${ref}.`, detalhe: 'Lançar de novo duplica os valores.', confirmar: 'Lançar mesmo assim', aviso: true }))) return;
  }

  let r;
  try {
    r = await drgSubmit(btn, '⏳ Lançando… aguarde', async () => {
      const b = antes ? { ...antes, lancamentos: [...(antes.lancamentos || [])] } : await finNovoBalanceteBase(c, F.contratoId, F.mes, F.ano);
      // 1) arquivo vira comprovante (um só, ligado a todas as linhas)
      let comp = { comprovantePath: null, comprovanteNome: null };
      try {
        const nome = F.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `balancetes/${bid}/comprovantes/import_${Date.now()}_${nome}`;
        await storageTenantRef().child(path).put(F.file, { contentType: F.file.type });
        comp = { comprovantePath: path, comprovanteNome: F.file.name };
      } catch (e) { console.warn('Arquivo não anexado (lançamentos seguem):', e); }
      const importacaoId = cryptoRandomId();
      const meta = {
        origem: 'importacao', importacaoId,
        boletoVencimento: F.dados.vencimento || null,
        boletoCompetencia: finComp(F.mes, F.ano),
        boletoBeneficiario: F.dados.beneficiario || F.dados.emissor || null,
        boletoLinhaDigitavel: F.dados.linha_digitavel || null,
        ...comp,
      };
      let novos = 0, trocados = 0;
      for (const i of F.itens) {
        let bloco, valor = finR2(i.valor), categoria = i.categoria, descricao = i.descricao;
        if (F.modo === 'imobiliaria') bloco = i.quem === 'locatario' ? 'despesa_locatario' : 'despesa_locador';
        else {
          if (i.quem === 'locatario') continue;   // ele já paga direto ao condomínio
          bloco = 'entrada'; valor = -valor; categoria = 'abatimento';
          descricao = `Abatimento — ${i.descricao} (pago pelo locatário no boleto)`;
        }
        const lanc = {
          bloco, categoria, descricao, valor,
          quemArca: i.quem, modoPagamento: F.modo,
          tipoValor: i.tipoValor, repetir: i.repetir !== 'nao', repetirAte: i.repetir === 'ate' ? i.ate : null,
          conferirValor: false,
          iaSugestao: i.sug && i.sug.quem ? { quem: i.sug.quem, motivo: i.sug.motivo || '', confianca: i.sug.confianca || 0 } : null,
          ...meta,
        };
        // A linha que veio repetida do mês anterior (⚠ conferir) é SUBSTITUÍDA pelo valor real
        const ix = b.lancamentos.findIndex(l => l.origem === 'recorrencia' && l.bloco === bloco && finNorm(l.descricao) === finNorm(descricao));
        if (ix >= 0) { b.lancamentos[ix] = { ...b.lancamentos[ix], ...lanc }; trocados++; }
        else { b.lancamentos.push({ id: cryptoRandomId(), ...lanc }); novos++; }
      }
      const gr = await finGravarBalancete(bid, b, !!antes, antes, `Balancete ${ref} — boleto importado`);
      // 2) Conta a pagar (quando a imobiliária paga o boleto)
      if (F.modo === 'imobiliaria' && !gr.pendente) {
        try {
          await tenantPath().collection('contasPagar').add({
            descricao: [F.dados.condominio || F.dados.emissor || 'Conta', F.dados.unidade].filter(Boolean).join(' — '),
            beneficiario: F.dados.beneficiario || F.dados.emissor || null,
            documentoBeneficiario: F.dados.documento_beneficiario || null,
            valor: finR2(F.dados.valor_total || F.itens.reduce((a, i) => a + (Number(i.valor) || 0), 0)),
            vencimento: F.dados.vencimento || null,
            linhaDigitavel: F.dados.linha_digitavel || null,
            contratoId: F.contratoId, imovelId: c.imovelId || null, balanceteId: bid, competencia: finComp(F.mes, F.ano),
            arquivoPath: comp.comprovantePath, arquivoNome: comp.comprovanteNome, importacaoId,
            status: 'aberta',
            criadoEm: firebase.firestore.FieldValue.serverTimestamp(), criadoPor: State.user.uid,
          });
        } catch (e) { console.warn('Conta a pagar não registrada:', e); }
      }
      logAuditoria('importar_conta', 'balancete', bid, { itens: F.itens.length, modo: F.modo, total: F.dados.valor_total || null });
      return { gr, novos, trocados };
    });
  } catch (err) {
    console.error('Lançar importação:', err);
    st(`❌ ${escapeHtml(err.message)}`, 'error');
    return;
  }
  if (!r || r === DRG_IGNORADO) return;
  if (r.gr.pendente) {
    st('🕓 Enviado para aprovação — os lançamentos entram quando um gestor aprovar em ✅ Aprovações.', 'success');
    setTimeout(finFecharImport, 2500);
    return;
  }
  st(`✓ ${r.novos + r.trocados} item(ns) lançados no balancete de ${ref}${r.trocados ? ` (${r.trocados} substituíram valores repetidos do mês anterior)` : ''}. Abrindo o balancete…`, 'success');
  setTimeout(() => {
    finFecharImport();
    if ($('filtro-balancete-mes')) { $('filtro-balancete-mes').value = F.mes; $('filtro-balancete-ano').value = F.ano; }
    if (typeof loadBalancetes === 'function' && $('tbody-balancetes')) loadBalancetes();
    if (typeof finCarregarPainel === 'function') finCarregarPainel();
    openBalanceteModal(bid);
  }, 1200);
}
window.finConfirmarImport = finConfirmarImport;
window.finImportarConta = finImportarConta;


// =============================================================
// FASE 2/3 — 📊 PAINEL DO MÊS · ⚡ GERAR O MÊS · 💳 BOLETO · ✉ LOCATÁRIO · ✓ BAIXA
// =============================================================
// Status da cobrança (Asaas) → como aparece na tela
const FIN_COB = {
  SEM: { txt: 'Sem boleto', cls: 'fin-b-cinza', ico: '○' },
  PENDING: { txt: 'Aguardando pagamento', cls: 'fin-b-azul', ico: '⏳' },
  OVERDUE: { txt: 'Vencido', cls: 'fin-b-vermelho', ico: '⚠' },
  RECEIVED: { txt: 'Pago', cls: 'fin-b-verde', ico: '✓' },
  CONFIRMED: { txt: 'Pago (confirmado)', cls: 'fin-b-verde', ico: '✓' },
  RECEIVED_IN_CASH: { txt: 'Pago (baixa manual)', cls: 'fin-b-verde', ico: '✓' },
  REFUNDED: { txt: 'Estornado', cls: 'fin-b-cinza', ico: '↩' },
  DELETED: { txt: 'Cancelado', cls: 'fin-b-cinza', ico: '✕' },
};
const FIN_REP = {
  AGUARDANDO_APROVACAO: { txt: 'Aguardando aprovação', cls: 'fin-b-amarelo', ico: '🕓' },
  PAGO: { txt: 'Repassado', cls: 'fin-b-verde', ico: '✓' },
  PENDENTE_CADASTRO: { txt: 'Falta cadastro', cls: 'fin-b-vermelho', ico: '⚠' },
  SEM_VALOR: { txt: 'Nada a repassar', cls: 'fin-b-cinza', ico: '—' },
  REJEITADO: { txt: 'Rejeitado', cls: 'fin-b-vermelho', ico: '✕' },
};
const FIN_PAGO = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
function finCobStatus(b) {
  const c = b.cobranca;
  if (!c || !c.asaasId || c.status === 'DELETED') return 'SEM';
  return c.status || 'PENDING';
}
function finFmtData(v) {
  if (!v) return '—';
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split('-').reverse().join('/') : v;
  const d = v.toDate ? v.toDate() : new Date(v);
  return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR');
}
function finHojeISO() { return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); }

let _finPainel = { mes: null, ano: null, balancetes: [], cfg: null, filtro: '', sincronizadoEm: 0 };

async function finCfg() {
  const s = await tenantPath().collection('config').doc('site').get();
  return s.exists ? s.data() : {};
}

// ---------- Células e ações das linhas da tabela de balancetes ----------
function finCelulasLinha(id, b) {
  const st = finCobStatus(b), C = FIN_COB[st] || FIN_COB.PENDING;
  const c = b.cobranca || {};
  const valor = st === 'SEM' ? finValorCobrarLocatario(b) : (c.valorPago || c.valor);
  const sub = st === 'SEM' ? '' : (FIN_PAGO.includes(st) ? `pago ${finFmtData(c.pagaEm)}` : `vence ${finFmtData(c.vencimento)}`);
  const conferir = (b.lancamentos || []).some(l => l.conferirValor);
  const r = b.repasse || {}, R = FIN_REP[r.status];
  return `
    <td><span class="fin-badge ${C.cls}">${C.ico} ${C.txt}</span><br><span class="fin-sub">${fmtBRL(valor)}${sub ? ' · ' + sub : ''}</span>${conferir ? '<br><span class="fin-sub fin-alerta">⚠ valor a conferir</span>' : ''}</td>
    <td>${R ? `<span class="fin-badge ${R.cls}" ${r.motivo ? `title="${escapeHtml(r.motivo)}"` : ''}>${R.ico} ${R.txt}</span>` : '<span class="fin-sub">—</span>'}</td>`;
}
function finAcoesLinha(id, b) {
  const st = finCobStatus(b), c = b.cobranca || {};
  const a = [`<button class="btn btn-sm btn-secondary" onclick="openBalanceteModal('${id}')">Editar</button>`];
  if (st === 'SEM') a.push(`<button class="btn btn-sm btn-primary" onclick="finGerarBoleto('${id}', this)" title="Gera o boleto (com Pix) no Asaas e envia ao locatário por e-mail">💳 Boleto</button>`);
  if (st === 'PENDING' || st === 'OVERDUE') {
    if (c.invoiceUrl) a.push(`<a class="btn btn-sm btn-secondary" href="${escapeHtml(c.invoiceUrl)}" target="_blank" rel="noopener">🔗 Ver boleto</a>`);
    a.push(`<button class="btn btn-sm btn-secondary" onclick="finEnviarLocatario('${id}', this)" title="Reenvia o boleto e o demonstrativo por e-mail ao locatário">✉ Reenviar</button>`);
    a.push(`<button class="btn btn-sm btn-secondary" onclick="finAbrirBaixaManual('${id}')" title="O locatário pagou fora do boleto (Pix direto, dinheiro…)">✓ Baixa manual</button>`);
  }
  if (FIN_PAGO.includes(st) && typeof finEnviarPrestacao === 'function') {
    a.push(`<button class="btn btn-sm btn-secondary" onclick="finEnviarPrestacao('${id}', this)" title="PDF + planilha Excel ao proprietário">📊 Prestação</button>`);
  }
  return a.join(' ');
}
window.finCelulasLinha = finCelulasLinha;
window.finAcoesLinha = finAcoesLinha;

function finFiltroLinha(b) {
  const st = finCobStatus(b);
  return [st === 'SEM' ? 'sem' : FIN_PAGO.includes(st) ? 'pago' : st === 'OVERDUE' ? 'vencido' : 'pendente',
    (b.repasse || {}).status === 'AGUARDANDO_APROVACAO' ? 'repassar' : '', (b.repasse || {}).status === 'PAGO' ? 'repassado' : ''].join(' ');
}
window.finFiltroLinha = finFiltroLinha;

// ---------- Painel (KPIs + pendências do mês) ----------
async function finCarregarPainel() {
  const box = $('fin-painel');
  if (!box || !State.tenant) return;
  const mes = parseInt($('filtro-balancete-mes')?.value, 10), ano = parseInt($('filtro-balancete-ano')?.value, 10);
  if (!mes || !ano) return;
  try {
    const [bSnap, cSnap, cpSnap, cfg] = await Promise.all([
      colecaoNoAlcance('balancetes').where('mes', '==', mes).where('ano', '==', ano).get().then(s => aplicarAlcance('balancetes', 'balancetes', s)),
      colecaoNoAlcance('contratos').get(),
      tenantPath().collection('contasPagar').where('status', '==', 'aberta').get().catch(() => ({ docs: [] })),
      finCfg(),
    ]);
    const bals = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    _finPainel = { ..._finPainel, mes, ano, balancetes: bals, cfg };
    const comp = finComp(mes, ano);
    const vigentes = cSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => finContratoAtivoNoMes(c, mes, ano));
    const comBal = new Set(bals.map(b => b.contratoId));
    const faltam = vigentes.filter(c => !comBal.has(c.id));
    const soma = (arr, f) => finR2(arr.reduce((a, x) => a + (Number(f(x)) || 0), 0));
    const semBoleto = bals.filter(b => finCobStatus(b) === 'SEM');
    const pend = bals.filter(b => finCobStatus(b) === 'PENDING');
    const venc = bals.filter(b => finCobStatus(b) === 'OVERDUE');
    const pagos = bals.filter(b => FIN_PAGO.includes(finCobStatus(b)));
    const aRep = bals.filter(b => (b.repasse || {}).status === 'AGUARDANDO_APROVACAO');
    const rep = bals.filter(b => (b.repasse || {}).status === 'PAGO');
    const semCad = bals.filter(b => (b.repasse || {}).status === 'PENDENTE_CADASTRO');
    const conferir = bals.filter(b => (b.lancamentos || []).some(l => l.conferirValor));
    const contas = cpSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.vencimento || '9').localeCompare(String(b.vencimento || '9')));
    const hoje = finHojeISO();
    const kpi = (f, ico, rot, n, v, cls) => `
      <button type="button" class="fin-kpi ${cls}${_finPainel.filtro === f ? ' ativo' : ''}" onclick="finFiltrar('${f}')">
        <span class="fin-kpi-ico">${ico}</span><span class="fin-kpi-v">${fmtBRL(v)}</span><span class="fin-kpi-r">${rot} · ${n}</span></button>`;
    const alertas = [];
    if (faltam.length) alertas.push(`<button type="button" class="fin-alerta-item" onclick="finGerarMes(this)">⚡ <strong>${faltam.length}</strong> contrato(s) vigente(s) sem balancete em ${finMesAno(mes, ano)} — <u>gerar o mês agora</u></button>`);
    if (conferir.length) alertas.push(`<button type="button" class="fin-alerta-item" onclick="openBalanceteModal('${conferir[0].id}')">⚠ <strong>${conferir.length}</strong> balancete(s) com valor variável repetido para conferir — <u>abrir</u></button>`);
    const prontos = semBoleto.filter(b => !(b.lancamentos || []).some(l => l.conferirValor) && finValorCobrarLocatario(b) > 0);
    if (prontos.length) alertas.push(`<button type="button" class="fin-alerta-item" onclick="finGerarBoletosMes(this)">💳 <strong>${prontos.length}</strong> balancete(s) prontos sem boleto — <u>gerar os boletos e enviar</u></button>`);
    if (semCad.length) alertas.push(`<button type="button" class="fin-alerta-item fin-alerta-vermelho" onclick="finAbrirProprietario('${semCad[0].locadorId || ''}')">⚠ <strong>${semCad.length}</strong> repasse(s) travado(s): ${escapeHtml((semCad[0].repasse || {}).motivo || 'falta cadastro')} — <u>abrir cadastro</u></button>`);
    if (aRep.length) alertas.push(`<button type="button" class="fin-alerta-item" onclick="showSection('aprovacoes')">💸 <strong>${aRep.length}</strong> repasse(s) de ${fmtBRL(soma(aRep, b => b.repasse.valor))} aguardando aprovação — <u>aprovar</u></button>`);
    if (!cfg.asaasTenantToken) alertas.push(`<button type="button" class="fin-alerta-item fin-alerta-vermelho" onclick="showSection('configuracoes')">🔌 Asaas não conectado — <u>cole a chave API em Configurações</u> para gerar boletos</button>`);
    else alertas.push(`<span class="fin-alerta-item fin-alerta-neutro" id="fin-webhook-aviso">🔗 Baixa automática: verificando…</span>`);
    if (typeof finAlertasReajuste === 'function') alertas.push(...(await finAlertasReajuste(vigentes, mes, ano)));

    box.innerHTML = `
      <div class="fin-painel-topo">
        <div><h4>💰 Movimento de ${finMesAno(mes, ano)}</h4><span class="muted">Cobranças no Asaas, repasses e contas a pagar do mês</span></div>
        <div class="fin-painel-botoes">
          <button class="btn btn-secondary" onclick="finGerarMes(this)" title="Cria os balancetes do mês para os contratos vigentes, com o aluguel e as despesas que se repetem">⚡ Gerar o mês</button>
          <button class="btn btn-secondary" onclick="finGerarBoletosMes(this)" title="Gera no Asaas os boletos de todos os balancetes prontos e envia aos locatários">💳 Gerar boletos</button>
          <button class="btn btn-secondary" onclick="finSincronizar(this)" title="Confere no Asaas o que já foi pago e dá baixa">🔄 Atualizar do Asaas</button>
        </div>
      </div>
      <div class="fin-kpis">
        ${kpi('sem', '○', 'A cobrar (sem boleto)', semBoleto.length, soma(semBoleto, finValorCobrarLocatario), 'k-cinza')}
        ${kpi('pendente', '⏳', 'Aguardando pagamento', pend.length, soma(pend, b => b.cobranca.valor), 'k-azul')}
        ${kpi('vencido', '⚠', 'Vencido', venc.length, soma(venc, b => b.cobranca.valor), 'k-vermelho')}
        ${kpi('pago', '✓', 'Recebido', pagos.length, soma(pagos, b => b.cobranca.valorPago || b.cobranca.valor), 'k-verde')}
        ${kpi('repassar', '🕓', 'A repassar', aRep.length, soma(aRep, b => b.repasse.valor), 'k-amarelo')}
        ${kpi('repassado', '💸', 'Repassado', rep.length, soma(rep, b => b.repasse.valor), 'k-verde')}
      </div>
      ${alertas.length ? `<div class="fin-alertas">${alertas.join('')}</div>` : ''}
      ${contas.length ? `
      <details class="fin-contas" ${contas.some(x => x.vencimento && x.vencimento <= hoje) ? 'open' : ''}>
        <summary>🏢 Contas a pagar em aberto: <strong>${contas.length}</strong> · ${fmtBRL(soma(contas, x => x.valor))}${contas.some(x => x.vencimento && x.vencimento < hoje) ? ' · <span class="fin-alerta">⚠ há conta vencida</span>' : ''}</summary>
        <div class="fin-contas-lista">${contas.map(x => `
          <div class="fin-conta${x.vencimento && x.vencimento < hoje ? ' vencida' : ''}">
            <div><strong>${escapeHtml(x.descricao || 'Conta')}</strong><br><span class="fin-sub">${escapeHtml(x.beneficiario || '')} · comp. ${escapeHtml(x.competencia || '')}</span></div>
            <div class="fin-conta-v"><strong>${fmtBRL(x.valor)}</strong><br><span class="fin-sub">vence ${finFmtData(x.vencimento)}</span></div>
            <div class="fin-conta-acoes">
              ${x.linhaDigitavel ? `<button type="button" class="btn btn-sm btn-secondary" onclick="finCopiar(this, ${escapeHtml(JSON.stringify(x.linhaDigitavel))})">📋 Linha digitável</button>` : ''}
              ${x.arquivoPath ? `<button type="button" class="btn btn-sm btn-secondary" onclick="finAbrirArquivo('${escapeHtml(x.arquivoPath)}')">📄 Boleto</button>` : ''}
              <button type="button" class="btn btn-sm btn-primary" onclick="finContaPaga('${x.id}', this)">✓ Paguei</button>
            </div>
          </div>`).join('')}</div>
      </details>` : ''}`;
    finAplicarFiltro();
    if (cfg.asaasTenantToken) finVerWebhook();
    // Sincroniza sozinho (no máx. a cada 10 min) as cobranças em aberto do mês
    if (cfg.asaasTenantToken && (pend.length || venc.length) && Date.now() - _finPainel.sincronizadoEm > 600000) {
      _finPainel.sincronizadoEm = Date.now();
      finSincronizar(null, true);
    }
  } catch (err) {
    console.error('Painel financeiro:', err);
    box.innerHTML = `<div class="fin-alerta-item fin-alerta-vermelho">❌ Painel: ${escapeHtml(err.message)}</div>`;
  }
}
window.finCarregarPainel = finCarregarPainel;

function finContratoAtivoNoMes(c, mes, ano) {
  if (c.status !== 'vigente') return false;
  // Só não cobra antes do início. Contrato "vigente" depois do fim = prorrogado por prazo
  // indeterminado (Lei 8.245, art. 46 §1º) — continua gerando o mês até ser encerrado.
  const ini = String(c.inicio || '').slice(0, 7);
  return !ini || finComp(mes, ano) >= ini;
}

function finFiltrar(f) {
  _finPainel.filtro = _finPainel.filtro === f ? '' : f;
  document.querySelectorAll('.fin-kpi').forEach(el => el.classList.toggle('ativo', el.getAttribute('onclick') === `finFiltrar('${_finPainel.filtro}')`));
  finAplicarFiltro();
}
function finAplicarFiltro() {
  const f = _finPainel.filtro;
  document.querySelectorAll('#tbody-balancetes tr[data-fin]').forEach(tr => {
    tr.style.display = !f || tr.dataset.fin.split(' ').includes(f) ? '' : 'none';
  });
}
window.finFiltrar = finFiltrar; window.finAplicarFiltro = finAplicarFiltro;

async function finVerWebhook() {
  const el = $('fin-webhook-aviso');
  if (!el) return;
  try {
    const w = (await tenantPath().collection('config').doc('asaasWebhook').get()).data();
    if (w && w.ativo) { el.innerHTML = '🔗 Baixa automática <strong>ligada</strong> — boleto pago dá baixa e cria o repasse sozinho'; el.classList.add('fin-alerta-ok'); return; }
  } catch (_) {}
  const admin = State.userDoc?.role === 'admin' || State.isSuperAdmin;
  el.outerHTML = admin
    ? `<button type="button" class="fin-alerta-item" onclick="finAtivarWebhook(this)">🔗 Baixa automática <strong>desligada</strong> — <u>ligar agora</u> (configura o aviso de pagamento na sua conta Asaas)</button>`
    : `<span class="fin-alerta-item fin-alerta-neutro">🔗 Baixa automática desligada — o administrador liga em um clique aqui no painel. Enquanto isso, "🔄 Atualizar do Asaas" dá a baixa.</span>`;
}

async function finAtivarWebhook(btn) {
  try {
    const r = await drgSubmit(btn, '⏳ Ligando no Asaas… aguarde', async () => {
      const { url, token } = await getCfgAsaas();
      if (!url || !token) throw new Error('Configure a URL do Worker e a chave Asaas em Configurações.');
      const res = await fetch(`${url}/tenant/webhook/configurar`, { method: 'POST', headers: await asaasHeaders(token), body: JSON.stringify({ tenantId: State.tenant.id }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) throw new Error(j.error || `Erro ${res.status}`);
      logAuditoria('ativar_webhook_asaas', 'config', 'asaasWebhook', { url: j.url });
      return j;
    });
    if (r === DRG_IGNORADO) return;
    btn.outerHTML = '<span class="fin-alerta-item fin-alerta-ok">✓ Baixa automática <strong>ligada</strong>. Boleto pago agora dá baixa sozinho e já cria o repasse ao proprietário.</span>';
  } catch (err) {
    finAvisoSecao(`❌ Não liguei a baixa automática: ${escapeHtml(err.message)}`, 'error');
  }
}
window.finAtivarWebhook = finAtivarWebhook;

function finAbrirProprietario(id) { if (id) openLocadorModal(id); else showSection('locadores'); }
async function finAbrirArquivo(path) {
  try { window.open(await storage.ref().child(path).getDownloadURL(), '_blank'); }
  catch (e) { finAvisoSecao('❌ Não abri o arquivo: ' + escapeHtml(e.message), 'error'); }
}
window.finAbrirProprietario = finAbrirProprietario; window.finAbrirArquivo = finAbrirArquivo;

async function finContaPaga(id, btn) {
  const ok = await confirmar({ titulo: '✓ Marcar como paga?', mensagem: 'Confirma que esta conta já foi paga?', detalhe: 'Sai da lista de contas a pagar e entra no Livro Caixa como saída.', confirmar: '✓ Paguei' });
  if (!ok) return;
  try {
    await drgSubmit(btn, '⏳ Salvando…', async () => {
      const ref = tenantPath().collection('contasPagar').doc(id);
      const x = (await ref.get()).data() || {};
      await ref.update({ status: 'paga', pagaEm: finHojeISO(), pagaPor: State.user.uid });
      try {
        await tenantPath().collection('caixaPool').doc(`conta_${id}`).set({
          tipo: 'saida', rubrica: 'Conta paga (condomínio/consumo)', nome: x.beneficiario || x.descricao || '',
          valor: finR2(x.valor), data: finHojeISO(), competencia: x.competencia || finHojeISO().slice(0, 7),
          origem: 'contas-pagar', refId: id, criadoEm: firebase.firestore.FieldValue.serverTimestamp(), criadoPor: State.user.uid,
        });
      } catch (e) { console.warn('Livro Caixa (sem permissão?)', e); }
      logAuditoria('conta_paga', 'contasPagar', id, { valor: x.valor });
    });
    finAvisoSecao('✓ Conta marcada como paga.', 'success');
    finCarregarPainel();
  } catch (err) { finAvisoSecao(`❌ ${escapeHtml(err.message)}`, 'error'); }
}
window.finContaPaga = finContaPaga;

// ---------- ⚡ Gerar o mês ----------
// Para cada contrato vigente sem balancete no mês: aluguel do contrato + as linhas marcadas
// para repetir no último balancete dele (variáveis voltam com ⚠ para conferir o valor).
async function finUltimoBalancete(contratoId, mes, ano) {
  for (let k = 1; k <= 12; k++) {
    let m = mes - k, a = ano;
    while (m < 1) { m += 12; a--; }
    const s = await tenantPath().collection('balancetes').doc(balanceteId(a, m, contratoId)).get();
    if (s.exists) return { id: s.id, ...s.data() };
  }
  return null;
}
function finLinhasQueRepetem(ant, mes, ano) {
  const comp = finComp(mes, ano);
  return (ant?.lancamentos || []).filter(l => l.repetir && !(l.bloco === 'entrada' && l.categoria === 'aluguel')
    && (!l.repetirAte || comp <= l.repetirAte))
    .map(l => ({
      ...l, id: cryptoRandomId(), origem: 'recorrencia', recorrenciaDe: ant.id,
      conferirValor: l.tipoValor === 'variavel',
      comprovantePath: null, comprovanteNome: null, boletoLinhaDigitavel: null, boletoVencimento: null, importacaoId: null,
    }));
}

async function finGerarMes(btn) {
  const mes = parseInt($('filtro-balancete-mes').value, 10), ano = parseInt($('filtro-balancete-ano').value, 10);
  if (nivelPermissao('balancetes', 'criar') !== 'sim') { finAvisoSecao('⛔ Seu perfil não permite criar balancetes (ou só "com aprovação"). Peça a um gestor.', 'error'); return; }
  const cSnap = await colecaoNoAlcance('contratos').get();
  const vig = cSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => finContratoAtivoNoMes(c, mes, ano));
  const existentes = new Set((await colecaoNoAlcance('balancetes').where('mes', '==', mes).where('ano', '==', ano).get()).docs.map(d => d.data().contratoId));
  const faltam = vig.filter(c => !existentes.has(c.id));
  if (!faltam.length) { finAvisoSecao(`✓ Todos os ${vig.length} contrato(s) vigentes já têm balancete em ${finMesAno(mes, ano)}.`, 'success'); return; }
  if (!(await confirmar({ titulo: `⚡ Gerar ${finMesAno(mes, ano)}?`, mensagem: `Criar <strong>${faltam.length}</strong> balancete(s) com o aluguel de cada contrato e as despesas marcadas para repetir.`,
    detalhe: 'Despesas variáveis entram com o valor do mês anterior e marcadas com ⚠ — confira antes de gerar o boleto. Importar o boleto do mês substitui o valor repetido.', confirmar: '⚡ Gerar' }))) return;
  let feitos = 0, comRep = 0, erros = [];
  try {
    await drgSubmit(btn, `⏳ Gerando 0/${faltam.length}…`, async () => {
      for (const c of faltam) {
        try {
          const b = await finNovoBalanceteBase(c, c.id, mes, ano);
          const ant = await finUltimoBalancete(c.id, mes, ano);
          const rep = finLinhasQueRepetem(ant, mes, ano);
          if (ant && ant.taxaIncidencia) { b.taxaIncidencia = ant.taxaIncidencia; b.taxaIncideIds = []; }
          b.lancamentos.push(...rep);
          if (rep.length) comRep++;
          b.geradoAutomatico = true;
          await finGravarBalancete(balanceteId(ano, mes, c.id), b, false, null, `Balancete ${finMesAno(mes, ano)} (gerado)`);
          feitos++;
          if (btn) btn.innerHTML = `⏳ Gerando ${feitos}/${faltam.length}…`;
        } catch (e) { erros.push(e.message); }
      }
    }, { destravar: true });
    logAuditoria('gerar_mes', 'balancete', finComp(mes, ano), { criados: feitos, erros: erros.length });
    finAvisoSecao(`${erros.length ? '⚠' : '✓'} ${feitos} balancete(s) gerados em ${finMesAno(mes, ano)}${comRep ? ` (${comRep} com despesas repetidas)` : ''}.${erros.length ? ` ${erros.length} falharam: ${escapeHtml(erros[0])}` : ''}`, erros.length ? 'error' : 'success');
  } catch (err) { finAvisoSecao(`❌ ${escapeHtml(err.message)}`, 'error'); }
  loadBalancetes();
}
window.finGerarMes = finGerarMes;

// ---------- 💳 Boleto ao locatário ----------
function finDataVencimento(c, mes, ano) {
  const dia = Math.min(Math.max(parseInt(c.diaVencimento, 10) || 5, 1), 28);
  let venc = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  const min = new Date(Date.now() - 3 * 3600e3 + 2 * 86400e3).toISOString().slice(0, 10);   // Asaas não aceita vencimento no passado
  return { venc: venc < min ? min : venc, ajustado: venc < min, original: venc };
}

async function finGerarBoleto(bid, btn, opts = {}) {
  const fala = (m, k) => { if (!opts.silencioso) finAvisoSecao(m, k); };
  if (!pode('aprovarCobranca')) { fala('⛔ Seu perfil não permite gerar cobrança (💳 Aprovar cobrança ao locatário). Peça a quem gerencia a equipe.', 'error'); return { erro: 'sem permissão' }; }
  let r;
  try {
    r = await drgSubmit(btn, '⏳ Gerando boleto… aguarde', async () => {
      const ref = tenantPath().collection('balancetes').doc(bid);
      const b = (await ref.get()).data();
      if (!b) throw new Error('Balancete não encontrado.');
      if (finCobStatus(b) !== 'SEM') throw new Error('Este balancete já tem boleto.');
      if ((b.lancamentos || []).some(l => l.conferirValor)) throw new Error(`Confira os valores ⚠ variáveis do balancete de ${finMesAno(b.mes, b.ano)} antes de cobrar.`);
      const valor = finValorCobrarLocatario(b);
      if (!(valor >= 5)) throw new Error(`Valor a cobrar (${fmtBRL(valor)}) inválido — o Asaas exige no mínimo R$ 5,00.`);
      const c = (await tenantPath().collection('contratos').doc(b.contratoId).get()).data() || {};
      if (!c.locatarioId) throw new Error('Contrato sem locatário.');
      const customer = await garantirCustomerAsaas(c.locatarioId);
      const { url, token } = await getCfgAsaas();
      const pad = await getPadroesTenant();
      const v = finDataVencimento(c, b.mes, b.ano);
      const itens = (b.lancamentos || []).filter(l => l.bloco === 'entrada' || l.bloco === 'despesa_locatario')
        .map(l => `${l.descricao || LANC_CATEGORIA_LABEL[l.categoria] || l.categoria}: ${fmtBRL(l.valor)}`);
      let im = {};
      try { im = (await tenantPath().collection('imoveis').doc(b.imovelId).get()).data() || {}; } catch (_) {}
      const descricao = `Aluguel e encargos ${finMesAno(b.mes, b.ano)} — ${im.apelido || 'imóvel'}. ${itens.join('; ')}`.slice(0, 480);
      const res = await fetch(`${url}/tenant/payments`, {
        method: 'POST', headers: await asaasHeaders(token),
        body: JSON.stringify({
          customer, billingType: 'BOLETO', value: valor.toFixed(2), dueDate: v.venc, description: descricao,
          externalReference: `bal:${State.tenant.id}:${bid}`,
          multaPercent: pad.multaAtraso ?? 2, jurosPercentMes: pad.jurosMora ?? 1,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) throw new Error(j.error || `Asaas: erro ${res.status}`);
      const p = j.payment;
      await ref.update({ cobranca: {
        asaasId: p.id, status: p.status || 'PENDING', valor, vencimento: v.venc, vencimentoContrato: v.original,
        invoiceUrl: p.invoiceUrl || null, bankSlipUrl: p.bankSlipUrl || null,
        criadaEm: firebase.firestore.FieldValue.serverTimestamp(), criadaPor: State.user.uid,
      } });
      logAuditoria('gerar_boleto', 'balancete', bid, { valor, vencimento: v.venc, asaasId: p.id });
      return { valor, venc: v, ajustado: v.ajustado };
    }, { destravar: !!opts.lote });
  } catch (err) {
    console.error('Gerar boleto:', err);
    fala(`❌ Boleto não gerado: ${escapeHtml(err.message)}`, 'error');
    return { erro: err.message };
  }
  if (!r || r === DRG_IGNORADO) return { erro: 'ignorado' };
  // E-mail ao locatário sai junto (regra do dono: boleto + relatório vão para o e-mail dele)
  const env = await finEnviarLocatario(bid, null, { silencioso: true });
  fala(`✓ Boleto de ${fmtBRL(r.valor)} gerado, vencimento ${finFmtData(r.venc.venc)}${r.ajustado ? ` (o dia ${finFmtData(r.venc.original)} já passou — ajustado)` : ''}. ${env.ok ? `✉ Enviado para ${escapeHtml(env.para)}.` : `⚠ E-mail não saiu: ${escapeHtml(env.erro || '')}`}`, env.ok ? 'success' : 'error');
  if (!opts.lote) loadBalancetes();
  return { ok: true, email: env };
}
window.finGerarBoleto = finGerarBoleto;

async function finGerarBoletosMes(btn) {
  const lista = (_finPainel.balancetes || []).filter(b => finCobStatus(b) === 'SEM')
    .filter(b => !(b.lancamentos || []).some(l => l.conferirValor) && finValorCobrarLocatario(b) >= 5);
  if (!lista.length) { finAvisoSecao('Nenhum balancete pronto para boleto neste mês (sem boleto, sem ⚠ a conferir, valor ≥ R$ 5).', 'info'); return; }
  const total = finR2(lista.reduce((a, b) => a + finValorCobrarLocatario(b), 0));
  if (!(await confirmar({ titulo: `💳 Gerar ${lista.length} boleto(s)?`, mensagem: `Total de <strong>${fmtBRL(total)}</strong> em ${finMesAno(_finPainel.mes, _finPainel.ano)}.`,
    detalhe: 'Cada locatário recebe por e-mail o boleto (com Pix) e o demonstrativo das despesas. Vencimento = dia do contrato.', confirmar: '💳 Gerar e enviar' }))) return;
  btn.disabled = true;
  const orig = btn.innerHTML;
  let ok = 0, mail = 0; const erros = [];
  for (let i = 0; i < lista.length; i++) {
    btn.innerHTML = `⏳ Boleto ${i + 1}/${lista.length}…`;
    const r = await finGerarBoleto(lista[i].id, null, { silencioso: true, lote: true });
    if (r.ok) { ok++; if (r.email?.ok) mail++; } else erros.push(r.erro);
  }
  btn.disabled = false; btn.innerHTML = orig;
  finAvisoSecao(`${erros.length ? '⚠' : '✓'} ${ok} boleto(s) gerado(s), ${mail} e-mail(s) enviados.${erros.length ? ` ${erros.length} com erro: ${escapeHtml(erros[0])}` : ''}`, erros.length ? 'error' : 'success');
  loadBalancetes();
}
window.finGerarBoletosMes = finGerarBoletosMes;

// ---------- 🔄 Sincronizar com o Asaas (o servidor dá a baixa) ----------
async function finSincronizar(btn, silencioso) {
  const ids = (_finPainel.balancetes || []).filter(b => ['PENDING', 'OVERDUE'].includes(finCobStatus(b))).map(b => b.cobranca.asaasId);
  if (!ids.length) { if (!silencioso) finAvisoSecao('✓ Nenhuma cobrança em aberto neste mês.', 'success'); return; }
  try {
    const r = await drgSubmit(btn, '⏳ Conferindo no Asaas…', async () => {
      const { url, token } = await getCfgAsaas();
      const res = await fetch(`${url}/tenant/financeiro/sincronizar`, { method: 'POST', headers: await asaasHeaders(token), body: JSON.stringify({ tenantId: State.tenant.id, paymentIds: ids }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) throw new Error(j.error || `Erro ${res.status}`);
      return j;
    }, { destravar: true });
    if (r === DRG_IGNORADO) return;
    const pagos = Object.values(r.status || {}).filter(s => FIN_PAGO.includes(s)).length;
    if (!silencioso || pagos) finAvisoSecao(`✓ Conferido no Asaas: ${ids.length} cobrança(s) em aberto${pagos ? ` — <strong>${pagos} paga(s)</strong>, baixa feita e repasse criado` : ', nenhuma paga ainda'}.`, 'success');
    if (pagos || !silencioso) loadBalancetes();
  } catch (err) { if (!silencioso) finAvisoSecao(`❌ ${escapeHtml(err.message)}`, 'error'); }
}
window.finSincronizar = finSincronizar;

// ---------- ✓ Baixa manual (pagou fora do boleto) ----------
function finAbrirBaixaManual(bid) {
  const b = (_finPainel.balancetes || []).find(x => x.id === bid);
  if (!b) return;
  let m = $('modal-fin-baixa');
  if (!m) {
    m = document.createElement('div');
    m.className = 'modal-overlay'; m.id = 'modal-fin-baixa'; m.style.display = 'none';
    m.addEventListener('mousedown', (e) => { if (e.target === m) m.style.display = 'none'; });
    document.body.appendChild(m);
  }
  const c = b.cobranca || {};
  m.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>✓ Baixa manual — ${finMesAno(b.mes, b.ano)}</h3>
        <button class="modal-close" onclick="$('modal-fin-baixa').style.display='none'" title="Fechar">×</button></div>
      <div class="modal-body">
        <p class="muted" style="margin-top:0;">Use quando o locatário pagou <strong>fora do boleto</strong>. O boleto no Asaas é marcado como recebido (para de cobrar) e o repasse ao proprietário é criado para aprovação.</p>
        <div class="form-row">
          <div class="form-group"><label>Data do pagamento</label><input type="date" id="fin-bx-data" value="${finHojeISO()}" max="${finHojeISO()}"></div>
          <div class="form-group"><label>Valor recebido</label><input type="text" data-moeda id="fin-bx-valor" value="${c.valor || finValorCobrarLocatario(b)}"></div>
        </div>
        <div class="form-group"><label>Como pagou</label>
          <select id="fin-bx-forma"><option>Pix direto na conta da imobiliária</option><option>Transferência / TED</option><option>Dinheiro</option><option>Depósito</option><option>Outro</option></select></div>
        <div class="form-group"><label>Observação</label><input type="text" id="fin-bx-obs" placeholder="opcional"></div>
        <p class="fin-sub">⚠ O PIX ao proprietário sai do saldo da conta Asaas. Se o dinheiro entrou em outra conta, transfira para o Asaas antes de aprovar o repasse.</p>
        <div id="fin-bx-status" class="status-inline" style="display:none;"></div>
      </div>
      <div class="modal-footer fin-imp-botoes">
        <button class="btn btn-secondary" onclick="$('modal-fin-baixa').style.display='none'">Cancelar</button>
        <button class="btn btn-primary" onclick="finConfirmarBaixa('${bid}', this)">✓ Dar baixa</button>
      </div>
    </div>`;
  m.style.display = 'flex';
}
window.finAbrirBaixaManual = finAbrirBaixaManual;

async function finConfirmarBaixa(bid, btn) {
  const st = (msg, k) => showInlineStatus('fin-bx-status', msg, k);
  const data = $('fin-bx-data').value, valor = parseFloat($('fin-bx-valor').value) || 0, forma = $('fin-bx-forma').value, obs = $('fin-bx-obs').value.trim();
  if (!data) { st('❌ Informe a data do pagamento.', 'error'); return; }
  if (!(valor > 0)) { st('❌ Informe o valor recebido.', 'error'); return; }
  if (!pode('aprovarCobranca')) { st('⛔ Seu perfil não permite dar baixa em cobrança.', 'error'); return; }
  let res;
  try {
    res = await drgSubmit(btn, '⏳ Dando baixa… aguarde', async () => {
      const ref = tenantPath().collection('balancetes').doc(bid);
      const b0 = (await ref.get()).data();
      const c = b0.cobranca || {};
      if (c.asaasId && ['PENDING', 'OVERDUE'].includes(c.status)) {
        const { url, token } = await getCfgAsaas();
        const r = await fetch(`${url}/tenant/payments/${c.asaasId}/receiveInCash`, { method: 'POST', headers: await asaasHeaders(token), body: JSON.stringify({ paymentDate: data, value: valor }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.success) throw new Error('Asaas: ' + (j.error || r.status));
      }
      const b = (await ref.get()).data();   // o webhook pode ter chegado antes
      if (!(b.cobranca || {}).baixaProcessada) {
        await ref.update({ cobranca: { ...(b.cobranca || {}), status: 'RECEIVED_IN_CASH', pagaEm: data, valorPago: valor, valorLiquido: valor,
          baixa: 'manual', baixaForma: forma, baixaObs: obs || null, baixaPor: State.user.uid, baixaProcessada: true } });
        try { await tenantPath().collection('contratos').doc(b.contratoId).update({ inadimplente: false }); } catch (_) {}
      }
      try {
        await tenantPath().collection('caixaPool').doc(`manual_${bid}`).set({
          tipo: 'entrada', rubrica: 'Aluguel recebido (baixa manual)', nome: forma, valor, data,
          competencia: finComp(b.mes, b.ano), origem: 'baixa-manual', refId: bid,
          criadoEm: firebase.firestore.FieldValue.serverTimestamp(), criadoPor: State.user.uid,
        });
      } catch (e) { console.warn('Livro Caixa (sem permissão?)', e); }
      const rep = await finSolicitarRepasse(bid);
      logAuditoria('baixa_manual', 'balancete', bid, { valor, data, forma });
      return rep;
    });
  } catch (err) { st(`❌ ${escapeHtml(err.message)}`, 'error'); return; }
  if (!res || res === DRG_IGNORADO) return;
  st(`✓ Baixa feita. ${res.msg}`, 'success');
  setTimeout(() => { $('modal-fin-baixa').style.display = 'none'; loadBalancetes(); }, 1800);
}
window.finConfirmarBaixa = finConfirmarBaixa;

// Repasse a partir do balancete GRAVADO (não do texto da tela). Id fixo rep_<balanceteId>:
// nunca existem duas solicitações para o mesmo mês/contrato.
async function finSolicitarRepasse(bid) {
  const solRef = tenantPath().collection('solicitacoesPagamento').doc(`rep_${bid}`);
  if ((await solRef.get()).exists) return { msg: 'O repasse ao proprietário já estava criado.' };
  const bRef = tenantPath().collection('balancetes').doc(bid);
  const b = (await bRef.get()).data();
  const marca = (status, extra) => bRef.update({ repasse: { ...(b.repasse || {}), status, ...(extra || {}) } }).catch(() => {});
  const valor = finR2(b.liquidoLocador);
  if (!(valor > 0)) { await marca('SEM_VALOR'); return { msg: 'Nada a repassar (líquido zero).' }; }
  const loc = (await tenantPath().collection('locadores').doc(b.locadorId).get()).data();
  if (!loc) { await marca('PENDENTE_CADASTRO', { motivo: 'Proprietário não encontrado.' }); return { msg: '⚠ Repasse travado: proprietário não encontrado.' }; }
  const dest = destinoRepasse(loc);
  if (dest.pendencias?.length) { await marca('PENDENTE_CADASTRO', { motivo: 'Representante: ' + dest.pendencias.join('; ') }); return { msg: '⚠ Repasse travado: ' + dest.pendencias.join('; ') }; }
  if (!dest.pix) { await marca('PENDENTE_CADASTRO', { motivo: 'Proprietário sem chave PIX cadastrada.' }); return { msg: '⚠ Repasse travado: proprietário sem chave PIX.' }; }
  if (!pode('solicitarRepasse')) return { msg: '⚠ Seu perfil não solicita repasse — peça a um gestor (💸 em Balancetes).' };
  const paraRep = dest.para === 'representante';
  const pix = String(dest.pix).trim();
  let tipo = 'EVP';
  if (paraRep) tipo = dest.pixTipo;
  else if (pix.includes('@')) tipo = 'EMAIL';
  else if (/^\d{11}$/.test(pix.replace(/\D/g, '')) && !pix.startsWith('+')) tipo = 'CPF';
  else if (/^\d{14}$/.test(pix.replace(/\D/g, ''))) tipo = 'CNPJ';
  else if (/^\+?\d{10,13}$/.test(pix.replace(/\D/g, ''))) tipo = 'PHONE';
  const ref = finMesAno(b.mes, b.ano);
  await solRef.set({
    tipo: 'pagamento_locador', status: 'AGUARDANDO_APROVACAO', valor, pixAddressKey: pix, pixAddressKeyType: tipo,
    descricao: paraRep ? `Repasse aluguel ${ref} — ${loc.nome} (via ${dest.nome})` : `Repasse aluguel ${ref} — ${loc.nome}`,
    locadorId: b.locadorId, locadorNome: loc.nome || '', destinatario: paraRep ? 'representante' : 'locador',
    favorecidoNome: paraRep ? dest.nome : (loc.nome || ''), favorecidoDocumento: paraRep ? dest.pix : null,
    instrumento: paraRep ? { tipo: dest.instrumento?.tipo || null, data: dest.instrumento?.data || null, validade: dest.instrumento?.validade || null, arquivoPath: dest.instrumento?.arquivo?.path || null } : null,
    contratoId: b.contratoId, balanceteId: bid, balanceteRef: ref, origem: 'baixa-manual',
    solicitadoPor: State.user.uid, solicitadoPorNome: State.userDoc?.nome || State.user.email || '', solicitadoPorEmail: State.user.email || '',
    solicitadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await marca('AGUARDANDO_APROVACAO', { solicitacaoId: solRef.id, valor });
  logAuditoria('create', 'solicitacaoPagamento', solRef.id, { valor, origem: 'baixa-manual' });
  return { msg: `Repasse de ${fmtBRL(valor)} ao proprietário criado — falta aprovar (senha + 2FA) em ✅ Aprovações.` };
}
window.finSolicitarRepasse = finSolicitarRepasse;


// =============================================================
// FASE 4 — ✉ DEMONSTRATIVO DO LOCATÁRIO · 📊 PRESTAÇÃO DE CONTAS DO PROPRIETÁRIO
// =============================================================
// Os dois documentos saem do MESMO balancete gravado. HTML com estilo embutido (funciona em
// e-mail), o mesmo HTML vira PDF (html2pdf) e a prestação ganha planilha Excel formatada
// (ExcelJS, carregado só quando precisa).
const FIN_COR = '#00796B', FIN_COR_CLARA = '#E0F2F1';

async function finContexto(bid) {
  const bSnap = await tenantPath().collection('balancetes').doc(bid).get();
  if (!bSnap.exists) throw new Error('Balancete não encontrado.');
  const b = { id: bid, ...bSnap.data() };
  const T = tenantPath();
  const g = async (col, id) => { if (!id) return {}; try { return (await T.collection(col).doc(id).get()).data() || {}; } catch (_) { return {}; } };
  const [contrato, locador, locatario, imovel, cfg] = await Promise.all([
    g('contratos', b.contratoId), g('locadores', b.locadorId), g('locatarios', b.locatarioId), g('imoveis', b.imovelId), finCfg(),
  ]);
  return { b, contrato, locador, locatario, imovel, cfg, tenant: State.tenant || {}, ref: finMesAno(b.mes, b.ano) };
}
function finEnderecoImovel(im) {
  const e = im.endereco && typeof im.endereco === 'object' ? im.endereco : im;
  return [e.logradouro, e.numero, e.complemento, e.bairro, e.cidade && e.uf ? `${e.cidade}/${e.uf}` : e.cidade].filter(Boolean).join(', ');
}
function finRotulo(l) { return l.descricao || LANC_CATEGORIA_LABEL[l.categoria] || l.categoria || '—'; }
function finEsc(s) { return escapeHtml(String(s == null ? '' : s)); }

function finCabecalhoDoc(ctx, titulo, sub) {
  const t = ctx.tenant;
  const doc = t.cnpj ? `CNPJ ${t.cnpj}` : '';
  return `
  <div style="background:${FIN_COR};color:#fff;padding:18px 22px;border-radius:8px 8px 0 0;">
    <div style="font-size:19px;font-weight:700;">${finEsc(t.nome || 'Imobiliária')}</div>
    <div style="font-size:12px;opacity:.9;">${finEsc([doc, t.creci ? `CRECI ${t.creci}` : '', t.telefone || ''].filter(Boolean).join(' · '))}</div>
  </div>
  <div style="background:${FIN_COR_CLARA};padding:12px 22px;border-bottom:3px solid ${FIN_COR};">
    <div style="font-size:16px;font-weight:700;color:#004D40;">${finEsc(titulo)}</div>
    <div style="font-size:13px;color:#33691E;color:#00695C;">${finEsc(sub)}</div>
  </div>`;
}
function finInfoGrid(pares) {
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;">${pares.map(([k, v]) =>
    `<tr><td style="padding:5px 8px;color:#607D8B;width:34%;border-bottom:1px solid #ECEFF1;">${finEsc(k)}</td><td style="padding:5px 8px;font-weight:600;border-bottom:1px solid #ECEFF1;">${v}</td></tr>`).join('')}</table>`;
}
function finTabela(titulo, linhas, totalRot, total, corTotal) {
  if (!linhas.length) return '';
  return `
  <div style="font-size:12px;font-weight:700;color:${FIN_COR};text-transform:uppercase;letter-spacing:.04em;margin:18px 0 6px;">${finEsc(titulo)}</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    ${linhas.map((l, i) => `<tr style="background:${i % 2 ? '#FAFAFA' : '#fff'};">
      <td style="padding:7px 10px;border-bottom:1px solid #ECEFF1;">${finEsc(l[0])}${l[2] ? `<div style="font-size:11px;color:#90A4AE;">${finEsc(l[2])}</div>` : ''}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #ECEFF1;text-align:right;white-space:nowrap;${Number(l[1]) < 0 ? 'color:#C62828;' : ''}">${fmtBRL(l[1])}</td></tr>`).join('')}
    <tr><td style="padding:8px 10px;font-weight:700;background:${corTotal || '#F5F5F5'};">${finEsc(totalRot)}</td>
      <td style="padding:8px 10px;font-weight:700;text-align:right;background:${corTotal || '#F5F5F5'};white-space:nowrap;">${fmtBRL(total)}</td></tr>
  </table>`;
}
function finRodape(ctx) {
  return `<div style="margin-top:22px;padding-top:10px;border-top:1px solid #CFD8DC;font-size:11px;color:#90A4AE;">
    Documento gerado em ${new Date().toLocaleString('pt-BR')} por ${finEsc(ctx.tenant.nome || '')} · DRG-Rently</div>`;
}
function finEnvelopar(miolo) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#263238;max-width:680px;margin:0 auto;background:#fff;border:1px solid #CFD8DC;border-radius:8px;">${miolo}</div>`;
}

// ---------- Locatário ----------
function finHtmlLocatario(ctx, pag) {
  const { b, locatario, imovel, ref } = ctx;
  const c = b.cobranca || {};
  const L = b.lancamentos || [];
  const linhas = [
    ...L.filter(l => l.bloco === 'entrada').map(l => [finRotulo(l), l.valor, l.categoria === 'abatimento' ? 'abatimento' : '']),
    ...L.filter(l => l.bloco === 'despesa_locatario').map(l => [finRotulo(l), l.valor, l.boletoBeneficiario ? `repasse a ${l.boletoBeneficiario}` : '']),
  ];
  const total = finValorCobrarLocatario(b);
  const pago = FIN_PAGO.includes(c.status);
  const botao = !pago && c.invoiceUrl ? `
    <div style="text-align:center;margin:18px 0 6px;">
      <a href="${finEsc(c.invoiceUrl)}" style="display:inline-block;background:${FIN_COR};color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:6px;font-size:15px;">💳 Pagar boleto ou Pix</a></div>` : '';
  const linha = !pago && pag?.linha ? `<div style="margin:12px 0;padding:10px;background:#FAFAFA;border:1px dashed #B0BEC5;border-radius:6px;font-size:12px;">
      <div style="color:#607D8B;">Linha digitável</div><div style="font-family:'Courier New',monospace;font-size:13px;font-weight:700;word-break:break-all;">${finEsc(pag.linha)}</div></div>` : '';
  const pix = !pago && pag?.pix ? `<div style="margin:12px 0;padding:10px;background:#FAFAFA;border:1px dashed #B0BEC5;border-radius:6px;font-size:12px;">
      <div style="color:#607D8B;">Pix copia e cola</div><div style="font-family:'Courier New',monospace;font-size:11px;word-break:break-all;">${finEsc(pag.pix)}</div></div>` : '';
  return finEnvelopar(`
    ${finCabecalhoDoc(ctx, 'Demonstrativo de cobrança', `Aluguel e encargos — ${ref}`)}
    <div style="padding:6px 22px 20px;">
      ${finInfoGrid([
        ['Locatário', finEsc(locatario.nome || '—')],
        ['Imóvel', finEsc([imovel.apelido, finEnderecoImovel(imovel)].filter(Boolean).join(' — ') || '—')],
        ['Vencimento', finEsc(finFmtData(c.vencimento))],
        ['Situação', pago ? `<span style="color:#2E7D32;">✓ Pago em ${finEsc(finFmtData(c.pagaEm))}</span>` : '<span style="color:#1565C0;">Aguardando pagamento</span>'],
      ])}
      ${finTabela('Composição', linhas, 'Total a pagar', total, FIN_COR_CLARA)}
      ${botao}${linha}${pix}
      ${!pago ? `<p style="font-size:11px;color:#78909C;margin-top:10px;">Após o vencimento: multa e juros conforme o contrato. Despesas de condomínio/consumo são repassadas ao emissor (Lei 8.245/91, art. 23).</p>` : ''}
      ${finRodape(ctx)}
    </div>`);
}

async function finDadosPagamento(c) {
  const out = {};
  if (!c?.asaasId) return out;
  try {
    const { url, token } = await getCfgAsaas();
    const h = await asaasHeaders(token);
    const [l, p] = await Promise.all([
      fetch(`${url}/tenant/payments/${c.asaasId}/identificationField`, { headers: h }).then(r => r.json()).catch(() => ({})),
      fetch(`${url}/tenant/payments/${c.asaasId}/pixQrCode`, { headers: h }).then(r => r.json()).catch(() => ({})),
    ]);
    out.linha = l?.data?.identificationField || null;
    out.pix = p?.data?.payload || null;
  } catch (_) {}
  return out;
}

async function finPdfBase64(html) {
  if (!window.html2pdf) throw new Error('Gerador de PDF não carregou — recarregue a página.');
  const w = document.createElement('div');
  w.style.cssText = 'width:190mm;padding:8mm;background:#fff;';
  w.innerHTML = html;
  const blob = await html2pdf().set({ margin: 6, image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'], avoid: ['tr'] } }).from(w).outputPdf('blob');
  return blobToBase64(blob);
}

async function finEnviarEmail(cfg, { to, subject, html, attachments }) {
  if (!cfg.workerUrl) throw new Error('E-mail não configurado (URL do Worker de e-mail em Configurações).');
  const res = await fetch(cfg.workerUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: cfg.emailFrom || 'onboarding@resend.dev', fromName: State.tenant?.nome || 'DRG-Rently', to,
      replyTo: cfg.emailFrom && cfg.emailFrom !== 'onboarding@resend.dev' ? cfg.emailFrom : undefined,
      subject, html: `<div style="background:#ECEFF1;padding:18px 8px;">${html}</div>`, attachments,
    }),
  });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Erro ${res.status} no envio`); }
}

async function finEnviarLocatario(bid, btn, opts = {}) {
  let para = '';
  try {
    const r = await drgSubmit(btn, '⏳ Enviando… aguarde', async () => {
      const ctx = await finContexto(bid);
      para = String(ctx.locatario.email || '').trim();
      if (!para) throw new Error('locatário sem e-mail no cadastro');
      const pag = await finDadosPagamento(ctx.b.cobranca);
      const html = finHtmlLocatario(ctx, pag);
      const nomeArq = `Demonstrativo-${ctx.ref.replace('/', '-')}.pdf`;
      let anexos = [];
      try { anexos = [{ filename: nomeArq, content: await finPdfBase64(html) }]; } catch (e) { console.warn('PDF do demonstrativo:', e); }
      await finEnviarEmail(ctx.cfg, { to: para, subject: `${ctx.tenant.nome || 'Aluguel'} — Aluguel ${ctx.ref}: boleto e demonstrativo`, html, attachments: anexos });
      await tenantPath().collection('balancetes').doc(bid).update({ emailLocatarioEnviadoEm: firebase.firestore.FieldValue.serverTimestamp(), emailLocatarioEnviadoPara: para }).catch(() => {});
      logAuditoria('email_locatario', 'balancete', bid, { para });
    }, { destravar: true });
    if (r === DRG_IGNORADO) return { erro: 'ignorado' };
    if (!opts.silencioso) finAvisoSecao(`✓ Boleto e demonstrativo enviados para ${escapeHtml(para)}.`, 'success');
    return { ok: true, para };
  } catch (err) {
    if (!opts.silencioso) finAvisoSecao(`❌ E-mail não enviado: ${escapeHtml(err.message)}`, 'error');
    return { erro: err.message };
  }
}
window.finEnviarLocatario = finEnviarLocatario;

// ---------- Proprietário ----------
function finLinhasPrestacao(b) {
  const L = b.lancamentos || [];
  const t = finCalcularTotais(b);
  const receb = [
    ...L.filter(l => l.bloco === 'entrada').map(l => [finRotulo(l), l.valor, l.categoria === 'abatimento' ? 'pago pelo locatário em seu nome' : '']),
    ...L.filter(l => l.bloco === 'despesa_locatario').map(l => [finRotulo(l), l.valor, 'pago pelo locatário — repassado ao emissor']),
  ];
  const pagos = [
    ...L.filter(l => l.bloco === 'despesa_locatario').map(l => [finRotulo(l), l.valor, l.boletoBeneficiario ? `pago a ${l.boletoBeneficiario} (por conta do locatário)` : 'por conta do locatário']),
    // a justificativa da IA só aparece quando ela concorda com quem o operador escolheu
    ...L.filter(l => l.bloco === 'despesa_locador').map(l => [finRotulo(l), l.valor,
      [l.boletoBeneficiario ? `pago a ${l.boletoBeneficiario}` : '', 'por conta do proprietário', l.iaSugestao?.quem === 'locador' && l.iaSugestao.motivo ? l.iaSugestao.motivo : ''].filter(Boolean).join(' — ')]),
  ];
  const baseTxt = b.taxaIncidencia === 'todas' ? 'sobre todas as receitas' : b.taxaIncidencia === 'selecionadas' ? 'sobre as verbas selecionadas' : 'sobre o aluguel';
  return { receb, pagos, t, taxaRot: `Taxa de administração (${Number(b.taxaAdm) || 0}% ${baseTxt})` };
}

function finHtmlPrestacao(ctx) {
  const { b, locador, locatario, imovel, ref } = ctx;
  const { receb, pagos, t, taxaRot } = finLinhasPrestacao(b);
  const c = b.cobranca || {}, r = b.repasse || {};
  const resumo = `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:18px;font-size:14px;">
      <tr><td style="padding:6px 10px;">Total recebido</td><td style="padding:6px 10px;text-align:right;">${fmtBRL(t.receitaTotalLocador)}</td></tr>
      <tr><td style="padding:6px 10px;">(−) Pagamentos efetuados</td><td style="padding:6px 10px;text-align:right;color:#C62828;">${fmtBRL(-t.despesaTotalLocador)}</td></tr>
      <tr><td style="padding:6px 10px;">(−) ${finEsc(taxaRot)}</td><td style="padding:6px 10px;text-align:right;color:#C62828;">${fmtBRL(-t.taxaAdmValor)}</td></tr>
      <tr><td style="padding:12px 10px;background:${FIN_COR};color:#fff;font-weight:700;font-size:16px;">Líquido ao proprietário</td>
        <td style="padding:12px 10px;background:${FIN_COR};color:#fff;font-weight:700;font-size:16px;text-align:right;">${fmtBRL(t.liquidoLocador)}</td></tr>
    </table>`;
  return finEnvelopar(`
    ${finCabecalhoDoc(ctx, 'Prestação de contas', `Competência ${ref}`)}
    <div style="padding:6px 22px 20px;">
      ${finInfoGrid([
        ['Proprietário', finEsc(locador.nome || '—')],
        ['Imóvel', finEsc([imovel.apelido, finEnderecoImovel(imovel)].filter(Boolean).join(' — ') || '—')],
        ['Locatário', finEsc(locatario.nome || '—')],
        ['Recebimento', FIN_PAGO.includes(c.status) ? `✓ ${finEsc(finFmtData(c.pagaEm))}${c.baixa === 'manual' ? ' (baixa manual)' : ''}` : '<span style="color:#E65100;">ainda não recebido</span>'],
        ['Repasse', r.status === 'PAGO' ? `✓ PIX em ${finEsc(finFmtData(r.pagoEm))}` : r.status === 'AGUARDANDO_APROVACAO' ? 'em aprovação' : '—'],
      ])}
      ${finTabela('Valores recebidos', receb, 'Total recebido', t.receitaTotalLocador, '#E8F5E9')}
      ${finTabela('Pagamentos efetuados', pagos, 'Total pago', t.despesaTotalLocador, '#FFEBEE')}
      ${resumo}
      ${b.obs ? `<p style="font-size:12px;color:#546E7A;margin-top:12px;"><strong>Observações:</strong> ${finEsc(b.obs)}</p>` : ''}
      ${finRodape(ctx)}
    </div>`);
}

async function finCarregarExcelJS() {
  if (window.ExcelJS) return window.ExcelJS;
  await new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload = ok; s.onerror = () => erro(new Error('Não carreguei o gerador de planilha (ExcelJS).'));
    document.head.appendChild(s);
  });
  return window.ExcelJS;
}

// Planilha profissional: faixa de título, dados do contrato, tabelas com zebra, totais, R$.
async function finXlsxPrestacao(ctx) {
  const ExcelJS = await finCarregarExcelJS();
  const { b, locador, locatario, imovel, ref } = ctx;
  const { receb, pagos, t, taxaRot } = finLinhasPrestacao(b);
  const wb = new ExcelJS.Workbook();
  wb.creator = ctx.tenant.nome || 'DRG-Rently'; wb.created = new Date();
  const ws = wb.addWorksheet('Prestação de contas', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
    views: [{ showGridLines: false }],
  });
  ws.columns = [{ width: 46 }, { width: 38 }, { width: 18 }];
  const VERDE = 'FF00796B', CLARO = 'FFE0F2F1', CINZA = 'FFF5F5F5', BORDA = { style: 'thin', color: { argb: 'FFCFD8DC' } };
  const moeda = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
  const faixa = (txt, size, fill, cor) => {
    const r = ws.addRow([txt]); ws.mergeCells(`A${r.number}:C${r.number}`);
    r.height = size + 12; r.getCell(1).font = { bold: true, size, color: { argb: cor || 'FFFFFFFF' } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    r.getCell(1).alignment = { vertical: 'middle', indent: 1 };
    return r;
  };
  faixa(ctx.tenant.nome || 'Imobiliária', 16, VERDE);
  faixa(`Prestação de contas — competência ${ref}`, 12, CLARO, 'FF004D40');
  ws.addRow([]);
  const info = [['Proprietário', locador.nome || '—'], ['Imóvel', [imovel.apelido, finEnderecoImovel(imovel)].filter(Boolean).join(' — ') || '—'],
    ['Locatário', locatario.nome || '—'], ['Recebimento', FIN_PAGO.includes((b.cobranca || {}).status) ? `pago em ${finFmtData(b.cobranca.pagaEm)}` : 'ainda não recebido'],
    ['Repasse', (b.repasse || {}).status === 'PAGO' ? `PIX em ${finFmtData(b.repasse.pagoEm)}` : ((b.repasse || {}).status === 'AGUARDANDO_APROVACAO' ? 'em aprovação' : '—')]];
  info.forEach(([k, v]) => {
    const r = ws.addRow([k, v]); ws.mergeCells(`B${r.number}:C${r.number}`);
    r.getCell(1).font = { color: { argb: 'FF607D8B' } }; r.getCell(2).font = { bold: true };
    r.eachCell(c => { c.border = { bottom: BORDA }; });
  });
  const bloco = (titulo, linhas, totalRot, total, corTotal) => {
    ws.addRow([]);
    const h = ws.addRow([titulo.toUpperCase(), 'Observação', 'Valor']);
    h.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }; c.alignment = { vertical: 'middle' }; });
    h.getCell(3).alignment = { horizontal: 'right' };
    linhas.forEach((l, i) => {
      const r = ws.addRow([l[0], l[2] || '', Number(l[1]) || 0]);
      r.getCell(3).numFmt = moeda;
      r.getCell(2).font = { color: { argb: 'FF78909C' }, size: 9 };
      r.eachCell({ includeEmpty: true }, c => { c.border = { bottom: BORDA }; if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } }; });
    });
    const tr = ws.addRow([totalRot, '', Number(total) || 0]);
    tr.getCell(3).numFmt = moeda;
    tr.eachCell({ includeEmpty: true }, c => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: corTotal } }; });
  };
  bloco('Valores recebidos', receb, 'Total recebido', t.receitaTotalLocador, 'FFE8F5E9');
  bloco('Pagamentos efetuados', pagos, 'Total pago', t.despesaTotalLocador, 'FFFFEBEE');
  ws.addRow([]);
  const res = [['Total recebido', t.receitaTotalLocador], ['(−) Pagamentos efetuados', -t.despesaTotalLocador], [`(−) ${taxaRot}`, -t.taxaAdmValor]];
  res.forEach(([k, v]) => { const r = ws.addRow([k, '', v]); r.getCell(3).numFmt = moeda; r.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA } }; }); });
  const liq = ws.addRow(['LÍQUIDO AO PROPRIETÁRIO', '', t.liquidoLocador]);
  liq.height = 24; liq.getCell(3).numFmt = moeda;
  liq.eachCell({ includeEmpty: true }, c => { c.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }; c.alignment = { vertical: 'middle' }; });
  ws.addRow([]);
  const rod = ws.addRow([`Gerado em ${new Date().toLocaleString('pt-BR')} · DRG-Rently`]);
  rod.getCell(1).font = { size: 8, color: { argb: 'FF90A4AE' } };
  ws.headerFooter.oddFooter = '&L&8' + (ctx.tenant.nome || '') + '&R&8Página &P de &N';

  // Aba 2 — lançamentos brutos (para quem quer conferir)
  const w2 = wb.addWorksheet('Lançamentos', { views: [{ state: 'frozen', ySplit: 1 }] });
  w2.columns = [{ header: 'Bloco', key: 'bloco', width: 22 }, { header: 'Categoria', key: 'cat', width: 24 }, { header: 'Descrição', key: 'desc', width: 46 },
    { header: 'Valor', key: 'valor', width: 16, style: { numFmt: moeda } }, { header: 'Quem arca', key: 'quem', width: 14 }, { header: 'Repete', key: 'rep', width: 14 }, { header: 'Comprovante', key: 'comp', width: 30 }];
  w2.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }; });
  const BL = { entrada: 'Entrada', despesa_locador: 'Despesa do proprietário', despesa_locatario: 'Despesa do locatário' };
  (b.lancamentos || []).forEach(l => w2.addRow({ bloco: BL[l.bloco] || l.bloco, cat: LANC_CATEGORIA_LABEL[l.categoria] || l.categoria, desc: l.descricao || '', valor: Number(l.valor) || 0,
    quem: l.quemArca === 'locatario' ? 'Locatário' : l.quemArca === 'locador' ? 'Proprietário' : '', rep: l.repetir ? (l.tipoValor === 'variavel' ? 'variável' : 'fixa') : '', comp: l.comprovanteNome || '' }));
  w2.autoFilter = 'A1:G1';
  const buf = await wb.xlsx.writeBuffer();
  return blobToBase64(new Blob([buf]));
}

async function finEnviarPrestacao(bid, btn, opts = {}) {
  let para = '';
  try {
    const r = await drgSubmit(btn, '⏳ Gerando PDF e planilha… ~10s', async () => {
      const ctx = await finContexto(bid);
      para = String(ctx.locador.email || '').trim();
      if (!para) throw new Error('proprietário sem e-mail no cadastro');
      const html = finHtmlPrestacao(ctx);
      const base = `Prestacao-de-contas-${ctx.ref.replace('/', '-')}`;
      const [pdf, xlsx] = await Promise.all([finPdfBase64(html), finXlsxPrestacao(ctx)]);
      await finEnviarEmail(ctx.cfg, { to: para, subject: `${ctx.tenant.nome || 'Imobiliária'} — Prestação de contas ${ctx.ref} (${ctx.imovel.apelido || 'imóvel'})`, html,
        attachments: [{ filename: `${base}.pdf`, content: pdf }, { filename: `${base}.xlsx`, content: xlsx }] });
      const upd = { prestacao: { enviadaEm: new Date().toISOString(), para }, emailEnviadoEm: firebase.firestore.FieldValue.serverTimestamp(), emailEnviadoPara: para };
      if ((ctx.b.status || 'aberto') === 'aberto' && pode('fecharBalancete')) upd.status = 'enviado';
      await tenantPath().collection('balancetes').doc(bid).update(upd).catch(() => {});
      logAuditoria('prestacao_contas', 'balancete', bid, { para });
    }, { destravar: true });
    if (r === DRG_IGNORADO) return { erro: 'ignorado' };
    if (!opts.silencioso) finAvisoSecao(`✓ Prestação de contas (PDF + planilha) enviada para ${escapeHtml(para)}.`, 'success');
    if (!opts.silencioso && $('tbody-balancetes')) loadBalancetes();
    return { ok: true, para };
  } catch (err) {
    if (!opts.silencioso) finAvisoSecao(`❌ Prestação não enviada: ${escapeHtml(err.message)}`, 'error');
    return { erro: err.message };
  }
}
window.finEnviarPrestacao = finEnviarPrestacao;

// Baixar no computador (sem enviar)
async function finBaixarPrestacao(bid, tipo, btn) {
  try {
    await drgSubmit(btn, '⏳ Gerando…', async () => {
      const ctx = await finContexto(bid);
      const base = `Prestacao-de-contas-${ctx.ref.replace('/', '-')}-${(ctx.imovel.apelido || 'imovel').replace(/[^\w-]+/g, '_')}`;
      const b64 = tipo === 'xlsx' ? await finXlsxPrestacao(ctx) : await finPdfBase64(finHtmlPrestacao(ctx));
      const a = document.createElement('a');
      a.href = `data:${tipo === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf'};base64,${b64}`;
      a.download = `${base}.${tipo}`;
      document.body.appendChild(a); a.click(); a.remove();
    }, { destravar: true });
  } catch (err) { finAvisoSecao(`❌ ${escapeHtml(err.message)}`, 'error'); }
}
window.finBaixarPrestacao = finBaixarPrestacao;


// =============================================================
// FASE 5 — 📈 REAJUSTE PELO ÍNDICE OFICIAL (Banco Central / SGS)
// =============================================================
// Decisão do dono (06/11/2026): o sistema CALCULA e pede confirmação — 1 clique aplica,
// grava o histórico e avisa o locatário e o proprietário por e-mail.
// Janela do índice: os 12 meses MAIS RECENTES já publicados antes do mês do reajuste
// (ex.: reajuste em nov/2026 → out/25…set/26 se out/26 ainda não saiu). Índice acumulado
// negativo NÃO reduz o aluguel (mantém o valor) — prática de mercado; fica registrado.
const FIN_SGS = { igpm: { cod: 189, nome: 'IGP-M' }, ipca: { cod: 433, nome: 'IPCA' }, inpc: { cod: 188, nome: 'INPC' }, igpdi: { cod: 190, nome: 'IGP-DI' } };
const FIN_PERIODO = { anual: 12, bienal: 24, semestral: 12 };   // Lei 10.192/2001: reajuste com periodicidade mínima anual
const _finSgsCache = {};

function finAddMeses(comp, n) {
  let a = parseInt(comp.slice(0, 4), 10), m = parseInt(comp.slice(5, 7), 10) + n;
  while (m > 12) { m -= 12; a++; } while (m < 1) { m += 12; a--; }
  return finComp(m, a);
}
function finCompTxt(comp) { return comp ? finMesAno(parseInt(comp.slice(5, 7), 10), parseInt(comp.slice(0, 4), 10)) : '—'; }

// Próximo reajuste do contrato: data-base (ou início) + período, pulando os já aplicados
function finProximoReajuste(c) {
  if (!c || c.reajusteIndice === 'sem' || c.reajustePeriodicidade === 'sem' || !FIN_SGS[c.reajusteIndice]) return null;
  const per = FIN_PERIODO[c.reajustePeriodicidade] || 12;
  const base = c.ultimoReajuste?.competencia || c.dataBaseReajuste || String(c.inicio || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(base)) return null;
  return finAddMeses(base, per);
}
window.finProximoReajuste = finProximoReajuste;

// Série por PERÍODO (os 18 meses antes do reajuste). Não usar ".../ultimos/N": o SGS recusa
// N > 20 (erro 400) e reajuste atrasado precisa de meses mais antigos.
async function finSerieSGS(indice, compReajuste) {
  const chave = `${indice}_${compReajuste}`;
  if (_finSgsCache[chave] && Date.now() - _finSgsCache[chave].em < 3600e3) return _finSgsCache[chave].dados;
  const ini = finAddMeses(compReajuste, -18), fim = finAddMeses(compReajuste, -1);
  const br = (comp, dia) => `${dia}/${comp.slice(5, 7)}/${comp.slice(0, 4)}`;
  const res = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${FIN_SGS[indice].cod}/dados?formato=json&dataInicial=${br(ini, '01')}&dataFinal=${br(fim, '28')}`);
  if (!res.ok) throw new Error(`Banco Central respondeu ${res.status}`);
  const dados = (await res.json()).map(d => ({ comp: `${d.data.slice(6, 10)}-${d.data.slice(3, 5)}`, v: parseFloat(d.valor) || 0 }));
  _finSgsCache[chave] = { em: Date.now(), dados };
  return dados;
}

async function finCalcularReajuste(c, compReajuste) {
  const ind = FIN_SGS[c.reajusteIndice];
  const serie = (await finSerieSGS(c.reajusteIndice, compReajuste)).filter(d => d.comp < compReajuste);
  if (serie.length < 12) throw new Error(`${ind.nome}: o Banco Central ainda não tem 12 meses publicados antes de ${finCompTxt(compReajuste)}.`);
  const janela = serie.slice(-12);
  const fator = janela.reduce((f, d) => f * (1 + d.v / 100), 1);
  const acumulado = (fator - 1) * 100;
  const aplicado = Math.max(acumulado, 0);
  const de = Number(c.aluguel) || 0;
  return {
    indice: c.reajusteIndice, indiceNome: ind.nome, acumulado: Math.round(acumulado * 10000) / 10000, aplicado,
    janela: `${finCompTxt(janela[0].comp)} a ${finCompTxt(janela[11].comp)}`, meses: janela,
    de, para: finR2(de * (1 + aplicado / 100)), negativo: acumulado < 0, competencia: compReajuste,
  };
}

// Alertas do painel: reajustes que vencem no mês exibido (ou atrasados)
async function finAlertasReajuste(contratos, mes, ano) {
  const comp = finComp(mes, ano);
  const devidos = contratos.map(c => ({ c, prox: finProximoReajuste(c) })).filter(x => x.prox && x.prox <= comp);
  if (!devidos.length) return [];
  let imMap = {};
  try { imMap = Object.fromEntries((await ensureImoveisCache()).map(i => [i.id, i.apelido])); } catch (_) {}
  const out = [];
  for (const { c, prox } of devidos.slice(0, 12)) {
    let txt;
    try {
      const r = await finCalcularReajuste(c, prox);
      txt = `${r.indiceNome} ${r.janela}: <strong>${r.acumulado.toFixed(2).replace('.', ',')}%</strong>${r.negativo ? ' (negativo — mantém)' : ''} → ${fmtBRL(r.de)} ➜ <strong>${fmtBRL(r.para)}</strong>`;
    } catch (e) { txt = `⚠ ${escapeHtml(e.message)}`; }
    out.push(`<button type="button" class="fin-alerta-item fin-alerta-reajuste" onclick="finAbrirReajuste('${c.id}', this)">📈 Reajuste ${prox < comp ? '<strong>atrasado</strong> ' : ''}de ${finCompTxt(prox)} — ${escapeHtml(imMap[c.imovelId] || 'contrato')}: ${txt} — <u>conferir e aplicar</u></button>`);
  }
  return out;
}
window.finAlertasReajuste = finAlertasReajuste;

async function finAbrirReajuste(contratoId, btn) {
  let c, r;
  try {
    c = { id: contratoId, ...((await tenantPath().collection('contratos').doc(contratoId).get()).data() || {}) };
    const prox = finProximoReajuste(c);
    if (!prox) { finAvisoSecao('Este contrato não tem reajuste configurado.', 'info'); return; }
    r = await finCalcularReajuste(c, prox);
  } catch (e) { finAvisoSecao(`❌ ${escapeHtml(e.message)}`, 'error'); return; }
  const tabela = r.meses.map(m => `<tr><td>${finCompTxt(m.comp)}</td><td style="text-align:right;">${m.v.toFixed(2).replace('.', ',')}%</td></tr>`).join('');
  const ok = await confirmar({
    titulo: `📈 Reajuste ${r.indiceNome} — ${finCompTxt(r.competencia)}`,
    mensagem: `Aluguel <strong>${fmtBRL(r.de)}</strong> ➜ <strong>${fmtBRL(r.para)}</strong> (${r.indiceNome} acumulado ${r.janela}: <strong>${r.acumulado.toFixed(4).replace('.', ',')}%</strong>)`,
    detalhe: `${r.negativo ? '⚠ O índice acumulado ficou <strong>negativo</strong>: o aluguel é mantido (não reduz).<br>' : ''}
      Fonte: Banco Central do Brasil (SGS ${FIN_SGS[r.indice].cod}).
      <details style="margin-top:6px;"><summary>Ver os 12 meses</summary><table style="width:100%;font-size:12px;">${tabela}</table></details>
      Ao aplicar: muda o aluguel do contrato, grava o histórico, atualiza o balancete de ${finCompTxt(r.competencia)} (se ainda sem boleto) e avisa locatário e proprietário por e-mail.`,
    confirmar: '📈 Aplicar reajuste',
  });
  if (!ok) return;
  try {
    const res = await drgSubmit(btn, '⏳ Aplicando…', async () => {
      const reg = { competencia: r.competencia, indice: r.indice, indiceNome: r.indiceNome, acumulado: r.acumulado, aplicado: r.aplicado,
        janela: r.janela, de: r.de, para: r.para, negativo: r.negativo, aplicadoEm: new Date().toISOString(), aplicadoPor: State.user.uid };
      const gr = await gravar({ modulo: 'contratos', colecao: 'contratos', op: 'editar', id: contratoId,
        dados: { aluguel: r.para, ultimoReajuste: reg, historicoReajustes: firebase.firestore.FieldValue.arrayUnion(reg) },
        antes: { aluguel: c.aluguel, ultimoReajuste: c.ultimoReajuste || null }, titulo: `Reajuste ${r.indiceNome} ${finCompTxt(r.competencia)}` });
      if (gr.pendente) return { pendente: true };
      // Balancete do mês do reajuste (se existe e ainda não foi cobrado): aluguel novo
      const m = parseInt(r.competencia.slice(5, 7), 10), a = parseInt(r.competencia.slice(0, 4), 10);
      const bid = balanceteId(a, m, contratoId);
      const bs = await tenantPath().collection('balancetes').doc(bid).get();
      if (bs.exists && finCobStatus(bs.data()) === 'SEM' && (bs.data().status || 'aberto') === 'aberto') {
        const b = bs.data();
        b.aluguelBase = r.para;
        b.lancamentos = (b.lancamentos || []).map(l => (l.bloco === 'entrada' && l.categoria === 'aluguel') ? { ...l, valor: r.para, descricao: `Aluguel mensal (reajustado ${r.indiceNome})` } : l);
        await finGravarBalancete(bid, b, true, bs.data(), `Balancete ${finCompTxt(r.competencia)} — reajuste`);
      }
      logAuditoria('reajuste', 'contrato', contratoId, { de: r.de, para: r.para, indice: r.indiceNome, acumulado: r.acumulado });
      const avisos = await finAvisarReajuste(c, r);
      return { avisos };
    });
    if (!res || res === DRG_IGNORADO) return;
    if (res.pendente) { finAvisoSecao('🕓 Reajuste enviado para aprovação — vale quando um gestor aprovar.', 'success'); return; }
    finAvisoSecao(`✓ Reajuste aplicado: ${fmtBRL(r.de)} ➜ ${fmtBRL(r.para)}. ${res.avisos}`, 'success');
    loadBalancetes();
  } catch (err) { finAvisoSecao(`❌ ${escapeHtml(err.message)}`, 'error'); }
}
window.finAbrirReajuste = finAbrirReajuste;

async function finAvisarReajuste(c, r) {
  const cfg = await finCfg();
  const g = async (col, id) => { try { return id ? ((await tenantPath().collection(col).doc(id).get()).data() || {}) : {}; } catch (_) { return {}; } };
  const [lt, lc, im] = await Promise.all([g('locatarios', c.locatarioId), g('locadores', c.locadorId), g('imoveis', c.imovelId)]);
  const ctx = { tenant: State.tenant || {} };
  const corpo = (nome) => finEnvelopar(`
    ${finCabecalhoDoc(ctx, 'Reajuste anual do aluguel', `${finEsc(im.apelido || '')} — a partir de ${finCompTxt(r.competencia)}`)}
    <div style="padding:6px 22px 20px;font-size:14px;line-height:1.6;">
      <p>Olá, ${finEsc(nome || '')}.</p>
      <p>Conforme o contrato de locação, o aluguel foi reajustado pelo <strong>${finEsc(r.indiceNome)}</strong> acumulado de ${finEsc(r.janela)}
        (<strong>${r.acumulado.toFixed(2).replace('.', ',')}%</strong>, fonte: Banco Central do Brasil)${r.negativo ? ' — como o índice ficou negativo, o valor foi mantido' : ''}.</p>
      ${finInfoGrid([['Aluguel anterior', fmtBRL(r.de)], ['Novo aluguel', `<strong style="color:${FIN_COR};">${fmtBRL(r.para)}</strong>`], ['Vale a partir de', finCompTxt(r.competencia)]])}
      ${finRodape(ctx)}
    </div>`);
  const enviados = [];
  for (const [p, nome] of [[lt, lt.nome], [lc, lc.nome]]) {
    if (!p.email) continue;
    try { await finEnviarEmail(cfg, { to: p.email, subject: `${State.tenant?.nome || ''} — Reajuste do aluguel (${r.indiceNome}) — ${im.apelido || ''}`, html: corpo(nome) }); enviados.push(p.email); } catch (e) { console.warn('aviso reajuste', e); }
  }
  return enviados.length ? `✉ Aviso enviado a ${enviados.map(escapeHtml).join(' e ')}.` : '⚠ Ninguém com e-mail cadastrado para receber o aviso.';
}

// Contrato: mostra próximo reajuste + último aplicado (abaixo da data-base)
function finInfoReajusteContrato(c) {
  const el = $('contrato-reajuste-info');
  if (!el) return;
  const prox = finProximoReajuste(c);
  const ult = c.ultimoReajuste;
  el.innerHTML = prox
    ? `📈 Próximo: <strong>${finCompTxt(prox)}</strong> (${FIN_SGS[c.reajusteIndice].nome})${ult ? ` · último: ${finCompTxt(ult.competencia)} ${ult.acumulado != null ? `(${Number(ult.acumulado).toFixed(2).replace('.', ',')}%)` : ''} ${fmtBRL(ult.de)} ➜ ${fmtBRL(ult.para)}` : ''}`
    : 'Sem reajuste configurado';
}
window.finInfoReajusteContrato = finInfoReajusteContrato;
