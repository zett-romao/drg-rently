// =============================================================
// DRG-Rently — ASSINATURAS AVULSAS
// =============================================================
// Carregado DEPOIS do app.js (usa $, tenantPath, storage, confirmar, escapeHtml,
// plataformaAssinatura, _signConsultar, _cfgSite, pdfDoArquivoBase64...).
//
// Pedido do dono (17/10/2026): subir um contrato JÁ ELABORADO no computador (muitas vezes
// feito pelo advogado do cliente) e mandar assinar de dentro do Rently — avulso ou ligado
// a um imóvel do sistema. Usa a MESMA plataforma escolhida em Configurações → Assinatura
// eletrônica (DRG-Sign integrada, ou externa + anexar o PDF assinado).
//
// Modelo: tenants/{tid}/assinaturas/{id}
//   { titulo, imovelId, imovelApelido, arquivoOriginalPath, arquivoOriginalNome,
//     assinatura: { provedor 'drg-sign'|'externo', plataforma, plataformaNome, openId, token,
//                   status pending|signed|refused|expired, signers, arquivoAssinadoPath },
//     criadoEm, criadoPor, criadoPorNome }
// Arquivos no Storage: tenants/{tid}/assinaturas/{id}/original.pdf e assinado-*.pdf
// (coleção fora de colecaoProtegida: a regra genérica da equipe já cobre — sem regra nova).

let _avulsa = null;           // { plataforma, signers: [{name,email,role}] }
let _avulsasCache = [];

const _AV_STATUS = {
  pending: ['⏳ Aguardando', 'pendente_analise'],
  signed: ['✅ Assinado', 'aprovado'],
  refused: ['❌ Recusado', 'reprovado'],
  expired: ['⏰ Expirado', 'suspenso'],
};

// ---------- Lista ----------
async function loadAssinaturasAvulsas() {
  const tbody = $('tbody-assinaturas');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="empty">Carregando…</td></tr>';
  try {
    const snap = await tenantPath().collection('assinaturas').orderBy('criadoEm', 'desc').limit(300).get();
    _avulsasCache = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    renderAssinaturasAvulsas();
  } catch (err) {
    console.error('Erro ao carregar assinaturas:', err);
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Erro ao carregar: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderAssinaturasAvulsas() {
  const tbody = $('tbody-assinaturas');
  const busca = ($('assinaturas-busca')?.value || '').trim().toLowerCase();
  const lista = _avulsasCache.filter(a => !busca
    || `${a.titulo} ${a.imovelApelido || ''} ${(a.assinatura?.signers || []).map(s => s.name).join(' ')}`.toLowerCase().includes(busca));
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">${_avulsasCache.length ? 'Nada encontrado.' : 'Nenhum documento enviado ainda. Clique em “📤 Enviar PDF para assinatura”.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map(a => {
    const z = a.assinatura || {};
    const [rotulo, classe] = _AV_STATUS[z.status] || [z.status || '—', ''];
    const assinaram = (z.signers || []).filter(s => s.status === 'signed').length;
    const id = a._id;
    const botoes = [];
    if (z.provedor === 'drg-sign' && z.openId) botoes.push(`<button type="button" class="btn btn-secondary btn-sm" id="btn-av-ver-${id}" onclick="verNoSign('avulsa', '${id}', '${escapeHtml(String(z.openId))}', 'btn-av-ver-${id}')">🔎 Ver no DRG-Sign</button>`);
    if (a.arquivoOriginalPath) botoes.push(`<button type="button" class="btn btn-secondary btn-sm" id="btn-av-orig-${id}" onclick="abrirArquivoAvulsa('${id}', 'original')">📄 Original</button>`);
    if (z.status === 'signed') {
      botoes.push(`<button type="button" class="btn btn-primary btn-sm" id="btn-av-ass-${id}" onclick="abrirArquivoAvulsa('${id}', 'assinado')">✅ PDF assinado</button>`);
    } else if (z.provedor === 'drg-sign') {
      botoes.push(`<button type="button" class="btn btn-primary btn-sm" id="btn-av-status-${id}" onclick="atualizarStatusAvulsa('${id}')">🔄 Atualizar status</button>`);
    } else {
      botoes.push(`<button type="button" class="btn btn-primary btn-sm" id="btn-av-anexar-${id}" onclick="document.getElementById('arq-av-${id}').click()">📎 Anexar assinado</button>
        <input type="file" id="arq-av-${id}" accept="application/pdf,.pdf" style="display:none" onchange="anexarAssinadoAvulsa('${id}', this)">`);
    }
    botoes.push(`<button type="button" class="btn btn-danger btn-sm" id="btn-av-excluir-${id}" onclick="excluirAvulsa('${id}')" title="Excluir este registro">🗑 Excluir</button>`);
    return `<tr>
      <td data-label="Documento"><strong>${escapeHtml(a.titulo || '—')}</strong>
        <div class="muted" style="font-size:11px;">${escapeHtml(a.arquivoOriginalNome || (z.provedor === 'drg-sign' ? 'no DRG-Sign' : ''))} · ${fmtDate(a.criadoEm)}${a.criadoPorNome ? ' · ' + escapeHtml(a.criadoPorNome) : ''}</div>
        <div class="muted" style="font-size:11px;">${(z.signers || []).map(s => `${s.status === 'signed' ? '✅' : s.status === 'refused' ? '❌' : '⏳'} ${escapeHtml(s.name)}`).join(' · ')}</div></td>
      <td data-label="Imóvel">${a.imovelId ? escapeHtml(a.imovelApelido || 'Imóvel') : '<span class="muted">Avulso</span>'}</td>
      <td data-label="Plataforma">${escapeHtml(_nomeDoEnvio(z))}${z.provedor === 'drg-sign' && z.token ? `<div class="muted" style="font-size:11px;">${escapeHtml(z.token)}</div>` : ''}</td>
      <td data-label="Status"><span class="badge-status ${classe}">${rotulo}</span><div class="muted" style="font-size:11px;">${assinaram}/${(z.signers || []).length} assinaram</div></td>
      <td data-label="Ações"><div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:6px; min-width:140px;">${botoes.join('')}</div></td>
    </tr>`;
  }).join('');
}

// ---------- Nova: modal ----------
async function abrirNovaAssinaturaAvulsa(imovelIdInicial) {
  clearAlert('av-alert');
  const plat = plataformaAssinatura(await _cfgSite().catch(() => ({})));
  if (!plat.pronta) { showAlert('assinaturas-alert', plat.falta); return; }
  _avulsa = { plataforma: plat, signers: [] };
  $('av-titulo').value = '';
  $('av-arquivo').value = '';
  $('av-bloco-doc').style.display = plat.integrada ? 'none' : '';
  $('av-bloco-signers').style.display = plat.integrada ? 'none' : '';
  $('av-plataforma').innerHTML = plat.integrada
    ? 'Vai pelo <strong>DRG-Sign</strong>. Escolha o imóvel, se houver, e a <strong>tela de envio do Sign</strong> abre a seguir — com os PDFs já salvos aqui para aproveitar, a agenda de contatos, o posicionamento das assinaturas e a autenticação (selfie, documento, código).'
    : plat.id === 'papel'
      ? 'Plataforma escolhida: <strong>no papel</strong>. O documento fica registrado aqui; depois de assinado, digitalize e use <strong>📎 Anexar assinado</strong>.'
      : `Plataforma escolhida: <strong>${escapeHtml(plat.nome)}</strong>. O Rently registra o envio${plat.url ? ' e abre o site dela' : ''}; envie o PDF por lá e, quando voltar assinado, use <strong>📎 Anexar assinado</strong>.`;
  $('btn-av-enviar').textContent = plat.integrada ? '✍️ Abrir a tela do DRG-Sign' : (plat.url ? `↗ Registrar e abrir ${plat.curto || plat.nome}` : '✓ Registrar envio');
  $('btn-av-enviar').disabled = false;

  // Imóveis do sistema (opcional)
  const sel = $('av-imovel');
  sel.innerHTML = '<option value="">— Avulso (sem imóvel) —</option>';
  try {
    const snap = await tenantPath().collection('imoveis').get();
    const ims = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.apelido || '').localeCompare(String(b.apelido || ''), 'pt-BR'));
    sel.insertAdjacentHTML('beforeend', ims.map(i =>
      `<option value="${escapeHtml(i.id)}" data-locador="${escapeHtml(i.locadorId || '')}">${escapeHtml(i.apelido || 'Imóvel')}${i.codigoAnuncio ? ' · ' + escapeHtml(i.codigoAnuncio) : ''}</option>`).join(''));
  } catch (err) { console.warn('Sem lista de imóveis:', err); }
  sel.value = imovelIdInicial || '';
  renderSignersAvulsa();
  $('modal-assinatura-avulsa').style.display = 'flex';
  if (imovelIdInicial) await trocarImovelAvulsa();
}

function fecharAssinaturaAvulsa() {
  $('modal-assinatura-avulsa').style.display = 'none';
  _avulsa = null;
}

// Escolheu um imóvel → sugere o proprietário como signatário (se tiver e-mail)
async function trocarImovelAvulsa() {
  if (!_avulsa) return;
  const opt = $('av-imovel').selectedOptions[0];
  const locadorId = opt?.dataset.locador;
  if (!locadorId) return;
  try {
    const l = await tenantPath().collection('locadores').doc(locadorId).get();
    const d = l.exists ? l.data() : null;
    if (d?.nome && !_avulsa.signers.some(s => s.email && s.email === d.email)) {
      _avulsa.signers = _avulsa.signers.filter(s => s.name.trim() || s.email.trim());   // tira a linha em branco
      _avulsa.signers.unshift({ name: d.nome, email: d.email || '', role: 'Proprietário' });
      renderSignersAvulsa();
    }
  } catch (_) { /* sem permissão para ler o proprietário: segue sem sugerir */ }
}

function renderSignersAvulsa() {
  if (!_avulsa) return;
  if (!_avulsa.signers.length) _avulsa.signers.push({ name: '', email: '', role: '' });
  $('av-signers').innerHTML = _avulsa.signers.map((s, i) => `
    <div class="form-row" style="margin-bottom:6px; align-items:flex-end;">
      <div class="form-group"><label>Nome${s.role ? ` (${escapeHtml(s.role)})` : ''}</label>
        <input type="text" value="${escapeHtml(s.name)}" oninput="_avulsa.signers[${i}].name = this.value" placeholder="Nome completo"></div>
      <div class="form-group"><label>E-mail</label>
        <input type="email" value="${escapeHtml(s.email)}" oninput="_avulsa.signers[${i}].email = this.value" placeholder="email@exemplo.com"></div>
      <div class="form-group" style="max-width:44px;">
        <button type="button" class="btn btn-danger btn-sm" onclick="_avulsa.signers.splice(${i}, 1); renderSignersAvulsa();" aria-label="Remover signatário">×</button></div>
    </div>`).join('');
}
function addSignerAvulsa() { if (_avulsa) { _avulsa.signers.push({ name: '', email: '', role: '' }); renderSignersAvulsa(); } }

// ---------- Nova: enviar ----------
async function enviarAssinaturaAvulsa() {
  if (!_avulsa) return;
  clearAlert('av-alert');
  const plat = _avulsa.plataforma;
  if (plat.integrada) return _abrirAvulsaNoSign();
  const titulo = $('av-titulo').value.trim();
  const file = $('av-arquivo').files[0];
  const signers = _avulsa.signers.map(s => ({ ...s, name: s.name.trim(), email: s.email.trim() })).filter(s => s.name);
  if (!titulo) { showAlert('av-alert', 'Dê um nome ao documento (ex.: Contrato de locação — Apto 31).'); return; }
  if (!file) { showAlert('av-alert', 'Escolha o PDF do documento.'); return; }
  if (!signers.length) { showAlert('av-alert', 'Informe pelo menos 1 signatário.'); return; }
  if (plat.integrada && signers.some(s => !s.email)) { showAlert('av-alert', 'No DRG-Sign cada signatário precisa de e-mail (é por onde chega o link).'); return; }

  const btn = $('btn-av-enviar');
  const rotulo = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Lendo o PDF... aguarde';
  const aba = (!plat.integrada && plat.url) ? window.open('about:blank', '_blank') : null;   // abre no clique (senão vira pop-up bloqueado)
  const ref = tenantPath().collection('assinaturas').doc();
  const pathOriginal = `tenants/${State.tenant.id}/assinaturas/${ref.id}/original.pdf`;
  let subiu = false;
  try {
    const pdfBase64 = await pdfDoArquivoBase64(file);
    btn.textContent = '⏳ Guardando o PDF... aguarde';
    await storage.ref().child(pathOriginal).put(file, { contentType: 'application/pdf' });
    subiu = true;

    let assinatura;
    {   // plataformas externas (o DRG-Sign vai pela tela do Sign — _abrirAvulsaNoSign)
      assinatura = {
        provedor: 'externo', plataforma: plat.id, plataformaNome: plat.nome, name: titulo, status: 'pending',
        signers: signers.map(s => ({ name: s.name, email: s.email, status: 'pending' })),
      };
    }
    const opt = $('av-imovel').selectedOptions[0];
    await ref.set({
      titulo,
      imovelId: $('av-imovel').value || null,
      imovelApelido: $('av-imovel').value ? (opt?.textContent || '').split(' · ')[0] : null,
      arquivoOriginalPath: pathOriginal,
      arquivoOriginalNome: file.name,
      assinatura: {
        ...Object.fromEntries(Object.entries(assinatura).filter(([, v]) => v !== undefined)),
        enviadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        enviadoPor: State.user.uid,
      },
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      criadoPor: State.user.uid,
      criadoPorNome: State.userDoc?.nome || State.user?.email || '',
    });
    if (aba) aba.location.href = plat.url;
    logAuditoria('assinatura_avulsa_envio', 'assinatura', ref.id, { plataforma: plat.id, signers: signers.length });

    fecharAssinaturaAvulsa();
    btn.disabled = false; btn.textContent = rotulo;
    await loadAssinaturasAvulsas();
    showAlert('assinaturas-alert', plat.integrada
      ? `✓ “${titulo}” enviado ao DRG-Sign! ${signers.length} signatário(s) vão receber o link por e-mail.`
      : `✓ “${titulo}” registrado${aba ? ` e ${plat.nome} aberta em outra aba` : ''}. Quando voltar assinado, use 📎 Anexar assinado.`, 'success');
  } catch (err) {
    if (aba) aba.close();
    if (subiu) storage.ref().child(pathOriginal).delete().catch(() => {});   // não deixa arquivo órfão
    console.error('Erro ao enviar documento avulso:', err);
    showAlert('av-alert', 'Erro: ' + err.message);
    btn.disabled = false; btn.textContent = rotulo;
  }
}

// DRG-Sign: abre a tela do Sign já com o proprietário (se houver imóvel) e os PDFs salvos aqui
async function _abrirAvulsaNoSign() {
  const btn = $('btn-av-enviar');
  const rotulo = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Abrindo o DRG-Sign... aguarde ~1 min';
  try {
    const imovelId = $('av-imovel').value || null;
    const opt = $('av-imovel').selectedOptions[0];
    const locadorId = opt?.dataset.locador || null;
    const sugestoes = imovelId ? [
      ...await coletarSugestoesAssinatura([{ pasta: `imoveis/${imovelId}`, origem: 'Imóvel' }, { pasta: `locadores/${locadorId}`, origem: 'Proprietário' }]),
      ...await sugestoesDeAvulsasDoImovel(imovelId),
    ] : [];
    const signers = _avulsa.signers.map(s => ({ ...s, name: s.name.trim(), email: s.email.trim() })).filter(s => s.name);
    const id = tenantPath().collection('assinaturas').doc().id;
    await abrirTelaSign({
      tipo: 'avulsa', id, titulo: '', signers, sugestoes,
      extra: { imovelId, imovelApelido: imovelId ? (opt?.textContent || '').split(' · ')[0] : null },
    });
    fecharAssinaturaAvulsa();
  } catch (err) {
    showAlert('av-alert', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = rotulo;
  }
}

// ---------- Ações da lista ----------
async function _travar(id, texto, fn) {
  const b = $(id);
  const original = b ? b.textContent : '';
  if (b) { b.disabled = true; b.textContent = texto; }
  try { return await fn(); } finally { if (b && document.body.contains(b)) { b.disabled = false; b.textContent = original; } }
}

async function atualizarStatusAvulsa(id) {
  try {
    await _travar(`btn-av-status-${id}`, '⏳ Consultando... aguarde', async () => {
      const ref = tenantPath().collection('assinaturas').doc(id);
      const a = (await ref.get()).data();
      const data = await _signConsultar(await _cfgSite(), a.assinatura);
      await ref.update({ 'assinatura.status': data.status, 'assinatura.signers': data.signers || [] });
      await loadAssinaturasAvulsas();
      showAlert('assinaturas-alert', `✓ “${a.titulo}”: ${(_AV_STATUS[data.status] || [data.status])[0]}`, 'success');
    });
  } catch (err) { showAlert('assinaturas-alert', 'Erro: ' + err.message); }
}

async function anexarAssinadoAvulsa(id, input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  try {
    await _travar(`btn-av-anexar-${id}`, '⏳ Enviando PDF... aguarde', async () => {
      await pdfDoArquivoBase64(file);   // confere que é PDF e o tamanho
      const ref = tenantPath().collection('assinaturas').doc(id);
      const a = (await ref.get()).data();
      const path = `tenants/${State.tenant.id}/assinaturas/${id}/assinado-${Date.now()}.pdf`;
      await storage.ref().child(path).put(file, { contentType: 'application/pdf' });
      await ref.update({
        'assinatura.status': 'signed',
        'assinatura.signers': (a.assinatura?.signers || []).map(s => ({ ...s, status: 'signed' })),
        'assinatura.arquivoAssinadoPath': path,
        'assinatura.assinadoEm': firebase.firestore.FieldValue.serverTimestamp(),
        'assinatura.anexadoPor': State.user.uid,
      });
      logAuditoria('assinatura_avulsa_assinada', 'assinatura', id, {});
      await loadAssinaturasAvulsas();
      showAlert('assinaturas-alert', `✓ PDF assinado de “${a.titulo}” anexado.`, 'success');
    });
  } catch (err) { showAlert('assinaturas-alert', 'Erro: ' + err.message); }
}

// Abre o original ou o assinado. A aba abre ANTES do await (senão o navegador bloqueia).
async function abrirArquivoAvulsa(id, qual) {
  const aba = window.open('', '_blank');
  if (aba) aba.document.write('<p style="font-family:sans-serif;padding:24px;">⏳ Buscando o PDF… aguarde.</p>');
  try {
    await _travar(`btn-av-${qual === 'original' ? 'orig' : 'ass'}-${id}`, '⏳ Abrindo... aguarde', async () => {
      const a = (await tenantPath().collection('assinaturas').doc(id).get()).data();
      const z = a.assinatura || {};
      let url;
      if (qual === 'original') {
        url = await storage.ref().child(a.arquivoOriginalPath).getDownloadURL();
      } else if (z.arquivoAssinadoPath) {
        url = await storage.ref().child(z.arquivoAssinadoPath).getDownloadURL();
      } else if (z.provedor === 'drg-sign') {
        const cfg = await _cfgSite();
        const res = await fetch(`${_signBase(cfg)}/api/v1/documentos/${encodeURIComponent(z.openId)}/final`, { headers: _signHeaders(cfg) });
        if (!res.ok) throw await _signErro(res);
        url = URL.createObjectURL(await res.blob());
      } else {
        throw new Error('PDF assinado não encontrado.');
      }
      if (aba) aba.location.href = url; else window.open(url, '_blank');
    });
  } catch (err) {
    if (aba) aba.close();
    showAlert('assinaturas-alert', 'Erro: ' + err.message);
  }
}

async function excluirAvulsa(id) {
  const a = _avulsasCache.find(x => x._id === id) || {};
  const sign = a.assinatura?.provedor === 'drg-sign';
  const ok = await confirmar({
    titulo: 'Excluir este documento?',
    mensagem: `“${escapeHtml(a.titulo || '')}” e os PDFs guardados aqui (original e assinado) serão apagados do Rently.`,
    detalhe: sign ? 'O envelope continua no DRG-Sign — se ainda estiver aberto, cancele lá também.' : 'Se já foi enviado por outra plataforma, cancele lá também.',
    confirmar: '🗑 Excluir', perigo: true,
  });
  if (!ok) return;
  try {
    await _travar(`btn-av-excluir-${id}`, '⏳', async () => {
      const ref = tenantPath().collection('assinaturas').doc(id);
      const d = (await ref.get()).data() || {};
      await ref.delete();
      for (const p of [d.arquivoOriginalPath, d.assinatura?.arquivoAssinadoPath].filter(Boolean)) {
        storage.ref().child(p).delete().catch(() => {});
      }
      logAuditoria('assinatura_avulsa_excluida', 'assinatura', id, { titulo: d.titulo });
      await loadAssinaturasAvulsas();
      showAlert('assinaturas-alert', '✓ Documento excluído.', 'success');
    });
  } catch (err) { showAlert('assinaturas-alert', 'Erro: ' + err.message); }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('modal-assinatura-avulsa')?.style.display === 'flex') fecharAssinaturaAvulsa();
});

window.loadAssinaturasAvulsas = loadAssinaturasAvulsas;
window.renderAssinaturasAvulsas = renderAssinaturasAvulsas;
window.abrirNovaAssinaturaAvulsa = abrirNovaAssinaturaAvulsa;
window.fecharAssinaturaAvulsa = fecharAssinaturaAvulsa;
window.trocarImovelAvulsa = trocarImovelAvulsa;
window.renderSignersAvulsa = renderSignersAvulsa;
window.addSignerAvulsa = addSignerAvulsa;
window.enviarAssinaturaAvulsa = enviarAssinaturaAvulsa;
window.atualizarStatusAvulsa = atualizarStatusAvulsa;
window.anexarAssinadoAvulsa = anexarAssinadoAvulsa;
window.abrirArquivoAvulsa = abrirArquivoAvulsa;
window.excluirAvulsa = excluirAvulsa;

// =============================================================
// TELA DO DRG-SIGN EMBUTIDA (envio e detalhe)
// =============================================================
// Dono (17/10/2026): "A tela precisa ser idêntica… com posicionamento de assinaturas,
// aproveitamento de documentos e assinaturas já salvos… hash e cadeia de custódia".
// Em vez de copiar o Sign, o Rently ABRE A TELA DO PRÓPRIO SIGN num iframe: a API cria
// uma sessão curta (POST /api/v1/sessoes, com a chave da conta) e o Sign mostra o
// "Novo documento" completo — já com o PDF, os signatários e os documentos salvos aqui
// para aproveitar — e, depois, o detalhe com hash, carimbo e cadeia de custódia.
// O Sign avisa por postMessage ('criado' / 'status' / 'excluido'); ao fechar, o Rently
// ainda confere pela API (external_id) — nada se perde se o aviso não chegar.

let _telaSign = null;   // { tipo, id, modo, externalId, origemSign, registrado, extra }

const _externalIdRently = (tipo, id) => `rently:${State.tenant.id}:${tipo}:${id}`;

// ---------- Documentos já salvos no Rently (para aproveitar no envelope) ----------
async function coletarSugestoesAssinatura(pastas) {
  const sugestoes = [];
  const vistos = new Set();
  async function varrer(ref, origem, nivel) {
    let lista;
    try { lista = await ref.listAll(); } catch (_) { return; }   // pasta pode não existir
    for (const item of lista.items) {
      if (!/\.pdf$/i.test(item.name) || vistos.has(item.fullPath)) continue;
      vistos.add(item.fullPath);
      try { sugestoes.push({ nome: item.name, url: await item.getDownloadURL(), origem }); } catch (_) { /* sem acesso: pula */ }
    }
    if (nivel < 1) for (const sub of lista.prefixes) await varrer(sub, origem, nivel + 1);
  }
  for (const { pasta, origem } of pastas) {
    if (pasta && !/\/(undefined|null|)$/.test(pasta)) await varrer(storageTenantRef().child(pasta), origem, 0);
  }
  return sugestoes.slice(0, 40);
}

// PDFs já enviados por "Assinaturas" para o mesmo imóvel (original e assinado)
async function sugestoesDeAvulsasDoImovel(imovelId) {
  if (!imovelId) return [];
  try {
    const snap = await tenantPath().collection('assinaturas').where('imovelId', '==', imovelId).limit(15).get();
    const out = [];
    for (const d of snap.docs) {
      const a = d.data();
      for (const [path, rot] of [[a.arquivoOriginalPath, 'original'], [a.assinatura?.arquivoAssinadoPath, 'assinado']]) {
        if (!path) continue;
        try { out.push({ nome: `${a.titulo} (${rot}).pdf`, url: await storage.ref().child(path).getDownloadURL(), origem: 'Assinaturas do imóvel' }); } catch (_) { /* */ }
      }
    }
    return out;
  } catch (_) { return []; }
}

// ---------- Abrir / fechar a tela ----------
async function abrirTelaSign({ tipo, id, modo = 'novo', documentoId = null, titulo = '', signers = [], arquivos = [], sugestoes = [], extra = {} }) {
  const cfg = await _cfgSite();
  if (!cfg.signApiKey) throw new Error('Falta a chave do DRG-Sign em Configurações → Assinatura eletrônica.');
  const externalId = _externalIdRently(tipo, id);
  const res = await fetch(`${_signBase(cfg)}/api/v1/sessoes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ..._signHeaders(cfg) },
    body: JSON.stringify({
      modo, documento_id: documentoId, titulo, external_id: externalId, origem: location.origin, sugestoes,
      arquivos: arquivos.map(a => ({ nome: a.nome, pdf_base64: a.base64, sugerido: !!a.sugerido })),
      signatarios: signers.map(s => ({ nome: s.name, email: s.email || '', telefone: s.telefone || '', qualificacao: s.role || '' })),
    }),
  });
  if (!res.ok) throw await _signErro(res);
  const { url } = await res.json();
  _telaSign = { tipo, id, modo, externalId, origemSign: new URL(url).origin, registrado: modo === 'ver', extra };
  $('sign-embed-titulo').textContent = modo === 'ver' ? '🔎 DRG-Sign — documento, hash e cadeia de custódia' : '✍️ DRG-Sign — enviar para assinatura';
  $('sign-embed-frame').src = url;
  $('modal-sign-embed').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

async function fecharTelaSign() {
  const ctx = _telaSign;
  $('modal-sign-embed').style.display = 'none';
  $('sign-embed-frame').src = 'about:blank';
  document.body.style.overflow = '';
  _telaSign = null;
  if (!ctx) return;
  // Fechou antes do aviso chegar? Confere pela API se o envelope foi criado.
  if (!ctx.registrado) {
    try {
      const cfg = await _cfgSite();
      const r = await fetch(`${_signBase(cfg)}/api/v1/documentos?external_id=${encodeURIComponent(ctx.externalId)}`, { headers: _signHeaders(cfg) });
      if (r.ok) {
        const lista = await r.json();
        if (lista.length) await _registrarEnvioSign(ctx, { documento_id: lista[0].documento_id, codigo: lista[0].codigo, titulo: lista[0].titulo, status: lista[0].status, signatarios: lista[0].signatarios });
      }
    } catch (e) { console.warn('Conferência do envio no Sign falhou:', e); }
  }
  await _recarregarOndeEsta(ctx);
}

async function _recarregarOndeEsta(ctx) {
  if (ctx.tipo === 'avulsa') { if (typeof loadAssinaturasAvulsas === 'function') await loadAssinaturasAvulsas(); }
  else if ($(_ASS[ctx.tipo].idEl).value === ctx.id) await _carregarStatusAssinatura(ctx.tipo, ctx.id);
}

// ---------- Avisos do Sign (postMessage) ----------
window.addEventListener('message', async (ev) => {
  const ctx = _telaSign;
  const m = ev.data;
  if (!ctx || ev.origin !== ctx.origemSign || !m || m.origem !== 'drg-sign') return;
  try {
    if (m.tipo === 'criado') {
      $('sign-embed-titulo').textContent = '🔎 DRG-Sign — documento, hash e cadeia de custódia';   // a tela do Sign já foi para o detalhe
      await _registrarEnvioSign(ctx, m); ctx.registrado = true; await _recarregarOndeEsta(ctx);
    }
    else if (m.tipo === 'status') await _atualizarRegistroSign(ctx, m);
    else if (m.tipo === 'excluido') { await _removerRegistroSign(ctx, m); await _recarregarOndeEsta(ctx); }
  } catch (e) { console.error('Aviso do Sign não gravado:', e); }
});

function _registroDoSign(m) {
  const conv = _signParaRently({ status: m.status, signatarios: m.signatarios || [] });
  return { provedor: 'drg-sign', plataforma: 'drg-sign', openId: String(m.documento_id), token: m.codigo || '', name: m.titulo || '', ...conv };
}

async function _registrarEnvioSign(ctx, m) {
  const reg = _registroDoSign(m);
  const quando = { enviadoEm: firebase.firestore.FieldValue.serverTimestamp(), enviadoPor: State.user.uid, externalId: ctx.externalId };
  if (ctx.tipo === 'avulsa') {
    await tenantPath().collection('assinaturas').doc(ctx.id).set({
      titulo: m.titulo || 'Documento', imovelId: ctx.extra.imovelId || null, imovelApelido: ctx.extra.imovelApelido || null,
      arquivoOriginalPath: null, arquivoOriginalNome: null,
      assinatura: { ...reg, ...quando },
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(), criadoPor: State.user.uid,
      criadoPorNome: State.userDoc?.nome || State.user?.email || '',
    }, { merge: true });
    logAuditoria('assinatura_avulsa_envio', 'assinatura', ctx.id, { plataforma: 'drg-sign' });
    showAlert('assinaturas-alert', `✓ “${m.titulo || 'Documento'}” enviado pelo DRG-Sign.`, 'success');
  } else {
    const T = _ASS[ctx.tipo];
    await tenantPath().collection(T.col).doc(ctx.id).update({ zapsign: { ...reg, ...quando } });
    logAuditoria('zapsign_envio', ctx.tipo, ctx.id, { plataforma: 'drg-sign', signers: reg.signers.length });
    showAlert(T.alerta, `✓ ${T.rotulo} enviado pelo DRG-Sign! ${reg.signers.length} signatário(s).`, 'success');
  }
}

async function _atualizarRegistroSign(ctx, m) {
  const reg = _registroDoSign(m);
  if (ctx.tipo === 'avulsa') {
    const ref = tenantPath().collection('assinaturas').doc(ctx.id);
    const d = (await ref.get()).data();
    if (!d || String(d.assinatura?.openId) !== String(m.documento_id)) return;
    await ref.update({ 'assinatura.status': reg.status, 'assinatura.signers': reg.signers });
    return;
  }
  const T = _ASS[ctx.tipo];
  const ref = tenantPath().collection(T.col).doc(ctx.id);
  const d = (await ref.get()).data();
  if (!d || String(d.zapsign?.openId) !== String(m.documento_id)) return;
  if (d.zapsign.status === reg.status && JSON.stringify(d.zapsign.signers || []) === JSON.stringify(reg.signers)) return;
  await ref.update({ 'zapsign.status': reg.status, 'zapsign.signers': reg.signers });
  if (reg.status === 'signed') await _aplicarAssinado(ctx.tipo, ctx.id, d.status);
}

async function _removerRegistroSign(ctx, m) {
  if (ctx.tipo === 'avulsa') {
    const ref = tenantPath().collection('assinaturas').doc(ctx.id);
    const d = (await ref.get()).data();
    if (d && String(d.assinatura?.openId) === String(m.documento_id)) await ref.delete();
    return;
  }
  const T = _ASS[ctx.tipo];
  const ref = tenantPath().collection(T.col).doc(ctx.id);
  const d = (await ref.get()).data();
  if (d && String(d.zapsign?.openId) === String(m.documento_id)) await ref.update({ zapsign: firebase.firestore.FieldValue.delete() });
}

// ---------- Contrato / negociação → tela do Sign ----------
// Chamado pelo _abrirEnvio (app.js) quando a plataforma é o DRG-Sign.
async function abrirEnvioPeloSign(tipo, id, d, imovel, signers) {
  const T = _ASS[tipo];
  // O contrato gerado pelo Rently vai OFERECIDO (não anexado): na tela do Sign a pessoa escolhe
  // entre ele, os PDFs já salvos aqui ou um arquivo novo (ex.: o feito pelo advogado).
  const arquivos = [];
  try {
    _zapsignContexto = { contratoId: id, tipo };
    const b64 = await gerarPdfContratoBase64();
    if (b64) arquivos.push({ nome: `${tipo === 'contrato' ? 'Contrato de Locação' : 'Contrato de Compra e Venda'} - ${imovel?.apelido || 'Imóvel'} (gerado pelo Rently).pdf`, base64: b64, sugerido: true });
  } catch (e) { console.warn('Contrato do Rently não gerado (segue sem ele):', e); }
  const pastas = tipo === 'contrato'
    ? [{ pasta: `contratos/${id}`, origem: 'Contrato' }, { pasta: `imoveis/${d.imovelId}`, origem: 'Imóvel' },
       { pasta: `locadores/${d.locadorId}`, origem: 'Locador' }, { pasta: `locatarios/${d.locatarioId}`, origem: 'Locatário' },
       { pasta: `garantias/${d.garantiaId}`, origem: 'Garantia' }]
    : [{ pasta: `negociacoes/${id}`, origem: 'Negociação' }, { pasta: `imoveis/${d.imovelId}`, origem: 'Imóvel' },
       { pasta: `locadores/${d.vendedorId}`, origem: 'Vendedor' }, { pasta: `compradores/${d.compradorId}`, origem: 'Comprador' }];
  const sugestoes = [...await coletarSugestoesAssinatura(pastas), ...await sugestoesDeAvulsasDoImovel(d.imovelId)];
  await abrirTelaSign({
    tipo, id, titulo: `${tipo === 'contrato' ? 'Contrato de Locação' : 'Contrato de Compra e Venda'} - ${imovel?.apelido || 'Imóvel'}`,
    signers, arquivos, sugestoes,
  });
  clearAlert(T.alerta);
}

// "🔎 Ver no DRG-Sign": o detalhe completo do documento (hash, carimbo, cadeia de custódia)
async function verNoSign(tipo, id, documentoId, btnId) {
  const b = btnId ? $(btnId) : null;
  const txt = b ? b.textContent : '';
  if (b) { if (b.disabled) return; b.disabled = true; b.textContent = '⏳ Abrindo... aguarde'; }
  try {
    await abrirTelaSign({ tipo, id, modo: 'ver', documentoId: Number(documentoId) });
  } catch (err) {
    const alvo = tipo === 'avulsa' ? 'assinaturas-alert' : _ASS[tipo].alerta;
    showAlert(alvo, 'Erro: ' + err.message);
  } finally { if (b) { b.disabled = false; b.textContent = txt; } }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('modal-sign-embed')?.style.display === 'flex') fecharTelaSign();
});

window.abrirTelaSign = abrirTelaSign;
window.fecharTelaSign = fecharTelaSign;
window.verNoSign = verNoSign;
window.abrirEnvioPeloSign = abrirEnvioPeloSign;
