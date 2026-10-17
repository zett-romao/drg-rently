// =============================================================
// DRG-Rently — public-shell.js
// Menu (☰ no celular, links no computador) e rodapé com contato das
// páginas públicas (imoveis.html e imovel.html). Lê só o doc público do tenant.
// Uso: montarMenuERodape(tenant, tenantIdOrSlug) depois de carregar o tenant.
// =============================================================

function _escPub(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Telefone com ou sem 55 → { exibir: "(15) 99185-9779", ddi: "5515991859779" }
function _telefonePub(t) {
  const d = String(t || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  const local = (d.length >= 12 && d.startsWith('55')) ? d.slice(2) : d;
  return {
    exibir: `(${local.slice(0, 2)}) ${local.slice(2, -4)}-${local.slice(-4)}`,
    ddi: '55' + local,
    celular: local.length === 11,
  };
}

// ---------- Link com prévia (foto/título no WhatsApp) ----------
// O Worker do feed devolve as tags og:* do imóvel e redireciona para o site.
const URL_COMPARTILHAR = 'https://drg-rently-feed.zett-romao.workers.dev/compartilhar';
function linkCompartilhavel({ id, lista } = {}) {
  const t = encodeURIComponent(_favRef || '');
  if (id) return `${URL_COMPARTILHAR}?t=${t}&id=${encodeURIComponent(id)}`;
  if (lista && lista.length) return `${URL_COMPARTILHAR}?t=${t}&lista=${lista.map(encodeURIComponent).join(',')}`;
  return `${URL_COMPARTILHAR}?t=${t}`;
}

// ---------- Estatísticas (relatório ao proprietário) ----------
// tenants/{tid}/estatisticas/{imovelId}_{AAAA-MM}: visitas, favoritos, contatos,
// compartilhamentos. Regra do Firestore só deixa somar 1 por vez. Conta 1 vez
// por sessão do navegador (recarregar a página não infla o número).
let _estTenantId = null;
function definirTenantEstatistica(tenantId) { _estTenantId = tenantId || null; }
function registrarEstatistica(imovelId, campo) {
  if (!_estTenantId || !imovelId || !['visitas', 'favoritos', 'contatos', 'compartilhamentos'].includes(campo)) return;
  const chave = `drg-est-${imovelId}-${campo}`;
  try { if (sessionStorage.getItem(chave)) return; sessionStorage.setItem(chave, '1'); } catch (_) {}
  const mes = new Date().toISOString().slice(0, 7);
  try {
    firebase.firestore().collection('tenants').doc(_estTenantId).collection('estatisticas').doc(`${imovelId}_${mes}`)
      .set({ imovelId, mes, [campo]: firebase.firestore.FieldValue.increment(1) }, { merge: true })
      .catch(e => console.warn('Estatística não registrada:', e.message));
  } catch (_) {}
}

function mascaraTelefonePub(el) {
  const d = el.value.replace(/\D/g, '').slice(0, 11);
  el.value = d.length > 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
    : d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
    : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
}

// ---------- Favoritos ----------
// Guardados no próprio aparelho (sem conta). Para decidir junto com outra
// pessoa, a lista vira um link (imoveis.html?t=…&lista=id1,id2) enviado por WhatsApp.
let _favRef = '';
function _chaveFav() { return 'drg-favoritos-' + _favRef; }
function lerFavoritos() {
  try {
    const a = JSON.parse(localStorage.getItem(_chaveFav()) || '[]');
    return Array.isArray(a) ? a.filter(x => typeof x === 'string' && x) : [];
  } catch (_) { return []; }
}
function gravarFavoritos(lista) {
  try { localStorage.setItem(_chaveFav(), JSON.stringify(lista)); return true; } catch (_) { return false; }
}
function ehFavorito(id) { return lerFavoritos().includes(id); }
// Liga/desliga. Retorna { favorito, ok } — ok=false quando o navegador não deixa guardar
function alternarFavorito(id) {
  const lista = lerFavoritos();
  const i = lista.indexOf(id);
  if (i >= 0) lista.splice(i, 1); else lista.unshift(id);
  const ok = gravarFavoritos(lista);
  atualizarContadorFavoritos();
  if (ok && i < 0) registrarEstatistica(id, 'favoritos');
  return { favorito: i < 0, ok };
}
function atualizarContadorFavoritos() {
  const n = lerFavoritos().length;
  document.querySelectorAll('.contador-fav').forEach(el => { el.textContent = n ? n : ''; el.style.display = n ? '' : 'none'; });
}
function avisoFavoritoNaoGuardado() {
  mostrarAvisoPublico('⚠️ Este navegador não deixou guardar (aba anônima?). Use "Compartilhar" para enviar o imóvel para você mesmo.', 'erro');
}

// Aviso rápido no rodapé da tela (regra nº 1: toda ação responde)
function mostrarAvisoPublico(msg, tipo) {
  let el = document.getElementById('aviso-publico');
  if (!el) {
    el = document.createElement('div');
    el.id = 'aviso-publico';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.className = 'aviso-publico' + (tipo === 'erro' ? ' is-erro' : '');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

function montarMenuERodape(tenant, tenantRef) {
  tenant = tenant || {};
  _favRef = String(tenantRef || '');
  const t = encodeURIComponent(tenantRef || '');
  const naVitrine = /imoveis\.html$/.test(location.pathname) || !!document.getElementById('lista-imoveis');
  const anunciar = naVitrine && typeof abrirAnunciarImovel === 'function'
    ? `href="#" onclick="fecharMenuPublico(); abrirAnunciarImovel(); return false;"`
    : `href="imoveis.html?t=${t}&anunciar=1"`;
  // Site próprio (rently-site.js): "Início" é a página institucional e a vitrine vira "Imóveis"
  const siteProprio = window.RENTLY_SITE || null;
  const links = [
    ...(siteProprio && siteProprio.inicio ? [['🏠', 'Início', `href="${siteProprio.inicio}"`]] : []),
    ['🏘', siteProprio ? 'Imóveis' : 'Início', `href="imoveis.html?t=${t}"`],
    ['🔑', 'Alugar', `href="imoveis.html?t=${t}&finalidade=locacao"`],
    ['💼', 'Comprar', `href="imoveis.html?t=${t}&finalidade=venda"`],
    ['♥', 'Meus favoritos <span class="contador-fav"></span>', `href="imoveis.html?t=${t}&favoritos=1"`],
    ['📤', 'Anuncie seu imóvel', anunciar],
  ];
  if (tenant.programaParceiros && tenant.programaParceiros.ativo) links.push(['🤝', 'Seja corretor parceiro', `href="${(siteProprio && siteProprio.parceiro) || 'parceiro.html'}?t=${t}"`]);
  links.push(['📞', 'Contato', `href="#rodape-contato" onclick="fecharMenuPublico()"`]);

  // ---- Menu no cabeçalho ----
  const header = document.querySelector('.public-header-inner');
  if (header && !document.getElementById('menu-publico')) {
    header.insertAdjacentHTML('beforeend', `
      <nav class="nav-publica" aria-label="Menu">
        ${links.filter(([, txt]) => !(txt === 'Anuncie seu imóvel' && header.querySelector('.btn-anunciar-imovel')))
          .map(([, txt, attr]) => `<a ${attr}>${txt}</a>`).join('')}
      </nav>
      <button type="button" class="btn-menu-publico" onclick="abrirMenuPublico()" aria-label="Abrir menu">☰</button>`);
    document.body.insertAdjacentHTML('beforeend', `
      <div id="menu-publico" class="menu-publico" onclick="if (event.target === this) fecharMenuPublico()">
        <div class="menu-publico-painel" role="dialog" aria-label="Menu">
          <button type="button" class="menu-publico-x" onclick="fecharMenuPublico()" aria-label="Fechar menu">×</button>
          ${links.map(([ico, txt, attr]) => `<a class="menu-publico-item" ${attr}><span>${ico}</span>${txt}</a>`).join('')}
        </div>
      </div>`);
  }

  // ---- Rodapé com contato ----
  const footer = document.querySelector('.public-footer .public-container');
  if (footer) {
    const tel = _telefonePub(tenant.telefone);
    // mesmo número do botão verde do WhatsApp (fixo também pode ser WhatsApp Business)
    const whats = _telefonePub(tenant.whatsapp) || tel;
    const contato = [
      tenant.creci ? `<p class="muted">CRECI ${_escPub(tenant.creci)}</p>` : '',
      whats ? `<p><a href="https://wa.me/${whats.ddi}" target="_blank" rel="noopener">💬 ${whats.exibir} (WhatsApp)</a></p>` : '',
      tel && (!whats || tel.ddi !== whats.ddi) ? `<p><a href="tel:+${tel.ddi}">📞 ${tel.exibir}</a></p>` : '',
      tel && whats && tel.ddi === whats.ddi ? `<p><a href="tel:+${tel.ddi}">📞 Ligar</a></p>` : '',
      tenant.emailContato ? `<p><a href="mailto:${_escPub(tenant.emailContato)}">✉️ ${_escPub(tenant.emailContato)}</a></p>` : '',
    ].join('');
    footer.innerHTML = `
      <div class="rodape-colunas">
        <div id="rodape-contato">
          <h4>${_escPub(tenant.nome || 'Contato')}</h4>
          ${contato || '<p class="muted">Contato em breve.</p>'}
        </div>
        <div>
          <h4>Navegue</h4>
          ${links.filter(([, txt]) => txt !== 'Contato').map(([, txt, attr]) => `<p><a ${attr}>${txt.replace(/<span[^>]*><\/span>/, '')}</a></p>`).join('')}
        </div>
      </div>
      <p class="rodape-copy">© ${new Date().getFullYear()} ${_escPub(tenant.nome || 'DRG-Rently')} · Todos os direitos reservados</p>
      <p class="muted rodape-copy" style="font-size:11px;">Powered by <a href="https://github.com/zett-romao/drg-rently" target="_blank" rel="noopener">DRG-Rently</a></p>`;
  }
  aplicarSeloMarca(tenant);
  atualizarContadorFavoritos();
}

// Site próprio (rently-site.js) pode pôr um SELO ao lado do nome da empresa — ex.: o
// "digital" desenhado da D.R. Global. RENTLY_SITE.selo = SVG (usa currentColor; a cor vem
// do tema do site); RENTLY_SITE.seloTexto = como o selo se lê (entra no título da aba).
function aplicarSeloMarca(tenant) {
  const site = window.RENTLY_SITE || {};
  if (!site.selo) return;
  const selo = () => {
    const s = document.createElement('span');
    s.className = 'selo-marca';
    s.innerHTML = site.selo;
    if (site.seloTexto) s.insertAdjacentHTML('beforeend', `<span class="sr-only"> ${_escPub(site.seloTexto)}</span>`);
    return s;
  };
  ['header-empresa'].map((id) => document.getElementById(id))
    .concat([...document.querySelectorAll('#rodape-contato h4')])
    .forEach((el) => { if (el && !el.querySelector('.selo-marca')) el.appendChild(selo()); });
  // Título da aba: "D.R. Global Imóveis — …" → "D.R. Global Imóveis Digital — …"
  const nome = tenant && tenant.nome;
  if (nome && site.seloTexto) {
    const ajustar = () => {
      const marca = `${nome} ${site.seloTexto}`;
      if (document.title.includes(nome) && !document.title.includes(marca)) document.title = document.title.replace(nome, marca);
    };
    ajustar();
    const t = document.querySelector('title');
    if (t && !t._seloObservado) { t._seloObservado = true; new MutationObserver(ajustar).observe(t, { childList: true }); }
  }
}

function abrirMenuPublico() { atualizarContadorFavoritos(); document.body.classList.add('menu-publico-aberto'); }
function fecharMenuPublico() { document.body.classList.remove('menu-publico-aberto'); }
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('menu-publico-aberto')) fecharMenuPublico();
});
