// =============================================================
// ✅ CARACTERÍSTICAS DO IMÓVEL (29/10/2026, o dono com os prints de Lazer, Social, Íntima,
// Armários, Acabamento, Destaques, Básico e Serviços: "acrescente isso nas características dos
// imóveis e opção de criar outras").
//  • Catálogo padrão (abaixo) + as criadas pela imobiliária em config/caracteristicas ({ extras }).
//  • O imóvel guarda `caracteristicas: ["Grupo › Item", …]` — o grupo vai junto porque há itens
//    com o mesmo nome em grupos diferentes ("Cozinha" em Armários e em Serviços).
//  • Criar: quem cadastra/edita imóvel na equipe. O corretor marca, mas não cria (ele não lê
//    config/ — as que ele marcar já vêm no próprio imóvel e aparecem normalmente).
// =============================================================
const CARAC_SEP = ' › ';
const CARAC_PADRAO = {
  'Lazer': ['Adega', 'Área de lazer', 'Área verde', 'Bar', 'Campo de futebol', 'Churrasqueira', 'Deck', 'Lazer no pilotis',
    'Ofurô', 'Piscina', 'Piscina infantil', 'Piscina privativa', 'Piscina aquecida', 'Quadra esportiva', 'Quadra de tênis',
    'Academia', 'Salão de festas', 'Salão gourmet', 'Salão de jogos', 'Sauna', 'Sauna privativa', 'SPA', 'Vestiário'],
  'Social': ['Estar íntimo', 'Sacada frente', 'Sacada fundo', 'Sacada lateral', 'Varanda', 'Varanda gourmet'],
  'Íntima': ['Suíte master', 'Lavabo', 'Banheira', 'Roupeiro'],
  'Armários': ['Banheiro', 'Closet', 'Cozinha', 'Dormitórios', 'Sala', 'Área de serviço'],
  'Acabamento': ['Assoalho', 'Carpete', 'Carpete madeira', 'Contra-piso', 'Granito', 'Laminado', 'Mármore', 'Piso frio',
    'Piso cerâmica', 'Porcelanato', 'Taco', 'Vinílico'],
  'Destaques': ['Aceita PET', 'Alarme', 'Aquecimento central', 'Aquecimento solar', 'Ar condicionado', 'Beira lago', 'Box',
    'Calefação', 'Chuveiro elétrico', 'Chuveiro a gás', 'Circuito para TV', 'Cobertura coletiva', 'Cooktop', 'Cortinas',
    'Decorado', 'Espera para split', 'Escritório', 'Forno', 'Frente para clube', 'Frente para mar', 'Frente para praça',
    'Interfone', 'Janela antirruído', 'Jardim', 'Lareira', 'Luz natural', 'Marina', 'Microondas', 'Mobiliado',
    'Móveis planejados', 'Persiana elétrica', 'Perto do metrô', 'Portão eletrônico', 'Quintal', 'Rua silenciosa',
    'Sistema incêndio', 'Sol da manhã', 'Sol da tarde', 'Split', 'Telefone', 'TV a cabo', 'Varal', 'Ventilador de teto', 'Vista livre'],
  'Básico': ['Acesso deficientes', 'Água', 'Água quente', 'Corrimão', 'Energia', 'Esgoto', 'Gradeado', 'Hidrômetro individual',
    'Piso tátil', 'Pavimentação', 'Rampas', 'Reformado'],
  'Serviços': ['Área de serviço', 'Automatizado', 'Banheiro auxiliar', 'Banheiro empregada', 'Copa', 'Cozinha',
    'Cozinha americana', 'Cozinha independente', 'Cozinha planejada', 'Dep. privativo subsolo', 'Despensa',
    'Dormitório empregada', 'Edícula', 'Elevador de serviço', 'Entrada de serviço', 'Espera para automação',
    'Fechadura eletrônica', 'Gabinete', 'Garagem para barco', 'Garagem fechada', 'Gás natural', 'Guarita', 'Hall',
    'Lavanderia', 'Portaria 24h', 'Rede de segurança', 'Terraço', 'Zelador'],
};
const CARAC_ICONE = { 'Lazer': '🏊', 'Social': '🛋', 'Íntima': '🛏', 'Armários': '🗄', 'Acabamento': '🧱', 'Destaques': '⭐',
  'Básico': '🔌', 'Serviços': '🧺', 'Outras': '➕' };

let _caracExtras = null;   // [{ grupo, nome }]
async function carregarCaracExtras(forcar) {
  if (_caracExtras && !forcar) return _caracExtras;
  try {
    const s = await tenantPath().collection('config').doc('caracteristicas').get();
    _caracExtras = Array.isArray((s.data() || {}).extras) ? s.data().extras : [];
  } catch (_) { _caracExtras = []; }   // corretor não lê config: fica só o padrão
  return _caracExtras;
}
// Catálogo completo: { grupo: [nomes] }, com as criadas no fim de cada grupo
function catalogoCarac(marcadas) {
  const cat = {};
  Object.entries(CARAC_PADRAO).forEach(([g, l]) => { cat[g] = l.slice(); });
  (_caracExtras || []).forEach((x) => { if (!x || !x.nome) return; const g = x.grupo || 'Outras'; (cat[g] = cat[g] || []); if (!cat[g].includes(x.nome)) cat[g].push(x.nome); });
  // marcadas que não estão no catálogo (vieram de outro aparelho, de criação apagada…): não somem
  (marcadas || []).forEach((id) => { const [g, n] = partesCarac(id); (cat[g] = cat[g] || []); if (!cat[g].includes(n)) cat[g].push(n); });
  return cat;
}
function partesCarac(id) {
  const i = String(id).indexOf(CARAC_SEP);
  return i < 0 ? ['Outras', String(id)] : [String(id).slice(0, i), String(id).slice(i + CARAC_SEP.length)];
}
const _normCarac = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const _escC = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Desenha a seção no modal do imóvel com as marcadas
async function renderCaracImovel(marcadas) {
  const box = document.getElementById('imovel-carac-box');
  if (!box) return;
  marcadas = Array.isArray(marcadas) ? marcadas : [];
  await carregarCaracExtras();
  const set = new Set(marcadas);
  const extras = new Set((_caracExtras || []).map((x) => (x.grupo || 'Outras') + CARAC_SEP + x.nome));
  const cat = catalogoCarac(marcadas);
  const podeCriar = typeof isCorretor === 'function' && !isCorretor()
    && (typeof nivelPermissao !== 'function' || nivelPermissao('imoveis', 'editar') !== 'nao' || nivelPermissao('imoveis', 'criar') !== 'nao');
  box.innerHTML = `
    <div class="carac-topo">
      <input type="search" id="carac-filtro" placeholder="🔎 Procurar (ex.: piscina, porcelanato, portaria)" oninput="filtrarCarac(this.value)" autocomplete="off">
      <span class="carac-conta" id="carac-conta"></span>
    </div>
    ${Object.entries(cat).map(([g, itens]) => {
      const n = itens.filter((i) => set.has(g + CARAC_SEP + i)).length;
      return `<details class="carac-grupo" data-grupo="${_escC(g)}"${n ? ' open' : ''}>
        <summary><span>${CARAC_ICONE[g] || '•'} ${_escC(g)}</span> <small class="carac-n">${n ? n + ' marcada(s)' : ''}</small></summary>
        <div class="carac-grade">${itens.map((i) => { const id = g + CARAC_SEP + i; return `
          <label class="carac-item" data-busca="${_escC(_normCarac(i))}"><input type="checkbox" class="carac-chk" value="${_escC(id)}"${set.has(id) ? ' checked' : ''} onchange="contarCarac()">
            <span>${_escC(i)}</span>${extras.has(id) && podeCriar ? `<button type="button" class="carac-del" title="Tirar do catálogo (os imóveis que já marcaram continuam com ela)" onclick="event.preventDefault();removerCaracExtra('${_escC(id).replace(/'/g, '&#39;')}', this)">✖</button>` : ''}</label>`; }).join('')}
        </div></details>`;
    }).join('')}
    ${podeCriar ? `<div class="carac-nova">
      <strong>➕ Criar característica</strong> <span class="muted">— entra no catálogo para todos os imóveis da imobiliária</span>
      <div class="carac-nova-linha">
        <input type="text" id="carac-nova-nome" maxlength="50" placeholder="Ex.: Pomar, Gerador, Heliponto">
        <select id="carac-nova-grupo">${Object.keys(cat).filter((g) => g !== 'Outras').concat(['Outras']).map((g) => `<option>${_escC(g)}</option>`).join('')}</select>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-carac-nova" onclick="criarCaracteristica(this)">➕ Criar e marcar</button>
      </div>
      <div id="carac-nova-status" class="status-inline" style="display:none;"></div>
    </div>` : ''}`;
  contarCarac();
}
function lerCaracImovel() {
  return [...document.querySelectorAll('#imovel-carac-box .carac-chk:checked')].map((c) => c.value);
}
function contarCarac() {
  const t = lerCaracImovel().length;
  const el = document.getElementById('carac-conta');
  if (el) el.textContent = t ? `✓ ${t} marcada(s)` : 'nenhuma marcada';
  document.querySelectorAll('#imovel-carac-box .carac-grupo').forEach((d) => {
    const n = d.querySelectorAll('.carac-chk:checked').length;
    const s = d.querySelector('.carac-n'); if (s) s.textContent = n ? n + ' marcada(s)' : '';
  });
}
function filtrarCarac(q) {
  const t = _normCarac(q);
  document.querySelectorAll('#imovel-carac-box .carac-grupo').forEach((d) => {
    let vis = 0;
    d.querySelectorAll('.carac-item').forEach((it) => { const ok = !t || it.dataset.busca.includes(t); it.style.display = ok ? '' : 'none'; if (ok) vis++; });
    d.style.display = vis ? '' : 'none';
    if (t && vis) d.open = true;
  });
}
// Marca itens pelo nome (IA): aceita "Grupo › Item" ou só "Item" (se o nome for único no catálogo)
function marcarCaracPorNome(lista) {
  let n = 0;
  const chks = [...document.querySelectorAll('#imovel-carac-box .carac-chk')];
  (Array.isArray(lista) ? lista : []).forEach((nome) => {
    const alvo = _normCarac(nome);
    let c = chks.find((x) => _normCarac(x.value) === alvo);
    if (!c) { const so = chks.filter((x) => _normCarac(partesCarac(x.value)[1]) === alvo); if (so.length === 1) c = so[0]; }
    if (c && !c.checked) { c.checked = true; n++; const d = c.closest('details'); if (d) d.open = true; }
  });
  contarCarac();
  return n;
}
// O catálogo inteiro, para a IA escolher daqui (o worker não inventa nome novo)
function catalogoCaracParaIA() {
  return Object.entries(catalogoCarac([])).flatMap(([g, l]) => l.map((i) => g + CARAC_SEP + i));
}

async function criarCaracteristica(btn) {
  const st = 'carac-nova-status';
  const nome = (document.getElementById('carac-nova-nome').value || '').trim().replace(/\s+/g, ' ');
  const grupo = document.getElementById('carac-nova-grupo').value || 'Outras';
  if (nome.length < 2) { showInlineStatus(st, '⚠️ Escreva o nome da característica.', 'error'); document.getElementById('carac-nova-nome').focus(); return; }
  if (nome.includes('›')) { showInlineStatus(st, '⚠️ Não use o sinal › no nome.', 'error'); return; }
  const cat = catalogoCarac(lerCaracImovel());
  const ja = Object.entries(cat).find(([, l]) => l.some((i) => _normCarac(i) === _normCarac(nome)));
  const marcadas = lerCaracImovel();
  if (ja) {
    const id = ja[0] + CARAC_SEP + ja[1].find((i) => _normCarac(i) === _normCarac(nome));
    await renderCaracImovel(marcadas.includes(id) ? marcadas : marcadas.concat([id]));
    showInlineStatus(st, `✓ "${_escC(nome)}" já existia em ${_escC(ja[0])} — foi marcada (não duplicamos).`, 'success', 5000);
    return;
  }
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Criando… aguarde';
  try {
    const ref = tenantPath().collection('config').doc('caracteristicas');
    await ref.set({ extras: firebase.firestore.FieldValue.arrayUnion({ grupo, nome }), atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    if (typeof logAuditoria === 'function') logAuditoria('create', 'caracteristica', grupo + CARAC_SEP + nome, { grupo, nome });
    await carregarCaracExtras(true);
    await renderCaracImovel(marcadas.concat([grupo + CARAC_SEP + nome]));
    showInlineStatus('carac-nova-status', `✓ "${_escC(nome)}" criada em ${_escC(grupo)} e marcada neste imóvel. Já aparece para todos os imóveis.`, 'success', 6000);
  } catch (err) {
    showInlineStatus(st, '❌ Não consegui criar: ' + _escC(err.message), 'error');
    btn.disabled = false; btn.textContent = original;
  }
}
async function removerCaracExtra(id, btn) {
  const [grupo, nome] = partesCarac(id);
  const ok = await confirmar({ titulo: 'Tirar do catálogo?', mensagem: `"<strong>${_escC(nome)}</strong>" deixa de aparecer para marcar.`,
    detalhe: 'Os imóveis que já marcaram continuam com ela.', confirmar: 'Tirar', aviso: true });
  if (!ok) return;
  btn.disabled = true; btn.textContent = '⏳';
  try {
    await carregarCaracExtras(true);
    const resto = (_caracExtras || []).filter((x) => !(x.grupo === grupo && x.nome === nome));
    await tenantPath().collection('config').doc('caracteristicas').set({ extras: resto, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    if (typeof logAuditoria === 'function') logAuditoria('delete', 'caracteristica', id, { grupo, nome });
    const marcadas = lerCaracImovel();
    await carregarCaracExtras(true);
    await renderCaracImovel(marcadas);
  } catch (err) {
    btn.disabled = false; btn.textContent = '✖';
    await confirmar({ titulo: 'Erro', mensagem: _escC(err.message), confirmar: 'OK' });
  }
}

window.renderCaracImovel = renderCaracImovel;
window.lerCaracImovel = lerCaracImovel;
window.contarCarac = contarCarac;
window.filtrarCarac = filtrarCarac;
window.marcarCaracPorNome = marcarCaracPorNome;
window.catalogoCaracParaIA = catalogoCaracParaIA;
window.criarCaracteristica = criarCaracteristica;
window.removerCaracExtra = removerCaracExtra;
