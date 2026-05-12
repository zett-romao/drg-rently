# 📋 Backlog — Refinamentos do suporte PF (Corretor Autônomo)

**Status:** Implementação básica feita em 2026-05-13 ✅
**Próximas evoluções:** Aguardando feedback de mercado

---

## ✅ Implementado nesta sessão

- Toggle PF/PJ no signup
- Validação CPF (algoritmo completo) e CNPJ (algoritmo completo)
- Auto-formatação dos documentos enquanto digita
- Salva `tipoPessoa` + `cpf`/`cnpj` no doc do tenant
- Configurações do tenant ajusta labels conforme tipo
- Super Admin: filtro por tipo + coluna "Tipo" na tabela
- Modal de gestão do tenant mostra tipo no título
- Query params: `?tipo=PF` ou `?tipo=PJ` pra landing segmentada
- Manuais atualizados com tabela de preços diferenciada

---

## 🔄 Refinamentos futuros sugeridos

### 1. Auto-fill de CPF (precisa avaliar)
- ⚠️ **Problema**: a Receita Federal **não tem API pública** pra dados pessoais
- BrasilAPI **só funciona pra CNPJ** (dados públicos das empresas)
- **Alternativa paga**: SerproDirect, JusBrasil ($$$ por consulta)
- **Decisão atual**: deixar CPF como input manual; só formatar e validar

### 2. Identidade visual padrão para PF
Hoje a logo padrão é "D.R. Global" (brasão). Para corretores autônomos pode
fazer sentido:
- Avatar padrão circular com inicial do nome (tipo Gmail)
- Ou logo "DRG-Rently" neutra sem marca da DRG
- Configurável em Configurações → Identidade Visual

### 3. Pacote especial "Corretor Pro" (R$ 119)
Já mencionado no manual, mas precisa implementar:
- Variante do pacote Completo + Portais habilitados por padrão
- Adicionar em `TENANT_PACOTES` no app.js como `corretor_completo`

### 4. Limite de imóveis por plano
- PF Completo: até 30 imóveis
- PJ Locação/Venda: até 100 imóveis
- PJ Completo: até 500 imóveis
- Custom: ilimitado
- Banner de alerta quando chega perto do limite

### 5. Diferenciação de templates de contrato
PF não tem razão social — alguns templates podem assinar como:
- "Eu, **João da Silva**, CRECI XXXXX, na qualidade de mediador..."
- Em vez de "A **Imobiliária Y Ltda**, CNPJ XX.XXX.XXX/..."

Pode adicionar variável `{{tenant.tipoPessoa}}` nos templates pra condicionar.

### 6. Emissão de recibos com CPF (DARF/NF-e)
- Hoje DARF/NF-e exigem PJ
- Corretor PF emite RPS (Recibo Provisório de Serviços) via prefeitura
- Considerar campo "Inscrição Municipal" pra cidades que exigem
- Integração com emissores municipais (Maringá, BH, SP têm APIs)

### 7. Portal-corretor (vitrine personal)
Vitrine pública especial pra corretor:
- Foto do corretor
- CRECI em destaque
- "Sobre mim" / bio
- Link pra LinkedIn / Instagram
- WhatsApp clicável direto

### 8. Marketing automation pra PF
- Sequência de e-mails pós-cadastro PF: dicas semanais
- "Como divulgar seu primeiro imóvel" → "Como gerar contrato"
- Onboarding mais hand-holding (corretor menos tech)

### 9. Cobrança PF facilitada
- PIX em vez de boleto (corretor PF prefere)
- Recorrência via cartão de crédito (Stripe/MP)
- Plano anual com desconto (15-20%)

### 10. Limites técnicos a considerar
- Storage por tenant: PF 500MB / PJ 5GB
- Workers: rate-limit por tenant (evita abuso PF "barato")
- E-mails: 100/mês PF / 1000/mês PJ

---

## 🎯 Priorização sugerida

**Alta (próxima sessão):**
- [ ] Limite de imóveis por plano (item 4)
- [ ] Diferenciação de templates de contrato PF (item 5)
- [ ] Pacote `corretor_completo` em TENANT_PACOTES (item 3)

**Média (1-2 meses):**
- [ ] Portal-corretor / vitrine personal (item 7)
- [ ] Avatar padrão por inicial pra PF (item 2)
- [ ] Cobrança PF com Stripe/MP (item 9)

**Baixa (depois):**
- [ ] Auto-fill CPF (item 1) — só se valer o custo SerproDirect
- [ ] Emissão de RPS (item 6) — caso por caso
- [ ] Marketing automation (item 8) — quando ter base ≥ 50 PF

---

*Boa noite, Donizete! Quando voltar, retomamos com esses refinamentos.*
*— Claude*
