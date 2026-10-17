// =============================================================
// DRG-Rently — AUDITORIA AUTOMÁTICA (tudo o que é feito no sistema)
// =============================================================
// Dono (17/10/2026): "essa auditoria precisa registrar tudo que é feito dentro do sistema,
// inclusões, exclusões, baixa de arquivos e tudo mais… filtrar por eventos, por período
// de data e por usuário cadastrado".
//
// Carregado ANTES do app.js. Em vez de depender de cada tela lembrar de chamar
// logAuditoria(), interceptamos a camada do Firebase:
//   • Firestore: doc.set/update/delete, collection.add, batch e transação → create/update/delete
//   • Storage:   put/putString (arquivo_envio), delete (arquivo_exclusao),
//                getDownloadURL de documento — não foto (arquivo_acesso)
//   • Navegador: link com "download" (CSV, Excel, PDF gerado) → download; window.print → impressao
// Cada registro: quem, quando, coleção/ID, rótulo do registro e campos alterados
// (valores sensíveis mascarados). Os eventos "de negócio" (e-mail enviado, contrato
// gerado…) continuam vindo do logAuditoria() das telas.
// O registro em si NUNCA bloqueia nem atrasa a ação do usuário (fire-and-forget).

(function () {
  if (!window.firebase || !firebase.firestore) return;
  // State e db são const globais do app.js / firebase-config.js (alcançáveis pelo nome, não por window)
  const estado = () => (typeof State !== 'undefined' ? State : null);
  const banco = () => (typeof db !== 'undefined' ? db : null);

  // Coleções que NÃO entram: a própria auditoria, contadores e cópias derivadas
  // (a vitrine/rede/comissões são espelhos automáticos de imóvel/negociação, já auditados).
  const IGNORAR = new Set(['auditoria', 'contadores', 'estatisticas', 'vitrine', 'imoveisRede', 'comissoes']);
  // Preferências de tela do próprio usuário (ordem do menu etc.) não são "ação no sistema"
  const PREF_USUARIO = new Set(['sidebarOrder', 'dashboardOrder', 'atualizadoEm', 'ultimoAcesso', 'ultimoLogin']);
  const SENSIVEL = /senha|password|token|secret|apikey|api_key|chave|key$|pix|cpf|cnpj|^rg$|documento|agencia|conta$|banco|cartao/i;

  const ENTIDADE = {
    locadores: 'locador', locatarios: 'locatario', compradores: 'comprador', garantias: 'garantia', imoveis: 'imovel',
    contratos: 'contrato', negociacoes: 'negociacao', balancetes: 'balancete', users: 'usuario', config: 'config',
    leadsImoveis: 'lead', assinaturas: 'assinatura', corretores: 'corretor', perfis: 'perfil', fotos: 'foto',
    pagamentos: 'pagamento', solicitacoesPagamento: 'pagamento', caixaPool: 'caixa', caixaPoolFechamento: 'caixa',
    alteracoesPendentes: 'aprovacao', templatesContrato: 'modelo_contrato', elabPerguntas: 'modelo_contrato',
    consultas: 'consulta_credito', tenants: 'empresa',
  };
  const entidadeDe = (colecao) => ENTIDADE[colecao] || colecao;

  // "tenants/T/imoveis/X/fotos/Y" → { colecao: 'imoveis', id: 'X', sub: 'fotos/Y' } (só do tenant atual)
  function analisarCaminho(path) {
    const p = String(path || '').split('/');
    const tid = estado()?.tenant?.id;
    if (p[0] === 'users' && p[1]) return { colecao: 'users', id: p[1], sub: p.slice(2).join('/') || null };
    if (p[0] !== 'tenants' || !tid || p[1] !== tid) return null;
    if (p.length === 2) return { colecao: 'tenants', id: tid, sub: null };   // doc da empresa
    return { colecao: p[2], id: p[3] || null, sub: p.slice(4).join('/') || null };
  }

  function valorCurto(v) {
    if (v == null) return v;
    if (typeof v === 'object') {
      if (typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch (_) { return '(data)'; } }
      if (v._methodName || v.constructor?.name?.includes('FieldValue')) return '(automático)';
      const s = JSON.stringify(v);
      return s.length > 120 ? s.slice(0, 117) + '…' : JSON.parse(s);
    }
    const s = String(v);
    return s.length > 120 ? s.slice(0, 117) + '…' : v;
  }
  // Campos gravados → { campos: [...], valores: {campo: valor curto (mascarado)} }
  function resumirDados(dados) {
    if (!dados || typeof dados !== 'object') return {};
    const campos = Object.keys(dados);
    const valores = {};
    for (const k of campos.slice(0, 40)) valores[k] = SENSIVEL.test(k.split('.').pop()) ? '•••' : valorCurto(dados[k]);
    return { campos, valores };
  }
  const rotuloDe = (d) => (d && (d.nome || d.apelido || d.titulo || d.numero || d.codigo || d.codigoAnuncio || d.email)) || null;

  // ---- grava (sem o interceptador, para não auditar a auditoria) ----
  let gravando = 0;
  function registrar(acao, info) {
    try {
      const S = estado();
      if (!S || !S.tenant || !S.user || !banco()) return;
      gravando++;
      const ref = banco().collection('tenants').doc(S.tenant.id).collection('auditoria').doc();
      _set.call(ref, {
        acao, entidade: info.entidade || null, entidadeId: info.id || null, colecao: info.colecao || null,
        subcaminho: info.sub || null, rotulo: info.rotulo || null, detalhe: info.detalhe || null, origem: 'auto',
        userId: S.user.uid, userNome: S.userDoc?.nome || '', userEmail: S.user.email || '', userRole: S.userDoc?.role || '',
        tela: S.currentSection || null,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      }).catch((e) => console.warn('Auditoria não gravada:', e.message)).finally(() => { gravando--; });
    } catch (e) { console.warn('Auditoria:', e); }
  }
  window.registrarAuditoriaAuto = registrar;

  function auditarEscrita(acao, ref, dados, opcoes) {
    const c = analisarCaminho(ref?.path);
    if (!c || IGNORAR.has(c.colecao)) return;
    const res = resumirDados(dados);
    if (c.colecao === 'users' && res.campos && res.campos.every((k) => PREF_USUARIO.has(k))) return;
    const merge = opcoes && (opcoes.merge || opcoes.mergeFields);
    registrar(acao === 'set' ? (merge ? 'update' : 'create') : acao, {
      entidade: entidadeDe(c.colecao), colecao: c.colecao, id: c.id, sub: c.sub,
      rotulo: rotuloDe(dados), detalhe: res.campos ? res : null,
    });
  }

  // ---- Firestore: referência, coleção, lote e transação ----
  const DR = firebase.firestore.DocumentReference.prototype;
  const CR = firebase.firestore.CollectionReference.prototype;
  const _set = DR.set, _update = DR.update, _delete = DR.delete, _add = CR.add;

  DR.set = function (dados, opcoes) {
    const p = _set.apply(this, arguments);
    p.then(() => auditarEscrita('set', this, dados, opcoes)).catch(() => {});
    return p;
  };
  DR.update = function (dados) {
    const p = _update.apply(this, arguments);
    const obj = (dados && typeof dados === 'object') ? dados : { [String(dados)]: arguments[1] };
    p.then(() => auditarEscrita('update', this, obj)).catch(() => {});
    return p;
  };
  DR.delete = function () {
    const c = analisarCaminho(this.path);
    // lê o rótulo ANTES de apagar ("excluiu Imóvel 'Casa Centro'") — sem atrasar a exclusão além de 1 leitura
    const antes = (c && !IGNORAR.has(c.colecao)) ? this.get().then((s) => (s.exists ? rotuloDe(s.data()) : null)).catch(() => null) : Promise.resolve(null);
    return antes.then((rotulo) => {
      const p = _delete.call(this);
      p.then(() => {
        if (c && !IGNORAR.has(c.colecao)) registrar('delete', { entidade: entidadeDe(c.colecao), colecao: c.colecao, id: c.id, sub: c.sub, rotulo });
      }).catch(() => {});
      return p;
    });
  };
  CR.add = function (dados) {
    const p = _add.apply(this, arguments);
    p.then((ref) => auditarEscrita('create', ref, dados)).catch(() => {});
    return p;
  };

  // Lote: anota as operações e registra quando o commit dá certo
  const WB = firebase.firestore.WriteBatch && firebase.firestore.WriteBatch.prototype;
  if (WB) {
    const _bset = WB.set, _bupd = WB.update, _bdel = WB.delete, _bcommit = WB.commit;
    const anota = (b, op) => { (b.__audit || (b.__audit = [])).push(op); };
    WB.set = function (ref, dados, opcoes) { anota(this, ['set', ref, dados, opcoes]); return _bset.apply(this, arguments); };
    WB.update = function (ref, dados) { anota(this, ['update', ref, (dados && typeof dados === 'object') ? dados : {}]); return _bupd.apply(this, arguments); };
    WB.delete = function (ref) { anota(this, ['delete', ref]); return _bdel.apply(this, arguments); };
    WB.commit = function () {
      const ops = this.__audit || [];
      const p = _bcommit.apply(this, arguments);
      p.then(() => ops.forEach(([acao, ref, dados, opcoes]) => {
        if (acao === 'delete') {
          const c = analisarCaminho(ref.path);
          if (c && !IGNORAR.has(c.colecao)) registrar('delete', { entidade: entidadeDe(c.colecao), colecao: c.colecao, id: c.id, sub: c.sub });
        } else auditarEscrita(acao, ref, dados, opcoes);
      })).catch(() => {});
      return p;
    };
  }
  // Transação: só registra o que valeu (a função pode rodar mais de uma vez)
  const FS = firebase.firestore.Firestore && firebase.firestore.Firestore.prototype;
  const TX = firebase.firestore.Transaction && firebase.firestore.Transaction.prototype;
  if (FS && TX) {
    const _tset = TX.set, _tupd = TX.update, _tdel = TX.delete, _run = FS.runTransaction;
    TX.set = function (ref, dados, opcoes) { (this.__audit || (this.__audit = [])).push(['set', ref, dados, opcoes]); return _tset.apply(this, arguments); };
    TX.update = function (ref, dados) { (this.__audit || (this.__audit = [])).push(['update', ref, (dados && typeof dados === 'object') ? dados : {}]); return _tupd.apply(this, arguments); };
    TX.delete = function (ref) { (this.__audit || (this.__audit = [])).push(['delete', ref]); return _tdel.apply(this, arguments); };
    FS.runTransaction = function (fn, ...resto) {
      let ultima = null;
      const p = _run.call(this, (tx) => { tx.__audit = []; ultima = tx; return fn(tx); }, ...resto);
      p.then(() => (ultima?.__audit || []).forEach(([acao, ref, dados, opcoes]) => {
        if (acao === 'delete') {
          const c = analisarCaminho(ref.path);
          if (c && !IGNORAR.has(c.colecao)) registrar('delete', { entidade: entidadeDe(c.colecao), colecao: c.colecao, id: c.id, sub: c.sub });
        } else auditarEscrita(acao, ref, dados, opcoes);
      })).catch(() => {});
      return p;
    };
  }

  // ---- Storage: envio, exclusão e acesso a documento ----
  const EH_FOTO = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|svg)$/i;
  function infoArquivo(fullPath) {
    const c = analisarCaminho(fullPath) || {};
    const nome = String(fullPath || '').split('/').pop();
    return { entidade: entidadeDe(c.colecao || 'arquivo'), colecao: c.colecao || null, id: c.id || null, sub: c.sub || null, rotulo: nome, detalhe: { arquivo: fullPath } };
  }
  function ligarStorage() {
    let SR;
    try { const inst = window.storage || (firebase.storage && firebase.storage()); if (!inst) return false; SR = Object.getPrototypeOf(inst.ref()); } catch (_) { return false; }
    if (SR.__auditado) return true;
    SR.__auditado = true;
    const _put = SR.put, _putString = SR.putString, _sdel = SR.delete, _url = SR.getDownloadURL;
    const aoEnviar = (ref, tarefa) => { Promise.resolve(tarefa).then(() => registrar('arquivo_envio', infoArquivo(ref.fullPath))).catch(() => {}); return tarefa; };
    SR.put = function () { return aoEnviar(this, _put.apply(this, arguments)); };
    if (_putString) SR.putString = function () { return aoEnviar(this, _putString.apply(this, arguments)); };
    SR.delete = function () {
      const p = _sdel.apply(this, arguments);
      p.then(() => registrar('arquivo_exclusao', infoArquivo(this.fullPath))).catch(() => {});
      return p;
    };
    const vistos = new Map();   // o mesmo documento aberto várias vezes em 1 min conta uma vez
    SR.getDownloadURL = function () {
      const p = _url.apply(this, arguments);
      const caminho = this.fullPath;
      if (!EH_FOTO.test(caminho)) {
        p.then(() => {
          const agora = Date.now();
          if (agora - (vistos.get(caminho) || 0) < 60000) return;
          vistos.set(caminho, agora);
          registrar('arquivo_acesso', infoArquivo(caminho));
        }).catch(() => {});
      }
      return p;
    };
    return true;
  }
  if (!ligarStorage()) window.addEventListener('load', ligarStorage);

  // ---- Navegador: downloads gerados (CSV, Excel, PDF) e impressão ----
  const _click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      if (this.hasAttribute('download')) {
        const nome = this.getAttribute('download') || (this.href || '').split('/').pop();
        registrar('download', { entidade: 'arquivo', rotulo: nome, detalhe: { arquivo: nome } });
      }
    } catch (_) { /* */ }
    return _click.apply(this, arguments);
  };
  document.addEventListener('click', (e) => {   // link de download clicado pela pessoa
    const a = e.target.closest && e.target.closest('a[download]');
    if (a && e.isTrusted) registrar('download', { entidade: 'arquivo', rotulo: a.getAttribute('download') || a.href.split('/').pop(), detalhe: { arquivo: a.getAttribute('download') || '' } });
  }, true);
  const _print = window.print;
  window.print = function () {
    registrar('impressao', { entidade: 'tela', rotulo: document.title || estado()?.currentSection || null });
    return _print.apply(window, arguments);
  };
})();

// =============================================================
// TELA DA AUDITORIA — filtros por período, usuário, evento, entidade e busca
// =============================================================
// A consulta usa SÓ o período (timestamp), que não precisa de índice composto;
// usuário/evento/entidade/busca filtram na tela. "Carregar mais" pagina pelo período.

const AUDIT_ACAO_LABEL = {
  create: '✚ Inclusão', update: '✎ Alteração', delete: '✗ Exclusão',
  login: '🔑 Entrada (login)', logout: '🚪 Saída (logout)',
  arquivo_envio: '📤 Arquivo enviado', arquivo_acesso: '👁 Arquivo aberto', arquivo_exclusao: '🗑 Arquivo excluído',
  download: '📥 Download / exportação', impressao: '🖨 Impressão',
  send_email: '✉️ E-mail enviado', gerar_contrato: '📄 Contrato gerado', toggle_ativo: '🔄 Ativou/desativou',
  status: '🔄 Status alterado', situacao: '🔄 Situação alterada', repassar: '➡️ Lead repassado', devolver: '↩ Lead devolvido',
  zapsign_envio: '✍️ Enviado para assinatura', zapsign_signed: '✅ Assinado', zapsign_desfeito: '↩ Envio de assinatura desfeito',
  assinatura_avulsa_envio: '✍️ Documento enviado para assinatura', assinatura_avulsa_assinada: '✅ Documento assinado',
  assinatura_avulsa_excluida: '🗑 Documento de assinatura excluído',
  ver_ficha: '👁 Ficha da rede aberta', cliente_registrado: '🙋 Cliente registrado pelo corretor',
  cliente_registro_analise: '🙋 Registro de cliente analisado', identificar_cliente: '🪪 Cliente identificado',
  contrato_parceria: '📝 Contrato de parceria', creci_conferido: '🔎 CRECI conferido',
  arquivar: '📦 Arquivado', restaurar: '♻️ Restaurado', excluir_definitivo: '✗ Excluído definitivamente',
};
const AUDIT_ENTIDADE_LABEL = {
  locador: 'Proprietário', locatario: 'Locatário', comprador: 'Comprador', garantia: 'Garantia', imovel: 'Imóvel',
  contrato: 'Contrato', negociacao: 'Negociação', balancete: 'Balancete', usuario: 'Usuário', config: 'Configurações',
  sessao: 'Sessão', lead: 'Lead', assinatura: 'Assinatura', corretor: 'Corretor', perfil: 'Perfil de acesso',
  foto: 'Foto', pagamento: 'Pagamento', caixa: 'Livro caixa', aprovacao: 'Aprovação', modelo_contrato: 'Modelo de contrato',
  template_contrato: 'Modelo de contrato', consulta_credito: 'Consulta de crédito', empresa: 'Empresa', arquivo: 'Arquivo',
  tela: 'Tela', cobranca: 'Cobrança', distrato: 'Distrato', importacao_contrato: 'Importação de contrato',
  tenant: 'Imobiliária', usuario_drg: 'Usuário DRG', drg_perfil: 'Perfil DRG',
};
const _humanizar = (s) => String(s || '—').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const rotuloAcao = (a) => AUDIT_ACAO_LABEL[a] || _humanizar(a);
const rotuloEntidade = (e) => AUDIT_ENTIDADE_LABEL[e] || _humanizar(e);

let _audit = { docs: [], ultimo: null, acabou: false, carregando: false };
const AUDIT_PAGINA = 300;

function _auditDataInput(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function _auditPeriodoPadrao() {
  if ($('audit-de') && !$('audit-de').value) {
    const hoje = new Date();
    $('audit-ate').value = _auditDataInput(hoje);
    $('audit-de').value = _auditDataInput(new Date(hoje.getTime() - 6 * 86400000));   // últimos 7 dias
  }
}

async function loadAuditoria(mais = false) {
  const tbody = $('tbody-auditoria');
  if (!tbody || !State.tenant) return;
  if (_audit.carregando) return;
  _auditPeriodoPadrao();
  const de = $('audit-de').value, ate = $('audit-ate').value;
  if (de && ate && de > ate) { showAlert('audit-alert', 'A data inicial é depois da final.'); return; }
  clearAlert('audit-alert');
  const btn = $('btn-audit-buscar'), btnMais = $('btn-audit-mais');
  _audit.carregando = true;
  if (!mais) {
    _audit = { docs: [], ultimo: null, acabou: false, carregando: true };
    tbody.innerHTML = '<tr><td colspan="5" class="empty">⏳ Carregando… aguarde</td></tr>';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Buscando…'; }
  } else if (btnMais) { btnMais.disabled = true; btnMais.textContent = '⏳ Carregando… aguarde'; }
  try {
    let q = tenantPath().collection('auditoria');
    if (de) q = q.where('timestamp', '>=', new Date(de + 'T00:00:00'));
    if (ate) q = q.where('timestamp', '<=', new Date(ate + 'T23:59:59.999'));
    q = q.orderBy('timestamp', 'desc');
    if (mais && _audit.ultimo) q = q.startAfter(_audit.ultimo);
    const snap = await q.limit(AUDIT_PAGINA).get();
    _audit.docs.push(...snap.docs.map((d) => ({ _id: d.id, ...d.data() })));
    _audit.ultimo = snap.docs[snap.docs.length - 1] || _audit.ultimo;
    _audit.acabou = snap.docs.length < AUDIT_PAGINA;
    _auditMontarFiltros();
    renderAuditoria();
  } catch (err) {
    console.error('Erro ao carregar auditoria:', err);
    tbody.innerHTML = `<tr><td colspan="5" class="empty" style="color:var(--danger);">Erro: ${escapeHtml(err.message)}</td></tr>`;
  } finally {
    _audit.carregando = false;
    if (btn) { btn.disabled = false; btn.textContent = '🔎 Buscar'; }
    if (btnMais) { btnMais.disabled = false; btnMais.textContent = '⬇ Carregar mais'; }
  }
}

// Usuário/evento/entidade: as opções vêm dos registros carregados (+ equipe cadastrada)
async function _auditMontarFiltros() {
  const manter = (id, opcoes, rotulo) => {
    const sel = $(id); if (!sel) return;
    const atual = sel.value;
    sel.innerHTML = `<option value="">${rotulo}</option>` + opcoes.map(([v, t]) => `<option value="${escapeHtml(v)}">${escapeHtml(t)}</option>`).join('');
    if ([...sel.options].some((o) => o.value === atual)) sel.value = atual;
  };
  const usuarios = new Map();
  if (!_audit.equipe) {
    _audit.equipe = [];
    try {
      const s = await db.collection('users').where('tenantId', '==', State.tenant.id).get();
      _audit.equipe = s.docs.map((d) => [d.id, d.data().nome || d.data().email || d.id]);
    } catch (_) { /* sem permissão de listar: fica só com quem aparece nos registros */ }
  }
  for (const [id, nome] of _audit.equipe) usuarios.set(id, nome);
  for (const a of _audit.docs) if (a.userId && !usuarios.has(a.userId)) usuarios.set(a.userId, a.userNome || a.userEmail || a.userId);
  manter('audit-usuario', [...usuarios].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), 'Todos os usuários');
  const acoes = new Set([...Object.keys(AUDIT_ACAO_LABEL).slice(0, 10), ..._audit.docs.map((a) => a.acao).filter(Boolean)]);
  manter('audit-evento', [...acoes].map((a) => [a, rotuloAcao(a)]).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), 'Todos os eventos');
  const ents = new Set(_audit.docs.map((a) => a.entidade).filter(Boolean));
  manter('audit-entidade', [...ents].map((e) => [e, rotuloEntidade(e)]).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), 'Tudo');
}

function _auditFiltrados() {
  const u = $('audit-usuario')?.value, ev = $('audit-evento')?.value, en = $('audit-entidade')?.value;
  const busca = ($('audit-busca')?.value || '').trim().toLowerCase();
  // Esconde o registro "da tela" (create/update/delete manual) quando o automático já registrou o mesmo
  const autoChaves = new Set(_audit.docs.filter((a) => a.origem === 'auto').map((a) => `${a.acao}|${a.entidadeId}`));
  return _audit.docs.filter((a) => {
    if (a.origem !== 'auto' && ['create', 'update', 'delete'].includes(a.acao) && autoChaves.has(`${a.acao}|${a.entidadeId}`)) return false;
    if (u && a.userId !== u) return false;
    if (ev && a.acao !== ev) return false;
    if (en && a.entidade !== en) return false;
    if (busca) {
      const txt = `${a.userNome} ${a.userEmail} ${rotuloAcao(a.acao)} ${rotuloEntidade(a.entidade)} ${a.rotulo || ''} ${a.entidadeId || ''} ${JSON.stringify(a.detalhe || '')}`.toLowerCase();
      if (!txt.includes(busca)) return false;
    }
    return true;
  });
}

function _auditData(a) {
  const dt = a.timestamp?.toDate ? a.timestamp.toDate() : null;
  return dt ? `${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR')}` : '—';
}
// Detalhe legível: campos alterados com o valor novo (sensíveis já vêm mascarados)
function _auditDetalhe(a) {
  const d = a.detalhe;
  if (!d) return '<span class="muted">—</span>';
  if (typeof d === 'string') return escapeHtml(d);
  if (d.campos && d.valores) {
    const linhas = d.campos.filter((k) => !/^(atualizadoEm|criadoEm|updatedAt|createdAt)$/.test(k)).map((k) => {
      const v = d.valores[k];
      const txt = v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      return `<div><strong>${escapeHtml(k)}</strong>${txt !== '' ? ': ' + escapeHtml(txt.slice(0, 120)) : ''}</div>`;
    });
    if (!linhas.length) return '<span class="muted">—</span>';
    const resumo = d.campos.filter((k) => !/^(atualizadoEm|criadoEm)$/.test(k)).slice(0, 4).join(', ') + (d.campos.length > 4 ? '…' : '');
    return `<details><summary>${escapeHtml(resumo)}</summary><div style="margin-top:6px;">${linhas.join('')}</div></details>`;
  }
  if (d.arquivo) return escapeHtml(d.arquivo);
  // objeto pequeno (ex.: { email }) → "e-mail: fulano@…"
  const chaves = Object.keys(d);
  if (chaves.length <= 4 && chaves.every((k) => d[k] == null || typeof d[k] !== 'object')) {
    const nome = { email: 'e-mail', signers: 'signatários', plataforma: 'plataforma', titulo: 'título', motivo: 'motivo' };
    return chaves.map((k) => `<div><strong>${escapeHtml(nome[k] || k)}</strong>: ${escapeHtml(String(d[k] ?? '—'))}</div>`).join('');
  }
  const s = JSON.stringify(d);
  return s.length > 90 ? `<details><summary>${escapeHtml(s.slice(0, 80))}…</summary><code style="white-space:pre-wrap; font-size:11px;">${escapeHtml(JSON.stringify(d, null, 1))}</code></details>` : escapeHtml(s);
}

function renderAuditoria() {
  const tbody = $('tbody-auditoria');
  const lista = _auditFiltrados();
  $('audit-contagem').textContent = `${lista.length} registro(s) exibido(s) · ${_audit.docs.length} carregado(s) do período${_audit.acabou ? '' : ' (há mais — use “Carregar mais”)'}`;
  $('btn-audit-mais').style.display = _audit.acabou ? 'none' : '';
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Nenhum registro com esses filtros.${_audit.acabou ? '' : ' Tente “Carregar mais”.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map((a) => `
    <tr>
      <td data-label="Data / hora"><span style="font-family:'Courier New',monospace; font-size:12px;">${_auditData(a)}</span></td>
      <td data-label="Usuário">${escapeHtml(a.userNome || a.userEmail || '—')}${a.userRole ? `<div class="muted" style="font-size:11px;">${escapeHtml(a.userRole)}</div>` : ''}</td>
      <td data-label="Evento">${escapeHtml(rotuloAcao(a.acao))}</td>
      <td data-label="Registro">${escapeHtml(rotuloEntidade(a.entidade))}${a.rotulo ? ` · <strong>${escapeHtml(String(a.rotulo))}</strong>` : ''}
        ${a.entidadeId ? `<div class="muted" style="font-family:'Courier New',monospace; font-size:11px;">${escapeHtml(a.entidadeId)}${a.subcaminho ? ' / ' + escapeHtml(a.subcaminho) : ''}</div>` : ''}</td>
      <td data-label="Detalhes" style="font-size:12px; max-width:380px; word-break:break-word;">${_auditDetalhe(a)}</td>
    </tr>`).join('');
}

function exportarAuditoriaCsv() {
  const lista = _auditFiltrados();
  if (!lista.length) { showAlert('audit-alert', 'Nada para exportar com esses filtros.'); return; }
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const det = (d) => !d ? '' : typeof d === 'string' ? d : (d.campos && d.valores) ? d.campos.map((k) => `${k}=${typeof d.valores[k] === 'object' ? JSON.stringify(d.valores[k]) : (d.valores[k] ?? '')}`).join('; ') : JSON.stringify(d);
  const linhas = [['Data/hora', 'Usuário', 'E-mail', 'Papel', 'Evento', 'Entidade', 'Registro', 'ID', 'Detalhes'].map(q).join(';')];
  for (const a of lista) linhas.push([_auditData(a), a.userNome, a.userEmail, a.userRole, rotuloAcao(a.acao), rotuloEntidade(a.entidade), a.rotulo, a.entidadeId, det(a.detalhe)].map(q).join(';'));
  const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `auditoria_${$('audit-de').value || 'inicio'}_a_${$('audit-ate').value || 'hoje'}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  showAlert('audit-alert', `✓ ${lista.length} registro(s) exportado(s).`, 'success');
}

window.loadAuditoria = loadAuditoria;
window.renderAuditoria = renderAuditoria;
window.exportarAuditoriaCsv = exportarAuditoriaCsv;
