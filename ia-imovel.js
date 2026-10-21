// =============================================================
// DRG-Rently — ✨ CADASTRO DE IMÓVEL COM IA
// =============================================================
// Pedido do dono (17/10/2026): "subir por txt, print de tela, qualquer outro formato de imagem e
// pdf, a descrição do imóvel e a IA gera o anúncio inteiro… deixe a forma convencional, mas quero
// algo bem mais IA e superior".
//
// No topo do modal do imóvel: arrastar/colar (Ctrl+V) prints, fotos, PDFs e textos, ou colar o
// texto do anúncio. A IA (Worker Gemini, modo "imovel") devolve os campos do formulário, o
// proprietário, o anúncio (título, descrição, tags) e o que é cada arquivo. A tela:
//   • preenche os campos vazios e destaca o que a IA preencheu (o resto continua manual);
//   • acha o proprietário entre os locadores (ou oferece cadastrar, já preenchido);
//   • oferece pôr as FOTOS do imóvel na galeria (com a marca d'água de sempre);
//   • leva ao gerador de anúncio (curadoria de fotos + região) para refinar.
// Carregado depois do anuncios.js (usa urlWorkerIA, abrirGeradorAnuncio).

const IA_IMOVEL_MAX_ARQUIVOS = 20;
const IA_IMOVEL_MAX_MB = 18;
let _iaImovel = { itens: [], resultado: null };   // itens: { id, file, nome, mimeType, data?, texto?, thumb? }

// ---------- abrir / limpar ----------
function resetCadastroIA(novo) {
  _iaImovel = { itens: [], resultado: null };
  const box = $('imovel-ia-box');
  if (!box) return;
  box.open = !!novo;
  $('imovel-ia-texto').value = '';
  $('imovel-ia-resultado').innerHTML = '';
  clearInlineStatus('imovel-ia-status');
  renderArquivosIA();
}

// ---------- arquivos ----------
const _lerComoDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
const _lerComoTexto = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(blob); });

async function _reduzirImagem(file, maxLado = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagem inválida')); i.src = url; });
    const esc = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * esc); c.height = Math.round(img.naturalHeight * esc);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.82);
    const t = document.createElement('canvas'); const et = 96 / Math.max(c.width, c.height);
    t.width = Math.round(c.width * et); t.height = Math.round(c.height * et); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    return { data: dataUrl.split(',')[1], thumb: t.toDataURL('image/jpeg', 0.7) };
  } finally { URL.revokeObjectURL(url); }
}

async function adicionarArquivosIA(lista) {
  const arquivos = Array.from(lista || []);
  if (!arquivos.length) return;
  const recusados = [];
  for (const f of arquivos) {
    if (_iaImovel.itens.length >= IA_IMOVEL_MAX_ARQUIVOS) { recusados.push(`${f.name || 'arquivo'} (limite de ${IA_IMOVEL_MAX_ARQUIVOS})`); continue; }
    const nome = f.name || `print-${Date.now()}.png`;
    const tipo = f.type || (/\.(txt|md|csv)$/i.test(nome) ? 'text/plain' : '');
    try {
      if (/^image\//.test(tipo)) {
        const { data, thumb } = await _reduzirImagem(f);
        _iaImovel.itens.push({ id: Math.random().toString(36).slice(2), file: f, nome, mimeType: 'image/jpeg', data, thumb });
      } else if (tipo === 'application/pdf') {
        if (f.size > 8 * 1024 * 1024) { recusados.push(`${nome} (PDF acima de 8 MB)`); continue; }
        const data = (await _lerComoDataUrl(f)).split(',')[1];
        _iaImovel.itens.push({ id: Math.random().toString(36).slice(2), file: f, nome, mimeType: 'application/pdf', data });
      } else if (/^text\//.test(tipo)) {
        const texto = (await _lerComoTexto(f)).slice(0, 20000);
        _iaImovel.itens.push({ id: Math.random().toString(36).slice(2), file: f, nome, mimeType: 'text/plain', texto });
      } else {
        recusados.push(`${nome} (formato não aceito — use imagem, PDF ou .txt; Word: salve como PDF)`);
      }
    } catch (e) { recusados.push(`${nome} (${e.message})`); }
  }
  renderArquivosIA();
  if (recusados.length) showInlineStatus('imovel-ia-status', `⚠️ Não entraram: ${escapeHtml(recusados.join('; '))}`, 'error', 9000);
}

function removerArquivoIA(id) {
  _iaImovel.itens = _iaImovel.itens.filter((i) => i.id !== id);
  renderArquivosIA();
}

function renderArquivosIA() {
  const box = $('imovel-ia-arquivos');
  if (!box) return;
  box.innerHTML = _iaImovel.itens.map((i) => `
    <div class="ia-arq" title="${escapeHtml(i.nome)}">
      ${i.thumb ? `<img src="${i.thumb}" alt="">` : `<span class="ia-arq-ico">${i.mimeType === 'application/pdf' ? '📄' : '📝'}</span>`}
      <span class="ia-arq-nome">${escapeHtml(i.nome)}</span>
      <button type="button" class="ia-arq-x" aria-label="Tirar ${escapeHtml(i.nome)}" onclick="removerArquivoIA('${i.id}')">×</button>
    </div>`).join('');
}

function ligarEntradaIA() {
  const zona = $('imovel-ia-zona');
  if (!zona || zona.dataset.ligada) return;
  zona.dataset.ligada = '1';
  ['dragenter', 'dragover'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('arrastando'); }));
  ['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove('arrastando'); }));
  zona.addEventListener('drop', (e) => adicionarArquivosIA(e.dataTransfer.files));
  // Ctrl+V de print de tela: vale na zona e na caixa de texto
  const colar = (e) => {
    const arqs = Array.from(e.clipboardData?.files || []);
    if (arqs.length) { e.preventDefault(); adicionarArquivosIA(arqs); }
  };
  zona.addEventListener('paste', colar);
  $('imovel-ia-texto').addEventListener('paste', colar);
}

// ---------- IA ----------
async function preencherImovelComIA() {
  const texto = $('imovel-ia-texto').value.trim();
  if (!_iaImovel.itens.length && !texto) {
    showInlineStatus('imovel-ia-status', '⚠️ Arraste arquivos, cole um print (Ctrl+V) ou escreva/cole o texto do imóvel.', 'error', 6000);
    return;
  }
  const bytes = _iaImovel.itens.reduce((s, i) => s + ((i.data || '').length * 3) / 4, 0);
  if (bytes > IA_IMOVEL_MAX_MB * 1024 * 1024) {
    showInlineStatus('imovel-ia-status', `⚠️ Os arquivos somam mais de ${IA_IMOVEL_MAX_MB} MB. Tire alguns.`, 'error', 7000);
    return;
  }
  const workerUrl = await urlWorkerIA();
  if (!workerUrl) {
    showInlineStatus('imovel-ia-status', '⚠️ A IA não está configurada: cole a URL do Worker Gemini em Configurações → IA.', 'error');
    return;
  }
  const btn = $('btn-imovel-ia');
  try {
    const r = await drgSubmit(btn, `⏳ IA lendo ${_iaImovel.itens.length || 'o'} ${_iaImovel.itens.length === 1 ? 'arquivo' : _iaImovel.itens.length ? 'arquivos' : 'texto'}… aguarde ~30s`, async () => {
      showInlineStatus('imovel-ia-status', '🤖 Lendo o material e montando o cadastro e o anúncio…', 'loading');
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 150000);
      let res;
      try {
        res = await fetch(workerUrl, {
          method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modo: 'imovel', texto,
            arquivos: _iaImovel.itens.map((i) => (i.mimeType === 'text/plain'
              ? { nome: i.nome, mimeType: 'text/plain', texto: i.texto }
              : { nome: i.nome, mimeType: i.mimeType, data: i.data })),
          }),
        });
      } catch (e) {
        throw new Error(e.name === 'AbortError' ? 'a IA demorou demais (mais de 2 min). Tente com menos arquivos.' : 'sem conexão com a IA: ' + e.message);
      } finally { clearTimeout(timer); }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || `erro ${res.status} na IA`);
      return json.data;
    }, { destravar: true });
    if (r === DRG_IGNORADO) return;
    _iaImovel.resultado = r;
    _iaImovel.alvo = $('imovel-id').value || 'novo';
    _iaImovel.quando = Date.now();
    const rel = await aplicarResultadoIA(r, false);
    clearInlineStatus('imovel-ia-status');
    renderResultadoIA(r, rel);
    await anexarAutomaticoIA();
    if (typeof logAuditoria === 'function') logAuditoria('ia_cadastro_imovel', 'imovel', $('imovel-id').value || null, { arquivos: _iaImovel.itens.length, campos: rel.preenchidos.length });
  } catch (err) {
    console.error('Cadastro com IA:', err);
    showInlineStatus('imovel-ia-status', `❌ Não consegui: ${escapeHtml(err.message)}`, 'error');
  }
}

// ---------- aplicar no formulário ----------
const _rotuloCampoIA = {
  'imovel-apelido': 'Apelido', 'imovel-tipo': 'Tipo', 'imovel-subtipo': 'Subtipo', 'imovel-finalidade': 'Finalidade',
  'imovel-cep': 'CEP', 'imovel-logradouro': 'Rua', 'imovel-numero': 'Número', 'imovel-complemento': 'Complemento',
  'imovel-bairro': 'Bairro', 'imovel-cidade': 'Cidade', 'imovel-uf': 'UF', 'imovel-area-util': 'Área útil',
  'imovel-area-total': 'Área total', 'imovel-andar': 'Andar', 'imovel-quartos': 'Quartos', 'imovel-banheiros': 'Banheiros',
  'imovel-vagas': 'Vagas', 'imovel-mobiliado': 'Mobiliado', 'imovel-valor-venda': 'Valor de venda',
  'imovel-aluguel-sugerido': 'Aluguel', 'imovel-valor-condominio': 'Condomínio', 'imovel-valor-iptu': 'IPTU (valor)',
  'imovel-aceita-financiamento': 'Financiamento', 'imovel-permite-fgts': 'FGTS', 'imovel-aceita-permuta': 'Permuta',
  'imovel-permuta-obs': 'Obs. da permuta', 'imovel-matricula': 'Matrícula', 'imovel-iptu': 'Inscrição do IPTU',
  'imovel-video-url': 'Vídeo', 'imovel-tour-url': 'Tour virtual', 'imovel-obs': 'Observações internas',
  'imovel-titulo-anuncio': 'Título do anúncio', 'imovel-descricao-longa': 'Descrição do anúncio',
};

async function aplicarResultadoIA(r, substituir) {
  const c = r?.campos || {}, e = c.endereco || {}, a = r?.anuncio || {};
  const incertos = new Set((r?.incertos || []).map(String));
  const rel = { preenchidos: [], mantidos: [] };
  const vazio = (el) => {
    if (el.tagName === 'SELECT') return false; // selects sempre têm valor: decide pelo padrão abaixo
    return String(el.value ?? '').trim() === '' || (el.type === 'number' && Number(el.value) === 0);
  };
  const por = (id, valor, chave) => {
    const el = $(id);
    if (!el || valor === null || valor === undefined || valor === '') return;
    let v = valor;
    if (el.tagName === 'SELECT') {
      v = String(valor).toLowerCase();
      if (![...el.options].some((o) => o.value === v)) return;
      const padrao = el.dataset.iaPadrao ?? el.options[0]?.value;
      if (!substituir && el.value !== padrao && el.value !== v) { rel.mantidos.push(_rotuloCampoIA[id] || id); return; }
      if (el.value === v) return;
    } else if (!substituir && !vazio(el)) {
      const atual = String(el.value).trim(), ia = String(valor).trim();
      const mesmoNumero = ia !== '' && !isNaN(Number(ia)) && !isNaN(Number(atual)) && Number(ia) === Number(atual);
      if (atual !== ia && !mesmoNumero) rel.mantidos.push(_rotuloCampoIA[id] || id);
      return;
    }
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const grupo = el.closest('.form-group') || el.parentElement;
    if (grupo) { grupo.classList.add('campo-ia'); grupo.classList.toggle('campo-ia-duvida', incertos.has(chave)); }
    rel.preenchidos.push(_rotuloCampoIA[id] || id);
  };
  por('imovel-apelido', c.apelido, 'apelido');
  por('imovel-tipo', c.tipo, 'tipo');
  por('imovel-subtipo', c.subtipo, 'subtipo');
  por('imovel-finalidade', c.finalidade, 'finalidade');
  por('imovel-cep', e.cep ? String(e.cep).replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2') : null, 'endereco.cep');
  por('imovel-logradouro', e.logradouro, 'endereco.logradouro');
  por('imovel-numero', e.numero, 'endereco.numero');
  por('imovel-complemento', e.complemento, 'endereco.complemento');
  por('imovel-bairro', e.bairro, 'endereco.bairro');
  por('imovel-cidade', e.cidade, 'endereco.cidade');
  por('imovel-uf', e.uf ? String(e.uf).toUpperCase().slice(0, 2) : null, 'endereco.uf');
  por('imovel-area-util', c.areaUtil, 'areaUtil');
  por('imovel-area-total', c.areaTotal, 'areaTotal');
  por('imovel-andar', c.andar, 'andar');
  por('imovel-quartos', c.quartos, 'quartos');
  por('imovel-banheiros', c.banheiros, 'banheiros');
  por('imovel-vagas', c.vagas, 'vagas');
  por('imovel-mobiliado', c.mobiliado, 'mobiliado');
  por('imovel-valor-venda', c.valorVenda, 'valorVenda');
  por('imovel-aluguel-sugerido', c.aluguelSugerido, 'aluguelSugerido');
  por('imovel-valor-condominio', c.valorCondominio, 'valorCondominio');
  por('imovel-valor-iptu', c.valorIPTU, 'valorIPTU');
  por('imovel-aceita-financiamento', c.aceitaFinanciamento, 'aceitaFinanciamento');
  por('imovel-permite-fgts', c.permiteFGTS, 'permiteFGTS');
  por('imovel-aceita-permuta', c.aceitaPermuta, 'aceitaPermuta');
  por('imovel-permuta-obs', c.permutaObs, 'permutaObs');
  por('imovel-matricula', c.matricula, 'matricula');
  por('imovel-iptu', c.iptu, 'iptu');
  por('imovel-video-url', c.videoUrl, 'videoUrl');
  por('imovel-tour-url', c.tourUrl, 'tourUrl');
  por('imovel-obs', c.obs, 'obs');
  por('imovel-titulo-anuncio', a.titulo, 'titulo');
  por('imovel-descricao-longa', a.descricao, 'descricao');
  if (typeof contarTituloAnuncio === 'function') contarTituloAnuncio();
  // tags: soma às que já existem
  const antes = (_imovelTags || []).length;
  (a.tags || []).slice(0, 10).forEach((t) => adicionarTagImovel(t));
  if ((_imovelTags || []).length > antes) rel.preenchidos.push(`Tags (+${_imovelTags.length - antes})`);
  // proprietário: já cadastrado → seleciona; senão cadastra sozinho (só na 1ª leitura, não no "Usar o da IA")
  rel.proprietario = await _acharProprietarioIA(r?.proprietario);
  if (!substituir && rel.proprietario && !rel.proprietario.achado) {
    try { rel.proprietario.criado = await _cadastrarProprietarioAutoIA(r.proprietario); }
    catch (err) { console.error('IA: cadastro automático do proprietário', err); rel.proprietario.erroAuto = err.message; }
  }
  // corretores achados no material → pré-cadastro pendente (sem login) em Corretores
  if (substituir) rel.corretores = _iaImovel.ultimoRel?.corretores || [];
  else {
    try { rel.corretores = await _cadastrarCorretoresIA(r?.corretores); }
    catch (err) { console.error('IA: pré-cadastro de corretores', err); rel.corretores = [{ nome: 'Corretores', status: 'erro', erro: err.message }]; }
  }
  return rel;
}

// ---------- cadastro automático (21/10/2026): proprietário e corretores que estão no material ----------
const _digIA = (s) => String(s || '').replace(/\D/g, '');

// Proprietário/vendedor que não está cadastrado: grava pelo gravar() (perfil decide: grava, fila ou recusa).
// 🔓 Sem CPF/CNPJ pode (fica "CPF pendente"); o contrato é que não sai sem ele.
async function _cadastrarProprietarioAutoIA(p) {
  const nome = String(p?.nome || '').trim();
  if (!nome) return null;
  const doc = _digIA(p.documento);
  const docOk = doc.length === 14 ? isCNPJValid(doc) : doc.length === 11 ? isCPFValid(doc) : false;
  const tipo = (docOk && doc.length === 14) || String(p.tipo || '').toUpperCase() === 'PJ' ? 'PJ' : 'PF';
  const fin = $('imovel-finalidade')?.value;
  const papeis = fin === 'venda' ? { locador: false, vendedor: true } : fin === 'locacao' ? { locador: true, vendedor: false } : { locador: true, vendedor: true };
  const agora = firebase.firestore.FieldValue.serverTimestamp();
  const dados = {
    tipo, nome, papeis,
    documento: docOk ? doc : null, documentoPendente: !docOk,
    rg: null, nascimento: null, estadoCivil: null, profissao: null, nacionalidade: tipo === 'PF' ? 'Brasileira' : null,
    email: p.email ? String(p.email).trim().toLowerCase() : null,
    telefone: _digIA(p.telefone) || null,
    endereco: { cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null },
    pix: null, banco: null, dadosBancarios: null,
    obs: `Cadastrado pela IA a partir do material do imóvel${doc && !docOk ? ` — o documento lido ("${String(p.documento).slice(0, 30)}") não confere, conferir` : ''}.`,
    administradoTerceiros: false, representante: null,
    origem: 'ia-cadastro-imovel', criadoEm: agora, criadoPor: State.user.uid, atualizadoEm: agora,
  };
  const r = await gravar({ modulo: 'locadores', colecao: 'locadores', op: 'criar', dados, titulo: `Proprietário ${nome}` });
  invalidateLocadoresCache();
  if (r.pendente) return { pendente: true, nome };
  if (typeof logAuditoria === 'function') logAuditoria('create', 'locador', r.id, { nome, origem: 'ia-cadastro-imovel', semDocumento: !docOk });
  const sel = $('imovel-locador');
  if (sel) {
    const atual = sel.value;
    await populateLocadorSelect(sel, atual || r.id);
    if (!atual) {
      sel.value = r.id; sel.dispatchEvent(new Event('change', { bubbles: true }));
      (sel.closest('.form-group') || sel.parentElement)?.classList.add('campo-ia');
    }
  }
  return { id: r.id, nome, semDoc: !docOk, docInvalido: !!doc && !docOk };
}

// Corretores do material: quem já está em Corretores só é apontado; o novo entra como pré-cadastro
// PENDENTE, sem login e sem e-mail (o acesso só nasce em Corretores → 🔑 Criar acesso).
// Corretores é tela só da imobiliária (blindagem): corretor logado não grava nem lê colegas.
async function _cadastrarCorretoresIA(lista) {
  lista = (Array.isArray(lista) ? lista : []).filter((c) => c && String(c.nome || '').trim()).slice(0, 10);
  if (!lista.length) return [];
  const pode = typeof podeVerSecao === 'function' && podeVerSecao('corretores') && nivelPermissao('corretores', 'criar') === 'sim';
  if (!pode) return lista.map((c) => ({ nome: String(c.nome).trim(), status: 'sem_permissao' }));
  const existentes = (await tenantPath().collection('corretores').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const out = [];
  for (const c of lista) {
    const nome = String(c.nome).trim();
    const creci = _digIA(c.creci), tel = _digIA(c.telefone), email = String(c.email || '').trim().toLowerCase();
    const achado = existentes.find((e) => (creci && _digIA(e.creci) === creci)
      || (email && String(e.email || '').toLowerCase() === email)
      || (tel.length >= 10 && _digIA(e.telefone).length >= 10 && _digIA(e.telefone).slice(-9) === tel.slice(-9))
      || _normNome(e.nome) === _normNome(nome));
    if (achado) { out.push({ nome: achado.nome || nome, status: 'existe', situacao: achado.status, semConta: !!achado.semConta }); continue; }
    const dados = {
      nome, email: email || null, telefone: tel || null, creci: c.creci ? String(c.creci).trim() : null,
      imobiliaria: c.imobiliaria ? String(c.imobiliaria).trim() : null,
      tipo: 'parceiro', status: 'pendente', semConta: true, origem: 'ia-cadastro-imovel',
      imovelOrigem: $('imovel-apelido')?.value.trim() || null,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(), criadoPor: State.user.uid,
    };
    const ref = await tenantPath().collection('corretores').add(dados);
    existentes.push({ id: ref.id, ...dados });
    if (typeof logAuditoria === 'function') logAuditoria('create', 'corretor', ref.id, { nome, origem: 'ia-cadastro-imovel', semConta: true });
    out.push({ nome, status: 'criado' });
  }
  if (out.some((o) => o.status === 'criado') && typeof atualizarBadgeCorretoresPendentes === 'function') atualizarBadgeCorretoresPendentes();
  return out;
}

// Abre o cadastro do proprietário por cima do modal do imóvel; ao fechar, atualiza a lista do imóvel
function completarProprietarioIA(id) {
  _locadorPorCimaIA(() => openLocadorModal(id));
}
async function _locadorPorCimaIA(abrir, aoFechar) {
  await abrir();
  const m = $('modal-locador'); if (m) m.style.zIndex = '1200';   // por cima do modal do imóvel
  const vigia = setInterval(async () => {
    if (m && m.style.display !== 'none') return;
    clearInterval(vigia);
    if (m) m.style.zIndex = '';
    if (typeof invalidateLocadoresCache === 'function') invalidateLocadoresCache();
    const sel = $('imovel-locador');
    await populateLocadorSelect(sel, sel.value || null);
    if (aoFechar) await aoFechar();
  }, 700);
}

// "Ver em Corretores": a seção fica atrás do modal do imóvel — avisa antes de sair do cadastro
async function abrirCorretoresIA() {
  if (!(await confirmar({ titulo: 'Ir para Corretores?', mensagem: 'O cadastro do imóvel que está aberto será fechado. Salve antes se ainda não salvou.', confirmar: '👥 Ir para Corretores', cancelar: 'Ficar aqui' }))) return;
  closeImovelModal();
  showSection('corretores');
}

const _normNome = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
async function _acharProprietarioIA(p) {
  if (!p || !(p.nome || p.telefone || p.documento || p.email)) return null;
  let locs = [];
  try { locs = await ensureLocadoresCache(); } catch (_) {}
  const dig = (s) => String(s || '').replace(/\D/g, '');
  const achado = locs.find((l) => (p.documento && dig(l.documento || l.cpf || l.cnpj) && dig(l.documento || l.cpf || l.cnpj) === dig(p.documento))
    || (p.telefone && dig(l.telefone).length >= 10 && dig(l.telefone).slice(-9) === dig(p.telefone).slice(-9))
    || (p.email && l.email && l.email.toLowerCase() === String(p.email).toLowerCase())
    || (p.nome && _normNome(l.nome) === _normNome(p.nome)));
  const sel = $('imovel-locador');
  if (achado && sel && !sel.value && [...sel.options].some((o) => o.value === achado.id)) {
    sel.value = achado.id; sel.dispatchEvent(new Event('change', { bubbles: true }));
    (sel.closest('.form-group') || sel.parentElement)?.classList.add('campo-ia');
  }
  return { dados: p, achado: achado || null };
}

// Proprietário que não está cadastrado: abre o cadastro de locador já preenchido
// (reserva do automático: perfil sem permissão ou erro ao gravar)
async function cadastrarProprietarioIA() {
  const p = _iaImovel.resultado?.proprietario;
  if (!p) return;
  const pre = (id, v) => { const el = $(id); if (el && v && !el.value) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
  // quando o cadastro fechar, atualiza a lista do imóvel e seleciona o novo proprietário
  await _locadorPorCimaIA(async () => {
    await openLocadorModal();
    pre('locador-nome', p.nome); pre('locador-documento', p.documento); pre('locador-email', p.email);
    pre('locador-telefone', p.telefone && typeof maskTelefone === 'function' ? maskTelefone(p.telefone) : p.telefone);
  }, async () => {
    const rel = await _acharProprietarioIA(p);
    renderResultadoIA(_iaImovel.resultado, { ...(_iaImovel.ultimoRel || {}), proprietario: rel });
  });
}

// ---------- fotos do imóvel para a galeria ----------
async function usarFotosIA(auto) {
  const marcados = auto ? null : Array.from(document.querySelectorAll('.ia-foto-chk:checked')).map((c) => c.value);
  // automático: as fotos do imóvel sem pessoas/placas (as outras ficam para o usuário decidir)
  const fotos = auto
    ? (_iaImovel.resultado?.arquivos || []).filter((x) => x.tipo === 'foto_imovel' && !x.privacidade)
        .map((x) => _iaImovel.itens[x.indice]).filter((it) => it && it.thumb && !it.enviado)
    : _iaImovel.itens.filter((i) => marcados.includes(i.id) && !i.enviado);
  if (!fotos.length) { if (!auto) showInlineStatus('imovel-ia-status', '⚠️ Marque as fotos que vão para a galeria (as já enviadas não repetem).', 'error', 5000); return null; }
  const input = $('imovel-foto-input');
  if (!input || typeof uploadImovelFotos !== 'function') return null;
  const dt = new DataTransfer();
  fotos.forEach((f) => dt.items.add(f.file));
  input.files = dt.files;
  const btn = $('btn-ia-fotos');
  let ok = false;
  await drgSubmit(btn, `⏳ Enviando ${fotos.length} foto(s)… aguarde`, async () => { ok = await uploadImovelFotos(); }, { destravar: true });
  if (ok) {
    fotos.forEach((f) => { f.enviado = true; });
    document.querySelectorAll('.ia-foto-chk').forEach((c) => { if (fotos.some((f) => f.id === c.value)) { c.checked = true; c.disabled = true; } });
    if (btn) { btn.textContent = `✓ ${fotos.length} foto(s) na galeria`; btn.disabled = true; }
  }
  return ok ? fotos.length : false;
}

// ---------- documentos do material → "Documentos legais" do imóvel (não vão ao site) ----------
async function usarDocumentosIA(auto) {
  const marcados = auto ? null : Array.from(document.querySelectorAll('.ia-doc-chk:checked')).map((c) => c.value);
  // automático: só o que a IA classificou como documento (matrícula, IPTU, ficha…); print fica a critério
  const docs = auto
    ? (_iaImovel.resultado?.arquivos || []).filter((x) => x.tipo === 'documento')
        .map((x) => _iaImovel.itens[x.indice]).filter((it) => it && it.mimeType !== 'text/plain' && !it.enviado)
    : _iaImovel.itens.filter((i) => marcados.includes(i.id) && !i.enviado);
  if (!docs.length) { if (!auto) showInlineStatus('imovel-ia-status', '⚠️ Marque os documentos que vão ficar guardados no imóvel (os já guardados não repetem).', 'error', 5000); return null; }
  const input = $('imovel-doc-input');
  if (!input || typeof uploadImovelDocs !== 'function') return null;
  // print colado chega como "image.png": nomes repetidos se sobrescreveriam no Storage
  const usados = new Set();
  const dt = new DataTransfer();
  docs.forEach((d, i) => {
    let nome = d.file.name && d.file.name !== 'image.png' ? d.file.name : `print-${Date.now()}-${i + 1}.png`;
    if (usados.has(nome)) nome = nome.replace(/(\.[^.]*)?$/, `-${i + 1}$1`);
    usados.add(nome);
    dt.items.add(nome === d.file.name ? d.file : new File([d.file], nome, { type: d.file.type }));
  });
  input.files = dt.files;
  const btn = $('btn-ia-docs');
  let ok = false;
  await drgSubmit(btn, `⏳ Guardando ${docs.length} documento(s)… aguarde`, async () => { ok = await uploadImovelDocs(); }, { destravar: true });
  if (ok) {
    docs.forEach((d) => { d.enviado = true; });
    document.querySelectorAll('.ia-doc-chk').forEach((c) => { if (docs.some((d) => d.id === c.value)) { c.checked = true; c.disabled = true; } });
    if (btn) { btn.textContent = `✓ ${docs.length} documento(s) guardado(s)`; btn.disabled = true; }
  }
  return ok ? docs.length : false;
}

// Depois da leitura: fotos do imóvel → galeria e documentos → Documentos, sem clicar de novo
// (dono, 21/10/2026: "se eu já anexei as imagens lá atrás, pq precisa aqui novamente?")
async function anexarAutomaticoIA() {
  const msgs = [];
  const f = await usarFotosIA(true);
  if (f) msgs.push(`📷 ${f} foto(s) já na galeria do imóvel`);
  else if (f === false) msgs.push('⚠️ as fotos não subiram (veja o aviso no topo) — use “📷 Adicionar à galeria” abaixo');
  const d = await usarDocumentosIA(true);
  if (d) msgs.push(`📎 ${d} documento(s) guardado(s) no imóvel`);
  else if (d === false) msgs.push('⚠️ os documentos não subiram — use “📎 Guardar no imóvel” abaixo');
  if (msgs.length) showInlineStatus('imovel-ia-status', msgs.join(' · '), msgs.some((m) => m.startsWith('⚠️')) ? 'error' : 'success', 12000);
}

// Atalho do quadro da IA para as seções de anexos no fim do cadastro
function irParaSecaoImovel(id) {
  const el = $(id);
  if (!el) return;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- resumo do que a IA fez ----------
function renderResultadoIA(r, rel) {
  _iaImovel.ultimoRel = rel;
  const out = $('imovel-ia-resultado');
  if (!out) return;
  const arqs = Array.isArray(r?.arquivos) ? r.arquivos : [];
  const fotos = arqs.filter((x) => x.tipo === 'foto_imovel').map((x) => ({ ...x, item: _iaImovel.itens[x.indice] })).filter((x) => x.item && x.item.thumb);
  // documentos e prints (PDF/imagem; .txt não): o arquivo original vai para Documentos do imóvel
  const docsIA = arqs.filter((x) => x.tipo === 'documento' || x.tipo === 'print_anuncio')
    .map((x) => ({ ...x, item: _iaImovel.itens[x.indice] }))
    .filter((x) => x.item && x.item.mimeType !== 'text/plain');
  const p = rel.proprietario;
  const linhaDono = !p ? '' : p.achado
    ? `<div class="ia-linha">👤 Proprietário: <strong>${escapeHtml(p.achado.nome || '')}</strong> — já cadastrado, selecionado no campo Locador.</div>`
    : p.criado?.pendente
    ? `<div class="ia-linha">🕓 Proprietário <strong>${escapeHtml(p.criado.nome)}</strong> — cadastro enviado para aprovação (seu perfil cria "com aprovação"). Depois de aprovado, selecione-o no campo Locador.</div>`
    : p.criado?.id
    ? `<div class="ia-linha">✓ Proprietário <strong>${escapeHtml(p.criado.nome)}</strong> cadastrado automaticamente e selecionado no campo Locador${p.criado.semDoc ? ` — <strong style="color:#92400E;">⚠️ sem CPF/CNPJ${p.criado.docInvalido ? ' válido' : ''}: complete antes do contrato</strong>` : ''}.
        <button type="button" class="btn btn-secondary btn-sm" onclick="completarProprietarioIA('${p.criado.id}')">✏️ ${p.criado.semDoc ? 'Completar cadastro' : 'Ver cadastro'}</button></div>`
    : `<div class="ia-linha">👤 Proprietário encontrado: <strong>${escapeHtml(p.dados.nome || 'sem nome')}</strong>${p.dados.telefone ? ' · ' + escapeHtml(p.dados.telefone) : ''} — ainda não cadastrado${p.erroAuto ? ` (não consegui cadastrar sozinho: ${escapeHtml(p.erroAuto)})` : ''}.
        <button type="button" class="btn btn-secondary btn-sm" onclick="cadastrarProprietarioIA()">➕ Cadastrar proprietário</button></div>`;
  const cs = rel.corretores || [];
  const criados = cs.filter((c) => c.status === 'criado'), jaTem = cs.filter((c) => c.status === 'existe'),
        semPerm = cs.filter((c) => c.status === 'sem_permissao'), erroCor = cs.find((c) => c.status === 'erro');
  const nomes = (l) => l.map((c) => `<strong>${escapeHtml(c.nome)}</strong>`).join(', ');
  const linhaCorretores = !cs.length ? '' : `
    ${criados.length ? `<div class="ia-linha">✓ Corretor(es) pré-cadastrado(s) em Corretores: ${nomes(criados)} — <em>pendente, sem acesso</em>. O login só nasce quando a imobiliária clicar em 🔑 Criar acesso.
        <button type="button" class="btn btn-secondary btn-sm" onclick="abrirCorretoresIA()">👥 Ver em Corretores</button></div>` : ''}
    ${jaTem.length ? `<div class="ia-linha">👥 Já está(ão) em Corretores: ${jaTem.map((c) => `<strong>${escapeHtml(c.nome)}</strong> (${c.semConta ? 'pré-cadastro, sem acesso' : escapeHtml(c.situacao || '—')})`).join(', ')}.</div>` : ''}
    ${semPerm.length ? `<div class="ia-linha">👥 Corretor(es) no material: ${nomes(semPerm)} — o cadastro de corretores é feito pela imobiliária.</div>` : ''}
    ${erroCor ? `<div class="ia-linha ia-aviso">❌ Não consegui pré-cadastrar os corretores: ${escapeHtml(erroCor.erro || '')}</div>` : ''}`;
  out.innerHTML = `
    <div class="ia-ok">✓ ${rel.preenchidos.length ? `A IA preencheu <strong>${rel.preenchidos.length}</strong> campo(s)` : 'A IA não achou campos novos para preencher'}. Os campos dela estão destacados em <span class="ia-marca">verde</span>${(r.incertos || []).length ? ' e os de dúvida em <span class="ia-marca duvida">amarelo</span>' : ''} — confira e clique em Salvar.</div>
    ${r.resumo ? `<div class="ia-linha">📝 ${escapeHtml(r.resumo)}</div>` : ''}
    ${linhaDono}
    ${linhaCorretores}
    ${rel.mantidos.length ? `<div class="ia-linha">✋ Mantive o que já estava preenchido em: ${escapeHtml(rel.mantidos.join(', '))}. <button type="button" class="btn btn-secondary btn-sm" onclick="substituirComIA()">Usar o da IA nesses também</button></div>` : ''}
    ${(r.conflitos || []).length ? `<div class="ia-linha ia-aviso">⚠️ Informações que não batem entre os arquivos: ${escapeHtml(r.conflitos.join(' · '))}</div>` : ''}
    ${fotos.length ? `<div class="ia-linha">📷 ${fotos.length} foto(s) do imóvel no material — vão sozinhas para a galeria (com marca d’água); as com ⚠️ pessoas/placas ficam de fora: marque e clique abaixo se quiser.
        <div class="ia-fotos">${fotos.map((f) => `<label class="ia-foto"><input type="checkbox" class="ia-foto-chk" value="${f.item.id}" ${f.item.enviado ? 'checked disabled' : f.privacidade ? '' : 'checked'}><img src="${f.item.thumb}" alt=""><span>${escapeHtml(f.ambiente || 'foto')}${f.privacidade ? ' · ⚠️ pessoas/placas' : ''}</span></label>`).join('')}</div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-ia-fotos" onclick="usarFotosIA()">📷 Adicionar à galeria do imóvel</button></div>` : ''}
    ${docsIA.length ? `<div class="ia-linha">📎 ${docsIA.length} documento(s)/print(s) no material — os documentos vão sozinhos para Documentos do imóvel (não aparecem no site); prints de anúncio, marque e clique abaixo se quiser guardar.
        <div class="ia-docs">${docsIA.map((d) => `<label class="ia-doc"><input type="checkbox" class="ia-doc-chk" value="${d.item.id}" ${d.item.enviado ? 'checked disabled' : d.tipo === 'documento' ? 'checked' : ''}> ${d.item.mimeType === 'application/pdf' ? '📄' : '🖼'} ${escapeHtml(d.item.nome)}</label>`).join('')}</div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-ia-docs" onclick="usarDocumentosIA()">📎 Guardar no imóvel</button></div>` : ''}
    ${(r.anuncio?.destaques || []).length ? `<div class="ia-linha">⭐ Destaques: ${escapeHtml(r.anuncio.destaques.join(' · '))}</div>` : ''}
    <div class="ia-linha"><button type="button" class="btn btn-primary btn-sm btn-ia" onclick="abrirGeradorAnuncio()">✨ Refinar o anúncio com as fotos e a região</button></div>`;
}

async function substituirComIA() {
  if (!_iaImovel.resultado) return;
  const rel = await aplicarResultadoIA(_iaImovel.resultado, true);
  renderResultadoIA(_iaImovel.resultado, rel);
}

// limpar os destaques quando o modal fecha/reabre
function _limparDestaquesIA() {
  document.querySelectorAll('#modal-imovel .campo-ia, #modal-imovel .campo-ia-duvida').forEach((g) => g.classList.remove('campo-ia', 'campo-ia-duvida'));
}

// O modal do imóvel abre limpo (novo = quadro da IA aberto; edição = fechado)
if (typeof openImovelModal === 'function') {
  const _abrirOriginal = openImovelModal;
  window.openImovelModal = async function (id, ...resto) {
    // Salvar um imóvel novo reabre o modal com o id criado: aí o resumo da IA (e as fotos a
    // enviar) continuam na tela. Abrir OUTRO imóvel limpa tudo.
    const mesmoImovel = _iaImovel.resultado && id && (_iaImovel.alvo === id || (_iaImovel.alvo === 'novo' && Date.now() - (_iaImovel.quando || 0) < 30 * 60 * 1000));
    if (mesmoImovel) {
      _iaImovel.alvo = id;
      const r = await _abrirOriginal.call(this, id, ...resto);
      const box = $('imovel-ia-box'); if (box) box.open = true;
      return r;
    }
    _limparDestaquesIA();
    resetCadastroIA(!id);
    ligarEntradaIA();
    return _abrirOriginal.call(this, id, ...resto);
  };
}

window.adicionarArquivosIA = adicionarArquivosIA;
window.removerArquivoIA = removerArquivoIA;
window.preencherImovelComIA = preencherImovelComIA;
window.cadastrarProprietarioIA = cadastrarProprietarioIA;
window.completarProprietarioIA = completarProprietarioIA;
window.usarDocumentosIA = usarDocumentosIA;
window.irParaSecaoImovel = irParaSecaoImovel;
window.abrirCorretoresIA = abrirCorretoresIA;
window.usarFotosIA = usarFotosIA;
window.substituirComIA = substituirComIA;
window.resetCadastroIA = resetCadastroIA;
