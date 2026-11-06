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
