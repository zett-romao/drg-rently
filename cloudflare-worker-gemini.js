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
  'https://rently.dev.br',      // domínio próprio (2026-10)
  'https://www.rently.dev.br',
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

// Prompt DOCUMENTO_PESSOA (v1 — usado quando body.modo === 'documento_pessoa'):
// Extrai dados pessoais de RG, CPF, CNH, Carteira de Trabalho ou comprovante
// de residência para preencher um cadastro de pessoa (Locador, Locatário,
// Comprador). Pode ser PF ou PJ (CNPJ, Contrato Social, Cartão CNPJ).
const PROMPT_DOCUMENTO_PESSOA = `Você é um assistente especialista em extrair dados de documentos pessoais brasileiros para preencher cadastros.

Analise a imagem/PDF enviado. Pode ser um destes tipos:
- RG (Registro Geral) frente e/ou verso
- CNH (Carteira Nacional de Habilitação)
- CPF (cartão do CPF ou comprovante)
- Carteira de Trabalho (CTPS)
- Comprovante de residência (conta de luz, água, telefone, contrato)
- Cartão CNPJ ou Contrato Social (pra Pessoa Jurídica)
- Selfie com documento (foto da pessoa segurando o RG/CNH)

Extraia o MÁXIMO de dados possível e devolva APENAS um JSON puro (sem markdown, sem texto extra) neste formato:

{
  "tipo_pessoa": "PF" ou "PJ" ou null,
  "tipo_documento_detectado": "RG" | "CNH" | "CPF" | "CTPS" | "comprovante_residencia" | "cartao_cnpj" | "contrato_social" | "outro" ou null,
  "nome": <nome completo da pessoa (PF) ou razão social (PJ) ou null>,
  "documento": <CPF apenas dígitos (PF) ou CNPJ apenas dígitos (PJ) ou null>,
  "rg": <número do RG com órgão expedidor se houver, ex: "12.345.678-9 SSP/SP" ou null>,
  "nascimento": <data no formato "YYYY-MM-DD" ou null>,
  "estado_civil": <"solteiro" | "casado" | "divorciado" | "viuvo" | "uniao_estavel" ou null>,
  "profissao": <profissão / ocupação se mencionada ou null>,
  "nacionalidade": <ex: "Brasileira" ou null>,
  "email": <e-mail ou null>,
  "telefone": <telefone apenas dígitos com DDD ou null>,
  "endereco": {
    "cep": <CEP apenas dígitos ou null>,
    "logradouro": <rua/avenida/travessa + nome completo ou null>,
    "numero": <número ou null>,
    "complemento": <apto, bloco, etc. ou null>,
    "bairro": <bairro ou null>,
    "cidade": <cidade ou null>,
    "uf": <sigla estado em maiúsculas, ex: "SP" ou null>
  },
  "campos_confianca": {
    "nome": <"alta" | "media" | "baixa">,
    "documento": <"alta" | "media" | "baixa">,
    "rg": <"alta" | "media" | "baixa">,
    "endereco": <"alta" | "media" | "baixa">
  },
  "observacoes": <string com avisos importantes pro operador, ou null. Ex: "RG ilegível, confirme manualmente" ou "Foto de tela, qualidade baixa">
}

REGRAS CRÍTICAS:
- NUNCA invente dados. Se não conseguir ler claramente, retorne null pro campo.
- CPF e CNPJ: retornar APENAS os dígitos (sem pontos, traços ou barras).
- Telefone: apenas dígitos com DDD (ex: "11987654321").
- Nascimento: SEMPRE no formato "YYYY-MM-DD" (ex: "1985-03-14").
- Se o documento for um comprovante de residência, foque em extrair o ENDEREÇO e o NOME do titular.
- Se for cartão CNPJ ou contrato social, tipo_pessoa = "PJ" e nome = razão social.
- Confidence "alta" = li claramente, "media" = li mas com dúvida, "baixa" = chutei pelo contexto.

NÃO inclua nenhuma explicação fora do JSON. Apenas o objeto JSON.`;

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

// Prompt ANUNCIO (v1 — usado quando body.modo === 'anuncio'):
// Gerador de anúncios. Recebe as fotos (já reduzidas no navegador), os dados do
// imóvel e os pontos da região (OpenStreetMap, com distância calculada no app) e
// devolve título, descrição, curadoria das fotos e sugestão de relevância.
const PROMPT_ANUNCIO = `Você é redator sênior de anúncios imobiliários no Brasil e editor de fotografia de imóveis. Seu trabalho vai para os portais (ZAP, Viva Real, OLX, Imovelweb, Chaves na Mão) e para o site da imobiliária.

Você recebe:
1. DADOS do imóvel (JSON abaixo) — a única fonte de fatos sobre o imóvel.
2. PONTOS DA REGIÃO — lista real (OpenStreetMap) com distância aproximada em linha reta, já calculada.
3. FOTOS numeradas ("Foto 0", "Foto 1"…), na ordem em que o corretor subiu.

REGRAS DE OURO (não negociáveis):
- NUNCA invente característica. Só afirme o que está nos DADOS ou o que aparece com clareza nas fotos (ex.: piscina visível). Na dúvida, não cite.
- NUNCA invente ponto da região, nome de escola, estação ou distância. Use só a lista PONTOS DA REGIÃO; se ela vier vazia, fale da região só com o que estiver nos DADOS (bairro/cidade) e sem citar estabelecimentos.
- Distâncias: arredonde ("cerca de 300 m", "a uns 5 minutos a pé" — 80 m por minuto). Elas são aproximadas; nunca diga "em frente" ou "ao lado" se a distância for maior que 100 m.
- Não escreva preço, telefone, e-mail, site, WhatsApp nem endereço com número no texto (os portais têm campo próprio e reprovam contato na descrição).
- Respeite PRIVACIDADE dos DADOS: se "mostrarBairro" for false, não cite bairro, rua nem pontos da região. Se "mostrarValor" for false, não cite valores de condomínio/IPTU.
- Proibido linguagem discriminatória ou que restrinja público (gênero, estado civil, filhos, religião, origem). Pode dizer para quem o imóvel é prático ("bom para quem trabalha de casa"), nunca quem não pode.
- Português do Brasil, correto, sem CAIXA ALTA, sem excesso de exclamação, sem clichês vazios ("oportunidade única", "não perca", "imperdível").

TÍTULO (campo "titulo"): 45 a 70 caracteres. Formato que performa nos portais: tipo + principal diferencial + bairro (se puder mostrar). Ex.: "Apartamento 2 quartos com varanda gourmet na Vila Mariana". Sem emoji, sem ponto final.

DESCRIÇÃO (campo "descricao"): 900 a 1.600 caracteres, 4 a 6 parágrafos curtos separados por linha em branco ("\\n\\n"):
  1) gancho com o que o imóvel tem de melhor;
  2) ambientes e acabamento (metragem, quartos, suítes, vagas, andar, mobília — o que houver);
  3) condomínio/lazer/segurança (só se houver nos DADOS ou nas fotos);
  4) localização e rotina (use PONTOS DA REGIÃO);
  5) condições (mobiliado, aceita pet…) e convite para agendar visita. Financiamento e FGTS SÓ se DADOS.aceitaFinanciamento / DADOS.permiteFGTS vierem "sim" — em locação, nunca. Permuta SÓ se DADOS.aceitaPermuta vier "sim" (cite DADOS.permutaObs se houver); se vier "nao", não mencione permuta.
Tom pedido em DADOS.tom; público em DADOS.publico (se houver).

FOTOS (campo "fotos", um item para CADA foto recebida, mesmo índice):
- "ambiente": sala, cozinha, quarto, suíte, banheiro, área de serviço, varanda, fachada, área comum, piscina, garagem, vista, planta, outro.
- "legenda": até 60 caracteres, descritiva ("Sala integrada com a varanda").
- "nota": 0 a 10 (nitidez, luz, enquadramento, horizonte, o quanto vende o imóvel).
- "usar": false quando borrada, muito escura sem salvação, repetida (quase igual a outra melhor), de lado/cortada sem valor, ou com problema de privacidade. Explique em "motivoDescarte".
- "privacidade": descreva se aparecem rostos, pessoas, placa de carro legível, documentos, fotos de família, nome em correspondência — senão null.
- "ajustes": correção HONESTA de exposição e cor (o app aplica; nada de alterar o imóvel):
    "brilho" -40 a 40 (positivo clareia), "contraste" -30 a 30, "saturacao" -30 a 30, "temperatura" -30 a 30 (positivo esquenta/tira o azul), "rotacao" 0, 90, 180 ou 270 (sentido horário; só se a foto estiver claramente de lado ou de cabeça para baixo).
    Foto já boa = tudo 0. Não exagere: cor real das paredes e do piso tem de continuar a mesma.
"ordemFotos": índices das fotos com usar=true, na melhor ordem de anúncio. A primeira é a CAPA: a foto mais impactante, horizontal e bem iluminada (normalmente sala, fachada ou área de lazer; nunca banheiro, garagem ou planta). Depois siga um tour lógico: sala → cozinha → quartos → banheiros → área de serviço → área externa/lazer → fachada/vista.

RELEVÂNCIA (campo "relevanciaSugerida"): os portais vendem níveis de exposição — "padrao", "destaque", "super" (super destaque) ou "premium" (vitrine/topo). Sugira o nível que compensa para ESTE anúncio considerando completude, qualidade das fotos e apelo do imóvel (lazer, localização, tamanho, valor). Anúncio fraco não vira bom com destaque: se faltar foto ou informação, sugira "padrao" e diga o que melhorar. Justifique em uma frase em "justificativaRelevancia".

Responda APENAS com JSON válido, sem markdown:
{
  "titulo": string,
  "chamadaCurta": string (até 120 caracteres, para redes sociais/WhatsApp, pode ter 1 emoji),
  "descricao": string,
  "destaques": [string] (4 a 8 itens curtos, ex.: "Suíte com closet"),
  "pontosRegiao": [string] (até 6 itens, ex.: "Estação Santa Cruz do metrô a cerca de 600 m"),
  "tags": [string] (até 10, minúsculas, ex.: "varanda gourmet"),
  "fotos": [{ "indice": int, "ambiente": string, "legenda": string, "nota": number, "usar": bool, "motivoDescarte": string|null, "privacidade": string|null, "ajustes": { "brilho": int, "contraste": int, "saturacao": int, "temperatura": int, "rotacao": int } }],
  "ordemFotos": [int],
  "relevanciaSugerida": "padrao"|"destaque"|"super"|"premium",
  "justificativaRelevancia": string,
  "notaAnuncio": int (0 a 100 — qualidade do anúncio como ficou),
  "informacoesFaltando": [string] (o que, se preenchido, melhora o anúncio: "valor do condomínio", "foto da fachada", "vídeo"…),
  "alertas": [string] (riscos: privacidade nas fotos, dado incoerente entre DADOS e fotos, etc.)
}`;

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
    if (modo === 'anuncio') return gerarAnuncio(payload, env, origin);
    if (modo === 'imovel') return cadastrarImovel(payload, env, origin);
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
    } else if (modo === 'documento_pessoa') {
      promptFinal = PROMPT_DOCUMENTO_PESSOA;
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

// -------------------------------------------------------------
// Modo "anuncio" — várias fotos + dados + pontos da região
// -------------------------------------------------------------
const ANUNCIO_MAX_FOTOS = 24;
const ANUNCIO_MAX_BYTES = 15 * 1024 * 1024;

function respostaJson(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

async function gerarAnuncio(payload, env, origin) {
  const imagens = Array.isArray(payload.imagens) ? payload.imagens : [];
  const dados = payload.dados && typeof payload.dados === 'object' ? payload.dados : {};
  const pontos = Array.isArray(payload.pontosRegiao) ? payload.pontosRegiao.slice(0, 40) : [];

  if (imagens.length > ANUNCIO_MAX_FOTOS) {
    return respostaJson({ error: `Máximo de ${ANUNCIO_MAX_FOTOS} fotos por análise.` }, 400, origin);
  }
  let total = 0;
  for (const im of imagens) {
    if (!im || typeof im.data !== 'string' || !/^image\//.test(im.mimeType || '')) {
      return respostaJson({ error: 'Foto inválida no envio (esperado { data, mimeType: image/* }).' }, 400, origin);
    }
    total += (im.data.length * 3) / 4;
  }
  if (total > ANUNCIO_MAX_BYTES) {
    return respostaJson({ error: 'Fotos somam mais de 15MB — reduza a quantidade.' }, 413, origin);
  }

  const contexto = `DADOS DO IMÓVEL:\n${JSON.stringify(dados, null, 2)}\n\nPONTOS DA REGIÃO (${pontos.length}):\n${
    pontos.length ? pontos.map(p => `- ${p}`).join('\n') : '(nenhum — não cite estabelecimentos)'
  }\n\nFOTOS RECEBIDAS: ${imagens.length}${imagens.length ? '' : ' (sem fotos: devolva "fotos": [] e "ordemFotos": [])'}`;

  const parts = [{ text: PROMPT_ANUNCIO }, { text: contexto }];
  imagens.forEach((im, i) => {
    parts.push({ text: `Foto ${i}:` });
    parts.push({ inline_data: { mime_type: im.mimeType, data: im.data } });
  });

  const requestBody = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7,
      maxOutputTokens: 16384,
      thinkingConfig: { thinkingBudget: 2048 },
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
      return respostaJson({ error: data?.error?.message || 'Erro no Gemini', details: data }, geminiRes.status, origin);
    }
    const cand = data?.candidates?.[0];
    const text = (cand?.content?.parts || []).map(p => p.text || '').join('');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const motivo = cand?.finishReason === 'MAX_TOKENS' ? ' (resposta cortada — tente com menos fotos)' : '';
      return respostaJson({ error: 'Resposta da IA não é JSON válido' + motivo, raw: text.slice(0, 2000) }, 500, origin);
    }
    return respostaJson({ success: true, data: parsed }, 200, origin);
  } catch (err) {
    return respostaJson({ error: 'Falha ao chamar Gemini: ' + err.message }, 500, origin);
  }
}

// -------------------------------------------------------------
// Modo "imovel" — CADASTRO COM IA (17/10/2026, pedido do dono: "subir txt, print de tela,
// imagem e pdf com a descrição do imóvel e a IA gera o anúncio inteiro")
// Recebe arquivos (imagens, PDFs, textos) + texto colado e devolve os campos do formulário
// do imóvel, o proprietário encontrado, o anúncio (título/descrição/tags) e o que é cada arquivo.
// -------------------------------------------------------------
const IMOVEL_MAX_ARQUIVOS = 20;
const IMOVEL_MAX_BYTES = 20 * 1024 * 1024;

const PROMPT_IMOVEL = `Você é corretor de imóveis sênior e redator de anúncios no Brasil. A imobiliária vai cadastrar um imóvel no sistema e mandou o material que tem: prints de anúncios (portais, WhatsApp, Instagram), fotos do imóvel, PDFs (ficha, matrícula, IPTU, folheto, contrato) e textos soltos.

TAREFA 1 — EXTRAIR os dados do imóvel para o formulário.
- Use SOMENTE o que estiver no material. NUNCA invente. Campo sem informação = null.
- Se fontes divergirem (ex.: print diz 3 quartos e PDF diz 2), use a mais confiável (documento > anúncio > texto solto) e registre em "conflitos".
- Valores em reais como número (1250000, 3500.5). "R$ 1,2 mi" = 1200000. Aluguel é mensal.
- Áreas em m² como número. "andar" é texto ("5", "térreo", "cobertura").
- "tipo": "residencial" ou "comercial". "subtipo": apartamento | casa | sobrado | kitnet | sala | loja | galpao | terreno | outro.
- "finalidade": "venda" | "locacao" | "ambos" (venda e aluguel citados = "ambos").
- "mobiliado": "sim" | "parcial" | "nao". "aceitaFinanciamento", "permiteFGTS", "aceitaPermuta": "sim" | "nao" | null.
- "matricula": número da matrícula do registro de imóveis; "iptu": número da inscrição/IPTU (não o valor).
- Endereço: separe logradouro, número, complemento, bairro, cidade, UF (2 letras) e CEP (8 dígitos sem traço).
- "apelido": identificação interna curta para a equipe achar o imóvel (ex.: "Apto 52 — Ed. Solar, Alphaville").
- "obs": informações internas úteis que NÃO devem ir ao anúncio (ex.: chave na portaria, horário de visita, nome do zelador). Sem dados pessoais do proprietário aqui.

TAREFA 2 — PROPRIETÁRIO (vendedor/locador), se aparecer no material: nome, telefone (só dígitos, com DDD), e-mail, CPF/CNPJ (só dígitos), "tipo" ("PF" pessoa física ou "PJ" empresa). Senão null. (Esses dados ficam no cadastro interno; NUNCA no anúncio.)
- NÃO confunda proprietário com corretor: quem aparece com CRECI, como "corretor", "consultor", "agente" ou em nome de imobiliária é CORRETOR (TAREFA 2B), não proprietário. Na dúvida, não ponha como proprietário.

TAREFA 2B — CORRETORES que aparecem no material (anunciante de portal, assinatura de ficha, cartão, conversa): para cada pessoa diferente, nome, CRECI (como escrito, ex.: "123456-F"), telefone (só dígitos, com DDD), e-mail e a imobiliária dele. Não repita a mesma pessoa. Sem corretor = []. (Cadastro interno; NUNCA no anúncio.)

TAREFA 3 — ANÚNCIO para portais e site, com as mesmas regras de ouro:
- Só fatos do material; nada de inventar característica, ponto da região ou distância.
- PROIBIDO SUPOR: não escreva sobre iluminação, ventilação, "arejado", acabamento, piso, estado de conservação, vista, sol da manhã, silêncio, "bem distribuído", "espaçoso", cozinha ou banheiros — nem qualquer adjetivo sobre um ambiente — se o material não disser isso. Cada frase tem de vir de um fato do material. Material curto = descrição curta; NUNCA encha linguiça.
- PROIBIDO no título e na descrição: preço, telefone, e-mail, site, link, @perfil, WhatsApp, nome de corretor ou de outra imobiliária, endereço com número, nome do prédio só se o material citar.
- Sem linguagem discriminatória, sem CAIXA ALTA, sem clichês ("imperdível", "oportunidade", "excelente oportunidade", "não perca", "sonho", "privilegiado" sem fato que sustente).
- "titulo": 45 a 70 caracteres, tipo + principal diferencial + bairro (se houver). Sem emoji, sem ponto final.
- "descricao": de 350 a 1.500 caracteres conforme a quantidade de fatos (pouco material = perto de 350), 2 a 5 parágrafos separados por linha em branco: destaque principal; ambientes (só os citados); condomínio/lazer (se houver); localização (só bairro/cidade do material); condições e convite para visita. Financiamento/FGTS/permuta só se o material disser.
- "tags": até 10, minúsculas ("varanda gourmet", "piscina"). "destaques": 4 a 8 itens curtos.

TAREFA 4 — CLASSIFICAR cada ARQUIVO recebido (mesmo índice): "foto_imovel" (foto real de um ambiente/fachada, que serve para a galeria), "print_anuncio" (captura de tela de anúncio/conversa), "documento" (matrícula, IPTU, ficha, contrato), "texto", "outro". Para foto_imovel diga o "ambiente" (sala, cozinha, quarto, banheiro, fachada, área de lazer, vista…). Se aparecerem pessoas, placa de carro ou documentos numa foto, marque "privacidade": true.

Responda APENAS com JSON válido, sem markdown:
{
  "campos": {
    "apelido": string|null, "tipo": string|null, "subtipo": string|null, "finalidade": string|null,
    "endereco": { "cep": string|null, "logradouro": string|null, "numero": string|null, "complemento": string|null, "bairro": string|null, "cidade": string|null, "uf": string|null },
    "areaUtil": number|null, "areaTotal": number|null, "andar": string|null,
    "quartos": int|null, "suites": int|null, "banheiros": int|null, "vagas": int|null, "mobiliado": string|null,
    "vagasCobertas": int|null, "vagasDescobertas": int|null,
    "areaTerreno": number|null (m² do TERRENO/lote, não da construção), "medidasTerreno": string|null (ex.: "10 x 30 m"),
    "padrao": "economico"|"medio"|"medio_alto"|"alto"|"luxo"|null,
    "estadoConservacao": "na_planta"|"em_construcao"|"novo"|"otimo"|"bom"|"regular"|"reformado"|"precisa_reforma"|null,
    "anoConstrucao": int|null, "empreendimento": string|null (nome do condomínio/empreendimento/edifício),
    "caracteristicas": [string] (SÓ itens copiados exatamente da LISTA DE CARACTERÍSTICAS enviada, no formato "Grupo › Item"; marque apenas o que o material mostra ou diz),
    "valorVenda": number|null, "aluguelSugerido": number|null, "valorCondominio": number|null, "valorIPTU": number|null,
    "aceitaFinanciamento": string|null, "permiteFGTS": string|null, "aceitaPermuta": string|null, "permutaObs": string|null,
    "matricula": string|null, "iptu": string|null, "videoUrl": string|null, "tourUrl": string|null, "obs": string|null
  },
  "proprietario": { "nome": string|null, "telefone": string|null, "email": string|null, "documento": string|null, "tipo": "PF"|"PJ"|null } | null,
  "corretores": [{ "nome": string, "creci": string|null, "telefone": string|null, "email": string|null, "imobiliaria": string|null }],
  "anuncio": { "titulo": string, "descricao": string, "tags": [string], "destaques": [string] },
  "arquivos": [{ "indice": int, "tipo": string, "ambiente": string|null, "privacidade": bool }],
  "incertos": [string] (nomes dos campos acima em que você tem dúvida),
  "conflitos": [string],
  "resumo": string (1 a 2 frases: o que é o imóvel e de onde vieram os dados)
}`;

async function cadastrarImovel(payload, env, origin) {
  const arquivos = Array.isArray(payload.arquivos) ? payload.arquivos : [];
  const texto = typeof payload.texto === 'string' ? payload.texto.slice(0, 20000) : '';
  if (!arquivos.length && !texto.trim()) return respostaJson({ error: 'Envie pelo menos um arquivo ou cole um texto.' }, 400, origin);
  if (arquivos.length > IMOVEL_MAX_ARQUIVOS) return respostaJson({ error: `Máximo de ${IMOVEL_MAX_ARQUIVOS} arquivos por vez.` }, 400, origin);

  let total = 0;
  const parts = [{ text: PROMPT_IMOVEL }];
  // ✅ 29/10/2026: catálogo de características do cadastro (padrão + criadas pela imobiliária)
  const catalogo = Array.isArray(payload.catalogoCaracteristicas) ? payload.catalogoCaracteristicas.filter((x) => typeof x === 'string').slice(0, 600) : [];
  if (catalogo.length) parts.push({ text: `LISTA DE CARACTERÍSTICAS (use exatamente estes textos em "caracteristicas"):\n${catalogo.map((x) => x.slice(0, 80)).join('\n')}` });
  if (texto.trim()) parts.push({ text: `TEXTO COLADO PELA IMOBILIÁRIA:\n${texto}` });
  arquivos.forEach((a, i) => {
    if (!a || typeof a.mimeType !== 'string') return;
    if (a.mimeType.startsWith('text/')) {
      parts.push({ text: `ARQUIVO ${i} (texto, "${String(a.nome || '').slice(0, 80)}"):\n${String(a.texto || '').slice(0, 20000)}` });
      return;
    }
    if (!/^image\//.test(a.mimeType) && a.mimeType !== 'application/pdf') return;
    if (typeof a.data !== 'string') return;
    total += (a.data.length * 3) / 4;
    parts.push({ text: `ARQUIVO ${i} (${a.mimeType === 'application/pdf' ? 'PDF' : 'imagem'}, "${String(a.nome || '').slice(0, 80)}"):` });
    parts.push({ inline_data: { mime_type: a.mimeType, data: a.data } });
  });
  if (total > IMOVEL_MAX_BYTES) return respostaJson({ error: 'Os arquivos somam mais de 20 MB — envie menos ou menores.' }, 413, origin);
  parts.push({ text: `TOTAL DE ARQUIVOS: ${arquivos.length} (classifique todos em "arquivos").` });

  const requestBody = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 12288, thinkingConfig: { thinkingBudget: 2048 } },
  };
  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
    const r = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
    const data = await r.json();
    if (!r.ok) return respostaJson({ error: data?.error?.message || 'Erro no Gemini' }, r.status, origin);
    const cand = data?.candidates?.[0];
    const txt = (cand?.content?.parts || []).map((p) => p.text || '').join('');
    let parsed;
    try { parsed = JSON.parse(txt); }
    catch (_) {
      const motivo = cand?.finishReason === 'MAX_TOKENS' ? ' (resposta cortada — envie menos arquivos)' : '';
      return respostaJson({ error: 'Resposta da IA não é JSON válido' + motivo }, 500, origin);
    }
    return respostaJson({ success: true, data: parsed }, 200, origin);
  } catch (err) {
    return respostaJson({ error: 'Falha ao chamar Gemini: ' + err.message }, 500, origin);
  }
}
