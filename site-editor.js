// =============================================================
// DRG-Rently — 🌐 MEU SITE (construtor do site da imobiliária)
// =============================================================
// Carregado DEPOIS do app.js. Dono (17/10/2026): "crie um painel onde eu possa editar todos
// os itens, texto, imagens deste site… algo semelhante a um construtor de sites dentro do
// rently" — pensado para TODOS os clientes; editar e publicar são permissões que o gestor
// delega em Equipe e permissões (módulo "Meu site" e ação "🚀 Publicar o site").
//
// Blocos prontos com campos editáveis (não é editor livre): o desenho continua harmônico
// e funcionando no celular. Rascunho salvo sozinho; prévia ao vivo (site.html?previa=1,
// por postMessage); Publicar grava site/publicado + uma versão no histórico.
//   tenants/{t}/site/rascunho   { config, atualizadoEm, atualizadoPor }
//   tenants/{t}/site/publicado  { config, publicadoEm, publicadoPor, publicadoPorNome }  ← o site lê
//   tenants/{t}/siteVersoes/{id} { config, publicadoEm, publicadoPor, publicadoPorNome }
// Motor: site-engine.js · modelo padrão: site-padrao.js · aparência: site.css

let _site = null;   // { cfg, publicado, sujo, salvando, timerSalvar, timerPrevia, previaPronta, aberto: Set }

const TIPOS_BLOCO = {
  destaque: '🖼 Destaque (topo)', busca: '🔎 Busca de imóveis', imoveis: '🏠 Imóveis em destaque', servicos: '🧩 Cards (serviços)',
  anuncie: '📝 Anuncie seu imóvel', corretor: '👔 Chamada para corretores', contato: '📞 Contato',
  texto: '📄 Texto e imagem', chamada: '📣 Chamada', perguntas: '❓ Perguntas frequentes',
  acessoCorretor: '🚪 Área do corretor (topo com as portas)', vantagens: '✅ Vantagens + divisão da comissão', passos: '🔢 Passo a passo',
};
// Página em edição: null = página inicial; senão o id da página extra
const _idxPagina = () => (_site.pagina ? (_site.cfg.paginas || []).findIndex((p) => p.id === _site.pagina) : -1);
const _baseBlocos = () => { const i = _idxPagina(); return i >= 0 ? `paginas.${i}.blocos` : 'blocos'; };
const _blocosAtuais = () => _sGet(_site.cfg, _baseBlocos()) || [];
const FONTES_TITULO = ['Playfair Display', 'Lora', 'Merriweather', 'Montserrat', 'Poppins', 'Raleway'];
const FONTES_TEXTO = ['Inter', 'Open Sans', 'Roboto', 'Nunito', 'Lato', 'Montserrat', 'Poppins'];
const _siteRef = () => tenantPath().collection('site');
const _escS = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? ''));

// ---------- caminho "blocos.2.titulo" ----------
function _sGet(obj, path) { return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function _sSet(obj, path, val) {
  const ks = String(path).split('.'); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[ks[i]]; }
  o[ks[ks.length - 1]] = val;
}

// ---------- abrir ----------
async function loadMeuSite() {
  const raiz = $('site-editor');
  if (!raiz || !State.tenant) return;
  raiz.innerHTML = '<p class="muted">⏳ Carregando o seu site… aguarde</p>';
  try {
    const [r, p] = await Promise.all([_siteRef().doc('rascunho').get(), _siteRef().doc('publicado').get()]);
    const publicado = p.exists ? p.data() : null;
    let cfg = r.exists ? r.data().config : publicado?.config;
    if (!cfg) cfg = siteConfigPadrao(State.tenant, await _dadosDoSiteProprio());
    _site = { cfg: normalizarSiteConfig(cfg, State.tenant, {}), publicado, sujo: false, salvando: false, previaPronta: false,
      aberto: new Set(['identidade']), salvoEm: r.exists ? r.data().atualizadoEm : null };
    _renderEditorSite();
  } catch (err) {
    console.error('Meu site:', err);
    raiz.innerHTML = `<div class="alert alert-error" style="display:block">Não consegui abrir o seu site: ${_escS(err.message)}</div>`;
  }
}
// Site próprio pode oferecer dados iniciais (endereço, selo…) em site-dados.json
async function _dadosDoSiteProprio() {
  const base = String(State.tenant?.siteProprio || '').trim();
  if (!/^https?:\/\//i.test(base)) return {};
  try {
    const r = await fetch(base.replace(/\/?$/, '/') + 'site-dados.json', { cache: 'no-store' });
    return r.ok ? await r.json() : {};
  } catch (_) { return {}; }
}

const _podePublicar = () => (typeof pode === 'function' ? pode('publicarSite') : false);
const _podeEditar = () => (typeof nivelPermissao === 'function' ? (State.userDoc?.role === 'admin' || State.userDoc?.role === 'super_admin' || nivelPermissao('site', 'editar') === 'sim') : true);

function _urlSitePublicado() {
  const t = State.tenant || {};
  const proprio = String(t.siteProprio || '').trim();
  return /^https?:\/\//i.test(proprio) ? proprio : `${location.origin}${location.pathname.replace(/[^/]*$/, '')}site.html?t=${encodeURIComponent(t.slug || t.id)}`;
}

// ---------- tela ----------
function _renderEditorSite() {
  const raiz = $('site-editor');
  const editar = _podeEditar();
  raiz.innerHTML = `
    <div class="site-barra">
      <div class="site-status" id="site-status">${_statusTexto()}</div>
      <div class="site-barra-botoes">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-site-salvar" onclick="salvarRascunhoSite(true)" ${editar ? '' : 'disabled'}>💾 Salvar rascunho</button>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-site-descartar" onclick="descartarRascunhoSite()" ${editar && _site.publicado ? '' : 'disabled'} title="Volta o rascunho para o que está publicado">↩ Descartar alterações</button>
        <a class="btn btn-secondary btn-sm" href="${_escS(_urlSitePublicado())}" target="_blank" rel="noopener">↗ Ver site publicado</a>
        ${_podePublicar() ? '<button type="button" class="btn btn-primary btn-sm" id="btn-site-publicar" onclick="publicarSite()">🚀 Publicar</button>' : '<span class="muted" style="font-size:12px;">Publicar: peça a quem tem a permissão 🚀</span>'}
      </div>
    </div>
    <div id="site-alerta" class="alert" style="display:none;"></div>
    <div class="site-grade">
      <div class="site-painel" id="site-painel">${editar ? _paineis() : '<p class="muted">Seu perfil pode ver, mas não editar o site.</p>'}</div>
      <div class="site-previa">
        <div class="site-previa-topo"><span class="muted" style="font-size:12px;">Prévia ao vivo (ainda não publicado)</span>
          <div class="site-dispositivos" role="group" aria-label="Tamanho da prévia">
            <button type="button" class="btn btn-secondary btn-sm on" data-disp="computador" onclick="trocarDispositivoSite('computador')">💻 Computador</button>
            <button type="button" class="btn btn-secondary btn-sm" data-disp="celular" onclick="trocarDispositivoSite('celular')">📱 Celular</button>
          </div></div>
        <div class="site-moldura" id="site-moldura"><iframe id="site-iframe" title="Prévia do site" src="site.html?t=${encodeURIComponent(State.tenant.id)}&previa=1"></iframe></div>
      </div>
    </div>`;
  if (editar) raiz.querySelectorAll('details[data-painel]').forEach((d) => d.addEventListener('toggle', () => { if (d.open) _site.aberto.add(d.dataset.painel); else _site.aberto.delete(d.dataset.painel); }));
}

function _statusTexto() {
  if (_site.salvando) return '⏳ Salvando rascunho…';
  if (_site.sujo) return '✎ Alterações ainda não salvas';
  const pub = _site.publicado?.publicadoEm?.toDate ? _site.publicado.publicadoEm.toDate().toLocaleString('pt-BR') : null;
  return `${_site.salvoEm ? '✓ Rascunho salvo' : 'Rascunho inicial (modelo padrão)'} · ${pub ? `publicado em ${pub}` : '<strong>nunca publicado</strong>'}`;
}
function _atualizarStatus() { const el = $('site-status'); if (el) el.innerHTML = _statusTexto(); }

// ---------- campos ----------
function _campo(rotulo, path, tipo = 'texto', extra = {}) {
  const v = _sGet(_site.cfg, path);
  const id = 'sc-' + path.replace(/\./g, '-');
  const on = `oninput="campoSite('${path}', this)"`;
  const dica = extra.dica ? `<small class="muted">${extra.dica}</small>` : '';
  if (tipo === 'textarea') return `<div class="form-group"><label for="${id}">${rotulo}</label><textarea id="${id}" rows="${extra.linhas || 3}" ${on}>${_escS(v || '')}</textarea>${dica}</div>`;
  if (tipo === 'lista') return `<div class="form-group"><label for="${id}">${rotulo}</label><textarea id="${id}" rows="${extra.linhas || 4}" oninput="campoSite('${path}', {value: this.value.split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean)})">${_escS((Array.isArray(v) ? v : []).join(String.fromCharCode(10)))}</textarea>${dica}</div>`;
  if (tipo === 'check') return `<div class="form-group site-check"><label><input type="checkbox" id="${id}" ${v ? 'checked' : ''} onchange="campoSite('${path}', this)"> ${rotulo}</label>${dica}</div>`;
  if (tipo === 'cor') return `<div class="form-group"><label for="${id}">${rotulo}</label><div class="site-cor"><input type="color" id="${id}" value="${_escS(v || '#000000')}" ${on}><input type="text" value="${_escS(v || '')}" maxlength="7" aria-label="${rotulo} (código)" oninput="if(/^#[0-9a-f]{6}$/i.test(this.value)){document.getElementById('${id}').value=this.value;campoSite('${path}', this)}"></div>${dica}</div>`;
  if (tipo === 'select') return `<div class="form-group"><label for="${id}">${rotulo}</label><select id="${id}" onchange="campoSite('${path}', this)">${extra.opcoes.map(([val, txt]) => `<option value="${_escS(val)}" ${String(v) === String(val) ? 'selected' : ''}>${_escS(txt)}</option>`).join('')}</select>${dica}</div>`;
  if (tipo === 'numero') return `<div class="form-group"><label for="${id}">${rotulo}</label><input type="number" id="${id}" value="${_escS(v ?? '')}" min="${extra.min ?? 0}" max="${extra.max ?? 99}" ${on}>${dica}</div>`;
  if (tipo === 'imagem') return `<div class="form-group"><label for="${id}">${rotulo}</label>
    <div class="site-imagem">${v ? `<img src="${_escS(v)}" alt="">` : '<span class="muted">Sem imagem</span>'}</div>
    <input type="url" id="${id}" value="${_escS(v || '')}" placeholder="https://… (ou envie um arquivo)" ${on}>
    <div class="site-imagem-botoes"><button type="button" class="btn btn-secondary btn-sm" id="${id}-btn" onclick="document.getElementById('${id}-arq').click()">📤 Enviar imagem</button>
      ${v ? `<button type="button" class="btn btn-secondary btn-sm" onclick="campoSite('${path}', {value:''}); _redesenharPainel()">🗑 Tirar</button>` : ''}
      <input type="file" id="${id}-arq" accept="image/*" style="display:none" onchange="enviarImagemSite('${path}', this, '${id}-btn')"></div>${dica}</div>`;
  if (tipo === 'destino') {
    const d = String(v || '');
    const secoes = _blocosAtuais().map((b) => [`secao:${b.id}`, `Seção: ${b.titulo || TIPOS_BLOCO[b.tipo] || b.id}`]);
    const secoesInicio = _site.pagina ? (_site.cfg.blocos || []).map((b) => [`secao:${b.id}`, `Início › ${b.titulo || TIPOS_BLOCO[b.tipo] || b.id}`]) : [];
    const paginas = (_site.cfg.paginas || []).map((pg) => [`pagina:${pg.id}`, `Página: ${pg.titulo}${pg.visivel === false ? ' (escondida)' : ''}`]);
    const ops = [['inicio', 'Início'], ['imoveis', 'Imóveis (todos)'], ['imoveis-locacao', 'Imóveis para alugar'], ['imoveis-venda', 'Imóveis à venda'], ['corretor', 'Área do corretor'],
      ['parceiro', 'Cadastro de corretor parceiro'], ['sistema', 'Entrar no sistema (Rently)'], ['whatsapp', 'WhatsApp'], ...paginas, ...secoes, ...secoesInicio, ['url:', 'Link externo…']];
    const atual = d.startsWith('url:') ? 'url:' : d;
    return `<div class="form-group"><label for="${id}">${rotulo}</label><select id="${id}" onchange="destinoSite('${path}', this)">${ops.map(([val, txt]) => `<option value="${_escS(val)}" ${atual === val ? 'selected' : ''}>${_escS(txt)}</option>`).join('')}</select>
      ${atual === 'url:' ? `<input type="url" placeholder="https://…" value="${_escS(d.slice(4))}" oninput="campoSite('${path}', {value: 'url:' + this.value})" aria-label="Endereço do link">` : ''}</div>`;
  }
  return `<div class="form-group"><label for="${id}">${rotulo}</label><input type="text" id="${id}" value="${_escS(v ?? '')}" maxlength="${extra.max || 300}" ${on}>${dica}</div>`;
}
function _painel(chave, titulo, conteudo) {
  return `<details class="site-sec" data-painel="${chave}" ${_site.aberto.has(chave) ? 'open' : ''}><summary>${titulo}</summary><div class="site-sec-corpo">${conteudo}</div></details>`;
}

function _paineis() {
  const c = _site.cfg;
  return [
    _painel('identidade', '🎨 Identidade e cores', `
      <div class="form-row">${_campo('Nome', 'identidade.nome', 'texto', { max: 60 })}${_campo('Complemento', 'identidade.complemento', 'texto', { max: 40, dica: 'Ex.: Imóveis, Imobiliária' })}</div>
      <div class="form-row">${_campo('Selo ao lado do nome', 'identidade.seloTexto', 'texto', { max: 20, dica: 'Ex.: digital. Em branco, sem selo.' })}${_campo('CRECI (aparece sob o nome)', 'identidade.creci', 'texto', { max: 40 })}</div>
      ${_campo('Logo', 'identidade.logo', 'imagem', { dica: 'Use a logo sobre fundo branco.' })}
      ${_campo('Imagem do selo (opcional)', 'identidade.seloImagem', 'imagem', { dica: 'Um desenho próprio no lugar do texto do selo.' })}
      <div class="form-row">${_campo('Cor principal', 'identidade.corPrincipal', 'cor', { dica: 'Cabeçalho escuro, títulos, rodapé' })}${_campo('Cor de destaque', 'identidade.corDestaque', 'cor', { dica: 'Botões e detalhes' })}</div>
      <div class="form-row">${_campo('Fonte dos títulos', 'identidade.fonteTitulo', 'select', { opcoes: FONTES_TITULO.map((f) => [f, f]) })}${_campo('Fonte do texto', 'identidade.fonteTexto', 'select', { opcoes: FONTES_TEXTO.map((f) => [f, f]) })}</div>`),
    _painel('contato', '📞 Contato e dados legais', `
      <div class="form-row">${_campo('WhatsApp (com DDD)', 'contato.whatsapp', 'texto', { max: 20, dica: 'Só números. Ex.: 5511999998888' })}${_campo('E-mail', 'contato.email', 'texto', { max: 120 })}</div>
      ${_campo('Endereço (linha 1)', 'contato.endereco1', 'texto', { max: 120 })}${_campo('Endereço (linha 2)', 'contato.endereco2', 'texto', { max: 120 })}
      <div class="form-row">${_campo('CNPJ', 'contato.cnpj', 'texto', { max: 20 })}${_campo('Corretor responsável', 'contato.responsavel', 'texto', { max: 80 })}${_campo('CRECI do responsável', 'contato.creciResponsavel', 'texto', { max: 20 })}</div>
      ${_campo('Botão flutuante do WhatsApp', 'contato.botaoFlutuante', 'check')}`),
    _painel('menu', '🧭 Menu', `
      ${(c.menu.itens || []).map((it, i) => `<div class="site-item">
        <div class="form-row">${_campo('Texto', `menu.itens.${i}.rotulo`, 'texto', { max: 30 })}${_campo('Leva para', `menu.itens.${i}.destino`, 'destino')}</div>
        ${_botoesItem('menu.itens', i, c.menu.itens.length)}</div>`).join('')}
      <button type="button" class="btn btn-secondary btn-sm" onclick="addItemSite('menu.itens', {rotulo:'Novo item', destino:'inicio'})">+ Item no menu</button>
      ${_campo('Botão do WhatsApp no menu', 'menu.botaoWhatsapp', 'check')}`),
    _painel('paginas', '📑 Páginas', _painelPaginas()),
    _painel('blocos', _site.pagina ? `🧱 Blocos — página “${_escS((c.paginas[_idxPagina()] || {}).titulo || '')}”` : '🧱 Página inicial — blocos', `
      ${_site.pagina ? `<p style="margin-top:0;"><button type="button" class="btn btn-secondary btn-sm" onclick="selecionarPaginaSite('')">← Voltar à página inicial</button></p>` : ''}
      <p class="muted" style="font-size:12px;margin-top:0;">A página é montada nesta ordem. ✏️ edita, 👁 mostra/esconde, ↑↓ muda a ordem.</p>
      ${_blocosAtuais().map((b, i, arr) => _blocoEditor(b, i, arr.length)).join('')}
      <div class="site-novo-bloco"><select id="site-tipo-novo" aria-label="Tipo de bloco novo">${Object.entries(MODELOS_BLOCO_SITE).map(([k]) => `<option value="${k}">${TIPOS_BLOCO[k]}</option>`).join('')}</select>
        <button type="button" class="btn btn-secondary btn-sm" onclick="addBlocoSite()">+ Adicionar bloco</button></div>`),
    _painel('rodape', '⬇️ Rodapé', `${_campo('Frase do rodapé', 'rodape.texto', 'textarea', { linhas: 2 })}${_campo('Mostrar CNPJ, CRECI e responsável', 'rodape.mostrarLegal', 'check')}`),
    _painel('seguranca', '🔒 Aviso contra golpes', `
      <p class="muted" style="font-size:12px;margin-top:0;">Faixa no rodapé de todas as páginas do site. Protege o cliente do golpe do falso corretor e do Pix para pessoa física — e protege o nome da imobiliária.</p>
      ${_campo('Mostrar o aviso', 'seguranca.ativo', 'check')}
      ${_campo('Título', 'seguranca.titulo', 'texto', { max: 40 })}
      ${_campo('Texto', 'seguranca.texto', 'textarea', { linhas: 4, dica: 'Em branco = texto automático com os seus canais oficiais (WhatsApp, e-mail e CNPJ de “📞 Contato”).' })}
      <div class="site-ajuda">Texto automático hoje: <em>${_escS(_textoSegurancaAuto())}</em></div>`),
    _painel('seo', '🔎 Google e WhatsApp', `
      ${_campo('Título (aba do navegador e Google)', 'seo.titulo', 'texto', { max: 70, dica: 'Até 60–70 letras.' })}
      ${_campo('Descrição (aparece no Google)', 'seo.descricao', 'textarea', { linhas: 3, dica: 'Até ~160 letras.' })}
      ${_campo('Imagem ao compartilhar o link', 'seo.imagem', 'imagem')}`),
    _painel('dominio', '🌐 Endereço e domínio', _painelDominio()),
    _painel('historico', '🕓 Histórico de publicações', '<div id="site-historico"><button type="button" class="btn btn-secondary btn-sm" onclick="carregarHistoricoSite(this)">Ver publicações anteriores</button></div>'),
  ].join('');
}

function _botoesItem(lista, i, n) {
  return `<div class="site-item-botoes">
    <button type="button" class="btn btn-secondary btn-sm" onclick="moverItemSite('${lista}', ${i}, -1)" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
    <button type="button" class="btn btn-secondary btn-sm" onclick="moverItemSite('${lista}', ${i}, 1)" ${i === n - 1 ? 'disabled' : ''} aria-label="Descer">↓</button>
    <button type="button" class="btn btn-secondary btn-sm" onclick="removerItemSite('${lista}', ${i})" aria-label="Remover">🗑</button></div>`;
}

function _blocoEditor(b, i, n) {
  const base = _baseBlocos();
  const p = `${base}.${i}`;
  const aberto = _site.aberto.has('bloco-' + b.id);
  const campos = {
    destaque: () => `${_campo('Linha acima do título (opcional)', p + '.eyebrow')}${_campo('Título', p + '.titulo', 'textarea', { linhas: 2 })}${_campo('Texto', p + '.texto', 'textarea')}
      ${_campo('Imagem de fundo', p + '.imagem', 'imagem')}
      <div class="form-row">${_campo('Botão 1 — texto', p + '.botao1.rotulo')}${_campo('Botão 1 — leva para', p + '.botao1.destino', 'destino')}</div>
      <div class="form-row">${_campo('Botão 2 — texto', p + '.botao2.rotulo', 'texto', { dica: 'Em branco, sem botão.' })}${_campo('Botão 2 — leva para', p + '.botao2.destino', 'destino')}</div>`,
    busca: () => '<p class="muted" style="font-size:12px;">Busca de imóveis por finalidade, tipo, quartos e bairro. Não tem textos para editar.</p>',
    imoveis: () => `${_campo('Linha acima do título', p + '.eyebrow')}${_campo('Título', p + '.titulo')}${_campo('Texto', p + '.texto', 'textarea', { linhas: 2 })}
      <div class="form-row">${_campo('Quantos imóveis', p + '.quantidade', 'numero', { min: 1, max: 24 })}${_campo('Texto do botão', p + '.botao')}</div>`,
    servicos: () => `${_campo('Linha acima do título', p + '.eyebrow')}${_campo('Título', p + '.titulo')}${_campo('Texto', p + '.texto', 'textarea', { linhas: 2 })}
      ${(b.itens || []).map((it, j) => `<div class="site-item"><div class="form-row" style="grid-template-columns:90px 1fr;">${_campo('Ícone', `${p}.itens.${j}.icone`, 'texto', { max: 4 })}${_campo('Título do card', `${p}.itens.${j}.titulo`)}</div>
        ${_campo('Texto do card', `${p}.itens.${j}.texto`, 'textarea', { linhas: 2 })}${_botoesItem(p + '.itens', j, b.itens.length)}</div>`).join('')}
      <button type="button" class="btn btn-secondary btn-sm" onclick="addItemSite('${p}.itens', {icone:'⭐', titulo:'Novo card', texto:'Descrição.'})">+ Card</button>`,
    anuncie: () => `${_campo('Linha acima do título', p + '.eyebrow')}${_campo('Título', p + '.titulo')}${_campo('Texto', p + '.texto', 'textarea', { linhas: 2 })}
      ${_campo('Lista de vantagens (uma por linha)', p + '.itens', 'lista', { linhas: 4 })}
      <div class="form-row">${_campo('Texto do botão', p + '.botao')}${_campo('Aviso abaixo do formulário', p + '.aviso')}</div>`,
    corretor: () => `${_campo('Linha acima do título', p + '.eyebrow')}${_campo('Título', p + '.titulo')}${_campo('Texto', p + '.texto', 'textarea', { linhas: 2 })}
      <div class="form-row">${_campo('Botão — texto', p + '.botao.rotulo')}${_campo('Botão — leva para', p + '.botao.destino', 'destino')}</div>`,
    contato: () => `${_campo('Linha acima do título', p + '.eyebrow')}${_campo('Título', p + '.titulo')}${_campo('Texto sob o WhatsApp', p + '.textoWhatsapp')}
      <p class="muted" style="font-size:12px;">WhatsApp, e-mail e endereço vêm de “📞 Contato e dados legais”.</p>`,
    texto: () => `${_campo('Linha acima do título', p + '.eyebrow')}${_campo('Título', p + '.titulo')}${_campo('Texto', p + '.texto', 'textarea', { linhas: 5 })}
      ${_campo('Imagem (opcional)', p + '.imagem', 'imagem')}
      <div class="form-row">${_campo('Imagem do lado', p + '.ladoImagem', 'select', { opcoes: [['direita', 'Direita'], ['esquerda', 'Esquerda']] })}${_campo('Fundo', p + '.fundo', 'select', { opcoes: [['claro', 'Cinza claro'], ['branco', 'Branco'], ['escuro', 'Cor principal (escuro)']] })}</div>
      <div class="form-row">${_campo('Botão — texto (opcional)', p + '.botao.rotulo')}${_campo('Botão — leva para', p + '.botao.destino', 'destino')}</div>`,
    chamada: () => `${_campo('Título', p + '.titulo')}${_campo('Texto', p + '.texto', 'textarea', { linhas: 2 })}
      <div class="form-row">${_campo('Botão — texto', p + '.botao.rotulo')}${_campo('Botão — leva para', p + '.botao.destino', 'destino')}</div>`,
    perguntas: () => `${_campo('Linha acima do título', p + '.eyebrow')}${_campo('Título', p + '.titulo')}
      ${(b.itens || []).map((it, j) => `<div class="site-item">${_campo('Pergunta', `${p}.itens.${j}.pergunta`)}${_campo('Resposta', `${p}.itens.${j}.resposta`, 'textarea', { linhas: 3 })}${_botoesItem(p + '.itens', j, b.itens.length)}</div>`).join('')}
      <button type="button" class="btn btn-secondary btn-sm" onclick="addItemSite('${p}.itens', {pergunta:'Nova pergunta?', resposta:'Resposta.'})">+ Pergunta</button>`,
    acessoCorretor: () => `${_campo('Linha acima do título', p + '.eyebrow')}${_campo('Título', p + '.titulo', 'textarea', { linhas: 2 })}${_campo('Texto', p + '.texto', 'textarea')}
      ${_campo('Imagem de fundo (opcional)', p + '.imagem', 'imagem')}
      <div class="site-item"><strong style="font-size:13px;">Porta 1 — quero ser parceiro</strong>
        <div class="form-row">${_campo('Linha acima', p + '.parceiroEyebrow')}${_campo('Título', p + '.parceiroTitulo')}</div>
        ${_campo('Texto', p + '.parceiroTexto', 'textarea', { linhas: 2 })}${_campo('Botão', p + '.parceiroBotao', 'texto', { dica: 'Leva ao cadastro de corretor parceiro.' })}
        ${_campo('Aviso quando o cadastro está fechado', p + '.fechadoTexto', 'textarea', { linhas: 2, dica: 'Abrir/fechar o cadastro: Corretores → Programa “Seja corretor parceiro”.' })}</div>
      <div class="site-item"><strong style="font-size:13px;">Porta 2 — já sou corretor</strong>
        <div class="form-row">${_campo('Linha acima', p + '.entrarEyebrow')}${_campo('Título', p + '.entrarTitulo')}</div>
        ${_campo('Texto', p + '.entrarTexto', 'textarea', { linhas: 2 })}<div class="form-row">${_campo('Botão', p + '.entrarBotao', 'texto', { dica: 'Abre a entrada do sistema.' })}${_campo('Dica sob o botão', p + '.entrarDica')}</div></div>`,
    vantagens: () => `${_campo('Linha acima do título', p + '.eyebrow')}${_campo('Título', p + '.titulo')}
      ${_campo('Usar o texto do programa de parceiros (Corretores → Programa)', p + '.doPrograma', 'check', { dica: 'Desligado, valem as linhas abaixo.' })}
      ${_campo('Vantagens (uma por linha)', p + '.itens', 'lista', { linhas: 5 })}
      ${_campo('Mostrar a divisão padrão da comissão', p + '.mostrarDivisao', 'check', { dica: 'Os percentuais vêm do programa de parceiros.' })}`,
    passos: () => `${_campo('Linha acima do título', p + '.eyebrow')}${_campo('Título', p + '.titulo')}
      ${(b.itens || []).map((it, j) => `<div class="site-item">${_campo(`Passo ${j + 1} — título`, `${p}.itens.${j}.titulo`)}${_campo('Texto', `${p}.itens.${j}.texto`, 'textarea', { linhas: 2 })}${_botoesItem(p + '.itens', j, b.itens.length)}</div>`).join('')}
      <button type="button" class="btn btn-secondary btn-sm" onclick="addItemSite('${p}.itens', {titulo:'Novo passo', texto:'Descrição.'})">+ Passo</button>`,
  };
  return `<div class="site-bloco ${b.visivel === false ? 'oculto' : ''}">
    <div class="site-bloco-topo">
      <button type="button" class="site-bloco-nome" onclick="abrirBlocoSite('${b.id}')" aria-expanded="${aberto}"><span>${TIPOS_BLOCO[b.tipo] || b.tipo}</span><strong>${_escS(b.titulo || '')}</strong></button>
      <div class="site-item-botoes">
        <button type="button" class="btn btn-secondary btn-sm" onclick="campoSite('${p}.visivel', {value: ${b.visivel === false}}); _redesenharPainel()" title="${b.visivel === false ? 'Mostrar' : 'Esconder'}">${b.visivel === false ? '🚫' : '👁'}</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="moverItemSite('${base}', ${i}, -1)" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="moverItemSite('${base}', ${i}, 1)" ${i === n - 1 ? 'disabled' : ''} aria-label="Descer">↓</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="removerItemSite('${base}', ${i})" aria-label="Remover bloco">🗑</button>
      </div></div>
    ${aberto ? `<div class="site-bloco-corpo">${(campos[b.tipo] || (() => ''))()}</div>` : ''}</div>`;
}

function _painelPaginas() {
  const pags = _site.cfg.paginas || [];
  return `<p class="muted" style="font-size:12px;margin-top:0;">Além da página inicial, o site pode ter páginas próprias (Quem somos, Área do corretor…). Para pôr no menu, use “🧭 Menu → Leva para → Página”.</p>
    <div class="site-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;${!_site.pagina ? 'border-color:var(--primary);' : ''}">
      <span><strong>🏠 Página inicial</strong></span>
      <button type="button" class="btn btn-secondary btn-sm" onclick="selecionarPaginaSite('')" ${!_site.pagina ? 'disabled' : ''}>✏️ Editar blocos</button></div>
    ${pags.map((pg, i) => `<div class="site-item" ${_site.pagina === pg.id ? 'style="border-color:var(--primary);"' : ''}>
      <div class="form-row">${_campo('Nome da página', `paginas.${i}.titulo`, 'texto', { max: 40 })}${_campo('Aparece no site', `paginas.${i}.visivel`, 'check')}</div>
      <small class="muted">Endereço: ${_escS(_urlPagina(pg.id))}</small>
      <div class="site-item-botoes" style="margin-top:6px;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="selecionarPaginaSite('${pg.id}')" ${_site.pagina === pg.id ? 'disabled' : ''}>✏️ Editar blocos</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="removerPaginaSite(${i})" aria-label="Remover página">🗑 Remover</button></div></div>`).join('')}
    <div class="site-novo-bloco"><select id="site-modelo-pagina" aria-label="Modelo da página nova">
        <option value="branco">📄 Página em branco</option><option value="quemSomos">🏢 Quem somos</option><option value="corretor">🚪 Área do corretor</option></select>
      <input type="text" id="site-nome-pagina" maxlength="40" placeholder="Nome (ex.: Quem somos)" aria-label="Nome da página nova" style="flex:1;min-width:140px;padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);">
      <button type="button" class="btn btn-secondary btn-sm" id="btn-site-add-pagina" onclick="addPaginaSite()">+ Página</button></div>`;
}
function _urlPagina(id) {
  const proprio = String(State.tenant?.siteProprio || '').trim().replace(/\/?$/, '/');
  if (/^https?:\/\//i.test(proprio)) return id === 'corretor' ? proprio + 'corretor.html' : `${proprio}index.html?p=${id}`;
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}site.html?t=${encodeURIComponent(State.tenant?.slug || State.tenant?.id)}&p=${id}`;
}
function _textoSegurancaAuto() {
  const c = _site.cfg, ct = c.contato || {}, nome = [c.identidade.nome, c.identidade.complemento].filter(Boolean).join(' ');
  const tel = String(ct.whatsapp || '').replace(/\D/g, '');
  const canais = [tel ? 'WhatsApp ' + tel : '', ct.email || ''].filter(Boolean).join(' · ');
  return `A ${nome} nunca pede Pix, depósito ou sinal em conta de pessoa física, nem cobra para agendar visita. Pagamentos só em nome da imobiliária${ct.cnpj ? ` (CNPJ ${ct.cnpj})` : ''}.${canais ? ` Canais oficiais: ${canais}.` : ''} Na dúvida, confirme por eles.`;
}
function selecionarPaginaSite(id) {
  _site.pagina = id || null;
  _site.aberto.add('blocos');
  _redesenharPainel();
  _enviarPrevia();
}
function _idPaginaNovo(titulo) {
  let base = String(titulo || 'pagina').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'pagina';
  const usados = new Set((_site.cfg.paginas || []).map((p) => p.id));
  let id = base, n = 2;
  while (usados.has(id)) id = `${base}-${n++}`;
  return id;
}
function addPaginaSite() {
  const modelo = $('site-modelo-pagina').value;
  const nomeDigitado = ($('site-nome-pagina').value || '').trim();
  const c = _site.cfg; c.paginas = Array.isArray(c.paginas) ? c.paginas : [];
  const nome = c.identidade.nome, nomeCompleto = [c.identidade.nome, c.identidade.complemento].filter(Boolean).join(' ');
  let pg;
  if (modelo === 'corretor') {
    if (c.paginas.some((p) => p.id === 'corretor')) { _alertaSite('O site já tem a Área do corretor — edite a que existe.'); return; }
    pg = MODELOS_PAGINA_SITE.corretor(nome, nomeCompleto);
  } else if (modelo === 'quemSomos') {
    pg = MODELOS_PAGINA_SITE.quemSomos(nome, nomeCompleto); pg.id = _idPaginaNovo(nomeDigitado || 'quem-somos');
  } else {
    pg = MODELOS_PAGINA_SITE.branco(nomeDigitado || 'Nova página'); pg.id = _idPaginaNovo(nomeDigitado || 'nova-pagina');
  }
  if (nomeDigitado) pg.titulo = nomeDigitado;
  c.paginas.push(pg);
  _site.pagina = pg.id; _site.aberto.add('blocos');
  _marcarAlterado(true);
  _enviarPrevia();
  _alertaSite(`✓ Página “${pg.titulo}” criada${pg.visivel === false ? ' (escondida — ligue “Aparece no site” quando estiver pronta)' : ''}.`, 'success');
}
async function removerPaginaSite(i) {
  const pg = (_site.cfg.paginas || [])[i]; if (!pg) return;
  if (!(await confirmar({ titulo: 'Remover esta página?', mensagem: `“${_escS(pg.titulo)}” sai do site. Itens do menu que levam a ela passam a levar ao início.`, detalhe: 'Se preferir, só desligue “Aparece no site”.', confirmar: '🗑 Remover', perigo: true }))) return;
  _site.cfg.paginas.splice(i, 1);
  if (_site.pagina === pg.id) _site.pagina = null;
  (_site.cfg.menu.itens || []).forEach((it) => { if (it.destino === 'pagina:' + pg.id) it.destino = 'inicio'; });
  _marcarAlterado(true);
  _enviarPrevia();
}

function _painelDominio() {
  const t = State.tenant || {};
  const rently = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}site.html?t=${encodeURIComponent(t.slug || t.id)}`;
  const atual = String(t.dominioSite || String(t.siteProprio || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')).trim();
  return `
    <div class="form-group"><label>Endereço do seu site no Rently (sempre funciona)</label>
      <div class="site-cor"><input type="text" readonly value="${_escS(rently)}" id="site-url-rently"><button type="button" class="btn btn-secondary btn-sm" onclick="copiarTextoSite('site-url-rently', this)">📋 Copiar</button></div></div>
    <div class="form-group"><label for="site-dominio-teste">Domínio próprio</label>
      <p class="muted" style="font-size:12px;margin:0 0 6px;">${atual ? `Hoje: <strong>${_escS(atual)}</strong>` : 'Ainda não ligado.'} Use o endereço com <strong>www</strong> (ex.: www.suaimobiliaria.com.br).</p>
      <div class="site-cor"><input type="text" id="site-dominio-teste" placeholder="www.suaimobiliaria.com.br" value="${_escS(atual)}">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-site-dns" onclick="verificarDominioSite()">🔍 Verificar</button></div>
      <div class="site-imagem-botoes">${_podePublicar() ? `<button type="button" class="btn btn-primary btn-sm" id="btn-site-ligar" onclick="ligarDominioSite()">🔗 Ligar domínio</button>` : '<span class="muted" style="font-size:12px;">Ligar domínio: peça a quem tem a permissão 🚀 Publicar.</span>'}
        ${atual && _podePublicar() ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-site-desligar" onclick="desligarDominioSite()">✂️ Desligar</button>` : ''}</div>
      <div id="site-dns-resultado" style="margin-top:8px;"></div></div>
    <p style="margin:4px 0 12px;"><a href="instrucoes-site.html" id="link-instrucoes-site" target="_blank" rel="noopener" onclick="this.href=_urlInstrucoesSite()" style="font-weight:600;">📘 Instruções para colocar seu site no ar ↗</a></p>
    <div class="site-ajuda"><strong>Como ligar o seu domínio (uma vez só)</strong>
      <ol><li>Registre o domínio (ex.: no <a href="https://registro.br" target="_blank" rel="noopener">Registro.br</a>) — a compra e a senha de lá são suas.</li>
      <li>Digite o domínio acima e clique <strong>🔍 Verificar</strong>: aparecem os <strong>2 registros</strong> para criar no DNS do domínio (no Registro.br: <em>Configurar zona DNS</em>).</li>
      <li>Depois de criar, clique <strong>🔗 Ligar domínio</strong>. O certificado de segurança (https) sai sozinho em alguns minutos — o ✓ aparece aqui.</li></ol></div>`;
}

// ---------- domínio próprio (Worker drg-rently-sites + Cloudflare for SaaS) ----------
// Página de instruções já preenchida com o código do site (TXT) e o domínio digitado
function _urlInstrucoesSite() {
  const dom = $('site-dominio-teste') ? _dominioDigitado() : '';
  return `instrucoes-site.html?t=${encodeURIComponent(State.tenant?.id || '')}${dom ? '&d=' + encodeURIComponent(dom) : ''}`;
}
window._urlInstrucoesSite = _urlInstrucoesSite;
const SITES_API = 'https://drg-rently-sites.zett-romao.workers.dev/api/dominios';
const _dominioDigitado = () => ($('site-dominio-teste').value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
async function _chamarDominios(metodo, hostname) {
  const token = await auth.currentUser.getIdToken();
  const corpo = { tenantId: State.tenant.id, hostname };
  const r = await fetch(SITES_API + (metodo === 'GET' ? '?' + new URLSearchParams(corpo) : ''), {
    method: metodo, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: metodo === 'GET' ? undefined : JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}
function _mostrarSituacaoDominio(d) {
  const out = $('site-dns-resultado');
  const curto = (nome) => nome.replace(/\.[^.]+\.(com|net|org|adv|eng|imb|blog|app|dev)?\.?br$|\.[^.]+\.(com|net|org)$/i, '');
  const st = (okv) => (okv ? '<span style="color:#166534;">✓ ok</span>' : '<span style="color:#92400E;">⏳ falta</span>');
  const dns = d.dns || {};
  const linhas = (d.registros || []).map((r) => `<div class="site-item" style="margin:6px 0;background:#fff;">
      <div style="display:flex;justify-content:space-between;gap:8px;"><strong>${_escS(r.tipo)}</strong>${st(r.tipo === 'CNAME' ? dns.cnameOk : dns.txtOk)}</div>
      <div>Nome: <code>${_escS(curto(r.nome) || '@')}</code> <small class="muted">(${_escS(r.nome)})</small></div>
      <div style="overflow-wrap:anywhere;">Valor: <code>${_escS(r.valor)}</code></div></div>`).join('');
  const cf = d.cloudflare;
  const https = !cf ? (d.cfPronto === false ? 'aguardando ativação no servidor (DR Systems)' : 'ainda não ligado — clique 🔗 Ligar domínio')
    : cf.status === 'active' && cf.ssl === 'active' ? '✓ ativo' : `⏳ em andamento (${_escS(cf.status)} / ${_escS(cf.ssl || '—')})`;
  out.innerHTML = `<div class="site-item" style="font-size:13px;">
    ${d.ativo ? `<div style="color:#166534;font-weight:600;margin-bottom:6px;">✓ ${_escS(d.hostname)} está no ar com https.</div>` : ''}
    ${d.erro ? `<div class="alert alert-error" style="display:block;margin-bottom:8px;">${_escS(d.erro)}</div>` : ''}
    ${linhas ? `<div>Crie no DNS do domínio:</div>${linhas}` : ''}
    ${d.registros ? `<div style="margin-top:6px;">Certificado https: ${https}</div>` : ''}
    ${(cf?.erros || []).length ? `<div class="muted" style="margin-top:4px;">${cf.erros.map(_escS).join('<br>')}</div>` : ''}</div>`;
}
async function verificarDominioSite() {
  const dom = _dominioDigitado();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) { _mostrarSituacaoDominio({ erro: 'Digite só o domínio, ex.: www.suaimobiliaria.com.br' }); return; }
  const b = $('btn-site-dns'); const txt = b.textContent; b.disabled = true; b.textContent = '⏳ Verificando… aguarde';
  try { _mostrarSituacaoDominio(await _chamarDominios('GET', dom)); }
  catch (err) { _mostrarSituacaoDominio({ erro: 'Não consegui consultar agora: ' + err.message }); }
  finally { b.disabled = false; b.textContent = txt; }
}
async function ligarDominioSite() {
  const dom = _dominioDigitado();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) { _mostrarSituacaoDominio({ erro: 'Digite só o domínio, ex.: www.suaimobiliaria.com.br' }); return; }
  const b = $('btn-site-ligar'); const txt = b.textContent; b.disabled = true; b.textContent = '⏳ Ligando… aguarde ~10s';
  try {
    const d = await _chamarDominios('POST', dom);
    _mostrarSituacaoDominio(d);
    if (d.status === 200) {
      // Guarda no cadastro do cliente (só o administrador grava; quem só publica vê o aviso)
      try {
        await db.collection('tenants').doc(State.tenant.id).update({ dominioSite: dom, ...(d.ativo ? { siteProprio: `https://${dom}/` } : {}) });
        State.tenant.dominioSite = dom; if (d.ativo) State.tenant.siteProprio = `https://${dom}/`;
      } catch (_) { /* sem permissão no cadastro: o domínio funciona mesmo assim */ }
      logAuditoria('dominio_ligado', 'site', dom, { ativo: !!d.ativo });
      _alertaSite(d.ativo ? `✓ ${dom} está no ar!` : `✓ Pedido feito. O https de ${dom} sai em alguns minutos — clique 🔍 Verificar para acompanhar.`, 'success');
    }
  } catch (err) { _mostrarSituacaoDominio({ erro: 'Não consegui ligar: ' + err.message }); }
  finally { b.disabled = false; b.textContent = txt; }
}
async function desligarDominioSite() {
  const dom = _dominioDigitado();
  if (!(await confirmar({ titulo: 'Desligar o domínio?', mensagem: `${_escS(dom)} deixa de abrir o seu site.`, detalhe: 'O endereço do Rently continua funcionando.', confirmar: '✂️ Desligar', perigo: true }))) return;
  const b = $('btn-site-desligar'); const txt = b.textContent; b.disabled = true; b.textContent = '⏳ Desligando… aguarde';
  try {
    const d = await _chamarDominios('DELETE', dom);
    if (d.status !== 200) throw new Error(d.erro || 'erro ' + d.status);
    try { await db.collection('tenants').doc(State.tenant.id).update({ dominioSite: null }); State.tenant.dominioSite = null; } catch (_) {}
    logAuditoria('dominio_desligado', 'site', dom, {});
    _alertaSite(`✓ ${dom} desligado.`, 'success');
    _redesenharPainel();
  } catch (err) { _mostrarSituacaoDominio({ erro: 'Não consegui desligar: ' + err.message }); b.disabled = false; b.textContent = txt; }
}

// ---------- edição ----------
function campoSite(path, el) {
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.type === 'number') v = el.value === '' ? '' : Number(el.value);
  _sSet(_site.cfg, path, v);
  _marcarAlterado();
}
function destinoSite(path, el) {
  _sSet(_site.cfg, path, el.value === 'url:' ? 'url:https://' : el.value);
  _marcarAlterado(); _redesenharPainel();
}
function _marcarAlterado(redesenhar) {
  _site.sujo = true; _atualizarStatus();
  clearTimeout(_site.timerPrevia); _site.timerPrevia = setTimeout(_enviarPrevia, 200);
  clearTimeout(_site.timerSalvar); _site.timerSalvar = setTimeout(() => salvarRascunhoSite(false), 2500);
  if (redesenhar) _redesenharPainel();
}
function _redesenharPainel() {
  const p = $('site-painel'); if (!p) return;
  const rol = p.scrollTop; p.innerHTML = _paineis(); p.scrollTop = rol;
  p.querySelectorAll('details[data-painel]').forEach((d) => d.addEventListener('toggle', () => { if (d.open) _site.aberto.add(d.dataset.painel); else _site.aberto.delete(d.dataset.painel); }));
}
function abrirBlocoSite(id) {
  const k = 'bloco-' + id;
  if (_site.aberto.has(k)) _site.aberto.delete(k); else _site.aberto.add(k);
  _redesenharPainel();
  _enviarPrevia(id);
}
function moverItemSite(lista, i, d) {
  const arr = _sGet(_site.cfg, lista); const j = i + d;
  if (!Array.isArray(arr) || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  _marcarAlterado(true);
}
async function removerItemSite(lista, i) {
  const arr = _sGet(_site.cfg, lista); if (!Array.isArray(arr)) return;
  if (/(^|\.)blocos$/.test(lista) && !(await confirmar({ titulo: 'Remover este bloco?', mensagem: `“${_escS(arr[i].titulo || TIPOS_BLOCO[arr[i].tipo])}” sai da página. Se preferir só esconder, use 👁.`, confirmar: '🗑 Remover', perigo: true }))) return;
  arr.splice(i, 1);
  _marcarAlterado(true);
}
function addItemSite(lista, modelo) {
  let arr = _sGet(_site.cfg, lista);
  if (!Array.isArray(arr)) { arr = []; _sSet(_site.cfg, lista, arr); }
  arr.push(JSON.parse(JSON.stringify(modelo)));
  _marcarAlterado(true);
}
function addBlocoSite() {
  const tipo = $('site-tipo-novo').value;
  const b = MODELOS_BLOCO_SITE[tipo]();
  b.id = tipo + '-' + Math.random().toString(36).slice(2, 7);
  let arr = _sGet(_site.cfg, _baseBlocos());
  if (!Array.isArray(arr)) { arr = []; _sSet(_site.cfg, _baseBlocos(), arr); }
  arr.push(b);
  _site.aberto.add('bloco-' + b.id);
  _marcarAlterado(true);
  setTimeout(() => _enviarPrevia(b.id), 250);
}

// ---------- imagens ----------
async function enviarImagemSite(path, input, btnId) {
  const f = input.files && input.files[0]; input.value = '';
  if (!f) return;
  if (!/^image\//.test(f.type)) { _alertaSite('Escolha um arquivo de imagem (JPG, PNG, WebP ou SVG).'); return; }
  if (f.size > 8 * 1024 * 1024) { _alertaSite('A imagem passa de 8 MB. Reduza e tente de novo.'); return; }
  const b = $(btnId); const txt = b ? b.textContent : '';
  if (b) { b.disabled = true; b.textContent = '⏳ Enviando… aguarde'; }
  try {
    const nome = f.name.replace(/[^\w.-]+/g, '-').slice(-60);
    const ref = storage.ref().child(`tenants/${State.tenant.id}/site/${Date.now()}-${nome}`);
    await ref.put(f, { contentType: f.type, cacheControl: 'public,max-age=31536000' });
    _sSet(_site.cfg, path, await ref.getDownloadURL());
    _marcarAlterado(true);
    _alertaSite('✓ Imagem enviada.', 'success');
  } catch (err) {
    console.error(err); _alertaSite('Não consegui enviar a imagem: ' + err.message);
    if (b) { b.disabled = false; b.textContent = txt; }
  }
}

// ---------- prévia ----------
function _enviarPrevia(ancora) {
  const fr = $('site-iframe'); if (!fr || !fr.contentWindow) return;
  fr.contentWindow.postMessage({ tipo: 'rently-site-previa', config: JSON.parse(JSON.stringify(_site.cfg)), pagina: _site.pagina || null, ancora: typeof ancora === 'string' ? ancora : null }, location.origin);
}
window.addEventListener('message', (ev) => {
  if (ev.origin === location.origin && ev.data && ev.data.tipo === 'rently-site-pronto' && _site) { _site.previaPronta = true; _enviarPrevia(); }
});
function trocarDispositivoSite(qual) {
  const m = $('site-moldura'); if (!m) return;
  m.classList.toggle('celular', qual === 'celular');
  document.querySelectorAll('.site-dispositivos [data-disp]').forEach((b) => b.classList.toggle('on', b.dataset.disp === qual));
}

// ---------- salvar / publicar ----------
function _configParaSalvar() { return JSON.parse(JSON.stringify(_site.cfg)); }
async function salvarRascunhoSite(manual) {
  if (!_site || _site.salvando) return;
  clearTimeout(_site.timerSalvar);
  const b = manual ? $('btn-site-salvar') : null; const txt = b ? b.textContent : '';
  _site.salvando = true; _atualizarStatus();
  if (b) { b.disabled = true; b.textContent = '⏳ Salvando… aguarde'; }
  try {
    await _siteRef().doc('rascunho').set({ config: _configParaSalvar(), atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(), atualizadoPor: State.user.uid });
    _site.sujo = false; _site.salvoEm = new Date();
    if (manual) _alertaSite('✓ Rascunho salvo. O site no ar só muda quando alguém Publicar.', 'success');
  } catch (err) {
    console.error(err); _alertaSite('Não consegui salvar o rascunho: ' + err.message);
  } finally {
    _site.salvando = false; _atualizarStatus();
    if (b) { b.disabled = false; b.textContent = txt; }
  }
}
async function publicarSite() {
  if (!_podePublicar()) { _alertaSite('Seu perfil não tem a permissão 🚀 Publicar o site. Peça ao gestor.'); return; }
  const ok = await confirmar({ titulo: 'Publicar o site?', mensagem: 'O que está na prévia passa a valer no site, para todos os visitantes.', detalhe: 'A versão atual fica no 🕓 Histórico — dá para voltar depois.', confirmar: '🚀 Publicar' });
  if (!ok) return;
  const b = $('btn-site-publicar'); const txt = b.textContent;
  b.disabled = true; b.textContent = '⏳ Publicando… aguarde';
  try {
    const config = _configParaSalvar();
    const quem = { publicadoEm: firebase.firestore.FieldValue.serverTimestamp(), publicadoPor: State.user.uid, publicadoPorNome: State.userDoc?.nome || State.user.email || '' };
    const lote = db.batch();
    lote.set(_siteRef().doc('publicado'), { config, ...quem });
    lote.set(_siteRef().doc('rascunho'), { config, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(), atualizadoPor: State.user.uid });
    lote.set(tenantPath().collection('siteVersoes').doc(), { config, ...quem });
    await lote.commit();
    _site.publicado = { config, publicadoEm: { toDate: () => new Date() } };
    _site.sujo = false; _site.salvoEm = new Date();
    _atualizarStatus();
    const d = $('btn-site-descartar'); if (d) d.disabled = false;
    _alertaSite(`✓ Site publicado! Já está no ar em ${_urlSitePublicado()}`, 'success');
  } catch (err) {
    console.error(err); _alertaSite('Não consegui publicar: ' + err.message);
  } finally {
    b.disabled = false; b.textContent = txt;
  }
}
async function descartarRascunhoSite() {
  if (!_site.publicado) return;
  if (!(await confirmar({ titulo: 'Descartar as alterações?', mensagem: 'O rascunho volta a ser igual ao site publicado.', confirmar: '↩ Descartar', perigo: true }))) return;
  _site.cfg = normalizarSiteConfig(_site.publicado.config, State.tenant, {});
  _marcarAlterado(true);
  _alertaSite('✓ Rascunho voltou ao que está publicado.', 'success');
}

// ---------- histórico ----------
async function carregarHistoricoSite(btn) {
  const alvo = $('site-historico');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Carregando… aguarde'; }
  try {
    const s = await tenantPath().collection('siteVersoes').orderBy('publicadoEm', 'desc').limit(20).get();
    _site.versoes = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    alvo.innerHTML = _site.versoes.length ? _site.versoes.map((v, i) => `<div class="site-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <span>${v.publicadoEm?.toDate ? v.publicadoEm.toDate().toLocaleString('pt-BR') : '—'} · ${_escS(v.publicadoPorNome || '')}${i === 0 ? ' <strong>(no ar)</strong>' : ''}</span>
      <button type="button" class="btn btn-secondary btn-sm" onclick="restaurarVersaoSite(${i})">↩ Usar como rascunho</button></div>`).join('')
      : '<p class="muted" style="font-size:12px;">Nenhuma publicação ainda.</p>';
  } catch (err) { alvo.innerHTML = `<p class="muted">Não consegui carregar: ${_escS(err.message)}</p>`; }
}
function restaurarVersaoSite(i) {
  const v = _site.versoes && _site.versoes[i]; if (!v) return;
  _site.cfg = normalizarSiteConfig(v.config, State.tenant, {});
  _marcarAlterado(true);
  _alertaSite('✓ Versão carregada no rascunho. Confira a prévia e clique 🚀 Publicar para colocar no ar.', 'success');
}

async function copiarTextoSite(id, btn) {
  const el = $(id);
  try { await navigator.clipboard.writeText(el.value); btn.textContent = '✓ Copiado'; }
  catch (_) { el.select(); btn.textContent = 'Selecionado — Ctrl+C'; }
  setTimeout(() => { btn.textContent = '📋 Copiar'; }, 2500);
}

function _alertaSite(msg, tipo) { showAlert('site-alerta', msg, tipo || 'error'); }

window.loadMeuSite = loadMeuSite;
window.campoSite = campoSite;
window.destinoSite = destinoSite;
window.abrirBlocoSite = abrirBlocoSite;
window.moverItemSite = moverItemSite;
window.removerItemSite = removerItemSite;
window.addItemSite = addItemSite;
window.addBlocoSite = addBlocoSite;
window.enviarImagemSite = enviarImagemSite;
window.trocarDispositivoSite = trocarDispositivoSite;
window.salvarRascunhoSite = salvarRascunhoSite;
window.publicarSite = publicarSite;
window.descartarRascunhoSite = descartarRascunhoSite;
window.carregarHistoricoSite = carregarHistoricoSite;
window.restaurarVersaoSite = restaurarVersaoSite;
window.verificarDominioSite = verificarDominioSite;
window.ligarDominioSite = ligarDominioSite;
window.desligarDominioSite = desligarDominioSite;
window.copiarTextoSite = copiarTextoSite;
window._redesenharPainel = _redesenharPainel;
window.selecionarPaginaSite = selecionarPaginaSite;
window.addPaginaSite = addPaginaSite;
window.removerPaginaSite = removerPaginaSite;
