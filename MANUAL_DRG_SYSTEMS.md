# 📕 Manual DRG-Systems — Gestão das Licenças do SaaS

**Versão:** 1.0
**Atualizado em:** 2026-05-12
**Para quem:** Equipe interna D.R. Global (Donizete + futuros operadores DRG)
**Confidencial — uso interno**

---

## Sumário

1. [Visão geral do negócio](#1-visão-geral-do-negócio)
2. [Painel Super Admin](#2-painel-super-admin)
3. [Cadastro de uma nova imobiliária cliente](#3-cadastro-de-uma-nova-imobiliária-cliente)
4. [Pacotes comerciais e módulos](#4-pacotes-comerciais-e-módulos)
5. [Cobrança e renovação](#5-cobrança-e-renovação)
6. [Atuar como cliente (impersonate)](#6-atuar-como-cliente-impersonate)
7. [Equipe interna DRG](#7-equipe-interna-drg)
8. [Suspensão e reativação de clientes](#8-suspensão-e-reativação-de-clientes)
9. [Processo de vendas](#9-processo-de-vendas)
10. [Operação técnica (deploys, secrets, regras)](#10-operação-técnica)
11. [Indicadores e MRR](#11-indicadores-e-mrr)
12. [Procedimentos de emergência](#12-procedimentos-de-emergência)

---

## 1. Visão geral do negócio

### O produto

**DRG-Rently** é um SaaS B2B multi-tenant para gestão de locações e vendas de
imóveis. Atende imobiliárias e administradores de bens.

### Modelos de monetização

| Modelo | Como funciona | Preço sugerido |
|---|---|---|
| **A — Operação própria** | D.R. Global Imóveis usa como tenant interno | — |
| **B — SaaS multi-cliente** | Outras imobiliárias assinam | R$ 150-400/mês |
| **C — Self-hosted** | Cliente roda em Firebase próprio | R$ 5-15k setup + manutenção |

### Concorrentes diretos

- **Superlógica** (líder no segmento, R$ 300-600/mês)
- **Group Software** (R$ 200-500/mês)
- **Cigam** (mais caro, mais completo)

### Vantagens do DRG-Rently

- **Preço competitivo** (50-70% mais barato que Superlógica)
- **Integração com portais** (XML feed em 4 formatos)
- **Leitura automática de boletos** (Gemini Vision)
- **Multi-tenant verdadeiro** com isolamento por perfis
- **Self-hosted disponível** (cliente paranoid pode pagar setup avulso)

---

## 2. Painel Super Admin

### Como acessar

1. Login na sua conta `super_admin`
2. Sidebar exibe automaticamente **"DRG-Systems / DevOps"** (branding interno)
3. Menu lateral mostra **⚙️ Super Admin** no grupo Administração

### O que tem no painel

#### KPIs gerais (topo)
- 🏢 Total de tenants ativos
- 💰 MRR (Monthly Recurring Revenue) — soma das mensalidades
- 📈 Tenants em trial
- 🚨 Tenants em atraso (inadimplentes)
- 🆕 Novos no mês

#### Tabela de imobiliárias clientes
- Razão social + CNPJ
- Plano (Trial / Basic / Pro)
- Mensalidade
- Próximo vencimento
- Status (🟢 Ativo / 🔴 Suspenso / 🟡 Trial / ⚠️ Inadimplente)
- Filtros: por status, plano, busca por nome/CNPJ

#### Equipe interna DRG
- Membros da equipe (super_admin + operador_drg)
- Perfis DRG customizáveis

---

## 3. Cadastro de uma nova imobiliária cliente

### Opção A — Cliente faz o signup sozinho

1. Você manda o link: `https://zett-romao.github.io/drg-rently/`
2. Cliente clica em **"Criar conta"** e preenche os dados
3. Tenant é criado com plano **Trial** automaticamente
4. Você vê o novo tenant no painel Super Admin
5. Após o trial, defina o plano comercial (passo abaixo)

### Opção B — Você cadastra pelo cliente

(Recomendado quando você fechou venda por telefone/WhatsApp)

1. Pegue os dados do cliente: CNPJ, razão social, e-mail do admin
2. Você mesmo faz o signup pelo link
3. Use uma senha temporária forte
4. Passe ao cliente:
   - Link de acesso
   - E-mail cadastrado
   - Senha temporária (pra ele trocar no 1º acesso)

### Configurando o tenant após signup

**No painel Super Admin → "⚙ Gerenciar" do tenant:**

#### 📋 Dados da imobiliária (read-only)
- Razão social, CNPJ, admin

#### 💼 Plano comercial (você edita)
- **Plano**: Trial / Basic / Pro
- **Valor mensalidade**: R$ (sua tabela de preços)
- **Próximo vencimento**: data
- **Trial expira em**: data (se aplicável)
- **Status**: 🟢 Ativo / 🔴 Suspenso

#### 🎁 Módulos contratados ✨
**ESCOLHA O PACOTE:**

| Pacote | Módulos liberados | Preço sugerido |
|---|---|---|
| 🏠 **Locação** | Só locação (sem vendas) | R$ 150/mês |
| 💼 **Venda** | Só vendas (sem locações) | R$ 200/mês |
| 🌟 **Completo** | Locação + venda | R$ 300/mês |
| ⚙️ **Customizado** | Você marca módulo a módulo | A combinar |

#### 📝 Notas internas
Anotações sobre o cliente que NÃO são visíveis pra ele. Use pra:
- Histórico de negociação
- Promessas feitas
- Aniversário do dono
- Forma de pagamento preferida

#### 💰 Histórico de pagamentos
Você registra manualmente cada pagamento recebido:
- Data, método (PIX/Boleto/Cartão), valor, observação

---

## 4. Pacotes comerciais e módulos

### Comparativo dos pacotes

**🏠 Locação** (módulos):
- Dashboard, Alertas, Relatórios
- Locadores, Locatários, Garantias, Imóveis
- Contratos, Balancetes
- Vitrine, Portais
- Auditoria, Importação, Configurações
- ❌ Compradores, Negociações

**💼 Venda** (módulos):
- Dashboard, Alertas, Relatórios
- Compradores, Imóveis
- Negociações
- Vitrine, Portais
- Auditoria, Importação, Configurações
- ❌ Locadores, Locatários, Garantias, Contratos, Balancetes

**🌟 Completo** (módulos):
- TODOS os módulos acima

**⚙️ Customizado:**
- Você escolhe módulo a módulo
- Use pra clientes que querem combos específicos:
  - "Locação + Importação CSV" (sem auditoria)
  - "Venda + Vitrine + Portais" (sem relatórios)
  - "Tudo menos auditoria"

### Quando usar cada pacote

| Cliente | Pacote sugerido | Por quê |
|---|---|---|
| Imobiliária pequena de locação | 🏠 Locação | Não vende, só aluga |
| Construtora vendendo lançamentos | 💼 Venda | Não administra locações |
| Imobiliária tradicional | 🌟 Completo | Faz tudo |
| Corretor autônomo | 🌟 Completo | Pode precisar dos dois |

### Mudança de pacote

Cliente pode upgradear (ou downgradear) a qualquer momento. Você só edita
o pacote no painel — efeito imediato no próximo refresh do cliente.

---

## 5. Cobrança e renovação

### Hoje (manual)

1. Você define **valor mensalidade** + **próximo vencimento** no painel
2. Sistema mostra alerta de "Inadimplente" quando vencimento passa
3. Você cobra o cliente por WhatsApp/e-mail
4. Cliente paga
5. Você **registra o pagamento** no painel (botão "+ Adicionar")
6. Você atualiza o **próximo vencimento** (+30 dias)

### Métodos de pagamento

| Método | Vantagem | Como cobrar |
|---|---|---|
| **PIX** | Sem taxa, instantâneo | Manda chave PIX |
| **Boleto** | Cliente prefere | Use plataforma tipo Cobre Fácil, Inter, Asaas |
| **Cartão** | Recorrência | Stripe ou Mercado Pago (Fase futura) |
| **Transferência** | Tradicional | Dados bancários da D.R. Global |

### Quando suspender

**Critério sugerido**: 15 dias de atraso = suspender.

Passos:
1. **D+0** (vencimento): sistema mostra "Inadimplente"
2. **D+3**: você manda WhatsApp/e-mail de cobrança
3. **D+7**: 2ª cobrança
4. **D+15**: você **suspende** (toggle "Status" → Suspenso)
5. Cliente recebe mensagem ao logar: "Conta suspensa, contate o suporte"
6. **Reativa imediatamente** após pagamento (toggle de volta)

### Cobrança automatizada (Fase futura)

- Stripe ou Mercado Pago
- Cobrança recorrente automática
- Aviso de cartão expirando
- Suspensão automática após 3 falhas

---

## 6. Atuar como cliente (impersonate)

Função poderosa pra dar suporte: você "entra" na conta do cliente como se fosse ele.

### Como usar

1. Painel Super Admin → tenant desejado → **"⚙ Gerenciar"**
2. No modal, clica em **"👁 Atuar como este tenant"**
3. Você é redirecionado pro **app do cliente**, com banner amarelo no topo:
   > 👁 Você está atuando como **Nome da Imobiliária**
4. Pode fazer qualquer ação (ver imóveis, ajustar configurações, etc.)
5. Toda ação é registrada na **Auditoria** como sendo sua

### Quando voltar

Banner no topo tem botão **"← Voltar ao Super Admin"** — clica.

### Casos de uso

- ✅ Tirar dúvida do cliente (ver a tela dele)
- ✅ Configurar Worker URLs por ele (suporte)
- ✅ Corrigir dado errado
- ❌ NÃO usar pra fazer operações comerciais por ele (assinatura, cobrança)

### Privacidade e LGPD

Atuar como cliente fica **registrado na auditoria**. Use com responsabilidade.
Recomendação: peça autorização do cliente antes de entrar (WhatsApp/e-mail).

---

## 7. Equipe interna DRG

À medida que o SaaS cresce, você vai precisar de equipe. O sistema já suporta.

### Hierarquia

```
super_admin (você, Donizete)
   ↓ gerencia
operador_drg (equipe interna)
   ↓ atende
admin (admin de tenant)
   ↓ supervisiona
operador (operador de tenant)
```

### Como criar membros DRG

1. Painel Super Admin → role até **"👥 Equipe interna DRG"**
2. Botão **"+ Adicionar membro DRG"**
3. **Nome, e-mail, role:**
   - **Super Admin**: acesso total ao painel DRG (cópia sua)
   - **Operador DRG**: acesso limitado pelas permissões do perfil
4. **Perfil DRG**: selecione um perfil customizado (se for operador_drg)
5. Senha inicial gerada automaticamente
6. ✅ Enviar e-mail ao colaborador

### Perfis DRG customizáveis

#### Cria perfis por função

**Comercial** (vendedor de licenças):
- ✅ Dashboard / KPIs
- ✅ Ver imobiliárias
- ✅ Editar plano e módulos
- ❌ Pagamentos
- ❌ Atuar como cliente
- ❌ Gerenciar equipe

**Suporte** (ajuda clientes):
- ✅ Dashboard / KPIs
- ✅ Ver imobiliárias
- ❌ Editar plano
- ❌ Pagamentos
- ✅ Atuar como cliente
- ❌ Gerenciar equipe

**Financeiro** (cobrança):
- ✅ Dashboard / KPIs
- ✅ Ver imobiliárias
- ❌ Editar plano (não muda plano)
- ✅ Gerenciar pagamentos
- ❌ Atuar como cliente
- ❌ Gerenciar equipe

**Apenas visualização** (estagiário, contador):
- ✅ Dashboard / KPIs
- ✅ Ver imobiliárias
- Tudo mais: ❌

### Como criar um perfil DRG

1. Painel Super Admin → **"+ Novo perfil DRG"**
2. Nome (ex: "Comercial Sr.")
3. Marca os checkboxes das áreas permitidas
4. Salvar

### Áreas DRG disponíveis (6)

| Área | O que libera |
|---|---|
| `drg_dashboard` | Ver KPIs gerais |
| `drg_tenants_view` | Ver lista de imobiliárias |
| `drg_tenants_edit` | Editar plano, módulos, status |
| `drg_tenants_pagamentos` | Lançar/excluir pagamentos |
| `drg_tenants_atuar_como` | Impersonate (atuar como cliente) |
| `drg_equipe` | Criar/editar membros DRG e perfis DRG |

⚠️ **Importante:** só `super_admin` pode criar outros `super_admin` ou
editar perfis DRG. `operador_drg` nunca tem acesso total.

---

## 8. Suspensão e reativação de clientes

### Suspensão

1. Painel → tenant → **"⚙ Gerenciar"**
2. Campo **Status** → **🔴 Suspenso**
3. Salvar

**O que acontece com o cliente:**
- Tenta logar → mensagem **"Esta conta está suspensa. Contate o suporte."**
- Forced logout imediato
- Operadores do tenant também são deslogados
- **Dados ficam preservados** (não apaga nada)

### Reativação

Mesmo caminho — Status → **🟢 Ativo** → Salvar. Acesso volta imediatamente.

### Quando deletar definitivamente

Cliente deletado = perde TUDO (locadores, contratos, balancetes, fotos).

**Só delete quando:**
- Cliente pediu LGPD (direito ao esquecimento)
- Cliente cancelou e pediu remoção dos dados
- Conta foi criada por engano (duplicada)

**Como deletar:**
1. Painel → tenant → botão "🗑 Excluir tenant" (só super_admin vê)
2. Confirmação dupla
3. Cascade delete: todas as subcoleções, fotos no Storage, usuários vinculados

⚠️ **Ação irreversível.** Faça backup do CSV do cliente antes.

---

## 9. Processo de vendas

### Funil sugerido

```
1. PROSPECT (Lead frio)
   ↓ ligação / cold mail
2. DEMO AGENDADA
   ↓ apresentação 30 min via Meet
3. PROPOSTA ENVIADA
   ↓ valor + módulos + prazo
4. NEGOCIANDO
   ↓ ajustes
5. FECHOU 🎉
   ↓ trial 14 dias OU pagamento upfront
6. ATIVO E PAGANDO
```

### Apresentação de demo (script de 30 min)

**Abertura (3 min)**
- "Quantos imóveis vocês administram hoje?"
- "Qual o sistema atual?" (provavelmente Superlógica ou planilha)
- "Quanto pagam por mês?"

**Demonstração (20 min)**
- Login no DRG-Rently com tenant demo
- Dashboard
- Cadastra um imóvel (CEP autopreenche, foto com watermark)
- Mostra Vitrine Pública
- Mostra Portais (XML feed → ZAP/Viva)
- Gera contrato em PDF
- Fecha um balancete + envia por e-mail

**Diferenciais a destacar (5 min)**
- 💰 Preço 50-70% menor
- 🤖 Leitura automática de boleto (Gemini)
- 📡 4 formatos de XML feed
- 🔒 Multi-tenant com isolamento total
- 🎨 Logo customizada (white-label)

**Fechamento (2 min)**
- "Quer testar 14 dias gratuitos?"
- Cadastra na hora pelo seu painel

### Tabela de preços sugerida

**Pessoa Jurídica (Imobiliária):**

| Pacote | Mensal | Trimestral | Anual |
|---|---|---|---|
| 🏠 Locação | R$ 150 | R$ 400 (R$ 133/mês) | R$ 1.500 (R$ 125/mês) |
| 💼 Venda | R$ 200 | R$ 540 (R$ 180/mês) | R$ 2.000 (R$ 167/mês) |
| 🌟 Completo | R$ 300 | R$ 810 (R$ 270/mês) | R$ 3.000 (R$ 250/mês) |
| ⚙️ Customizado | A combinar | A combinar | A combinar |
| 🏗 Self-hosted | R$ 8.000 setup + R$ 500/mês manutenção | | |

**Pessoa Física (Corretor Autônomo):** ✨ NOVO

| Pacote | Mensal | Trimestral | Anual |
|---|---|---|---|
| 👤 Corretor Completo | **R$ 79** | R$ 210 (R$ 70/mês) | R$ 800 (R$ 67/mês) |
| 👤 Corretor + Portais | R$ 119 | R$ 320 (R$ 107/mês) | R$ 1.200 (R$ 100/mês) |

> 💡 **Estratégia:** o pacote PF de R$ 79 funciona como **isca de entrada**.
> Corretor autônomo entra barato, escala carteira e quando virar imobiliária
> migra pro pacote PJ Completo (R$ 300). LTV potencial: R$ 7.200 em 24 meses.

### Argumentos pra fechar venda

**Pra corretor autônomo (PF):** ✨
- "Por R$ 79/mês você tem o mesmo sistema das grandes imobiliárias"
- "Cadastra seus 5-20 imóveis, gera vitrine pública, publica no ZAP/Viva automaticamente"
- "Sai mais barato que o Imovelweb sozinho, e você ganha gestão completa de contratos"

**Pra imobiliária pequena (1-10 imóveis):**
- "Por R$ 150 você economiza 5h/mês fazendo balancete na planilha"

**Pra imobiliária média (50+ imóveis):**
- "Você economiza R$ 400/mês comparado ao Superlógica"
- "Tem integração com portais (XML feed em 4 formatos)"

**Pra construtora (vende lançamentos):**
- "Funil de negociação completo + XML feed pro Órulo/DWV"

**Pra cliente paranoid (dados sensíveis):**
- "Posso instalar em Firebase próprio seu, você fica dono dos dados"

---

## 10. Operação técnica

### Acesso aos serviços

| Serviço | URL | Conta |
|---|---|---|
| Firebase Console | console.firebase.google.com/project/drg-rently | zett.romao@gmail.com |
| Cloudflare | dash.cloudflare.com | mesmo |
| GitHub | github.com/zett-romao/drg-rently | mesmo |
| Resend | resend.com | mesmo |
| Google Cloud | console.cloud.google.com | mesmo |

### Workers em produção (3)

```
drg-rently-resend  → envio de e-mail (balancetes)
drg-rently-gemini  → leitura de boletos
drg-rently-feed    → XML feed pros portais
```

### Secrets configurados

| Worker | Secrets |
|---|---|
| Resend | `RESEND_API_KEY` |
| Gemini | `GEMINI_API_KEY` |
| Feed | `FIREBASE_API_KEY`, var `PROJECT_ID=drg-rently` |

### Deploys (GitHub Pages)

- Push pro `main` deploya automaticamente em 30s-2min
- Cache buster (`?v=YYYYMMDDx`) em `index.html` força refresh dos clientes

### Quando atualizar regras Firestore

- Sempre que adicionar nova coleção
- Sempre que mudar role/permissão
- Arquivo de referência: `firestore.rules`
- Como publicar: Console → Firestore → Rules → cola → Publicar

### Backup

- Firebase faz backup automático contínuo (Firestore)
- Storage tem replicação em 4 regiões
- Recomenda **exportar manualmente** mensal pra cofre offline

### Como exportar dados de um tenant

```bash
# Via gcloud (precisa instalar gcloud CLI)
gcloud firestore export gs://drg-rently-backups/tenants/<tenantId> \
  --collection-ids=tenants/<tenantId>/...
```

---

## 11. Indicadores e MRR

### Métricas a acompanhar

**Comerciais:**
- 📊 **MRR** (Monthly Recurring Revenue) — visível no painel
- 📈 **Novos clientes/mês**
- 📉 **Churn** (cancelamentos)
- ⏱ **LTV** (Lifetime Value médio)
- 💰 **CAC** (Custo de aquisição)

**Operacionais:**
- 🏢 Tenants ativos
- ⚠️ Tenants em trial
- 🚨 Tenants inadimplentes
- 📊 Imóveis cadastrados (total no SaaS)

### Como calcular LTV

```
LTV = Mensalidade média × Tempo médio de retenção (meses)
```

Exemplo: R$ 250 × 24 meses = **R$ 6.000 por cliente**

### Como calcular CAC

```
CAC = Custo total de marketing+vendas / Novos clientes
```

Exemplo: R$ 2.000 gastos / 10 clientes novos = **R$ 200**

### Saúde do negócio

```
LTV / CAC ≥ 3   → saudável
LTV / CAC < 3   → preocupante
```

Com LTV R$ 6.000 e CAC R$ 200 → 30× → 🟢 saudável

---

## 12. Procedimentos de emergência

### 🚨 Site fora do ar

1. Verifica GitHub Pages: https://www.githubstatus.com/
2. Verifica Cloudflare: https://www.cloudflarestatus.com/
3. Verifica Firebase: https://status.firebase.google.com/
4. Se for problema de código → reverte último commit:
   ```bash
   git revert HEAD
   git push
   ```

### 🚨 Cliente perdeu acesso (admin esqueceu senha)

1. Painel Super Admin → ache o tenant
2. Lista de usuários do tenant → veja o e-mail do admin
3. Manda link "Esqueci senha" no app pro e-mail dele
4. Se o e-mail também foi perdido: Firebase Console → Authentication → Reset password manual

### 🚨 Cliente apagou dado importante

Firebase **NÃO TEM "lixeira"**. Mas tem **Point-in-Time Recovery** (Blaze).

1. Firebase Console → Firestore → Backups
2. Restore para snapshot antes da deleção (UTC)
3. **Cobra do cliente** o serviço de recuperação (R$ 300-500)

### 🚨 Vazamento de dados (suspeita LGPD)

1. **Desligue o tenant suspeito** imediatamente (suspender)
2. Veja os logs de auditoria do tenant
3. Identifique a brecha (regra Firestore? Conta comprometida?)
4. Comunique a ANPD em até 72h (se confirmado vazamento de dados pessoais)
5. Notifique os titulares dos dados afetados

### 🚨 Cliente quer rescindir

1. **Tenta reverter primeiro** (oferece desconto, atendimento dedicado)
2. Se não reverter → pega motivo no formulário de cancelamento
3. **Suspende em D+0** do pedido
4. **Mantém dados por 90 dias** (caso ele queira voltar)
5. Após 90 dias → delete definitivo (cascade)
6. Envia confirmação de exclusão por e-mail

### 🚨 Atendimento de pico (muitos cancelamentos)

1. **Audite o motivo** — pode ser bug, mudança de preço, concorrente novo
2. **Comunique-se ativamente** com toda base
3. **Ofereça extensão de plano**, desconto retroativo, etc.
4. **NÃO aumente preço** durante crise

---

## 📋 Checklist do novo dia

### Diariamente
- [ ] Painel Super Admin → KPIs gerais
- [ ] Tenants inadimplentes (D+3, D+7, D+15)
- [ ] Tickets de suporte (WhatsApp/e-mail)
- [ ] Novos signups em trial

### Semanalmente
- [ ] Demos agendadas
- [ ] Propostas em negociação
- [ ] Pagamentos recebidos × lançados no painel
- [ ] Backup manual dos tenants

### Mensalmente
- [ ] Faturamento total (MRR)
- [ ] Churn rate
- [ ] Análise de uso (quem usa pouco → risco de churn)
- [ ] Revisão de Workers (custo Cloudflare)
- [ ] Revisão de Firebase billing
- [ ] Pagamento da Receita (DAS/IRPJ)

### Trimestralmente
- [ ] Reajuste de preço (se aplicável)
- [ ] Coleta de feedback dos top 10 clientes
- [ ] Planejamento de features

---

## 🔐 Senhas e credenciais (NUNCA compartilhe)

Mantenha em cofre (1Password, Bitwarden, KeePass):

- Conta Google (zett.romao@gmail.com)
- Firebase Console
- Cloudflare
- GitHub
- Resend
- Receita (e-CAC)
- Bancos / chave PIX da D.R. Global
- Dominio Hostinger

---

## 📞 Contatos de emergência

| Quem | Pra quê | Contato |
|---|---|---|
| Suporte Firebase | Pane no Firestore/Auth | firebase-support@google.com |
| Suporte Cloudflare | Worker fora do ar | dashboard.cloudflare.com/support |
| Suporte Resend | E-mail não entrega | help@resend.com |
| ANPD | Incidente LGPD | comunicacao@anpd.gov.br |
| Contador | Imposto/Dúvida fiscal | (seu contador) |
| Advogado | LGPD/Contratos | (seu advogado) |

---

## 📊 Anexo — Tabela de comparação com concorrentes

| Feature | DRG-Rently | Superlógica | Group Software | Cigam |
|---|---|---|---|---|
| Preço (médio) | R$ 250 | R$ 500 | R$ 350 | R$ 800 |
| Multi-tenant verdadeiro | ✅ | ✅ | ⚠️ | ✅ |
| Vitrine pública | ✅ | ✅ | ✅ | ✅ |
| XML Feed portais | ✅ (4 formatos) | ✅ | ✅ | ✅ |
| Leitura de boleto IA | ✅ (Gemini) | ❌ | ❌ | ❌ |
| Self-hosted disponível | ✅ | ❌ | ❌ | ❌ |
| LGPD com auditoria | ✅ | ✅ | ⚠️ | ✅ |
| Logo customizada | ✅ | ✅ | ❌ | ✅ |
| Perfis customizáveis | ✅ | ✅ | ⚠️ | ✅ |
| App mobile | ❌ (PWA) | ✅ | ❌ | ✅ |
| Pix integrado | ⏳ Fase 4 | ✅ | ✅ | ✅ |
| Cobrança recorrente | ⏳ Futuro | ✅ | ✅ | ✅ |

**Nossa vantagem maior**: preço + IA boleto + self-hosted.
**Nossa fraqueza atual**: sem app mobile nativo, sem Pix integrado, cobrança manual.

---

**🚀 D.R. Global Multi Services — vamos crescer juntos!**

*Donizete, este manual é seu — atualize sempre que aprender algo novo no campo.*
