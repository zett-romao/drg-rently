// =============================================================
// DRG-Rently — public-imoveis.js
// Vitrine geral pública do tenant
// URL: imoveis.html?t=<tenantId>
// =============================================================

const params = new URLSearchParams(window.location.search);
const tenantIdOrSlug = params.get('t');
const finalidadeInicial = (params.get('finalidade') || '').toLowerCase();
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

    const [tSnap, imSnap] = await Promise.all([
      db.collection('tenants').doc(tenantId).get(),
      db.collection('tenants').doc(tenantId).collection('imoveis').where('linkPublico', '==', true).get(),
    ]);

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

    // SEO
    document.title = `${tenant.nome || 'DRG-Rently'} — Imóveis disponíveis`;
    $$('meta-desc').setAttribute('content', `Imóveis disponíveis para locação na ${tenant.nome || 'imobiliária'}`);
    $$('og-title').setAttribute('content', `${tenant.nome || 'DRG-Rently'} — Imóveis disponíveis`);
    $$('og-desc').setAttribute('content', `Confira nossos imóveis disponíveis para locação`);

    // Carrega imóveis + suas primeiras fotos
    _allImoveis = await Promise.all(imSnap.docs.map(async (doc) => {
      const data = { id: doc.id, ...doc.data() };
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

  applyFiltros();
}

function applyFiltros() {
  const busca = $$('filtro-busca').value.trim().toLowerCase();
  const finalidade = _finalidadeAtiva;
  const tipo = $$('filtro-tipo').value;
  const quartosMin = parseInt($$('filtro-quartos').value, 10) || 0;

  const filtered = _allImoveis.filter(im => {
    if (tipo && im.tipo !== tipo) return false;
    if (finalidade) {
      const f = im.finalidade || 'locacao';
      // 'locacao' tab → mostra imóveis com finalidade locacao ou ambos
      // 'venda' tab → mostra imóveis com finalidade venda ou ambos
      if (finalidade === 'locacao' && f === 'venda') return false;
      if (finalidade === 'venda' && f === 'locacao') return false;
    }
    if (quartosMin && (im.quartos || 0) < quartosMin) return false;
    if (busca) {
      const end = im.endereco || {};
      const haystack = [im.apelido, end.bairro, end.cidade, end.uf, SUBTIPO_LABEL[im.subtipo] || ''].join(' ').toLowerCase();
      if (!haystack.includes(busca)) return false;
    }
    return true;
  });

  $$('vitrine-count').textContent = filtered.length;
  renderLista(filtered);
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
      ? `<img src="${im.coverUrl}" alt="${(im.apelido || 'Imóvel').replace(/"/g, '&quot;')}" loading="lazy">`
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
        <div class="vitrine-card-cover">${cover}${badge}</div>
        <div class="vitrine-card-body">
          <div class="vitrine-card-tipo">${subt}${cidadeUf ? ' · ' + cidadeUf : ''}</div>
          <div class="vitrine-card-title">${im.apelido || 'Imóvel'}</div>
          <div class="vitrine-card-specs">${specs.join(' · ') || ''}</div>
          ${precoHtml}
        </div>
      </a>
    `;
  }).join('');
}
