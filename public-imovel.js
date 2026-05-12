// =============================================================
// DRG-Rently — public-imovel.js
// Página pública de visualização de imóvel (sem login)
// URL: imovel.html?id=<imovelId>&t=<tenantId>
// =============================================================

const params = new URLSearchParams(window.location.search);
const imovelId = params.get('id');
const tenantId = params.get('t');

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

function openLightbox(src) {
  $$('lightbox-img').src = src;
  $$('lightbox').style.display = 'flex';
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

(async function init() {
  if (!imovelId || !tenantId) {
    showError('Link incompleto. Confira a URL.');
    return;
  }

  try {
    const db = firebase.firestore();

    // Carrega imóvel + tenant em paralelo
    const [imSnap, tSnap, fotosSnap] = await Promise.all([
      db.collection('tenants').doc(tenantId).collection('imoveis').doc(imovelId).get(),
      db.collection('tenants').doc(tenantId).get(),
      db.collection('tenants').doc(tenantId).collection('imoveis').doc(imovelId).collection('fotos').orderBy('ordem').get(),
    ]);

    if (!imSnap.exists) { showError('Imóvel não encontrado.'); return; }
    const im = imSnap.data();
    if (im.linkPublico !== true) { showError('Este imóvel não está publicado.'); return; }

    const tenant = tSnap.exists ? tSnap.data() : {};

    renderImovel(im, tenant, fotosSnap.docs.map(d => d.data()));
    $$('loading').style.display = 'none';
    $$('content').style.display = 'block';
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

  // Hero
  const finalidadeLabel = finalidade === 'venda' ? 'Venda' :
                          finalidade === 'ambos' ? 'Locação e venda' : 'Locação';
  $$('hero-tipo').textContent = `${subtipoLabel} · ${finalidadeLabel}`;
  $$('hero-cidade').textContent = cidadeUf || '—';
  $$('hero-apelido').textContent = im.apelido || 'Imóvel';

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

  // SEO meta tags
  const partsSEO = [`${subtipoLabel} para ${finalidadeLabel.toLowerCase()}`];
  if (cidadeUf) partsSEO.push(`em ${cidadeUf}`);
  if (mostrarArea && im.areaUtil) partsSEO.push(`${im.areaUtil} m²`);
  if (mostrarComodos && im.quartos) partsSEO.push(`${im.quartos} quartos`);
  const descSEO = partsSEO.join(' · ') + '.';
  document.title = `${im.apelido} — ${tenant.nome || 'DRG-Rently'}`;
  $$('meta-desc').setAttribute('content', descSEO);
  $$('og-title').setAttribute('content', `${im.apelido} — ${cidadeUf}`);
  $$('og-desc').setAttribute('content', descSEO);
  if (fotos.length > 0) $$('og-image').setAttribute('content', fotos[0].url);

  // Galeria
  const galeriaEl = $$('galeria');
  if (fotos.length === 0) {
    galeriaEl.innerHTML = '<p class="empty">Sem fotos disponíveis no momento.</p>';
  } else {
    galeriaEl.innerHTML = fotos.map(f => `
      <div class="galeria-item" onclick="openLightbox('${f.url}')">
        <img src="${f.url}" alt="${(im.apelido || 'Foto').replace(/"/g, '&quot;')}" loading="lazy">
      </div>
    `).join('');
  }

  // Features (respeitando toggles)
  const features = [];
  if (mostrarArea && im.areaUtil)   features.push({ ico: '📐', label: 'Área útil',  val: im.areaUtil + ' m²' });
  if (mostrarArea && im.areaTotal)  features.push({ ico: '📏', label: 'Área total', val: im.areaTotal + ' m²' });
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
  }

  const featuresEl = $$('features-grid');
  if (features.length === 0) {
    featuresEl.innerHTML = '<p class="muted">Informações detalhadas sob consulta.</p>';
  } else {
    featuresEl.innerHTML = features.map(f => `
      <div class="feature-card">
        <span class="ft-ico">${f.ico}</span>
        <div>
          <div class="ft-label">${f.label}</div>
          <div class="ft-value">${f.val}</div>
        </div>
      </div>
    `).join('');
  }

  // Endereço resumido (sem número exato; bairro condicional)
  const endParts = mostrarBairro ? [end.bairro, end.cidade, end.uf] : [end.cidade, end.uf];
  const endTxt = endParts.filter(Boolean).join(' · ');
  $$('endereco-publico').textContent = endTxt || 'Localização sob consulta';

  // Contato — usa dados do tenant
  const contatos = [];
  if (tenant.telefone) {
    const tel = String(tenant.telefone).replace(/\D/g, '');
    const wpp = `https://wa.me/55${tel}?text=${encodeURIComponent('Olá! Tenho interesse no imóvel: ' + (im.apelido || ''))}`;
    contatos.push(`<a href="${wpp}" target="_blank" rel="noopener">💬 WhatsApp</a>`);
    contatos.push(`<a href="tel:+55${tel}">📞 Ligar</a>`);
  }
  if (tenant.emailContato) {
    const subj = encodeURIComponent('Interesse no imóvel ' + (im.apelido || ''));
    contatos.push(`<a href="mailto:${tenant.emailContato}?subject=${subj}">✉️ E-mail</a>`);
  }
  $$('contato-actions').innerHTML = contatos.join('') ||
    '<p class="muted">Em breve a imobiliária divulgará os canais de contato.</p>';
  if (tenant.nome) {
    $$('contato-empresa').textContent = `Fale com a ${tenant.nome} para agendar visita e obter mais informações.`;
  }
}
