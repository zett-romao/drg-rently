// =============================================================
// DRG-Rently — Cloudflare Worker proxy para Gemini Vision
//
// Extrai dados de boletos / faturas / contas a pagar via Gemini Vision.
// Recebe um arquivo (PDF/imagem) em base64 e retorna JSON estruturado.
//
// COMO INSTALAR (passo a passo):
//
// 1. Acesse https://dash.cloudflare.com → Workers & Pages
// 2. Clique em "Create Application" → "Create Worker"
// 3. Nome sugerido: "drg-rently-gemini"
// 4. Clique em "Deploy" pra criar com o Worker padrão
// 5. Depois clique em "Edit code" → cole TODO o código abaixo
// 6. Salve e faça "Deploy"
//
// 7. Configure o secret GEMINI_API_KEY:
//    Settings → Variables and Secrets → Add → tipo "Secret"
//    Name: GEMINI_API_KEY
//    Value: a chave que você gerou em aistudio.google.com/apikey
//    Save
//
// 8. Pegue a URL do Worker (algo como
//    https://drg-rently-gemini.SEU-USUARIO.workers.dev)
//    e cole em:
//    DRG-Rently → Configurações → URL do Worker (Gemini Vision)
//
// 9. Teste num balancete clicando em "🤖 Ler de boleto".
// =============================================================

const ALLOWED_ORIGINS = [
  'https://zett-romao.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const GEMINI_MODEL = 'gemini-2.5-flash';

// Prompt LEGADO (mantido pra compat com chamadas antigas que usem prompt explícito):
const PROMPT_BOLETO = `Você está analisando um boleto bancário, fatura, recibo ou conta a pagar (condomínio, IPTU, água, luz, gás, manutenção, etc.).

Extraia as informações abaixo e responda APENAS com JSON válido, sem markdown nem texto fora do JSON:

{
  "valor": <número decimal em reais, ex: 320.50 — usar ponto como separador decimal>,
  "vencimento": <data no formato "YYYY-MM-DD" ou null>,
  "competencia": <mês de referência no formato "YYYY-MM" ou null — ex: "2026-05" para maio/2026>,
  "beneficiario": <nome do beneficiário/credor (string) ou null>,
  "documento_beneficiario": <CNPJ ou CPF do beneficiário com formatação ou null>,
  "linha_digitavel": <linha digitável completa do boleto (string) ou null>,
  "categoria_sugerida": <um destes valores: "iptu", "condominio", "agua", "luz", "gas", "internet", "manutencao", "seguro", "outros">,
  "descricao": <descrição curta do que é, ex: "Condomínio maio/2026", "IPTU 2026 - 1ª parcela" — ou null>
}

Se algum campo não for legível ou não estiver no documento, retorne null.
NÃO inclua explicações. Resposta deve ser apenas JSON puro.`;

// Prompt MULTI-COMPROVANTE (v2 — usado quando body.modo === 'multi'):
// Detecta múltiplos documentos em UM arquivo, diferencia NF/recibo vs comprovante,
// classifica entrada/saída, retorna confidence por campo.
const PROMPT_MULTI = `Você é um assistente especialista em documentos financeiros de imobiliárias.

Analise o arquivo enviado (que pode ser PDF multi-página, imagem ou foto) e identifique TODOS os documentos financeiros presentes. UM ARQUIVO PODE CONTER VÁRIOS DOCUMENTOS — você deve detectar e separar cada um.

REGRAS IMPORTANTES sobre tipos de documento:

1. **Nota Fiscal (NF)** / **Cupom Fiscal** = APENAS comprova o que foi comprado/serviço prestado. NÃO É pagamento. eh_pagamento_efetivado = false.

2. **Recibo** = analise contexto. Se for "recibo de pagamento" com data e meio (PIX/TED/dinheiro), eh_pagamento_efetivado = true. Se for "recibo provisório" ou só descritivo, false.

3. **Comprovante de PIX / TED / Transferência / Depósito** = É pagamento efetivado. eh_pagamento_efetivado = true.

4. **Boleto bancário com autenticação/protocolo de pagamento** = pagamento efetivado. true.

5. **Boleto sem comprovação de pagamento** = é só conta a pagar. false.

DIREÇÃO do fluxo (do ponto de vista da imobiliária):
- "entrada" = imobiliária RECEBEU dinheiro (aluguel, taxa, etc.)
- "saida" = imobiliária PAGOU algo (condomínio, IPTU, manutenção, repasse ao locador, etc.)
- "ambiguo" = não dá pra saber pelo documento

CONFIANÇA:
- Use confidence_score entre 0 e 1 (0=incerto, 1=muito confiante) para CADA documento detectado.
- Para campos individuais duvidosos, liste-os em "campos_duvidosos".

Responda APENAS com JSON VÁLIDO, sem markdown:

{
  "comprovantes": [
    {
      "tipo_documento": "comprovante_pagamento" | "boleto_a_pagar" | "nota_fiscal" | "cupom_fiscal" | "recibo" | "outro",
      "eh_pagamento_efetivado": true | false,
      "direcao": "entrada" | "saida" | "ambiguo",
      "valor": <número decimal em reais, ex: 2500.00>,
      "data_pagamento": <"YYYY-MM-DD" ou null>,
      "vencimento": <"YYYY-MM-DD" ou null — só para boletos>,
      "competencia": <"YYYY-MM" ou null — mês de referência>,
      "pagador_nome": <string ou null — quem pagou (no caso de entradas)>,
      "pagador_documento": <CPF/CNPJ formatado ou null>,
      "beneficiario": <string ou null — quem recebeu (no caso de saídas)>,
      "documento_beneficiario": <CPF/CNPJ formatado ou null>,
      "metodo": "pix" | "ted" | "doc" | "boleto" | "dinheiro" | "cartao" | null,
      "linha_digitavel": <string ou null>,
      "categoria_sugerida": "aluguel" | "iptu" | "condominio" | "agua" | "luz" | "gas" | "internet" | "manutencao" | "seguro" | "taxa_administracao" | "repasse_locador" | "deposito_caucao" | "multa_atraso" | "outros",
      "descricao": <string curta descrevendo o documento>,
      "confidence_score": <número entre 0 e 1>,
      "campos_duvidosos": [<lista de strings com nomes dos campos com baixa confiança>]
    }
  ],
  "observacoes_gerais": <string ou null — observações relevantes sobre o conjunto, ex: "NF sem comprovante anexado">
}

Se NENHUM documento financeiro for identificado, retorne {"comprovantes": [], "observacoes_gerais": "Nenhum documento financeiro detectado."}.

NÃO inclua explicações fora do JSON.`;

// Prompt CONTRATO (v1 — usado quando body.modo === 'contrato'):
// Extrai dados de contratos imobiliários (locação ou venda) para preencher o app.
// Detecta múltiplos locadores/locatários/fiadores (coautoria).
const PROMPT_CONTRATO = `Você é um assistente especialista em contratos imobiliários brasileiros.

Analise o documento enviado (PDF, imagem, ou texto/HTML de DOCX). Detecte se é um contrato de LOCAÇÃO, VENDA (compra e venda) ou OUTRO. Extraia TODOS os dados das partes, do imóvel, dos valores, prazos, garantias e comissões.

REGRAS CRÍTICAS:
- NUNCA invente dados. Se um campo não estiver explícito no contrato, retorne null.
- Datas SEMPRE no formato "YYYY-MM-DD".
- CPF/CNPJ: retorne em "documento" SÓ DÍGITOS (sem pontos/hífens/barras). Em "documento_formatado" retorne com formatação visual.
- Valores monetários: número decimal com ponto (ex: 2500.00, 450000.50). Nunca string com "R$".
- Telefones: só dígitos com DDD (11 dígitos celular, 10 fixos).
- CEP: só dígitos (8 dígitos).
- UF: 2 letras maiúsculas (SP, RJ, MG...).
- Quando houver MAIS DE UM locador, locatário, fiador, comprador ou vendedor (cônjuges, coproprietários), retorne todos no array.
- Cada bloco tem "confidence_score" 0-1 e "campos_duvidosos" (array de nomes de campos com baixa confiança).

Responda APENAS com JSON VÁLIDO, sem markdown:

{
  "tipo_operacao": "locacao" | "venda" | "outro",
  "confidence_global": <0 a 1>,

  "locadores": [
    {
      "tipo_pessoa": "PF" | "PJ",
      "nome": <string>,
      "documento": <só dígitos do CPF/CNPJ>,
      "documento_formatado": <CPF/CNPJ com pontos/hífens>,
      "rg": <string ou null>,
      "nascimento": <"YYYY-MM-DD" ou null>,
      "estado_civil": "solteiro" | "casado" | "divorciado" | "viuvo" | "uniao_estavel" | null,
      "profissao": <string ou null>,
      "nacionalidade": <string ou null — default "brasileiro(a)">,
      "email": <string ou null>,
      "telefone": <só dígitos ou null>,
      "endereco": {
        "cep": <8 dígitos ou null>,
        "logradouro": <string ou null>,
        "numero": <string ou null>,
        "complemento": <string ou null>,
        "bairro": <string ou null>,
        "cidade": <string ou null>,
        "uf": <2 letras ou null>
      },
      "confidence_score": <0 a 1>,
      "campos_duvidosos": []
    }
  ],

  "locatarios": [ /* mesma estrutura de locador (só se tipo_operacao = locacao) */ ],

  "vendedores": [ /* mesma estrutura de locador (só se tipo_operacao = venda) */ ],

  "compradores": [
    {
      /* mesma estrutura base, mais: */
      "forma_pagamento": "a_vista" | "financiamento" | "permuta" | "misto" | null,
      "renda": <número ou null>,
      "banco_financeira": <string ou null>,
      "valor_entrada": <número ou null>
    }
  ],

  "imovel": {
    "apelido_sugerido": <string curta tipo "Apto 302 Ed. Solar">,
    "tipo": "apartamento" | "casa" | "comercial" | "terreno" | "rural" | "outro" | null,
    "finalidade": "locacao" | "venda" | "ambos" | null,
    "endereco": { "cep": ..., "logradouro": ..., "numero": ..., "complemento": ..., "bairro": ..., "cidade": ..., "uf": ... },
    "area_util": <número em m² ou null>,
    "area_total": <número em m² ou null>,
    "andar": <string ou null>,
    "quartos": <int ou null>,
    "banheiros": <int ou null>,
    "vagas": <int ou null>,
    "mobiliado": "sim" | "nao" | "parcialmente" | null,
    "matricula": <string ou null — nº da matrícula no cartório>,
    "iptu": <string ou null — inscrição imobiliária>,
    "valor_mercado": <número ou null>,
    "aluguel_sugerido": <número ou null — só se locacao>,
    "valor_venda": <número ou null — só se venda>,
    "confidence_score": <0 a 1>,
    "campos_duvidosos": []
  },

  "contrato_locacao": {
    "prazo_meses": <int — ex: 12, 24, 30>,
    "inicio": <"YYYY-MM-DD">,
    "fim": <"YYYY-MM-DD" ou null — calculável se prazo + início>,
    "aluguel": <número decimal>,
    "dia_vencimento": <int 1-31>,
    "multa_rescisoria": <número ou null — geralmente 3x aluguel>,
    "taxa_adm": <número % ou null — geralmente 10>,
    "reajuste_indice": "IGPM" | "IPCA" | "INCC" | "INPC" | null,
    "reajuste_periodicidade": "anual" | "semestral" | null,
    "clausulas_relevantes": <string com resumo de cláusulas importantes ou null>,
    "confidence_score": <0 a 1>,
    "campos_duvidosos": []
  },

  "contrato_venda": {
    "valor": <número decimal — valor total da venda>,
    "forma_pagamento": "a_vista" | "financiamento" | "permuta" | "misto" | null,
    "entrada": <número ou null>,
    "data_aceite": <"YYYY-MM-DD" ou null>,
    "data_posse": <"YYYY-MM-DD" ou null>,
    "clausulas_relevantes": <string ou null>,
    "confidence_score": <0 a 1>,
    "campos_duvidosos": []
  },

  "garantia": {
    "tipo": "fiador" | "caucao" | "seguro_fianca" | "nenhuma",
    "fiador": {
      "nome": ..., "cpf": <só dígitos>, "rg": ..., "nascimento": ...,
      "profissao": ..., "estado_civil": ...,
      "email": ..., "telefone": ...,
      "endereco": { ... },
      "renda": <número ou null>,
      "bens": <string ou null>,
      "conjuge_nome": <string ou null>,
      "conjuge_cpf": <só dígitos ou null>
    },
    "caucao": {
      "modalidade": "dinheiro" | "imovel" | "titulo" | null,
      "data": <"YYYY-MM-DD" ou null>,
      "valor": <número ou null>,
      "banco": ..., "agencia": ..., "conta": ...,
      "bem_descricao": <string ou null>
    },
    "seguro": {
      "seguradora": ..., "apolice": ...,
      "vigencia_inicio": ..., "vigencia_fim": ...,
      "cobertura": <número ou null>,
      "premio": <número ou null>,
      "forma_pagamento": ..., "parcelas": <int ou null>
    },
    "confidence_score": <0 a 1>,
    "campos_duvidosos": []
  },

  "comissao": {
    "percentual": <número % ou null>,
    "valor_estimado": <número ou null>,
    "responsavel_pagamento": "comprador" | "vendedor" | "locador" | "locatario" | "ambos" | null,
    "confidence_score": <0 a 1>,
    "campos_duvidosos": []
  },

  "observacoes": <string ou null — anote ambiguidades, conflitos entre seções do contrato, cláusulas atípicas>
}

REGRAS por tipo_operacao:
- "locacao": preencher locadores, locatarios, imovel, contrato_locacao, garantia, comissao. Deixar vendedores=[], compradores=[], contrato_venda=null.
- "venda": preencher vendedores, compradores, imovel, contrato_venda, comissao. Deixar locadores=[], locatarios=[], contrato_locacao=null, garantia.tipo="nenhuma".
- "outro": retornar o que conseguir, mas confidence_global baixa.

NÃO inclua explicações fora do JSON. Resposta apenas JSON puro.`;

// Limites de tamanho por modo (em bytes).
// Contratos costumam ser PDFs longos (até 15 páginas); demais documentos cabem em 4 MB.
const LIMITES_POR_MODO = {
  contrato: 15 * 1024 * 1024,
  multi: 8 * 1024 * 1024,
  default: 4 * 1024 * 1024,
};

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const { fileBase64, mimeType, prompt, modo, tipoOperacaoHint } = payload;
    if (!fileBase64 || !mimeType) {
      return new Response(JSON.stringify({ error: 'Faltam campos: fileBase64, mimeType' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const maxBytes = LIMITES_POR_MODO[modo] || LIMITES_POR_MODO.default;
    const sizeBytes = (fileBase64.length * 3) / 4;
    if (sizeBytes > maxBytes) {
      const mb = (maxBytes / 1024 / 1024).toFixed(0);
      return new Response(JSON.stringify({ error: `Arquivo excede ${mb}MB para o modo "${modo || 'default'}"` }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // Escolhe o prompt:
    // - prompt customizado vindo do cliente → usa ele
    // - modo === 'contrato' → PROMPT_CONTRATO (extrai locador/locatário/imóvel/etc.)
    // - modo === 'multi' → PROMPT_MULTI (comprovantes, array)
    // - default → PROMPT_BOLETO (legado, 1 boleto por vez)
    let promptFinal;
    if (prompt) {
      promptFinal = prompt;
    } else if (modo === 'contrato') {
      promptFinal = PROMPT_CONTRATO;
      // Dica opcional do contexto da UI (botão clicado em Contratos ou Negociações).
      // O Gemini ainda pode sobrescrever se detectar outro tipo no conteúdo.
      if (tipoOperacaoHint === 'locacao' || tipoOperacaoHint === 'venda') {
        promptFinal += `\n\nCONTEXTO: o operador clicou em "Importar contrato" na seção de ${tipoOperacaoHint === 'locacao' ? 'Contratos (locação)' : 'Negociações (venda)'}. Use isso como dica se houver ambiguidade, mas confie no conteúdo do contrato se ele indicar claramente outro tipo.`;
      }
    } else if (modo === 'multi') {
      promptFinal = PROMPT_MULTI;
    } else {
      promptFinal = PROMPT_BOLETO;
    }

    const requestBody = {
      contents: [{
        role: 'user',
        parts: [
          { text: promptFinal },
          { inline_data: { mime_type: mimeType, data: fileBase64 } },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: modo === 'contrato' ? 8192 : 4096,
      },
    };

    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
      const geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await geminiRes.json();

      if (!geminiRes.ok) {
        return new Response(JSON.stringify({
          error: data?.error?.message || 'Erro no Gemini',
          details: data,
        }), {
          status: geminiRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        return new Response(JSON.stringify({
          error: 'Resposta do Gemini não é JSON válido',
          raw: text,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      return new Response(JSON.stringify({ success: true, data: parsed }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Falha ao chamar Gemini: ' + err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }
  },
};
