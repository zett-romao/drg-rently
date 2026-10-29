// =============================================================
// DRG-Rently — REDE DE CORRETORES
// =============================================================
// Carregado DEPOIS do app.js (usa $, tenantPath, confirmar, escapeHtml...).
//
// Modelo:
//   tenants/{tid}/corretores/{uid}            — cartão do corretor (nome, CRECI, tipo, status)
//   tenants/{tid}/config/rede                 — quais campos vão pra ficha + visibilidade padrão
//   tenants/{tid}/imoveisRede/{imovelId}      — FICHA: cópia do imóvel só com os campos liberados
//   tenants/{tid}/imoveisRede/{id}/completo/dados — ficha COMPLETA (captador + corretores liberados)
//
// O imóvel original (imoveis/{id}) continua trancado: corretor só abre o que
// ele captou.
//
// 🔒 BLINDAGEM DE CONTATO (17/10/2026, ordem do dono): o contato é SEMPRE o da
// imobiliária — com o cliente (comprador, inquilino, proprietário) e entre corretores.
// A ficha não carrega telefone/e-mail/nome do captador nem do proprietário; o lead
// chega ao corretor sem telefone/e-mail do cliente (leadsCorretor); textos públicos
// escritos pelo corretor não podem ter telefone, e-mail, link nem @perfil. Quem paga
// anúncio e portal é a imobiliária — o cliente que chega é dela. Os outros corretores leem só a ficha — a trava é no firestore.rules.
// Os campos da ficha são escolhidos em tela (Corretores → Visibilidade da rede),
// nada fica fixo no código além da lista de campos possíveis.

const REDE_CAMPOS = [
  { id: 'identificacao',    label: 'Identificação (apelido do imóvel)' },
  { id: 'tipo',             label: 'Tipo, subtipo, finalidade e status' },
  { id: 'fotos',            label: 'Fotos' },
  { id: 'valores',          label: 'Valores (aluguel / venda / mercado)' },
  { id: 'localizacao',      label: 'Bairro, cidade e UF' },
  { id: 'rua',              label: 'Rua (sem número)' },
  { id: 'enderecoCompleto', label: 'Endereço completo (número, complemento, CEP)', sensivel: true },
  { id: 'metragem',         label: 'Metragem (área útil / total)' },
  { id: 'comodos',          label: 'Quartos, banheiros, vagas, andar, mobiliado' },
  { id: 'descricao',        label: 'Descrição e tags' },
  { id: 'condicoes',        label: 'Aceita financiamento / FGTS' },
  { id: 'midia',            label: 'Vídeo e tour virtual' },
  { id: 'documentacao',     label: 'Matrícula e IPTU', sensivel: true },
  { id: 'obsInternas',      label: 'Observações internas', sensivel: true },
];
const REDE_CAMPOS_PADRAO = ['identificacao', 'tipo', 'fotos', 'valores', 'localizacao',
  'metragem', 'comodos', 'descricao', 'condicoes', 'midia'];
// (Contato do captador e proprietário saíram da ficha: a ficha mostra sempre o contato da imobiliária)
const REDE_TODOS_CAMPOS = REDE_CAMPOS.map(c => c.id);
const REDE_MAX_FOTOS = 20;

// ---------- Blindagem de contato ----------
// Espelho da função semContato() do firestore.rules — mudou lá, muda aqui.
const RE_CONTATO = /(https?:|www\.|wa\.me|bit\.ly|linktr|[a-z0-9]\.(com|net|org|me|ly|io|app|site|link|br)([^a-z0-9]|$)|@[a-z0-9_]|[0-9]([ .()-]*[0-9]){7,}|whats|wpp|telegram|instagram|facebook|tik ?tok|gmail|hotmail|outlook|arroba|me chama|chama no|ligue|ligar para|meu (cel|tel|n[uú]mero|contato|zap)|((zero|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove)[ ,.-]+){5,})/;
// Vídeo e tour: só destes serviços (espelho de urlMidiaOk() nas regras)
const RE_MIDIA_OK = /^https:\/\/(www\.|m\.|player\.|my\.)?(youtube\.com|youtu\.be|vimeo\.com|matterport\.com|kuula\.co|momento360\.com)\//;

function temContato(s) {
  return typeof s === 'string' && RE_CONTATO.test(s.toLowerCase());
}
// Troca telefone, e-mail e link por um aviso (mensagem do cliente que vai ao corretor)
function ocultarContatos(s) {
  if (!s) return s || null;
  return String(s)
    .replace(/(https?:\/\/\S+|www\.\S+)/gi, '[link removido]')
    .replace(/\S+@\S+/g, '[e-mail com a imobiliária]')
    .replace(/\+?[0-9][0-9 .()-]{6,}[0-9]/g, '[telefone com a imobiliária]');
}
// Confere os textos que o CORRETOR grava e que vão a público (site, portais, ficha).
// Devolve a mensagem de erro (com o campo) ou null.
function validarTextosDoCorretor(d) {
  if (!isCorretor() || !d) return null;
  const end = d.endereco || {};
  const campos = [
    ['Apelido', d.apelido], ['Título do anúncio', d.tituloAnuncio], ['Descrição', d.descricaoLonga],
    ['Observação da permuta', d.permutaObs], ['Tags', Array.isArray(d.tags) ? d.tags.join(' ') : null],
    ['Imediações', d.imediacoesTexto],
    ['Rua', end.logradouro], ['Bairro', end.bairro], ['Cidade', end.cidade], ['Complemento', end.complemento],
  ];
  const ruim = campos.find(([, v]) => temContato(v));
  if (ruim) {
    return `🔒 <strong>${ruim[0]}</strong>: tire telefone, e-mail, link, @perfil ou menção a WhatsApp/redes. `
      + 'O contato com o cliente é sempre o da imobiliária — o site e os portais já mostram os botões dela. '
      + '(Valores muito grandes: escreva "R$ 12,5 milhões".)';
  }
  for (const [rotulo, v] of [['Vídeo', d.videoUrl], ['Tour virtual', d.tourUrl]]) {
    if (v && !RE_MIDIA_OK.test(String(v).toLowerCase())) {
      return `🔒 <strong>${rotulo}</strong>: use um link do YouTube, Vimeo, Matterport, Kuula ou Momento360. `
        + 'Links de perfil, site pessoal ou WhatsApp não são aceitos.';
    }
  }
  return null;
}
// Contato da imobiliária (o único que circula)
function contatoImobiliaria() {
  const t = State.tenant || {};
  return { nome: t.nome || null, telefone: t.whatsapp || t.telefone || null, email: t.emailContato || null, creci: t.creci || null };
}

// Só aceita links https (barra javascript:, data: etc. vindos de dados gravados por terceiros)
function urlSegura(u) {
  return (typeof u === 'string' && /^https:\/\//i.test(u)) ? escapeHtml(u) : '';
}

const CORRETOR_STATUS_LABEL = {
  ativo:    '<span class="badge-status ativo">Ativo</span>',
  pendente: '<span class="badge-status" style="background:#FEF3C7;color:#92400E;">⏳ Pendente</span>',
  suspenso: '<span class="badge-status suspenso">Suspenso</span>',
};
const CORRETOR_TIPO_LABEL = { equipe: '👥 Equipe', parceiro: '🤝 Parceiro' };

// ---------- Config da rede ----------

let _configRedeCache = null;

async function getConfigRede() {
  if (_configRedeCache) return _configRedeCache;
  let cfg = {};
  try {
    const snap = await tenantPath().collection('config').doc('rede').get();
    if (snap.exists) cfg = snap.data();
  } catch (_) {}
  _configRedeCache = {
    campos: Array.isArray(cfg.campos) ? cfg.campos : REDE_CAMPOS_PADRAO,
    visibilidadePadrao: cfg.visibilidadePadrao === 'privado' ? 'privado' : 'rede',
  };
  return _configRedeCache;
}

async function loadConfigRede() {
  const box = $('rede-campos-container');
  if (!box) return;
  _configRedeCache = null;
  const cfg = await getConfigRede();
  box.innerHTML = REDE_CAMPOS.map(c => `
    <label class="toggle-row" style="cursor:pointer;">
      <input type="checkbox" class="rede-campo-chk" value="${c.id}" ${cfg.campos.includes(c.id) ? 'checked' : ''}>
      <span>${escapeHtml(c.label)}${c.sensivel ? ' <span class="muted" style="font-size:11px;">⚠️ sensível</span>' : ''}</span>
    </label>`).join('');
  $('rede-visibilidade-padrao').value = cfg.visibilidadePadrao;
}

async function salvarConfigRede() {
  if (!exigirPode('corretores', 'editar')) return;
  const campos = Array.from(document.querySelectorAll('.rede-campo-chk:checked')).map(el => el.value);
  const visibilidadePadrao = $('rede-visibilidade-padrao').value;
  try {
    await tenantPath().collection('config').doc('rede').set({
      campos,
      visibilidadePadrao,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      atualizadoPor: State.user.uid,
    }, { merge: true });
    _configRedeCache = null;
    logAuditoria('update', 'config', 'rede', { campos, visibilidadePadrao });
    const reaplicar = await confirmar({
      titulo: 'Configuração salva',
      mensagem: 'Aplicar agora a nova configuração às fichas de <strong>todos</strong> os imóveis?',
      detalhe: 'As fichas que os corretores veem só mudam depois de reaplicar (ou quando cada imóvel for salvo de novo).',
      confirmar: '🔄 Reaplicar agora',
      cancelar: 'Depois',
    });
    if (reaplicar) await reaplicarTodasFichasRede();
    else showInlineStatus('rede-config-status', '✅ Configuração salva.', 'success', 5000);
  } catch (err) {
    console.error('Erro ao salvar config da rede:', err);
    showInlineStatus('rede-config-status', `❌ ${err.message}`, 'error');
  }
}

// ---------- Ficha da rede (sincronização) ----------

// Monta o objeto do imóvel só com os campos liberados.
function montarDadosRede(im, campos, ctx) {
  const tem = c => campos.includes(c);
  const end = im.endereco || {};
  const f = {};
  if (tem('identificacao')) f.apelido = im.apelido || null;
  if (tem('tipo')) Object.assign(f, {
    tipo: im.tipo || null, subtipo: im.subtipo || null,
    finalidade: im.finalidade || 'locacao', status: im.status || 'disponivel',
  });
  if (tem('fotos')) f.fotos = ctx.fotos || [];
  if (tem('valores')) Object.assign(f, {
    aluguelSugerido: im.aluguelSugerido ?? null, valorVenda: im.valorVenda ?? null,
    valorMercado: im.valorMercado ?? null,
    valorCondominio: im.valorCondominio ?? null, valorIPTU: im.valorIPTU ?? null,
  });
  if (tem('localizacao') || tem('rua') || tem('enderecoCompleto')) {
    f.endereco = {};
    if (tem('localizacao') || tem('enderecoCompleto')) Object.assign(f.endereco, {
      bairro: end.bairro || null, cidade: end.cidade || null, uf: end.uf || null,
    });
    if (tem('rua') || tem('enderecoCompleto')) f.endereco.logradouro = end.logradouro || null;
    if (tem('enderecoCompleto')) Object.assign(f.endereco, {
      numero: end.numero || null, complemento: end.complemento || null, cep: end.cep || null,
    });
  }
  if (tem('metragem')) Object.assign(f, { areaUtil: im.areaUtil ?? null, areaTotal: im.areaTotal ?? null });
  if (tem('comodos')) Object.assign(f, {
    quartos: im.quartos ?? 0, banheiros: im.banheiros ?? 0, vagas: im.vagas ?? 0,
    andar: im.andar || null, mobiliado: im.mobiliado || null,
  });
  if (tem('descricao')) Object.assign(f, { descricaoLonga: im.descricaoLonga || null, tags: im.tags || [] });
  if (tem('condicoes')) Object.assign(f, {
    aceitaFinanciamento: im.aceitaFinanciamento || null, permiteFGTS: im.permiteFGTS || null,
    aceitaPermuta: im.aceitaPermuta || null, permutaObs: im.permutaObs || null,
  });
  if (tem('midia')) Object.assign(f, { videoUrl: im.videoUrl || null, tourUrl: im.tourUrl || null });
  if (tem('documentacao')) Object.assign(f, { matricula: im.matricula || null, iptu: im.iptu || null });
  // obs vai à ficha só se a imobiliária liberou — e, gravada pelo corretor, sem contato dentro
  if (tem('obsInternas')) f.obs = (isCorretor() && temContato(im.obs)) ? null : (im.obs || null);
  return f;
}

// Nome do captador para a TELA DA EQUIPE (cartão de corretor → usuário → imobiliária).
// Nunca vai para a ficha: corretor não vê nome nem contato de colega.
async function contatoCaptador(uid) {
  if (uid) {
    try {
      const c = await tenantPath().collection('corretores').doc(uid).get();
      if (c.exists) {
        const d = c.data();
        return { nome: d.nome || null, telefone: d.telefone || null, email: d.email || null, creci: d.creci || null };
      }
    } catch (_) {}
    if (uid === State.user?.uid) {
      return { nome: State.userDoc?.nome || null, telefone: null, email: State.userDoc?.email || null, creci: null };
    }
    try {
      const u = await db.collection('users').doc(uid).get();
      if (u.exists) return { nome: u.data().nome || null, telefone: null, email: u.data().email || null, creci: null };
    } catch (_) {}
  }
  const t = State.tenant || {};
  return { nome: t.nome || null, telefone: t.telefone || t.whatsapp || null, email: t.emailContato || null, creci: t.creci || null };
}

// Recalcula a ficha + ficha completa de um imóvel a partir do original.
async function sincronizarFichaRede(imovelId) {
  if (!State.tenant || !imovelId) return;
  const imSnap = await tenantPath().collection('imoveis').doc(imovelId).get();
  if (!imSnap.exists) return;
  const im = imSnap.data();
  const cfg = await getConfigRede();

  const fotosSnap = await tenantPath().collection('imoveis').doc(imovelId).collection('fotos')
    .orderBy('ordem').limit(REDE_MAX_FOTOS).get().catch(() => null);
  // 🔒 sem captador e sem proprietário: o contato da ficha é sempre o da imobiliária
  const ctx = { fotos: fotosSnap ? fotosSnap.docs.map(d => d.data().url).filter(Boolean) : [] };

  const vis = (im.redeVisibilidade && im.redeVisibilidade !== 'padrao') ? im.redeVisibilidade : cfg.visibilidadePadrao;
  const meta = {
    captadorUid: im.criadoPor || null,
    codigoAnuncio: im.codigoAnuncio || null, // não é dado sensível: serve para achar o anúncio
    visivel: vis === 'rede' && !im.rascunho,
    compartilhadoCom: Array.isArray(im.compartilhadoCom) ? im.compartilhadoCom : [],
    finalidadeFiltro: im.finalidade || 'locacao', // sempre presente pros filtros da tela
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  };

  const fichaRef = tenantPath().collection('imoveisRede').doc(imovelId);
  // Ficha primeiro: a regra da ficha completa confere captador/liberados nela
  await fichaRef.set({ ...montarDadosRede(im, cfg.campos, ctx), ...meta });
  await fichaRef.collection('completo').doc('dados').set({
    ...montarDadosRede(im, REDE_TODOS_CAMPOS, ctx),
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  });
  // 🔓 Exceção (28/10/2026): contato do proprietário num doc à parte, que o servidor só deixa
  // ler o corretor marcado "ver contato dos proprietários". Só a equipe grava (o corretor não lê
  // proprietário alheio para copiar). Sem a regra colada no Console, falha calado.
  if (!isCorretor()) {
    try {
      const contatoRef = fichaRef.collection('contato').doc('proprietario');
      const loc = im.locadorId ? await tenantPath().collection('locadores').doc(im.locadorId).get() : null;
      if (loc && loc.exists) {
        const l = loc.data();
        await contatoRef.set({ nome: l.nome || null, telefone: l.telefone || null, email: l.email || null,
          atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() });
      } else {
        await contatoRef.delete().catch(() => {});
      }
    } catch (e) { console.warn('Contato do proprietário (exceção) não gravado:', e.code || e.message); }
  }

  await sincronizarVitrine(imovelId, im, ctx);
}

// ---------- Vitrine pública (site + feed dos portais) ----------
// tenants/{tid}/vitrine/{id} — leitura PÚBLICA. Só entra imóvel publicado
// (linkPublico) e só com campos seguros: nada de proprietário, número/complemento,
// matrícula, IPTU nem observações internas. Respeita os toggles "publicacao".
function montarDadosVitrine(im, ctx) {
  const pub = im.publicacao || {};
  const end = im.endereco || {};
  const mostrarBairro = pub.mostrarBairro !== false;
  const v = {
    linkPublico: true,
    apelido: im.apelido || null,
    // Anúncio (anuncios.js): título dos portais, código para o cliente citar e portais/nível
    tituloAnuncio: im.tituloAnuncio || null,
    codigoAnuncio: im.codigoAnuncio || null,
    anuncioPortais: (im.anuncioPortais && typeof im.anuncioPortais === 'object') ? im.anuncioPortais : null,
    tipo: im.tipo || null,
    subtipo: im.subtipo || null,
    finalidade: im.finalidade || 'locacao',
    status: im.status || 'disponivel',
    publicacao: pub,
    endereco: mostrarBairro
      ? { cep: end.cep || null, logradouro: end.logradouro || null, bairro: end.bairro || null, cidade: end.cidade || null, uf: end.uf || null }
      : { cidade: end.cidade || null, uf: end.uf || null },
    aceitaFinanciamento: im.aceitaFinanciamento || null,
    permiteFGTS: im.permiteFGTS || null,
    aceitaPermuta: im.aceitaPermuta === 'sim' ? 'sim' : null,
    permutaObs: im.aceitaPermuta === 'sim' ? (im.permutaObs || null) : null,
    descricaoLonga: im.descricaoLonga || null,
    // 📍 imediações só quando o bairro é público (as distâncias revelam a região)
    imediacoesTexto: mostrarBairro ? (im.imediacoesTexto || null) : null,
    videoUrl: im.videoUrl || null,
    tourUrl: im.tourUrl || null,
    tags: im.tags || [],
    vitrineFeed: im.vitrineFeed !== false,
    coverUrl: (ctx.fotos || [])[0] || null,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (pub.mostrarValor !== false) Object.assign(v, {
    aluguelSugerido: im.aluguelSugerido ?? null, valorVenda: im.valorVenda ?? null,
    valorCondominio: im.valorCondominio ?? null, valorIPTU: im.valorIPTU ?? null,
  });
  if (pub.mostrarArea !== false) Object.assign(v, { areaUtil: im.areaUtil ?? null, areaTotal: im.areaTotal ?? null });
  if (pub.mostrarComodos !== false) Object.assign(v, {
    quartos: im.quartos ?? 0, banheiros: im.banheiros ?? 0, vagas: im.vagas ?? 0,
    andar: im.andar || null, mobiliado: im.mobiliado || null,
  });
  return v;
}

// Coordenada aproximada pelo CEP (BrasilAPI, grátis) — exigida pelo catálogo de
// imóveis da Meta (feed "facebook"). Nível de CEP, nunca o número da casa.
// 1º Nominatim (OpenStreetMap) pelo CEP; 2º BrasilAPI só de reserva.
// ⚠️ O BrasilAPI (fonte open-cep) devolve o CENTRO DA CIDADE para muitos CEPs:
// 01310-100 (Av. Paulista) vinha como Praça da Sé — imóvel no lugar errado no mapa.
const _geoCepCache = new Map();
let _nominatimUltimaChamada = 0;

// Nominatim: no máximo 1 consulta por segundo (política de uso do OSM)
async function nominatimBusca(params) {
  const espera = _nominatimUltimaChamada + 1100 - Date.now();
  if (espera > 0) await new Promise(r => setTimeout(r, espera));
  _nominatimUltimaChamada = Date.now();
  const qs = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'br', ...params });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, { headers: { 'Accept-Language': 'pt-BR' } });
  if (!res.ok) return null;
  const j = await res.json();
  const lat = parseFloat(j?.[0]?.lat), lng = parseFloat(j?.[0]?.lon);
  return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
}

async function coordenadaPorCep(cep) {
  const d = String(cep || '').replace(/\D/g, '');
  if (d.length !== 8) return null;
  if (_geoCepCache.has(d)) return _geoCepCache.get(d);
  let c = null;
  try { c = await nominatimBusca({ postalcode: `${d.slice(0, 5)}-${d.slice(5)}` }); } catch (_) {}
  if (!c) {
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${d}`);
      if (res.ok) {
        const k = (await res.json())?.location?.coordinates || {};
        const lat = parseFloat(k.latitude), lng = parseFloat(k.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) c = { lat, lng };
      }
    } catch (_) {}
  }
  _geoCepCache.set(d, c);
  return c;
}

async function sincronizarVitrine(imovelId, im, ctx) {
  const ref = tenantPath().collection('vitrine').doc(imovelId);
  if (im.linkPublico === true && !im.rascunho) {
    const dados = montarDadosVitrine(im, ctx);
    // Bairro oculto = não divulga localização (nem aproximada)
    if ((im.publicacao || {}).mostrarBairro !== false) {
      dados.geo = await coordenadaPorCep(im.endereco?.cep);
    }
    await ref.set(dados);
  } else if (!isCorretor()) {
    // corretor não publica nem despublica — só a equipe remove da vitrine
    await ref.delete();
  }
}

// 👁 Prévia do anúncio (21/10/2026): abre a página pública com EXATAMENTE o que iria para a vitrine
// (montarDadosVitrine), sem publicar. Os dados vão pelo localStorage do mesmo site (vale 1 h);
// imovel.html?previa=1 lê dali, mostra a faixa "PRÉVIA", não conta visita e não aceita lead.
async function previaAnuncio(imovelId, btn) {
  if (!imovelId) return;
  const janela = window.open('', '_blank');   // abre já no clique (bloqueador de pop-up)
  const txt = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Montando prévia…'; }
  try {
    const snap = await tenantPath().collection('imoveis').doc(imovelId).get();
    if (!snap.exists) throw new Error('imóvel não encontrado');
    const im = snap.data();
    const fotosSnap = await tenantPath().collection('imoveis').doc(imovelId).collection('fotos').orderBy('ordem').get().catch(() => null);
    const ctx = { fotos: fotosSnap ? fotosSnap.docs.map(d => d.data().url).filter(Boolean) : [] };
    const dados = { ...montarDadosVitrine(im, ctx), atualizadoEm: null };
    if ((im.publicacao || {}).mostrarBairro !== false) {
      try { dados.geo = await coordenadaPorCep(im.endereco?.cep); } catch (_) {}
    }
    localStorage.setItem(`rently-previa:${imovelId}`, JSON.stringify({ em: Date.now(), publicado: im.linkPublico === true && !im.rascunho, dados }));
    const url = `imovel.html?id=${encodeURIComponent(imovelId)}&t=${encodeURIComponent(State.tenant.id)}&previa=1`;
    if (janela) janela.location.href = url; else window.open(url, '_blank');
    if (btn) btn.textContent = '✓ Prévia aberta';
  } catch (err) {
    if (janela) janela.close();
    console.error('Prévia do anúncio:', err);
    if (btn) btn.textContent = '❌ Erro';
    alertaPrevia(`❌ Não consegui montar a prévia: ${err.message}`);
  } finally {
    if (btn) setTimeout(() => { btn.disabled = false; btn.textContent = txt; }, 1500);
  }
}
// Do modal: a prévia mostra o que está salvo
function previaDoModalImovel(btn) {
  const id = $('imovel-id').value;
  if (!id) { showAlert('imovel-alert', '💾 Salve o imóvel primeiro — a prévia mostra o anúncio salvo.'); $('imovel-alert').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
  previaAnuncio(id, btn);
}
function alertaPrevia(msg) {
  if ($('modal-imovel')?.style.display === 'flex') showAlert('imovel-alert', escapeHtml(msg));
  else showInlineStatus('imoveis-status', escapeHtml(msg), 'error');
}

async function removerFichaRede(imovelId) {
  const fichaRef = tenantPath().collection('imoveisRede').doc(imovelId);
  try { await fichaRef.collection('completo').doc('dados').delete(); } catch (_) {}
  try { await fichaRef.delete(); } catch (_) {}
  try { await tenantPath().collection('vitrine').doc(imovelId).delete(); } catch (_) {}
}

async function reaplicarTodasFichasRede() {
  const SID = 'rede-config-status';
  try {
    _configRedeCache = null;
    const snap = await tenantPath().collection('imoveis').get();
    let ok = 0, falhas = 0;
    for (const d of snap.docs) {
      showInlineStatus(SID, `🔄 Atualizando fichas e vitrine… ${ok + falhas + 1}/${snap.size}`, 'info');
      try { await sincronizarFichaRede(d.id); ok++; }
      catch (e) { falhas++; console.warn('Ficha falhou', d.id, e); }
    }
    logAuditoria('update', 'imoveisRede', 'reaplicar', { ok, falhas });
    showInlineStatus(SID, `✅ ${ok} ficha(s) atualizada(s)${falhas ? ` · ⚠️ ${falhas} falha(s) (ver console)` : ''}.`, falhas ? 'error' : 'success', 8000);
  } catch (err) {
    console.error('Erro ao reaplicar fichas:', err);
    showInlineStatus(SID, `❌ ${err.message}`, 'error');
  }
}

// ---------- Modal do imóvel: bloco "Rede de corretores" ----------

let _corretoresAtivosCache = null;

async function listarCorretoresAtivos() {
  if (_corretoresAtivosCache) return _corretoresAtivosCache;
  const snap = await tenantPath().collection('corretores').where('status', '==', 'ativo').get();
  _corretoresAtivosCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
  return _corretoresAtivosCache;
}

async function prepararRedeNoModalImovel(id) {
  // Corretor não publica no site/portais (a regra também barra linkPublico)
  if (isCorretor()) { $('imovel-publicacao-section').style.display = 'none'; $('imovel-publicar-final').style.display = 'none'; }

  const box = $('imovel-rede-section');
  if (!box) return;
  let im = {};
  if (id) {
    try {
      const snap = await tenantPath().collection('imoveis').doc(id).get();
      if (snap.exists) im = snap.data();
    } catch (_) {}
  }
  const cfg = await getConfigRede();
  $('imovel-rede-visibilidade').value = im.redeVisibilidade || 'padrao';
  $('imovel-rede-padrao-label').textContent = cfg.visibilidadePadrao === 'privado' ? 'privado' : 'visível pra rede (ficha)';

  const captadorUid = im.criadoPor || State.user.uid;
  const captador = await contatoCaptador(captadorUid);
  $('imovel-rede-captador').textContent = captador?.nome || '—';

  const lista = $('imovel-rede-compartilhar');
  const marcados = Array.isArray(im.compartilhadoCom) ? im.compartilhadoCom : [];
  // 🔒 Corretor não vê a lista de colegas nem decide com quem a ficha completa é
  // compartilhada — quem liga corretor a corretor é a imobiliária (a regra também barra).
  if (isCorretor()) {
    lista.innerHTML = `<p class="muted" style="font-size:12px;">🔒 Quem libera a ficha completa para outro corretor é a imobiliária${marcados.length ? ` (hoje liberada para ${marcados.length} corretor(es))` : ''}. O contato com cliente e com colegas é sempre pela imobiliária.</p>`;
    return;
  }
  let corretores = [];
  try { _corretoresAtivosCache = null; corretores = await listarCorretoresAtivos(); } catch (_) {}
  corretores = corretores.filter(c => c.uid !== captadorUid);
  // Dono/administrador que também está em Corretores já vê tudo (é equipe da imobiliária):
  // não é "liberável" — aparece fixo, sem caixinha.
  const papeis = await Promise.all(corretores.map(async c => {
    if (c.uid === State.user.uid) return State.userDoc?.role || 'admin';
    try { return (await db.collection('users').doc(c.uid).get()).data()?.role || null; } catch (_) { return null; }
  }));
  const acessoTotal = corretores.filter((c, i) => ['admin', 'super_admin'].includes(papeis[i]));
  corretores = corretores.filter((c, i) => !['admin', 'super_admin'].includes(papeis[i]));
  const linhasTotal = acessoTotal.map(c => `
        <div class="toggle-row" style="cursor:default;">
          <span>👑 ${escapeHtml(c.nome || c.email || c.uid)} <span class="muted" style="font-size:11px;">acesso total (administrador) — não precisa liberar</span></span>
        </div>`).join('');
  lista.innerHTML = linhasTotal + (corretores.length
    ? corretores.map(c => `
        <label class="toggle-row" style="cursor:pointer;">
          <input type="checkbox" class="imovel-rede-share-chk" value="${c.uid}" ${marcados.includes(c.uid) ? 'checked' : ''}>
          <span>${escapeHtml(c.nome || c.email || c.uid)} <span class="muted" style="font-size:11px;">${CORRETOR_TIPO_LABEL[c.tipo] || ''}${c.creci ? ' · CRECI ' + escapeHtml(c.creci) : ''}</span></span>
        </label>`).join('')
    : '<p class="muted" style="font-size:12px;">Nenhum outro corretor ativo cadastrado.</p>');
}

function lerRedeDoModalImovel() {
  if (!$('imovel-rede-section')) return {};
  const visibilidade = { redeVisibilidade: $('imovel-rede-visibilidade').value || 'padrao' };
  if (isCorretor()) return visibilidade; // compartilhar é decisão da imobiliária
  return {
    ...visibilidade,
    compartilhadoCom: Array.from(document.querySelectorAll('.imovel-rede-share-chk:checked')).map(el => el.value),
  };
}

// ---------- Seção "Corretores" (admin) ----------

async function loadCorretores() {
  const tbody = $('tbody-corretores');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="empty">Carregando…</td></tr>`;
  try {
    const [snap, imSnap] = await Promise.all([
      tenantPath().collection('corretores').get(),
      tenantPath().collection('imoveis').get(),
    ]);
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">Nenhum corretor cadastrado. Clique em "+ Novo corretor".</td></tr>`;
      return;
    }
    const captados = {};
    imSnap.docs.forEach(d => { const u = d.data().criadoPor; if (u) captados[u] = (captados[u] || 0) + 1; });
    const ordem = { pendente: 0, ativo: 1, suspenso: 2 };
    const lista = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => (ordem[a.status] ?? 9) - (ordem[b.status] ?? 9) || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    if (typeof sincronizarContratosParceria === 'function') await sincronizarContratosParceria(lista);
    if (typeof renderCardProtecao === 'function' && $('card-protecao-rede') && !$('card-protecao-rede').innerHTML.trim()) renderCardProtecao();
    if (typeof renderCardDistribuicao === 'function' && $('card-distribuicao-leads') && !$('card-distribuicao-leads').innerHTML.trim()) renderCardDistribuicao();
    tbody.innerHTML = lista.map(c => {
      const acoes = [];
      // Pré-cadastro da IA (ia-imovel.js): ficha sem login — Aprovar/Editar mexeriam em users/{uid}, que não existe
      if (c.semConta) {
        return `
        <tr>
          <td><strong>${escapeHtml(c.nome || '—')}</strong><br><span class="muted" style="font-size:11px;">${escapeHtml(c.email || '')}${c.imobiliaria ? `${c.email ? ' · ' : ''}${escapeHtml(c.imobiliaria)}` : ''}</span></td>
          <td>${escapeHtml(c.creci || '—')}</td>
          <td>${c.telefone ? escapeHtml(maskTelefone(c.telefone)) : '—'}</td>
          <td>${CORRETOR_TIPO_LABEL[c.tipo] || '—'}</td>
          <td>—</td>
          <td>🤖 Pré-cadastro da IA<br><span class="muted" style="font-size:11px;">sem acesso${c.imovelOrigem ? ` · veio do imóvel ${escapeHtml(c.imovelOrigem)}` : ''}</span></td>
          <td><div class="action-btns">
            <button class="btn btn-sm btn-primary" onclick="criarAcessoCorretorPre('${c.uid}')">🔑 Criar acesso</button>
            <button class="btn btn-sm btn-secondary" onclick="descartarCorretorPre('${c.uid}', this)">🗑 Descartar</button>
          </div></td>
        </tr>`;
      }
      if (c.status === 'pendente') acoes.push(`<button class="btn btn-sm btn-primary" onclick="definirStatusCorretor('${c.uid}','ativo')">✅ Aprovar</button>`);
      if (c.status === 'ativo') acoes.push(`<button class="btn btn-sm btn-danger" onclick="definirStatusCorretor('${c.uid}','suspenso')">Suspender</button>`);
      if (c.status === 'suspenso') acoes.push(`<button class="btn btn-sm btn-primary" onclick="definirStatusCorretor('${c.uid}','ativo')">Reativar</button>`);
      acoes.push(`<button class="btn btn-sm btn-secondary" onclick="openCorretorModal('${c.uid}')">Editar</button>`);
      if (typeof openTransferirCarteira === 'function' && typeof nivelPermissao === 'function' && nivelPermissao('corretores', 'editar') === 'sim')
        acoes.push(`<button class="btn btn-sm btn-secondary" onclick="openTransferirCarteira('${c.uid}')" title="Passar imóveis, proprietários e leads deste corretor para outro">🔁 Carteira</button>`);
      if (typeof pode === 'function' && pode('gerenciarUsuariosPerfis')) acoes.push(`<button class="btn btn-sm btn-secondary" onclick="openPermissoesUsuario('${c.uid}')" title="Ver, editar ou excluir o que este corretor pode fazer">🔐 Permissões</button>`);
      if (typeof botoesProtecaoCorretor === 'function' && c.status !== 'pendente') acoes.push(botoesProtecaoCorretor(c));
      return `
        <tr>
          <td><strong>${escapeHtml(c.nome || '—')}</strong><br><span class="muted" style="font-size:11px;">${escapeHtml(c.email || '')}</span>${(() => { const f = faltaNoCadastroCorretor(c); return f.length ? `<br><span style="font-size:11px;color:#b45309;font-weight:600;" title="Falta: ${escapeHtml(f.join('; '))}">⚠️ cadastro incompleto</span>` : ''; })()}</td>
          <td>${escapeHtml(c.creci || '—')}</td>
          <td>${c.telefone ? escapeHtml(maskTelefone(c.telefone)) : '—'}</td>
          <td>${CORRETOR_TIPO_LABEL[c.tipo] || '—'}</td>
          <td>${captados[c.uid] || 0}</td>
          <td>${CORRETOR_STATUS_LABEL[c.status] || escapeHtml(c.status || '—')}${typeof celulaProtecaoCorretor === 'function' && c.status !== 'pendente' ? celulaProtecaoCorretor(c) : ''}</td>
          <td><div class="action-btns">${acoes.join(' ')}</div></td>
        </tr>`;
    }).join('');
  } catch (err) {
    console.error('Erro ao listar corretores:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--danger);">Erro: ${escapeHtml(err.message)}</td></tr>`;
  }
}

let _corretorPreId = null;   // pré-cadastro da IA que vira conta ao salvar (criarAcessoCorretorPre)

async function openCorretorModal(uid) {
  clearAlert('corretor-alert');
  _corretorPreId = null;
  const editando = !!uid;
  $('corretor-uid').value = uid || '';
  $('modal-corretor-title').textContent = editando ? 'Editar corretor' : 'Novo corretor';
  $('corretor-email').disabled = false;
  $('corretor-email-dica').style.display = editando ? 'block' : 'none';
  $('corretor-acesso-group').style.display = editando ? 'none' : 'block';
  $('btn-save-corretor').textContent = editando ? 'Salvar' : 'Criar corretor';
  let c = {};
  if (editando) {
    try {
      const snap = await tenantPath().collection('corretores').doc(uid).get();
      if (snap.exists) c = snap.data();
    } catch (_) {}
  }
  $('corretor-nome').value = c.nome || '';
  $('corretor-email').value = c.email || '';
  $('corretor-telefone').value = c.telefone ? maskTelefone(c.telefone) : '';
  $('corretor-creci').value = c.creci || '';
  $('corretor-documento').value = c.documento ? fmtCpfCnpj(c.documento) : '';
  preencherEndereco('corretor-end', c.endereco);
  $('corretor-tipo').value = c.tipo || 'parceiro';
  $('corretor-ver-contato-prop').checked = !!c.verContatoProprietario;
  $('corretor-email').dataset.original = c.email || '';
  $('corretor-email').dataset.semConta = c.semConta ? '1' : '';
  $('corretor-senha').value = gerarSenhaAleatoria(10);
  $('corretor-enviar-email').checked = true;
  $('modal-corretor').style.display = 'flex';
}

function closeCorretorModal() {
  $('modal-corretor').style.display = 'none';
}

// Pré-cadastro da IA → conta de verdade: abre o "Novo corretor" já preenchido; ao salvar, a ficha
// pré-cadastrada é trocada pela do login (uid). Sem e-mail no material, o modal pede.
async function criarAcessoCorretorPre(preId) {
  let c = {};
  try { c = (await tenantPath().collection('corretores').doc(preId).get()).data() || {}; } catch (_) {}
  await openCorretorModal();
  _corretorPreId = preId;
  $('corretor-nome').value = c.nome || '';
  $('corretor-email').value = c.email || '';
  $('corretor-telefone').value = c.telefone ? maskTelefone(c.telefone) : '';
  $('corretor-creci').value = c.creci || '';
  $('corretor-documento').value = c.documento ? fmtCpfCnpj(c.documento) : '';
  preencherEndereco('corretor-end', c.endereco);
  $('corretor-tipo').value = c.tipo || 'parceiro';
  if (!c.email) showAlert('corretor-alert', 'O material não trazia e-mail: digite o e-mail do corretor para criar o acesso.', 'info');
}

async function descartarCorretorPre(preId, btn) {
  if (!exigirPode('corretores', 'excluir')) return;
  if (!(await confirmar({ titulo: 'Descartar pré-cadastro?', mensagem: 'A ficha que a IA criou será apagada. Nenhuma conta de acesso existe para ela.', confirmar: '🗑 Descartar', perigo: true }))) return;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Descartando…'; }
  try {
    await tenantPath().collection('corretores').doc(preId).delete();
    logAuditoria('delete', 'corretor', preId, { origem: 'ia-cadastro-imovel', semConta: true });
    showInlineStatus('corretores-status', '✓ Pré-cadastro descartado.', 'success');
    if (typeof atualizarBadgeCorretoresPendentes === 'function') atualizarBadgeCorretoresPendentes();
    loadCorretores();
  } catch (err) {
    showInlineStatus('corretores-status', `❌ ${escapeHtml(err.message)}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🗑 Descartar'; }
  }
}

function gerarSenhaCorretor() {
  $('corretor-senha').value = gerarSenhaAleatoria(10);
}

async function saveCorretor() {
  clearAlert('corretor-alert');
  const uidExistente = $('corretor-uid').value;
  if (!exigirPode('corretores', uidExistente ? 'editar' : 'criar', 'corretor-alert')) return;
  const nome = $('corretor-nome').value.trim();
  const email = $('corretor-email').value.trim().toLowerCase();
  const telefone = $('corretor-telefone').value.replace(/\D/g, '') || null;
  const creci = $('corretor-creci').value.trim() || null;
  const tipo = $('corretor-tipo').value;
  if (!nome) { showAlert('corretor-alert', 'Nome é obrigatório.'); return; }
  // Obrigatórios (28/10/2026): telefone, CPF/CNPJ e endereço — vão para o contrato de parceria
  const documento = fmtCpfCnpj($('corretor-documento').value);
  const endereco = lerEndereco('corretor-end');
  const faltam = faltaNoCadastroCorretor({ telefone, documento, endereco });
  if (faltam.length) {
    showAlert('corretor-alert', 'Preencha: ' + faltam.join('; ') + '.' + (faltam.includes('CPF/CNPJ') && $('corretor-documento').value.trim() ? ' (CPF/CNPJ inválido — confira os números)' : ''));
    $('corretor-alert').scrollIntoView({ block: 'start' });
    return;
  }

  const btn = $('btn-save-corretor');
  btn.disabled = true;
  let avisoEmailTrocado = '';
  try {
    if (uidExistente) {
      // E-mail = login: trocar exige o servidor (Worker Asaas, /usuarios/trocar-email)
      const emailAntigo = ($('corretor-email').dataset.original || '').toLowerCase();
      const semConta = $('corretor-email').dataset.semConta === '1';
      if (email !== emailAntigo) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAlert('corretor-alert', 'E-mail inválido.'); $('corretor-alert').scrollIntoView({ block: 'start' }); return; }
        if (semConta) {
          await tenantPath().collection('corretores').doc(uidExistente).update({ email });
        } else {
          if (!(await confirmar({ titulo: 'Trocar o e-mail de login?', mensagem: `O corretor passará a entrar com <strong>${escapeHtml(email)}</strong> (antes: ${escapeHtml(emailAntigo || '—')}).`, detalhe: 'A senha antiga deixa de valer. Ele recebe no e-mail novo as boas-vindas com um link para criar a senha pessoal.', confirmar: '✉️ Trocar e-mail' }))) return;
          btn.textContent = 'Trocando e-mail…';
          const r = await trocarEmailLoginCorretor(uidExistente, email);
          if (!r) return;
          logAuditoria('trocar_email_login', 'corretor', uidExistente, { de: emailAntigo, para: email });
          const enviado = r.linkSenha ? await enviarEmailAcessoCorretor(nome, email, null, r.linkSenha) : false;
          avisoEmailTrocado = enviado
            ? `✅ E-mail de ${escapeHtml(nome)} trocado para <strong>${escapeHtml(email)}</strong>. Boas-vindas com o link para criar a senha enviadas.`
            : `⚠️ E-mail de ${escapeHtml(nome)} trocado, mas o e-mail de boas-vindas <strong>não foi enviado</strong>${r.linkSenha ? '' : ' (link de senha não gerado)'}. Peça para ele usar "Esqueci minha senha" na tela de login com ${escapeHtml(email)}.`;
        }
        $('corretor-email').dataset.original = email;
      }
      await tenantPath().collection('corretores').doc(uidExistente).update({
        nome, telefone, creci, tipo, documento, endereco,
        verContatoProprietario: $('corretor-ver-contato-prop').checked,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      });
      await db.collection('users').doc(uidExistente).update({ nome });
      logAuditoria('update', 'corretor', uidExistente, { nome, tipo, verContatoProprietario: $('corretor-ver-contato-prop').checked });
      closeCorretorModal();
      if (avisoEmailTrocado) showInlineStatus('corretores-status', avisoEmailTrocado, avisoEmailTrocado.startsWith('✅') ? 'success' : 'error');
      loadCorretores();
      return;
    }

    const senha = $('corretor-senha').value;
    if (!email) { showAlert('corretor-alert', 'E-mail é obrigatório.'); return; }
    if (!senha || senha.length < 6) { showAlert('corretor-alert', 'Senha deve ter no mínimo 6 caracteres.'); return; }
    btn.textContent = 'Criando…';

    const conta = await criarOuRecuperarContaAuth(email, senha);
    const uid = conta.uid;
    const agora = firebase.firestore.FieldValue.serverTimestamp();

    try {
      await db.collection('users').doc(uid).set({
        nome, email, tenantId: State.tenant.id, role: 'corretor',
        perfilId: null, ativo: true, status: 'ativo',
        criadoEm: agora, criadoPor: State.user.uid,
      });
      await tenantPath().collection('corretores').doc(uid).set({
        uid, nome, email, telefone, creci, tipo, documento, endereco, status: 'ativo',
        verContatoProprietario: $('corretor-ver-contato-prop').checked,
        origem: 'admin', criadoEm: agora, criadoPor: State.user.uid,
      });
    } catch (e) {
      // Banco recusou: apaga o login recém-criado pra não sobrar conta órfã
      if (conta.nova) await apagarContaAuth(conta.idToken);
      throw e;
    }

    // veio de um pré-cadastro da IA: a ficha sem login dá lugar à do uid
    if (_corretorPreId) {
      await tenantPath().collection('corretores').doc(_corretorPreId).delete().catch(() => {});
      _corretorPreId = null;
      if (typeof atualizarBadgeCorretoresPendentes === 'function') atualizarBadgeCorretoresPendentes();
    }

    if ($('corretor-enviar-email').checked) await enviarEmailAcessoCorretor(nome, email, senha);

    logAuditoria('create', 'corretor', uid, { nome, email, tipo });
    closeCorretorModal();
    showInlineStatus('corretores-status', `✅ Corretor ${escapeHtml(nome)} criado. Senha inicial: <strong>${escapeHtml(senha)}</strong>`, 'success');
    _corretoresAtivosCache = null;
    loadCorretores();
  } catch (err) {
    console.error('Erro ao salvar corretor:', err);
    showAlert('corretor-alert', 'Erro: ' + err.message);
    $('corretor-alert').scrollIntoView({ behavior: 'smooth', block: 'start' });   // o modal costuma estar rolado
  } finally {
    btn.disabled = false;
    btn.textContent = uidExistente ? 'Salvar' : 'Criar corretor';
  }
}

// Cria o login no Firebase Auth via REST (não desloga quem está operando).
// Se o e-mail já tem login (ex.: tentativa anterior que falhou no banco) e a
// senha confere, reaproveita a conta — desde que ela não seja usuário de ninguém.
async function criarOuRecuperarContaAuth(email, senha) {
  const apiKey = firebase.app().options.apiKey;
  const chamar = async (acao) => {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${acao}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: senha, returnSecureToken: true }),
    });
    return { ok: res.ok, data: await res.json() };
  };

  const novo = await chamar('signUp');
  if (novo.ok) return { uid: novo.data.localId, idToken: novo.data.idToken, nova: true };

  const erro = novo.data?.error?.message || 'Erro ao criar conta';
  if (erro !== 'EMAIL_EXISTS') throw new Error(erro.startsWith('WEAK_PASSWORD') ? 'Senha muito fraca (mín. 6 caracteres).' : erro);

  const login = await chamar('signInWithPassword');
  if (!login.ok) {
    throw new Error('Já existe um login com este e-mail e a senha digitada não confere. Use a mesma senha da tentativa anterior ou outro e-mail.');
  }
  const uid = login.data.localId;
  let jaTemCadastro = false;
  try { jaTemCadastro = (await db.collection('users').doc(uid).get()).exists; } catch (_) { /* sem permissão de leitura → o set decide */ }
  if (jaTemCadastro) throw new Error('Este e-mail já é usuário do sistema. Use outro e-mail para o corretor.');
  return { uid, idToken: login.data.idToken, nova: false };
}

async function apagarContaAuth(idToken) {
  if (!idToken) return;
  try {
    await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${firebase.app().options.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
  } catch (_) {}
}

// Chama o Worker para trocar o e-mail de login. Login solto (sem cadastro) com o mesmo
// e-mail: pergunta e libera. Devolve { linkSenha, ... } ou null (cancelado/erro já mostrado).
async function trocarEmailLoginCorretor(uid, email, liberarOrfao = false) {
  const url = await getMfaWorkerUrl();
  const idToken = await getIdTokenAtual();
  const res = await fetch(`${url}/usuarios/trocar-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
    body: JSON.stringify({ uid, email, liberarOrfao }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok !== false) return data;
  if (data.codigo === 'EMAIL_EXISTS' && data.dono && data.dono.orfao && !liberarOrfao) {
    const ok = await confirmar({
      titulo: 'E-mail preso num login solto',
      mensagem: escapeHtml(data.dono.texto),
      detalhe: 'Ninguém consegue entrar com esse login. Liberar apaga só ele e passa o e-mail para este corretor.',
      confirmar: '🔓 Liberar e usar', aviso: true,
    });
    if (!ok) return null;
    return trocarEmailLoginCorretor(uid, email, true);
  }
  throw new Error(data.error || `Erro ${res.status}`);
}

// Boas-vindas ao corretor. Com linkSenha: botão para ele criar a senha pessoal (troca de
// e-mail); sem: senha inicial (criação). Devolve true se o envio foi aceito.
async function enviarEmailAcessoCorretor(nome, email, senha, linkSenha) {
  try {
    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (!cfg.workerUrl) return false;
    const td = 'padding:6px 12px;border:1px solid #ccc;';
    const acesso = linkSenha
      ? `<table style="border-collapse:collapse;margin:14px 0;">
        <tr><td style="${td}background:#f0f0f0;"><strong>Link</strong></td><td style="${td}"><a href="${urlDoSistema()}">${urlDoSistema()}</a></td></tr>
        <tr><td style="${td}background:#f0f0f0;"><strong>E-mail (login)</strong></td><td style="${td}">${escapeHtml(email)}</td></tr>
      </table>
      <p>Para entrar, crie a sua senha pessoal e intransferível:</p>
      <p style="margin:18px 0;"><a href="${linkSenha}" style="background:#00897B;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold;">🔑 Criar minha senha</a></p>
      <p style="font-size:12px;color:#666;">O link vale por 1 hora e só pode ser usado uma vez. Se expirar, use "Esqueci minha senha" na tela de login. Não compartilhe sua senha com ninguém.</p>`
      : `<table style="border-collapse:collapse;margin:14px 0;">
        <tr><td style="${td}background:#f0f0f0;"><strong>Link</strong></td><td style="${td}"><a href="${urlDoSistema()}">${urlDoSistema()}</a></td></tr>
        <tr><td style="${td}background:#f0f0f0;"><strong>E-mail</strong></td><td style="${td}">${escapeHtml(email)}</td></tr>
        <tr><td style="${td}background:#f0f0f0;"><strong>Senha inicial</strong></td><td style="${td}font-family:'Courier New',monospace;"><strong>${escapeHtml(senha)}</strong></td></tr>
      </table>
      <p style="font-size:12px;color:#666;">Troque a senha no primeiro acesso pelo "Esqueci minha senha".</p>`;
    const html = `<html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#00897B;">Bem-vindo à rede de corretores</h2>
      <p>Olá <strong>${escapeHtml(nome)}</strong>,</p>
      <p>Você agora faz parte da rede de corretores de <strong>${escapeHtml(State.tenant.nome)}</strong>.
         Cadastre seus imóveis captados e acesse as fichas compartilhadas pela rede.</p>
      ${acesso}
      <p style="margin-top:24px;">— ${escapeHtml(State.tenant.nome)}</p>
    </body></html>`;
    const res = await fetch(cfg.workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: cfg.emailFrom || 'onboarding@resend.dev',
        fromName: State.tenant.nome || 'DRG-Rently',
        to: email,
        subject: `Acesso à rede de corretores — ${State.tenant.nome}`,
        html,
      }),
    });
    return res.ok;
  } catch (e) { console.warn('Falha ao enviar e-mail ao corretor:', e); return false; }
}

async function definirStatusCorretor(uid, status) {
  if (!exigirPode('corretores', 'editar')) return;
  const textos = {
    ativo:    { titulo: 'Liberar acesso?', msg: 'O corretor poderá entrar, cadastrar imóveis e ver as fichas da rede.', btn: '✅ Liberar' },
    suspenso: { titulo: 'Suspender corretor?', msg: 'O acesso é bloqueado na hora. Os imóveis que ele captou continuam no sistema.', btn: 'Suspender' },
  }[status];
  // 🛡 Liberar = conferir o CRECI (fica registrado quem conferiu e quando) — protecao.js
  let creciConferido = null;
  if (status === 'ativo' && typeof confirmarCreciNaAprovacao === 'function') {
    let jaConferido = false;
    try { jaConferido = !!(await tenantPath().collection('corretores').doc(uid).get()).data()?.creciConferido; } catch (_) {}
    if (!jaConferido) {
      creciConferido = await confirmarCreciNaAprovacao(uid);
      if (!creciConferido) return;
    } else if (!(await confirmar({ titulo: textos.titulo, mensagem: textos.msg, confirmar: textos.btn }))) return;
  } else if (!(await confirmar({ titulo: textos.titulo, mensagem: textos.msg, confirmar: textos.btn, aviso: status === 'suspenso' }))) return;
  try {
    const batch = db.batch();
    batch.update(db.collection('users').doc(uid), { ativo: status === 'ativo', status });
    batch.update(tenantPath().collection('corretores').doc(uid), {
      status, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      ...(creciConferido ? { creciConferido } : {}),
    });
    await batch.commit();
    logAuditoria('status', 'corretor', uid, { status, creciConferido: !!creciConferido });
    _corretoresAtivosCache = null;
    loadCorretores();
    if (status === 'suspenso' && typeof openTransferirCarteira === 'function'
        && await confirmar({ titulo: '🔁 Transferir a carteira?', mensagem: 'O corretor foi suspenso. Quer passar agora os imóveis, proprietários e leads dele para outro corretor?', confirmar: '🔁 Transferir agora', cancelar: 'Depois' })) {
      openTransferirCarteira(uid);
    }
    if (status === 'ativo' && creciConferido && typeof enviarContratoParceria === 'function'
        && await confirmar({ titulo: '📝 Contrato de parceria', mensagem: 'Mandar agora o contrato de parceria para o corretor assinar?', detalhe: 'O modelo fica em Corretores → 🛡 Proteção da rede.', confirmar: '📝 Enviar contrato', cancelar: 'Depois' })) {
      enviarContratoParceria(uid, null);
    }
  } catch (err) {
    console.error('Erro ao mudar status do corretor:', err);
    showInlineStatus('corretores-status', `❌ ${err.message}`, 'error');
  }
}

// ---------- Seção "Imóveis da Rede" ----------

let _redeCarregada = [];
let _filtroRedeFinalidade = 'todos';

async function loadRede() {
  const grid = $('rede-grid');
  if (!grid) return;
  grid.innerHTML = '<p class="empty">Carregando…</p>';
  try {
    const col = tenantPath().collection('imoveisRede');
    let docs;
    if (isCorretor()) {
      // Regras não filtram: cada consulta precisa bater com uma condição da regra
      const uid = State.user.uid;
      const snaps = await Promise.all([
        col.where('visivel', '==', true).get(),
        col.where('captadorUid', '==', uid).get(),
        col.where('compartilhadoCom', 'array-contains', uid).get(),
      ]);
      const porId = new Map();
      snaps.forEach(s => s.docs.forEach(d => porId.set(d.id, d)));
      docs = Array.from(porId.values());
    } else {
      docs = (await col.get()).docs;
    }
    const uid = State.user.uid;
    _redeCarregada = docs.map(d => {
      const f = d.data();
      return {
        _id: d.id, ...f,
        _meu: f.captadorUid === uid,
        _completo: !isCorretor() || f.captadorUid === uid || (f.compartilhadoCom || []).includes(uid),
      };
    }).sort((a, b) => String(a.apelido || a.endereco?.bairro || '').localeCompare(String(b.apelido || b.endereco?.bairro || ''), 'pt-BR'));
    // Nome do captador: só a equipe vê (vem do cadastro de corretores, não da ficha)
    if (!isCorretor()) {
      try {
        const nomes = new Map((await tenantPath().collection('corretores').get()).docs.map(d => [d.id, d.data().nome || null]));
        _redeCarregada.forEach(f => { f._captadorNome = nomes.get(f.captadorUid) || null; });
      } catch (_) {}
    }
    renderRede();
  } catch (err) {
    console.error('Erro ao carregar rede:', err);
    grid.innerHTML = `<p class="empty" style="color:var(--danger);">Erro: ${escapeHtml(err.message)}</p>`;
  }
}

function setFiltroRedeFinalidade(fin) {
  _filtroRedeFinalidade = fin || 'todos';
  document.querySelectorAll('#rede-filtros .papel-filtro-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.fin === _filtroRedeFinalidade);
  });
  renderRede();
}

function valorRedeTxt(f) {
  const fin = f.finalidade || f.finalidadeFiltro || 'locacao';
  const partes = [];
  if (fin !== 'venda' && f.aluguelSugerido) partes.push(`${fmtBRL(f.aluguelSugerido)}/mês`);
  if (fin !== 'locacao' && f.valorVenda) partes.push(`Venda ${fmtBRL(f.valorVenda)}`);
  return partes.join(' · ');
}

function renderRede() {
  const grid = $('rede-grid');
  const busca = ($('rede-busca')?.value || '').trim().toLowerCase();
  let lista = _redeCarregada;
  if (_filtroRedeFinalidade !== 'todos') {
    lista = lista.filter(f => {
      const fin = f.finalidadeFiltro || f.finalidade || 'locacao';
      return fin === _filtroRedeFinalidade || fin === 'ambos';
    });
  }
  if (busca) {
    lista = lista.filter(f => [f.codigoAnuncio, f.apelido, f.endereco?.bairro, f.endereco?.cidade, f.endereco?.logradouro, f._captadorNome, ...(f.tags || [])]
      .filter(Boolean).join(' ').toLowerCase().includes(busca));
  }
  if (lista.length === 0) {
    grid.innerHTML = '<p class="empty">Nenhum imóvel na rede com esses filtros.</p>';
    return;
  }
  grid.innerHTML = lista.map(f => {
    const capa = (f.fotos || [])[0];
    const local = [f.endereco?.bairro, f.endereco?.cidade].filter(Boolean).join(' — ');
    const carac = [
      f.quartos ? `${f.quartos} qto` : '', f.vagas ? `${f.vagas} vaga` : '',
      f.areaUtil ? `${f.areaUtil} m²` : '',
    ].filter(Boolean).join(' · ');
    const selos = [
      f._meu ? '<span class="papel-chip" style="background:#CCFBF1;color:#0F766E;">⭐ Meu</span>' : '',
      !f._meu && f._completo && isCorretor() ? '<span class="papel-chip" style="background:#DBEAFE;color:#1E40AF;">🔓 Completo liberado</span>' : '',
      !f.visivel ? '<span class="papel-chip" style="background:#E5E7EB;color:#374151;">🔒 Privado</span>' : '',
      temPermuta(f) ? '<span class="selo-permuta-chip">PERMUTA</span>' : '',
    ].join(' ');
    return `
      <div class="rede-card" onclick="abrirFichaRede('${f._id}')">
        <div class="rede-card-capa">${urlSegura(capa) ? `<img src="${urlSegura(capa)}" alt="" loading="lazy">` : '<span>🏠</span>'}</div>
        <div class="rede-card-body">
          <div>${selos}</div>
          ${f.codigoAnuncio ? `<span class="codigo-anuncio-chip">${escapeHtml(f.codigoAnuncio)}</span>` : ''}
          <strong>${escapeHtml(f.apelido || (f.tipo ? (IMOVEL_TIPO_LABEL[f.tipo] || f.tipo) : 'Imóvel'))}</strong>
          ${local ? `<div class="muted" style="font-size:12px;">📍 ${escapeHtml(local)}</div>` : ''}
          ${carac ? `<div style="font-size:12px;">${escapeHtml(carac)}</div>` : ''}
          ${valorRedeTxt(f) ? `<div style="font-weight:600; color:var(--primary);">${valorRedeTxt(f)}</div>` : ''}
          ${f._captadorNome ? `<div class="muted" style="font-size:11px;">Captador: ${escapeHtml(f._captadorNome)}</div>` : (f._meu && isCorretor() ? '<div class="muted" style="font-size:11px;">Captado por você</div>' : '')}
        </div>
      </div>`;
  }).join('');
}

// Corretor marcado como exceção (corretores/{uid}.verContatoProprietario) — lido uma vez por sessão
let _veContatoProprietario = null;
async function corretorVeContatoProprietario() {
  if (_veContatoProprietario !== null) return _veContatoProprietario;
  try { _veContatoProprietario = !!(await tenantPath().collection('corretores').doc(State.user.uid).get()).data()?.verContatoProprietario; }
  catch (_) { _veContatoProprietario = false; }
  return _veContatoProprietario;
}

async function abrirFichaRede(id) {
  const resumo = _redeCarregada.find(f => f._id === id);
  if (!resumo) return;
  if (typeof registrarFichaAberta === 'function') registrarFichaAberta(id);
  let f = resumo;
  if (resumo._completo) {
    try {
      const snap = await tenantPath().collection('imoveisRede').doc(id).collection('completo').doc('dados').get();
      if (snap.exists) f = { ...resumo, ...snap.data() };
    } catch (e) { console.warn('Ficha completa indisponível, mostrando ficha da rede:', e); }
  }

  let proprietarioLiberado = null;
  if (isCorretor() && await corretorVeContatoProprietario()) {
    try {
      const s = await tenantPath().collection('imoveisRede').doc(id).collection('contato').doc('proprietario').get();
      if (s.exists) proprietarioLiberado = s.data();
    } catch (_) {}
  }
  const linha = (rotulo, valor) => (valor === null || valor === undefined || valor === '') ? ''
    : `<tr><td class="muted" style="padding:4px 10px 4px 0; white-space:nowrap;">${rotulo}</td><td style="padding:4px 0;">${valor}</td></tr>`;
  const end = f.endereco || {};
  const endTxt = [end.logradouro, end.numero, end.complemento].filter(Boolean).join(', ');
  const local = [end.bairro, end.cidade, end.uf].filter(Boolean).join(' — ');
  const contato = c => c ? [escapeHtml(c.nome || ''), c.telefone ? escapeHtml(maskTelefone(c.telefone)) : '', c.email ? escapeHtml(c.email) : '', c.creci ? 'CRECI ' + escapeHtml(c.creci) : ''].filter(Boolean).join(' · ') : '';

  $('rede-ficha-title').textContent = f.apelido || 'Ficha do imóvel';
  $('rede-ficha-body').innerHTML = `
    ${(f.fotos || []).length ? `<div class="rede-ficha-fotos">${f.fotos.map(urlSegura).filter(Boolean).map(u => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
    <p class="muted" style="font-size:12px;">${resumo._completo ? '🔓 Ficha completa' : '📋 Ficha da rede — campos liberados pela imobiliária'}</p>
    <table style="width:100%; font-size:13px;">
      ${linha('Tipo', [IMOVEL_TIPO_LABEL[f.tipo] || f.tipo, f.subtipo].filter(Boolean).map(escapeHtml).join(' / '))}
      ${linha('Finalidade', escapeHtml({ locacao: 'Locação', venda: 'Venda', ambos: 'Locação e venda' }[f.finalidade] || ''))}
      ${linha('Status', escapeHtml(IMOVEL_STATUS_LABEL[f.status] || f.status || ''))}
      ${linha('Valor', valorRedeTxt(f))}
      ${linha('Endereço', escapeHtml(endTxt))}
      ${linha('Localização', escapeHtml(local))}
      ${linha('CEP', escapeHtml(end.cep || ''))}
      ${linha('Área', [f.areaUtil ? `${f.areaUtil} m² útil` : '', f.areaTotal ? `${f.areaTotal} m² total` : ''].filter(Boolean).join(' · '))}
      ${linha('Cômodos', f.quartos !== undefined ? `${f.quartos} quarto(s) · ${f.banheiros || 0} banheiro(s) · ${f.vagas || 0} vaga(s)` : '')}
      ${linha('Andar', escapeHtml(f.andar || ''))}
      ${linha('Permuta', f.aceitaPermuta === 'sim' ? `Aceita${f.permutaObs ? ' — ' + escapeHtml(f.permutaObs) : ''}` : '')}
      ${linha('Financiamento / FGTS', [f.aceitaFinanciamento, f.permiteFGTS].some(Boolean) ? `${escapeHtml(f.aceitaFinanciamento || '—')} / ${escapeHtml(f.permiteFGTS || '—')}` : '')}
      ${linha('Matrícula', escapeHtml(f.matricula || ''))}
      ${linha('IPTU', escapeHtml(f.iptu || ''))}
      ${linha('Contato para negociar', contato(contatoImobiliaria()) + ' <span class="muted" style="font-size:11px;">(sempre a imobiliária)</span>')}
      ${proprietarioLiberado ? linha('Proprietário', contato(proprietarioLiberado) + ' <span class="muted" style="font-size:11px;">(liberado pela imobiliária só para você — uso restrito a esta negociação)</span>') : ''}
      ${!isCorretor() && f._captadorNome ? linha('Captador', escapeHtml(f._captadorNome)) : ''}
      ${linha('Vídeo', urlSegura(f.videoUrl) ? `<a href="${urlSegura(f.videoUrl)}" target="_blank" rel="noopener">abrir</a>` : '')}
      ${linha('Tour virtual', urlSegura(f.tourUrl) ? `<a href="${urlSegura(f.tourUrl)}" target="_blank" rel="noopener">abrir</a>` : '')}
    </table>
    ${f.descricaoLonga ? `<h4 class="form-section-title">Descrição</h4><p style="white-space:pre-wrap; font-size:13px;">${escapeHtml(f.descricaoLonga)}</p>` : ''}
    ${(f.tags || []).length ? `<div>${f.tags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join(' ')}</div>` : ''}
    ${f.obs ? `<h4 class="form-section-title">Observações internas</h4><p style="white-space:pre-wrap; font-size:13px;">${escapeHtml(f.obs)}</p>` : ''}
  `;
  $('btn-rede-ficha-editar').style.display = (resumo._meu || !isCorretor()) ? 'inline-block' : 'none';
  $('btn-rede-ficha-editar').onclick = () => { closeFichaRede(); openImovelModal(id); };
  $('modal-rede-ficha').style.display = 'flex';
}

function closeFichaRede() {
  $('modal-rede-ficha').style.display = 'none';
}

window.loadRede = loadRede;
window.renderRede = renderRede;
window.setFiltroRedeFinalidade = setFiltroRedeFinalidade;
window.abrirFichaRede = abrirFichaRede;
window.closeFichaRede = closeFichaRede;
window.openCorretorModal = openCorretorModal;
window.previaAnuncio = previaAnuncio;
window.previaDoModalImovel = previaDoModalImovel;
window.criarAcessoCorretorPre = criarAcessoCorretorPre;
window.descartarCorretorPre = descartarCorretorPre;
window.closeCorretorModal = closeCorretorModal;
window.gerarSenhaCorretor = gerarSenhaCorretor;
window.saveCorretor = saveCorretor;
window.definirStatusCorretor = definirStatusCorretor;
window.salvarConfigRede = salvarConfigRede;
window.reaplicarTodasFichasRede = reaplicarTodasFichasRede;

// =============================================================
// PROGRAMA DE PARCEIROS ("Seja corretor parceiro") + COMISSÃO DIVIDIDA
// =============================================================
// Config fica no PRÓPRIO doc do tenant (tenants/{tid}.programaParceiros),
// que já é de leitura pública — a página parceiro.html lê dali o convite e a
// regra de comissão. Nada de token/segredo nesse objeto.
//   { ativo, titulo, texto, exigeCreci,
//     comissao: { captadorPct, vendedorPct, escritorioPct } }  (soma = 100)

const COMISSAO_PADRAO = { captadorPct: 30, vendedorPct: 30, escritorioPct: 40 };

function regraComissao() {
  const c = State.tenant?.programaParceiros?.comissao || {};
  return {
    captadorPct: Number.isFinite(c.captadorPct) ? c.captadorPct : COMISSAO_PADRAO.captadorPct,
    vendedorPct: Number.isFinite(c.vendedorPct) ? c.vendedorPct : COMISSAO_PADRAO.vendedorPct,
    escritorioPct: Number.isFinite(c.escritorioPct) ? c.escritorioPct : COMISSAO_PADRAO.escritorioPct,
  };
}

function linkProgramaParceiros() {
  const t = State.tenant || {};
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  return `${base}parceiro.html?t=${encodeURIComponent(t.slug || t.id || '')}`;
}

async function loadProgramaParceiros() {
  if (!$('pp-ativo')) return;
  try {
    const snap = await db.collection('tenants').doc(State.tenant.id).get();
    if (snap.exists) State.tenant = { id: snap.id, ...snap.data() };
  } catch (_) {}
  const pp = State.tenant.programaParceiros || {};
  const r = regraComissao();
  $('pp-ativo').checked = pp.ativo === true;
  $('pp-titulo').value = pp.titulo || `Cadastre seus imóveis na rede ${State.tenant.nome || ''}`.trim();
  $('pp-texto').value = pp.texto || [
    'Seus imóveis captados ganham vitrine no nosso site e nos principais portais.',
    'Você continua dono da sua captação: só você e a imobiliária veem os dados do proprietário.',
    'Fechou negócio com imóvel da rede? A comissão é dividida entre quem captou, quem vendeu e o escritório — tudo registrado no sistema.',
    'CRM gratuito para organizar seus imóveis.',
  ].join('\n');
  $('pp-exige-creci').checked = pp.exigeCreci !== false;
  $('pp-captador').value = r.captadorPct;
  $('pp-vendedor').value = r.vendedorPct;
  $('pp-escritorio').value = r.escritorioPct;
  $('pp-link').value = linkProgramaParceiros();
  atualizarSomaComissaoPP();
}

function atualizarSomaComissaoPP() {
  const soma = ['pp-captador', 'pp-vendedor', 'pp-escritorio'].reduce((s, id) => s + (parseFloat($(id).value) || 0), 0);
  const el = $('pp-soma');
  el.textContent = `Soma: ${soma}%`;
  el.style.color = Math.abs(soma - 100) < 0.01 ? 'var(--success, #15803d)' : 'var(--danger)';
}

async function salvarProgramaParceiros() {
  if (!exigirPode('corretores', 'editar')) return;
  const comissao = {
    captadorPct: parseFloat($('pp-captador').value) || 0,
    vendedorPct: parseFloat($('pp-vendedor').value) || 0,
    escritorioPct: parseFloat($('pp-escritorio').value) || 0,
  };
  const soma = comissao.captadorPct + comissao.vendedorPct + comissao.escritorioPct;
  if (Math.abs(soma - 100) > 0.01) {
    showInlineStatus('pp-status', `⚠️ Os percentuais precisam somar 100% (hoje: ${soma}%).`, 'error');
    return;
  }
  const programaParceiros = {
    ativo: $('pp-ativo').checked,
    titulo: $('pp-titulo').value.trim() || null,
    texto: $('pp-texto').value.trim() || null,
    exigeCreci: $('pp-exige-creci').checked,
    comissao,
  };
  try {
    await db.collection('tenants').doc(State.tenant.id).update({
      programaParceiros,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    });
    State.tenant.programaParceiros = programaParceiros;
    logAuditoria('update', 'config', 'programaParceiros', programaParceiros);
    showInlineStatus('pp-status', programaParceiros.ativo
      ? '✅ Salvo. A página de cadastro está NO AR — divulgue o link abaixo.'
      : '✅ Salvo. A página de cadastro está DESLIGADA (ninguém consegue se cadastrar).', 'success', 8000);
  } catch (err) {
    console.error('Erro ao salvar programa de parceiros:', err);
    showInlineStatus('pp-status', `❌ ${err.message}`, 'error');
  }
}

function copiarLinkParceiro() {
  const v = $('pp-link').value;
  navigator.clipboard.writeText(v)
    .then(() => showInlineStatus('pp-status', '📋 Link copiado.', 'success', 3000))
    .catch(() => { $('pp-link').select(); document.execCommand('copy'); });
}

// Badge no menu com quantos corretores aguardam aprovação
async function atualizarBadgeCorretoresPendentes() {
  const link = document.querySelector('.nav-link[data-section="corretores"]');
  if (!link || !State.tenant) return;
  try {
    const snap = await tenantPath().collection('corretores').where('status', '==', 'pendente').get();
    let badge = link.querySelector('.nav-badge-pendentes');
    if (snap.empty) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-badge-pendentes';
      link.appendChild(badge);
    }
    badge.textContent = snap.size;
    badge.title = `${snap.size} corretor(es) aguardando aprovação`;
  } catch (_) {}
}

// ---------- Comissão dividida na Negociação ----------

let _negCorretores = [];

async function prepararComissaoNegociacao(neg) {
  if (!$('neg-com-captador')) return;
  let corretores = [];
  try { _corretoresAtivosCache = null; corretores = await listarCorretoresAtivos(); } catch (_) {}
  _negCorretores = corretores;
  const opts = '<option value="">🏢 Escritório (sem corretor)</option>'
    + corretores.map(c => `<option value="${c.uid}">${escapeHtml(c.nome || c.email || c.uid)}</option>`).join('');
  $('neg-com-captador').innerHTML = opts;
  $('neg-com-vendedor').innerHTML = opts;

  const d = neg?.divisaoComissao;
  const r = regraComissao();
  $('neg-com-captador').value = d?.captadorUid || '';
  $('neg-com-vendedor').value = d?.vendedorUid || '';
  $('neg-com-captador-pct').value = d?.captadorPct ?? r.captadorPct;
  $('neg-com-vendedor-pct').value = d?.vendedorPct ?? r.vendedorPct;
  $('neg-com-escritorio-pct').value = d?.escritorioPct ?? r.escritorioPct;
  $('neg-com-captador').dataset.manual = d ? '1' : '';
  recalcularComissaoNegociacao();
}

// Ao escolher o imóvel, sugere o captador (quem cadastrou), se for corretor
function sugerirCaptadorNegociacao(imovel) {
  const sel = $('neg-com-captador');
  if (!sel || sel.dataset.manual === '1' || !imovel) return;
  sel.value = _negCorretores.some(c => c.uid === imovel.criadoPor) ? imovel.criadoPor : '';
  recalcularComissaoNegociacao();
}

function lerComissaoNegociacao() {
  const valor = parseFloat($('negociacao-valor')?.value) || 0;
  const comissaoPct = parseFloat($('negociacao-comissao')?.value) || 0;
  const total = Math.round(valor * comissaoPct) / 100;
  const pct = id => parseFloat($(id).value) || 0;
  const nome = uid => uid ? (_negCorretores.find(c => c.uid === uid)?.nome || null) : null;
  const captadorUid = $('neg-com-captador').value || null;
  const vendedorUid = $('neg-com-vendedor').value || null;
  const captadorPct = pct('neg-com-captador-pct');
  const vendedorPct = pct('neg-com-vendedor-pct');
  const escritorioPct = pct('neg-com-escritorio-pct');
  const parte = p => Math.round(total * p) / 100;
  return {
    base: valor, comissaoPct, total,
    captadorUid, captadorNome: nome(captadorUid), captadorPct, captadorValor: parte(captadorPct),
    vendedorUid, vendedorNome: nome(vendedorUid), vendedorPct, vendedorValor: parte(vendedorPct),
    escritorioPct, escritorioValor: parte(escritorioPct),
  };
}

function recalcularComissaoNegociacao() {
  if (!$('neg-com-resumo')) return;
  const d = lerComissaoNegociacao();
  const soma = d.captadorPct + d.vendedorPct + d.escritorioPct;
  const ok = Math.abs(soma - 100) < 0.01;
  $('neg-com-resumo').innerHTML = `
    Comissão total: <strong>${fmtBRL(d.total)}</strong> (${d.comissaoPct}% de ${fmtBRL(d.base)})<br>
    Captador: <strong>${fmtBRL(d.captadorValor)}</strong> · Quem fechou: <strong>${fmtBRL(d.vendedorValor)}</strong> · Escritório: <strong>${fmtBRL(d.escritorioValor)}</strong>
    ${ok ? '' : `<br><span style="color:var(--danger);">⚠️ Percentuais somam ${soma}% — precisam somar 100%.</span>`}`;
}

function onComissaoCaptadorManual() {
  $('neg-com-captador').dataset.manual = '1';
  recalcularComissaoNegociacao();
}

function validarComissaoNegociacao(d) {
  const soma = d.captadorPct + d.vendedorPct + d.escritorioPct;
  return Math.abs(soma - 100) < 0.01 ? null : `A divisão da comissão precisa somar 100% (hoje: ${soma}%).`;
}

// Espelho da comissão pros corretores envolvidos verem (comissoes/{negId}).
// Corretor não lê negociações — só o próprio extrato aqui (regra: participantes).
async function sincronizarComissao(negociacaoId, neg) {
  const d = neg.divisaoComissao;
  const ref = tenantPath().collection('comissoes').doc(negociacaoId);
  const participantes = [d?.captadorUid, d?.vendedorUid].filter(Boolean);
  if (!d || participantes.length === 0) { await ref.delete().catch(() => {}); return; }
  const im = (_imoveisCache || []).find(i => i.id === neg.imovelId) || {};
  await ref.set({
    origem: 'negociacao',
    negociacaoId,
    numero: neg.numero || null,
    imovelId: neg.imovelId || null,
    imovelApelido: im.apelido || null,
    status: neg.status || null,
    ...d,
    participantes,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// ---------- Extratos de comissão ----------

const COMISSAO_STATUS_LABEL = {
  rascunho: '📝 Rascunho', em_negociacao: '💬 Em negociação', aceita: '✅ Aceita (previsto)',
  fechada: '🏆 Fechada', recusada: '❌ Recusada',
};

// Corretor: "Minhas comissões" (na tela Imóveis da Rede)
async function loadMinhasComissoes() {
  const box = $('minhas-comissoes');
  if (!box) return;
  const card = $('card-minhas-comissoes');
  if (!isCorretor()) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  try {
    const uid = State.user.uid;
    const snap = await tenantPath().collection('comissoes').where('participantes', 'array-contains', uid).get();
    if (snap.empty) { box.innerHTML = '<p class="empty">Nenhuma comissão registrada ainda.</p>'; return; }
    let fechado = 0, previsto = 0;
    const rows = snap.docs.map(d => d.data()).map(c => {
      const papeis = [];
      let valor = 0;
      if (c.captadorUid === uid) { papeis.push('Captação'); valor += c.captadorValor || 0; }
      if (c.vendedorUid === uid) { papeis.push('Venda'); valor += c.vendedorValor || 0; }
      if (c.status === 'fechada') fechado += valor;
      else if (c.status === 'aceita') previsto += valor;
      return `<tr>
        <td>${escapeHtml(c.numero || '—')}</td>
        <td>${escapeHtml(c.imovelApelido || '—')}</td>
        <td>${papeis.join(' + ')}</td>
        <td>${COMISSAO_STATUS_LABEL[c.status] || escapeHtml(c.status || '—')}</td>
        <td><strong>${fmtBRL(valor)}</strong></td>
      </tr>`;
    });
    box.innerHTML = `
      <p>🏆 Fechado: <strong>${fmtBRL(fechado)}</strong> · ✅ Previsto (propostas aceitas): <strong>${fmtBRL(previsto)}</strong></p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Nº</th><th>Imóvel</th><th>Sua parte</th><th>Status</th><th>Valor</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table></div>`;
  } catch (err) {
    console.error('Erro ao carregar comissões:', err);
    box.innerHTML = `<p class="empty" style="color:var(--danger);">Erro: ${escapeHtml(err.message)}</p>`;
  }
}

// Admin: comissões por corretor (na tela Corretores)
async function loadComissoesPorCorretor() {
  const tbody = $('tbody-comissoes-corretor');
  if (!tbody) return;
  try {
    const snap = await tenantPath().collection('comissoes').get();
    const tot = {};
    const somar = (uid, nome, valor, status) => {
      if (!uid) return;
      const t = tot[uid] || (tot[uid] = { nome: nome || uid, fechado: 0, previsto: 0, negocios: 0 });
      t.negocios++;
      if (status === 'fechada') t.fechado += valor || 0;
      else if (status === 'aceita') t.previsto += valor || 0;
    };
    let escritorio = 0;
    snap.docs.forEach(d => {
      const c = d.data();
      somar(c.captadorUid, c.captadorNome, c.captadorValor, c.status);
      somar(c.vendedorUid, c.vendedorNome, c.vendedorValor, c.status);
      if (c.status === 'fechada') escritorio += c.escritorioValor || 0;
    });
    const lista = Object.values(tot).sort((a, b) => b.fechado - a.fechado);
    tbody.innerHTML = lista.length
      ? lista.map(t => `<tr><td>${escapeHtml(t.nome)}</td><td>${t.negocios}</td><td>${fmtBRL(t.previsto)}</td><td><strong>${fmtBRL(t.fechado)}</strong></td></tr>`).join('')
        + `<tr><td><em>🏢 Escritório</em></td><td>—</td><td>—</td><td><strong>${fmtBRL(escritorio)}</strong></td></tr>`
      : '<tr><td colspan="4" class="empty">Nenhuma negociação com divisão de comissão ainda.</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty" style="color:var(--danger);">Erro: ${escapeHtml(err.message)}</td></tr>`;
  }
}

window.salvarProgramaParceiros = salvarProgramaParceiros;
window.copiarLinkParceiro = copiarLinkParceiro;
window.atualizarSomaComissaoPP = atualizarSomaComissaoPP;
window.recalcularComissaoNegociacao = recalcularComissaoNegociacao;
window.onComissaoCaptadorManual = onComissaoCaptadorManual;

// =============================================================
// LEADS × CORRETORES — repassar, lead manual e "Meus leads"
// =============================================================
// leadsImoveis/{id} ganha: corretorUid, corretorNome, atribuidoEm, atribuidoPor,
// notaRepasse, notaCorretor, motivoDevolucao, historico[] ({acao, porNome, paraNome, nota, em}).
// Admin/equipe repassa via gravar() (respeita perfil e fila de aprovação).
// Corretor lê/atualiza SÓ os leads com corretorUid == ele (firestore.rules); ao
// devolver, o lead volta sem corretor com status 'devolvido' pra redistribuir.

const LEAD_CANAL_LABEL = {
  whatsapp: '💬 WhatsApp', telefone: '📞 Telefone', email: '✉️ E-mail', presencial: '🤝 Presencial',
  indicacao: '🙋 Indicação', zap: 'ZAP Imóveis', vivareal: 'Viva Real', olx: 'OLX',
  imovelweb: 'Imovelweb', chavesnamao: 'Chaves na Mão', facebook: 'Facebook / Instagram', outro: 'Outro',
  interesse_imovel: '📅 Pedido no site', vitrine_publica: '🏠 Anuncie (site)', manual: '✍️ Manual',
};

function entradaHistoricoLead(acao, extra = {}) {
  return {
    acao,
    porUid: State.user?.uid || null,
    porNome: State.userDoc?.nome || State.user?.email || null,
    em: new Date().toISOString(),
    ...extra,
  };
}

function diasDesde(ts) {
  const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
  if (!d || isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Célula "Corretor" na tabela de Leads do admin
function celulaCorretorLead(l) {
  if (l.status === 'devolvido') {
    return `<span style="color:#991B1B; font-size:12px;">↩ Devolvido</span>`
      + (l.motivoDevolucao ? `<br><span class="muted" style="font-size:11px;" title="${escapeHtml(l.motivoDevolucao)}">${escapeHtml(l.motivoDevolucao.slice(0, 60))}</span>` : '');
  }
  if (!l.corretorUid) return '<span class="muted" style="font-size:12px;">— sem corretor</span>';
  const dias = diasDesde(l.atribuidoEm);
  const parado = (l.status || 'novo') === 'novo' && dias !== null && dias >= 2;
  return `<strong style="font-size:12px;">${escapeHtml(l.corretorNome || 'Corretor')}</strong>`
    + (l.atribuidoPor === 'auto' ? ` <span class="papel-chip" title="${escapeHtml(l.notaRepasse || 'Distribuído automaticamente')}">🤖 automático</span>` : '')
    + (dias !== null ? `<br><span style="font-size:11px; ${parado ? 'color:#B91C1C; font-weight:600;' : 'color:var(--text-muted);'}">${parado ? '⚠️ sem contato há ' : 'há '}${dias} dia(s)</span>` : '');
}

// ---------- Repassar (admin/equipe) ----------

async function openRepassarLead(leadId) {
  clearAlert('repasse-lead-alert');
  const lead = (_leadsCarregados || []).find(l => l._id === leadId);
  if (!lead) return;
  $('repasse-lead-id').value = leadId;
  $('repasse-lead-cliente').textContent = `${lead.nome || 'sem nome'}${lead.telefone ? ' · ' + maskTelefone(lead.telefone) : ''}`;
  $('repasse-lead-nota').value = '';
  $('repasse-lead-whats').checked = true;

  let corretores = [];
  try { _corretoresAtivosCache = null; corretores = await listarCorretoresAtivos(); } catch (_) {}
  // Sugestão: captador do imóvel (se for corretor ativo)
  let sugerido = null;
  if (lead.imovelId) {
    try {
      const im = await tenantPath().collection('imoveis').doc(lead.imovelId).get();
      const cap = im.exists ? im.data().criadoPor : null;
      if (cap && corretores.some(c => c.uid === cap)) sugerido = cap;
    } catch (_) {}
  }
  $('repasse-lead-corretor').innerHTML = (lead.corretorUid ? '<option value="">— Tirar do corretor (volta pra imobiliária)</option>' : '<option value="">— Selecione —</option>')
    + corretores.map(c => `<option value="${c.uid}">${escapeHtml(c.nome || c.email || c.uid)}${c.uid === sugerido ? ' ⭐ captador do imóvel' : ''}${c.telefone ? '' : ' (sem telefone)'}</option>`).join('');
  $('repasse-lead-corretor').value = lead.corretorUid || sugerido || '';
  $('repasse-lead-atual').textContent = lead.corretorUid ? `Hoje está com: ${lead.corretorNome || 'corretor'}` : '';
  $('modal-repasse-lead').style.display = 'flex';
}

function closeRepassarLead() {
  $('modal-repasse-lead').style.display = 'none';
}

function mensagemRepasseWhats(lead, corretor, nota) {
  const linhas = [
    `Olá ${corretor.nome || ''}! Novo lead pra você — ${State.tenant?.nome || 'imobiliária'}:`,
    '',
    `👤 ${primeiroNome(lead.nome) || 'Cliente'}`,
    '🔒 O contato do cliente fica com a imobiliária — combine a visita com a gente.',
    (lead.codigoAnuncio || lead.tituloImovel) ? `🏠 ${[lead.codigoAnuncio, lead.tituloImovel].filter(Boolean).join(' — ')}` : '',
    lead.melhorHorario && lead.melhorHorario !== 'qualquer' ? `🕐 Melhor horário: ${LEAD_HORARIO_LABEL[lead.melhorHorario] || lead.melhorHorario}` : '',
    (lead.mensagem || lead.descricao) ? `💬 ${ocultarContatos((lead.mensagem || lead.descricao).slice(0, 300))}` : '',
    nota ? `📝 Obs.: ${nota}` : '',
    '',
    `Detalhes em "Meus leads": ${urlDoSistema()}`,
  ];
  return linhas.filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0)).join('\n');
}

async function confirmarRepassarLead() {
  clearAlert('repasse-lead-alert');
  const leadId = $('repasse-lead-id').value;
  const lead = (_leadsCarregados || []).find(l => l._id === leadId);
  if (!lead) return;
  const uid = $('repasse-lead-corretor').value || null;
  if (!uid && !lead.corretorUid) { showAlert('repasse-lead-alert', 'Escolha o corretor.'); return; }
  const nota = $('repasse-lead-nota').value.trim() || null;
  const corretor = uid ? (_corretoresAtivosCache || []).find(c => c.uid === uid) : null;
  const querWhats = !!(uid && $('repasse-lead-whats').checked && corretor?.telefone);
  // Abre a aba já no clique (depois de um await o navegador bloqueia o pop-up)
  const janela = querWhats ? window.open('about:blank', '_blank') : null;

  const antes = await lerAntes('leadsImoveis', leadId);
  const historico = Array.isArray(antes?.historico) ? antes.historico.slice(-30) : [];
  historico.push(uid
    ? entradaHistoricoLead(lead.corretorUid ? 'transferido' : 'repassado', { paraUid: uid, paraNome: corretor?.nome || null, nota })
    : entradaHistoricoLead('retirado', { deNome: lead.corretorNome || null }));
  const status = lead.status || 'novo';
  const dados = {
    corretorUid: uid,
    corretorNome: corretor?.nome || null,
    atribuidoEm: uid ? firebase.firestore.FieldValue.serverTimestamp() : null,
    atribuidoPor: uid ? State.user.uid : null,
    notaRepasse: uid ? nota : null,
    // devolvido e repassado de novo → volta a ser "novo" pro corretor que recebe
    status: (uid && status === 'devolvido') ? 'novo' : status,
    historico,
  };
  if (uid) { dados.motivoDevolucao = null; }

  try {
    const r = await gravar({ modulo: 'leads', colecao: 'leadsImoveis', op: 'editar', id: leadId, dados,
      antes, titulo: `Lead de ${lead.nome || 'sem nome'} → ${corretor?.nome || 'imobiliária'}` });
    if (r.pendente) {
      if (janela) janela.close();
      closeRepassarLead();
      // (a cópia sem contato para o corretor é criada pela tela de Leads depois da aprovação)
      await confirmar({ titulo: '🕓 Enviado para aprovação', mensagem: msgGravacao(r), confirmar: 'OK' });
      return;
    }
    await gravarLeadDoCorretor(leadId, { ...lead, ...dados, atribuidoEm: new Date() }, uid);
    logAuditoria('repassar', 'lead', leadId, { para: uid, paraNome: corretor?.nome || null });
    if (janela) {
      janela.location.href = `https://wa.me/${telefoneWhatsApp(corretor.telefone)}?text=${encodeURIComponent(mensagemRepasseWhats(lead, corretor, nota))}`;
    }
    closeRepassarLead();
    loadLeads();
  } catch (err) {
    if (janela) janela.close();
    console.error('Erro ao repassar lead:', err);
    showAlert('repasse-lead-alert', 'Erro: ' + err.message);
  }
}

// ---------- Lead manual (WhatsApp, telefone, e-mail dos portais…) ----------

async function openLeadManual() {
  clearAlert('lead-manual-alert');
  ['lm-nome', 'lm-telefone', 'lm-email', 'lm-mensagem'].forEach(id => { $(id).value = ''; });
  $('lm-canal').value = 'whatsapp';
  $('lm-tipo').value = 'cliente';
  $('lm-finalidade').value = 'venda';
  let imoveis = [];
  try { imoveis = await ensureImoveisCache(); } catch (_) {}
  $('lm-imovel').innerHTML = '<option value="">— Nenhum imóvel específico —</option>'
    + imoveis.filter(i => !i.rascunho)
      .map(i => `<option value="${i.id}">${escapeHtml([i.codigoAnuncio, i.apelido].filter(Boolean).join(' — ') || i.id)}</option>`).join('');
  onTipoLeadManual();
  $('modal-lead-manual').style.display = 'flex';
}

function closeLeadManual() {
  $('modal-lead-manual').style.display = 'none';
}

function onTipoLeadManual() {
  const cliente = $('lm-tipo').value === 'cliente';
  $('lm-imovel-group').style.display = cliente ? 'block' : 'none';
  $('lm-finalidade-label').textContent = cliente ? 'Quer' : 'Quer anunciar para';
  $('lm-finalidade').innerHTML = cliente
    ? '<option value="venda">Comprar</option><option value="locacao">Alugar</option><option value="ambos">Comprar ou alugar</option>'
    : '<option value="venda">Vender</option><option value="locacao">Alugar</option><option value="ambos">Vender ou alugar</option>';
}

async function salvarLeadManual() {
  clearAlert('lead-manual-alert');
  const nome = $('lm-nome').value.trim();
  const telefone = $('lm-telefone').value.replace(/\D/g, '');
  if (!nome) { showAlert('lead-manual-alert', 'Informe o nome.'); return; }
  if (telefone.length < 10) { showAlert('lead-manual-alert', 'Informe o telefone com DDD.'); return; }
  const tipoLead = $('lm-tipo').value;
  const imovelId = tipoLead === 'cliente' ? ($('lm-imovel').value || null) : null;
  const im = imovelId ? (_imoveisCache || []).find(i => i.id === imovelId) : null;
  const dados = {
    origem: 'manual',
    canal: $('lm-canal').value,
    tipoLead,
    nome,
    telefone,
    email: $('lm-email').value.trim() || null,
    finalidade: $('lm-finalidade').value,
    imovelId,
    codigoAnuncio: im?.codigoAnuncio || null,
    tituloImovel: im?.apelido || null,
    mensagem: $('lm-mensagem').value.trim() || null,
    status: 'novo',
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    criadoPor: State.user.uid,
    historico: [entradaHistoricoLead('cadastrado', { canal: $('lm-canal').value })],
  };
  try {
    const r = await gravar({ modulo: 'leads', colecao: 'leadsImoveis', op: 'criar', dados, titulo: `Lead manual — ${nome}` });
    closeLeadManual();
    if (r.pendente) {
      await confirmar({ titulo: '🕓 Enviado para aprovação', mensagem: msgGravacao(r), confirmar: 'OK' });
      return;
    }
    await loadLeads();
    const repassar = await confirmar({
      titulo: '✅ Lead cadastrado',
      mensagem: `Quer repassar <strong>${escapeHtml(nome)}</strong> a um corretor agora?`,
      confirmar: '👤 Repassar agora',
      cancelar: 'Depois',
    });
    if (repassar) openRepassarLead(r.id);
  } catch (err) {
    console.error('Erro ao cadastrar lead manual:', err);
    showAlert('lead-manual-alert', 'Erro: ' + err.message);
  }
}

// ---------- Cópia do lead para o corretor — SEM contato do cliente ----------
// tenants/{t}/leadsCorretor/{leadId}: só primeiro nome, imóvel, mensagem sem telefone/e-mail/link,
// nota da imobiliária e o atendimento (status, anotação, histórico, devolução). O corretor
// lê/atualiza só esta cópia; o lead original (com telefone e e-mail) é só da equipe.
function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

async function gravarLeadDoCorretor(leadId, lead, uid) {
  const ref = tenantPath().collection('leadsCorretor').doc(leadId);
  if (!uid) { await ref.delete().catch(() => {}); return; } // tirado do corretor
  await ref.set({
    corretorUid: uid,
    primeiroNome: primeiroNome(lead.nome) || 'Cliente',
    imovelId: lead.imovelId || null,
    codigoAnuncio: lead.codigoAnuncio || null,
    tituloImovel: lead.tituloImovel || null,
    finalidade: lead.finalidade || null,
    melhorHorario: lead.melhorHorario || null,
    canal: lead.canal || lead.origem || null,
    mensagem: ocultarContatos(String(lead.mensagem || lead.descricao || '').slice(0, 1000)) || null,
    notaRepasse: lead.notaRepasse || null,
    atribuidoEm: lead.atribuidoEm || firebase.firestore.FieldValue.serverTimestamp(),
    status: lead.status || 'novo',
    notaCorretor: lead.notaCorretor || null,
    historico: Array.isArray(lead.historico) ? lead.historico.slice(-30) : [],
  });
}

// Tela de Leads da equipe: o atendimento do corretor mora na cópia — mescla na lista
// (status, anotação, devolução) e cria a cópia que faltar (leads repassados antes da blindagem).
async function mesclarAtendimentoDosCorretores(leads) {
  if (isCorretor() || !Array.isArray(leads)) return;
  let copias;
  try { copias = new Map((await tenantPath().collection('leadsCorretor').get()).docs.map(d => [d.id, d.data()])); }
  catch (e) { console.warn('Atendimento dos corretores indisponível:', e); return; }
  for (const l of leads) {
    const c = copias.get(l._id);
    if (!c) {
      if (l.corretorUid && !['convertido', 'descartado', 'devolvido'].includes(l.status || 'novo')) {
        gravarLeadDoCorretor(l._id, l, l.corretorUid).catch(e => console.warn('Cópia do lead não criada:', l._id, e));
      }
      continue;
    }
    if (c.corretorUid && c.corretorUid !== l.corretorUid) continue; // cópia velha de outro corretor
    if (c.status === 'devolvido') {
      Object.assign(l, { status: 'devolvido', corretorUid: null, corretorNome: null,
        motivoDevolucao: c.motivoDevolucao || l.motivoDevolucao || null, devolvidoEm: c.devolvidoEm || null });
    } else if (c.status) {
      l.status = c.status;
    }
    if (c.notaCorretor !== undefined) l.notaCorretor = c.notaCorretor;
    if (Array.isArray(c.historico) && c.historico.length > (l.historico || []).length) l.historico = c.historico;
  }
}

// ---------- "Meus leads" (corretor) ----------

let _meusLeads = [];

async function loadMeusLeads() {
  const tbody = $('tbody-meus-leads');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="empty">Carregando…</td></tr>';
  try {
    // A consulta precisa bater com a regra (corretorUid == eu); ordena no cliente
    const snap = await tenantPath().collection('leadsCorretor').where('corretorUid', '==', State.user.uid).get();
    _meusLeads = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a, b) => (b.atribuidoEm?.toMillis?.() || 0) - (a.atribuidoEm?.toMillis?.() || 0));
    renderMeusLeads();
    atualizarBadgeMeusLeads(_meusLeads);
    if (typeof loadMeusRegistros === 'function') loadMeusRegistros();
  } catch (err) {
    console.error('Erro ao carregar meus leads:', err);
    tbody.innerHTML = `<tr><td colspan="5" class="empty" style="color:var(--danger);">Erro: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderMeusLeads() {
  const tbody = $('tbody-meus-leads');
  if (_meusLeads.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">Nenhum lead repassado a você ainda. Quando a imobiliária repassar, ele aparece aqui.</td></tr>';
    return;
  }
  tbody.innerHTML = _meusLeads.map(l => {
    const status = l.status || 'novo';
    const dias = diasDesde(l.atribuidoEm);
    // 🔒 Sem telefone do cliente: o corretor fala com a IMOBILIÁRIA, que faz a ponte
    const tel = contatoImobiliaria().telefone;
    const msgImob = `Olá! Sou ${State.userDoc?.nome || 'corretor'}. Sobre o lead ${l.primeiroNome || ''}`
      + (l.tituloImovel || l.codigoAnuncio ? ` (imóvel ${[l.codigoAnuncio, l.tituloImovel].filter(Boolean).join(' — ')})` : '')
      + ': ';
    const linkImob = tel ? `https://wa.me/${telefoneWhatsApp(tel)}?text=${encodeURIComponent(msgImob)}` : '';
    const imovel = (l.codigoAnuncio || l.tituloImovel) ? `🏠 ${escapeHtml([l.codigoAnuncio, l.tituloImovel].filter(Boolean).join(' — '))}<br>` : '';
    const quer = { venda: 'Compra/venda', locacao: 'Locação', ambos: 'Compra ou locação' }[l.finalidade] || '';
    return `
      <tr>
        <td style="font-size:12px;">${dias !== null ? `há ${dias} dia(s)` : '—'}${l.canal ? `<br><span class="muted">${escapeHtml(LEAD_CANAL_LABEL[l.canal] || l.canal)}</span>` : ''}</td>
        <td><strong>${escapeHtml(l.primeiroNome || 'Cliente')}</strong><br>
          <span class="muted" style="font-size:11px;">🔒 contato com a imobiliária</span>
          <br>${l.clienteIdentificado ? '<span style="font-size:11px;color:#166534;">🪪 identificado pela imobiliária</span>' : '<span style="font-size:11px;color:#92400E;" title="Golpe comum: falso interessado. Espere a imobiliária confirmar.">⚠️ visita só depois que a imobiliária identificar</span>'}
          ${l.melhorHorario && l.melhorHorario !== 'qualquer' && typeof LEAD_HORARIO_LABEL !== 'undefined' ? `<br><span style="font-size:11px;">🕐 ${escapeHtml(LEAD_HORARIO_LABEL[l.melhorHorario] || l.melhorHorario)}</span>` : ''}</td>
        <td style="font-size:12px;">${imovel}${quer ? escapeHtml(quer) + '<br>' : ''}
          ${l.mensagem ? `<span class="muted">💬 ${escapeHtml(l.mensagem.slice(0, 160))}</span><br>` : ''}
          ${l.notaRepasse ? `<span style="color:#1E40AF;">📝 Da imobiliária: ${escapeHtml(l.notaRepasse)}</span><br>` : ''}
          ${l.notaCorretor ? `<span>🗒 Minha anotação: ${escapeHtml(l.notaCorretor)}</span>` : ''}</td>
        <td><span class="papel-chip">${LEAD_STATUS_LABEL[status] || status}</span></td>
        <td><div class="action-btns" style="flex-wrap:wrap; gap:4px;">
          ${linkImob ? `<a class="btn btn-sm" href="${linkImob}" target="_blank" rel="noopener" style="background:#DCFCE7; border-color:#86EFAC; color:#166534;" title="A imobiliária faz a ponte com o cliente e agenda a visita">💬 Falar com a imobiliária</a>` : ''}
          ${status === 'novo' ? `<button class="btn btn-sm" onclick="atualizarMeuLead('${l._id}', 'contatado')" style="background:#FEF3C7; border-color:#FCD34D; color:#92400E;">📞 Em atendimento</button>` : ''}
          ${!['convertido', 'descartado'].includes(status) ? `<button class="btn btn-sm" onclick="atualizarMeuLead('${l._id}', 'convertido')" style="background:#DCFCE7; border-color:#86EFAC; color:#166534;">✅ Converti</button>` : ''}
          ${!['convertido', 'descartado'].includes(status) ? `<button class="btn btn-sm btn-secondary" onclick="atualizarMeuLead('${l._id}', 'descartado')">🗑 Sem interesse</button>` : ''}
          <button class="btn btn-sm btn-secondary" onclick="anotarMeuLead('${l._id}')">🗒 Anotar</button>
          ${!['convertido'].includes(status) ? `<button class="btn btn-sm btn-secondary" onclick="devolverMeuLead('${l._id}')" title="Não vai atender? Devolve pra imobiliária redistribuir">↩ Devolver</button>` : ''}
        </div></td>
      </tr>`;
  }).join('');
}

async function atualizarLeadDoCorretor(leadId, dados, acaoHistorico, extraHistorico = {}) {
  const lead = _meusLeads.find(l => l._id === leadId);
  const historico = Array.isArray(lead?.historico) ? lead.historico.slice(-30) : [];
  historico.push(entradaHistoricoLead(acaoHistorico, extraHistorico));
  await tenantPath().collection('leadsCorretor').doc(leadId).update({ ...dados, historico });
  logAuditoria(acaoHistorico, 'lead', leadId, extraHistorico);
}

async function atualizarMeuLead(leadId, status) {
  try {
    await atualizarLeadDoCorretor(leadId, {
      status,
      statusAtualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      statusAtualizadoPor: State.user.uid,
    }, 'status_' + status);
    loadMeusLeads();
  } catch (err) {
    await confirmar({ titulo: 'Erro', mensagem: escapeHtml(err.message), confirmar: 'OK' });
  }
}

async function anotarMeuLead(leadId) {
  const lead = _meusLeads.find(l => l._id === leadId);
  const texto = prompt('Anotação sobre este atendimento (fica visível pra imobiliária):', lead?.notaCorretor || '');
  if (texto === null) return;
  try {
    await atualizarLeadDoCorretor(leadId, { notaCorretor: texto.trim().slice(0, 1000) || null }, 'anotacao');
    loadMeusLeads();
  } catch (err) {
    await confirmar({ titulo: 'Erro', mensagem: escapeHtml(err.message), confirmar: 'OK' });
  }
}

async function devolverMeuLead(leadId) {
  const motivo = prompt('Por que você está devolvendo este lead? (a imobiliária vai ver o motivo)');
  if (motivo === null) return;
  if (!motivo.trim()) { await confirmar({ titulo: 'Motivo obrigatório', mensagem: 'Escreva o motivo da devolução.', confirmar: 'OK' }); return; }
  try {
    const lead = _meusLeads.find(l => l._id === leadId);
    const historico = Array.isArray(lead?.historico) ? lead.historico.slice(-30) : [];
    historico.push(entradaHistoricoLead('devolvido', { motivo: motivo.trim().slice(0, 500) }));
    await tenantPath().collection('leadsCorretor').doc(leadId).update({
      status: 'devolvido',
      corretorUid: null,
      motivoDevolucao: motivo.trim().slice(0, 500),
      devolvidoEm: firebase.firestore.FieldValue.serverTimestamp(),
      devolvidoPor: State.user.uid,
      historico,
    });
    logAuditoria('devolver', 'lead', leadId, { motivo: motivo.trim().slice(0, 200) });
    loadMeusLeads();
  } catch (err) {
    await confirmar({ titulo: 'Erro', mensagem: escapeHtml(err.message), confirmar: 'OK' });
  }
}

// Aviso dentro do sistema: contador vermelho em "Meus leads" (novos ainda sem contato)
async function atualizarBadgeMeusLeads(lista) {
  const link = document.querySelector('.nav-link[data-section="meusleads"]');
  if (!link || !isCorretor()) return;
  try {
    if (!lista) {
      const snap = await tenantPath().collection('leadsCorretor').where('corretorUid', '==', State.user.uid).get();
      lista = snap.docs.map(d => d.data());
    }
    const novos = lista.filter(l => (l.status || 'novo') === 'novo').length;
    let badge = link.querySelector('.nav-badge-pendentes');
    if (!novos) { if (badge) badge.remove(); return; }
    if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge-pendentes'; link.appendChild(badge); }
    badge.textContent = novos;
    badge.title = `${novos} lead(s) novo(s) aguardando seu contato`;
  } catch (_) {}
}

window.openRepassarLead = openRepassarLead;
window.mesclarAtendimentoDosCorretores = mesclarAtendimentoDosCorretores;
window.gravarLeadDoCorretor = gravarLeadDoCorretor;
window.validarTextosDoCorretor = validarTextosDoCorretor;
window.temContato = temContato;
window.closeRepassarLead = closeRepassarLead;
window.confirmarRepassarLead = confirmarRepassarLead;
window.openLeadManual = openLeadManual;
window.closeLeadManual = closeLeadManual;
window.onTipoLeadManual = onTipoLeadManual;
window.salvarLeadManual = salvarLeadManual;
window.loadMeusLeads = loadMeusLeads;
window.atualizarMeuLead = atualizarMeuLead;
window.anotarMeuLead = anotarMeuLead;
window.devolverMeuLead = devolverMeuLead;

// =============================================================
// Corretor completa o próprio cadastro (28/10/2026): telefone, CPF/CNPJ e endereço são
// obrigatórios. Quem entrou antes da regra é cobrado no login, até preencher.
// (firestore.rules já deixa o corretor editar o próprio cartão, menos status/tipo/comissão)
// =============================================================
async function verificarCadastroCorretor() {
  let c = {};
  try { const s = await tenantPath().collection('corretores').doc(State.user.uid).get(); if (!s.exists) return; c = s.data(); } catch (_) { return; }
  if (!faltaNoCadastroCorretor(c).length) return;
  let m = $('modal-meu-cadastro');
  if (!m) {
    m = document.createElement('div');
    m.className = 'modal-overlay'; m.id = 'modal-meu-cadastro';
    m.innerHTML = `<div class="modal">
      <div class="modal-header"><h3>📋 Complete seu cadastro</h3></div>
      <div class="modal-body">
        <p class="muted" style="font-size:13px;">A imobiliária precisa do seu telefone, CPF/CNPJ e endereço — eles vão no contrato de parceria. Leva 1 minuto.</p>
        <div id="meucad-alert" class="alert alert-error" style="display:none;"></div>
        <div class="form-row">
          <div class="form-group"><label class="required">Telefone / WhatsApp</label><input type="tel" id="meucad-telefone"></div>
          <div class="form-group"><label class="required">CPF / CNPJ</label><input type="text" id="meucad-documento" inputmode="numeric" maxlength="18" oninput="mascaraCpfCnpj(this)"></div>
        </div>
        <div data-endereco="meucad-end"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" id="btn-meucad" onclick="salvarMeuCadastroCorretor()">💾 Salvar</button></div>
    </div>`;
    document.body.appendChild(m);
    montarCamposEndereco(m);
  }
  $('meucad-telefone').value = c.telefone ? maskTelefone(c.telefone) : '';
  $('meucad-documento').value = c.documento ? fmtCpfCnpj(c.documento) : '';
  preencherEndereco('meucad-end', c.endereco);
  m.style.display = 'flex';
}

async function salvarMeuCadastroCorretor() {
  const telefone = $('meucad-telefone').value.replace(/\D/g, '');
  const documento = fmtCpfCnpj($('meucad-documento').value);
  const endereco = lerEndereco('meucad-end');
  const faltam = faltaNoCadastroCorretor({ telefone, documento, endereco });
  if (faltam.length) { showAlert('meucad-alert', 'Preencha: ' + faltam.join('; ') + '.'); return; }
  const btn = $('btn-meucad');
  btn.disabled = true; btn.textContent = '⏳ Salvando…';
  try {
    await tenantPath().collection('corretores').doc(State.user.uid).update({
      telefone, documento, endereco, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    });
    $('modal-meu-cadastro').style.display = 'none';
  } catch (err) {
    showAlert('meucad-alert', 'Erro: ' + err.message);
  } finally { btn.disabled = false; btn.textContent = '💾 Salvar'; }
}
window.salvarMeuCadastroCorretor = salvarMeuCadastroCorretor;
