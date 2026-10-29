// Dados cadastrais obrigatórios de corretor e imobiliária (28/10/2026, pedido do dono):
// endereço, telefone e CPF/CNPJ. Carregado no app (index.html) e no autocadastro (parceiro.html).
//
// Campos de endereço: <div data-endereco="PREFIXO" data-oninput="func()"></div> vira
// PREFIXO-cep, -logradouro, -numero, -complemento, -bairro, -cidade, -uf (CEP preenche o resto).

const CC_UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const CC_END_OBRIG = { cep: 'CEP', logradouro: 'rua/avenida', numero: 'número', bairro: 'bairro', cidade: 'cidade', uf: 'UF' };

function _ccEl(id) { return document.getElementById(id); }
function _ccEsc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function camposEnderecoHtml(p, oninput) {
  const on = oninput ? ` oninput="${_ccEsc(oninput)}"` : '';
  const onSel = oninput ? ` onchange="${_ccEsc(oninput)}"` : '';
  return `
    <div class="form-row">
      <div class="form-group" style="max-width:170px;"><label class="required" for="${p}-cep">CEP</label>
        <input type="text" id="${p}-cep" inputmode="numeric" maxlength="9" placeholder="00000-000"
          oninput="this.value=this.value.replace(/\\D/g,'').slice(0,8).replace(/^(\\d{5})(\\d)/,'$1-$2');cepPreencherEndereco('${p}')${oninput ? ';' + _ccEsc(oninput) : ''}"></div>
      <div class="form-group" style="flex:3;"><label class="required" for="${p}-logradouro">Rua / Avenida</label><input type="text" id="${p}-logradouro" maxlength="150"${on}></div>
      <div class="form-group" style="max-width:120px;"><label class="required" for="${p}-numero">Número</label><input type="text" id="${p}-numero" maxlength="15"${on}></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label for="${p}-complemento">Complemento</label><input type="text" id="${p}-complemento" maxlength="80"${on}></div>
      <div class="form-group"><label class="required" for="${p}-bairro">Bairro</label><input type="text" id="${p}-bairro" maxlength="80"${on}></div>
      <div class="form-group"><label class="required" for="${p}-cidade">Cidade</label><input type="text" id="${p}-cidade" maxlength="80"${on}></div>
      <div class="form-group" style="max-width:90px;"><label class="required" for="${p}-uf">UF</label>
        <select id="${p}-uf"${onSel}><option value=""></option>${CC_UFS.map((u) => `<option>${u}</option>`).join('')}</select></div>
    </div>`;
}

function montarCamposEndereco(raiz) {
  (raiz || document).querySelectorAll('[data-endereco]').forEach((box) => {
    if (box.dataset.montado) return;
    box.innerHTML = camposEnderecoHtml(box.dataset.endereco, box.dataset.oninput || '');
    box.dataset.montado = '1';
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => montarCamposEndereco());
else montarCamposEndereco();

function lerEndereco(p) {
  const v = (k) => (_ccEl(`${p}-${k}`)?.value || '').trim();
  const cep = v('cep').replace(/\D/g, '');
  return {
    cep: cep ? cep.replace(/^(\d{5})(\d{3})$/, '$1-$2') : '',
    logradouro: v('logradouro'), numero: v('numero'), complemento: v('complemento'),
    bairro: v('bairro'), cidade: v('cidade'), uf: v('uf').toUpperCase(),
  };
}

function preencherEndereco(p, e) {
  e = e || {};
  ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'].forEach((k) => {
    const el = _ccEl(`${p}-${k}`);
    if (el) el.value = e[k] || '';
  });
}

// Lista do que falta (vazia = completo)
function faltaNoEndereco(e) {
  e = e || {};
  return Object.keys(CC_END_OBRIG).filter((k) => {
    const v = String(e[k] || '').trim();
    return k === 'cep' ? v.replace(/\D/g, '').length !== 8 : !v;
  }).map((k) => CC_END_OBRIG[k]);
}

function fmtEndereco(e) {
  if (!e) return '';
  const linha = [e.logradouro, e.numero].filter(Boolean).join(', ');
  return [linha, e.complemento, e.bairro, [e.cidade, e.uf].filter(Boolean).join('/'), e.cep ? `CEP ${e.cep}` : '']
    .filter(Boolean).join(', ');
}

const _ccCepFeito = {};
async function cepPreencherEndereco(p) {
  const cep = (_ccEl(`${p}-cep`)?.value || '').replace(/\D/g, '');
  if (cep.length !== 8 || _ccCepFeito[p] === cep) return;
  _ccCepFeito[p] = cep;
  try {
    const d = await (await fetch(`https://viacep.com.br/ws/${cep}/json/`)).json();
    if (!d || d.erro) return;
    const por = (k, v) => { const el = _ccEl(`${p}-${k}`); if (el && v && !el.value.trim()) { el.value = v; el.dispatchEvent(new Event('input')); } };
    por('logradouro', d.logradouro); por('bairro', d.bairro); por('cidade', d.localidade);
    const uf = _ccEl(`${p}-uf`);
    if (uf && d.uf && !uf.value) { uf.value = d.uf; uf.dispatchEvent(new Event('change')); }
    if (!_ccEl(`${p}-numero`)?.value) _ccEl(`${p}-numero`)?.focus();
  } catch (_) { /* sem internet/ViaCEP fora: a pessoa digita */ }
}

// ---- CPF / CNPJ ----
function cpfValidoCC(c) {
  c = String(c || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}
function cnpjValidoCC(c) {
  c = String(c || '').replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((a, w, i) => a + Number(c[i]) * w, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}
function cpfCnpjValido(d) {
  const x = String(d || '').replace(/\D/g, '');
  return x.length === 11 ? cpfValidoCC(x) : x.length === 14 ? cnpjValidoCC(x) : false;
}
function fmtCpfCnpj(d) {
  const x = String(d || '').replace(/\D/g, '');
  if (x.length === 11) return x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (x.length === 14) return x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return String(d || '');
}
function mascaraCpfCnpj(el) {
  const x = el.value.replace(/\D/g, '').slice(0, 14);
  el.value = x.length <= 11
    ? x.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2')
    : x.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

// O que falta no cadastro do CORRETOR (telefone, CPF/CNPJ, endereço). Vazio = completo.
function faltaNoCadastroCorretor(c) {
  c = c || {};
  const f = [];
  if (String(c.telefone || '').replace(/\D/g, '').length < 10) f.push('telefone');
  if (!cpfCnpjValido(c.documento)) f.push('CPF/CNPJ');
  const fe = faltaNoEndereco(c.endereco);
  if (fe.length) f.push('endereço (' + fe.join(', ') + ')');
  return f;
}
