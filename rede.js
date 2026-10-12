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
// ele captou. Os outros corretores leem só a ficha — a trava é no firestore.rules.
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
  { id: 'captador',         label: 'Contato do corretor captador' },
  { id: 'proprietario',     label: 'Proprietário (nome e telefone)', sensivel: true },
  { id: 'documentacao',     label: 'Matrícula e IPTU', sensivel: true },
  { id: 'obsInternas',      label: 'Observações internas', sensivel: true },
];
const REDE_CAMPOS_PADRAO = ['identificacao', 'tipo', 'fotos', 'valores', 'localizacao',
  'metragem', 'comodos', 'descricao', 'condicoes', 'midia', 'captador'];
const REDE_TODOS_CAMPOS = REDE_CAMPOS.map(c => c.id);
const REDE_MAX_FOTOS = 20;

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
  });
  if (tem('midia')) Object.assign(f, { videoUrl: im.videoUrl || null, tourUrl: im.tourUrl || null });
  if (tem('captador')) f.captador = ctx.captador || null;
  if (tem('proprietario')) f.proprietario = ctx.proprietario || null;
  if (tem('documentacao')) Object.assign(f, { matricula: im.matricula || null, iptu: im.iptu || null });
  if (tem('obsInternas')) f.obs = im.obs || null;
  return f;
}

// Dados de contato do captador (cartão de corretor → usuário → imobiliária)
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

  const [fotosSnap, captador, locSnap] = await Promise.all([
    tenantPath().collection('imoveis').doc(imovelId).collection('fotos').orderBy('ordem').limit(REDE_MAX_FOTOS).get().catch(() => null),
    contatoCaptador(im.criadoPor),
    im.locadorId ? tenantPath().collection('locadores').doc(im.locadorId).get().catch(() => null) : null,
  ]);
  const ctx = {
    fotos: fotosSnap ? fotosSnap.docs.map(d => d.data().url).filter(Boolean) : [],
    captador,
    proprietario: locSnap && locSnap.exists
      ? { nome: locSnap.data().nome || null, telefone: locSnap.data().telefone || null }
      : null,
  };

  const vis = (im.redeVisibilidade && im.redeVisibilidade !== 'padrao') ? im.redeVisibilidade : cfg.visibilidadePadrao;
  const meta = {
    captadorUid: im.criadoPor || null,
    captadorNome: captador?.nome || null,
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
    descricaoLonga: im.descricaoLonga || null,
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

async function sincronizarVitrine(imovelId, im, ctx) {
  const ref = tenantPath().collection('vitrine').doc(imovelId);
  if (im.linkPublico === true && !im.rascunho) {
    await ref.set(montarDadosVitrine(im, ctx));
  } else if (!isCorretor()) {
    // corretor não publica nem despublica — só a equipe remove da vitrine
    await ref.delete();
  }
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
  if (isCorretor()) $('imovel-publicacao-section').style.display = 'none';

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
  let corretores = [];
  try { _corretoresAtivosCache = null; corretores = await listarCorretoresAtivos(); } catch (_) {}
  corretores = corretores.filter(c => c.uid !== captadorUid);
  lista.innerHTML = corretores.length
    ? corretores.map(c => `
        <label class="toggle-row" style="cursor:pointer;">
          <input type="checkbox" class="imovel-rede-share-chk" value="${c.uid}" ${marcados.includes(c.uid) ? 'checked' : ''}>
          <span>${escapeHtml(c.nome || c.email || c.uid)} <span class="muted" style="font-size:11px;">${CORRETOR_TIPO_LABEL[c.tipo] || ''}${c.creci ? ' · CRECI ' + escapeHtml(c.creci) : ''}</span></span>
        </label>`).join('')
    : '<p class="muted" style="font-size:12px;">Nenhum outro corretor ativo cadastrado.</p>';
}

function lerRedeDoModalImovel() {
  if (!$('imovel-rede-section')) return {};
  return {
    redeVisibilidade: $('imovel-rede-visibilidade').value || 'padrao',
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
    tbody.innerHTML = lista.map(c => {
      const acoes = [];
      if (c.status === 'pendente') acoes.push(`<button class="btn btn-sm btn-primary" onclick="definirStatusCorretor('${c.uid}','ativo')">✅ Aprovar</button>`);
      if (c.status === 'ativo') acoes.push(`<button class="btn btn-sm btn-danger" onclick="definirStatusCorretor('${c.uid}','suspenso')">Suspender</button>`);
      if (c.status === 'suspenso') acoes.push(`<button class="btn btn-sm btn-primary" onclick="definirStatusCorretor('${c.uid}','ativo')">Reativar</button>`);
      acoes.push(`<button class="btn btn-sm btn-secondary" onclick="openCorretorModal('${c.uid}')">Editar</button>`);
      return `
        <tr>
          <td><strong>${escapeHtml(c.nome || '—')}</strong><br><span class="muted" style="font-size:11px;">${escapeHtml(c.email || '')}</span></td>
          <td>${escapeHtml(c.creci || '—')}</td>
          <td>${c.telefone ? escapeHtml(maskTelefone(c.telefone)) : '—'}</td>
          <td>${CORRETOR_TIPO_LABEL[c.tipo] || '—'}</td>
          <td>${captados[c.uid] || 0}</td>
          <td>${CORRETOR_STATUS_LABEL[c.status] || escapeHtml(c.status || '—')}</td>
          <td><div class="action-btns">${acoes.join(' ')}</div></td>
        </tr>`;
    }).join('');
  } catch (err) {
    console.error('Erro ao listar corretores:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--danger);">Erro: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function openCorretorModal(uid) {
  clearAlert('corretor-alert');
  const editando = !!uid;
  $('corretor-uid').value = uid || '';
  $('modal-corretor-title').textContent = editando ? 'Editar corretor' : 'Novo corretor';
  $('corretor-email').disabled = editando;
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
  $('corretor-tipo').value = c.tipo || 'parceiro';
  $('corretor-senha').value = gerarSenhaAleatoria(10);
  $('corretor-enviar-email').checked = true;
  $('modal-corretor').style.display = 'flex';
}

function closeCorretorModal() {
  $('modal-corretor').style.display = 'none';
}

function gerarSenhaCorretor() {
  $('corretor-senha').value = gerarSenhaAleatoria(10);
}

async function saveCorretor() {
  clearAlert('corretor-alert');
  const uidExistente = $('corretor-uid').value;
  const nome = $('corretor-nome').value.trim();
  const email = $('corretor-email').value.trim().toLowerCase();
  const telefone = $('corretor-telefone').value.replace(/\D/g, '') || null;
  const creci = $('corretor-creci').value.trim() || null;
  const tipo = $('corretor-tipo').value;
  if (!nome) { showAlert('corretor-alert', 'Nome é obrigatório.'); return; }

  const btn = $('btn-save-corretor');
  btn.disabled = true;
  try {
    if (uidExistente) {
      await tenantPath().collection('corretores').doc(uidExistente).update({
        nome, telefone, creci, tipo,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      });
      await db.collection('users').doc(uidExistente).update({ nome });
      logAuditoria('update', 'corretor', uidExistente, { nome, tipo });
      closeCorretorModal();
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
        uid, nome, email, telefone, creci, tipo, status: 'ativo',
        origem: 'admin', criadoEm: agora, criadoPor: State.user.uid,
      });
    } catch (e) {
      // Banco recusou: apaga o login recém-criado pra não sobrar conta órfã
      if (conta.nova) await apagarContaAuth(conta.idToken);
      throw e;
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

async function enviarEmailAcessoCorretor(nome, email, senha) {
  try {
    const cfgSnap = await tenantPath().collection('config').doc('site').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (!cfg.workerUrl) return;
    const td = 'padding:6px 12px;border:1px solid #ccc;';
    const html = `<html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#00897B;">Bem-vindo à rede de corretores</h2>
      <p>Olá <strong>${escapeHtml(nome)}</strong>,</p>
      <p>Você agora faz parte da rede de corretores de <strong>${escapeHtml(State.tenant.nome)}</strong>.
         Cadastre seus imóveis captados e acesse as fichas compartilhadas pela rede.</p>
      <table style="border-collapse:collapse;margin:14px 0;">
        <tr><td style="${td}background:#f0f0f0;"><strong>Link</strong></td><td style="${td}"><a href="https://zett-romao.github.io/drg-rently/">https://zett-romao.github.io/drg-rently/</a></td></tr>
        <tr><td style="${td}background:#f0f0f0;"><strong>E-mail</strong></td><td style="${td}">${escapeHtml(email)}</td></tr>
        <tr><td style="${td}background:#f0f0f0;"><strong>Senha inicial</strong></td><td style="${td}font-family:'Courier New',monospace;"><strong>${escapeHtml(senha)}</strong></td></tr>
      </table>
      <p style="font-size:12px;color:#666;">Troque a senha no primeiro acesso pelo "Esqueci minha senha".</p>
      <p style="margin-top:24px;">— ${escapeHtml(State.tenant.nome)}</p>
    </body></html>`;
    await fetch(cfg.workerUrl, {
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
  } catch (e) { console.warn('Falha ao enviar e-mail ao corretor (conta criada mesmo assim):', e); }
}

async function definirStatusCorretor(uid, status) {
  const textos = {
    ativo:    { titulo: 'Liberar acesso?', msg: 'O corretor poderá entrar, cadastrar imóveis e ver as fichas da rede.', btn: '✅ Liberar' },
    suspenso: { titulo: 'Suspender corretor?', msg: 'O acesso é bloqueado na hora. Os imóveis que ele captou continuam no sistema.', btn: 'Suspender' },
  }[status];
  if (!(await confirmar({ titulo: textos.titulo, mensagem: textos.msg, confirmar: textos.btn, aviso: status === 'suspenso' }))) return;
  try {
    const batch = db.batch();
    batch.update(db.collection('users').doc(uid), { ativo: status === 'ativo', status });
    batch.update(tenantPath().collection('corretores').doc(uid), {
      status, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();
    logAuditoria('status', 'corretor', uid, { status });
    _corretoresAtivosCache = null;
    loadCorretores();
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
    lista = lista.filter(f => [f.apelido, f.endereco?.bairro, f.endereco?.cidade, f.endereco?.logradouro, f.captadorNome, ...(f.tags || [])]
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
    ].join(' ');
    return `
      <div class="rede-card" onclick="abrirFichaRede('${f._id}')">
        <div class="rede-card-capa">${urlSegura(capa) ? `<img src="${urlSegura(capa)}" alt="" loading="lazy">` : '<span>🏠</span>'}</div>
        <div class="rede-card-body">
          <div>${selos}</div>
          <strong>${escapeHtml(f.apelido || (f.tipo ? (IMOVEL_TIPO_LABEL[f.tipo] || f.tipo) : 'Imóvel'))}</strong>
          ${local ? `<div class="muted" style="font-size:12px;">📍 ${escapeHtml(local)}</div>` : ''}
          ${carac ? `<div style="font-size:12px;">${escapeHtml(carac)}</div>` : ''}
          ${valorRedeTxt(f) ? `<div style="font-weight:600; color:var(--primary);">${valorRedeTxt(f)}</div>` : ''}
          ${f.captadorNome ? `<div class="muted" style="font-size:11px;">Captador: ${escapeHtml(f.captadorNome)}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function abrirFichaRede(id) {
  const resumo = _redeCarregada.find(f => f._id === id);
  if (!resumo) return;
  let f = resumo;
  if (resumo._completo) {
    try {
      const snap = await tenantPath().collection('imoveisRede').doc(id).collection('completo').doc('dados').get();
      if (snap.exists) f = { ...resumo, ...snap.data() };
    } catch (e) { console.warn('Ficha completa indisponível, mostrando ficha da rede:', e); }
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
      ${linha('Financiamento / FGTS', [f.aceitaFinanciamento, f.permiteFGTS].some(Boolean) ? `${escapeHtml(f.aceitaFinanciamento || '—')} / ${escapeHtml(f.permiteFGTS || '—')}` : '')}
      ${linha('Matrícula', escapeHtml(f.matricula || ''))}
      ${linha('IPTU', escapeHtml(f.iptu || ''))}
      ${linha('Captador', contato(f.captador))}
      ${linha('Proprietário', contato(f.proprietario))}
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
