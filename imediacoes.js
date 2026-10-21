// =============================================================
// DRG-Rently — 📍 IMEDIAÇÕES DO IMÓVEL
// =============================================================
// Pedido do dono (17/10/2026): "ferramenta de buscar informações das imediações do imóvel,
// tipo até x quilômetros do imóvel". No modal do imóvel (seção Anúncio): raio à escolha,
// categorias marcáveis, lista com distância e tempo a pé (OpenStreetMap / Overpass, grátis).
// O que for marcado vira um texto (imoveis.imediacoesTexto, uma linha por ponto) que:
//   • pode entrar na descrição do anúncio (botão), e
//   • aparece na página pública do imóvel, em "📍 Nas imediações" (só se o bairro é mostrado).
// Distância em linha reta a partir do CEP/rua (nunca do número da casa) — aproximada.
// Carregado depois do anuncios.js (usa coordenadaDoImovel, distanciaMetros, textoDistancia).

const IMEDIACOES_CATEGORIAS = [
  { id: 'transporte', label: '🚇 Metrô / trem', sel: ['nwr["railway"~"^(station|subway_entrance)$"]', 'nwr["public_transport"="station"]'], t: (x) => x.railway === 'station' || x.railway === 'subway_entrance' || x.public_transport === 'station' },
  { id: 'onibus', label: '🚌 Terminal de ônibus', sel: ['nwr["amenity"="bus_station"]'], t: (x) => x.amenity === 'bus_station' },
  { id: 'escola', label: '🏫 Escola / creche', sel: ['nwr["amenity"~"^(school|kindergarten)$"]'], t: (x) => x.amenity === 'school' || x.amenity === 'kindergarten' },
  { id: 'faculdade', label: '🎓 Faculdade', sel: ['nwr["amenity"~"^(university|college)$"]'], t: (x) => x.amenity === 'university' || x.amenity === 'college' },
  { id: 'mercado', label: '🛒 Supermercado', sel: ['nwr["shop"="supermarket"]'], t: (x) => x.shop === 'supermarket' },
  { id: 'padaria', label: '🥖 Padaria', sel: ['nwr["shop"="bakery"]'], t: (x) => x.shop === 'bakery' },
  { id: 'shopping', label: '🛍 Shopping', sel: ['nwr["shop"="mall"]'], t: (x) => x.shop === 'mall' },
  { id: 'farmacia', label: '💊 Farmácia', sel: ['nwr["amenity"="pharmacy"]'], t: (x) => x.amenity === 'pharmacy' },
  { id: 'saude', label: '🏥 Hospital / clínica / UBS', sel: ['nwr["amenity"~"^(hospital|clinic|doctors)$"]'], t: (x) => ['hospital', 'clinic', 'doctors'].includes(x.amenity) },
  { id: 'parque', label: '🌳 Parque / praça', sel: ['nwr["leisure"~"^(park|playground)$"]'], t: (x) => x.leisure === 'park' || x.leisure === 'playground' },
  { id: 'academia', label: '🏋️ Academia / esporte', sel: ['nwr["leisure"~"^(fitness_centre|sports_centre)$"]'], t: (x) => x.leisure === 'fitness_centre' || x.leisure === 'sports_centre' },
  { id: 'restaurante', label: '🍽 Restaurante', sel: ['nwr["amenity"~"^(restaurant|cafe)$"]'], t: (x) => x.amenity === 'restaurant' || x.amenity === 'cafe' },
  { id: 'banco', label: '🏦 Banco', sel: ['nwr["amenity"="bank"]'], t: (x) => x.amenity === 'bank' },
  { id: 'posto', label: '⛽ Posto de combustível', sel: ['nwr["amenity"="fuel"]'], t: (x) => x.amenity === 'fuel' },
  { id: 'pet', label: '🐾 Pet shop / veterinário', sel: ['nwr["shop"="pet"]', 'nwr["amenity"="veterinary"]'], t: (x) => x.shop === 'pet' || x.amenity === 'veterinary' },
  { id: 'correios', label: '✉️ Correios', sel: ['nwr["amenity"="post_office"]'], t: (x) => x.amenity === 'post_office' },
  { id: 'seguranca', label: '🚓 Delegacia', sel: ['nwr["amenity"="police"]'], t: (x) => x.amenity === 'police' },
];
const IMEDIACOES_PADRAO = ['transporte', 'onibus', 'escola', 'faculdade', 'mercado', 'padaria', 'shopping', 'farmacia', 'saude', 'parque', 'academia'];
const IMEDIACOES_RAIOS = [[300, '300 m'], [500, '500 m'], [1000, '1 km'], [2000, '2 km'], [3000, '3 km'], [5000, '5 km']];
const IMEDIACOES_POR_CATEGORIA = 5;

let _imed = { centro: null, resultados: [], texto: '', raio: 1000 };

// ---------- busca (OpenStreetMap / Overpass) ----------
async function buscarImediacoes(centro, raio, catIds) {
  const cats = IMEDIACOES_CATEGORIAS.filter((c) => catIds.includes(c.id));
  const linhas = cats.flatMap((c) => c.sel.map((s) => `${s}(around:${raio},${centro.lat},${centro.lng})["name"];`));
  const q = `[out:json][timeout:60];(\n${linhas.join('\n')}\n);out center 600;`;
  // Espelhos públicos do Overpass. Em 21/10/2026: overpass-api.de dava 406/502 na hora,
  // private.coffee e kumi ficavam 70 s pendurados e só o mail.ru respondia (~12 s).
  // Antes era um por vez: um espelho pendurado comia o prazo inteiro antes de chegar no que
  // funcionava. Agora largam escalonados (3 s entre um e outro); vale o 1º que responder,
  // os demais são cancelados.
  const servidores = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const PRAZO = 100000;
  const ctls = servidores.map(() => new AbortController());
  const tentar = async (srv, i) => {
    await new Promise((res) => setTimeout(res, i * 3000));
    if (ctls[i].signal.aborted) throw new Error('cancelado');
    const r = await fetch(srv, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctls[i].signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j.elements)) throw new Error('resposta sem dados');
    return j.elements;
  };
  const timer = setTimeout(() => ctls.forEach((c) => c.abort()), PRAZO);
  let elementos = null;
  try { elementos = await Promise.any(servidores.map(tentar)); }
  catch (_) { /* todos falharam */ }
  finally { clearTimeout(timer); ctls.forEach((c) => c.abort()); }
  if (!elementos) throw new Error('o serviço de mapas (OpenStreetMap) não respondeu — tente de novo em instantes');
  const porCat = new Map();
  for (const e of elementos) {
    const tags = e.tags || {};
    const pos = e.lat != null ? { lat: e.lat, lng: e.lon } : (e.center ? { lat: e.center.lat, lng: e.center.lon } : null);
    if (!pos || !tags.name) continue;
    const cat = cats.find((c) => c.t(tags));
    if (!cat) continue;
    const lista = porCat.get(cat.id) || [];
    lista.push({ cat: cat.id, nome: String(tags.name).slice(0, 80), dist: distanciaMetros(centro, pos), lat: pos.lat, lng: pos.lng });
    porCat.set(cat.id, lista);
  }
  const saida = [];
  for (const c of cats) {
    const vistos = new Set();
    (porCat.get(c.id) || []).sort((a, b) => a.dist - b.dist).forEach((p) => {
      const chave = p.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(metro|estacao|station)\b/g, '').replace(/[^a-z0-9]/g, '');
      if (vistos.has(chave) || vistos.size >= IMEDIACOES_POR_CATEGORIA) return;
      vistos.add(chave);
      saida.push(p);
    });
  }
  return saida;
}

// ---------- tela ----------
function renderPainelImediacoes() {
  const box = $('imovel-imediacoes');
  if (!box) return;
  box.innerHTML = `
    <details class="imed-box" id="imed-box" ${_imed.texto ? 'open' : ''}>
      <summary>📍 <strong>Imediações do imóvel</strong> <span class="muted" style="font-size:12px;">— escolas, transporte, comércio… num raio que você escolhe</span>${_imed.texto ? ` <span class="imed-badge">${_imed.texto.split('\n').filter(Boolean).length} no anúncio</span>` : ''}</summary>
      <div class="imed-corpo">
        <div class="imed-linha">
          <label for="imed-raio">Até</label>
          <select id="imed-raio">${IMEDIACOES_RAIOS.map(([v, t]) => `<option value="${v}" ${v === _imed.raio ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <span class="muted" style="font-size:12px;">do imóvel (pelo CEP/rua — nunca pelo número)</span>
        </div>
        <div class="imed-cats">${IMEDIACOES_CATEGORIAS.map((c) => `<label class="imed-cat"><input type="checkbox" class="imed-cat-chk" value="${c.id}" ${IMEDIACOES_PADRAO.includes(c.id) ? 'checked' : ''}> ${c.label}</label>`).join('')}</div>
        <div class="imed-linha"><button type="button" class="btn btn-primary btn-sm" id="btn-imed-buscar" onclick="buscarImediacoesDoImovel()">🔍 Buscar imediações</button>
          <span class="muted" style="font-size:12px;">Dados do OpenStreetMap; distâncias em linha reta, aproximadas.</span></div>
        <div id="imed-status"></div>
        <div id="imed-resultado"></div>
        ${_imed.texto ? `<div class="imed-salvo"><strong>No anúncio hoje</strong> (aparece na página do imóvel):<pre>${escapeHtml(_imed.texto)}</pre>
          <button type="button" class="btn btn-secondary btn-sm" onclick="limparImediacoes()">🗑 Tirar do anúncio</button></div>` : ''}
      </div>
    </details>`;
}

async function buscarImediacoesDoImovel() {
  const btn = $('btn-imed-buscar');
  const raio = Number($('imed-raio').value) || 1000;
  const cats = Array.from(document.querySelectorAll('.imed-cat-chk:checked')).map((c) => c.value);
  if (!cats.length) { showInlineStatus('imed-status', '⚠️ Marque pelo menos uma categoria.', 'error', 5000); return; }
  try {
    const r = await drgSubmit(btn, '⏳ Buscando… aguarde até 1 min', async () => {
      showInlineStatus('imed-status', '📍 Localizando o imóvel no mapa…', 'loading');
      const centro = await coordenadaDoImovel();
      if (!centro) throw new Error('não achei o imóvel no mapa — preencha o CEP (ou rua e cidade) e tente de novo');
      showInlineStatus('imed-status', `🗺 Procurando num raio de ${raio >= 1000 ? raio / 1000 + ' km' : raio + ' m'}… o serviço de mapas é gratuito e às vezes demora até 1 minuto.`, 'loading');
      return { centro, lista: await buscarImediacoes(centro, raio, cats) };
    }, { destravar: true });
    if (r === DRG_IGNORADO) return;
    _imed.centro = r.centro; _imed.resultados = r.lista; _imed.raio = raio;
    clearInlineStatus('imed-status');
    renderResultadoImediacoes();
  } catch (err) {
    showInlineStatus('imed-status', `❌ ${escapeHtml(err.message)}`, 'error');
  }
}

function _linhaImediacao(p) {
  const cat = IMEDIACOES_CATEGORIAS.find((c) => c.id === p.cat);
  const rotulo = (cat ? cat.label.replace(/^\S+\s/, '') : 'Ponto');
  return `${rotulo}: ${p.nome} — ${textoDistancia(p.dist)}`;
}

function renderResultadoImediacoes() {
  const out = $('imed-resultado');
  const lista = _imed.resultados;
  if (!lista.length) { out.innerHTML = '<p class="muted" style="font-size:13px;">Nada encontrado nesse raio com essas categorias. Aumente o raio ou marque mais categorias.</p>'; return; }
  const mapa = _imed.centro ? `https://www.openstreetmap.org/?mlat=${_imed.centro.lat}&mlon=${_imed.centro.lng}#map=15/${_imed.centro.lat}/${_imed.centro.lng}` : '';
  const grupos = IMEDIACOES_CATEGORIAS.map((c) => ({ c, itens: lista.filter((p) => p.cat === c.id) })).filter((g) => g.itens.length);
  out.innerHTML = `
    <p style="font-size:13px;margin:10px 0 6px;"><strong>${lista.length}</strong> ponto(s) encontrados.${mapa ? ` <a href="${mapa}" target="_blank" rel="noopener">🗺 Ver a região no mapa ↗</a>` : ''} Marque o que vai para o anúncio (os 2 mais perto de cada tipo já vêm marcados).</p>
    ${grupos.map((g) => `<div class="imed-grupo"><div class="imed-grupo-tit">${g.c.label}</div>
      ${g.itens.map((p, i) => `<label class="imed-item"><input type="checkbox" class="imed-item-chk" value="${lista.indexOf(p)}" ${i < 2 ? 'checked' : ''}>
        <span>${escapeHtml(p.nome)}</span><span class="imed-dist">${escapeHtml(textoDistancia(p.dist))}</span>
        <a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}" target="_blank" rel="noopener" title="Ver no mapa" aria-label="Ver ${escapeHtml(p.nome)} no mapa">🗺</a></label>`).join('')}</div>`).join('')}
    <div class="imed-linha" style="margin-top:10px;">
      <button type="button" class="btn btn-primary btn-sm" id="btn-imed-usar" onclick="usarImediacoes(false)">✓ Usar no anúncio (página do imóvel)</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="usarImediacoes(true)">✓ Usar e inserir na descrição</button>
    </div>`;
}

function usarImediacoes(naDescricao) {
  const idx = Array.from(document.querySelectorAll('.imed-item-chk:checked')).map((c) => Number(c.value));
  const escolhidos = idx.map((i) => _imed.resultados[i]).filter(Boolean).sort((a, b) => a.dist - b.dist);
  if (!escolhidos.length) { showInlineStatus('imed-status', '⚠️ Marque pelo menos um ponto.', 'error', 5000); return; }
  _imed.texto = escolhidos.slice(0, 30).map(_linhaImediacao).join('\n');
  if (naDescricao) {
    const ta = $('imovel-descricao-longa');
    const bloco = 'Nas imediações (distâncias aproximadas):\n' + escolhidos.slice(0, 12).map((p) => '• ' + _linhaImediacao(p)).join('\n');
    const atual = ta.value.replace(/\n*Nas imediações \(distâncias aproximadas\):[\s\S]*$/, '').trim();
    ta.value = (atual ? atual + '\n\n' : '') + bloco;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  renderPainelImediacoes();
  $('imed-box').open = true;
  showInlineStatus('imed-status', `✓ ${escolhidos.length} ponto(s) no anúncio${naDescricao ? ' e na descrição' : ''}. Clique em Salvar para gravar.`, 'success', 8000);
}

function limparImediacoes() {
  _imed.texto = '';
  renderPainelImediacoes();
  showInlineStatus('imed-status', '✓ Tirado do anúncio. Clique em Salvar para gravar.', 'success', 6000);
}

// ---------- ligar no modal do imóvel (abrir / salvar) ----------
if (typeof prepararAnuncioNoModalImovel === 'function') {
  const _prepOriginal = prepararAnuncioNoModalImovel;
  window.prepararAnuncioNoModalImovel = async function (id, ...resto) {
    const r = await _prepOriginal.call(this, id, ...resto);
    _imed = { centro: null, resultados: [], texto: '', raio: 1000 };
    if (id) {
      try {
        const s = await tenantPath().collection('imoveis').doc(id).get();
        const im = s.exists ? s.data() : {};
        _imed.texto = im.imediacoesTexto || '';
        _imed.raio = Number(im.imediacoesRaio) || 1000;
      } catch (_) {}
    }
    renderPainelImediacoes();
    return r;
  };
}
if (typeof lerAnuncioDoModalImovel === 'function') {
  const _lerOriginal = lerAnuncioDoModalImovel;
  window.lerAnuncioDoModalImovel = function (...a) {
    return { ..._lerOriginal.apply(this, a), imediacoesTexto: _imed.texto || null, imediacoesRaio: _imed.texto ? _imed.raio : null };
  };
}

window.buscarImediacoesDoImovel = buscarImediacoesDoImovel;
window.usarImediacoes = usarImediacoes;
window.limparImediacoes = limparImediacoes;
window.buscarImediacoes = buscarImediacoes;
