// =============================================================
// DRG-Rently — MEU SITE: motor que desenha o site da imobiliária
// =============================================================
// Lê tenants/{t}/site/publicado.config (ou, sem site publicado, o modelo padrão de
// site-padrao.js com os dados da imobiliária) e monta cabeçalho, blocos da página
// inicial, rodapé e WhatsApp. Funciona em dois lugares:
//   • rently.dev.br/site.html?t=<id ou slug>   — o site de qualquer cliente
//   • domínio próprio (ex.: drglobalimoveis.com.br) — window.RENTLY_TENANT_FIXO
// Na PRÉVIA do editor (?previa=1) desenha o que o editor mandar por postMessage.
// Páginas extras (Quem somos, Área do corretor…): ?p=<id> ou window.RENTLY_PAGINA (site próprio).
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const PREVIA = params.get('previa') === '1';
  const FIXO = window.RENTLY_TENANT_FIXO || null;
  const SITE_PROPRIO = window.RENTLY_SITE || {};
  const EXTRA = window.SITE || {};            // dados fixos do site próprio (config.js), se houver
  const FONTES_OK = ['Playfair Display', 'Lora', 'Merriweather', 'Montserrat', 'Poppins', 'Raleway', 'Inter', 'Open Sans', 'Roboto', 'Nunito', 'Lato'];
  const SUB = { apartamento: 'Apartamento', casa: 'Casa', sobrado: 'Sobrado', kitnet: 'Kitnet', sala: 'Sala comercial', loja: 'Loja', galpao: 'Galpão', terreno: 'Terreno', outro: 'Imóvel' };

  let tenantId = null, tenant = {}, slug = '', cfg = null;
  let paginaAtual = window.RENTLY_PAGINA || params.get('p') || null;
  const SISTEMA = 'https://rently.dev.br/';   // entrada do sistema (corretores e equipe)

  // ---------- endereços ----------
  const q = (extra) => (FIXO ? (extra ? '?' + extra : '') : `?t=${encodeURIComponent(slug || tenantId)}${extra ? '&' + extra : ''}`);
  const PAGINA = {
    inicio: () => (FIXO ? 'index.html' : 'site.html' + q()),
    imoveis: () => 'imoveis.html' + q(),
    'imoveis-locacao': () => 'imoveis.html' + q('finalidade=locacao'),
    'imoveis-venda': () => 'imoveis.html' + q('finalidade=venda'),
    // Área do corretor: a página do site, se estiver ligada; senão o cadastro de parceiro
    corretor: () => (paginaVisivel('corretor') ? PAGINA.pagina('corretor') : (SITE_PROPRIO.parceiro || PAGINA.parceiro())),
    parceiro: () => (FIXO ? `${SISTEMA}parceiro.html?t=${encodeURIComponent(FIXO)}` : 'parceiro.html' + q()),
    sistema: () => SISTEMA,
    pagina: (id) => (SITE_PROPRIO.paginas && SITE_PROPRIO.paginas[id])
      || (FIXO ? `index.html?p=${encodeURIComponent(id)}` : 'site.html' + q('p=' + encodeURIComponent(id))),
  };
  const paginaDe = (id) => ((cfg && cfg.paginas) || []).find((p) => p.id === id) || null;
  const paginaVisivel = (id) => { const p = paginaDe(id); return !!(p && p.visivel !== false); };
  const blocosAtuais = () => (!cfg ? [] : paginaAtual ? ((paginaDe(paginaAtual) || {}).blocos || []) : (cfg.blocos || []));
  const naHome = () => !!$('#site-blocos') && !paginaAtual;
  function link(destino) {
    const d = String(destino || '');
    if (d === 'whatsapp') return { href: wa('Olá! Vim pelo site.'), externo: true };
    if (d.startsWith('url:')) { const u = d.slice(4).trim(); return { href: /^(https?:|mailto:|tel:)/i.test(u) ? u : 'https://' + u, externo: /^https?:/i.test(u) || !/^(mailto|tel):/i.test(u) }; }
    if (d.startsWith('secao:')) { const alvo = d.slice(6); const aqui = !!$('#site-blocos') && blocosAtuais().some((b) => b.id === alvo); return { href: (aqui ? '' : PAGINA.inicio()) + '#' + alvo }; }
    if (d.startsWith('pagina:')) return { href: PAGINA.pagina(d.slice(7)) };
    if (d === 'sistema') return { href: SISTEMA, externo: true };
    if (d === 'pagina' || !PAGINA[d] || typeof PAGINA[d] !== 'function') return { href: PAGINA.inicio() };
    return { href: PAGINA[d]() };
  }
  const attrLink = (destino) => { const l = link(destino); return `href="${esc(l.href)}"${l.externo ? ' target="_blank" rel="noopener"' : ''}`; };
  const wa = (msg) => `https://wa.me/${(cfg?.contato?.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;

  // ---------- tema ----------
  function hexParaRgb(h) { const m = String(h || '').replace('#', '').match(/^([0-9a-f]{6})$/i); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function misturar(h, alvo, t) { const a = hexParaRgb(h), b = hexParaRgb(alvo); if (!a || !b) return h; return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
  function aplicarTema(c) {
    const id = c.identidade;
    const r = document.documentElement.style;
    const p = hexParaRgb(id.corPrincipal) ? id.corPrincipal : '#232653';
    const d = hexParaRgb(id.corDestaque) ? id.corDestaque : '#b29b52';
    r.setProperty('--navy', p); r.setProperty('--navy2', misturar(p, '#ffffff', 0.08));
    r.setProperty('--rodape', misturar(p, '#000000', 0.28));
    r.setProperty('--gold', d); r.setProperty('--gold2', misturar(d, '#ffffff', 0.38)); r.setProperty('--gold-escuro', misturar(d, '#000000', 0.14));
    const ft = FONTES_OK.includes(id.fonteTitulo) ? id.fonteTitulo : 'Playfair Display';
    const fx = FONTES_OK.includes(id.fonteTexto) ? id.fonteTexto : 'Inter';
    r.setProperty('--fonte-titulo', `'${ft}',Georgia,serif`);
    r.setProperty('--fonte-texto', `'${fx}',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif`);
    let l = $('#site-fontes');
    if (!l) { l = document.createElement('link'); l.id = 'site-fontes'; l.rel = 'stylesheet'; document.head.appendChild(l); }
    const fam = (f, w) => 'family=' + f.replace(/ /g, '+') + ':wght@' + w;
    l.href = `https://fonts.googleapis.com/css2?${fam(ft, '600;700;800')}&${fam(fx, '400;500;600;700')}&family=Turret+Road:wght@500&display=swap`;
  }

  // ---------- pedaços ----------
  function selo(c) {
    const id = c.identidade;
    if (id.seloImagem) return `<span class="selo"><img src="${esc(id.seloImagem)}" alt="${esc(id.seloTexto || '')}"></span>`;
    if (id.seloTexto && window.SELO_DIGITAL && /^digital$/i.test(id.seloTexto.trim())) return `<span class="selo" aria-label="${esc(id.seloTexto)}">${window.SELO_DIGITAL}</span>`;
    return id.seloTexto ? `<span class="selo-texto">${esc(id.seloTexto)}</span>` : '';
  }
  function marca(c, comLogo, comCreci) {
    const id = c.identidade;
    return `${comLogo && id.logo ? `<img src="${esc(id.logo)}" alt="${esc(id.nome)}">` : ''}<span class="brand-txt"><b>${esc(id.nome)}</b>${id.complemento ? ` ${esc(id.complemento)}` : ''}${selo(c)}${comCreci && id.creci ? `<small class="brand-creci">${esc(id.creci)}</small>` : ''}</span>`;
  }
  function cabecalho(c) {
    const ativo = (d) => (d === 'inicio' && naHome()) || (paginaAtual && (d === 'pagina:' + paginaAtual || (d === 'corretor' && paginaAtual === 'corretor')));
    const itens = (c.menu.itens || []).map((i) => `<a ${attrLink(i.destino)}${ativo(i.destino) ? ' class="on"' : ''}>${esc(i.rotulo)}</a>`).join('');
    const btn = c.menu.botaoWhatsapp && c.contato.whatsapp ? `<a class="btn btn-wa sm" target="_blank" rel="noopener" href="${esc(wa('Olá! Vim pelo site.'))}">WhatsApp</a>` : '';
    return `<div class="wrap nav"><a class="brand" ${attrLink('inicio')}>${marca(c, true, true)}</a>
      <button class="menu-btn" type="button" aria-label="Abrir menu" aria-expanded="false" onclick="const a=document.body.classList.toggle('menu-aberto');this.setAttribute('aria-expanded',a)">☰</button>
      <nav aria-label="Menu principal">${itens}${btn}</nav></div>`;
  }
  // 🔒 Aviso contra golpes (falso corretor, Pix para pessoa física): canais oficiais da imobiliária
  function textoSeguranca(c) {
    const id = c.identidade, ct = c.contato, nome = [id.nome, id.complemento].filter(Boolean).join(' ');
    if (c.seguranca && String(c.seguranca.texto || '').trim()) return esc(c.seguranca.texto.trim());
    const canais = [ct.whatsapp ? 'WhatsApp ' + esc(formatarTel(ct.whatsapp)) : '', ct.email ? esc(ct.email) : ''].filter(Boolean).join(' · ');
    return `A ${esc(nome)} nunca pede Pix, depósito ou sinal em conta de pessoa física, nem cobra para agendar visita. `
      + `Pagamentos só em nome da imobiliária${ct.cnpj ? ` (CNPJ ${esc(ct.cnpj)})` : ''}.${canais ? ` Canais oficiais: ${canais}.` : ''} Na dúvida, confirme por eles.`;
  }
  function avisoSeguranca(c) {
    if (!c.seguranca || c.seguranca.ativo === false) return '';
    return `<div class="aviso-golpe" role="note"><div class="wrap"><strong>🔒 ${esc(c.seguranca.titulo || 'Atenção a golpes')}</strong> <span>${textoSeguranca(c)}</span></div></div>`;
  }
  function rodape(c) {
    const id = c.identidade, ct = c.contato, nome = [id.nome, id.complemento].filter(Boolean).join(' ');
    const legal = c.rodape.mostrarLegal ? [ct.cnpj ? `CNPJ ${esc(ct.cnpj)}` : '', id.creci ? esc(id.creci) : ''].filter(Boolean).join(' · ') : '';
    const resp = c.rodape.mostrarLegal && ct.responsavel ? `<br>Corretor responsável: ${esc(ct.responsavel)}${ct.creciResponsavel ? ' – CRECI ' + esc(ct.creciResponsavel) : ''}` : '';
    return `${avisoSeguranca(c)}<div class="wrap foot">
      <div><div class="brand-txt">${marca(c, false, false).replace(/^<span class="brand-txt">|<\/span>$/g, '')}</div>
        <p>${esc(c.rodape.texto)}</p>${legal || resp ? `<p class="small">${legal}${resp}</p>` : ''}</div>
      <div><h4>Contato</h4><p>${ct.whatsapp ? `<a target="_blank" rel="noopener" href="${esc(wa('Olá! Vim pelo site.'))}">WhatsApp ${esc(formatarTel(ct.whatsapp))}</a><br>` : ''}${ct.email ? `<a href="mailto:${esc(ct.email)}">${esc(ct.email)}</a>` : ''}</p>
        ${ct.endereco1 || ct.endereco2 ? `<p class="small">${esc(ct.endereco1)}${ct.endereco2 ? '<br>' + esc(ct.endereco2) : ''}</p>` : ''}</div>
      <div><h4>Navegue</h4><p>${(c.menu.itens || []).filter((i) => i.destino !== 'inicio').map((i) => `<a ${attrLink(i.destino)}>${esc(i.rotulo)}</a>`).join('<br>')}</p></div>
    </div><div class="copy">© ${new Date().getFullYear()} ${esc(nome)}. Todos os direitos reservados.</div><div class="by"><em>by DR Systems</em></div>`;
  }
  function formatarTel(d) { const s = String(d).replace(/\D/g, ''); const l = s.startsWith('55') && s.length >= 12 ? s.slice(2) : s; return l.length >= 10 ? `+55 ${l.slice(0, 2)} ${l.slice(2, -4)}-${l.slice(-4)}` : s; }
  // Azul sobre a foto do topo: b.veuNivel 0–100 (Meu site → bloco Destaque). 60 = "suave", o padrão aprovado.
  function estiloVeu(b) {
    const n = Number.isFinite(Number(b.veuNivel)) && b.veuNivel !== '' ? Math.max(0, Math.min(100, Number(b.veuNivel))) : null;
    if (n === null) return '';
    const p = (v) => `color-mix(in srgb,var(--navy) ${Math.round(v)}%,transparent)`;
    return `--veu:linear-gradient(90deg,${p(55 + 0.4 * n)} 0%,${p(0.75 * n)} 50%,${p(Math.max(0, 0.9 * n - 40))} 100%);--veu-cel:${p(45 + 0.45 * n)};`;
  }
  const botao = (b, cls) => (b && b.rotulo ? `<a class="btn ${cls}" ${attrLink(b.destino)}>${esc(b.rotulo)}</a>` : '');
  const cab = (b, centro = true) => `<div class="${centro ? 'center' : ''}">${b.eyebrow ? `<div class="eyebrow">${esc(b.eyebrow)}</div>` : ''}${b.titulo ? `<h2>${esc(b.titulo)}</h2>` : ''}${b.texto ? `<p class="lead">${esc(b.texto)}</p>` : ''}</div>`;

  const BLOCO = {
    destaque: (b) => `<section class="hero veu-${esc(b.veu || 'suave')}" id="${esc(b.id)}" style="${estiloVeu(b)}--hero-img:${b.imagem ? `url('${esc(b.imagem)}')` : 'none'}"><div class="wrap">
      ${b.eyebrow ? `<div class="eyebrow">${esc(b.eyebrow)}</div>` : ''}<h1>${esc(b.titulo)}</h1>${b.texto ? `<p>${esc(b.texto)}</p>` : ''}
      <div class="ctas">${botao(b.botao1, 'btn-gold')}${botao(b.botao2, 'btn-out')}</div></div></section>`,
    busca: (b) => `<div class="wrap search" id="${esc(b.id)}"><form data-busca>
      <select name="finalidade" aria-label="Comprar ou alugar"><option value="">Comprar ou alugar</option><option value="locacao">Alugar</option><option value="venda">Comprar</option></select>
      <select name="tipo" aria-label="Tipo de imóvel"><option value="">Tipo de imóvel</option>${Object.entries(SUB).filter(([k]) => k !== 'outro').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <select name="q" aria-label="Quartos"><option value="">Quartos</option><option value="1">1+</option><option value="2">2+</option><option value="3">3+</option><option value="4">4+</option></select>
      <input name="b" placeholder="Bairro ou cidade" aria-label="Bairro ou cidade"><button class="btn btn-gold">Buscar</button></form></div>`,
    imoveis: (b) => `<section id="${esc(b.id)}"><div class="wrap">${cab(b)}
      <div class="grid" data-vitrine="${Math.max(1, Math.min(24, Number(b.quantidade) || 6))}"><div class="empty">Carregando imóveis…</div></div>
      ${b.botao ? `<p class="center" style="margin-top:30px"><a class="btn btn-gold" ${attrLink('imoveis')}>${esc(b.botao)}</a></p>` : ''}</div></section>`,
    servicos: (b) => `<section class="claro" id="${esc(b.id)}"><div class="wrap">${cab(b)}
      <div class="svc">${(b.itens || []).map((i) => `<div><div class="ic" aria-hidden="true">${esc(i.icone || '•')}</div><h3>${esc(i.titulo)}</h3><p>${esc(i.texto)}</p></div>`).join('')}</div></div></section>`,
    anuncie: (b) => `<section class="navy" id="${esc(b.id)}"><div class="wrap split">
      <div>${b.eyebrow ? `<div class="eyebrow">${esc(b.eyebrow)}</div>` : ''}<h2>${esc(b.titulo)}</h2>${b.texto ? `<p class="lead">${esc(b.texto)}</p>` : ''}
        ${(b.itens || []).length ? `<ul class="checks">${b.itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}</div>
      <form class="form" data-anuncie>
        <div class="row"><input name="nome" required maxlength="200" placeholder="Seu nome*" aria-label="Seu nome"><input name="telefone" required placeholder="WhatsApp*" aria-label="WhatsApp"></div>
        <input name="email" type="email" placeholder="E-mail" aria-label="E-mail">
        <div class="row"><select name="finalidade" required aria-label="Finalidade"><option value="">Finalidade*</option><option value="locacao">Alugar</option><option value="venda">Vender</option><option value="ambos">Alugar ou vender</option></select>
        <select name="tipo" aria-label="Tipo"><option value="">Tipo</option>${['Apartamento', 'Casa', 'Sobrado', 'Sala comercial', 'Loja', 'Galpão', 'Terreno', 'Outro'].map((t) => `<option>${t}</option>`).join('')}</select></div>
        <input name="cidadeBairro" placeholder="Bairro / cidade" aria-label="Bairro ou cidade">
        <textarea name="descricao" rows="3" maxlength="5000" placeholder="Conte um pouco sobre o imóvel" aria-label="Sobre o imóvel"></textarea>
        ${b.aviso ? `<small>${esc(b.aviso)}</small>` : ''}<button class="btn btn-gold">${esc(b.botao || 'Enviar')}</button><div data-msg role="status"></div>
      </form></div></section>`,
    corretor: (b) => `<section class="claro" id="${esc(b.id)}"><div class="wrap split">
      <div>${b.eyebrow ? `<div class="eyebrow">${esc(b.eyebrow)}</div>` : ''}<h2>${esc(b.titulo)}</h2>${b.texto ? `<p class="lead">${esc(b.texto)}</p>` : ''}</div>
      <div>${botao(b.botao, 'btn-gold')}</div></div></section>`,
    contato: (b) => { const ct = cfg.contato; return `<section id="${esc(b.id)}"><div class="wrap">${cab(b)}<div class="contact">
      ${ct.whatsapp ? `<div><h3>WhatsApp</h3><p><a target="_blank" rel="noopener" href="${esc(wa('Olá! Vim pelo site.'))}">${esc(formatarTel(ct.whatsapp))}</a></p>${b.textoWhatsapp ? `<p class="lead">${esc(b.textoWhatsapp)}</p>` : ''}</div>` : ''}
      ${ct.email ? `<div><h3>E-mail</h3><p><a href="mailto:${esc(ct.email)}">${esc(ct.email)}</a></p></div>` : ''}
      ${ct.endereco1 || ct.endereco2 ? `<div><h3>Endereço</h3><p>${esc(ct.endereco1)}${ct.endereco2 ? '<br>' + esc(ct.endereco2) : ''}</p></div>` : ''}
      </div></div></section>`; },
    texto: (b) => `<section class="${b.fundo === 'escuro' ? 'navy' : b.fundo === 'branco' ? 'claro' : ''} texto-livre" id="${esc(b.id)}"><div class="wrap ${b.imagem ? 'split' + (b.ladoImagem === 'esquerda' ? ' img-esquerda' : '') : ''}">
      <div>${b.eyebrow ? `<div class="eyebrow">${esc(b.eyebrow)}</div>` : ''}${b.titulo ? `<h2>${esc(b.titulo)}</h2>` : ''}${b.texto ? `<p class="lead">${esc(b.texto)}</p>` : ''}
        ${b.botao && b.botao.rotulo ? `<p style="margin-top:22px">${botao(b.botao, 'btn-gold')}</p>` : ''}</div>
      ${b.imagem ? `<div class="col-img"><img loading="lazy" src="${esc(b.imagem)}" alt="${esc(b.titulo || '')}"></div>` : ''}</div></section>`,
    chamada: (b) => `<section class="navy" id="${esc(b.id)}"><div class="wrap center"><h2>${esc(b.titulo)}</h2>${b.texto ? `<p class="lead">${esc(b.texto)}</p>` : ''}<p>${botao(b.botao, 'btn-gold')}</p></div></section>`,
    perguntas: (b) => `<section class="claro" id="${esc(b.id)}"><div class="wrap">${cab(b)}<div class="faq">${(b.itens || []).map((i) => `<details><summary>${esc(i.pergunta)}</summary><p>${esc(i.resposta)}</p></details>`).join('')}</div></div></section>`,
    // Área do corretor: topo com as duas portas (quero ser parceiro / já sou corretor)
    acessoCorretor: (b) => {
      const aberto = (tenant.programaParceiros || {}).ativo === true;
      return `<section class="hero hero-corretor veu-${esc(b.veu || 'suave')}" id="${esc(b.id)}" style="${estiloVeu(b)}--hero-img:${b.imagem ? `url('${esc(b.imagem)}')` : 'none'}"><div class="wrap">
      ${b.eyebrow ? `<div class="eyebrow">${esc(b.eyebrow)}</div>` : ''}<h1>${esc(b.titulo)}</h1>${b.texto ? `<p>${esc(b.texto)}</p>` : ''}
      <div class="portas">
        <div class="porta">${b.parceiroEyebrow ? `<div class="eyebrow">${esc(b.parceiroEyebrow)}</div>` : ''}<h2>${esc(b.parceiroTitulo || 'Seja corretor parceiro')}</h2><p>${esc(b.parceiroTexto || '')}</p>
          ${aberto ? `<a class="btn btn-gold" ${attrLink('parceiro')}>${esc(b.parceiroBotao || 'Cadastrar-me')}</a>` : `<div class="fechado">${esc(b.fechadoTexto || 'O cadastro de novos parceiros está fechado no momento. Fale conosco pelo WhatsApp.')}</div>`}</div>
        <div class="porta">${b.entrarEyebrow ? `<div class="eyebrow">${esc(b.entrarEyebrow)}</div>` : ''}<h2>${esc(b.entrarTitulo || 'Entrar no sistema')}</h2><p>${esc(b.entrarTexto || '')}</p>
          <a class="btn btn-gold" ${attrLink('sistema')}>${esc(b.entrarBotao || 'Entrar')}</a>${b.entrarDica ? `<p class="small">${esc(b.entrarDica)}</p>` : ''}</div>
      </div></div></section>`;
    },
    // Vantagens + divisão padrão da comissão (vem do programa de parceiros configurado no Rently)
    vantagens: (b) => {
      const pp = tenant.programaParceiros || {};
      const doPrograma = b.doPrograma !== false ? String(pp.texto || '').split(/\n/).map((s) => s.trim()).filter(Boolean) : [];
      const itens = doPrograma.length ? doPrograma : (b.itens || []);
      const cm = pp.comissao || {};
      const partes = b.mostrarDivisao === false ? [] : [['Quem captou', cm.captadorPct], ['Quem vendeu', cm.vendedorPct], ['Escritório', cm.escritorioPct]].filter((x) => Number(x[1]) > 0);
      return `<section id="${esc(b.id)}"><div class="wrap">${cab(b)}<div class="split" style="align-items:start">
        <ul class="checks checks-claro">${itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
        ${partes.length ? `<div><h3 style="margin-top:0">${esc(b.tituloDivisao || 'Divisão padrão da comissão')}</h3><p class="lead" style="margin:0">${esc(b.textoDivisao || 'Sobre a comissão de cada negócio fechado. Pode ser ajustada caso a caso.')}</p>
          <div class="divisao">${partes.map(([r, v]) => `<div><b>${Number(v)}%</b><span>${r}</span></div>`).join('')}</div></div>` : ''}</div></div></section>`;
    },
    // Passos numerados (como funciona)
    passos: (b) => `<section class="claro" id="${esc(b.id)}"><div class="wrap">${cab(b)}
      <div class="passos">${(b.itens || []).map((i) => `<div><h3>${esc(i.titulo)}</h3><p>${esc(i.texto)}</p></div>`).join('')}</div></div></section>`,
  };

  // ---------- vitrine (imóveis em destaque) ----------
  const brl = (n) => (n == null || isNaN(n) ? null : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
  function tituloIm(im) { if (im.tituloAnuncio) return im.tituloAnuncio; if (im.apelido) return im.apelido; const e = im.endereco || {}; return `${SUB[im.subtipo] || 'Imóvel'}${e.bairro ? ' – ' + e.bairro : ''}`; }
  function cardIm(im) {
    const e = im.endereco || {}, loc = [e.bairro, e.cidade && e.cidade + (e.uf ? '/' + e.uf : '')].filter(Boolean).join(' · ');
    const a = brl(im.aluguelSugerido), v = brl(im.valorVenda);
    const preco = im.finalidade === 'venda' ? (v ? `<b>${v}</b>` : '<b>Sob consulta</b>')
      : im.finalidade === 'ambos' ? ((a ? `<b>${a}</b><small>/mês</small>` : '') + (v ? `<span class="p2">Venda ${v}</span>` : '') || '<b>Sob consulta</b>')
      : (a ? `<b>${a}</b><small>/mês</small>` : '<b>Sob consulta</b>');
    const feats = [im.quartos ? `${im.quartos} quarto${im.quartos > 1 ? 's' : ''}` : null, im.banheiros ? `${im.banheiros} banh.` : null, im.vagas ? `${im.vagas} vaga${im.vagas > 1 ? 's' : ''}` : null, im.areaUtil ? `${im.areaUtil} m²` : null].filter(Boolean);
    return `<a class="card" href="imovel.html${q('id=' + encodeURIComponent(im.id))}">
      <div class="card-img">${im.coverUrl ? `<img loading="lazy" src="${esc(im.coverUrl)}" alt="${esc(tituloIm(im))}">` : '<div class="noimg">Sem foto</div>'}<span class="tag">${{ venda: 'Venda', ambos: 'Venda e locação' }[im.finalidade] || 'Locação'}</span></div>
      <div class="card-body"><h3>${esc(tituloIm(im))}</h3><p class="loc">${esc(loc)}</p><p class="feats">${feats.map(esc).join(' · ')}</p><div class="price">${preco}</div></div></a>`;
  }
  async function carregarVitrine() {
    const alvo = $('[data-vitrine]'); if (!alvo || !window.db) return;
    try {
      const snap = await db.collection('tenants').doc(tenantId).collection('vitrine').get();
      const ims = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((im) => im.status !== 'locado' && im.status !== 'vendido')
        .sort((a, b) => (b.atualizadoEm?.seconds || 0) - (a.atualizadoEm?.seconds || 0)).slice(0, Number(alvo.dataset.vitrine) || 6);
      alvo.innerHTML = ims.length ? ims.map(cardIm).join('') : '<div class="empty">Novos imóveis em breve. Fale conosco pelo WhatsApp para conhecer as opções disponíveis.</div>';
    } catch (e) { alvo.innerHTML = '<div class="empty">Não foi possível carregar os imóveis agora.</div>'; console.error(e); }
  }

  // ---------- montar ----------
  function montar(c) {
    cfg = c;
    aplicarTema(c);
    const h = $('#header'), f = $('#footer'), m = $('#site-blocos');
    if (h) h.innerHTML = cabecalho(c);
    const pg = paginaAtual ? paginaDe(paginaAtual) : null;
    const blocos = !paginaAtual ? (c.blocos || []) : (pg && (pg.visivel !== false || PREVIA) ? (pg.blocos || []) : null);
    if (m) m.innerHTML = blocos
      ? blocos.filter((b) => b.visivel !== false && BLOCO[b.tipo]).map((b) => BLOCO[b.tipo](b)).join('')
      : `<section><div class="wrap center"><h2>Página não encontrada</h2><p class="lead">Esta página não existe ou saiu do ar.</p><p><a class="btn btn-gold" ${attrLink('inicio')}>Voltar ao início</a></p></div></section>`;
    if (f) f.innerHTML = rodape(c);
    let flut = $('.wa-float');
    if (c.contato.botaoFlutuante && c.contato.whatsapp) {
      if (!flut) { flut = document.createElement('a'); flut.className = 'wa-float'; flut.target = '_blank'; flut.rel = 'noopener'; flut.setAttribute('aria-label', 'WhatsApp'); document.body.appendChild(flut); }
      flut.href = wa('Olá! Vim pelo site.');
      flut.innerHTML = '<svg viewBox="0 0 32 32" width="30" height="30" fill="#fff" aria-hidden="true"><path d="M16 3C9 3 3.3 8.6 3.3 15.6c0 2.5.7 4.9 2 7L3 29l6.6-2.2c2 1.1 4.2 1.7 6.4 1.7 7 0 12.7-5.6 12.7-12.6S23 3 16 3zm0 23.1c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1.3 1.3-3.8-.3-.4c-1.1-1.7-1.7-3.7-1.7-5.8C5.3 9.8 10.1 5.1 16 5.1s10.7 4.7 10.7 10.5S21.9 26.1 16 26.1zm5.9-7.8c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.7s1.2 3.2 1.4 3.4c.2.2 2.4 3.6 5.7 5 .8.3 1.4.5 1.9.7.8.3 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.4.2-1.5-.1-.2-.3-.3-.6-.4z"/></svg>';
    } else if (flut) flut.remove();
    // Google e WhatsApp (prévia do link)
    if (pg) {
      const nomeSite = [c.identidade.nome, c.identidade.complemento, c.identidade.seloTexto].filter(Boolean).join(' ');
      document.title = pg.seoTitulo || `${pg.titulo} – ${nomeSite}`;
      const md = $('meta[name="description"]'); if (md && (pg.seoDescricao || c.seo.descricao)) md.setAttribute('content', pg.seoDescricao || c.seo.descricao);
    }
    if (naHome()) {
      document.title = c.seo.titulo || [c.identidade.nome, c.identidade.complemento].join(' ');
      const meta = (sel, attr, val) => { let el = $(sel); if (!el) { el = document.createElement('meta'); const [k, v] = attr; el.setAttribute(k, v); document.head.appendChild(el); } el.setAttribute('content', val || ''); };
      meta('meta[name="description"]', ['name', 'description'], c.seo.descricao);
      meta('meta[property="og:title"]', ['property', 'og:title'], c.seo.titulo);
      meta('meta[property="og:description"]', ['property', 'og:description'], c.seo.descricao);
      if (c.seo.imagem) meta('meta[property="og:image"]', ['property', 'og:image'], c.seo.imagem);
    }
    ligarInteracoes();
    carregarVitrine();
    // fecha o menu do celular ao escolher um item
    document.querySelectorAll('#header nav a').forEach((a) => a.addEventListener('click', () => document.body.classList.remove('menu-aberto')));
  }

  function ligarInteracoes() {
    const busca = $('form[data-busca]');
    if (busca) busca.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const f = new FormData(busca); const ps = [...f].filter((x) => x[1]).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      location.href = 'imoveis.html' + q(ps);
    });
    const form = $('form[data-anuncie]');
    if (form) form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const msg = form.querySelector('[data-msg]'); const bt = form.querySelector('button'); const txt = bt.textContent;
      if (PREVIA) { msg.innerHTML = '<div class="ok">Prévia: no site publicado o pedido chega em Leads.</div>'; return; }
      bt.disabled = true; bt.textContent = '⏳ Enviando... aguarde'; msg.innerHTML = '';
      const d = Object.fromEntries(new FormData(form));
      try {
        await db.collection('tenants').doc(tenantId).collection('leadsImoveis').add({
          origem: 'vitrine_publica', nome: d.nome.trim(), telefone: d.telefone.trim(), email: d.email.trim() || null,
          finalidade: d.finalidade, tipo: d.tipo || null, cidadeBairro: d.cidadeBairro.trim() || null, descricao: d.descricao.trim() || null,
          status: 'novo', criadoEm: firebase.firestore.FieldValue.serverTimestamp(), userAgent: navigator.userAgent.slice(0, 200), url: location.href });
        form.reset(); msg.innerHTML = '<div class="ok">✓ Recebemos seus dados. Em breve entraremos em contato.</div>';
        bt.textContent = '✓ Enviado';
        setTimeout(() => { bt.disabled = false; bt.textContent = txt; }, 4000);
      } catch (e) {
        console.error(e); msg.innerHTML = '<div class="err">Não foi possível enviar. Fale conosco pelo WhatsApp.</div>';
        bt.disabled = false; bt.textContent = txt;
      }
    });
  }

  // ---------- início ----------
  async function resolverTenant() {
    if (FIXO) return FIXO;
    const t = params.get('t');
    if (!t) throw new Error('Endereço sem a imobiliária (?t=).');
    const direto = await db.collection('tenants').doc(t).get().catch(() => null);
    if (direto && direto.exists) return t;
    const s = await db.collection('tenants').where('slug', '==', t).limit(1).get();
    if (s.empty) throw new Error('Imobiliária não encontrada.');
    return s.docs[0].id;
  }
  async function iniciar() {
    try {
      tenantId = await resolverTenant();
      const td = await db.collection('tenants').doc(tenantId).get();
      tenant = td.exists ? td.data() : {};
      slug = tenant.slug || tenantId;
      let salvo = null;
      if (!PREVIA) {
        const pub = await db.collection('tenants').doc(tenantId).collection('site').doc('publicado').get().catch(() => null);
        salvo = pub && pub.exists ? pub.data().config : null;
      }
      montar(normalizarSiteConfig(salvo, tenant, EXTRA));
    } catch (e) {
      console.error(e);
      const m = $('#site-blocos'); if (m) m.innerHTML = `<section><div class="wrap center"><h2>Site indisponível</h2><p class="lead">${esc(e.message)}</p></div></section>`;
    }
    if (PREVIA) {
      document.body.insertAdjacentHTML('beforeend', '<div class="aviso-previa">Prévia — ainda não publicado</div>');
      window.addEventListener('message', (ev) => {
        if (ev.origin !== location.origin || !ev.data || ev.data.tipo !== 'rently-site-previa') return;
        const trocouPagina = (ev.data.pagina || null) !== paginaAtual;
        paginaAtual = ev.data.pagina || null;
        const rolagem = trocouPagina ? 0 : window.scrollY;
        montar(normalizarSiteConfig(ev.data.config, tenant, EXTRA));
        window.scrollTo(0, rolagem);
        if (ev.data.ancora) { const el = document.getElementById(ev.data.ancora); if (el) el.scrollIntoView({ block: 'start' }); }
      });
      window.parent.postMessage({ tipo: 'rently-site-pronto' }, location.origin);
    }
  }
  window.RentlySite = { montar: (c) => montar(normalizarSiteConfig(c, tenant, EXTRA)), link, textoSeguranca };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
