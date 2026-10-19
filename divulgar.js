// =============================================================
// DRG-Rently — 📣 DIVULGAR IMÓVEL (compartilhar + peças para redes)
// =============================================================
// Pedido do dono (19/10/2026): "compartilhar imóvel em cada imóvel, pelo whats, e-mail, link…
// e um gerador de anúncios para status de WhatsApp, reels, story do Face…".
//   • 🔗 Compartilhar: link do imóvel (com prévia de foto/título pelo Worker do feed), WhatsApp,
//     e-mail, Facebook, X, Telegram, LinkedIn, copiar e o "compartilhar" do celular.
//   • 🎨 Peças: imagem Story/Status (9:16), Feed (1:1 e 4:5) e VÍDEO 9:16 (slideshow das fotos)
//     para Reels/Status, em 2 modelos, nas cores e com a logo da imobiliária; legenda pronta.
// 🔒 Blindagem: o contato impresso é SEMPRE o da imobiliária (não editável); textos digitados
// pelo corretor passam pelo temContato() (sem telefone/e-mail/@ nas peças).
// Carregado depois do rede.js (usa temContato, contatoImobiliaria) e do app.js.

let _div = null;   // { id, im, fotos:[{url,img}], logo, cores, link, publico }

const DIV_FORMATOS = {
  story: { w: 1080, h: 1920, rotulo: '📱 Story / Status (9:16)' },
  quadrado: { w: 1080, h: 1080, rotulo: '⬛ Feed quadrado (1:1)' },
  retrato: { w: 1080, h: 1350, rotulo: '▯ Feed retrato (4:5)' },
  video: { w: 1080, h: 1920, rotulo: '🎬 Vídeo Reels / Status (9:16)' },
};
const DIV_SELOS = { auto: 'Automático', venda: 'À VENDA', locacao: 'PARA ALUGAR', ambos: 'VENDA OU LOCAÇÃO', lancamento: 'LANÇAMENTO', reduzido: 'PREÇO REDUZIDO', permuta: 'ACEITA PERMUTA', novidade: 'NOVIDADE', nenhum: '— sem selo —' };

// ---------- abrir ----------
async function abrirDivulgar(id) {
  if (!id) { showAlert('imovel-alert', 'Salve o imóvel antes de divulgar.'); return; }
  _modalDiv('<p class="muted">⏳ Carregando o imóvel… aguarde</p>');
  try {
    const ref = tenantPath().collection('imoveis').doc(id);
    const [s, fs] = await Promise.all([ref.get(), ref.collection('fotos').orderBy('ordem').limit(20).get().catch(() => null)]);
    if (!s.exists) throw new Error('imóvel não encontrado');
    const im = s.data();
    let cores = { principal: '#232653', destaque: '#b29b52' };
    try {
      const pub = await db.collection('tenants').doc(State.tenant.id).collection('site').doc('publicado').get();
      const idt = pub.exists ? (pub.data().config || {}).identidade || {} : {};
      if (/^#[0-9a-f]{6}$/i.test(idt.corPrincipal || '')) cores.principal = idt.corPrincipal;
      if (/^#[0-9a-f]{6}$/i.test(idt.corDestaque || '')) cores.destaque = idt.corDestaque;
    } catch (_) {}
    _div = {
      id, im, cores, fotos: (fs ? fs.docs.map((d) => d.data()).filter((f) => f.url) : []).map((f) => ({ url: f.url, img: null })),
      logo: null, publico: !!im.linkPublico,
      link: im.linkPublico && typeof imovelLinkCompartilhavel === 'function' ? imovelLinkCompartilhavel(id) : '',
      formato: 'story', modelo: 'classico', capa: 0, selecionadas: null,
    };
    _div.selecionadas = _div.fotos.slice(0, 6).map((_, i) => i);
    _carregarFonteDiv();
    _renderDivulgar();
    _carregarImagensDiv().then(() => desenharPecaDiv()).catch(() => {});
    if (typeof logAuditoria === 'function') logAuditoria('divulgar_abrir', 'imovel', id, null);
  } catch (err) {
    _modalDiv(`<div class="alert alert-error" style="display:block">Não consegui abrir: ${escapeHtml(err.message)}</div>`);
  }
}

function _modalDiv(corpo) {
  let m = document.getElementById('modal-divulgar');
  if (!m) {
    m = document.createElement('div');
    m.className = 'modal-overlay'; m.id = 'modal-divulgar'; m.style.zIndex = '1150';
    m.addEventListener('click', (e) => { if (e.target === m) fecharDivulgar(); });
    document.body.appendChild(m);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && m.style.display === 'flex') fecharDivulgar(); });
  }
  const im = _div?.im || {};
  m.innerHTML = `<div class="modal modal-lg div-modal"><div class="modal-header">
      <h3>📣 Divulgar${im.codigoAnuncio ? ' · ' + escapeHtml(im.codigoAnuncio) : ''} <span class="muted" style="font-weight:400;font-size:14px;">${escapeHtml(im.apelido || '')}</span></h3>
      <button class="modal-close" type="button" aria-label="Fechar" onclick="fecharDivulgar()">×</button></div>
    <div class="modal-body" id="div-corpo">${corpo}</div></div>`;
  m.style.display = 'flex';
}
function fecharDivulgar() {
  const m = document.getElementById('modal-divulgar');
  if (m) m.style.display = 'none';
  if (_div?.gravando) _div.cancelarVideo = true;
}

// ---------- dados prontos ----------
const _fmtR = (n) => (n == null || isNaN(n) ? '' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
function _precoTexto(im) {
  if ((im.publicacao || {}).mostrarValor === false) return 'Consulte o valor';
  const fin = im.finalidade || 'locacao';
  const v = im.valorVenda, a = im.aluguelSugerido;
  if (fin === 'venda') return v ? _fmtR(v) : 'Consulte o valor';
  if (fin === 'ambos') return [v ? 'Venda ' + _fmtR(v) : '', a ? 'Aluguel ' + _fmtR(a) + '/mês' : ''].filter(Boolean).join(' · ') || 'Consulte o valor';
  return a ? _fmtR(a) + '/mês' : 'Consulte o valor';
}
function _destaqueTexto(im) {
  const p = [];
  if (im.quartos) p.push(`${im.quartos} ${im.quartos > 1 ? 'quartos' : 'quarto'}`);
  if (im.banheiros) p.push(`${im.banheiros} ${im.banheiros > 1 ? 'banheiros' : 'banheiro'}`);
  if (im.vagas) p.push(`${im.vagas} ${im.vagas > 1 ? 'vagas' : 'vaga'}`);
  if (im.areaUtil) p.push(`${String(im.areaUtil).replace('.', ',')} m²`);
  return p.join(' · ');
}
function _localTexto(im) {
  if ((im.publicacao || {}).mostrarBairro === false) return (im.endereco || {}).cidade || '';
  const e = im.endereco || {};
  return [e.bairro, e.cidade].filter(Boolean).join(', ');
}
function _seloAuto(im) {
  if (im.aceitaPermuta === 'sim') return DIV_SELOS.permuta;
  return DIV_SELOS[im.finalidade || 'locacao'] || '';
}
function _contatoRodape() {
  const c = typeof contatoImobiliaria === 'function' ? contatoImobiliaria() : { telefone: State.tenant?.whatsapp };
  const d = String(c.telefone || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  const tel = d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : '';
  const site = String(State.tenant?.siteProprio || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return { tel, site, nome: State.tenant?.nome || '' };
}
function _mensagemPadrao(im) {
  const titulo = im.tituloAnuncio || im.apelido || 'Imóvel';
  const linhas = [`🏡 *${titulo}*`, _localTexto(im) ? `📍 ${_localTexto(im)}` : '', _destaqueTexto(im) ? `🛏 ${_destaqueTexto(im)}` : '', `💰 ${_precoTexto(im)}`,
    _div.link ? `\n👉 Fotos e detalhes: ${_div.link}` : '', im.codigoAnuncio ? `Cód. ${im.codigoAnuncio}` : ''];
  return linhas.filter(Boolean).join('\n');
}
function _legendaPadrao(im) {
  const c = _contatoRodape();
  const tags = (Array.isArray(im.tags) ? im.tags : []).slice(0, 5);
  const hash = (s) => '#' + String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const e = im.endereco || {};
  const hashtags = ['#imoveis', '#imovel', im.finalidade === 'venda' ? '#imovelavenda' : im.finalidade === 'ambos' ? '#imovelavenda #aluguel' : '#aluguel',
    im.subtipo ? hash(im.subtipo) : '', (im.publicacao || {}).mostrarBairro !== false && e.bairro ? hash(e.bairro) : '', e.cidade ? hash(e.cidade) : ''].filter(Boolean).join(' ');
  return [
    `🏡 ${im.tituloAnuncio || im.apelido || 'Imóvel'}`, '',
    _localTexto(im) ? `📍 ${_localTexto(im)}` : '', _destaqueTexto(im) ? `🛏 ${_destaqueTexto(im)}` : '', `💰 ${_precoTexto(im)}`,
    tags.length ? '\n' + tags.map((t) => '✓ ' + String(t).replace(/-/g, ' ')).join('\n') : '', '',
    _div.link ? `👉 Veja todas as fotos: ${_div.link}` : '', c.tel ? `💬 Fale com a ${c.nome}: ${c.tel}` : '', im.codigoAnuncio ? `Cód. ${im.codigoAnuncio}` : '', '', hashtags,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').trim();
}

// ---------- tela ----------
function _renderDivulgar() {
  const im = _div.im;
  const link = _div.link;
  const enc = encodeURIComponent;
  const msg = _mensagemPadrao(im);
  const btnLink = (rotulo, href, cls = '') => link ? `<a class="btn btn-secondary btn-sm div-rede ${cls}" href="${href}" target="_blank" rel="noopener" onclick="registrarDivulgacao('${rotulo.replace(/[^\w ]/g, '').trim()}')">${rotulo}</a>` : '';
  const assunto = `${im.tituloAnuncio || im.apelido || 'Imóvel'}${im.codigoAnuncio ? ' — cód. ' + im.codigoAnuncio : ''}`;
  const c = _contatoRodape();
  const corretor = typeof isCorretor === 'function' && isCorretor();
  _modalDiv(`
    <section class="div-sec">
      <h4>🔗 Compartilhar o imóvel</h4>
      ${link ? `<div class="div-link"><input type="text" readonly id="div-link" value="${escapeHtml(link)}" aria-label="Link do imóvel">
          <button type="button" class="btn btn-primary btn-sm" onclick="copiarDiv('div-link', this)">📋 Copiar link</button></div>
        <label for="div-msg" class="div-rot">Mensagem (pode editar)</label>
        <textarea id="div-msg" rows="6">${escapeHtml(msg)}</textarea>
        <div class="div-redes">
          <a class="btn btn-sm div-rede div-wa" id="div-wa" href="https://wa.me/?text=${enc(msg)}" target="_blank" rel="noopener" onclick="this.href='https://wa.me/?text='+encodeURIComponent(document.getElementById('div-msg').value);registrarDivulgacao('WhatsApp')">💬 WhatsApp</a>
          <a class="btn btn-secondary btn-sm div-rede" href="mailto:?subject=${enc(assunto)}&body=${enc(msg.replace(/\*/g, ''))}" onclick="this.href='mailto:?subject=${enc(assunto)}&body='+encodeURIComponent(document.getElementById('div-msg').value.replace(/\\*/g,''));registrarDivulgacao('E-mail')">✉️ E-mail</a>
          ${btnLink('📘 Facebook', `https://www.facebook.com/sharer/sharer.php?u=${enc(link)}`)}
          ${btnLink('✖ X / Twitter', `https://twitter.com/intent/tweet?url=${enc(link)}&text=${enc(im.tituloAnuncio || im.apelido || '')}`)}
          ${btnLink('✈️ Telegram', `https://t.me/share/url?url=${enc(link)}&text=${enc(im.tituloAnuncio || im.apelido || '')}`)}
          ${btnLink('💼 LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${enc(link)}`)}
          ${navigator.share ? `<button type="button" class="btn btn-secondary btn-sm div-rede" onclick="compartilharNativoDiv(this)">📱 Mais opções</button>` : ''}
        </div>
        <p class="muted div-dica">No WhatsApp o link mostra a foto, o título e o valor do imóvel. Instagram não aceita link em post: use as peças abaixo (e o link na bio ou nos Stories).</p>`
      : `<div class="alert alert-info" style="display:block">🔒 O imóvel ainda <strong>não está publicado</strong> no site, então ainda não tem link para compartilhar. ${corretor ? 'Peça à imobiliária para publicar.' : 'Publique em “🌐 Página pública” no cadastro do imóvel.'} As peças abaixo já podem ser feitas.</div>`}
    </section>

    <section class="div-sec">
      <h4>🎨 Peças para redes sociais</h4>
      <div class="div-grade">
        <div class="div-controles">
          <div class="div-chips" role="group" aria-label="Formato">${Object.entries(DIV_FORMATOS).map(([k, f]) => `<button type="button" class="div-chip ${k === _div.formato ? 'on' : ''}" data-formato="${k}" onclick="formatoDiv('${k}')">${f.rotulo}</button>`).join('')}</div>
          <div class="div-chips" role="group" aria-label="Modelo">
            <button type="button" class="div-chip ${_div.modelo === 'classico' ? 'on' : ''}" data-modelo="classico" onclick="modeloDiv('classico')">🖼 Foto inteira</button>
            <button type="button" class="div-chip ${_div.modelo === 'mosaico' ? 'on' : ''}" data-modelo="mosaico" onclick="modeloDiv('mosaico')">🧩 Mosaico de fotos</button>
          </div>
          <label class="div-rot" for="div-titulo">Título</label><input type="text" id="div-titulo" maxlength="70" value="${escapeHtml(im.tituloAnuncio || im.apelido || '')}" oninput="desenharPecaDiv()">
          <label class="div-rot" for="div-destaque">Destaques</label><input type="text" id="div-destaque" maxlength="70" value="${escapeHtml(_destaqueTexto(im))}" oninput="desenharPecaDiv()">
          <div class="div-linha2">
            <div><label class="div-rot" for="div-selo">Selo</label><select id="div-selo" onchange="desenharPecaDiv()">${Object.entries(DIV_SELOS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}</select></div>
            <div><label class="div-rot"><input type="checkbox" id="div-preco" ${(im.publicacao || {}).mostrarValor === false ? '' : 'checked'} onchange="desenharPecaDiv()"> Mostrar valor</label>
              <span class="muted" style="font-size:12px;">${escapeHtml(_precoTexto(im))}</span></div>
          </div>
          <p class="muted div-dica">Rodapé fixo com o contato da imobiliária${c.tel ? `: 💬 ${escapeHtml(c.tel)}` : ''}${c.site ? ` · ${escapeHtml(c.site)}` : ''}.</p>
          ${_div.fotos.length ? `<div class="div-rot">Fotos <span class="muted" style="font-weight:400;">— clique para escolher a capa; no vídeo e no mosaico entram as marcadas, na ordem</span></div>
            <div class="div-fotos" id="div-fotos">${_div.fotos.map((f, i) => `<label class="div-foto ${i === _div.capa ? 'capa' : ''}" title="Foto ${i + 1}">
              <input type="checkbox" class="div-foto-chk" value="${i}" ${_div.selecionadas.includes(i) ? 'checked' : ''} onchange="fotosDiv()">
              <img src="${escapeHtml(f.url)}" alt="Foto ${i + 1}" loading="lazy" onclick="event.preventDefault();capaDiv(${i})"></label>`).join('')}</div>`
          : '<p class="alert alert-info" style="display:block">Este imóvel ainda não tem fotos. Envie fotos no cadastro para ter peças com imagem.</p>'}
        </div>
        <div class="div-previa">
          <canvas id="div-canvas" width="1080" height="1920" aria-label="Prévia da peça"></canvas>
          <div class="div-acoes">
            <button type="button" class="btn btn-primary btn-sm" id="btn-div-baixar" onclick="baixarPecaDiv(this)">⬇ Baixar</button>
            ${navigator.canShare ? '<button type="button" class="btn btn-secondary btn-sm" id="btn-div-enviar" onclick="enviarPecaDiv(this)">📱 Enviar (WhatsApp, Instagram…)</button>' : ''}
          </div>
          <div id="div-status"></div>
        </div>
      </div>
      <label class="div-rot" for="div-legenda">Legenda pronta (Instagram, Facebook, Status)</label>
      <textarea id="div-legenda" rows="9">${escapeHtml(_legendaPadrao(im))}</textarea>
      <button type="button" class="btn btn-secondary btn-sm" onclick="copiarDiv('div-legenda', this)">📋 Copiar legenda</button>
    </section>`);
  desenharPecaDiv();
}

function formatoDiv(f) { _div.formato = f; document.querySelectorAll('[data-formato]').forEach((b) => b.classList.toggle('on', b.dataset.formato === f)); _ajustarCanvasDiv(); desenharPecaDiv(); }
function modeloDiv(m) { _div.modelo = m; document.querySelectorAll('[data-modelo]').forEach((b) => b.classList.toggle('on', b.dataset.modelo === m)); desenharPecaDiv(); }
function capaDiv(i) { _div.capa = i; document.querySelectorAll('.div-foto').forEach((el, j) => el.classList.toggle('capa', j === i)); if (!_div.selecionadas.includes(i)) { _div.selecionadas.unshift(i); const chk = document.querySelectorAll('.div-foto-chk')[i]; if (chk) chk.checked = true; } desenharPecaDiv(); }
function fotosDiv() { _div.selecionadas = Array.from(document.querySelectorAll('.div-foto-chk:checked')).map((c) => Number(c.value)); desenharPecaDiv(); }
function _ajustarCanvasDiv() { const f = DIV_FORMATOS[_div.formato]; const cv = $('div-canvas'); if (cv) { cv.width = f.w; cv.height = f.h; } }

// ---------- imagens (fetch → blob: o canvas não fica "sujo" e dá para exportar) ----------
async function _imgDeUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('foto indisponível');
  const b = await r.blob();
  return await new Promise((res, rej) => { const u = URL.createObjectURL(b); const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagem inválida')); i.src = u; });
}
async function _carregarImagensDiv() {
  const d = _div;
  await Promise.all(d.fotos.map(async (f) => { try { f.img = await _imgDeUrl(f.url); } catch (_) {} }));
  if (State.tenant?.logoUrl) { try { d.logo = await _imgDeUrl(State.tenant.logoUrl); } catch (_) {} }
}
function _carregarFonteDiv() {
  if (!document.getElementById('div-fonte')) {
    const l = document.createElement('link'); l.id = 'div-fonte'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;800&display=swap';
    document.head.appendChild(l);
  }
  if (document.fonts) Promise.all(['500 40px Montserrat', '800 40px Montserrat', '700 40px Montserrat'].map((f) => document.fonts.load(f))).then(() => desenharPecaDiv()).catch(() => {});
}

// ---------- desenho ----------
const FONTE = (peso, px) => `${peso} ${Math.round(px)}px Montserrat, "Segoe UI", Roboto, Arial, sans-serif`;
function _cobrir(ctx, img, x, y, w, h, zoom = 1) {
  if (!img) { ctx.fillStyle = '#cbd5e1'; ctx.fillRect(x, y, w, h); return; }
  const esc = Math.max(w / img.naturalWidth, h / img.naturalHeight) * zoom;
  const iw = img.naturalWidth * esc, ih = img.naturalHeight * esc;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  ctx.restore();
}
function _ret(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function _quebrar(ctx, texto, larg, maxLinhas) {
  const pal = String(texto || '').split(/\s+/); const linhas = []; let atual = '';
  for (const p of pal) {
    const t = atual ? atual + ' ' + p : p;
    if (ctx.measureText(t).width <= larg) atual = t;
    else { if (atual) linhas.push(atual); atual = p; if (linhas.length === maxLinhas) break; }
  }
  if (atual && linhas.length < maxLinhas) linhas.push(atual);
  if (linhas.length === maxLinhas && pal.join(' ').length > linhas.join(' ').length) {
    let u = linhas[maxLinhas - 1]; while (ctx.measureText(u + '…').width > larg && u.length) u = u.slice(0, -1); linhas[maxLinhas - 1] = u + '…';
  }
  return linhas;
}
function _textosDiv() {
  const im = _div.im;
  const seloK = $('div-selo')?.value || 'auto';
  return {
    titulo: ($('div-titulo')?.value || '').trim(),
    destaque: ($('div-destaque')?.value || '').trim(),
    selo: seloK === 'auto' ? _seloAuto(im) : seloK === 'nenhum' ? '' : DIV_SELOS[seloK],
    preco: $('div-preco')?.checked ? _precoTexto(im) : '',
    local: _localTexto(im), codigo: im.codigoAnuncio || '', ...{ contato: _contatoRodape() },
  };
}
function _desenharMarca(ctx, x, y, alt, claro) {
  const d = _div; const c = _contatoRodape();
  if (d.logo) {
    const w = alt * (d.logo.naturalWidth / d.logo.naturalHeight);
    ctx.fillStyle = '#fff'; _ret(ctx, x - alt * 0.15, y - alt * 0.15, w + alt * 0.3, alt * 1.3, alt * 0.25); ctx.fill();
    ctx.drawImage(d.logo, x, y, w, alt);
  } else {
    ctx.font = FONTE(800, alt * 0.55); ctx.fillStyle = claro ? '#fff' : d.cores.principal; ctx.textBaseline = 'middle';
    ctx.fillText(c.nome, x, y + alt / 2); ctx.textBaseline = 'alphabetic';
  }
}
function _desenharRodape(ctx, W, H, y, cor) {
  const c = _contatoRodape(); const d = _div;
  const linha = [c.tel ? `💬 ${c.tel}` : '', c.site].filter(Boolean).join('   ·   ') || c.nome;
  const alt = W * 0.085;
  ctx.fillStyle = cor || d.cores.principal; _ret(ctx, W * 0.06, y, W * 0.88, alt, alt / 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = FONTE(700, W * 0.034); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(linha, W / 2, y + alt / 2, W * 0.82); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
function _desenharSelo(ctx, W, x, y, texto) {
  if (!texto) return;
  ctx.font = FONTE(800, W * 0.032);
  const w = ctx.measureText(texto).width + W * 0.06, h = W * 0.07;
  ctx.fillStyle = _div.cores.destaque; _ret(ctx, x - w, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(texto, x - w + W * 0.03, y + h / 2); ctx.textBaseline = 'alphabetic';
}

// Modelo 1 — foto inteira com faixa escura embaixo
function _pecaClassica(ctx, W, H, t, img, zoom = 1) {
  _cobrir(ctx, img, 0, 0, W, H, zoom);
  const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.45, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,.88)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const gt = ctx.createLinearGradient(0, 0, 0, H * 0.18); gt.addColorStop(0, 'rgba(0,0,0,.45)'); gt.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gt; ctx.fillRect(0, 0, W, H * 0.18);
  _desenharMarca(ctx, W * 0.06, W * 0.06, W * 0.1, true);
  _desenharSelo(ctx, W, W * 0.94, W * 0.065, t.selo);
  const m = W * 0.07, larg = W - 2 * m;
  let y = H - W * 0.06 - W * 0.085 - W * 0.05;   // acima do rodapé
  const blocos = [];
  ctx.font = FONTE(800, W * 0.066); const tl = _quebrar(ctx, t.titulo, larg, 3);
  if (t.preco) blocos.push({ f: FONTE(800, W * 0.07), cor: _div.cores.destaque, linhas: _quebrar((ctx.font = FONTE(800, W * 0.07), ctx), t.preco, larg, 2), lh: W * 0.085 });
  if (t.destaque) blocos.push({ f: FONTE(500, W * 0.04), cor: '#fff', linhas: [t.destaque], lh: W * 0.055 });
  if (t.local) blocos.push({ f: FONTE(500, W * 0.036), cor: 'rgba(255,255,255,.85)', linhas: ['📍 ' + t.local], lh: W * 0.05 });
  blocos.push({ f: FONTE(800, W * 0.066), cor: '#fff', linhas: tl, lh: W * 0.078 });
  if (t.codigo) blocos.push({ f: FONTE(700, W * 0.028), cor: _div.cores.destaque, linhas: ['CÓD. ' + t.codigo], lh: W * 0.045 });
  for (const b of blocos) {
    ctx.font = b.f; ctx.fillStyle = b.cor;
    for (let i = b.linhas.length - 1; i >= 0; i--) { ctx.fillText(b.linhas[i], m, y, larg); y -= b.lh; }
    y -= W * 0.012;
  }
  _desenharRodape(ctx, W, H, H - W * 0.06 - W * 0.085);
}

// Modelo 2 — mosaico de fotos + cartão de informações na cor da marca
function _pecaMosaico(ctx, W, H, t, imgs) {
  const d = _div;
  ctx.fillStyle = d.cores.principal; ctx.fillRect(0, 0, W, H);
  const m = W * 0.05, topo = W * 0.17, gap = W * 0.015, wl = W - 2 * m;
  _desenharMarca(ctx, m, W * 0.045, W * 0.09, true);
  _desenharSelo(ctx, W, W - m, W * 0.055, t.selo);
  // Mede o cartão ANTES: as fotos ficam com o que sobrar. Formato baixo (1:1) usa letra menor e,
  // se ainda faltar espaço, deixa a linha do bairro de fora — nada some atrás do rodapé.
  const u = H / W < 1.15 ? W * 0.86 : W;
  const pad = u * 0.05, larg = wl - 2 * pad, rod = W * 0.085;
  const medir = (comLocal) => {
    ctx.font = FONTE(800, u * 0.056); const nT = _quebrar(ctx, t.titulo, larg, 2).length;
    ctx.font = FONTE(800, u * 0.06); const nP = t.preco ? _quebrar(ctx, t.preco, larg, 2).length : 0;
    return pad * 2 + (t.codigo ? u * 0.045 : 0) + u * 0.05 + nT * u * 0.066 + (comLocal && t.local ? u * 0.05 : 0)
      + (t.destaque ? u * 0.055 : 0) + nP * u * 0.07 + u * 0.02 + rod;
  };
  let comLocal = true, altInfo = medir(true);
  if (H - topo - altInfo - m - gap * 2 < W * 0.3) { comLocal = false; altInfo = medir(false); }
  const altFotos = Math.max(W * 0.18, H - topo - altInfo - m - gap * 2);
  const [a, b, c] = [imgs[0], imgs[1] || imgs[0], imgs[2] || imgs[1] || imgs[0]];
  if (imgs.length >= 3 && altFotos > W * 0.45) {
    const hg = altFotos * 0.62;
    _ret(ctx, m, topo, wl, hg, W * 0.025); ctx.save(); ctx.clip(); _cobrir(ctx, a, m, topo, wl, hg); ctx.restore();
    const hp = altFotos - hg - gap, wp = (wl - gap) / 2;
    _ret(ctx, m, topo + hg + gap, wp, hp, W * 0.025); ctx.save(); ctx.clip(); _cobrir(ctx, b, m, topo + hg + gap, wp, hp); ctx.restore();
    _ret(ctx, m + wp + gap, topo + hg + gap, wp, hp, W * 0.025); ctx.save(); ctx.clip(); _cobrir(ctx, c, m + wp + gap, topo + hg + gap, wp, hp); ctx.restore();
  } else if (imgs.length >= 2 && altFotos <= W * 0.45) {
    const wp = (wl - gap) / 2;   // faixa baixa: duas fotos lado a lado
    _ret(ctx, m, topo, wp, altFotos, W * 0.025); ctx.save(); ctx.clip(); _cobrir(ctx, a, m, topo, wp, altFotos); ctx.restore();
    _ret(ctx, m + wp + gap, topo, wp, altFotos, W * 0.025); ctx.save(); ctx.clip(); _cobrir(ctx, b, m + wp + gap, topo, wp, altFotos); ctx.restore();
  } else {
    _ret(ctx, m, topo, wl, altFotos, W * 0.025); ctx.save(); ctx.clip(); _cobrir(ctx, a, m, topo, wl, altFotos); ctx.restore();
  }
  const yc = topo + altFotos + gap * 2, hc = H - yc - m;
  ctx.fillStyle = '#fff'; _ret(ctx, m, yc, wl, hc, W * 0.03); ctx.fill();
  let y = yc + pad + u * 0.05;
  if (t.codigo) { ctx.font = FONTE(700, u * 0.028); ctx.fillStyle = d.cores.destaque; ctx.fillText('CÓD. ' + t.codigo, m + pad, y - u * 0.012); y += u * 0.045; }
  ctx.font = FONTE(800, u * 0.056); ctx.fillStyle = d.cores.principal;
  _quebrar(ctx, t.titulo, larg, 2).forEach((l) => { ctx.fillText(l, m + pad, y, larg); y += u * 0.066; });
  ctx.font = FONTE(500, u * 0.036); ctx.fillStyle = '#475569';
  if (comLocal && t.local) { ctx.fillText('📍 ' + t.local, m + pad, y, larg); y += u * 0.05; }
  if (t.destaque) { ctx.fillText(t.destaque, m + pad, y, larg); y += u * 0.055; }
  if (t.preco) { ctx.font = FONTE(800, u * 0.06); ctx.fillStyle = d.cores.destaque; _quebrar(ctx, t.preco, larg, 2).forEach((l) => { ctx.fillText(l, m + pad, y + u * 0.01, larg); y += u * 0.07; }); }
  _desenharRodape(ctx, W, H, Math.min(yc + hc - rod - pad * 0.6, Math.max(y + u * 0.01, yc + hc - rod - pad * 0.7)), d.cores.principal);
}

function _imgsSelecionadas() {
  const d = _div;
  const ordem = [d.capa, ...d.selecionadas.filter((i) => i !== d.capa)];
  return ordem.map((i) => d.fotos[i]?.img).filter(Boolean);
}
function desenharPecaDiv(quadro) {
  const cv = $('div-canvas'); if (!cv || !_div) return;
  const f = DIV_FORMATOS[_div.formato]; if (cv.width !== f.w || cv.height !== f.h) { cv.width = f.w; cv.height = f.h; }
  const ctx = cv.getContext('2d'); const t = _textosDiv(); const imgs = _imgsSelecionadas();
  ctx.clearRect(0, 0, f.w, f.h);
  if (quadro) { quadro(ctx, f.w, f.h, t, imgs); return; }
  if (_div.modelo === 'mosaico') _pecaMosaico(ctx, f.w, f.h, t, imgs);
  else _pecaClassica(ctx, f.w, f.h, t, imgs[0] || null);
}

// ---------- validar (blindagem) ----------
function _textosOkDiv() {
  if (!(typeof isCorretor === 'function' && isCorretor()) || typeof temContato !== 'function') return true;
  const t = _textosDiv();
  if (temContato(t.titulo) || temContato(t.destaque)) {
    showInlineStatus('div-status', '🔒 Tire telefone, e-mail, link ou @perfil do título/destaques: o contato da peça é sempre o da imobiliária.', 'error', 8000);
    return false;
  }
  return true;
}

// ---------- vídeo (slideshow 9:16) ----------
async function _gravarVideoDiv(onProgresso) {
  const cv = $('div-canvas'); const imgs = _imgsSelecionadas().slice(0, 8);
  if (!imgs.length) throw new Error('marque pelo menos uma foto para o vídeo');
  if (!cv.captureStream || typeof MediaRecorder === 'undefined') throw new Error('este navegador não grava vídeo — use o Chrome ou o Edge');
  const tipos = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = tipos.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('este navegador não grava vídeo');
  const POR_FOTO = 2.8, FINAL = 2.5, FADE = 0.5;
  const total = imgs.length * POR_FOTO + FINAL;
  const stream = cv.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const partes = [];
  rec.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
  const fim = new Promise((res) => { rec.onstop = res; });
  _div.gravando = true; _div.cancelarVideo = false;
  rec.start(250);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const passo = () => {
      const s = (performance.now() - t0) / 1000;
      if (s >= total || _div.cancelarVideo) { resolve(); return; }
      const i = Math.min(imgs.length - 1, Math.floor(s / POR_FOTO));
      desenharPecaDiv((ctx, W, H, t) => {
        if (s < imgs.length * POR_FOTO) {
          const local = s - i * POR_FOTO;
          _pecaClassica(ctx, W, H, t, imgs[i], 1 + 0.08 * (local / POR_FOTO));
          if (local < FADE && i > 0) { ctx.globalAlpha = 1 - local / FADE; _pecaClassica(ctx, W, H, t, imgs[i - 1], 1.08); ctx.globalAlpha = 1; }
        } else {
          // cartão final: marca + contato
          ctx.fillStyle = _div.cores.principal; ctx.fillRect(0, 0, W, H);
          _desenharMarca(ctx, W * 0.3, H * 0.3, W * 0.16, true);
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = FONTE(800, W * 0.07);
          ctx.fillText('Agende sua visita', W / 2, H * 0.5);
          ctx.font = FONTE(500, W * 0.04); ctx.fillStyle = 'rgba(255,255,255,.85)';
          if (t.codigo) ctx.fillText('Cód. ' + t.codigo, W / 2, H * 0.56);
          ctx.textAlign = 'left';
          _desenharRodape(ctx, W, H, H * 0.64, _div.cores.destaque);
        }
      });
      onProgresso(Math.min(total, s), total);
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  });
  rec.stop(); await fim; stream.getTracks().forEach((tr) => tr.stop());
  _div.gravando = false;
  desenharPecaDiv();
  if (_div.cancelarVideo) throw new Error('gravação cancelada');
  return new Blob(partes, { type: mime.split(';')[0] });
}

// ---------- baixar / enviar ----------
async function _arquivoDaPeca(btn) {
  if (!_textosOkDiv()) return null;
  const nomeBase = `${(_div.im.codigoAnuncio || 'imovel').toLowerCase()}-${_div.formato}`;
  if (_div.formato === 'video') {
    const blob = await _gravarVideoDiv((s, tot) => { if (btn) btn.textContent = `⏳ Gravando o vídeo… ${Math.ceil(tot - s)}s`; });
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    return new File([blob], `${nomeBase}.${ext}`, { type: blob.type });
  }
  desenharPecaDiv();
  const blob = await new Promise((res, rej) => {
    try { $('div-canvas').toBlob((b) => (b ? res(b) : rej(new Error('não consegui gerar a imagem'))), 'image/jpeg', 0.92); }
    catch (e) { rej(new Error('alguma foto não pôde ser usada (bloqueio do servidor de imagens)')); }
  });
  return new File([blob], `${nomeBase}.jpg`, { type: 'image/jpeg' });
}
async function baixarPecaDiv(btn) {
  try {
    const r = await drgSubmit(btn, _div.formato === 'video' ? '⏳ Gravando o vídeo… aguarde' : '⏳ Gerando… aguarde', async () => {
      const f = await _arquivoDaPeca(btn); if (!f) return null;
      const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return f;
    }, { destravar: true });
    if (r && r !== DRG_IGNORADO) {
      showInlineStatus('div-status', `✓ ${escapeHtml(r.name)} baixado.${r.type.includes('webm') ? ' (vídeo .webm: o WhatsApp do iPhone pode não abrir — prefira enviar pelo Chrome do Android ou converter)' : ''}`, 'success', 9000);
      registrarDivulgacao('baixar ' + _div.formato);
    }
  } catch (err) { showInlineStatus('div-status', `❌ ${escapeHtml(err.message)}`, 'error'); }
}
async function enviarPecaDiv(btn) {
  try {
    const r = await drgSubmit(btn, _div.formato === 'video' ? '⏳ Gravando o vídeo… aguarde' : '⏳ Preparando… aguarde', async () => {
      const f = await _arquivoDaPeca(btn); if (!f) return null;
      if (!navigator.canShare || !navigator.canShare({ files: [f] })) throw new Error('este aparelho não envia arquivo direto — use ⬇ Baixar');
      await navigator.share({ files: [f], text: ($('div-legenda')?.value || '').slice(0, 2000) });
      return f;
    }, { destravar: true });
    if (r && r !== DRG_IGNORADO) { showInlineStatus('div-status', '✓ Enviado.', 'success', 5000); registrarDivulgacao('enviar ' + _div.formato); }
  } catch (err) {
    if (err.name === 'AbortError') return;
    showInlineStatus('div-status', `❌ ${escapeHtml(err.message)}`, 'error');
  }
}

async function compartilharNativoDiv(btn) {
  try {
    await navigator.share({ title: _div.im.tituloAnuncio || _div.im.apelido || 'Imóvel', text: $('div-msg')?.value || '', url: _div.link });
    registrarDivulgacao('nativo');
  } catch (_) { /* cancelado */ }
}
async function copiarDiv(id, btn) {
  const el = $(id); const txt = btn.textContent;
  try { await navigator.clipboard.writeText(el.value); btn.textContent = '✓ Copiado'; }
  catch (_) { el.select(); btn.textContent = 'Selecionado — Ctrl+C'; }
  setTimeout(() => { btn.textContent = txt; }, 2500);
  registrarDivulgacao('copiar ' + id.replace('div-', ''));
}
function registrarDivulgacao(canal) {
  if (typeof logAuditoria === 'function' && _div) logAuditoria('divulgar', 'imovel', _div.id, { canal });
}

window.abrirDivulgar = abrirDivulgar;
window.fecharDivulgar = fecharDivulgar;
window.formatoDiv = formatoDiv;
window.modeloDiv = modeloDiv;
window.capaDiv = capaDiv;
window.fotosDiv = fotosDiv;
window.desenharPecaDiv = desenharPecaDiv;
window.baixarPecaDiv = baixarPecaDiv;
window.enviarPecaDiv = enviarPecaDiv;
window.compartilharNativoDiv = compartilharNativoDiv;
window.copiarDiv = copiarDiv;
window.registrarDivulgacao = registrarDivulgacao;
