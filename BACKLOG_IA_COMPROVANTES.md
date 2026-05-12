# 📋 Backlog — IA de Leitura de Comprovantes (Locação)

**Status:** ✅ Fases 1, 2, 3 e 4 TODAS implementadas em 2026-05-13 🎉
**Solicitado em:** 2026-05-12
**Prioridade:** Alta — feature comercial chave

## ✅ Já implementado

- ✅ **Fase 1**: Worker Gemini com prompt multi-comprovante
- ✅ **Fase 2**: Modal multi-card com cards individuais editáveis
- ✅ **Fase 2**: Botão "🤖 Ler comprovante" também em Entradas
- ✅ **Fase 2**: Botão "📂 Analisar arquivo" geral no topo do balancete
- ✅ **Fase 3**: Vinculação automática do lançamento ao contrato (match valor+CPF)
- ✅ **Fase 3**: Badge visual nos cards (verde/amarelo/vermelho por confiança)
- ✅ **Fase 3**: Badge 🔗 nos lançamentos da lista quando vinculados a contrato
- ✅ **Fase 4**: Card "Apuração em tempo real" sempre atualizado

## 🔮 Refinamentos futuros (não-urgentes)

- Filtro/agrupamento do balancete por contrato (caso uma imobiliária queira ver
  consolidado de múltiplas unidades de um prédio)
- Detecção de duplicidade: avisar se o mesmo comprovante já foi lançado antes
  (comparar valor + data + pagador)
- Reconhecimento de DARF/DAS (impostos)
- OCR de cheques
- Auto-categorização baseada no histórico do tenant

---

## 🎯 Visão geral

Expandir o módulo de IA (Gemini Vision) que hoje só lê **boletos a pagar** (despesas) para que processe **TODOS os comprovantes** que o operador anexar no sistema — entradas (aluguel recebido) e saídas (despesas pagas pelo escritório).

Os valores devem **integrar automaticamente o balancete do contrato** e **apurar o líquido** (receita − despesas) em tempo real.

---

## 🧠 Requisitos importantes (ditos pelo Donizete)

### 1. Múltiplos comprovantes em UM único arquivo

> "estes comprovantes podem ir vários em um único arquivo PDF ou imagem ou foto e ele deve ser lido separadamente, mesmo que esteja somente em um arquivo"

**Implicação técnica:**
- O Gemini precisa **iterar e detectar** cada comprovante separadamente
- Retorna um **array de comprovantes**, não um objeto único
- Cada comprovante vira um lançamento individual no balancete
- Pode ser PDF multi-página OU imagem com vários recibos juntos

**Como implementar:**
- Atualizar prompt do Gemini pra retornar `{ comprovantes: [...] }` em vez de `{...}`
- Cada item do array contém: tipo, valor, beneficiário, data, etc.
- App processa array e cria N lançamentos
- Modal de revisão mostra **lista** pra operador validar todos antes de confirmar

### 2. Diferenciar Nota/Cupom/Recibo vs Comprovante de Pagamento

> "deve-se prestar atenção naquilo que é nota ou cupom fiscal ou recibo e aquilo que efetivamente é comprovante de pagamento"

**Conceitos importantes (regra de negócio):**

| Tipo | O que é | Conta no balancete? |
|---|---|---|
| **Nota Fiscal (NF)** | Documento de aquisição/serviço — comprova **o que foi comprado/contratado** | ❌ Não é pagamento — é só fatura |
| **Cupom Fiscal** | Igual NF, formato simplificado | ❌ Não é pagamento — é só fatura |
| **Recibo** | Promessa de que algo foi recebido (pode ser de venda ou pagamento) | ⚠️ Depende — analisar contexto |
| **Comprovante de pagamento** | Prova de que a transferência foi efetivada (PIX, TED, boleto pago) | ✅ Sim — gera lançamento |
| **Boleto não pago** | Conta a pagar futura | ⚠️ Pode entrar como "previsto" |

**Casos práticos:**
- ❌ Apenas a NF do serviço de manutenção → **não lança** (espera comprovante)
- ✅ NF + comprovante PIX correspondente → **lança como despesa paga**
- ✅ Boleto de condomínio + comprovante PIX → **lança como despesa paga**
- ❌ Recibo de aluguel emitido pelo escritório → **não é pagamento recebido** (é só documento)
- ✅ Comprovante PIX do locatário → **lança como entrada (aluguel recebido)**

**Como implementar:**
- Campo `tipo_documento`: `nota_fiscal` | `cupom_fiscal` | `recibo` | `comprovante_pagamento` | `boleto_a_pagar`
- Campo `eh_pagamento_efetivado`: boolean (se true, gera lançamento)
- Campo `direcao`: `entrada` | `saida` | `ambiguo`

### 3. Validação humana em caso de dúvida

> "havendo dúvida ou incerteza, o operador deverá ser consultado para validar ou editar a informação duvidosa"

**Implicação:**
- Gemini retorna um `confidence_score` (0-1) por campo
- Se confidence < 0.85 → modal de revisão **destaca o campo em amarelo**
- Operador valida/edita antes de gravar
- Sempre permitir edição manual antes de confirmar

**Casos típicos de dúvida:**
- Valor ilegível ou ambíguo
- Data não clara (DD/MM/YYYY ou MM/DD/YYYY?)
- Não identificou se é entrada ou saída
- Não conseguiu vincular a um contrato específico
- Múltiplos valores no documento (qual é o efetivo?)

---

## 🛠 Plano de implementação (4 fases)

### **Fase 1 — Worker Gemini multi-comprovante** (1h)

**Arquivo:** `cloudflare-worker-gemini.js`

**Mudanças:**
- Novo prompt que detecta **múltiplos comprovantes** em UM arquivo
- Retorna `comprovantes: [...]` (array)
- Cada item tem `tipo_documento`, `direcao`, `eh_pagamento_efetivado`, `confidence_score`
- Backwards compatible: se for 1 só, ainda retorna array de 1 item

**Novo schema de resposta:**
```json
{
  "success": true,
  "data": {
    "comprovantes": [
      {
        "tipo_documento": "comprovante_pagamento",
        "eh_pagamento_efetivado": true,
        "direcao": "entrada",
        "valor": 2500.00,
        "data_pagamento": "2026-05-10",
        "pagador_nome": "João da Silva",
        "pagador_documento": "123.456.789-00",
        "beneficiario": "D.R. Global Imóveis",
        "metodo": "pix",
        "categoria_sugerida": "aluguel",
        "confidence_score": 0.95,
        "campos_duvidosos": []
      },
      {
        "tipo_documento": "boleto_a_pagar",
        "eh_pagamento_efetivado": false,
        "direcao": "saida",
        "valor": 320.50,
        "vencimento": "2026-05-15",
        "competencia": "2026-05",
        "beneficiario": "Condomínio Edifício Solar",
        "documento_beneficiario": "12.345.678/0001-90",
        "linha_digitavel": "...",
        "categoria_sugerida": "condominio",
        "confidence_score": 0.92,
        "campos_duvidosos": []
      },
      {
        "tipo_documento": "nota_fiscal",
        "eh_pagamento_efetivado": false,
        "direcao": "saida",
        "valor": 150.00,
        "beneficiario": "Eletricista José",
        "categoria_sugerida": "manutencao",
        "confidence_score": 0.78,
        "campos_duvidosos": ["data_pagamento", "comprovante_correspondente"]
      }
    ],
    "observacoes_gerais": "Foram identificados 3 documentos. O terceiro (NF do eletricista) não tem comprovante de pagamento anexado — operador deve validar se já foi pago."
  }
}
```

### **Fase 2 — UI de revisão multi-comprovante** (1.5h)

**Onde:** Modal `modal-boleto-revisao` no `index.html`

**Mudanças:**
- Renderizar **lista de cards**, um por comprovante
- Cada card tem:
  - Badge colorido com o tipo (Comprovante PIX / Boleto / NF / Recibo)
  - Direção (🟢 Entrada / 🔴 Saída)
  - Campos editáveis com **destaque amarelo** se confidence < 0.85
  - Toggle "Lançar este comprovante" (operador pode pular itens duvidosos)
- Botão final: "✓ Confirmar todos" (cria N lançamentos de uma vez)

**Layout sugerido:**
```
┌─ Comprovante 1/3 — ✅ COMPROVANTE PIX recebido ──┐
│ Direção: 🟢 ENTRADA · Confidence: 95%             │
│ Valor: R$ 2.500,00                                │
│ Pagador: João da Silva (123.456.789-00)           │
│ Categoria: Aluguel  · Data: 10/05/2026            │
│ [Editar] [✓ Lançar este]                          │
└────────────────────────────────────────────────────┘

┌─ Comprovante 2/3 — 🔴 BOLETO a pagar ─────────────┐
│ Direção: 🔴 SAÍDA · Confidence: 92%               │
│ Valor: R$ 320,50                                  │
│ Beneficiário: Condomínio Edif. Solar              │
│ Categoria: Condomínio · Vencimento: 15/05/2026    │
│ [Editar] [✓ Lançar este]                          │
└────────────────────────────────────────────────────┘

┌─ Comprovante 3/3 — ⚠️ NOTA FISCAL ─────────────────┐
│ Direção: ?ambíguo · Confidence: 78%               │
│ Valor: R$ 150,00                                  │
│ Beneficiário: Eletricista José                    │
│ ⚠️ Sem comprovante de pagamento anexado           │
│ Categoria: Manutenção                             │
│ Data de pagamento: [_________] ← preencher        │
│ [Editar] [□ NÃO lançar] [✓ Lançar este]          │
└────────────────────────────────────────────────────┘

[Cancelar]                    [✓ Confirmar selecionados (3)]
```

### **Fase 3 — Vinculação automática ao contrato** (1.5h)

**Lógica:**
1. Operador abre o balancete de um imóvel
2. Anexa arquivo com múltiplos comprovantes
3. Pra cada comprovante de ENTRADA:
   - Sistema busca contrato vigente do imóvel
   - Verifica se valor bate com `aluguelSugerido` do contrato (±5% de tolerância)
   - Verifica se CPF do pagador bate com `locatario.cpf` do contrato
   - Se 2/3 condições batem → vincula automaticamente
   - Se 1/3 ou menos → marca como "verificar manualmente"

**Resultado:**
- Lançamento fica com `contratoId` preenchido
- Possível ver balancete consolidado por contrato (não só por imóvel/mês)
- Imóveis com múltiplas unidades (kitnet) suportados naturalmente

### **Fase 4 — Apuração em tempo real** (1h)

**Card "Resumo do balancete" no topo do modal:**
```
┌─────────────────────────────────────────────┐
│ 📊 Resumo (atualizando em tempo real)       │
├─────────────────────────────────────────────┤
│ 🟢 Receitas:    R$  3.000,00                │
│ 🔴 Despesas:    R$    850,00                │
│ ─────────────────────────────────           │
│ 💰 LÍQUIDO:     R$  2.150,00                │
│    a repassar pro locador                   │
└─────────────────────────────────────────────┘
```

Atualiza a cada novo lançamento (entrada ou saída). Não precisa esperar o "Fechar balancete" pra ver.

---

## 📚 Considerações técnicas

### Performance

- **Gemini 2.5 Flash** suporta múltiplas imagens/páginas no mesmo prompt
- Limite: 4MB por arquivo (mantém)
- Tempo esperado: 5-15s pra documento com 5+ comprovantes

### Custo

- Gemini 2.5 Flash: ~$0.075 por 1M tokens de input
- 1 comprovante = ~1.500 tokens (texto + imagem)
- Custo estimado: R$ 0.001 por comprovante lido
- 1.000 comprovantes/mês = R$ 1,00 (irrelevante)

### Limites de confiança

- `confidence >= 0.90` → verde, lança direto
- `0.70 <= confidence < 0.90` → amarelo, operador confirma
- `confidence < 0.70` → vermelho, operador EDITA antes de aceitar

### Backwards compatibility

- API antiga do Worker (retornava 1 objeto) → continua funcionando
- App detecta: se `result.data.comprovantes` existe → modo multi
- Senão → modo legado (1 só)

---

## 🎁 Bonus features (futuro)

- **OCR de cheques** (mais raro mas existe)
- **Reconhecimento de DARF/DAS** (impostos pagos pelo escritório)
- **Recibo manuscrito** com baixa confidence (caseiro)
- **Auto-categorização inteligente** baseada no histórico do tenant
- **Detecção de duplicidade**: avisar se o mesmo comprovante foi lançado antes

---

## 💼 Argumento comercial

Quando estiver pronto, isso vira **diferencial enorme** no pitch:

> "Acabou planilha de Excel. Foto o comprovante → IA lê → entra no balancete sozinho. Locador recebe o líquido certinho todo mês sem você fazer conta. Economiza 5h/mês."

**Concorrente Superlógica NÃO tem isso.** Vantagem real.

---

## 📅 Próxima sessão

Quando o Donizete voltar e quiser implementar:

1. **Reler este documento por inteiro**
2. Confirmar com ele se as 4 fases ainda fazem sentido
3. Perguntar: tudo de uma vez OU faseado?
4. Estimar: 4-5h corridas se for tudo
5. Começar pela Fase 1 (Worker Gemini)

---

*Boa noite, Donizete! Bom descanso. Quando voltar, tô preparado pra essa feature. 😴*
*— Claude*
