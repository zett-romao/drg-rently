// =============================================================
// DRG-Rently — public-imoveis.js
// Vitrine geral pública do tenant
// URL: imoveis.html?t=<tenantId>
// =============================================================

const params = new URLSearchParams(window.location.search);
// No site próprio da imobiliária (ex.: drglobalimoveis.com.br) o rently-site.js fixa o tenant
const tenantIdOrSlug = params.get('t') || window.RENTLY_TENANT_FIXO || null;
// 'f' é o nome curto usado pela busca de sites próprios (ex.: home do drglobalimoveis.com.br)
const finalidadeInicial = (params.get('finalidade') || params.get('f') || '').toLowerCase();
// Favoritos: ?favoritos=1 (os deste aparelho) | ?lista=id1,id2 (lista enviada por alguém)
const _listaRecebida = (params.get('lista') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 60);
let _modoLista = params.get('favoritos') === '1' ? 'favoritos' : (_listaRecebida.length ? 'recebida' : null);
let tenantId = null; // será resolvido no init
let _finalidadeAtiva = ''; // '', 'locacao' ou 'venda'

async function resolveTenantId(slugOrId) {
  if (!slugOrId) return null;
  const db = firebase.firestore();
  try {
    const direct = await db.collection('tenants').doc(slugOrId).get();
    if (direct.exists) return slugOrId;
  } catch (_) {}
  try {
    const snap = await db.collection('tenants').where('slug', '==', slugOrId).limit(1).get();
    if (!snap.empty) return snap.docs[0].id;
  } catch (_) {}
  return null;
}

const $$ = (id) => document.getElementById(id);

function fmtBRL(n) {
  if (n == null || isNaN(n)) return 'A consultar';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function showError(msg) {
  $$('loading').style.display = 'none';
  $$('content').style.display = 'none';
  $$('error-state').style.display = 'block';
  if (msg) {
    const p = $$('error-state').querySelector('p');
    if (p) p.textContent = msg;
  }
}

const TIPO_LABEL = { residencial: 'Residencial', comercial: 'Comercial' };
const SUBTIPO_LABEL = {
  apartamento: 'Apartamento', casa: 'Casa', sobrado: 'Sobrado', kitnet: 'Kitnet',
  sala: 'Sala', loja: 'Loja', galpao: 'Galpão', terreno: 'Terreno', outro: 'Imóvel'
};

let _allImoveis = []; // cache pra filtros

(async function init() {
  if (!tenantIdOrSlug) {
    showError('Link incompleto. Confira a URL.');
    return;
  }

  try {
    const db = firebase.firestore();

    tenantId = await resolveTenantId(tenantIdOrSlug);
    if (!tenantId) { showError('Imobiliária não encontrada.'); return; }

    // vitrine/{id} = cópia pública e enxuta do imóvel publicado (sem dados internos).
    // Fallback pro modelo antigo só enquanto a vitrine ainda não foi gerada.
    const [tSnap, vitSnap] = await Promise.all([
      db.collection('tenants').doc(tenantId).get(),
      db.collection('tenants').doc(tenantId).collection('vitrine').get().catch(() => ({ empty: true, docs: [] })),
    ]);
    let imSnap = vitSnap;
    if (vitSnap.empty) {
      try {
        imSnap = await db.collection('tenants').doc(tenantId).collection('imoveis').where('linkPublico', '==', true).get();
      } catch (_) { /* regra antiga já removida → vitrine vazia mesmo */ }
    }

    if (!tSnap.exists) { showError('Imobiliária não encontrada.'); return; }
    const tenant = tSnap.data();

    // Renderiza header
    $$('header-empresa').textContent = tenant.nome || 'DRG-Rently';
    $$('footer-empresa').textContent = tenant.nome || 'DRG-Rently';
    $$('ano-rodape').textContent = new Date().getFullYear();

    // Logo customizada do tenant
    if (tenant.logoUrl) {
      document.querySelectorAll('.public-logo, .error-logo').forEach(img => { img.src = tenant.logoUrl; });
      const fav = document.querySelector('link[rel="icon"]');
      if (fav) fav.href = tenant.logoUrl;
    }

    // Configura WhatsApp FAB e armazena tenant pra usar no envio de leads
    window._publicTenantId = tenantId;
    window._publicTenantNome = tenant.nome || 'DRG-Rently';
    configurarWhatsAppFab(tenant);
    definirTenantEstatistica(tenantId);
    // Menu ☰ + rodapé com contato (public-shell.js)
    montarMenuERodape(tenant, tenantIdOrSlug);
    // "Anuncie seu imóvel" vindo do menu de outra página
    if (params.get('anunciar') === '1') setTimeout(() => abrirAnunciarImovel(), 300);

    // SEO
    document.title = `${tenant.nome || 'DRG-Rently'} — Imóveis disponíveis`;
    $$('meta-desc').setAttribute('content', `Imóveis disponíveis na ${tenant.nome || 'imobiliária'}`);
    $$('og-title').setAttribute('content', `${tenant.nome || 'DRG-Rently'} — Imóveis disponíveis`);
    $$('og-desc').setAttribute('content', `Confira nossos imóveis disponíveis`);

    // Carrega imóveis + suas primeiras fotos
    _allImoveis = await Promise.all(imSnap.docs.map(async (doc) => {
      const data = { id: doc.id, ...doc.data() };
      if (data.coverUrl) return data; // vitrine já traz a capa
      try {
        const fotoSnap = await db.collection('tenants').doc(tenantId)
          .collection('imoveis').doc(doc.id).collection('fotos')
          .orderBy('ordem').limit(1).get();
        data.coverUrl = fotoSnap.empty ? null : fotoSnap.docs[0].data().url;
      } catch (_) { data.coverUrl = null; }
      return data;
    }));

    $$('vitrine-count').textContent = _allImoveis.length;

    // Configura tabs visuais (clique alterna finalidade)
    document.querySelectorAll('.vitrine-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        ativarTab(btn.dataset.tabFinalidade);
      });
    });

    // Aplica finalidade inicial vinda da URL (?finalidade=locacao|venda)
    if (finalidadeInicial === 'locacao' || finalidadeInicial === 'venda') {
      ativarTab(finalidadeInicial);
    } else {
      ativarTab(''); // todos
    }

    // Filtros
    $$('filtro-busca').addEventListener('input', applyFiltros);
    $$('filtro-tipo').addEventListener('change', applyFiltros);
    $$('filtro-quartos').addEventListener('change', applyFiltros);
    ['filtro-bairro', 'filtro-ordem'].forEach(id => $$(id).addEventListener('change', applyFiltros));
    ['filtro-preco-min', 'filtro-preco-max'].forEach(id => $$(id).addEventListener('input', applyFiltros));
    preencherBairros();
    // Filtros vindos na URL (busca da home do site próprio): b = texto, q = quartos, tipo = subtipo
    const pBusca = params.get('b') || params.get('busca') || (SUBTIPO_LABEL[params.get('tipo')] || '');
    if (pBusca) $$('filtro-busca').value = pBusca;
    if (['1', '2', '3', '4'].includes(params.get('q') || '')) $$('filtro-quartos').value = params.get('q');
    if (pBusca || params.get('q')) applyFiltros();

    $$('loading').style.display = 'none';
    $$('content').style.display = 'block';
  } catch (err) {
    console.error('Erro ao carregar vitrine:', err);
    showError('Erro ao carregar: ' + err.message);
  }
})();

function ativarTab(finalidade) {
  _finalidadeAtiva = finalidade || '';
  // Atualiza visual das tabs
  document.querySelectorAll('.vitrine-tab').forEach(btn => {
    const isActive = (btn.dataset.tabFinalidade || '') === _finalidadeAtiva;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  // Aplica classe no hero pra mudar cor/título conforme modalidade
  const hero = $$('public-hero');
  if (hero) {
    hero.classList.remove('mode-locacao', 'mode-venda', 'mode-todos');
    hero.classList.add(_finalidadeAtiva === 'locacao' ? 'mode-locacao'
      : _finalidadeAtiva === 'venda' ? 'mode-venda' : 'mode-todos');
  }

  // Atualiza textos do hero conforme tab
  const titulo = $$('hero-titulo');
  const breadcrumb = $$('hero-breadcrumb');
  if (_finalidadeAtiva === 'locacao') {
    if (titulo) titulo.textContent = '🏠 Imóveis para Alugar';
    if (breadcrumb) breadcrumb.textContent = 'Aluguel';
    document.title = `${($$('header-empresa').textContent || 'DRG-Rently')} — Imóveis para Alugar`;
  } else if (_finalidadeAtiva === 'venda') {
    if (titulo) titulo.textContent = '💼 Imóveis para Comprar';
    if (breadcrumb) breadcrumb.textContent = 'Venda';
    document.title = `${($$('header-empresa').textContent || 'DRG-Rently')} — Imóveis para Comprar`;
  } else {
    if (titulo) titulo.textContent = 'Imóveis disponíveis';
    if (breadcrumb) breadcrumb.textContent = 'Vitrine';
    document.title = `${($$('header-empresa').textContent || 'DRG-Rently')} — Imóveis disponíveis`;
  }

  if (_modoLista === 'favoritos' && titulo) titulo.textContent = '♥ Meus favoritos';
  if (_modoLista === 'recebida' && titulo) titulo.textContent = '📋 Imóveis separados para você';

  applyFiltros();
}

function applyFiltros() {
  const busca = $$('filtro-busca').value.trim().toLowerCase();
  const finalidade = _finalidadeAtiva;
  const tipo = $$('filtro-tipo').value;
  const quartosMin = parseInt($$('filtro-quartos').value, 10) || 0;
  const bairro = $$('filtro-bairro')?.value || '';
  const precoMin = parseFloat($$('filtro-preco-min')?.value) || 0;
  const precoMax = parseFloat($$('filtro-preco-max')?.value) || 0;
  const ordem = $$('filtro-ordem')?.value || '';

  const idsLista = _modoLista === 'favoritos' ? lerFavoritos() : _modoLista === 'recebida' ? _listaRecebida : null;
  const filtered = _allImoveis.filter(im => {
    if (idsLista && !idsLista.includes(im.id)) return false;
    if (tipo && im.tipo !== tipo) return false;
    if (finalidade) {
      const f = im.finalidade || 'locacao';
      // 'locacao' tab → mostra imóveis com finalidade locacao ou ambos
      // 'venda' tab → mostra imóveis com finalidade venda ou ambos
      if (finalidade === 'locacao' && f === 'venda') return false;
      if (finalidade === 'venda' && f === 'locacao') return false;
    }
    if (quartosMin && (im.quartos || 0) < quartosMin) return false;
    if (bairro && (im.endereco || {}).bairro !== bairro) return false;
    if (precoMin || precoMax) {
      const p = precoDoImovel(im, finalidade);
      if (!p) return false; // "sob consulta" não entra em faixa de preço
      if (precoMin && p < precoMin) return false;
      if (precoMax && p > precoMax) return false;
    }
    if (busca) {
      const end = im.endereco || {};
      const haystack = [im.codigoAnuncio, im.tituloAnuncio, im.apelido, im.aceitaPermuta === 'sim' ? 'permuta' : '', end.bairro, end.cidade, end.uf, SUBTIPO_LABEL[im.subtipo] || ''].join(' ').toLowerCase();
      if (!haystack.includes(busca)) return false;
    }
    return true;
  });

  if (ordem === 'menor' || ordem === 'maior') {
    const sinal = ordem === 'menor' ? 1 : -1;
    filtered.sort((a, b) => {
      const pa = precoDoImovel(a, finalidade), pb = precoDoImovel(b, finalidade);
      if (!pa) return 1; if (!pb) return -1; // sem preço no fim
      return (pa - pb) * sinal;
    });
  } else if (ordem === 'recentes') {
    const ms = x => (x.atualizadoEm && typeof x.atualizadoEm.toMillis === 'function') ? x.atualizadoEm.toMillis() : 0;
    filtered.sort((a, b) => ms(b) - ms(a));
  }

  $$('vitrine-count').textContent = filtered.length;
  renderBannerLista(filtered.length);
  renderLista(filtered);
}

// ---------- Favoritos na vitrine ----------
// Link com prévia (foto/título no WhatsApp) — ver /compartilhar no Worker do feed
function linkDaLista(ids) {
  return linkCompartilhavel({ lista: ids });
}

// Preço comparável conforme a aba: aluguel na aba Alugar, venda na aba Comprar
function precoDoImovel(im, finalidadeAba) {
  if ((im.publicacao || {}).mostrarValor === false) return 0;
  const f = im.finalidade || 'locacao';
  if (finalidadeAba === 'locacao') return im.aluguelSugerido || 0;
  if (finalidadeAba === 'venda') return im.valorVenda || 0;
  return (f === 'locacao' ? im.aluguelSugerido : im.valorVenda) || im.aluguelSugerido || 0;
}

function preencherBairros() {
  const sel = $$('filtro-bairro');
  if (!sel) return;
  const bairros = [...new Set(_allImoveis.map(im => (im.endereco || {}).bairro).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  sel.innerHTML = '<option value="">Todos os bairros</option>' + bairros.map(b => `<option>${textoSeguro(b)}</option>`).join('');
}

function renderBannerLista(qtd) {
  const el = $$('banner-lista');
  if (!el) return;
  if (!_modoLista) { el.style.display = 'none'; return; }
  const verTodos = `<button type="button" class="banner-btn" onclick="sairDoModoLista()">🏘️ Ver todos os imóveis</button>`;
  if (_modoLista === 'favoritos') {
    const n = lerFavoritos().length;
    el.innerHTML = n
      ? `<div><strong>♥ Meus favoritos (${n})</strong>
           <p>Guardados neste aparelho. Vai decidir com alguém? Envie a lista — a pessoa abre e vê os mesmos imóveis.</p></div>
         <div class="banner-acoes">
           <button type="button" class="banner-btn is-whats" onclick="enviarListaWhatsApp()">💬 Enviar lista por WhatsApp</button>
           <button type="button" class="banner-btn" onclick="copiarLinkLista(this)">🔗 Copiar link da lista</button>
           ${verTodos}
         </div>`
      : `<div><strong>♥ Meus favoritos</strong>
           <p>Você ainda não guardou nenhum imóvel. Toque no ♡ de um imóvel para ele aparecer aqui.</p></div>
         <div class="banner-acoes">${verTodos}</div>`;
  } else {
    el.innerHTML = `<div><strong>📋 Imóveis que separaram para você (${qtd})</strong>
        <p>Gostou? Guarde nos seus favoritos para ver com calma depois.</p></div>
      <div class="banner-acoes">
        <button type="button" class="banner-btn is-whats" onclick="salvarListaRecebida(this)">♥ Guardar todos nos meus favoritos</button>
        ${verTodos}
      </div>`;
  }
  el.style.display = 'flex';
}

function sairDoModoLista() {
  _modoLista = null;
  history.replaceState(null, '', `${location.pathname}?t=${encodeURIComponent(tenantIdOrSlug)}`);
  applyFiltros();
}

function enviarListaWhatsApp() {
  const ids = lerFavoritos();
  if (!ids.length) return;
  const txt = `Separei ${ids.length} imóve${ids.length > 1 ? 'is' : 'l'} para a gente ver juntos: ${linkDaLista(ids)}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank', 'noopener');
}

async function copiarLinkLista(btn) {
  const ids = lerFavoritos();
  if (!ids.length) return;
  try {
    await navigator.clipboard.writeText(linkDaLista(ids));
    mostrarAvisoPublico('✓ Link da lista copiado — cole numa conversa ou e-mail.');
  } catch (_) {
    prompt('Copie o link da lista:', linkDaLista(ids));
  }
}

function salvarListaRecebida(btn) {
  const atuais = lerFavoritos();
  const novos = _listaRecebida.filter(id => _allImoveis.some(im => im.id === id) && !atuais.includes(id));
  if (!gravarFavoritos([...novos, ...atuais])) { avisoFavoritoNaoGuardado(); return; }
  atualizarContadorFavoritos();
  btn.textContent = '✓ Guardados nos favoritos';
  btn.disabled = true;
  mostrarAvisoPublico(novos.length ? `♥ ${novos.length} imóve${novos.length > 1 ? 'is guardados' : 'l guardado'} nos seus favoritos.` : 'Esses imóveis já estavam nos seus favoritos.');
  applyFiltros();
}

function clicarFavCard(btn, id) {
  const r = alternarFavorito(id);
  if (!r.ok) { avisoFavoritoNaoGuardado(); return; }
  btn.classList.toggle('is-fav', r.favorito);
  btn.textContent = r.favorito ? '♥' : '♡';
  btn.setAttribute('aria-label', r.favorito ? 'Remover dos favoritos' : 'Guardar nos favoritos');
  mostrarAvisoPublico(r.favorito ? '♥ Guardado nos favoritos (☰ → Meus favoritos).' : 'Removido dos favoritos.');
  if (_modoLista === 'favoritos') applyFiltros();
}

function renderLista(imoveis) {
  const el = $$('lista-imoveis');
  if (imoveis.length === 0) {
    el.innerHTML = `
      <div class="vitrine-empty">
        <p>Nenhum imóvel encontrado com esses filtros.</p>
      </div>
    `;
    return;
  }

  el.innerHTML = imoveis.map(im => {
    const end = im.endereco || {};
    const pub = im.publicacao || {};
    const cidadeUf = [end.cidade, end.uf].filter(Boolean).join(' / ');
    const subt = SUBTIPO_LABEL[im.subtipo] || TIPO_LABEL[im.tipo] || '';
    const cover = im.coverUrl
      ? `<img src="${im.coverUrl}" alt="${textoSeguro(im.tituloAnuncio || im.apelido || 'Imóvel')}" loading="lazy">`
      : `<div class="vitrine-card-noimg">🏢<br><span>Sem foto</span></div>`;

    const mostrarArea = pub.mostrarArea !== false;
    const mostrarComodos = pub.mostrarComodos !== false;
    const mostrarValor = pub.mostrarValor !== false;

    const specs = [];
    if (mostrarArea && im.areaUtil) specs.push(`📐 ${im.areaUtil} m²`);
    if (mostrarComodos && im.quartos)   specs.push(`🛏 ${im.quartos}`);
    if (mostrarComodos && im.banheiros) specs.push(`🚿 ${im.banheiros}`);
    if (mostrarComodos && im.vagas)     specs.push(`🚗 ${im.vagas}`);

    const finalidade = im.finalidade || 'locacao';
    let badge = '';
    if (finalidade === 'venda')  badge = '<span class="badge-finalidade badge-venda">VENDA</span>';
    if (finalidade === 'ambos')  badge = '<span class="badge-finalidade badge-ambos">VENDA + LOCAÇÃO</span>';
    if (finalidade === 'locacao') badge = '<span class="badge-finalidade badge-locacao">LOCAÇÃO</span>';

    // Preço(s)
    let precoHtml;
    if (!mostrarValor) {
      precoHtml = `<div class="vitrine-card-price">Sob consulta</div>`;
    } else if (finalidade === 'venda') {
      precoHtml = `<div class="vitrine-card-price">${fmtBRL(im.valorVenda)}</div>`;
    } else if (finalidade === 'ambos') {
      precoHtml = `
        <div class="vitrine-card-price">${fmtBRL(im.aluguelSugerido)}<span class="price-small">/mês</span></div>
        <div class="vitrine-card-price-2">Venda: ${fmtBRL(im.valorVenda)}</div>`;
    } else {
      precoHtml = `<div class="vitrine-card-price">${fmtBRL(im.aluguelSugerido)}<span class="price-small">/mês</span></div>`;
    }

    return `
      <a class="vitrine-card" href="imovel.html?id=${im.id}&t=${tenantId}">
        <div class="vitrine-card-cover">${cover}${badge}<button type="button" class="btn-fav ${ehFavorito(im.id) ? 'is-fav' : ''}" aria-label="${ehFavorito(im.id) ? 'Remover dos favoritos' : 'Guardar nos favoritos'}" onclick="event.preventDefault(); event.stopPropagation(); clicarFavCard(this, '${im.id}')">${ehFavorito(im.id) ? '♥' : '♡'}</button>${im.aceitaPermuta === 'sim' && finalidade !== 'locacao' ? '<span class="selo-permuta">Permuta</span>' : ''}</div>
        <div class="vitrine-card-body">
          <div class="vitrine-card-tipo">${subt}${cidadeUf ? ' · ' + cidadeUf : ''}</div>
          <div class="vitrine-card-title">${textoSeguro(im.tituloAnuncio || im.apelido || 'Imóvel')}</div>
          ${im.codigoAnuncio ? `<div class="vitrine-card-codigo">Cód. ${textoSeguro(im.codigoAnuncio)}</div>` : ''}
          <div class="vitrine-card-specs">${specs.join(' · ') || ''}</div>
          ${precoHtml}
        </div>
      </a>
    `;
  }).join('');
}

// =============================================================
// WhatsApp FAB + Modal "Anuncie seu imóvel" (captação de leads)
// =============================================================

function normalizaTelefoneWhats(numero) {
  if (!numero) return null;
  const digitos = String(numero).replace(/\D/g, '');
  if (digitos.length < 10) return null;
  // Adiciona DDI 55 (Brasil) se ainda não tiver
  return digitos.startsWith('55') ? digitos : `55${digitos}`;
}

function configurarWhatsAppFab(tenant) {
  const fab = document.getElementById('whatsapp-fab');
  if (!fab) return;
  const numero = normalizaTelefoneWhats(tenant.telefone || tenant.whatsapp || '');
  if (!numero) return; // sem número configurado, não mostra
  const msg = encodeURIComponent(`Olá, ${tenant.nome || 'imobiliária'}! Vim pela vitrine de imóveis e gostaria de conversar.`);
  fab.href = `https://wa.me/${numero}?text=${msg}`;
  fab.style.display = 'flex';
}

function abrirAnunciarImovel() {
  document.getElementById('modal-anunciar').style.display = 'flex';
  document.getElementById('anun-nome').focus();
}

function fecharAnunciarImovel() {
  document.getElementById('modal-anunciar').style.display = 'none';
  const al = document.getElementById('anunciar-alert');
  if (al) al.style.display = 'none';
}

function showAnunAlert(msg, kind = 'error') {
  const el = document.getElementById('anunciar-alert');
  if (!el) return;
  el.style.background = kind === 'success' ? '#DCFCE7' : '#FEE2E2';
  el.style.color = kind === 'success' ? '#166534' : '#991B1B';
  el.style.padding = '10px 14px';
  el.style.borderRadius = '8px';
  el.style.fontSize = '13px';
  el.style.border = `1px solid ${kind === 'success' ? '#86EFAC' : '#FCA5A5'}`;
  el.innerHTML = msg;
  el.style.display = 'block';
}

async function enviarAnuncio() {
  const nome = document.getElementById('anun-nome').value.trim();
  const telefone = document.getElementById('anun-telefone').value.trim();
  const email = document.getElementById('anun-email').value.trim();
  const finalidade = document.getElementById('anun-finalidade').value;
  const tipo = document.getElementById('anun-tipo').value;
  const cidade = document.getElementById('anun-cidade').value.trim();
  const descricao = document.getElementById('anun-descricao').value.trim();

  if (!nome) return showAnunAlert('⚠️ Preencha seu nome.');
  if (!telefone) return showAnunAlert('⚠️ Preencha o WhatsApp.');
  if (!finalidade) return showAnunAlert('⚠️ Selecione se deseja alugar ou vender.');

  const tenantId = window._publicTenantId;
  if (!tenantId) return showAnunAlert('Erro: tenant não identificado.');

  const btn = document.getElementById('btn-anunciar-enviar');
  btn.disabled = true;
  btn.textContent = 'Enviando…';

  try {
    const db = firebase.firestore();
    await db.collection('tenants').doc(tenantId).collection('leadsImoveis').add({
      origem: 'vitrine_publica',
      nome,
      telefone: telefone.replace(/\D/g, ''),
      email: email || null,
      finalidade, // locacao | venda | ambos
      tipo: tipo || null,
      cidadeBairro: cidade || null,
      descricao: descricao || null,
      status: 'novo',
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      userAgent: navigator.userAgent.slice(0, 200),
      url: window.location.href,
    });

    showAnunAlert(`✅ <strong>Anúncio enviado!</strong><br>${window._publicTenantNome || 'A equipe'} vai entrar em contato pelo WhatsApp <strong>${telefone}</strong> em até 1 dia útil.`, 'success');

    // Limpa campos
    ['anun-nome', 'anun-telefone', 'anun-email', 'anun-cidade', 'anun-descricao'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('anun-finalidade').value = '';
    document.getElementById('anun-tipo').value = '';

    setTimeout(() => fecharAnunciarImovel(), 4500);
  } catch (err) {
    console.error('Erro ao enviar anúncio:', err);
    showAnunAlert('❌ Erro ao enviar: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '📤 Enviar';
  }
}

window.abrirAnunciarImovel = abrirAnunciarImovel;
window.fecharAnunciarImovel = fecharAnunciarImovel;
window.enviarAnuncio = enviarAnuncio;

// Texto do cadastro → HTML seguro (título e código vêm do anúncio)
function textoSeguro(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
