// 🔄 Converter tipo de conta (Super Admin, 29/10/2026 — pedido do dono: "a Dayane é parceira D.R. Global
// e se cadastrou como…"). Mesmo login (uid, e-mail e senha não mudam); só muda o papel:
//   A) conta própria (admin/equipe de um tenant) → corretor PARCEIRO de outra imobiliária (padrão: D.R. Global)
//   B) corretor parceiro → conta PRÓPRIA (novo tenant em trial: passa a alugar o CRM)
// Os dados da conta antiga não são movidos: em A a conta antiga pode ser arquivada; em B os imóveis
// que ele captou ficam com a imobiliária (use 🔁 Carteira lá antes, se quiser passá-los a outro corretor).

const TENANT_DRG = 'K52yZ4nqu7Z7DJfVegYo';   // D.R. Global Imóveis
let _conv = null;

function _convModal() {
  let m = $('modal-conversao');
  if (!m) {
    m = document.createElement('div');
    m.className = 'modal-overlay'; m.id = 'modal-conversao';
    m.innerHTML = `<div class="modal" style="max-width:640px;">
      <div class="modal-header"><h3>🔄 Converter tipo de conta</h3>
        <button class="modal-close" onclick="$('modal-conversao').style.display='none'">×</button></div>
      <div class="modal-body">
        <p class="muted" style="font-size:12.5px;">Para quem se cadastrou no tipo errado. O <strong>login não muda</strong> (mesmo e-mail e senha) — só o papel no sistema.</p>
        <div id="conv-alert" class="alert alert-error" style="display:none;"></div>
        <div class="form-row" style="align-items:flex-end;">
          <div class="form-group" style="flex:1;"><label>E-mail da pessoa</label><input type="email" id="conv-email" placeholder="corretor@email.com"
            onkeydown="if(event.key==='Enter'){event.preventDefault();buscarContaConversao();}"></div>
          <div class="form-group" style="flex:0;"><button class="btn btn-secondary" onclick="buscarContaConversao()">🔍 Buscar</button></div>
        </div>
        <div id="conv-resultado"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary" onclick="$('modal-conversao').style.display='none'">Fechar</button>
        <button class="btn btn-primary" id="btn-conv" style="display:none;" onclick="confirmarConversao()">🔄 Converter</button></div>
    </div>`;
    document.body.appendChild(m);
  }
  return m;
}

function openConverterConta() {
  if (!State.isSuperAdmin) return;
  _conv = null;
  const m = _convModal();
  $('conv-email').value = '';
  $('conv-resultado').innerHTML = '';
  $('btn-conv').style.display = 'none';
  clearAlert('conv-alert');
  m.style.display = 'flex';
  setTimeout(() => $('conv-email').focus(), 50);
}

async function buscarContaConversao() {
  clearAlert('conv-alert');
  $('btn-conv').style.display = 'none';
  const email = $('conv-email').value.trim();
  if (!email) return;
  const box = $('conv-resultado');
  box.innerHTML = '<p class="muted">⏳ Buscando…</p>';
  try {
    let snap = await db.collection('users').where('email', '==', email).limit(2).get();
    if (snap.empty && email !== email.toLowerCase()) snap = await db.collection('users').where('email', '==', email.toLowerCase()).limit(2).get();
    if (snap.empty) { box.innerHTML = '<p class="muted">Nenhum usuário com esse e-mail.</p>'; return; }
    const d = snap.docs[0];
    const u = d.data();
    if (['super_admin', 'operador_drg'].includes(u.role) || !u.tenantId) {
      box.innerHTML = '<p>Este é um usuário da <strong>equipe DRG</strong> — não se converte por aqui.</p>'; return;
    }
    const tSnap = await db.collection('tenants').doc(u.tenantId).get();
    const t = tSnap.exists ? { id: tSnap.id, ...tSnap.data() } : null;
    const outros = (await db.collection('users').where('tenantId', '==', u.tenantId).get()).docs.filter(x => x.id !== d.id).length;
    let cartao = null;
    if (u.role === 'corretor') {
      try { const c = await db.collection('tenants').doc(u.tenantId).collection('corretores').doc(d.id).get(); cartao = c.exists ? c.data() : null; } catch (_) {}
    }
    _conv = { uid: d.id, u, t, outros, cartao };
    const papel = { admin: 'Administrador (dono da conta)', operador: 'Equipe interna', corretor: 'Corretor parceiro' }[u.role] || u.role;
    const conta = !t ? '⚠️ conta não existe mais'
      : `${escapeHtml(t.nome || t.id)} · ${t.tipoPessoa === 'PF' ? '👤 Corretor autônomo' : '🏢 Imobiliária'}${t.arquivado ? ' · 🗄 arquivada' : ''}`;
    let html = `<div style="background:#F8FAFC; border:1px solid var(--border,#e2e8f0); border-radius:8px; padding:10px 12px; margin-bottom:12px; font-size:13px; line-height:1.7;">
      <strong>${escapeHtml(u.nome || '—')}</strong> · ${escapeHtml(u.email || email)}<br>
      Hoje: <strong>${escapeHtml(papel)}</strong> em ${conta}${u.ativo === false ? ' · desativado' : ''}${u.status === 'pendente' ? ' · pendente' : ''}
    </div>`;

    if (u.role === 'corretor') {
      // B) parceiro → conta própria
      const doc = String(cartao?.documento || '').replace(/\D/g, '');
      const tipo = doc.length === 14 ? 'PJ' : 'PF';
      html += `<h4 class="form-section-title">Dar conta própria (passa a alugar o CRM)</h4>
        <div class="form-row">
          <div class="form-group"><label>Nome da conta</label><input type="text" id="conv-nome-conta" value="${escapeHtml(cartao?.nome || u.nome || '')}"></div>
          <div class="form-group"><label>Tipo</label><input type="text" disabled value="${tipo === 'PJ' ? '🏢 Imobiliária (CNPJ)' : '👤 Corretor autônomo (CPF)'}"></div>
        </div>
        ${cpfCnpjValido(doc) ? '' : '<p style="color:var(--danger); font-size:12.5px;">⚠️ O cartão do corretor está sem CPF/CNPJ válido — complete em Corretores → Editar antes de converter.</p>'}
        <div style="font-size:12.5px; background:#EFF6FF; color:#1E3A8A; border-left:3px solid #2563EB; padding:8px 10px; line-height:1.6;">
          ℹ️ Nasce uma conta nova em <strong>trial</strong>, com ele como administrador. Ele <strong>sai</strong> de ${escapeHtml(t?.nome || 'imobiliária')}
          (o cartão de parceiro fica suspenso). Os imóveis que ele captou <strong>ficam</strong> com ${escapeHtml(t?.nome || 'a imobiliária')} —
          se quiser passá-los a outro corretor, use <strong>🔁 Carteira</strong> lá <strong>antes</strong>.
        </div>`;
      _conv.direcao = 'proprio';
      _conv.tipo = tipo;
      _conv.docOk = cpfCnpjValido(doc);
    } else {
      // A) conta própria / equipe → parceiro
      const tenants = (await db.collection('tenants').get()).docs.map(x => ({ id: x.id, ...x.data() }))
        .filter(x => !x.arquivado && x.id !== u.tenantId)
        .sort((a, b) => (b.id === TENANT_DRG) - (a.id === TENANT_DRG) || String(a.nome || '').localeCompare(String(b.nome || '')));
      html += `<h4 class="form-section-title">Tornar corretor parceiro</h4>
        <div class="form-group"><label>Parceiro de qual imobiliária</label>
          <select id="conv-destino">${tenants.map(x => `<option value="${x.id}">${escapeHtml(x.nome || x.id)}${x.id === TENANT_DRG ? ' ⭐' : ''}</option>`).join('')}</select></div>
        <div class="form-group"><label class="toggle-row" style="cursor:pointer;"><input type="checkbox" id="conv-arquivar" ${outros ? '' : 'checked'} ${t ? '' : 'disabled'}>
          <span>Arquivar a conta antiga (${escapeHtml(t?.nome || '—')})${outros ? ` — ⚠️ tem mais ${outros} usuário(s), que continuariam sem acesso` : ' — ele era o único usuário'}</span></label></div>
        <div style="font-size:12.5px; background:#EFF6FF; color:#1E3A8A; border-left:3px solid #2563EB; padding:8px 10px; line-height:1.6;">
          ℹ️ Ele entra <strong>já aprovado</strong> como 🤝 parceiro da imobiliária escolhida, com o acesso de corretor (só o que captar, fichas sem contato).
          Os dados da conta antiga <strong>não</strong> são levados; arquivada, ela pode ser restaurada no filtro "Mostrar arquivados".
        </div>`;
      _conv.direcao = 'parceiro';
    }
    box.innerHTML = html;
    $('btn-conv').style.display = (_conv.direcao === 'proprio' && !_conv.docOk) ? 'none' : 'inline-block';
  } catch (err) {
    box.innerHTML = '';
    showAlert('conv-alert', 'Erro: ' + err.message);
  }
}

async function confirmarConversao() {
  const c = _conv;
  if (!c) return;
  const agora = firebase.firestore.FieldValue.serverTimestamp();
  const btn = $('btn-conv');
  try {
    if (c.direcao === 'parceiro') {
      const destino = $('conv-destino').value;
      const destinoNome = $('conv-destino').selectedOptions[0]?.textContent.replace(' ⭐', '') || destino;
      const arquivar = $('conv-arquivar').checked && c.t;
      if (!(await confirmar({ titulo: 'Tornar corretor parceiro?', mensagem: `<strong>${escapeHtml(c.u.nome || c.u.email)}</strong> passa a ser 🤝 parceiro de <strong>${escapeHtml(destinoNome)}</strong>.`,
        detalhe: arquivar ? `A conta "${escapeHtml(c.t.nome || '')}" será arquivada.` : 'A conta antiga continua como está.', confirmar: '🔄 Converter', aviso: true }))) return;
      btn.disabled = true; btn.textContent = '⏳ Convertendo…';
      let cad = {};
      if (c.t) { try { cad = (await db.collection('tenants').doc(c.t.id).collection('config').doc('cadastro').get()).data() || {}; } catch (_) {} }
      const batch = db.batch();
      batch.set(db.collection('tenants').doc(destino).collection('corretores').doc(c.uid), {
        uid: c.uid, nome: c.u.nome || c.t?.nome || '', email: c.u.email || '',
        telefone: c.t?.telefone || null, creci: c.t?.creci || null,
        documento: (cad.cpf || c.t?.cnpj) ? fmtCpfCnpj(cad.cpf || c.t?.cnpj) : null, endereco: cad.endereco || null,
        tipo: 'parceiro', status: 'ativo', origem: 'conversao',
        convertidoDe: c.t ? { tenantId: c.t.id, nome: c.t.nome || null } : null,
        criadoEm: agora, criadoPor: State.user.uid,
      }, { merge: true });
      batch.update(db.collection('users').doc(c.uid), { role: 'corretor', tenantId: destino, ativo: true, status: 'ativo', perfilId: null });
      if (arquivar) batch.update(db.collection('tenants').doc(c.t.id), { arquivado: true, ativo: false, arquivadoEm: agora, arquivadoPor: State.user.uid, motivoArquivo: `convertido em parceiro de ${destinoNome}` });
      await batch.commit();
      logAuditoria('converter_conta', 'usuario', c.uid, { para: 'parceiro', destino, destinoNome, contaAntiga: c.t?.id || null, arquivada: !!arquivar });
      $('conv-resultado').innerHTML = `<p style="color:#047857;">✅ ${escapeHtml(c.u.nome || '')} agora é parceiro de <strong>${escapeHtml(destinoNome)}</strong>. Ele entra com o mesmo e-mail e senha (se estiver logado, precisa sair e entrar de novo).
        Complete o cartão dele em Corretores se faltar algo — o sistema cobra no primeiro acesso.</p>`;
    } else {
      const nomeConta = $('conv-nome-conta').value.trim() || c.cartao?.nome || c.u.nome;
      if (!(await confirmar({ titulo: 'Dar conta própria?', mensagem: `<strong>${escapeHtml(c.u.nome || c.u.email)}</strong> sai de ${escapeHtml(c.t?.nome || 'imobiliária')} e ganha a conta <strong>${escapeHtml(nomeConta)}</strong> (trial).`,
        detalhe: 'Os imóveis que ele captou ficam com a imobiliária. Já transferiu a carteira, se queria?', confirmar: '🔄 Converter', aviso: true }))) return;
      btn.disabled = true; btn.textContent = '⏳ Convertendo…';
      const card = c.cartao || {};
      const doc = String(card.documento || '').replace(/\D/g, '');
      const novo = db.collection('tenants').doc();
      const end = card.endereco || {};
      const batch = db.batch();
      batch.set(novo, {
        nome: nomeConta, tipoPessoa: c.tipo, ...(c.tipo === 'PJ' ? { cnpj: fmtCpfCnpj(doc) } : {}),
        creci: card.creci || null, telefone: card.telefone || null, cidade: end.cidade || null, uf: end.uf || null,
        plano: 'trial', ativo: true, criadoEm: agora, criadoPor: State.user.uid, cadastradoPeloSuperAdmin: true,
        convertidoDeParceiro: { tenantId: c.t?.id || null, uid: c.uid },
      });
      batch.update(db.collection('users').doc(c.uid), { role: 'admin', tenantId: novo.id, ativo: true, status: 'ativo', perfilId: null });
      if (c.t) batch.update(db.collection('tenants').doc(c.t.id).collection('corretores').doc(c.uid), { status: 'suspenso', convertidoEm: new Date().toISOString(), convertidoPara: novo.id });
      await batch.commit();
      await novo.collection('config').doc('cadastro').set({ endereco: card.endereco || null, ...(c.tipo === 'PF' ? { cpf: fmtCpfCnpj(doc) } : {}) });
      logAuditoria('converter_conta', 'usuario', c.uid, { para: 'conta_propria', novoTenant: novo.id, nomeConta, contaAntiga: c.t?.id || null });
      $('conv-resultado').innerHTML = `<p style="color:#047857;">✅ Conta <strong>${escapeHtml(nomeConta)}</strong> criada (trial). ${escapeHtml(c.u.nome || '')} é o administrador e entra com o mesmo e-mail e senha.
        Ajuste plano e mensalidade em <strong>Editar plano e módulos</strong>.</p>`;
    }
    btn.style.display = 'none';
    _conv = null;
    if (typeof loadTenantsTable === 'function') loadTenantsTable();
  } catch (err) {
    showAlert('conv-alert', 'Erro: ' + err.message);
  } finally { btn.disabled = false; btn.textContent = '🔄 Converter'; }
}

window.openConverterConta = openConverterConta;
window.buscarContaConversao = buscarContaConversao;
window.confirmarConversao = confirmarConversao;
