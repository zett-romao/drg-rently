// =============================================================
// DRG-Rently — PROTEÇÃO CONTRA GOLPES (corretores e clientes)
// =============================================================
// Carregado DEPOIS do rede.js. Pedido do dono (17/10/2026), itens aprovados 1 a 7 —
// "não convém burocratizar muito, do contrário não teremos clientes":
//   1. Contrato de parceria do corretor, assinado no DRG-Sign (opcional: só libera o acesso depois)
//   2. "Tenho um cliente": o corretor registra o cliente DELE com data e hora (protocolo imutável)
//   3. Aviso contra golpes no site (site-engine.js) e na página do imóvel (public-imovel.js)
//   4. Cliente identificado (CPF + documento) antes da visita — a imobiliária confere, o corretor vê ✓
//   5. CRECI conferido na aprovação do parceiro (fica registrado quem conferiu e quando)
//   6. Alerta de corretor abrindo fichas da rede em massa (auditoria "ver_ficha")
//   7. Matrícula: consulta opcional (ONR) + "conferida" registrado no imóvel — nunca obrigatório
//
// Dados:
//   config/rede.protecao = { contratoTexto, exigirContrato, limiteFichasDia, urlConsultaCreci }
//   corretores/{uid}.creciConferido = { numero, em, por, porNome }
//   corretores/{uid}.contratoParceria = { assinaturaId, status, enviadoEm }
//   registrosCliente/{id}      — protocolo do corretor (só cria; ninguém altera o registro)
//   registrosClienteChave/{h}  — 1 por telefone (SHA-256): o segundo registro do mesmo cliente é recusado
//   leadsImoveis/{id}.identificacao = { cpf, documentoConferido, em, por, porNome }  (leadsCorretor só leva ✓)
//   imoveis/{id}.matriculaConferida = { em, por, porNome }

const PROTECAO_PADRAO = {
  exigirContrato: false,
  cidadeForo: '',
  limiteFichasDia: 30,
  urlConsultaCreci: 'https://www.cofeci.gov.br/',
  contratoTexto: `CONTRATO DE PARCERIA ENTRE IMOBILIÁRIA E CORRETOR DE IMÓVEIS

IMOBILIÁRIA: {{IMOBILIARIA}}{{CNPJ_TEXTO}}{{CRECI_IMOBILIARIA_TEXTO}}, com sede em {{ENDERECO_IMOBILIARIA}}, telefone {{TELEFONE_IMOBILIARIA}}, doravante IMOBILIÁRIA.
CORRETOR(A) PARCEIRO(A): {{CORRETOR}}, inscrito(a) no {{DOC_CORRETOR}}, inscrito(a) no CRECI sob nº {{CRECI_CORRETOR}}, com endereço em {{ENDERECO_CORRETOR}}, telefone {{TELEFONE_CORRETOR}}, e-mail {{EMAIL_CORRETOR}}, doravante CORRETOR.

1. OBJETO. Parceria para captação e intermediação de imóveis por meio do sistema da IMOBILIÁRIA, sem vínculo empregatício, nos termos da Lei 6.530/1978 e do art. 6º da Lei 13.097/2015 (corretor associado).

2. CLIENTES DA IMOBILIÁRIA. Os clientes (interessados, compradores, locatários e proprietários) que chegarem por anúncios, portais, site, redes sociais ou canais da IMOBILIÁRIA são da IMOBILIÁRIA, que paga por essa divulgação. O CORRETOR não poderá atendê-los por fora, negociar diretamente nem desviá-los para outra imobiliária ou corretor.

3. CONTATO. Todo contato com clientes e proprietários será feito pelos canais oficiais da IMOBILIÁRIA. É vedado ao CORRETOR divulgar telefone, e-mail, site ou perfil pessoal em anúncios, fotos, fichas ou materiais do acervo da IMOBILIÁRIA.

4. CLIENTE TRAZIDO PELO CORRETOR. O cliente que o CORRETOR trouxer deverá ser registrado no sistema ("Tenho um cliente"). O registro com data e hora prevalece para definir quem trouxe o cliente.

5. COMISSÃO. Salvo ajuste por escrito no negócio, a comissão de cada negócio fechado será dividida: {{PCT_CAPTADOR}}% a quem captou o imóvel, {{PCT_VENDEDOR}}% a quem fechou o negócio e {{PCT_ESCRITORIO}}% à IMOBILIÁRIA. A comissão é recebida exclusivamente pela IMOBILIÁRIA e repassada ao CORRETOR após o efetivo recebimento. É vedado receber qualquer valor diretamente do cliente.

6. PAGAMENTOS. Sinal, aluguel, caução e quaisquer valores do cliente serão pagos somente em nome da IMOBILIÁRIA. O CORRETOR não poderá pedir depósito, Pix ou transferência para conta própria ou de terceiros.

7. DADOS E SIGILO (LGPD). Os dados de clientes, proprietários e imóveis acessados no sistema são da IMOBILIÁRIA e só podem ser usados para esta parceria. É vedado copiá-los, exportá-los ou repassá-los a terceiros, durante e após a parceria.

8. MARCA E FOTOS. As fotos e materiais do acervo levam a marca da IMOBILIÁRIA e não podem ser usados em anúncios próprios do CORRETOR ou de terceiros.

9. DESCUMPRIMENTO. O desvio de cliente ou de negócio, ou o descumprimento das cláusulas 2, 3, 6 ou 7, sujeita o CORRETOR a multa equivalente à comissão integral do negócio desviado, sem prejuízo de perdas e danos, do desligamento imediato e da comunicação ao CRECI.

10. PRAZO. Prazo indeterminado; qualquer parte pode encerrar a parceria por aviso no sistema ou por escrito. As cláusulas 2, 5, 7 e 9 continuam valendo depois do encerramento para os negócios e clientes originados durante a parceria.

{{CLAUSULA_FORO}}

{{CIDADE}}, {{DATA}}.

Assinado eletronicamente pelas partes.`,
};

let _protecaoCache = null;
async function getProtecao() {
  if (_protecaoCache) return _protecaoCache;
  let p = {};
  try { const s = await tenantPath().collection('config').doc('rede').get(); p = (s.exists && s.data().protecao) || {}; } catch (_) {}
  _protecaoCache = { ...PROTECAO_PADRAO, ...p };
  return _protecaoCache;
}
const _escP = (s) => escapeHtml(String(s ?? ''));
const _quem = () => ({ por: State.user.uid, porNome: State.userDoc?.nome || State.user.email || '' });

// ---------- modal genérico (todo modal tem X, Esc e clique fora) ----------
function _modalProtecao(id, titulo, corpo, rodape) {
  let m = document.getElementById(id);
  if (!m) {
    m = document.createElement('div');
    m.className = 'modal-overlay'; m.id = id;
    m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; });
    document.body.appendChild(m);
  }
  m.innerHTML = `<div class="modal"><div class="modal-header"><h3>${titulo}</h3>
      <button class="modal-close" type="button" aria-label="Fechar" onclick="document.getElementById('${id}').style.display='none'">×</button></div>
    <div class="modal-body"><div id="${id}-alert" class="alert alert-error" style="display:none;"></div>${corpo}</div>
    <div class="modal-footer">${rodape}</div></div>`;
  m.style.display = 'flex';
  return m;
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  ['modal-registro-cliente', 'modal-identificar-lead'].forEach((id) => { const m = document.getElementById(id); if (m) m.style.display = 'none'; });
});

// ---------- botão que nunca fica mudo ----------
async function _ciclo(btn, aguarde, fn) {
  const txt = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = aguarde; }
  try { return await fn(); }
  catch (e) { if (btn) { btn.disabled = false; btn.textContent = txt; } throw e; }
}

// =============================================================
// Card de configuração (tela Corretores)
// =============================================================
async function renderCardProtecao() {
  const box = $('card-protecao-rede');
  if (!box) return;
  _protecaoCache = null;
  const p = await getProtecao();
  box.innerHTML = `
    <h3>🛡 Proteção da rede</h3>
    <p class="muted">Contrato de parceria, conferência do CRECI e alerta de abertura de fichas em massa. Tudo opcional — ajuste ao jeito da sua imobiliária.</p>
    <div class="form-group"><label for="prot-contrato">📝 Modelo do contrato de parceria</label>
      <textarea id="prot-contrato" rows="10" style="font-family:inherit;">${_escP(p.contratoTexto)}</textarea>
      <small class="muted">Campos trocados na hora de gerar: {{IMOBILIARIA}} {{CNPJ_TEXTO}} {{CRECI_IMOBILIARIA_TEXTO}} {{ENDERECO_IMOBILIARIA}} {{TELEFONE_IMOBILIARIA}} {{CORRETOR}} {{DOC_CORRETOR}} {{CRECI_CORRETOR}} {{ENDERECO_CORRETOR}} {{TELEFONE_CORRETOR}} {{EMAIL_CORRETOR}} {{PCT_CAPTADOR}} {{PCT_VENDEDOR}} {{PCT_ESCRITORIO}} {{CIDADE}} {{DATA}}.
        🔒 A cláusula de <strong>foro</strong> é sempre a da cidade da sede, com renúncia a qualquer outro — o sistema a coloca mesmo que seja apagada do modelo. É um modelo: revise com o seu advogado.</small></div>
    <div class="form-group"><label class="toggle-row" style="cursor:pointer;"><input type="checkbox" id="prot-exigir" ${p.exigirContrato ? 'checked' : ''}>
      <span>Corretor só usa o sistema depois de assinar o contrato (desligado = assina, mas já trabalha)</span></label></div>
    <div class="form-row">
      <div class="form-group"><label for="prot-limite">👀 Alerta quando um corretor abrir mais de … fichas da rede no dia</label>
        <input type="number" id="prot-limite" min="5" max="500" value="${_escP(p.limiteFichasDia)}"></div>
      <div class="form-group"><label>⚖️ Foro do contrato</label>
        <input type="text" disabled value="${_escP(State.tenant?.cidade ? State.tenant.cidade + (State.tenant.uf ? '/' + State.tenant.uf : '') : 'cidade da sede — preencha em Configurações')}">
        <small class="muted">Sempre a cidade da sede da imobiliária (Configurações → Endereço da sede), com renúncia a qualquer outro foro.</small></div>
      <div class="form-group"><label for="prot-creci">🔎 Endereço da consulta de CRECI</label>
        <input type="url" id="prot-creci" value="${_escP(p.urlConsultaCreci)}"><small class="muted">Use a “Busca de corretores” do CRECI do seu estado.</small></div>
    </div>
    <div id="prot-status" style="margin-top:8px;"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-primary" id="btn-prot-salvar" onclick="salvarProtecao()">💾 Salvar proteção</button>
      <button class="btn btn-secondary" type="button" onclick="restaurarContratoPadrao()">↩ Voltar ao modelo padrão do contrato</button>
    </div>`;
}

async function salvarProtecao() {
  if (!exigirPode('corretores', 'editar', 'prot-status')) return;
  const btn = $('btn-prot-salvar');
  const protecao = {
    contratoTexto: $('prot-contrato').value.trim() || PROTECAO_PADRAO.contratoTexto,
    exigirContrato: $('prot-exigir').checked,
    limiteFichasDia: Math.max(5, Math.min(500, parseInt($('prot-limite').value, 10) || PROTECAO_PADRAO.limiteFichasDia)),
    urlConsultaCreci: /^https:\/\//i.test($('prot-creci').value.trim()) ? $('prot-creci').value.trim() : PROTECAO_PADRAO.urlConsultaCreci,
  };
  try {
    await _ciclo(btn, '⏳ Salvando… aguarde', () => tenantPath().collection('config').doc('rede').set({ protecao }, { merge: true }));
    _protecaoCache = { ...PROTECAO_PADRAO, ...protecao };
    logAuditoria('update', 'config', 'protecao', { exigirContrato: protecao.exigirContrato, limiteFichasDia: protecao.limiteFichasDia });
    showInlineStatus('prot-status', '✓ Proteção salva.', 'success', 5000);
  } catch (err) {
    showInlineStatus('prot-status', `❌ ${_escP(err.message)}`, 'error');
  } finally { if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar proteção'; } }
}
function restaurarContratoPadrao() { $('prot-contrato').value = PROTECAO_PADRAO.contratoTexto; }

// =============================================================
// 5. CRECI conferido na aprovação
// =============================================================
// Chamado pelo definirStatusCorretor (rede.js) ANTES de liberar um corretor pendente.
// Devolve o registro da conferência, ou null se a pessoa desistiu.
async function confirmarCreciNaAprovacao(uid) {
  let c = {};
  try { const s = await tenantPath().collection('corretores').doc(uid).get(); c = s.exists ? s.data() : {}; } catch (_) {}
  const p = await getProtecao();
  const creci = c.creci || '';
  const ok = await confirmar({
    titulo: 'Liberar acesso ao corretor?',
    mensagem: `<strong>${_escP(c.nome || 'Corretor')}</strong> · CRECI <strong>${_escP(creci || 'não informado')}</strong>`,
    detalhe: `🔎 Antes de liberar, confira se o CRECI está <strong>ATIVO</strong> e se o nome bate:
      <a href="${_escP(p.urlConsultaCreci)}" target="_blank" rel="noopener">abrir a consulta de corretores ↗</a>.<br>
      Ao clicar em liberar, fica registrado que <strong>você</strong> conferiu o CRECI agora.`,
    confirmar: '✅ Conferi o CRECI e libero',
  });
  if (!ok) return null;
  return { numero: creci || null, em: new Date().toISOString(), ..._quem() };
}

// =============================================================
// 1. Contrato de parceria
// =============================================================
// Foro (28/10/2026, regra do dono): sempre a cidade da SEDE da imobiliária, com renúncia
// expressa a qualquer outro. Vale até para modelo editado: a cláusula FORO é trocada/inserida.
const CLAUSULA_FORO = 'FORO. As partes elegem o foro da comarca de {{CIDADE}}, sede da IMOBILIÁRIA, para dirimir quaisquer questões oriundas deste contrato, com renúncia expressa a qualquer outro, por mais privilegiado que seja ou venha a ser.';

function _ajustarModelo(texto) {
  let t = String(texto);
  // Modelos salvos antes de 28/10/2026: qualificação sem endereço/telefone/documento
  t = t.replace(/^IMOBILIÁRIA: \{\{IMOBILIARIA\}\}\{\{CNPJ_TEXTO\}\}\{\{CRECI_IMOBILIARIA_TEXTO\}\}, doravante IMOBILIÁRIA\.$/m,
    'IMOBILIÁRIA: {{IMOBILIARIA}}{{CNPJ_TEXTO}}{{CRECI_IMOBILIARIA_TEXTO}}, com sede em {{ENDERECO_IMOBILIARIA}}, telefone {{TELEFONE_IMOBILIARIA}}, doravante IMOBILIÁRIA.');
  t = t.replace(/^CORRETOR\(A\) PARCEIRO\(A\): \{\{CORRETOR\}\}, inscrito\(a\) no CRECI sob nº \{\{CRECI_CORRETOR\}\}, e-mail \{\{EMAIL_CORRETOR\}\}, doravante CORRETOR\.$/m,
    'CORRETOR(A) PARCEIRO(A): {{CORRETOR}}, inscrito(a) no {{DOC_CORRETOR}}, inscrito(a) no CRECI sob nº {{CRECI_CORRETOR}}, com endereço em {{ENDERECO_CORRETOR}}, telefone {{TELEFONE_CORRETOR}}, e-mail {{EMAIL_CORRETOR}}, doravante CORRETOR.');
  // Cláusula de foro: troca a que existir (numerada ou não) pela padrão; sem nenhuma, insere antes da data
  if (/\{\{CLAUSULA_FORO\}\}/.test(t)) {
    const nums = [...t.matchAll(/^(\d+)\.\s/gm)].map((m) => Number(m[1]));
    t = t.replace('{{CLAUSULA_FORO}}', `${(nums.length ? Math.max(...nums) : 0) + 1}. ${CLAUSULA_FORO}`);
  } else if (/^(\d+\.\s*)?FORO\b.*$/mi.test(t)) {
    t = t.replace(/^(\d+\.\s*)?FORO\b.*$/mi, (m, n) => `${n || ''}${CLAUSULA_FORO}`);
  } else {
    const nums = [...t.matchAll(/^(\d+)\.\s/gm)].map((m) => Number(m[1]));
    const clausula = `${(nums.length ? Math.max(...nums) : 0) + 1}. ${CLAUSULA_FORO}`;
    t = /^\{\{CIDADE\}\}, \{\{DATA\}\}\.?$/m.test(t)
      ? t.replace(/^\{\{CIDADE\}\}, \{\{DATA\}\}\.?$/m, (m) => `${clausula}\n\n${m}`)
      : `${t}\n\n${clausula}`;
  }
  return t;
}

// O que falta para sair o contrato (imobiliária + corretor). Vazio = pode gerar.
function faltasParaContrato(c, cadastroImob) {
  const t = State.tenant || {};
  const fi = typeof faltaNoCadastroImobiliaria === 'function' ? faltaNoCadastroImobiliaria(t, cadastroImob && cadastroImob.endereco) : [];
  const fc = faltaNoCadastroCorretor(c);
  return [
    ...(fi.length ? [`da IMOBILIÁRIA (Configurações): ${fi.join('; ')}`] : []),
    ...(fc.length ? [`do CORRETOR (Editar): ${fc.join('; ')}`] : []),
  ];
}

function _preencherContrato(texto, c, cadastroImob) {
  const t = State.tenant || {};
  const r = typeof regraComissao === 'function' ? regraComissao() : { captadorPct: 30, vendedorPct: 30, escritorioPct: 40 };
  const endImob = (cadastroImob && cadastroImob.endereco) || {};
  const cidade = endImob.cidade ? `${endImob.cidade}${endImob.uf ? '/' + endImob.uf : ''}` : '________________';
  const docC = String(c.documento || '').replace(/\D/g, '');
  const v = {
    IMOBILIARIA: t.nome || 'Imobiliária',
    CNPJ_TEXTO: t.cnpj ? `, CNPJ ${t.cnpj}` : (t.cpf ? `, CPF ${t.cpf}` : ''),
    CRECI_IMOBILIARIA_TEXTO: t.creci ? `, CRECI ${t.creci}` : '',
    ENDERECO_IMOBILIARIA: fmtEndereco(endImob) || '________________',
    TELEFONE_IMOBILIARIA: t.telefone ? maskTelefone(t.telefone) : '________',
    CORRETOR: c.nome || '', CRECI_CORRETOR: c.creci || '________', EMAIL_CORRETOR: c.email || '',
    DOC_CORRETOR: docC.length === 14 ? `CNPJ sob nº ${fmtCpfCnpj(docC)}` : `CPF sob nº ${docC ? fmtCpfCnpj(docC) : '________'}`,
    ENDERECO_CORRETOR: fmtEndereco(c.endereco) || '________________',
    TELEFONE_CORRETOR: c.telefone ? maskTelefone(c.telefone) : '________',
    PCT_CAPTADOR: r.captadorPct, PCT_VENDEDOR: r.vendedorPct, PCT_ESCRITORIO: r.escritorioPct,
    CIDADE: cidade, DATA: new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }),
  };
  return _ajustarModelo(texto).replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in v ? String(v[k]) : m));
}
async function _pdfDoTexto(texto) {
  for (let i = 0; i < 20 && !window.html2pdf; i++) await new Promise((r) => setTimeout(r, 300));
  if (!window.html2pdf) throw new Error('O gerador de PDF não carregou. Recarregue a página.');
  const el = document.createElement('div');
  el.style.cssText = 'width:210mm;padding:0 20mm;background:#fff;color:#111;font-family:Georgia,"Times New Roman",serif;font-size:11pt;line-height:1.55;';
  const [titulo, ...resto] = texto.split(/\n/);
  el.innerHTML = `<h2 style="text-align:center;font-size:13pt;margin:0 0 14px;">${_escP(titulo)}</h2>`
    + resto.join('\n').split(/\n{2,}/).map((par) => `<p style="margin:0 0 9px;text-align:justify;page-break-inside:avoid;">${_escP(par).replace(/\n/g, '<br>')}</p>`).join('');
  const blob = await html2pdf().set({ margin: [18, 0, 18, 0], image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, logging: false }, jsPDF: { unit: 'mm', format: 'a4' }, pagebreak: { mode: ['css', 'legacy'] } }).from(el).outputPdf('blob');
  return { blob, base64: await blobToBase64(blob) };
}

async function enviarContratoParceria(uid, btn) {
  try {
    await _ciclo(btn, '⏳ Gerando o contrato… aguarde', async () => {
      const s = await tenantPath().collection('corretores').doc(uid).get();
      if (!s.exists) throw new Error('Corretor não encontrado.');
      const c = s.data();
      if (!c.email) throw new Error('O corretor precisa ter e-mail para assinar.');
      const cadSnap = await tenantPath().collection('config').doc('cadastro').get();
      const cadastroImob = cadSnap.exists ? cadSnap.data() : {};
      const faltas = faltasParaContrato(c, cadastroImob);
      if (faltas.length) throw new Error('Complete antes o cadastro — falta ' + faltas.join(' | ') + '.');
      const p = await getProtecao();
      const texto = _preencherContrato(p.contratoTexto, c, cadastroImob);
      const { blob, base64 } = await _pdfDoTexto(texto);
      const cfg = await _cfgSite();
      const plat = plataformaAssinatura(cfg);
      const nomeArq = `contrato-parceria-${String(c.nome || 'corretor').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').toLowerCase()}.pdf`;
      if (plat.id === 'drg-sign' && plat.pronta) {
        if (btn) btn.textContent = '⏳ Abrindo o DRG-Sign… aguarde ~1 min';
        const id = tenantPath().collection('assinaturas').doc().id;
        await abrirTelaSign({
          tipo: 'avulsa', id, titulo: `Contrato de parceria — ${c.nome || ''}`,
          signers: [
            { name: c.nome || '', email: c.email, role: 'Corretor parceiro' },
            { name: State.userDoc?.nome || '', email: State.user.email || '', role: `Pela ${State.tenant.nome || 'imobiliária'}` },
          ],
          arquivos: [{ nome: nomeArq, base64, sugerido: false }],
          extra: { corretorUid: uid, corretorNome: c.nome || null },
        });
      } else {
        // Plataforma externa: baixa o PDF; a assinatura volta por Assinaturas → 📎 Anexar assinado
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = nomeArq; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        await tenantPath().collection('corretores').doc(uid).update({
          contratoParceria: { status: 'pending', plataforma: plat.nome || 'externa', enviadoEm: new Date().toISOString(), ..._quem() },
        });
        showInlineStatus('corretores-status', `✓ Contrato de ${_escP(c.nome)} gerado (${_escP(nomeArq)}). Envie pela ${_escP(plat.nome || 'sua plataforma')} e, quando voltar assinado, marque em 📝 Contrato → “Assinado”.`, 'success', 12000);
        loadCorretores();
      }
      logAuditoria('contrato_parceria', 'corretor', uid, { plataforma: plat.id || 'externa' });
    });
  } catch (err) {
    showInlineStatus('corretores-status', `❌ Contrato de parceria: ${_escP(err.message)}`, 'error');
  } finally { if (btn) { btn.disabled = false; btn.textContent = '📝 Contrato'; } }
}

// Plataforma externa: a equipe marca à mão quando o contrato volta assinado
async function marcarContratoAssinado(uid) {
  if (!(await confirmar({ titulo: 'Contrato assinado?', mensagem: 'Marcar o contrato de parceria deste corretor como assinado.', detalhe: 'Guarde o PDF assinado em Assinaturas (📎 Anexar assinado).', confirmar: '✅ Está assinado' }))) return;
  await tenantPath().collection('corretores').doc(uid).update({ 'contratoParceria.status': 'signed', 'contratoParceria.assinadoEm': new Date().toISOString(), 'contratoParceria.marcadoPor': State.user.uid });
  logAuditoria('contrato_parceria', 'corretor', uid, { status: 'signed', manual: true });
  loadCorretores();
}

// Avisos do Sign (assinaturas.js chama): espelha o status no cartão do corretor
async function espelharContratoNoCorretor(corretorUid, assinaturaId, status) {
  if (!corretorUid) return;
  try {
    await tenantPath().collection('corretores').doc(corretorUid).set({
      contratoParceria: { assinaturaId, status: status || 'pending', plataforma: 'DRG-Sign', atualizadoEm: new Date().toISOString() },
    }, { merge: true });
  } catch (e) { console.warn('Contrato no cartão do corretor não atualizado:', e); }
}

// Tela Corretores: confere o status das assinaturas pendentes (quem assina pelo Sign
// muda o status lá; o espelho no cartão acompanha quando a equipe abre a tela)
async function sincronizarContratosParceria(lista) {
  const pend = (lista || []).filter((c) => c.contratoParceria?.assinaturaId && c.contratoParceria.status === 'pending');
  for (const c of pend) {
    try {
      const a = (await tenantPath().collection('assinaturas').doc(c.contratoParceria.assinaturaId).get()).data();
      const st = a?.assinatura?.status;
      if (st && st !== 'pending') {
        await tenantPath().collection('corretores').doc(c.uid).update({ 'contratoParceria.status': st });
        c.contratoParceria.status = st;
      }
    } catch (_) { /* segue */ }
  }
}

function celulaProtecaoCorretor(c) {
  const cp = c.contratoParceria || {};
  const contrato = cp.status === 'signed' ? '<span style="color:#166534;">✅ Contrato assinado</span>'
    : cp.status === 'pending' ? '<span style="color:#92400E;">⏳ Contrato enviado</span>'
    : ['refused', 'expired'].includes(cp.status) ? '<span style="color:#991B1B;">❌ Contrato não assinado</span>'
    : '<span class="muted">— sem contrato</span>';
  const creci = c.creciConferido ? `<span style="color:#166534;" title="Conferido por ${_escP(c.creciConferido.porNome || '')} em ${_escP(new Date(c.creciConferido.em).toLocaleString('pt-BR'))}">🔎 CRECI conferido</span>`
    : '<span style="color:#92400E;">⚠️ CRECI não conferido</span>';
  return `<div style="font-size:11px;line-height:1.5;">${creci}<br>${contrato}</div>`;
}
function botoesProtecaoCorretor(c) {
  const cp = c.contratoParceria || {};
  const b = [`<button class="btn btn-sm btn-secondary" onclick="enviarContratoParceria('${c.uid}', this)" title="Gerar o contrato de parceria e mandar assinar">📝 Contrato</button>`];
  if (cp.status === 'pending' && !cp.assinaturaId) b.push(`<button class="btn btn-sm btn-secondary" onclick="marcarContratoAssinado('${c.uid}')">✅ Assinado</button>`);
  if (!c.creciConferido && c.status === 'ativo') b.push(`<button class="btn btn-sm btn-secondary" onclick="conferirCreciDepois('${c.uid}')">🔎 Conferir CRECI</button>`);
  return b.join(' ');
}
async function conferirCreciDepois(uid) {
  const reg = await confirmarCreciNaAprovacao(uid);
  if (!reg) return;
  await tenantPath().collection('corretores').doc(uid).update({ creciConferido: reg });
  logAuditoria('creci_conferido', 'corretor', uid, { numero: reg.numero });
  loadCorretores();
}

// Corretor: contrato exigido e ainda não assinado → tela de espera (sem acesso ao resto)
async function verificarContratoCorretor() {
  if (!isCorretor()) return;
  const p = await getProtecao();
  if (!p.exigirContrato) return;
  let c = {};
  try { c = (await tenantPath().collection('corretores').doc(State.user.uid).get()).data() || {}; } catch (_) {}
  if (c.contratoParceria?.status === 'signed') return;
  let tela = document.getElementById('tela-contrato-pendente');
  if (!tela) { tela = document.createElement('div'); tela.id = 'tela-contrato-pendente'; document.body.appendChild(tela); }
  tela.className = 'modal-overlay'; tela.style.display = 'flex'; tela.style.zIndex = '9000';
  tela.innerHTML = `<div class="modal" style="max-width:520px;"><div class="modal-header"><h3>📝 Falta assinar o contrato de parceria</h3>
      <button class="modal-close" type="button" aria-label="Sair" onclick="doLogout()">×</button></div>
    <div class="modal-body"><p>Para usar o sistema da <strong>${_escP(State.tenant?.nome || 'imobiliária')}</strong>, assine o contrato de parceria.</p>
      <p>${c.contratoParceria?.status === 'pending' ? '✉️ O contrato já foi enviado para o seu e-mail pelo DRG-Sign. Assine pelo link do e-mail e volte aqui.' : '⏳ A imobiliária ainda vai enviar o contrato para o seu e-mail. Fale com ela se demorar.'}</p></div>
    <div class="modal-footer"><button class="btn btn-secondary" type="button" onclick="doLogout()">Sair</button>
      <button class="btn btn-primary" type="button" onclick="this.disabled=true;this.textContent='⏳ Verificando… aguarde';location.reload()">Já assinei — verificar</button></div></div>`;
}

// =============================================================
// 2. "Tenho um cliente" — protocolo do corretor
// =============================================================
const _telNorm = (t) => { let d = String(t || '').replace(/\D/g, ''); if (/^55\d{10,11}$/.test(d)) d = d.slice(2); return d; };
async function _sha256(txt) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}
const _chaveCliente = async (tel) => _sha256(`${State.tenant.id}:${_telNorm(tel)}`);

function abrirRegistroCliente() {
  _modalProtecao('modal-registro-cliente', '🙋 Tenho um cliente', `
    <p class="muted" style="margin-top:0;">Registre aqui o cliente que <strong>você</strong> trouxe. Data e hora ficam guardadas e garantem a sua parte — o registro não pode ser alterado depois.</p>
    <div class="form-row"><div class="form-group"><label for="rc-nome">Nome do cliente*</label><input id="rc-nome" maxlength="120"></div>
      <div class="form-group"><label for="rc-tel">Celular / WhatsApp*</label><input id="rc-tel" inputmode="tel" maxlength="20" placeholder="(11) 99999-9999"></div></div>
    <div class="form-group"><label for="rc-email">E-mail (opcional)</label><input id="rc-email" type="email" maxlength="120"></div>
    <div class="form-row"><div class="form-group"><label for="rc-quer">Procura</label><select id="rc-quer"><option value="venda">Comprar</option><option value="locacao">Alugar</option><option value="anunciar">Vender/alugar o imóvel dele</option></select></div>
      <div class="form-group"><label for="rc-codigo">Código do imóvel (se já tem)</label><input id="rc-codigo" maxlength="20" placeholder="ex.: IMA0012"></div></div>
    <div class="form-group"><label for="rc-obs">Observação</label><textarea id="rc-obs" rows="2" maxlength="500" placeholder="ex.: quer 3 dormitórios em Alphaville até R$ 900 mil"></textarea></div>`,
  `<button class="btn btn-secondary" type="button" onclick="document.getElementById('modal-registro-cliente').style.display='none'">Cancelar</button>
   <button class="btn btn-primary" type="button" id="btn-rc-salvar" onclick="salvarRegistroCliente()">🙋 Registrar cliente</button>`);
}

async function salvarRegistroCliente() {
  const alerta = 'modal-registro-cliente-alert';
  clearAlert(alerta);
  const nome = $('rc-nome').value.trim(), tel = _telNorm($('rc-tel').value), email = $('rc-email').value.trim() || null;
  if (nome.length < 2) { showAlert(alerta, 'Informe o nome do cliente.'); return; }
  if (tel.length < 10) { showAlert(alerta, 'Informe o celular com DDD.'); return; }
  const btn = $('btn-rc-salvar');
  btn.disabled = true; btn.textContent = '⏳ Registrando… aguarde';
  try {
    const chave = await _chaveCliente(tel);
    const ref = tenantPath().collection('registrosCliente').doc();
    const lote = db.batch();
    lote.set(ref, {
      corretorUid: State.user.uid, corretorNome: State.userDoc?.nome || State.user.email || '',
      clienteNome: nome.slice(0, 120), telefone: tel, email: email ? email.slice(0, 120) : null,
      procura: $('rc-quer').value, codigoAnuncio: $('rc-codigo').value.trim().toUpperCase().slice(0, 20) || null,
      obs: $('rc-obs').value.trim().slice(0, 500) || null, chave,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    });
    lote.set(tenantPath().collection('registrosClienteChave').doc(chave), {
      corretorUid: State.user.uid, registroId: ref.id, criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await lote.commit();
    logAuditoria('cliente_registrado', 'registroCliente', ref.id, { procura: $('rc-quer').value });
    btn.textContent = '✓ Registrado';
    showAlert(alerta, `✓ Cliente registrado. Protocolo ${ref.id.slice(0, 8).toUpperCase()} — ${new Date().toLocaleString('pt-BR')}.`, 'success');
    setTimeout(() => { $('modal-registro-cliente').style.display = 'none'; loadMeusRegistros(); }, 1800);
  } catch (err) {
    btn.disabled = false; btn.textContent = '🙋 Registrar cliente';
    showAlert(alerta, err.code === 'permission-denied'
      ? '⚠️ Este cliente (celular) já está registrado na imobiliária. Fale com a imobiliária antes de atendê-lo.'
      : 'Não foi possível registrar: ' + err.message);
  }
}

async function loadMeusRegistros() {
  const box = $('card-meus-registros');
  if (!box || !isCorretor()) return;
  box.innerHTML = `<div class="section-header"><div><h3>🙋 Clientes que eu trouxe</h3>
      <p class="muted">Registre o seu cliente <strong>antes</strong> de levá-lo a um imóvel: data e hora garantem a sua parte na comissão.</p></div>
      <button class="btn btn-primary btn-sm" onclick="abrirRegistroCliente()">🙋 Tenho um cliente</button></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Protocolo</th><th>Cliente</th><th>Procura</th><th>Análise da imobiliária</th></tr></thead>
    <tbody id="tbody-meus-registros"><tr><td colspan="4" class="empty">⏳ Carregando…</td></tr></tbody></table></div>`;
  try {
    const s = await tenantPath().collection('registrosCliente').where('corretorUid', '==', State.user.uid).get();
    const lista = s.docs.map((d) => ({ _id: d.id, ...d.data() })).sort((a, b) => (b.criadoEm?.toMillis?.() || 0) - (a.criadoEm?.toMillis?.() || 0));
    $('tbody-meus-registros').innerHTML = lista.length ? lista.map((r) => `<tr>
      <td><strong>${r._id.slice(0, 8).toUpperCase()}</strong><br><span class="muted" style="font-size:11px;">${r.criadoEm?.toDate ? r.criadoEm.toDate().toLocaleString('pt-BR') : '—'}</span></td>
      <td>${_escP(r.clienteNome)}</td>
      <td style="font-size:12px;">${_escP({ venda: 'Comprar', locacao: 'Alugar', anunciar: 'Anunciar o imóvel dele' }[r.procura] || '')}${r.codigoAnuncio ? ' · ' + _escP(r.codigoAnuncio) : ''}</td>
      <td style="font-size:12px;">${_ANALISE_LABEL[r.analise] || '⏳ Em análise'}${r.analiseNota ? `<br><span class="muted">${_escP(r.analiseNota)}</span>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">Nenhum cliente registrado ainda.</td></tr>';
  } catch (err) {
    $('tbody-meus-registros').innerHTML = `<tr><td colspan="4" class="empty" style="color:var(--danger);">Erro: ${_escP(err.message)}</td></tr>`;
  }
}

const _ANALISE_LABEL = { valido: '✅ Confirmado: cliente seu', duplicado: '⚠️ Já era cliente da imobiliária', recusado: '❌ Não aceito' };

// Equipe: registros dos corretores, com o conflito (cliente já era lead da casa) apontado
async function loadRegistrosClientes() {
  const box = $('card-registros-clientes');
  if (!box || isCorretor()) return;
  box.innerHTML = `<div class="section-header"><div><h3>🙋 Clientes registrados pelos corretores</h3>
      <p class="muted">Protocolo com data e hora: quem registrou primeiro trouxe o cliente. ⚠️ marca quem já era lead da imobiliária antes do registro.</p></div>
      <button class="btn btn-secondary btn-sm" onclick="loadRegistrosClientes()">↻ Recarregar</button></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Protocolo</th><th>Corretor</th><th>Cliente</th><th>Conferência</th><th>Análise</th></tr></thead>
    <tbody id="tbody-registros-clientes"><tr><td colspan="5" class="empty">⏳ Carregando…</td></tr></tbody></table></div>`;
  try {
    const [s, ls] = await Promise.all([
      tenantPath().collection('registrosCliente').orderBy('criadoEm', 'desc').limit(200).get(),
      tenantPath().collection('leadsImoveis').orderBy('criadoEm', 'desc').limit(500).get().catch(() => ({ docs: [] })),
    ]);
    const leadsPorTel = new Map();
    ls.docs.forEach((d) => { const l = d.data(); const t = _telNorm(l.telefone); if (t && !leadsPorTel.has(t)) leadsPorTel.set(t, l); });
    const lista = s.docs.map((d) => ({ _id: d.id, ...d.data() }));
    _registrosCache = lista;
    $('tbody-registros-clientes').innerHTML = lista.length ? lista.map((r) => {
      const quando = r.criadoEm?.toDate ? r.criadoEm.toDate() : null;
      const lead = leadsPorTel.get(r.telefone);
      const leadAntes = lead && lead.criadoEm?.toDate && quando && lead.criadoEm.toDate() < quando;
      return `<tr>
        <td><strong>${r._id.slice(0, 8).toUpperCase()}</strong><br><span class="muted" style="font-size:11px;">${quando ? quando.toLocaleString('pt-BR') : '—'}</span></td>
        <td>${_escP(r.corretorNome || '')}</td>
        <td>${_escP(r.clienteNome)}<br><span style="font-size:11px;">${_escP(maskTelefone(r.telefone))}${r.email ? ' · ' + _escP(r.email) : ''}</span>${r.obs ? `<br><span class="muted" style="font-size:11px;">${_escP(r.obs)}</span>` : ''}</td>
        <td style="font-size:12px;">${leadAntes ? `<span style="color:#991B1B;font-weight:600;">⚠️ Já era lead da imobiliária desde ${lead.criadoEm.toDate().toLocaleDateString('pt-BR')}</span>` : '<span style="color:#166534;">✓ Sem registro anterior</span>'}</td>
        <td><select aria-label="Análise do registro" onchange="analisarRegistroCliente('${r._id}', this)">
          <option value="">⏳ Em análise</option>${Object.entries(_ANALISE_LABEL).map(([k, v]) => `<option value="${k}" ${r.analise === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty">Nenhum cliente registrado por corretores.</td></tr>';
  } catch (err) {
    $('tbody-registros-clientes').innerHTML = `<tr><td colspan="5" class="empty" style="color:var(--danger);">Erro: ${_escP(err.message)}</td></tr>`;
  }
}
let _registrosCache = [];
async function analisarRegistroCliente(id, sel) {
  const nota = sel.value && sel.value !== 'valido' ? (prompt('Motivo (o corretor vê):') || '').trim().slice(0, 300) : '';
  sel.disabled = true;
  try {
    await tenantPath().collection('registrosCliente').doc(id).update({
      analise: sel.value || null, analiseNota: nota || null, analisadoPor: State.user.uid,
      analisadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    });
    logAuditoria('cliente_registro_analise', 'registroCliente', id, { analise: sel.value || null });
  } catch (err) {
    await confirmar({ titulo: 'Erro', mensagem: _escP(err.message), confirmar: 'OK' });
  } finally { sel.disabled = false; }
}

// =============================================================
// 4. Cliente identificado antes da visita
// =============================================================
function abrirIdentificarLead(leadId) {
  const l = (_leadsCarregados || []).find((x) => x._id === leadId) || {};
  const idf = l.identificacao || {};
  _modalProtecao('modal-identificar-lead', '🪪 Identificar o cliente', `
    <p style="margin-top:0;">Cliente: <strong>${_escP(l.nome || '')}</strong></p>
    <p class="muted" style="font-size:12px;">Golpe comum: falso interessado marca visita para conhecer o imóvel (ou o corretor). Confira o CPF e um documento com foto antes de liberar a visita — o corretor vê só “🪪 identificado”.</p>
    <div class="form-group"><label for="idl-cpf">CPF do cliente*</label><input id="idl-cpf" inputmode="numeric" maxlength="14" value="${_escP(idf.cpf || '')}" placeholder="000.000.000-00"></div>
    <div class="form-group"><label class="toggle-row" style="cursor:pointer;"><input type="checkbox" id="idl-doc" ${idf.documentoConferido ? 'checked' : ''}><span>Conferi um documento com foto (RG/CNH) e o nome bate</span></label></div>
    ${idf.em ? `<p class="muted" style="font-size:12px;">Identificado por ${_escP(idf.porNome || '')} em ${_escP(new Date(idf.em).toLocaleString('pt-BR'))}.</p>` : ''}`,
  `<button class="btn btn-secondary" type="button" onclick="document.getElementById('modal-identificar-lead').style.display='none'">Cancelar</button>
   <button class="btn btn-primary" type="button" id="btn-idl-salvar" onclick="salvarIdentificacaoLead('${leadId}')">🪪 Confirmar identificação</button>`);
}
async function salvarIdentificacaoLead(leadId) {
  const alerta = 'modal-identificar-lead-alert';
  clearAlert(alerta);
  const cpf = $('idl-cpf').value.replace(/\D/g, '');
  if (!validaCPF(cpf)) { showAlert(alerta, 'CPF inválido. Confira os números.'); return; }
  if (!$('idl-doc').checked) { showAlert(alerta, 'Marque que conferiu o documento com foto.'); return; }
  const btn = $('btn-idl-salvar');
  btn.disabled = true; btn.textContent = '⏳ Salvando… aguarde';
  try {
    const identificacao = { cpf, documentoConferido: true, em: new Date().toISOString(), ..._quem() };
    const r = await gravar({ modulo: 'leads', colecao: 'leadsImoveis', op: 'editar', id: leadId, dados: { identificacao },
      antes: await lerAntes('leadsImoveis', leadId), titulo: 'Lead — cliente identificado' });
    if (!r.pendente) {
      const l = (_leadsCarregados || []).find((x) => x._id === leadId);
      if (l) l.identificacao = identificacao;
      if (l?.corretorUid) await tenantPath().collection('leadsCorretor').doc(leadId).update({ clienteIdentificado: true }).catch(() => {});
      logAuditoria('identificar_cliente', 'lead', leadId, {});
    }
    btn.textContent = '✓ Identificado';
    showAlert(alerta, r.pendente ? msgGravacao(r) : '✓ Cliente identificado. A visita pode ser marcada.', 'success');
    setTimeout(() => { $('modal-identificar-lead').style.display = 'none'; if (typeof renderLeadsTable === 'function') renderLeadsTable(); }, 1400);
  } catch (err) {
    btn.disabled = false; btn.textContent = '🪪 Confirmar identificação';
    showAlert(alerta, 'Não foi possível salvar: ' + err.message);
  }
}

// =============================================================
// 6. Fichas abertas em massa
// =============================================================
function registrarFichaAberta(id) {
  if (!isCorretor()) return;
  logAuditoria('ver_ficha', 'imovelRede', id, null);
}
// Alertas do painel (dashboard) — app.js junta com os outros
async function alertasProtecao() {
  if (isCorretor()) return [];
  const out = [];
  const p = await getProtecao();
  try {
    const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
    const s = await tenantPath().collection('auditoria').where('timestamp', '>=', inicio).orderBy('timestamp', 'desc').limit(3000).get();
    const porUsuario = new Map();
    s.docs.forEach((d) => { const a = d.data(); if (a.acao === 'ver_ficha') { const k = a.userId; const x = porUsuario.get(k) || { n: 0, nome: a.userNome || a.userEmail || k, ids: new Set() }; x.n++; x.ids.add(a.entidadeId); porUsuario.set(k, x); } });
    porUsuario.forEach((x, uid) => {
      if (x.ids.size > p.limiteFichasDia) out.push({ nivel: 'critico', icone: '👀', titulo: `${x.nome} abriu ${x.ids.size} fichas da rede hoje`, sub: `Limite de alerta: ${p.limiteFichasDia}. Clique para ver na auditoria.`, secao: 'auditoria', onclick: `abrirAuditoriaFichas('${uid}')` });
    });
  } catch (e) { console.warn('Alerta de fichas indisponível:', e); }
  try {
    const s = await tenantPath().collection('corretores').where('status', '==', 'ativo').get();
    const sem = s.docs.filter((d) => !d.data().creciConferido).length;
    if (sem) out.push({ nivel: 'info', icone: '🔎', titulo: `${sem} corretor(es) ativo(s) sem CRECI conferido`, sub: 'Corretores → 🔎 Conferir CRECI', secao: 'corretores' });
  } catch (_) {}
  return out;
}
function abrirAuditoriaFichas(uid) {
  const hoje = new Date(); const d = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if ($('audit-de')) { $('audit-de').value = d; $('audit-ate').value = d; }
  showSection('auditoria');
  let n = 0;
  const t = setInterval(() => {
    const u = $('audit-usuario'), ev = $('audit-evento');
    if ((u && [...u.options].some((o) => o.value === uid)) || ++n > 40) {
      clearInterval(t);
      if (u) u.value = uid;
      if (ev && [...ev.options].some((o) => o.value === 'ver_ficha')) ev.value = 'ver_ficha';
      if (typeof renderAuditoria === 'function') renderAuditoria();
    }
  }, 250);
}

// =============================================================
// 7. Matrícula — consulta opcional
// =============================================================
function prepararMatriculaImovel(im) {
  const box = $('imovel-matricula-conferencia');
  if (!box) return;
  const mc = (im && im.matriculaConferida) || null;
  box.dataset.antes = mc ? JSON.stringify(mc) : '';
  box.innerHTML = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;margin:-4px 0 12px;">
    <a href="https://registradores.onr.org.br/" target="_blank" rel="noopener">🔎 Consultar a matrícula (ONR — Registro de Imóveis) ↗</a>
    ${isCorretor() ? (mc ? '<span style="color:#166534;">📜 Matrícula conferida pela imobiliária</span>' : '')
      : `<label class="toggle-row" style="cursor:pointer;margin:0;"><input type="checkbox" id="imovel-matricula-ok" ${mc ? 'checked' : ''}>
          <span>📜 Matrícula conferida (proprietário confere com quem anuncia)</span></label>
         ${mc ? `<span class="muted">por ${_escP(mc.porNome || '')} em ${_escP(new Date(mc.em).toLocaleDateString('pt-BR'))}</span>` : ''}`}
  </div>`;
}
// saveImovel: devolve o campo só para a equipe (o corretor não marca conferência)
function lerMatriculaConferida() {
  const box = $('imovel-matricula-conferencia'), chk = $('imovel-matricula-ok');
  if (!box || !chk || isCorretor()) return {};
  const antes = box.dataset.antes ? JSON.parse(box.dataset.antes) : null;
  if (chk.checked) return { matriculaConferida: antes || { em: new Date().toISOString(), ..._quem() } };
  return antes ? { matriculaConferida: null } : {};
}

window.renderCardProtecao = renderCardProtecao;
window.salvarProtecao = salvarProtecao;
window.restaurarContratoPadrao = restaurarContratoPadrao;
window.confirmarCreciNaAprovacao = confirmarCreciNaAprovacao;
window.conferirCreciDepois = conferirCreciDepois;
window.enviarContratoParceria = enviarContratoParceria;
window.marcarContratoAssinado = marcarContratoAssinado;
window.espelharContratoNoCorretor = espelharContratoNoCorretor;
window.sincronizarContratosParceria = sincronizarContratosParceria;
window.celulaProtecaoCorretor = celulaProtecaoCorretor;
window.botoesProtecaoCorretor = botoesProtecaoCorretor;
window.verificarContratoCorretor = verificarContratoCorretor;
window.abrirRegistroCliente = abrirRegistroCliente;
window.salvarRegistroCliente = salvarRegistroCliente;
window.loadMeusRegistros = loadMeusRegistros;
window.loadRegistrosClientes = loadRegistrosClientes;
window.analisarRegistroCliente = analisarRegistroCliente;
window.abrirIdentificarLead = abrirIdentificarLead;
window.salvarIdentificacaoLead = salvarIdentificacaoLead;
window.registrarFichaAberta = registrarFichaAberta;
window.alertasProtecao = alertasProtecao;
window.abrirAuditoriaFichas = abrirAuditoriaFichas;
window.prepararMatriculaImovel = prepararMatriculaImovel;
window.lerMatriculaConferida = lerMatriculaConferida;
window.getProtecao = getProtecao;
