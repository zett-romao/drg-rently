// =============================================================
// DRG-Rently — Anúncios
//   1. Código do anúncio (sequencial por imobiliária: DRG-00012) — busca no sistema
//   2. Portais e relevância por anúncio (padrão / destaque / super / premium)
//      + portais contratados e cotas do plano (tela 📡 Portais)
//   3. Gerador de anúncios com IA: fotos + dados + pontos da região (OpenStreetMap)
//      → título, descrição, curadoria e correção honesta das fotos
// Carregado depois do app.js e do rede.js.
// =============================================================

const RELEVANCIA_NIVEIS = [
  { id: 'padrao',   label: 'Padrão' },
  { id: 'destaque', label: '⭐ Destaque' },
  { id: 'super',    label: '⭐⭐ Super destaque' },
  { id: 'premium',  label: '💎 Premium / vitrine' },
];
const RELEVANCIA_LABEL = Object.fromEntries(RELEVANCIA_NIVEIS.map(n => [n.id, n.label]));
const NIVEIS_COM_COTA = ['destaque', 'super', 'premium'];
// Portais em que o nível vai sozinho no feed (VRSync <PublicationType>).
// Nos demais o feed não tem campo de destaque: marca-se no painel do portal.
const PORTAIS_NIVEL_NO_FEED = ['zap', 'vivareal'];

// ---------- 1. Código do anúncio ----------

function prefixoCodigoAnuncio() {
  const nome = String(State.tenant?.nome || 'Imóveis').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ignorar = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'LTDA', 'ME', 'EIRELI', 'SA', 'S', 'A', 'EPP']);
  const palavras = nome.toUpperCase().split(/[^A-Z0-9]+/).filter(p => p && !ignorar.has(p));
  let p = palavras.map(w => w[0]).join('').slice(0, 3);
  if (p.length < 2) p = (palavras[0] || 'IMO').slice(0, 3);
  return p;
}

// Reserva o próximo código numa transação (contador por imobiliária).
async function reservarCodigoAnuncio() {
  const ref = tenantPath().collection('contadores').doc('anuncios');
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.exists ? s.data() : {};
    const prefixo = d.prefixo || prefixoCodigoAnuncio();
    const seq = (d.seq || 0) + 1;
    if (s.exists) tx.update(ref, { seq });
    else tx.set(ref, { seq, prefixo });
    return `${prefixo}-${String(seq).padStart(5, '0')}`;
  });
}

// Nunca barra o salvar: sem código agora, ele sai no próximo salvar ou no
// "Gerar códigos que faltam" (tela Portais).
async function reservarCodigoAnuncioSeguro() {
  try { return await reservarCodigoAnuncio(); }
  catch (e) { console.warn('Código do anúncio não reservado:', e); return null; }
}

// Selo PERMUTA: só vale para imóvel à venda (venda ou venda+locação)
function temPermuta(im) {
  return im && im.aceitaPermuta === 'sim' && (im.finalidade || im.finalidadeFiltro || 'locacao') !== 'locacao';
}

function normalizarCodigo(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Busca da lista de Imóveis: código, apelido, título, endereço e tags
function imovelBateBusca(im, termo) {
  const t = String(termo || '').trim();
  if (!t) return true;
  const tn = normalizarCodigo(t);
  if (tn && normalizarCodigo(im.codigoAnuncio).includes(tn)) return true;
  const end = im.endereco || {};
  return [im.apelido, im.tituloAnuncio, end.bairro, end.cidade, end.logradouro, temPermuta(im) ? 'permuta' : '', ...(im.tags || [])]
    .filter(Boolean).join(' ').toLowerCase().includes(t.toLowerCase());
}

function onBuscaImoveisKey(e) {
  if (e.key !== 'Enter') return;
  const termo = e.target.value;
  const achados = (_imoveisCarregados || []).filter(im => imovelBateBusca(im, termo));
  if (achados.length === 1) openImovelModal(achados[0]._id);
}

async function copiarCodigoAnuncio(btn) {
  const cod = _anuncioCodigoAtual;
  if (!cod) return;
  try { await navigator.clipboard.writeText(cod); } catch (_) {}
  const original = btn.textContent;
  btn.textContent = '✓ Copiado';
  btn.disabled = true;
  setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
}

// ---------- 2. Bloco "📣 Anúncio" no modal do imóvel ----------

let _anuncioCodigoAtual = null;
let _anuncioPortaisOriginal = null; // null = anúncio antigo (vai para todos os feeds)
let _anuncioIAMeta = null;
let _usoRelevancia = {};

async function prepararAnuncioNoModalImovel(id) {
  let im = {};
  if (id) {
    try {
      const s = await tenantPath().collection('imoveis').doc(id).get();
      if (s.exists) im = s.data();
    } catch (_) {}
  }
  _anuncioCodigoAtual = im.codigoAnuncio || null;
  _anuncioPortaisOriginal = (im.anuncioPortais && typeof im.anuncioPortais === 'object') ? { ...im.anuncioPortais } : null;
  _anuncioIAMeta = im.anuncioIA || null;

  $('imovel-codigo-anuncio').innerHTML = _anuncioCodigoAtual
    ? `${escapeHtml(_anuncioCodigoAtual)} <button type="button" class="btn btn-secondary btn-sm" onclick="copiarCodigoAnuncio(this)">📋 Copiar</button>`
    : '<span class="muted" style="font-size:13px; font-weight:400;">gerado ao salvar</span>';
  if (id && _anuncioCodigoAtual) $('modal-imovel-title').textContent = `Editar Imóvel · ${_anuncioCodigoAtual}`;
  $('imovel-titulo-anuncio').value = im.tituloAnuncio || '';
  contarTituloAnuncio();

  const wrap = $('imovel-anuncio-portais-wrap');
  // Corretor não publica no site/portais — quem publica é a imobiliária
  if (isCorretor()) { wrap.style.display = 'none'; $('imovel-anuncio-portais').innerHTML = ''; return; }
  wrap.style.display = 'block';
  await renderPortaisDoAnuncio(id);
}

function contarTituloAnuncio() {
  const n = ($('imovel-titulo-anuncio')?.value || '').trim().length;
  const el = $('imovel-titulo-contador');
  if (!el) return;
  if (!n) { el.textContent = 'Ideal: 45 a 70 caracteres. Vazio = os portais recebem o apelido.'; el.style.color = ''; return; }
  const ok = n >= 45 && n <= 70;
  el.textContent = `${n} caracteres${ok ? ' ✓' : n < 45 ? ' — curto: inclua o diferencial e o bairro' : ' — longo: alguns portais cortam depois de 70'}`;
  el.style.color = ok ? 'var(--success)' : '#B45309';
}

async function usoRelevanciaPorPortal(excluirId) {
  const uso = {};
  try {
    const snap = await tenantPath().collection('imoveis').where('linkPublico', '==', true).get();
    snap.docs.forEach(d => {
      if (d.id === excluirId) return;
      const m = d.data().anuncioPortais;
      if (!m || typeof m !== 'object') return;
      Object.entries(m).forEach(([p, nivel]) => {
        uso[p] = uso[p] || {};
        uso[p][nivel] = (uso[p][nivel] || 0) + 1;
      });
    });
  } catch (e) { console.warn('Uso de destaques não calculado:', e); }
  return uso;
}

function portaisContratados() {
  const pc = State._configCache?.portaisConfig || {};
  return PORTAIS_LIST.filter(p => !p.unavailable && pc[p.id]?.ativo);
}

async function renderPortaisDoAnuncio(id) {
  const box = $('imovel-anuncio-portais');
  box.innerHTML = '<p class="muted" style="font-size:12px;">Carregando portais…</p>';
  await ensureConfigCache();
  const ativos = portaisContratados();
  if (!ativos.length) {
    box.innerHTML = `<button type="button" class="alerta-clicavel" onclick="irParaPortaisContratados()">⚠️ Nenhum portal marcado como contratado. Toque aqui para marcar em 📡 Portais →</button>`;
    return;
  }
  _usoRelevancia = await usoRelevanciaPorPortal(id);
  const mapa = _anuncioPortaisOriginal;
  box.innerHTML = ativos.map(p => {
    const marcado = mapa ? mapa[p.id] != null : true;
    const nivel = (mapa && mapa[p.id]) || 'padrao';
    return `
      <div class="anuncio-portal-row" data-portal="${p.id}">
        <label class="toggle-row"><input type="checkbox" class="anuncio-portal-chk" ${marcado ? 'checked' : ''} onchange="atualizarCotaPortal('${p.id}')"><span>${p.icone} ${escapeHtml(p.nome)}</span></label>
        <select class="anuncio-portal-nivel" onchange="atualizarCotaPortal('${p.id}')">
          ${RELEVANCIA_NIVEIS.map(n => `<option value="${n.id}" ${n.id === nivel ? 'selected' : ''}>${n.label}</option>`).join('')}
        </select>
        <span class="anuncio-portal-cota" id="anuncio-cota-${p.id}"></span>
      </div>`;
  }).join('') + (mapa ? '' : `<p class="muted" style="font-size:11px; margin-top:6px;">Este anúncio ainda não tinha escolha de portais — hoje vai para todos os feeds. Ao salvar, passa a valer a seleção acima.</p>`);
  ativos.forEach(p => atualizarCotaPortal(p.id));
}

function atualizarCotaPortal(pid) {
  const row = document.querySelector(`.anuncio-portal-row[data-portal="${pid}"]`);
  if (!row) return;
  const chk = row.querySelector('.anuncio-portal-chk');
  const sel = row.querySelector('.anuncio-portal-nivel');
  const el = $(`anuncio-cota-${pid}`);
  sel.disabled = !chk.checked;
  el.classList.remove('is-warn');
  if (!chk.checked) { el.textContent = 'não publica neste portal'; return; }
  const como = PORTAIS_NIVEL_NO_FEED.includes(pid) ? 'vai no feed' : 'marcar no painel do portal';
  const nivel = sel.value;
  if (nivel === 'padrao') { el.textContent = PORTAIS_NIVEL_NO_FEED.includes(pid) ? 'vai no feed' : 'publicação simples'; return; }
  const cota = Number((State._configCache?.portaisConfig?.[pid]?.cotas || {})[nivel]) || 0;
  const usados = ((_usoRelevancia[pid] || {})[nivel] || 0) + 1;
  if (!cota) {
    el.textContent = `${usados} em uso · cota do plano não informada · ${como}`;
  } else if (usados > cota) {
    el.textContent = `⚠️ ${usados}/${cota} — passa da cota do plano; o portal rebaixa para Padrão`;
    el.classList.add('is-warn');
  } else {
    el.textContent = `${usados}/${cota} da cota · ${como}`;
  }
}

// Campos do bloco Anúncio que entram no saveImovel()
function lerAnuncioDoModalImovel() {
  const out = { tituloAnuncio: ($('imovel-titulo-anuncio')?.value || '').trim() || null };
  if (_anuncioIAMeta) out.anuncioIA = _anuncioIAMeta;
  const rows = Array.from(document.querySelectorAll('#imovel-anuncio-portais .anuncio-portal-row'));
  if (!isCorretor() && rows.length) {
    const mapa = {};
    // Portal que saiu da lista de contratados mantém a escolha antiga
    if (_anuncioPortaisOriginal) {
      const naTela = new Set(rows.map(r => r.dataset.portal));
      Object.entries(_anuncioPortaisOriginal).forEach(([k, v]) => { if (!naTela.has(k)) mapa[k] = v; });
    }
    rows.forEach(r => {
      if (r.querySelector('.anuncio-portal-chk').checked) mapa[r.dataset.portal] = r.querySelector('.anuncio-portal-nivel').value;
    });
    out.anuncioPortais = mapa;
  }
  return out;
}

async function irParaPortaisContratados() {
  if (!(await confirmar({ titulo: 'Ir para 📡 Portais?', mensagem: 'O cadastro do imóvel será fechado. Salve antes se mudou alguma coisa.', confirmar: 'Ir para Portais' }))) return;
  closeImovelModal();
  showSection('portais');
  setTimeout(() => { try { $('portais-plano').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} }, 300);
}

// ---------- 2b. Tela 📡 Portais: contratado + cotas, plano e códigos ----------

function blocoContratoPortal(p) {
  if (p.unavailable) return '';
  const c = (State._configCache?.portaisConfig || {})[p.id] || {};
  const cotas = c.cotas || {};
  return `
    <div class="portal-contrato">
      <label class="toggle-row"><input type="checkbox" id="portal-ativo-${p.id}" ${c.ativo ? 'checked' : ''} onchange="salvarPortalConfig('${p.id}')"><span><strong>Contratado</strong> — aparece nos anúncios para escolher</span></label>
      <div class="portal-cotas" id="portal-cotas-${p.id}" style="${c.ativo ? '' : 'display:none;'}">
        <span class="muted" style="font-size:11px; grid-column:1/-1;">Cota do plano (quantos anúncios em cada nível):</span>
        ${NIVEIS_COM_COTA.map(n => `
          <label>${RELEVANCIA_LABEL[n]}
            <input type="number" min="0" inputmode="numeric" id="portal-cota-${p.id}-${n}" value="${cotas[n] ?? ''}" placeholder="—" onchange="salvarPortalConfig('${p.id}')">
          </label>`).join('')}
      </div>
      <div class="status-inline" id="portal-cfg-status-${p.id}" style="display:none;"></div>
    </div>`;
}

async function salvarPortalConfig(pid) {
  const st = `portal-cfg-status-${pid}`;
  const chk = $(`portal-ativo-${pid}`);
  if (!exigirPode('portais', 'editar')) { renderPortais(); return; }
  const ativo = chk.checked;
  const cotas = {};
  NIVEIS_COM_COTA.forEach(n => {
    const v = $(`portal-cota-${pid}-${n}`)?.value;
    if (v !== '' && v != null) cotas[n] = Math.max(0, parseInt(v, 10) || 0);
  });
  $(`portal-cotas-${pid}`).style.display = ativo ? '' : 'none';
  const valor = { ativo, cotas, atualizadoEm: new Date().toISOString(), atualizadoPor: State.user.uid };
  chk.disabled = true;
  showInlineStatus(st, '⏳ Salvando…', 'loading');
  try {
    const ref = tenantPath().collection('config').doc('site');
    // update troca o mapa do portal inteiro (set+merge manteria cota apagada)
    try { await ref.update({ [`portaisConfig.${pid}`]: valor }); }
    catch (e) {
      if (e.code !== 'not-found') throw e;
      await ref.set({ portaisConfig: { [pid]: valor } }, { merge: true });
    }
    State._configCache = State._configCache || {};
    State._configCache.portaisConfig = { ...(State._configCache.portaisConfig || {}), [pid]: valor };
    logAuditoria('update', 'config', 'portais', { portal: pid, ativo, cotas });
    showInlineStatus(st, ativo ? '✓ Salvo — já aparece nos anúncios' : '✓ Salvo — portal fora dos anúncios', 'success', 3000);
    renderPlanoPublicacao();
  } catch (err) {
    console.error('Erro ao salvar portal:', err);
    showInlineStatus(st, `❌ ${escapeHtml(err.message)}`, 'error');
  } finally {
    chk.disabled = false;
  }
}

async function renderPlanoPublicacao() {
  const box = $('portais-plano');
  if (!box || !State.tenant) return;
  box.innerHTML = '<p class="muted">Carregando plano de publicação…</p>';
  await ensureConfigCache();
  let imoveis = [];
  try {
    const snap = await tenantPath().collection('imoveis').get();
    imoveis = snap.docs.map(d => ({ _id: d.id, ...d.data() })).filter(im => !im.rascunho);
  } catch (err) {
    box.innerHTML = `<p style="color:var(--danger);">Erro: ${escapeHtml(err.message)}</p>`;
    return;
  }
  const semCodigo = imoveis.filter(im => !im.codigoAnuncio).length;
  const publicados = imoveis.filter(im => im.linkPublico === true && im.vitrineFeed !== false);
  const ativos = portaisContratados();

  const blocos = ativos.map(p => {
    const cotas = State._configCache.portaisConfig[p.id].cotas || {};
    const nesse = publicados.filter(im => !im.anuncioPortais || im.anuncioPortais[p.id] != null);
    const nivelDe = im => (im.anuncioPortais && im.anuncioPortais[p.id]) || 'padrao';
    const contagem = RELEVANCIA_NIVEIS.map(n => {
      const usados = nesse.filter(im => nivelDe(im) === n.id).length;
      const cota = cotas[n.id];
      const passou = cota != null && n.id !== 'padrao' && usados > cota;
      return `<span class="plano-nivel ${passou ? 'is-warn' : ''}">${n.label}: <strong>${usados}${cota != null && n.id !== 'padrao' ? `/${cota}` : ''}</strong></span>`;
    }).join('');
    const destacados = nesse.filter(im => nivelDe(im) !== 'padrao');
    const lista = destacados.length
      ? `<ul class="plano-lista">${destacados.map(im => `<li><button type="button" class="link-btn" onclick="openImovelModal('${im._id}')">${escapeHtml(im.codigoAnuncio || 'sem código')}</button> · ${escapeHtml(im.tituloAnuncio || im.apelido || '')} — <strong>${RELEVANCIA_LABEL[nivelDe(im)]}</strong></li>`).join('')}</ul>`
      : '';
    const como = PORTAIS_NIVEL_NO_FEED.includes(p.id)
      ? '<span class="muted" style="font-size:11px;">O nível vai sozinho no feed.</span>'
      : (destacados.length ? '<span class="muted" style="font-size:11px;">Este portal não lê o nível pelo feed: marque estes anúncios como destaque no painel dele.</span>' : '');
    return `
      <div class="plano-portal">
        <div class="plano-portal-head"><strong>${p.icone} ${escapeHtml(p.nome)}</strong> <span class="muted" style="font-size:12px;">${nesse.length} anúncio(s)</span></div>
        <div class="plano-niveis">${contagem}</div>
        ${como}${lista}
      </div>`;
  }).join('');

  box.innerHTML = `
    <div class="section-header" style="margin-bottom:8px;">
      <div>
        <h4 style="margin:0;">📋 Plano de publicação</h4>
        <p class="muted" style="margin:2px 0 0; font-size:12px;">Quantos anúncios estão em cada portal e nível. Marque nos cards abaixo os portais contratados e as cotas do plano.</p>
      </div>
      <button class="btn btn-secondary btn-sm" id="btn-gerar-codigos" onclick="gerarCodigosFaltantes()" ${semCodigo ? '' : 'disabled'}>🔢 ${semCodigo ? `Gerar ${semCodigo} código(s) que faltam` : 'Todos os imóveis têm código'}</button>
    </div>
    <div class="status-inline" id="plano-status" style="display:none;"></div>
    ${ativos.length ? `<div class="plano-grid">${blocos}</div>` : '<p class="muted" style="font-size:13px;">Nenhum portal marcado como contratado ainda — use a chave "Contratado" nos cards abaixo.</p>'}`;
}

async function gerarCodigosFaltantes() {
  if (!exigirPode('imoveis', 'editar', null)) return;
  const btn = $('btn-gerar-codigos');
  try {
    const r = await drgSubmit(btn, '⏳ Gerando códigos… aguarde', async () => {
      const snap = await tenantPath().collection('imoveis').get();
      const faltam = snap.docs
        .map(d => ({ _id: d.id, ...d.data() }))
        .filter(im => !im.rascunho && !im.codigoAnuncio)
        .sort((a, b) => (a.criadoEm?.seconds || 0) - (b.criadoEm?.seconds || 0));
      let ok = 0;
      for (const im of faltam) {
        btn.innerHTML = `⏳ Gerando códigos ${ok + 1}/${faltam.length}… aguarde`;
        const codigo = await reservarCodigoAnuncio();
        await tenantPath().collection('imoveis').doc(im._id).update({ codigoAnuncio: codigo });
        if (im.linkPublico) await sincronizarFichaRede(im._id).catch(e => console.warn('Vitrine não sincronizada:', e));
        ok++;
      }
      logAuditoria('update', 'imovel', 'codigos-anuncio', { gerados: ok });
      return ok;
    }, { destravar: true });
    if (r === DRG_IGNORADO) return;
    invalidateImoveisCache();
    await renderPlanoPublicacao();
    showInlineStatus('plano-status', `✓ ${r} código(s) gerado(s). Já dá para buscar pelo código em Imóveis.`, 'success', 6000);
  } catch (err) {
    console.error('Erro ao gerar códigos:', err);
    showInlineStatus('plano-status', `❌ ${escapeHtml(err.message)}`, 'error');
  }
}

// =============================================================
// 3. GERADOR DE ANÚNCIOS COM IA
// =============================================================

const GERADOR_MAX_FOTOS = 24;
const CARACTERISTICAS_ANUNCIO = [
  'Suíte', 'Closet', 'Lavabo', 'Varanda', 'Varanda gourmet', 'Sacada', 'Home office',
  'Armários planejados', 'Cozinha americana', 'Área de serviço', 'Ar-condicionado',
  'Aquecimento a gás', 'Piso porcelanato', 'Piso de madeira', 'Reformado', 'Vista livre',
  'Sol da manhã', 'Quintal', 'Jardim', 'Churrasqueira', 'Piscina', 'Academia',
  'Salão de festas', 'Playground', 'Quadra', 'Portaria 24h', 'Elevador', 'Segurança com câmeras',
  'Gerador', 'Energia solar', 'Depósito', 'Aceita pet', 'Bicicletário', 'Vaga coberta',
];

let _ger = null;

async function abrirGeradorAnuncio() {
  clearAlert('gerador-alert');
  clearInlineStatus('gerador-status');
  const imovelId = $('imovel-id').value || null;
  _ger = { imovelId, fotos: [], regiao: [], resultado: null };

  if (imovelId) {
    try {
      const snap = await tenantPath().collection('imoveis').doc(imovelId).collection('fotos').orderBy('ordem').get();
      snap.docs.forEach(d => {
        const f = d.data();
        _ger.fotos.push({
          chave: 's_' + d.id, origem: 'salva', fotoId: d.id, url: f.url, path: f.path || null,
          originalPath: f.originalPath || null, melhoradaIA: !!f.melhoradaIA, nome: f.nome || 'foto.jpg',
          foraDaAnalise: false,
        });
      });
    } catch (err) {
      showAlert('gerador-alert', 'Não consegui carregar as fotos salvas: ' + err.message);
    }
  }
  // Fotos além do limite ficam fora da análise (continuam no anúncio, no fim)
  _ger.fotos.forEach((f, i) => { if (i >= GERADOR_MAX_FOTOS) f.foraDaAnalise = true; });

  // botões podem ter ficado travados no último "Aplicar" (regra nº 1: só destrava ao trocar de tela)
  ['btn-gerador-gerar', 'btn-gerador-aplicar'].forEach(id => { $(id).disabled = false; });
  $('btn-gerador-aplicar').innerHTML = '✅ Aplicar ao anúncio';

  const meta = _anuncioIAMeta || {};
  $('gerador-extras').value = meta.extras || '';
  $('gerador-tom').value = meta.tom || 'equilibrado';
  $('gerador-publico').value = meta.publico || '';
  const tagsMin = (_imovelTags || []).map(t => String(t).toLowerCase());
  $('gerador-caracteristicas').innerHTML = CARACTERISTICAS_ANUNCIO.map((c, i) => `
    <label class="toggle-row"><input type="checkbox" class="gerador-carac" value="${escapeHtml(c)}" id="gerador-carac-${i}" ${tagsMin.includes(c.toLowerCase()) ? 'checked' : ''}><span>${escapeHtml(c)}</span></label>`).join('');

  renderResumoGerador();
  renderFotosGerador();
  mostrarEtapaGerador('entrada');

  const cfg = await ensureConfigCache();
  if (!(cfg.workerGeminiUrl || '').trim()) {
    showAlert('gerador-alert', isCorretor()
      ? 'A IA ainda não está ligada para o seu acesso. Peça ao administrador da imobiliária.'
      : 'A IA não está configurada: cole a URL do Worker Gemini em Configurações → IA.');
  }
  $('modal-gerador-anuncio').style.display = 'flex';
  $('modal-gerador-anuncio').querySelector('.modal-body').scrollTop = 0;
}

function fecharGeradorAnuncio() {
  $('modal-gerador-anuncio').style.display = 'none';
  if (_ger) _ger.fotos.forEach(f => { if (f.objUrl) URL.revokeObjectURL(f.objUrl); });
  _ger = null;
}

function mostrarEtapaGerador(etapa) {
  const resultado = etapa === 'resultado';
  $('gerador-entrada').style.display = resultado ? 'none' : 'block';
  $('gerador-resultado').style.display = resultado ? 'block' : 'none';
  $('btn-gerador-voltar').style.display = resultado ? '' : 'none';
  $('btn-gerador-aplicar').style.display = resultado ? '' : 'none';
  $('btn-gerador-gerar').innerHTML = resultado ? '🔄 Gerar de novo' : '✨ Gerar anúncio';
  // no resultado, a ação principal passa a ser "Aplicar"
  $('btn-gerador-gerar').classList.toggle('btn-primary', !resultado);
  $('btn-gerador-gerar').classList.toggle('btn-secondary', resultado);
  $('modal-gerador-anuncio').querySelector('.modal-body').scrollTop = 0;
}

function voltarGeradorEntrada() { mostrarEtapaGerador('entrada'); }

// Dados do formulário do imóvel (o que está na tela, salvo ou não)
function dadosDoFormularioImovel() {
  const v = id => ($(id)?.value || '').trim();
  const num = id => { const n = parseFloat(v(id)); return Number.isFinite(n) && n > 0 ? n : null; };
  const txtOpcao = id => { const el = $(id); return el && el.value ? (el.selectedOptions[0]?.textContent || el.value).replace(/^[^\wÀ-ú]+/, '').trim() : null; };
  const pub = {
    mostrarValor: $('pub-mostrar-valor')?.checked !== false,
    mostrarBairro: $('pub-mostrar-bairro')?.checked !== false,
    mostrarArea: $('pub-mostrar-area')?.checked !== false,
    mostrarComodos: $('pub-mostrar-comodos')?.checked !== false,
  };
  const fin = v('imovel-finalidade') || 'locacao';
  const d = {
    tipo: txtOpcao('imovel-tipo'),
    subtipo: txtOpcao('imovel-subtipo'),
    finalidade: { locacao: 'locação', venda: 'venda', ambos: 'locação e venda' }[fin] || fin,
    cidade: v('imovel-cidade') || null,
    uf: v('imovel-uf').toUpperCase() || null,
    mostrarBairro: pub.mostrarBairro,
    mostrarValor: pub.mostrarValor,
  };
  if (pub.mostrarBairro) d.bairro = v('imovel-bairro') || null;
  if (pub.mostrarComodos) Object.assign(d, {
    quartos: parseInt(v('imovel-quartos'), 10) || 0,
    banheiros: parseInt(v('imovel-banheiros'), 10) || 0,
    vagas: parseInt(v('imovel-vagas'), 10) || 0,
    andar: v('imovel-andar') || null,
    mobiliado: txtOpcao('imovel-mobiliado'),
  });
  if (pub.mostrarArea) Object.assign(d, { areaUtilM2: num('imovel-area-util'), areaTotalM2: num('imovel-area-total') });
  if (fin !== 'locacao') Object.assign(d, {
    aceitaFinanciamento: v('imovel-aceita-financiamento') || null,
    permiteFGTS: v('imovel-permite-fgts') || null,
    aceitaPermuta: v('imovel-aceita-permuta') === 'sim' ? 'sim' : 'nao',
    permutaObs: v('imovel-aceita-permuta') === 'sim' ? (v('imovel-permuta-obs') || null) : null,
  });
  if (pub.mostrarValor) Object.assign(d, {
    aluguelMensal: fin !== 'venda' ? num('imovel-aluguel-sugerido') : null,
    valorVenda: fin !== 'locacao' ? num('imovel-valor-venda') : null,
    condominioMensal: num('imovel-valor-condominio'),
    iptuMensal: num('imovel-valor-iptu'),
  });
  d.temVideo = !!v('imovel-video-url');
  d.temTour360 = !!v('imovel-tour-url');
  d.tags = [...(_imovelTags || [])];
  d.descricaoAtual = v('imovel-descricao-longa') || null;
  return d;
}

function renderResumoGerador() {
  const d = dadosDoFormularioImovel();
  const chips = [
    [d.subtipo || d.tipo, d.finalidade].filter(Boolean).join(' · '),
    d.quartos ? `${d.quartos} quarto(s)` : '', d.banheiros ? `${d.banheiros} banheiro(s)` : '',
    d.vagas ? `${d.vagas} vaga(s)` : '', d.areaUtilM2 ? `${d.areaUtilM2} m²` : '',
    [d.bairro, d.cidade].filter(Boolean).join(' — '),
    d.aluguelMensal ? `Aluguel ${fmtBRL(d.aluguelMensal)}` : '', d.valorVenda ? `Venda ${fmtBRL(d.valorVenda)}` : '',
  ].filter(Boolean);
  const falta = [];
  if (!d.areaUtilM2 && $('pub-mostrar-area')?.checked !== false) falta.push(['área útil', 'imovel-area-util']);
  if (!d.cidade) falta.push(['cidade', 'imovel-cep']);
  if (!($('imovel-cep')?.value || '').replace(/\D/g, '')) falta.push(['CEP (para citar a região)', 'imovel-cep']);
  $('gerador-resumo').innerHTML = `
    <div class="gerador-chips">${chips.map(c => `<span class="tag-chip">${escapeHtml(c)}</span>`).join('') || '<span class="muted">Preencha os dados do imóvel no cadastro.</span>'}</div>
    ${falta.length ? `<div class="gerador-falta">Faltando no cadastro: ${falta.map(([t, campo]) => `<button type="button" class="link-btn" onclick="irParaCampoImovel('${campo}')">${escapeHtml(t)}</button>`).join(' · ')}</div>` : ''}
    <div class="muted" style="font-size:12px; margin-top:6px;">${d.mostrarBairro
      ? '📍 Os pontos da região (escolas, metrô, mercados, parques…) são buscados pelo CEP no OpenStreetMap, com distância aproximada.'
      : '🔒 Bairro oculto na publicação: a IA não vai citar bairro nem pontos da região.'}</div>`;
}

// Alerta clicável → fecha o gerador e leva ao campo do cadastro
function irParaCampoImovel(campoId) {
  fecharGeradorAnuncio();
  const el = $(campoId);
  if (!el) return;
  try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
  el.focus({ preventScroll: true });
  el.classList.add('input-erro-pulse');
  setTimeout(() => el.classList.remove('input-erro-pulse'), 2000);
}

function renderFotosGerador() {
  const grid = $('gerador-fotos');
  const fotos = _ger.fotos;
  if (!fotos.length) {
    grid.innerHTML = '<p class="empty" style="grid-column:1/-1;">Nenhuma foto ainda. Adicione abaixo — a IA escolhe a capa e a ordem.</p>';
    return;
  }
  const analisadas = fotos.filter(f => !f.foraDaAnalise).length;
  grid.innerHTML = fotos.map((f, i) => `
    <div class="gerador-foto ${f.foraDaAnalise ? 'is-fora' : ''}">
      <img src="${escapeHtml(f.objUrl || f.url)}" alt="" loading="lazy">
      <span class="gerador-foto-tag">${f.origem === 'nova' ? 'nova' : 'salva'}</span>
      <button type="button" class="gerador-foto-x" title="${f.origem === 'nova' ? 'Remover' : (f.foraDaAnalise ? 'Incluir na análise' : 'Tirar da análise (a foto continua no anúncio)')}" onclick="alternarFotoGerador(${i})">${f.foraDaAnalise ? '↺' : '×'}</button>
    </div>`).join('') + `<p class="muted" style="grid-column:1/-1; font-size:12px; margin:0;">${analisadas} de até ${GERADOR_MAX_FOTOS} fotos na análise.</p>`;
}

function alternarFotoGerador(i) {
  const f = _ger.fotos[i];
  if (!f) return;
  if (f.origem === 'nova') {
    if (f.objUrl) URL.revokeObjectURL(f.objUrl);
    _ger.fotos.splice(i, 1);
  } else if (f.foraDaAnalise) {
    if (_ger.fotos.filter(x => !x.foraDaAnalise).length >= GERADOR_MAX_FOTOS) {
      showAlert('gerador-alert', `Máximo de ${GERADOR_MAX_FOTOS} fotos por análise. Tire outra antes.`);
      return;
    }
    f.foraDaAnalise = false;
  } else {
    f.foraDaAnalise = true;
  }
  renderFotosGerador();
}

function adicionarFotosGerador(input) {
  clearAlert('gerador-alert');
  const files = Array.from(input.files || []).filter(f => /^image\//.test(f.type));
  input.value = '';
  const grandes = files.filter(f => f.size > 20 * 1024 * 1024);
  let vagas = GERADOR_MAX_FOTOS - _ger.fotos.filter(x => !x.foraDaAnalise).length;
  let recusadas = 0;
  files.forEach((file, i) => {
    if (file.size > 20 * 1024 * 1024) return;
    if (vagas <= 0) { recusadas++; return; }
    vagas--;
    _ger.fotos.push({ chave: `n_${Date.now()}_${i}`, origem: 'nova', file, nome: file.name, objUrl: URL.createObjectURL(file), foraDaAnalise: false });
  });
  renderFotosGerador();
  const avisos = [];
  if (grandes.length) avisos.push(`${grandes.length} foto(s) acima de 20MB ficaram de fora`);
  if (recusadas) avisos.push(`${recusadas} foto(s) passaram do limite de ${GERADOR_MAX_FOTOS} por análise`);
  if (avisos.length) showAlert('gerador-alert', avisos.join(' · ') + '.');
}

// ---------- Imagens: carregar, reduzir e corrigir (canvas) ----------

async function blobDaFoto(f) {
  if (f.file) return f.file;
  const r = await fetch(f.url);
  if (!r.ok) throw new Error(`não consegui baixar a foto "${f.nome}" (${r.status})`);
  return r.blob();
}

function decodificarImagem(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('arquivo de imagem inválido')); };
    img.src = url;
  });
}

function carregarDataUrl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('falha ao abrir a prévia'));
    img.src = src;
  });
}

// Desenha reduzido (lado maior = maxLado) e gira 0/90/180/270
function desenharReduzido(img, maxLado, rotacao = 0) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const fator = Math.min(1, maxLado / Math.max(w0, h0));
  const w = Math.round(w0 * fator), h = Math.round(h0 * fator);
  const rot = ((Math.round((rotacao || 0) / 90) * 90) % 360 + 360) % 360;
  const deLado = rot === 90 || rot === 270;
  const c = document.createElement('canvas');
  c.width = deLado ? h : w;
  c.height = deLado ? w : h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rot * Math.PI / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

const _clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));

// Correção HONESTA: níveis automáticos suaves (tira o "véu" e a dominante de cor)
// + ajustes da IA (brilho, contraste, saturação, temperatura). Não altera o imóvel.
function corrigirCores(canvas, aj = {}) {
  const ctx = canvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const passo = Math.max(1, Math.floor(d.length / 4 / 200000)) * 4;
  let n = 0;
  for (let i = 0; i < d.length; i += passo) { hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++; n++; }
  const corte = n * 0.005;
  const limites = hist.map(h => {
    let lo = 0, acc = 0;
    while (lo < 254 && (acc += h[lo]) < corte) lo++;
    let hi = 255; acc = 0;
    while (hi > lo + 1 && (acc += h[hi]) < corte) hi--;
    return [lo, hi];
  });
  const loG = Math.min(...limites.map(l => l[0])), hiG = Math.max(...limites.map(l => l[1]));

  const exp = 1 / (1 + _clamp(aj.brilho, -40, 40) / 100);      // gama: brilho sem lavar a foto
  const k = _clamp(aj.contraste, -30, 30) * 1.5;
  const fC = (259 * (k + 255)) / (255 * (259 - k));
  const temp = _clamp(aj.temperatura, -30, 30) * 0.5;
  const sat = 1 + _clamp(aj.saturacao, -30, 30) / 100;

  const luts = limites.map(([lo, hi], c) => {
    // canal: 60% do ajuste próprio (tira dominante de cor) + 40% dos níveis globais
    // (100% por canal neutralizaria até madeira e parede quente — cor real tem de ficar)
    const loC = loG + (lo - loG) * 0.6, hiC = hiG + (hi - hiG) * 0.6;
    const faixa = hiC - loC;
    const t = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let x = v;
      if (faixa > 40) x = v + (((v - loC) * 255 / faixa) - v) * 0.8;
      x = 255 * Math.pow(Math.max(0, Math.min(255, x)) / 255, exp);
      x = fC * (x - 128) + 128;
      if (c === 0) x += temp;
      if (c === 2) x -= temp;
      t[v] = x;
    }
    return t;
  });
  const [L0, L1, L2] = luts;
  for (let i = 0; i < d.length; i += 4) {
    let r = L0[d[i]], g = L1[d[i + 1]], b = L2[d[i + 2]];
    if (sat !== 1) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      r = y + (r - y) * sat; g = y + (g - y) * sat; b = y + (b - y) * sat;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function canvasParaBlob(c, qualidade = 0.9) {
  return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('falha ao gerar a foto')), 'image/jpeg', qualidade));
}

// Versão final para subir: corrigida (até 1920px) ou só reduzida (até 2560px)
async function fotoFinalParaUpload(f, corrigir, ajustes) {
  const img = await decodificarImagem(await blobDaFoto(f));
  const c = corrigir ? desenharReduzido(img, 1920, ajustes?.rotacao) : desenharReduzido(img, 2560, 0);
  if (corrigir) corrigirCores(c, ajustes);
  return canvasParaBlob(c, corrigir ? 0.9 : 0.92);
}

// ---------- Pontos da região (OpenStreetMap / Overpass) ----------

const CATEGORIAS_REGIAO = [
  { label: 'Estação de metrô/trem', t: x => x.railway === 'station' || x.station === 'subway' || x.public_transport === 'station' || x.railway === 'subway_entrance' },
  { label: 'Terminal de ônibus', t: x => x.amenity === 'bus_station' },
  { label: 'Escola', t: x => x.amenity === 'school' || x.amenity === 'kindergarten' },
  { label: 'Faculdade', t: x => x.amenity === 'university' || x.amenity === 'college' },
  { label: 'Supermercado', t: x => x.shop === 'supermarket' },
  { label: 'Shopping', t: x => x.shop === 'mall' },
  { label: 'Padaria', t: x => x.shop === 'bakery' },
  { label: 'Farmácia', t: x => x.amenity === 'pharmacy' },
  { label: 'Hospital/clínica', t: x => x.amenity === 'hospital' || x.amenity === 'clinic' },
  { label: 'Parque', t: x => x.leisure === 'park' },
  { label: 'Academia/centro esportivo', t: x => x.leisure === 'fitness_centre' || x.leisure === 'sports_centre' },
  { label: 'Banco', t: x => x.amenity === 'bank' },
];

function distanciaMetros(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function textoDistancia(m) {
  if (m < 1000) return `~${Math.max(50, Math.round(m / 50) * 50)} m (≈${Math.max(1, Math.round(m / 80))} min a pé)`;
  return `~${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

// Localização do imóvel para medir distâncias: CEP (nível de quarteirão/trecho
// de rua) e, sem CEP no mapa, a rua na cidade. Nunca o número da casa.
async function coordenadaDoImovel() {
  const v = id => ($(id)?.value || '').trim();
  const porCep = await coordenadaPorCep(v('imovel-cep'));
  if (porCep) return porCep;
  const rua = v('imovel-logradouro'), cidade = v('imovel-cidade');
  if (!rua || !cidade) return null;
  try { return await nominatimBusca({ street: rua, city: cidade, state: v('imovel-uf'), country: 'Brasil' }); }
  catch (_) { return null; }
}

async function pontosDaRegiao(centro) {
  if (!centro) return { pontos: [], aviso: 'Não achei o imóvel no mapa pelo CEP nem pela rua — a região não será citada.' };
  const R = 1500, { lat, lng } = centro;
  const q = `[out:json][timeout:20];(
    nwr(around:${R},${lat},${lng})["amenity"~"^(school|kindergarten|university|college|hospital|clinic|pharmacy|bank|bus_station)$"]["name"];
    nwr(around:${R},${lat},${lng})["shop"~"^(supermarket|mall|bakery)$"]["name"];
    nwr(around:${R},${lat},${lng})["leisure"~"^(park|fitness_centre|sports_centre)$"]["name"];
    nwr(around:${R},${lat},${lng})["railway"~"^(station|subway_entrance)$"]["name"];
    nwr(around:${R},${lat},${lng})["public_transport"="station"]["name"];
  );out center 400;`;
  // Espelhos públicos do Overpass são instáveis: tenta em sequência, teto de 45s no total
  const servidores = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  const limite = Date.now() + 45000;
  let elementos = null;
  for (const srv of servidores) {
    const resta = limite - Date.now();
    if (resta < 3000) break;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(25000, resta));
    try {
      const r = await fetch(srv, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctl.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (r.ok) { elementos = (await r.json()).elements || []; break; }
    } catch (_) { /* tenta o próximo */ } finally { clearTimeout(timer); }
  }
  if (!elementos) return { pontos: [], aviso: 'Serviço de mapas fora do ar — a região não será citada desta vez.' };

  const porCategoria = new Map();
  elementos.forEach(e => {
    const tags = e.tags || {};
    const pos = e.lat != null ? { lat: e.lat, lng: e.lon } : (e.center ? { lat: e.center.lat, lng: e.center.lon } : null);
    if (!pos || !tags.name) return;
    const cat = CATEGORIAS_REGIAO.find(c => c.t(tags));
    if (!cat) return;
    const lista = porCategoria.get(cat.label) || [];
    lista.push({ nome: tags.name, dist: distanciaMetros(centro, pos) });
    porCategoria.set(cat.label, lista);
  });
  const pontos = [];
  CATEGORIAS_REGIAO.forEach(c => {
    const vistos = new Set();
    (porCategoria.get(c.label) || []).sort((a, b) => a.dist - b.dist).forEach(p => {
      // "Metro Trianon MASP" e "Trianon-Masp" são a mesma estação
      const chave = p.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\b(metro|estacao|station)\b/g, '').replace(/[^a-z0-9]/g, '');
      if (vistos.has(chave) || vistos.size >= 3) return;
      vistos.add(chave);
      pontos.push(`${c.label}: ${p.nome} — ${textoDistancia(p.dist)}`);
    });
  });
  return { pontos, aviso: pontos.length ? null : 'Nenhum ponto de referência encontrado num raio de 1,5 km.' };
}

// ---------- Gerar ----------

async function gerarAnuncioIA() {
  clearAlert('gerador-alert');
  const cfg = await ensureConfigCache();
  const workerUrl = (cfg.workerGeminiUrl || '').trim();
  if (!workerUrl) {
    showAlert('gerador-alert', 'A IA não está configurada: cole a URL do Worker Gemini em Configurações → IA.');
    return;
  }
  const btn = $('btn-gerador-gerar');
  const st = 'gerador-status';
  try {
    const r = await drgSubmit(btn, '⏳ Gerando… aguarde ~40s', async () => {
      const dados = dadosDoFormularioImovel();
      dados.caracteristicas = Array.from(document.querySelectorAll('.gerador-carac:checked')).map(c => c.value);
      dados.informacoesExtras = $('gerador-extras').value.trim() || null;
      dados.tom = $('gerador-tom').selectedOptions[0]?.textContent || 'Profissional e acolhedor';
      dados.publico = $('gerador-publico').value ? $('gerador-publico').selectedOptions[0].textContent : null;

      // 1) Região
      let regiao = { pontos: [], aviso: null };
      if (dados.mostrarBairro) {
        showInlineStatus(st, '📍 Buscando pontos da região… (1/3)', 'loading');
        regiao = await pontosDaRegiao(await coordenadaDoImovel());
        if (regiao.pontos.length) dados.observacaoRegiao = 'Distâncias em linha reta a partir do CEP/rua do imóvel (erro de algumas centenas de metros).';
      }
      _ger.regiao = regiao;

      // 2) Fotos reduzidas para a IA
      const analisadas = _ger.fotos.filter(f => !f.foraDaAnalise);
      const imagens = [];
      for (let i = 0; i < analisadas.length; i++) {
        showInlineStatus(st, `🖼 Preparando fotos ${i + 1}/${analisadas.length}… (2/3)`, 'loading');
        const f = analisadas[i];
        const img = await decodificarImagem(await blobDaFoto(f));
        const c = desenharReduzido(img, 768, 0);
        f.thumb = c.toDataURL('image/jpeg', 0.78);
        imagens.push({ mimeType: 'image/jpeg', data: f.thumb.split(',')[1] });
      }

      // 3) IA
      showInlineStatus(st, `🤖 IA analisando ${imagens.length} foto(s) e escrevendo o anúncio… (3/3)`, 'loading');
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 150000);
      let res;
      try {
        res = await fetch(workerUrl, {
          method: 'POST', signal: ctl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modo: 'anuncio', imagens, dados, pontosRegiao: regiao.pontos }),
        });
      } catch (e) {
        throw new Error(e.name === 'AbortError' ? 'a IA demorou demais (mais de 2 min). Tente com menos fotos.' : 'sem conexão com a IA: ' + e.message);
      } finally { clearTimeout(timer); }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || `erro ${res.status} na IA`);

      _ger.resultado = normalizarResultadoIA(json.data, analisadas);
      _ger.analisadas = analisadas;
      _ger.meta = { extras: dados.informacoesExtras, tom: $('gerador-tom').value, publico: $('gerador-publico').value };

      // Prévias antes/depois (sobre a miniatura — rápido)
      for (let i = 0; i < analisadas.length; i++) {
        showInlineStatus(st, `🎨 Corrigindo luz e cor ${i + 1}/${analisadas.length}…`, 'loading');
        const f = analisadas[i];
        const a = _ger.resultado.fotos[i];
        const img = await carregarDataUrl(f.thumb);
        const c = corrigirCores(desenharReduzido(img, 768, a.ajustes.rotacao), a.ajustes);
        f.previewMelhor = c.toDataURL('image/jpeg', 0.85);
        if (a.ajustes.rotacao) f.previewOriginal = desenharReduzido(img, 768, 0).toDataURL('image/jpeg', 0.85);
      }
      return true;
    }, { destravar: true });
    if (r === DRG_IGNORADO) return;
    clearInlineStatus(st);
    renderResultadoGerador();
    mostrarEtapaGerador('resultado');
  } catch (err) {
    console.error('Gerador de anúncios:', err);
    clearInlineStatus(st);
    showAlert('gerador-alert', '❌ Não consegui gerar o anúncio: ' + err.message);
  }
}

// Confere e completa o JSON da IA (nunca confiar no formato)
function normalizarResultadoIA(d, analisadas) {
  const arr = x => Array.isArray(x) ? x.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()) : [];
  const n = analisadas.length;
  const fotosIA = Array.isArray(d.fotos) ? d.fotos : [];
  const fotos = analisadas.map((f, i) => {
    const a = fotosIA.find(x => x && Number(x.indice) === i) || fotosIA[i] || {};
    const aj = a.ajustes || {};
    return {
      ambiente: String(a.ambiente || ''),
      legenda: String(a.legenda || '').slice(0, 80),
      nota: Number.isFinite(Number(a.nota)) ? Number(a.nota) : null,
      usar: a.usar !== false,
      motivoDescarte: a.motivoDescarte || null,
      privacidade: a.privacidade || null,
      ajustes: {
        brilho: _clamp(aj.brilho, -40, 40), contraste: _clamp(aj.contraste, -30, 30),
        saturacao: _clamp(aj.saturacao, -30, 30), temperatura: _clamp(aj.temperatura, -30, 30),
        rotacao: [90, 180, 270].includes(Number(aj.rotacao)) ? Number(aj.rotacao) : 0,
      },
      // padrão: corrigir; foto já corrigida antes pela IA não é corrigida de novo
      corrigir: !f.melhoradaIA,
    };
  });
  let ordem = (Array.isArray(d.ordemFotos) ? d.ordemFotos : []).map(Number)
    .filter((x, i, a) => Number.isInteger(x) && x >= 0 && x < n && a.indexOf(x) === i);
  // completa com as que a IA não ordenou (melhor nota primeiro)
  const resto = fotos.map((_, i) => i).filter(i => !ordem.includes(i))
    .sort((a, b) => (fotos[b].nota ?? 0) - (fotos[a].nota ?? 0));
  ordem = [...ordem, ...resto];
  const nivel = ['padrao', 'destaque', 'super', 'premium'].includes(d.relevanciaSugerida) ? d.relevanciaSugerida : 'padrao';
  return {
    titulo: String(d.titulo || '').trim(),
    chamadaCurta: String(d.chamadaCurta || '').trim(),
    descricao: String(d.descricao || '').trim(),
    destaques: arr(d.destaques),
    pontosRegiao: arr(d.pontosRegiao),
    tags: arr(d.tags).map(t => t.toLowerCase()).slice(0, 12),
    fotos, ordem,
    relevancia: nivel,
    justificativa: String(d.justificativaRelevancia || ''),
    nota: Number.isFinite(Number(d.notaAnuncio)) ? Math.round(Number(d.notaAnuncio)) : null,
    faltando: arr(d.informacoesFaltando),
    alertas: arr(d.alertas),
  };
}

// "Informações faltando" → campo do cadastro (alerta clicável)
const CAMPOS_POR_PALAVRA = [
  [/área|metragem|m²/i, 'imovel-area-util'], [/vídeo|video/i, 'imovel-video-url'],
  [/tour|360/i, 'imovel-tour-url'], [/cep|endereço|localiza/i, 'imovel-cep'],
  [/andar/i, 'imovel-andar'], [/vaga/i, 'imovel-vagas'], [/banheiro/i, 'imovel-banheiros'],
  [/quarto|dormit/i, 'imovel-quartos'], [/aluguel|valor|preço/i, 'imovel-aluguel-sugerido'],
];

function renderResultadoGerador() {
  const R = _ger.resultado;
  const fotos = _ger.analisadas;
  const nivelOpts = RELEVANCIA_NIVEIS.map(n => `<option value="${n.id}" ${n.id === R.relevancia ? 'selected' : ''}>${n.label}</option>`).join('');
  const temPortais = !isCorretor() && document.querySelectorAll('#imovel-anuncio-portais .anuncio-portal-row').length > 0;
  const regiaoAviso = _ger.regiao?.aviso ? `<p class="muted" style="font-size:11px;">ℹ️ ${escapeHtml(_ger.regiao.aviso)}</p>` : '';
  const notaCor = R.nota == null ? '' : R.nota >= 80 ? 'is-ok' : R.nota >= 60 ? 'is-mid' : 'is-low';

  const cards = R.ordem.map((i, pos) => {
    const f = fotos[i], a = R.fotos[i];
    const capa = pos === 0 && a.usar;
    return `
      <div class="gerador-res-foto ${a.usar ? '' : 'is-descartada'}" data-i="${i}">
        <div class="gerador-res-img">
          <img src="${a.corrigir ? f.previewMelhor : (f.previewOriginal || f.thumb)}" alt="" id="gerador-img-${i}">
          <span class="gerador-ordem">${capa ? '👑 Capa' : pos + 1}</span>
          <button type="button" class="gerador-comparar" onpointerdown="compararFotoGerador(${i}, true)" onpointerup="compararFotoGerador(${i}, false)" onpointerleave="compararFotoGerador(${i}, false)" title="Segure para ver a original">👁 Original</button>
        </div>
        <div class="gerador-res-info">
          <strong>${escapeHtml(a.legenda || a.ambiente || 'Foto')}</strong>
          <span class="muted" style="font-size:11px;">${escapeHtml(a.ambiente)}${a.nota != null ? ` · nota ${a.nota}/10` : ''}${f.origem === 'salva' ? ' · já salva' : ' · nova'}</span>
          ${!a.usar && a.motivoDescarte ? `<span class="gerador-motivo">✂️ ${escapeHtml(a.motivoDescarte)}</span>` : ''}
          ${a.privacidade ? `<span class="gerador-privacidade">🔒 ${escapeHtml(a.privacidade)}</span>` : ''}
          <label class="toggle-row"><input type="checkbox" ${a.usar ? 'checked' : ''} onchange="marcarFotoGerador(${i}, 'usar', this.checked)"><span>Usar no anúncio</span></label>
          <label class="toggle-row"><input type="checkbox" ${a.corrigir ? 'checked' : ''} onchange="marcarFotoGerador(${i}, 'corrigir', this.checked)"><span>Usar versão corrigida</span></label>
        </div>
      </div>`;
  }).join('');

  $('gerador-resultado').innerHTML = `
    <div class="gerador-res-topo">
      ${R.nota != null ? `<div class="gerador-nota ${notaCor}"><strong>${R.nota}</strong><span>/100</span></div>` : ''}
      <div style="flex:1; min-width:200px;">
        <strong>Anúncio pronto para revisar</strong>
        <p class="muted" style="margin:2px 0 0; font-size:12px;">Edite à vontade. Nada é gravado até você tocar em <strong>Aplicar ao anúncio</strong> (o texto ainda passa pelo Salvar do imóvel).</p>
      </div>
    </div>
    ${R.alertas.length ? `<div class="gerador-alertas">${R.alertas.map(a => `<div>⚠️ ${escapeHtml(a)}</div>`).join('')}</div>` : ''}

    <div class="form-group">
      <label>Título <span class="muted" id="gerador-titulo-cont" style="font-weight:400;"></span></label>
      <input type="text" id="gerador-titulo" maxlength="100" value="${escapeHtml(R.titulo)}" oninput="contarTituloGerador()">
    </div>
    <div class="form-group">
      <label>Descrição</label>
      <textarea id="gerador-descricao" rows="11">${escapeHtml(R.descricao)}</textarea>
    </div>
    <div class="form-row" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));">
      <div class="form-group">
        <label>Destaques do imóvel <span class="muted" style="font-weight:400;">(um por linha)</span></label>
        <textarea id="gerador-destaques" rows="6">${escapeHtml(R.destaques.join('\n'))}</textarea>
      </div>
      <div class="form-group">
        <label>Na região <span class="muted" style="font-weight:400;">(um por linha · OpenStreetMap)</span></label>
        <textarea id="gerador-regiao" rows="6">${escapeHtml(R.pontosRegiao.join('\n'))}</textarea>
        ${regiaoAviso}
      </div>
    </div>
    <div class="form-group">
      <label>Chamada curta (WhatsApp / redes sociais)</label>
      <input type="text" id="gerador-chamada" maxlength="160" value="${escapeHtml(R.chamadaCurta)}">
    </div>
    <div class="form-group">
      <label>Tags <span class="muted" style="font-weight:400;">(separadas por vírgula)</span></label>
      <input type="text" id="gerador-tags" value="${escapeHtml(R.tags.join(', '))}">
    </div>

    <div class="gerador-relevancia">
      <div><strong>Relevância sugerida:</strong> <select id="gerador-nivel">${nivelOpts}</select></div>
      <p class="muted" style="margin:4px 0 0; font-size:12px;">${escapeHtml(R.justificativa)}</p>
      ${temPortais ? `<label class="toggle-row" style="margin-top:6px;"><input type="checkbox" id="gerador-aplicar-nivel"><span>Aplicar este nível nos portais marcados no anúncio</span></label>` : ''}
    </div>

    ${R.faltando.length ? `
      <div class="gerador-faltando">
        <strong>Para o anúncio ficar ainda melhor:</strong>
        <ul>${R.faltando.map(t => {
          const campo = (CAMPOS_POR_PALAVRA.find(([re]) => re.test(t)) || [])[1];
          return `<li>${campo ? `<button type="button" class="link-btn" onclick="irParaCampoImovel('${campo}')">${escapeHtml(t)} →</button>` : escapeHtml(t)}</li>`;
        }).join('')}</ul>
      </div>` : ''}

    <h4 class="form-section-title">📷 Fotos — ordem, capa e correção</h4>
    <p class="muted" style="font-size:12px; margin-top:-4px;">A correção ajusta só luz e cor (sem inventar nada no imóvel — anúncio fiel evita reclamação e problema com o CDC). Segure “👁 Original” para comparar. Fotos marcadas para sair: as novas não sobem; as já salvas vão para o fim (apague no × do cadastro se concordar).</p>
    <div class="gerador-res-fotos">${cards || '<p class="muted">Sem fotos nesta análise.</p>'}</div>`;
  contarTituloGerador();
}

function contarTituloGerador() {
  const n = ($('gerador-titulo')?.value || '').trim().length;
  const el = $('gerador-titulo-cont');
  if (el) el.textContent = `· ${n} caracteres${n >= 45 && n <= 70 ? ' ✓' : ''}`;
}

function compararFotoGerador(i, mostrarOriginal) {
  const img = $(`gerador-img-${i}`);
  const f = _ger?.analisadas?.[i];
  const a = _ger?.resultado?.fotos?.[i];
  if (!img || !f || !a) return;
  img.src = mostrarOriginal ? (f.previewOriginal || f.thumb) : (a.corrigir ? f.previewMelhor : (f.previewOriginal || f.thumb));
}

function marcarFotoGerador(i, campo, valor) {
  const a = _ger.resultado.fotos[i];
  a[campo] = valor;
  if (campo === 'corrigir') compararFotoGerador(i, false);
  const card = document.querySelector(`.gerador-res-foto[data-i="${i}"]`);
  if (card && campo === 'usar') card.classList.toggle('is-descartada', !valor);
}

// ---------- Aplicar ----------

async function aplicarAnuncioIA() {
  clearAlert('gerador-alert');
  const R = _ger.resultado;
  const btn = $('btn-gerador-aplicar');
  try {
    const r = await drgSubmit(btn, '⏳ Aplicando… aguarde', async () => {
      // 1) Texto → formulário do imóvel (grava no Salvar, com o fluxo de aprovação de sempre)
      const titulo = $('gerador-titulo').value.trim();
      const linhas = id => $(id).value.split('\n').map(s => s.replace(/^[•\-*\s]+/, '').trim()).filter(Boolean);
      const destaques = linhas('gerador-destaques');
      const regiao = linhas('gerador-regiao');
      let desc = $('gerador-descricao').value.trim();
      if (destaques.length) desc += `\n\nDestaques do imóvel:\n${destaques.map(s => `• ${s}`).join('\n')}`;
      if (regiao.length) desc += `\n\nNa região (distâncias aproximadas):\n${regiao.map(s => `• ${s}`).join('\n')}`;
      if (titulo) $('imovel-titulo-anuncio').value = titulo;
      contarTituloAnuncio();
      $('imovel-descricao-longa').value = desc;

      const novasTags = [
        ...$('gerador-tags').value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
        ...Array.from(document.querySelectorAll('.gerador-carac:checked')).map(c => c.value.toLowerCase()),
      ];
      const atuais = new Set((_imovelTags || []).map(t => String(t).toLowerCase()));
      novasTags.forEach(t => { if (!atuais.has(t)) { _imovelTags.push(t); atuais.add(t); } });
      renderImovelTags();

      const nivel = $('gerador-nivel').value;
      if ($('gerador-aplicar-nivel')?.checked) {
        document.querySelectorAll('#imovel-anuncio-portais .anuncio-portal-row').forEach(row => {
          if (!row.querySelector('.anuncio-portal-chk').checked) return;
          row.querySelector('.anuncio-portal-nivel').value = nivel;
          atualizarCotaPortal(row.dataset.portal);
        });
      }
      _anuncioIAMeta = {
        ..._ger.meta, nota: R.nota, relevanciaSugerida: nivel,
        chamadaCurta: $('gerador-chamada').value.trim() || null,
        geradoEm: new Date().toISOString(), geradoPor: State.user.uid,
      };

      // 2) Fotos (anexos não passam pela fila: exigem ✅ Pode)
      const fotos = _ger.analisadas;
      const precisaFotos = fotos.length > 0;
      let resumoFotos = { novas: 0, corrigidas: 0, sairam: 0 };
      if (precisaFotos) {
        if (!exigirNivelAnexo('imoveis', 'criar', 'gerador-alert')) {
          return { semFotos: true };
        }
        resumoFotos = await aplicarFotosIA(btn);
      }
      return { resumoFotos };
    });
    if (r === DRG_IGNORADO) return;
    fecharGeradorAnuncio();
    const partes = ['título e descrição no formulário'];
    if (r.resumoFotos) {
      const f = r.resumoFotos;
      if (f.novas) partes.push(`${f.novas} foto(s) nova(s)`);
      if (f.corrigidas) partes.push(`${f.corrigidas} foto(s) corrigida(s)`);
      partes.push('capa e ordem definidas');
    }
    const extra = r.semFotos ? ' Fotos não foram mexidas (seu perfil não permite anexar).' : (r.resumoFotos?.sairam ? ` ${r.resumoFotos.sairam} foto(s) que a IA sugeriu tirar foram para o fim da galeria.` : '');
    showInlineStatus('imovel-acoes-status', `✓ Anúncio aplicado: ${partes.join(', ')}.${extra} Revise e toque em <strong>Salvar</strong> para gravar o texto.`, 'success');
    try { $('imovel-anuncio-section').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
  } catch (err) {
    console.error('Aplicar anúncio:', err);
    showAlert('gerador-alert', '❌ Não consegui aplicar: ' + err.message);
  }
}

async function aplicarFotosIA(btn) {
  const R = _ger.resultado;
  const fotos = _ger.analisadas;
  const imovelId = await garantirRascunhoImovel('gerador-alert');
  if (!imovelId) throw new Error('preencha o Apelido do imóvel antes (é preciso para guardar as fotos).');
  _ger.imovelId = imovelId;

  let logo = null;
  if ($('imovel-foto-watermark')?.checked) {
    try { logo = await getLogoImage(); } catch (_) { logo = null; }
  }
  const folderRef = storageTenantRef().child(`imoveis/${imovelId}/fotos`);
  const fotosColl = tenantPath().collection('imoveis').doc(imovelId).collection('fotos');

  // Ordem final: usadas na ordem da IA → salvas fora da análise → salvas descartadas
  const usadas = R.ordem.filter(i => R.fotos[i].usar);
  const descartadasSalvas = R.ordem.filter(i => !R.fotos[i].usar && fotos[i].origem === 'salva');
  const foraDaAnalise = _ger.fotos.filter(f => f.foraDaAnalise && f.origem === 'salva');
  const total = usadas.length + foraDaAnalise.length + descartadasSalvas.length;
  const resumo = { novas: 0, corrigidas: 0, sairam: descartadasSalvas.length };
  let ordem = 0;

  const subir = async (blob, nomeBase) => {
    const limpo = String(nomeBase || 'foto').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
    const finalName = `${Date.now()}_${limpo}_ia.jpg`;
    const ref = folderRef.child(finalName);
    await ref.put(blob, { contentType: 'image/jpeg', customMetadata: { uploadedBy: State.user.uid, origem: 'gerador-ia' } });
    return { url: await ref.getDownloadURL(), path: `imoveis/${imovelId}/fotos/${finalName}` };
  };

  for (const i of usadas) {
    btn.innerHTML = `⏳ Fotos ${ordem + 1}/${total}… aguarde`;
    const f = fotos[i], a = R.fotos[i];
    if (f.origem === 'nova') {
      let blob = await fotoFinalParaUpload(f, a.corrigir, a.ajustes);
      if (logo) blob = await applyWatermark(new File([blob], 'foto.jpg', { type: 'image/jpeg' }), logo);
      const up = await subir(blob, f.nome);
      await fotosColl.add({
        url: up.url, path: up.path, nome: f.nome, watermark: !!logo, ordem: ordem++,
        legenda: a.legenda || null, ambiente: a.ambiente || null, melhoradaIA: !!a.corrigir,
        criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      });
      resumo.novas++;
      if (a.corrigir) resumo.corrigidas++;
    } else {
      const upd = { ordem: ordem++, legenda: a.legenda || null, ambiente: a.ambiente || null };
      if (a.corrigir) {
        const up = await subir(await fotoFinalParaUpload(f, true, a.ajustes), f.nome);
        // guarda a original para sempre poder voltar; versão IA anterior é descartada
        const original = f.originalPath ? {} : { originalPath: f.path, originalUrl: f.url };
        Object.assign(upd, { url: up.url, path: up.path, melhoradaIA: true, ...original });
        await fotosColl.doc(f.fotoId).update(upd);
        if (f.originalPath && f.path && f.path !== f.originalPath) {
          try { await storageTenantRef().child(f.path).delete(); } catch (_) {}
        }
        resumo.corrigidas++;
      } else {
        await fotosColl.doc(f.fotoId).update(upd);
      }
    }
  }
  for (const f of foraDaAnalise) await fotosColl.doc(f.fotoId).update({ ordem: ordem++ });
  for (const i of descartadasSalvas) {
    await fotosColl.doc(fotos[i].fotoId).update({ ordem: ordem++, legenda: R.fotos[i].legenda || null, sugestaoIA: 'remover' });
  }
  logAuditoria('update', 'imovel', imovelId, { acao: 'gerador_anuncio_ia', ...resumo });
  loadImovelFotos(imovelId);
  return resumo;
}

window.abrirGeradorAnuncio = abrirGeradorAnuncio;
window.fecharGeradorAnuncio = fecharGeradorAnuncio;
window.gerarAnuncioIA = gerarAnuncioIA;
window.aplicarAnuncioIA = aplicarAnuncioIA;
