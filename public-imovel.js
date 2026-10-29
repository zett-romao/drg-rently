// =============================================================
// DRG-Rently — public-imovel.js
// Página pública de visualização de imóvel (sem login)
// URL: imovel.html?id=<imovelId>&t=<tenantId>
// =============================================================

const params = new URLSearchParams(window.location.search);
const imovelId = params.get('id');
// No site próprio da imobiliária (ex.: drglobalimoveis.com.br) o rently-site.js fixa o tenant
const tenantIdOrSlug = params.get('t') || window.RENTLY_TENANT_FIXO || null;

// Resolve slug → tenantId
async function resolveTenantId(slugOrId) {
  if (!slugOrId) return null;
  const db = firebase.firestore();
  // Tenta como ID direto primeiro (rápido se já for UID)
  try {
    const direct = await db.collection('tenants').doc(slugOrId).get();
    if (direct.exists) return slugOrId;
  } catch (_) {}
  // Tenta como slug
  try {
    const snap = await db.collection('tenants').where('slug', '==', slugOrId).limit(1).get();
    if (!snap.empty) return snap.docs[0].id;
  } catch (_) {}
  return null;
}

const $$ = (id) => document.getElementById(id);
let _imovelAtual = null;
let _tenantIdAtual = null;
let _whatsAtual = '';

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

// Lightbox: abre na foto i e navega pelas demais (setas, teclado, deslizar)
let _fotosLightbox = [];
let _fotoAtual = 0;
function openLightbox(i) {
  if (!_fotosLightbox.length) return;
  _fotoAtual = Math.max(0, Math.min(_fotosLightbox.length - 1, Number(i) || 0));
  $$('lightbox-img').src = _fotosLightbox[_fotoAtual];
  $$('lightbox-contador').textContent = `${_fotoAtual + 1} / ${_fotosLightbox.length}`;
  $$('lightbox').style.display = 'flex';
}
function navLightbox(passo) {
  if (!_fotosLightbox.length) return;
  openLightbox((_fotoAtual + passo + _fotosLightbox.length) % _fotosLightbox.length);
}
document.addEventListener('keydown', (e) => {
  if ($$('lightbox')?.style.display !== 'flex') return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowRight') navLightbox(1);
  if (e.key === 'ArrowLeft') navLightbox(-1);
});
(() => {
  let x0 = null;
  document.addEventListener('touchstart', (e) => { if (e.target.closest('#lightbox')) x0 = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) navLightbox(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

// Carrossel: setas e contador acompanham o deslizar
function moverCarrossel(passo) {
  const trilho = document.querySelector('.carrossel-trilho');
  if (trilho) trilho.scrollBy({ left: passo * trilho.clientWidth, behavior: 'smooth' });
}
function atualizarContadorCarrossel() {
  const trilho = document.querySelector('.carrossel-trilho');
  const cont = $$('carrossel-contador');
  if (!trilho || !cont) return;
  const i = Math.round(trilho.scrollLeft / Math.max(1, trilho.clientWidth));
  cont.textContent = `${i + 1} / ${trilho.children.length}`;
}

// Compartilhar: menu nativo do celular; no computador copia o link
async function compartilharImovel(btn) {
  const link = linkCompartilhavel({ id: imovelId });
  const dados = { title: document.title, text: $$('hero-apelido').textContent, url: link };
  registrarEstatistica(imovelId, 'compartilhamentos');
  try {
    if (navigator.share) { await navigator.share(dados); return; }
    await navigator.clipboard.writeText(link);
    const original = btn.textContent;
    btn.textContent = '✓ Link copiado';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2000);
  } catch (_) { /* usuário cancelou o compartilhamento */ }
}

function imprimirFicha() {
  // abre a descrição inteira antes de imprimir
  $$('descricao-texto')?.classList.remove('is-recolhida');
  window.print();
}

function alternarDescricao() {
  const el = $$('descricao-texto');
  const recolhida = el.classList.toggle('is-recolhida');
  $$('descricao-ver-mais').textContent = recolhida ? '⌄ Ver mais' : '⌃ Ver menos';
}

function closeLightbox() {
  $$('lightbox').style.display = 'none';
  $$('lightbox-img').src = '';
}
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;

const TIPO_LABEL = { residencial: 'Residencial', comercial: 'Comercial' };
const SUBTIPO_LABEL = {
  apartamento: 'Apartamento', casa: 'Casa', sobrado: 'Sobrado', kitnet: 'Kitnet',
  sala: 'Sala comercial', loja: 'Loja', galpao: 'Galpão', terreno: 'Terreno', outro: 'Imóvel'
};

// 👁 Prévia do anúncio: faixa fixa + noindex; não conta visita nem aceita lead
const _previa = params.get('previa') === '1';
if (_previa) registrarEstatistica = function () {};   // prévia não conta visita, contato nem compartilhamento
function mostrarFaixaPrevia(publicado) {
  const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex,nofollow'; document.head.appendChild(m);
  document.title = '👁 PRÉVIA — ' + document.title;
  const f = document.createElement('div');
  f.className = 'faixa-previa';
  f.innerHTML = `<strong>👁 PRÉVIA DO ANÚNCIO</strong> — é assim que ele aparece no site. ${publicado ? 'Já está publicado; esta prévia mostra a versão salva agora.' : '<u>Ainda não está publicado</u>: só quem tem o link desta prévia vê.'} <button type="button" onclick="window.close()">✕ Fechar prévia</button>`;
  document.body.prepend(f);
  document.body.classList.add('com-faixa-previa');
}

(async function init() {
  if (!imovelId || !tenantIdOrSlug) {
    showError('Link incompleto. Confira a URL.');
    return;
  }

  try {
    const db = firebase.firestore();

    const tenantId = await resolveTenantId(tenantIdOrSlug);
    if (!tenantId) { showError('Imobiliária não encontrada.'); return; }

    // Carrega imóvel + tenant em paralelo
    // vitrine/{id} = cópia pública do imóvel publicado (sem dados internos)
    let [imSnap, tSnap, fotosSnap] = await Promise.all([
      db.collection('tenants').doc(tenantId).collection('vitrine').doc(imovelId).get().catch(() => ({ exists: false })),
      db.collection('tenants').doc(tenantId).get(),
      db.collection('tenants').doc(tenantId).collection('imoveis').doc(imovelId).collection('fotos').orderBy('ordem').get(),
    ]);
    // 👁 Prévia (Rently → "Prévia"): os dados vêm do localStorage, exatamente como iriam à vitrine
    if (_previa) {
      let p = null;
      try { p = JSON.parse(localStorage.getItem(`rently-previa:${imovelId}`) || 'null'); } catch (_) {}
      if (!p || !p.dados || Date.now() - (p.em || 0) > 60 * 60 * 1000) {
        showError('Prévia expirada. Volte ao Rently e clique em 👁 Prévia de novo.'); return;
      }
      const tenant = tSnap.exists ? tSnap.data() : {};
      _imovelAtual = p.dados; _tenantIdAtual = tenantId;
      mostrarFaixaPrevia(p.publicado);
      renderImovel(p.dados, tenant, fotosSnap.docs.map(d => d.data()));
      $$('loading').style.display = 'none';
      $$('content').style.display = 'block';
      carregarSemelhantes(db, tenantId, p.dados).catch(e => console.warn('Semelhantes:', e));
      return;
    }
    if (!imSnap.exists) {
      // Fallback do modelo antigo (só enquanto a vitrine não foi gerada)
      try {
        imSnap = await db.collection('tenants').doc(tenantId).collection('imoveis').doc(imovelId).get();
      } catch (_) { showError('Este imóvel não está publicado.'); return; }
    }

    if (!imSnap.exists) { showError('Imóvel não encontrado.'); return; }
    const im = imSnap.data();
    if (im.linkPublico !== true) { showError('Este imóvel não está publicado.'); return; }

    const tenant = tSnap.exists ? tSnap.data() : {};

    _imovelAtual = im; _tenantIdAtual = tenantId;
    definirTenantEstatistica(tenantId);
    renderImovel(im, tenant, fotosSnap.docs.map(d => d.data()));
    registrarEstatistica(imovelId, 'visitas');
    $$('loading').style.display = 'none';
    $$('content').style.display = 'block';
    carregarSemelhantes(db, tenantId, im).catch(e => console.warn('Semelhantes:', e));
  } catch (err) {
    console.error('Erro ao carregar imóvel:', err);
    showError('Erro ao carregar: ' + err.message);
  }
})();

function renderImovel(im, tenant, fotos) {
  const tipoLabel = TIPO_LABEL[im.tipo] || '';
  const subtipoLabel = SUBTIPO_LABEL[im.subtipo] || tipoLabel;
  const end = im.endereco || {};
  const cidadeUf = [end.cidade, end.uf].filter(Boolean).join(' / ');
  const finalidade = im.finalidade || 'locacao';
  const pub = im.publicacao || {};
  const mostrarValor = pub.mostrarValor !== false;
  const mostrarBairro = pub.mostrarBairro !== false;
  const mostrarArea = pub.mostrarArea !== false;
  const mostrarComodos = pub.mostrarComodos !== false;

  // Header com nome da imobiliária
  $$('header-empresa').textContent = tenant.nome || 'DRG-Rently';
  $$('footer-empresa').textContent = tenant.nome || 'DRG-Rently';
  $$('ano-rodape').textContent = new Date().getFullYear();

  // Logo customizada do tenant
  if (tenant.logoUrl) {
    document.querySelectorAll('.public-logo, .error-logo').forEach(img => { img.src = tenant.logoUrl; });
    const fav = document.querySelector('link[rel="icon"]');
    if (fav) fav.href = tenant.logoUrl;
  }

  // WhatsApp FAB flutuante
  try {
    const fab = document.getElementById('whatsapp-fab');
    if (fab) {
      const numero = String(tenant.telefone || tenant.whatsapp || '').replace(/\D/g, '');
      if (numero.length >= 10) {
        const numeroComDDI = numero.startsWith('55') ? numero : `55${numero}`;
        const msg = encodeURIComponent(`Olá, ${tenant.nome || 'imobiliária'}! Tenho interesse no imóvel "${im.tituloAnuncio || im.apelido || ''}"${im.codigoAnuncio ? ` (cód. ${im.codigoAnuncio})` : ''}.`);
        fab.href = `https://wa.me/${numeroComDDI}?text=${msg}`;
        fab.style.display = 'flex';
      }
    }
  } catch (_) {}

  // Hero
  const finalidadeLabel = finalidade === 'venda' ? 'Venda' :
                          finalidade === 'ambos' ? 'Locação e venda' : 'Locação';
  $$('hero-tipo').textContent = `${subtipoLabel} · ${finalidadeLabel}`;
  $$('hero-cidade').textContent = cidadeUf || '—';
  $$('hero-apelido').textContent = im.tituloAnuncio || im.apelido || 'Imóvel';
  // Código do anúncio: o cliente cita e a imobiliária acha na busca de Imóveis
  const codEl = $$('hero-codigo');
  if (codEl) { codEl.textContent = im.codigoAnuncio ? `Cód. ${im.codigoAnuncio}` : ''; codEl.style.display = im.codigoAnuncio ? '' : 'none'; }

  // Preço(s): mostra conforme finalidade e flag mostrarValor
  const heroPriceEl = $$('hero-aluguel').parentElement;
  let priceHtml = '';
  if (finalidade === 'venda') {
    priceHtml = `<span class="muted-label">Valor de venda</span>
                 <strong>${mostrarValor ? fmtBRL(im.valorVenda) : 'Sob consulta'}</strong>`;
  } else if (finalidade === 'ambos') {
    priceHtml = `
      <div><span class="muted-label">Aluguel mensal</span>
        <strong>${mostrarValor ? fmtBRL(im.aluguelSugerido) : 'Sob consulta'}</strong></div>
      <div style="margin-left:24px;"><span class="muted-label">Valor de venda</span>
        <strong>${mostrarValor ? fmtBRL(im.valorVenda) : 'Sob consulta'}</strong></div>`;
  } else {
    priceHtml = `<span class="muted-label">Aluguel mensal a partir de</span>
                 <strong>${mostrarValor ? fmtBRL(im.aluguelSugerido) : 'Sob consulta'}</strong>`;
  }
  heroPriceEl.innerHTML = priceHtml;

  // Condomínio e IPTU mensais (só com "mostrar valor" ligado)
  const custos = [];
  if (mostrarValor && im.valorCondominio) custos.push(['Condomínio', fmtBRL(im.valorCondominio) + '/mês']);
  if (mostrarValor && im.valorIPTU) custos.push(['IPTU', fmtBRL(im.valorIPTU) + '/mês']);
  $$('hero-custos').innerHTML = custos.map(([l, v]) => `<span>${l} <strong>${v}</strong></span>`).join('');

  // Cartão "Gostou do imóvel?": todos os valores juntos
  const linhasValor = [];
  if (finalidade !== 'locacao') linhasValor.push(['Venda', mostrarValor ? fmtBRL(im.valorVenda) : 'Sob consulta', true]);
  if (finalidade !== 'venda') linhasValor.push(['Aluguel', mostrarValor ? fmtBRL(im.aluguelSugerido) + '/mês' : 'Sob consulta', true]);
  custos.forEach(([l, v]) => linhasValor.push([l, v, false]));
  $$('cartao-valores').innerHTML = linhasValor.map(([l, v, forte]) =>
    `<div class="cartao-linha ${forte ? 'is-forte' : ''}"><span>${l}</span><span>${v}</span></div>`).join('');

  // SEO meta tags
  const partsSEO = [`${subtipoLabel} para ${finalidadeLabel.toLowerCase()}`];
  if (cidadeUf) partsSEO.push(`em ${cidadeUf}`);
  if (mostrarArea && im.areaUtil) partsSEO.push(`${im.areaUtil} m²`);
  if (mostrarComodos && im.quartos) partsSEO.push(`${im.quartos} quartos`);
  const descSEO = partsSEO.join(' · ') + '.';
  document.title = `${im.tituloAnuncio || im.apelido} — ${tenant.nome || 'DRG-Rently'}`;
  $$('meta-desc').setAttribute('content', descSEO);
  $$('og-title').setAttribute('content', `${im.tituloAnuncio || im.apelido} — ${cidadeUf}`);
  $$('og-desc').setAttribute('content', descSEO);
  if (fotos.length > 0) $$('og-image').setAttribute('content', fotos[0].url);

  // Galeria
  const galeriaEl = $$('galeria');
  _fotosLightbox = fotos.map(f => f.url).filter(Boolean);
  if (fotos.length === 0) {
    galeriaEl.innerHTML = '<p class="empty">Sem fotos disponíveis no momento.</p>';
  } else {
    const seloPermuta = im.aceitaPermuta === 'sim' && finalidade !== 'locacao';
    const alt = (im.tituloAnuncio || im.apelido || 'Foto').replace(/"/g, '&quot;');
    const varias = fotos.length > 1;
    galeriaEl.innerHTML = `
      ${seloPermuta ? '<span class="selo-permuta">Permuta</span>' : ''}
      <div class="carrossel-trilho" onscroll="atualizarContadorCarrossel()">
        ${fotos.map((f, i) => `
          <div class="carrossel-slide" onclick="openLightbox(${i})">
            <img src="${f.url}" alt="${alt}${f.legenda ? ' — ' + String(f.legenda).replace(/"/g, '&quot;') : ''}" ${i ? 'loading="lazy"' : ''}>
          </div>`).join('')}
      </div>
      ${varias ? `
        <button type="button" class="carrossel-seta carrossel-ant" onclick="moverCarrossel(-1)" aria-label="Foto anterior">‹</button>
        <button type="button" class="carrossel-seta carrossel-prox" onclick="moverCarrossel(1)" aria-label="Próxima foto">›</button>` : ''}
      <span id="carrossel-contador" class="carrossel-contador">1 / ${fotos.length}</span>
      ${varias ? `<button type="button" class="btn-todas-fotos" onclick="abrirTodasFotos()">🖼 Veja todas as ${fotos.length} fotos</button>` : ''}`;
  }

  // Descrição do anúncio (texto puro; quebras de linha preservadas pelo CSS)
  const descTxt = String(im.descricaoLonga || '').trim();
  if (descTxt) {
    const el = $$('descricao-texto');
    el.textContent = descTxt;
    $$('descricao-section').style.display = 'block';
    // "Ver mais" só quando o texto passa da altura recolhida
    requestAnimationFrame(() => {
      if (el.scrollHeight <= el.clientHeight + 4) {
        el.classList.remove('is-recolhida');
        $$('descricao-ver-mais').style.display = 'none';
      }
    });
  }

  // 📍 Nas imediações: uma linha por ponto ("Escola: Nome — ~300 m (≈4 min a pé)")
  const imed = String(im.imediacoesTexto || '').split(/\n/).map((s) => s.trim()).filter(Boolean).slice(0, 30);
  if (imed.length && $$('imediacoes-section')) {
    const ul = $$('imediacoes-lista');
    ul.innerHTML = '';
    imed.forEach((linha) => {
      const li = document.createElement('li');
      const m = linha.match(/^([^:]+):\s*(.*?)\s+—\s+(.+)$/);
      if (m) {
        const cat = document.createElement('span'); cat.className = 'imed-cat-pub'; cat.textContent = m[1];
        const nome = document.createElement('strong'); nome.textContent = m[2];
        const dist = document.createElement('span'); dist.className = 'imed-dist-pub'; dist.textContent = m[3];
        li.append(cat, nome, dist);
      } else li.textContent = linha;
      ul.appendChild(li);
    });
    $$('imediacoes-section').style.display = 'block';
  }

  // Vídeo (YouTube/Vimeo) e tour 360° (Matterport embute; os demais viram botão)
  const midia = [];
  const video = urlVideoEmbed(im.videoUrl);
  if (video) midia.push(`<div class="midia-video"><iframe src="${video}" title="Vídeo do imóvel" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`);
  else if (urlSegura(im.videoUrl)) midia.push(`<a class="midia-link" href="${urlSegura(im.videoUrl)}" target="_blank" rel="noopener">🎥 Assistir ao vídeo do imóvel</a>`);
  const tour = urlSegura(im.tourUrl);
  if (tour && /matterport\.com/i.test(tour)) midia.push(`<div class="midia-video"><iframe src="${tour}" title="Tour virtual 360°" loading="lazy" allow="xr-spatial-tracking; fullscreen" allowfullscreen></iframe></div>`);
  else if (tour) midia.push(`<a class="midia-link" href="${tour}" target="_blank" rel="noopener">🌐 Abrir o tour virtual 360°</a>`);
  if (midia.length) { $$('midia-conteudo').innerHTML = midia.join(''); $$('midia-section').style.display = 'block'; }

  // Mapa da região aproximada (sem pino: nunca o ponto exato da casa)
  const geo = im.geo || {};
  if (mostrarBairro && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
    const d = 0.006; // ~650 m para cada lado
    const bbox = [geo.lng - d, geo.lat - d * 0.75, geo.lng + d, geo.lat + d * 0.75].map(n => n.toFixed(5)).join('%2C');
    $$('mapa-regiao').innerHTML = `<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik" title="Mapa da região" loading="lazy"></iframe>
      <span class="mapa-legenda">📍 Região aproximada · © OpenStreetMap</span>`;
    $$('mapa-regiao').style.display = 'block';
  }

  // Features (respeitando toggles)
  const features = [];
  if (mostrarArea && im.areaUtil)   features.push({ ico: '📐', label: 'Área útil',  val: im.areaUtil + ' m²' });
  if (mostrarArea && im.areaTotal)  features.push({ ico: '📏', label: 'Área total', val: im.areaTotal + ' m²' });
  // 📐 29/10/2026: terreno, preço do m², garagem coberta/descoberta, padrão, estado, ano, empreendimento
  if (mostrarArea && im.areaTerreno) features.push({ ico: '🌳', label: 'Terreno', val: im.areaTerreno + ' m²' + (im.medidasTerreno ? ' · ' + im.medidasTerreno : '') });
  else if (mostrarArea && im.medidasTerreno) features.push({ ico: '🌳', label: 'Terreno', val: im.medidasTerreno });
  if (mostrarArea && im.precoM2) features.push({ ico: '💲', label: 'Preço do m²', val: 'R$ ' + Number(im.precoM2).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });
  if (mostrarComodos && (im.vagasCobertas || im.vagasDescobertas)) features.push({ ico: '🅿️', label: 'Garagem', val: [im.vagasCobertas ? im.vagasCobertas + ' coberta(s)' : '', im.vagasDescobertas ? im.vagasDescobertas + ' descoberta(s)' : ''].filter(Boolean).join(' · ') });
  const PADRAO_PUB = { economico: 'Econômico', medio: 'Médio', medio_alto: 'Médio-alto', alto: 'Alto padrão', luxo: 'Luxo' };
  const ESTADO_PUB = { na_planta: 'Na planta', em_construcao: 'Em construção', novo: 'Novo', otimo: 'Ótimo estado', bom: 'Bom estado', regular: 'Regular', reformado: 'Reformado', precisa_reforma: 'Precisa de reforma' };
  if (PADRAO_PUB[im.padrao]) features.push({ ico: '⭐', label: 'Padrão', val: PADRAO_PUB[im.padrao] });
  if (ESTADO_PUB[im.estadoConservacao]) features.push({ ico: '🛠', label: 'Estado', val: ESTADO_PUB[im.estadoConservacao] });
  if (im.anoConstrucao) features.push({ ico: '📅', label: 'Construído em', val: im.anoConstrucao });
  if (im.empreendimento) features.push({ ico: '🏘', label: 'Condomínio', val: im.empreendimento });
  if (mostrarComodos && im.quartos)   features.push({ ico: '🛏', label: 'Quartos',    val: im.quartos });
  if (mostrarComodos && im.banheiros) features.push({ ico: '🚿', label: 'Banheiros',  val: im.banheiros });
  if (mostrarComodos && im.vagas)     features.push({ ico: '🚗', label: 'Vagas',      val: im.vagas });
  if (im.andar)     features.push({ ico: '🏢', label: 'Andar',      val: im.andar });
  if (im.mobiliado) {
    const mb = { sim: 'Sim', parcial: 'Parcial', nao: 'Não' }[im.mobiliado] || im.mobiliado;
    features.push({ ico: '🛋', label: 'Mobiliado', val: mb });
  }
  if (finalidade !== 'locacao') {
    if (im.aceitaFinanciamento) features.push({ ico: '🏦', label: 'Financiamento', val: im.aceitaFinanciamento === 'sim' ? 'Aceita' : 'Não aceita' });
    if (im.permiteFGTS) features.push({ ico: '💼', label: 'FGTS', val: im.permiteFGTS === 'sim' ? 'Aceita' : 'Não aceita' });
    if (im.aceitaPermuta === 'sim') features.push({ ico: '🔁', label: 'Permuta', val: im.permutaObs || 'Aceita' });
  }

  const featuresEl = $$('features-grid');
  // 🔒 29/10/2026: texto digitado (condomínio, medidas, permuta) vai ESCAPADO para a página pública
  const escP = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const caracs = Array.isArray(im.caracteristicas) ? im.caracteristicas : [];
  if (features.length === 0 && !caracs.length) {
    featuresEl.innerHTML = '<p class="muted">Informações detalhadas sob consulta.</p>';
  } else {
    featuresEl.innerHTML = features.map(f => `
      <div class="feature-card">
        <span class="ft-ico">${f.ico}</span>
        <div>
          <div class="ft-label">${escP(f.label)}</div>
          <div class="ft-value">${escP(f.val)}</div>
        </div>
      </div>
    `).join('');
  }
  // ✅ Características marcadas, por grupo (Lazer, Serviços…)
  if (caracs.length) {
    const grupos = {};
    caracs.forEach((id) => { const i = String(id).indexOf(' › '); const g = i < 0 ? 'Outras' : String(id).slice(0, i); const n = i < 0 ? String(id) : String(id).slice(i + 3); (grupos[g] = grupos[g] || []).push(n); });
    const box = document.createElement('div');
    box.className = 'carac-publica';
    box.innerHTML = Object.entries(grupos).map(([g, l]) => `<div class="carac-pub-grupo"><h4>${escP(g)}</h4><ul>${l.map((n) => `<li>✓ ${escP(n)}</li>`).join('')}</ul></div>`).join('');
    featuresEl.insertAdjacentElement('afterend', box);
  }

  // Endereço resumido (sem número exato; bairro condicional)
  const endParts = mostrarBairro ? [end.bairro, end.cidade, end.uf] : [end.cidade, end.uf];
  const endTxt = endParts.filter(Boolean).join(' · ');
  $$('endereco-publico').textContent = endTxt || 'Localização sob consulta';

  // Contato — usa dados do tenant
  const contatos = [];
  if (tenant.telefone) {
    const tel = String(tenant.telefone).replace(/\D/g, '');
    const telDDI = (tel.length >= 12 && tel.startsWith('55')) ? tel : '55' + tel; // não duplica o 55
    const wpp = `https://wa.me/${telDDI}?text=${encodeURIComponent('Olá! Tenho interesse no imóvel: ' + (im.tituloAnuncio || im.apelido || '') + (im.codigoAnuncio ? ` (cód. ${im.codigoAnuncio})` : ''))}`;
    _whatsAtual = wpp;
    contatos.push(`<a href="${wpp}" target="_blank" rel="noopener" onclick="registrarEstatistica(imovelId, 'contatos')">💬 Fale com a imobiliária</a>`);
    contatos.push(`<a href="tel:+${telDDI}" onclick="registrarEstatistica(imovelId, 'contatos')">📞 Ligar</a>`);
    const btnWhats = $$('btn-acao-whats');
    if (btnWhats) { btnWhats.href = wpp; btnWhats.style.display = ''; }
  }
  if (tenant.emailContato) {
    const subj = encodeURIComponent('Interesse no imóvel ' + (im.tituloAnuncio || im.apelido || '') + (im.codigoAnuncio ? ` — cód. ${im.codigoAnuncio}` : ''));
    contatos.push(`<a href="mailto:${tenant.emailContato}?subject=${subj}" onclick="registrarEstatistica(imovelId, 'contatos')">✉️ E-mail</a>`);
  }
  // Na ficha impressa os botões somem: telefone e e-mail por extenso
  const telImp = String(tenant.telefone || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  const telFmt = telImp.length >= 10 ? `(${telImp.slice(0, 2)}) ${telImp.slice(2, -4)}-${telImp.slice(-4)}` : '';
  const impressao = [telFmt && `📞 ${telFmt}`, tenant.emailContato && `✉️ ${tenant.emailContato}`].filter(Boolean).join('   ·   ');
  if (impressao) contatos.push(`<p class="so-impressao">${impressao.replace(/</g, '&lt;')}</p>`);
  // 🔒 Aviso contra golpes (falso corretor, Pix para pessoa física) — mesmo texto do site
  if (tenant.nome) {
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    contatos.push(`<p class="aviso-golpe-imovel">🔒 <strong>Atenção a golpes:</strong> a ${esc(tenant.nome)} nunca pede Pix, depósito ou sinal em conta de pessoa física, nem cobra para agendar visita. Pagamentos só em nome da imobiliária${tenant.cnpj ? ` (CNPJ ${esc(tenant.cnpj)})` : ''}. Fale só pelos canais desta página.</p>`);
  }
  $$('contato-actions').innerHTML = contatos.join('') ||
    '<p class="muted">Em breve a imobiliária divulgará os canais de contato.</p>';
  if (tenant.nome) {
    $$('contato-empresa').textContent = `Fale com a ${tenant.nome} para agendar visita e obter mais informações.`;
  }

  // Menu ☰ + rodapé com contato (public-shell.js)
  montarMenuERodape(tenant, tenantIdOrSlug);
  pintarBotaoFavorito();
}

function pintarBotaoFavorito() {
  const btn = $$('btn-favoritar');
  if (!btn) return;
  const fav = ehFavorito(imovelId);
  btn.textContent = fav ? '♥ Favoritado' : '♡ Favoritar';
  btn.classList.toggle('is-fav', fav);
}

function favoritarEsteImovel() {
  const r = alternarFavorito(imovelId);
  if (!r.ok) { avisoFavoritoNaoGuardado(); return; }
  pintarBotaoFavorito();
  mostrarAvisoPublico(r.favorito
    ? '♥ Guardado nos favoritos — veja em ☰ Meus favoritos e envie a lista para quem vai decidir com você.'
    : 'Removido dos favoritos.');
}

// "Veja todas as fotos": grade com todas; tocar abre em tela cheia
function abrirTodasFotos() {
  $$('todas-fotos-titulo').textContent = `${_fotosLightbox.length} foto${_fotosLightbox.length > 1 ? 's' : ''}`;
  $$('todas-fotos-grade').innerHTML = _fotosLightbox.map((u, i) =>
    `<button type="button" class="todas-fotos-item" onclick="openLightbox(${i})"><img src="${u}" alt="Foto ${i + 1}" loading="lazy"></button>`).join('');
  $$('todas-fotos').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function fecharTodasFotos() {
  $$('todas-fotos').style.display = 'none';
  document.body.style.overflow = '';
}
document.addEventListener('keydown', (e) => {
  // Esc fecha primeiro a foto em tela cheia; depois a grade
  if (e.key === 'Escape' && $$('lightbox')?.style.display !== 'flex' && $$('todas-fotos')?.style.display === 'flex') fecharTodasFotos();
});

// =============================================================
// Imóveis semelhantes: mesma finalidade, priorizando tipo, bairro,
// cidade e preço parecido. Lê a vitrine pública do mesmo tenant.
// =============================================================
async function carregarSemelhantes(db, tenantId, im) {
  const snap = await db.collection('tenants').doc(tenantId).collection('vitrine')
    .where('linkPublico', '==', true).limit(200).get();
  const fin = im.finalidade || 'locacao';
  const preco = x => (fin === 'venda' ? x.valorVenda : x.aluguelSugerido) || x.valorVenda || x.aluguelSugerido || 0;
  const p0 = preco(im);
  const end0 = im.endereco || {};
  const casaFinalidade = f => fin === 'ambos' || f === 'ambos' || f === fin;
  const lista = snap.docs
    .filter(d => d.id !== imovelId)
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(x => casaFinalidade(x.finalidade || 'locacao'))
    .map(x => {
      const e = x.endereco || {};
      let pts = 0;
      if (x.subtipo && x.subtipo === im.subtipo) pts += 3;
      if (e.bairro && e.bairro === end0.bairro) pts += 2;
      if (e.cidade && e.cidade === end0.cidade) pts += 1;
      const p = preco(x);
      if (p0 && p) pts += Math.max(0, 2 - Math.abs(p - p0) / p0 * 4); // até 2 pontos por preço próximo
      return { x, pts };
    })
    .filter(o => o.pts >= 1)
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 4);
  if (!lista.length) return;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  $$('semelhantes-grid').innerHTML = lista.map(({ x }) => {
    const e = x.endereco || {};
    const mostrar = (x.publicacao || {}).mostrarValor !== false;
    const p = preco(x);
    const valor = !mostrar ? 'Sob consulta' : p ? fmtBRL(p) + ((x.finalidade || 'locacao') === 'locacao' ? '/mês' : '') : 'A consultar';
    const local = [e.bairro, e.cidade].filter(Boolean).join(' · ');
    return `
      <a class="semelhante-card" href="imovel.html?id=${encodeURIComponent(x.id)}&t=${encodeURIComponent(tenantIdOrSlug)}">
        <div class="semelhante-capa">${x.coverUrl ? `<img src="${esc(x.coverUrl)}" alt="" loading="lazy">` : '<span>🏠</span>'}
          ${x.aceitaPermuta === 'sim' && (x.finalidade || 'locacao') !== 'locacao' ? '<span class="selo-permuta selo-mini">Permuta</span>' : ''}</div>
        <div class="semelhante-corpo">
          <strong>${esc(x.tituloAnuncio || x.apelido || SUBTIPO_LABEL[x.subtipo] || 'Imóvel')}</strong>
          ${local ? `<span class="muted">${esc(local)}</span>` : ''}
          <span class="semelhante-preco">${esc(valor)}</span>
        </div>
      </a>`;
  }).join('');
  $$('semelhantes-section').style.display = 'block';
}

// ---------- Vídeo / links ----------
function urlSegura(u) {
  try { const x = new URL(String(u || '')); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (_) { return ''; }
}
function urlVideoEmbed(u) {
  const url = urlSegura(u);
  if (!url) return '';
  const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,15})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d{5,12})/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return '';
}

// ---------- Agendar visita / Tenho interesse → Leads do sistema ----------
function abrirInteresse() {
  const im = _imovelAtual || {};
  $$('interesse-imovel').textContent = `${im.tituloAnuncio || im.apelido || 'Imóvel'}${im.codigoAnuncio ? ' · Cód. ' + im.codigoAnuncio : ''}`;
  $$('form-interesse').style.display = '';
  $$('interesse-ok').style.display = 'none';
  $$('interesse-status').style.display = 'none';
  const btn = $$('btn-interesse'); btn.disabled = false; btn.textContent = '📩 Enviar';
  $$('modal-interesse').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => $$('int-nome').focus(), 50);
}
function fecharInteresse() {
  $$('modal-interesse').style.display = 'none';
  document.body.style.overflow = '';
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $$('modal-interesse')?.style.display === 'flex') fecharInteresse();
});

async function enviarInteresse(ev) {
  ev.preventDefault();
  if (_previa) {   // prévia não gera lead de mentira
    const st = $$('interesse-status');
    st.textContent = '👁 Prévia: o formulário funciona no anúncio publicado, aqui ele não envia.';
    st.className = 'interesse-status is-erro'; st.style.display = 'block';
    return;
  }
  const btn = $$('btn-interesse');
  if (btn.disabled) return;
  const st = $$('interesse-status');
  const nome = $$('int-nome').value.trim();
  const tel = $$('int-telefone').value.replace(/\D/g, '');
  const mostrarErro = (msg) => { st.textContent = msg; st.className = 'interesse-status is-erro'; st.style.display = 'block'; };
  if (nome.length < 2) return mostrarErro('Informe seu nome.');
  if (tel.length < 10) return mostrarErro('Informe o telefone com DDD.');
  if (!$$('int-lgpd').checked) return mostrarErro('Marque a autorização de contato para enviar.');

  // Regra nº 1: trava antes do await
  btn.disabled = true;
  btn.textContent = '⏳ Enviando... aguarde';
  st.style.display = 'none';
  const im = _imovelAtual || {};
  try {
    await firebase.firestore().collection('tenants').doc(_tenantIdAtual).collection('leadsImoveis').add({
      origem: 'interesse_imovel',
      nome: nome.slice(0, 200),
      telefone: tel,
      email: $$('int-email').value.trim().slice(0, 120) || null,
      imovelId,
      codigoAnuncio: im.codigoAnuncio || null,
      tituloImovel: (im.tituloAnuncio || im.apelido || '').slice(0, 200) || null,
      finalidade: im.finalidade || null,
      melhorHorario: $$('int-horario').value,
      mensagem: $$('int-mensagem').value.trim().slice(0, 1000) || null,
      status: 'novo',
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      url: location.href.slice(0, 500),
      userAgent: navigator.userAgent.slice(0, 300),
    });
    registrarEstatistica(imovelId, 'contatos');
    // Sucesso: a tela se resolve (formulário some, confirmação aparece)
    $$('form-interesse').style.display = 'none';
    const w = $$('interesse-ok-whats');
    if (_whatsAtual) { w.href = _whatsAtual; w.style.display = ''; } else { w.style.display = 'none'; }
    $$('interesse-ok').style.display = 'block';
    $$('form-interesse').reset();
  } catch (err) {
    console.error('Erro ao enviar interesse:', err);
    mostrarErro('Não conseguimos enviar agora (' + (err.code || err.message) + '). Tente de novo ou chame no WhatsApp.');
    btn.disabled = false;
    btn.textContent = '📩 Enviar';
  }
}
