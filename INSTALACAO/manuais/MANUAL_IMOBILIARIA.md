# 📘 Manual de Operação — DRG-Rently

**Versão:** 1.4
**Atualizado em:** 2026-05-14
**Para quem:** Imobiliárias (PJ) e Corretores Autônomos (PF) clientes da D.R. Global

> 💡 O DRG-Rently atende **tanto Pessoa Jurídica** (imobiliárias) **quanto
> Pessoa Física** (corretores autônomos com CRECI). Os fluxos são os mesmos —
> apenas o cadastro inicial muda.

---

## ✨ O que há de novo na versão 1.4

- **🔐 Login biométrico (Passkeys)** — entre com Windows Hello, Touch ID ou Face ID, sem digitar senha
- **🔑 Esqueci minha senha** — link no login envia e-mail de reset
- **👁 Mostrar/esconder senha** — botão olho ao lado dos campos de senha
- **⬅ Botão Voltar global** — aparece no topbar quando há histórico de navegação
- **🏠💼 Locador / Vendedor unificado** — cadastro único com checkbox de papéis (pode atuar como um, outro ou ambos)
- **🤖 IA preenche cadastros** — anexe RG, CNH, CPF ou comprovante e a IA preenche os campos automaticamente (em Locador, Locatário e Comprador)
- **📷 Fotos do imóvel turbinadas** — drag & drop pra subir, arrastar pra reordenar, badge 👑 Capa na primeira, auto-rascunho ao primeiro upload
- **🏷 Vitrine com tabs Aluguel | Venda** — cores e títulos diferentes por modalidade, link direto compartilhável
- **📤 Captação de leads** — visitantes da vitrine clicam "📤 Anuncie seu imóvel" e o lead vai direto pro Firestore
- **💬 WhatsApp flutuante** — bolinha verde fixa em todas as páginas públicas, abre conversa pré-preenchida
- **🧾 Taxa de administração configurável** — aluguel apenas / todas as receitas / verbas selecionadas
- **💳 Asaas no balancete** — cobrar locatário (boleto/PIX) + pagar locador (PIX) sem sair do app
- **🔔 Painel de alertas no Dashboard** — pendências críticas / atenção / info já na home
- **🌐 Editor de URLs do monitor legislativo** — adicione, remova e edite as leis monitoradas
- **📝 Editor de perguntas do wizard** — customize o texto das perguntas do "Elaborar contrato"
- **📥 Importação CSV redesenhada** — 4 passos visuais guiados, dropzone com drag & drop
- **🎯 Filtros chips na tabela de Imóveis** — Locação / Venda / Ambos + Status (Disponível / Alugado / Vendido / Em reforma)
- **📋 Imóveis em rascunho** — comece a cadastrar fotos sem ter completado os dados (sistema salva como rascunho automaticamente)
- **💬 Mensagens contextuais inline** — feedback aparece logo abaixo do botão clicado (não pula mais pro topo do modal)

---

## Sumário

1. [Primeiro acesso](#1-primeiro-acesso)
2. [Conhecendo a interface](#2-conhecendo-a-interface)
3. [Configurações iniciais (importantíssimo)](#3-configurações-iniciais-importantíssimo)
4. [Cadastros — quem é quem no sistema](#4-cadastros)
   - 4a. [Locadores / Vendedores (cadastro unificado)](#4a-locadores--vendedores)
   - 4b. [IA preenche cadastros a partir de RG/CNH/CPF](#4b-ia-preenche-cadastros)
5. [Imóveis — coração do sistema](#5-imóveis)
   - 5a. [Fotos com drag & drop + reordenação + auto-rascunho](#5a-fotos-do-imóvel)
   - 5b. [Filtros chips (Locação / Venda / Status)](#5b-filtros-da-tabela)
6. [Garantias](#6-garantias)
7. [Contratos](#7-contratos)
   - 7a. [Elaborar contrato pelo Wizard](#7a-elaborar-contrato-pelo-wizard)
   - 7b. [Importar contrato existente via IA](#7b-importar-contrato-existente-via-ia)
   - 7c. [Assinatura eletrônica (ZapSign)](#7c-assinatura-eletrônica-zapsign)
   - 7d. [Distrato no contrato vigente](#7d-distrato-no-contrato-vigente)
   - 7e. [Cobrança de débito atualizado](#7e-cobrança-de-débito-atualizado)
8. [Negociações (Vendas)](#8-negociações-vendas)
9. [Balancetes mensais](#9-balancetes-mensais)
   - 9a. [IA multi-comprovante (Gemini Vision)](#9a-ia-multi-comprovante)
   - 9b. [Taxa de administração configurável](#9b-taxa-de-administração-configurável)
   - 9c. [Asaas — cobrar locatário e pagar locador](#9c-asaas-no-balancete)
10. [Vitrine pública](#10-vitrine-pública)
    - 10a. [Tabs Aluguel / Venda + links compartilháveis](#10a-tabs-da-vitrine)
    - 10b. [Captação de leads pela vitrine](#10b-captação-de-leads)
    - 10c. [WhatsApp FAB flutuante](#10c-whatsapp-fab)
11. [Portais imobiliários (XML Feed)](#11-portais-imobiliários)
12. [Operadores e perfis customizados](#12-operadores-e-perfis)
13. [Importação CSV em massa](#13-importação-csv-em-massa)
14. [Painel de alertas](#14-painel-de-alertas)
    - 14a. [Card "🚨 Contratos atrasados"](#14a-card-contratos-atrasados)
    - 14b. [Painel de alertas no Dashboard](#14b-painel-de-alertas-no-dashboard)
15. [LGPD e auditoria](#15-lgpd-e-auditoria)
16. [Monitor legislativo (IA jurídica)](#16-monitor-legislativo)
17. [App mobile (PWA — Progressive Web App)](#17-app-mobile-pwa)
18. [Manutenção administrativa](#18-manutenção-administrativa)
19. [Login biométrico (Passkeys)](#19-login-biométrico-passkeys)
20. [Solução de problemas](#20-solução-de-problemas)

---

## 1. Primeiro acesso

### Você foi convidado

Quando o administrador da sua imobiliária cadastra você como operador, você
recebe um **e-mail** com:

- **Link**: `https://zett-romao.github.io/drg-rently/`
- **E-mail**: o que foi cadastrado
- **Senha inicial**: gerada automaticamente

**Importante:** troque a senha no primeiro acesso pelo botão "Esqueci minha senha"
da tela de login.

### Você criou a conta

1. Acesse `https://zett-romao.github.io/drg-rently/?signup=1` (link direto)
2. **Escolha o tipo de conta:**
   - 🏢 **Imobiliária** (Pessoa Jurídica) — com CNPJ
   - 👤 **Corretor** (Pessoa Física) — com CPF
3. Preencha os dados conforme o tipo:

   **Se for PJ (Imobiliária):**
   - Razão social
   - CNPJ (autopreenche pela Receita Federal via BrasilAPI)
   - CRECI (opcional)

   **Se for PF (Corretor autônomo):**
   - Nome completo
   - CPF
   - CRECI (opcional — recomendado)

4. Preencha seus dados de administrador:
   - Nome
   - E-mail (será seu login)
   - Senha (mín 6 caracteres)
5. Clique em **"Criar conta"**

🎉 Pronto! Sua conta está cadastrada com plano **Trial** (gratuito por 14 dias).

### 💼 Tabela de planos

| Perfil | Pacote | Mensalidade |
|---|---|---|
| 👤 Corretor PF (autônomo) | Completo | R$ 79/mês |
| 🏢 Imobiliária PJ pequena | Locação OU Venda | R$ 150/mês |
| 🏢 Imobiliária PJ média | Locação OU Venda | R$ 200/mês |
| 🏢 Imobiliária PJ grande | Completo | R$ 300/mês |
| 🏗 Construtora | Venda + Portais | R$ 500/mês |

---

## 2. Conhecendo a interface

### Barra lateral (sidebar)

O menu lateral é dividido em 4 grupos:

#### 📊 Visão Geral
- **Dashboard** — visão consolidada (KPIs)
- **Alertas** — vencimentos e pendências
- **Relatórios** — receita, ocupação, comissões

#### 📁 Cadastros
- **Locadores** — proprietários dos imóveis
- **Locatários** — inquilinos
- **Compradores** — interessados em comprar
- **Garantias** — fiadores, caução, seguro fiança
- **Imóveis** — todos os imóveis administrados

#### ⚙ Operação
- **Contratos** — locação ou venda
- **Negociações** — funil de vendas
- **Balancetes** — fechamento mensal
- **Vitrine Pública** — link pra divulgação
- **Portais** — XML feed pra ZAP/Viva/OLX/etc.

#### 🛠 Administração
- **Importação CSV** — em massa
- **Auditoria** — logs de ações (LGPD)
- **Configurações** — usuários, perfis, logo, templates

### Cabeçalho (topbar)

- **Lado esquerdo**: nome da seção atual
- **Lado direito**: seu nome + botão "Sair"

### Dashboard com drag-and-drop

Você pode **arrastar os cards** do dashboard pra reordenar conforme sua preferência. A ordem é salva automaticamente.

---

## 3. Configurações iniciais (IMPORTANTÍSSIMO)

Antes de começar a operar, configure tudo em **🔧 Configurações**:

### 🎨 Identidade visual

- **Logo da imobiliária**: clique em "Escolher arquivo" e suba sua logo
  (PNG/JPG/SVG até 1MB, recomendado quadrado mín. 200×200px)
- Aparece no app, links públicos, e-mails de balancete

### 📋 Dados cadastrais

- **Razão social, CNPJ, CRECI**: já preenchido no signup
- **Telefone** e **e-mail de contato**: aparecem nas páginas públicas
- **Slug**: nome amigável da sua URL pública (ex: `drglobal`)
  - Vitrine ficará: `imoveis.html?t=drglobal`

### 💧 Marca d'água nas fotos

Marque para que todas as fotos de imóveis recebam sua logo como marca d'água
ao serem publicadas (proteção contra cópia).

### 📝 Templates de cláusulas

Personalize os templates de contrato (locação e venda). Use variáveis:
- `{{locador.nome}}`, `{{locatario.nome}}`, `{{imovel.endereco}}`
- `{{contrato.valor}}`, `{{contrato.dataInicio}}`, etc.

Os templates servem de base — você ainda pode editar cada contrato individualmente.

### 📧 Envio de e-mail (balancetes)

Cole a URL do Worker Resend (fornecida pela D.R. Global):
```
https://drg-rently-resend.SEU-USUARIO.workers.dev
```
E o **e-mail de remetente** (precisa ser de domínio verificado no Resend).

### 🤖 Leitura de boletos (Gemini Vision)

Cole a URL do Worker Gemini (fornecida pela D.R. Global):
```
https://drg-rently-gemini.SEU-USUARIO.workers.dev
```

Permite que ao subir um boleto PDF de condomínio, o sistema extraia
automaticamente: valor, vencimento, beneficiário, linha digitável.

### 📡 XML Feed para portais

Cole a URL do Worker Feed (fornecida pela D.R. Global):
```
https://drg-rently-feed.SEU-USUARIO.workers.dev
```

Habilita os botões "📋 Copiar URL" na seção de Portais.

---

## 4. Cadastros

### Locadores (proprietários)

**Como cadastrar:**

1. Menu lateral → **Locadores**
2. Botão **"+ Novo locador"**
3. **Pessoa Física** ou **Jurídica**
4. CPF/CNPJ — ao sair do campo, dados da Receita Federal são preenchidos automaticamente
5. Endereço — digite o CEP, o resto vem do ViaCEP
6. **Chave Pix** — pra repasse mensal (Fase 4)
7. **Documentos** — RG, CPF, escritura, etc. (subir como PDF/JPG)

**Dica:** organize as autorizações de administração como documentos anexos.

### Locatários (inquilinos)

**Como cadastrar:**

1. Menu lateral → **Locatários**
2. Botão **"+ Novo locatário"**
3. Dados pessoais + dados sócio-econômicos:
   - Renda mensal
   - Empresa
   - Cargo
   - Tempo de empresa
4. Status: `pendente` / `analise` / `aprovado` / `rejeitado`
5. **Documentos**: holerites, comprovante de residência, etc.

**Importante:** só locatários `aprovado` podem ser vinculados a contratos.

### Compradores

Mesma lógica dos locatários, mas para o módulo de Vendas. Cadastre interessados
em comprar imóveis e use no funil de Negociações.

---

## 5. Imóveis

### Cadastro básico

1. **Apelido**: nome curto pra identificar (ex: "Apto 301 - Ed. Solar")
2. **Tipo**: residencial / comercial
3. **Subtipo**: apartamento / casa / sobrado / kitnet / sala / loja / galpão / terreno
4. **Locador**: selecione da lista cadastrada
5. **Endereço**: digite CEP → resto é automático
6. **Metragens**: área útil e total
7. **Cômodos**: quartos, banheiros, vagas, andar
8. **Mobiliado**: sim / parcial / não
9. **Múltiplas unidades**: marque se for prédio com várias kitnets/salas
   (impede vinculação automática a contratos)

### Dados do imóvel

- **Matrícula**: número do cartório
- **Número do IPTU** (inscrição imobiliária)
- **Finalidade**: locação / venda / ambos
- **Valor de mercado** (referência interna)

### Valores

- **Locação**: aluguel sugerido (em R$)
- **Venda**: valor de venda, aceita financiamento, aceita FGTS

### Documentos privados

Suba documentos que não vão pra vitrine pública: escritura, IPTU pago,
laudo de vistoria, etc. (PDFs)

### Fotos públicas

- Suba quantas fotos quiser
- Marca d'água é aplicada automaticamente (se configurado)
- A 1ª foto é a capa
- Arraste pra reordenar

### 🌐 Publicação pública

Ative o toggle **"🌐 Publicar este imóvel"** pra gerar um link compartilhável.

Você controla o que aparece no link público:
- ✅ Mostrar valor exato (ou "Sob consulta")
- ✅ Mostrar bairro
- ✅ Mostrar metragens
- ✅ Mostrar cômodos

⚠️ **Sempre ocultos** (LGPD): nome do proprietário, CPF/CNPJ, contatos, documentos.

### 📡 Conteúdo extra pros portais

- **Descrição longa**: 4-8 linhas descrevendo o imóvel, comércio próximo, transporte, escolas
- **🎥 URL do vídeo**: YouTube ou Vimeo
- **🌐 Tour virtual 360°**: Matterport ou similar
- **📤 Incluir no XML feed**: marca pra exposição automática nos portais (ZAP/Viva/OLX)

---

## 6. Garantias

Existem 3 tipos:

### 🤝 Fiador
- Cadastre os dados pessoais do fiador
- Renda comprovada (deve ser ≥ 3× valor do aluguel)
- Imóvel próprio em SP (se aplicável)
- Documentos: RG, CPF, comprovante de residência, IPTU do imóvel próprio

### 💰 Caução
- Tipo: dinheiro / imóvel / título
- Valor caucionado
- Conta poupança vinculada (Lei 8.245/91 art. 38)

### 🛡 Seguro fiança
- Seguradora
- Apólice
- Validade
- Custo mensal (geralmente embutido no aluguel)

**Vincule a garantia ao contrato** quando criar o contrato.

---

## 7. Contratos

### Criar contrato de locação

1. Menu → **Contratos** → **"+ Novo contrato"**
2. Selecione:
   - **Locador**
   - **Locatário** (só os aprovados aparecem)
   - **Imóvel** (só os disponíveis aparecem)
   - **Garantia**
3. Prazo: 6 / 12 / 24 / 36 meses
4. Valor do aluguel
5. Reajuste: IGPM / IPCA / fixo / sem reajuste
6. **Multa rescisória**: padrão 3× (editável)
7. **Taxa de administração**: padrão 10% (editável)
8. **Flag "1º aluguel pra escritório"**: marque se a captação foi sua
9. **Data de início** e **data de fim**

### Geração do contrato

- **PDF**: gera PDF formatado
- **Word (.docx)**: edite no Word se precisar ajustes
- **Texto**: copia o conteúdo
- **Imprimir**: direto no navegador

### Status do contrato

- `rascunho` — ainda não vigente
- `vigente` — em vigor
- `encerrado` — finalizado normalmente
- `rescindido` — finalizado antes do prazo

### Renovação automática (alertas)

90 dias antes do fim, o sistema mostra alerta. Você decide:
- Renovar (cria novo contrato)
- Encerrar (libera o imóvel)
- Rescindir (com cálculo de multa)

---

### 7a. Elaborar contrato pelo Wizard

✨ **Novo em 2026-05** — Cria contratos profissionais respondendo perguntas guiadas, sem se preocupar com formatação.

#### Como usar
1. Menu → **Contratos** → **✍️ Elaborar contrato**
2. Escolha a modalidade: **Locação** ou **Venda**
3. Responda as perguntas em sequência:
   - Quem é o locador? (escolhe do cadastro ou cria novo)
   - Quem é o locatário?
   - Qual o imóvel?
   - Qual a garantia? (fiador/caução/seguro)
   - Prazo, valor, dia de vencimento, índice de reajuste, etc.
4. **Preview**: o sistema mostra o contrato pronto em HTML
5. **Salvar**: grava em Contratos (status: rascunho) + gera **número sequencial automático** (00001, 00002…)
6. **Exportar**: PDF, Word (.docx) ou imprimir

#### Templates customizáveis
Cada tenant pode personalizar os textos das cláusulas em **Configurações → Templates de contrato** (3 abas: locação, venda, distrato). Suporta variáveis como `{{locador.nome}}`, `{{imovel.endereco}}`, etc.

> 💡 Banner de versionamento aparece quando o template é editado: o contrato sempre lembra qual versão do template foi usada.

---

### 7b. Importar contrato existente via IA

🤖 **Novo em 2026-05** — Para tenants migrando de outros sistemas ou querendo digitalizar contratos antigos.

#### Como usar
1. Menu → **Contratos** ou **Negociações** → **🤖 Importar contrato**
2. **Arraste o arquivo** (PDF, .docx ou imagem JPG/PNG) na dropzone OU clique pra escolher
3. A IA (Gemini Vision) processa em 15-40 segundos e extrai:
   - Partes (locador, locatário, fiador)
   - Dados do imóvel
   - Valores, prazo, índice de reajuste
   - Cláusulas relevantes
4. **Revisão em 3 abas**:
   - ① Partes — confirma quem cadastrar como locador/locatário/fiador
   - ② Imóvel — reusar imóvel existente ou criar novo
   - ③ Contrato — valores e prazos
5. **Detecção automática de duplicatas** — se o locador já existe, sugere reusar
6. **Confirma**: cria locadores/locatários/imóvel/garantia + contrato em **batch atômico**

#### Marcação na auditoria
Contratos importados ficam com `importadoPorIA: true` e aparecem no Dashboard em **🤖 Contratos via IA (este mês)**.

---

### 7c. Assinatura eletrônica (ZapSign)

✍️ **Novo em 2026-05** — Cliente assina o contrato no celular/computador sem precisar imprimir.

#### Pré-requisitos
1. Conta na **ZapSign** (https://app.zapsign.com.br) — plano que aceita seu volume mensal
2. **Token API** gerado em Configurações da ZapSign → Integrações → API
3. Cole o token em **DRG-Rently → Configurações → ✍️ Assinatura Eletrônica**
4. Cole também a **URL do Worker** (fornecida pela DRG)

#### Como enviar pra assinatura
1. Abre o contrato (rascunho ou vigente)
2. Botão **✍️ Enviar pra assinatura**
3. Confirma os signatários (auto-preenche: locador, locatário, fiador com e-mail)
4. Edita mensagem se quiser
5. **Enviar** — ZapSign envia e-mail pra cada signatário
6. Volta ao contrato e veja status em tempo real:
   - ⏳ Pendente · 📧 Enviado · ✅ Assinado por X de Y
7. Quando todos assinam:
   - ✅ Status do contrato muda de `rascunho` → `vigente` automaticamente
   - PDF final assinado fica baixável (com certificado digital ICP-Brasil)

> 💡 **Locação E Venda** suportadas (desde a Fase F item 7).

---

### 7d. Distrato no contrato vigente

📄 **Novo em 2026-05** — Encerra contrato com documento formal de distrato + libera imóvel automaticamente.

#### Como gerar distrato
1. Abre o contrato vigente
2. Botão **📄 Gerar distrato**
3. Preenche:
   - **Data do distrato** (quando acabou efetivamente)
   - **Data de entrega das chaves** (importante pra cálculo de débito)
   - **Motivo** (opcional)
   - **Cláusulas adicionais** (opcional)
4. **Preview + Salvar**: gera documento + atualiza contrato:
   - Status muda pra `encerrado`
   - Campo `dataDistrato` preenchido
   - Campo `dataEntregaChaves` preenchido
   - Imóvel volta automaticamente pra **disponível**

---

### 7e. Cobrança de débito atualizado

💰 **Novo em 2026-05** — Calcula débito de aluguel atrasado com correção monetária, multa, juros e honorários.

#### Como usar
1. Abre o contrato com locatário inadimplente
2. Botão **💰 Cálculo de débito**
3. Preenche:
   - **Aluguéis em atraso** (lista mês a mês)
   - **Índice de correção** (IPCA / INPC / IGPM / INCC — busca na **API do Banco Central** em tempo real)
   - **Multa** (% padrão)
   - **Juros mensal** (% pro rata die)
   - **Honorários advocatícios** (% se for cobrança judicial)
4. Sistema calcula o **débito atualizado em tempo real**
5. **Exportar relatório**: PDF ou Word com detalhamento mês a mês
6. **Enviar por e-mail** ao locatário (notificação extrajudicial)

#### Cards no Dashboard
Card **🚨 Contratos atrasados** mostra o total de contratos inadimplentes do tenant — clica pra ver a lista.

---

## 8. Negociações (Vendas)

Funil de vendas paralelo ao de locação:

### Etapas

1. **Lead** — comprador interessado, primeiro contato
2. **Visita** — agendada/realizada
3. **Proposta** — proposta enviada
4. **Em negociação** — troca de propostas
5. **Aceita** — proposta aceita
6. **Contrato** — contrato de compra/venda assinado
7. **Concluída** — escritura registrada
8. **Perdida** — comprador desistiu

### Como usar

1. Menu → **Negociações** → **"+ Nova negociação"**
2. Selecione **Comprador** (cadastrado em Compradores) e **Imóvel** (com finalidade venda)
3. Acompanhe o status conforme avança
4. Gere o **contrato de compra/venda** ao chegar em "Contrato"

---

## 9. Balancetes mensais

### Lançamentos

Por imóvel, mês a mês:

**Entradas:**
- Aluguel recebido
- Reembolsos (IPTU, condomínio pago pelo locatário)

**Saídas:**
- Taxa de administração (10% configurável)
- IPTU (se a imobiliária paga)
- Condomínio (se a imobiliária paga)
- Reparos
- Outros

### Leitura automática de boleto (Gemini)

1. Clique em **"📷 Ler boleto"**
2. Suba o PDF ou imagem do boleto
3. Aguarde o Gemini extrair: **valor, vencimento, beneficiário, linha digitável**
4. Revise os dados (você ainda pode editar)
5. Confirme → cria o lançamento e anexa o boleto

### 9a. IA multi-comprovante

🤖 **Novo em 2026-05** — Sobe **VÁRIOS comprovantes** num único arquivo e a IA processa todos de uma vez.

#### Como usar
1. No balancete aberto, botão **🤖 Ler comprovante** (no bloco Entradas ou Despesas)
2. **Arraste UM arquivo** com vários comprovantes (PDF multi-página ou imagem)
3. A IA processa em 15-30 segundos e detecta cada documento separadamente
4. Modal de revisão mostra **uma card por documento**:
   - Tipo: 💰 Comprovante de pagamento / 📄 Boleto a pagar / 🧾 Nota Fiscal / 📋 Recibo
   - Direção: 🟢 Entrada / 🔴 Saída / ⚠️ Ambíguo
   - Confiança: % (campos abaixo de 85% destacados em amarelo)
   - Sugestão de bloco + categoria
   - Toggle "Lançar este" (NF/Cupom vêm desmarcados — só lança comprovantes pagos)
5. **Vinculação automática ao contrato**: se o comprovante bate com aluguel + CPF do locatário, vincula sozinho (badge 🔗 verde)
6. Confirma → todos os lançamentos marcados entram no balancete de uma vez

#### Apuração em tempo real
Card **📊 Apuração em tempo real** no topo do balancete mostra sempre:
- 🟢 Receitas / 🔴 Despesas / 🧾 Taxa Adm / 💰 **LÍQUIDO ao locador**

Atualiza a cada lançamento (não precisa fechar pra ver o líquido).

### Fechamento

1. Verifique todos os lançamentos do mês
2. Botão **"Fechar balancete"**
3. Sistema gera o **PDF do balancete**
4. Envia automaticamente por e-mail ao locador (se configurado)
5. PDF + comprovantes ficam disponíveis pra download

### Repasse via Pix (Fase 4 — em planejamento)

Hoje: o sistema mostra **"Copiar chave Pix + valor"** pra transferência manual.

---

## 10. Vitrine pública

### Como divulgar

1. Configure o **slug** em Configurações (ex: `drglobal`)
2. Sua URL pública será:
   ```
   https://zett-romao.github.io/drg-rently/imoveis.html?t=drglobal
   ```
3. Compartilhe em WhatsApp, redes sociais, anúncios pagos

### O que aparece

- Logo da imobiliária
- Nome e dados de contato
- Cards de cada imóvel com:
  - Foto principal
  - Apelido, cidade/UF
  - Valor (ou "Sob consulta")
  - Quartos / banheiros / vagas / área

### Página individual

Cada imóvel tem sua própria página pública com:
- Galeria de fotos (lightbox)
- Detalhes
- Endereço resumido (sem número)
- Botões: WhatsApp, Telefone, E-mail
- Tour virtual 360° (se cadastrado)

### Filtros na vitrine

- Busca por palavra
- Locação / Venda
- Tipo (apartamento, casa, etc.)
- Quartos mínimos

---

## 11. Portais imobiliários

### O que é

Anúncios automáticos nos principais portais via XML feed. Você cadastra o
imóvel uma vez no DRG-Rently, ele aparece automaticamente em **ZAP, Viva,
OLX, Chaves na Mão**, etc.

### Como funciona

1. Você contrata um plano profissional no portal (cada portal cobra mensalidade própria)
2. O portal te pede uma URL de feed XML
3. Vá em **📡 Portais** → encontre o portal desejado → clique em **"📋 Copiar URL"**
4. Cole essa URL no painel do portal
5. Em algumas horas seus imóveis aparecem publicados
6. **Atualização automática a cada 10 minutos** (cache da CDN)

### Pré-requisitos

Pra um imóvel aparecer no feed:
- ✅ Toggle **"🌐 Publicar este imóvel"** ativado
- ✅ Toggle **"📤 Incluir no XML feed"** ativado (vem marcado por padrão)
- ✅ Tenant tem URL do Worker Feed configurada em Configurações

### Portais suportados

| Portal | Formato | Mensalidade |
|---|---|---|
| ZAP Imóveis | Zap XML | R$ 500–2.500 |
| Viva Real | Zap XML (mesmo do ZAP) | R$ 500–2.500 (incluso) |
| Imovelweb | XML Imovelweb | R$ 200–800 |
| OLX Imóveis | XML OLX | R$ 200–700 |
| Chaves na Mão | XML Wimoveis | R$ 100–300 |
| Órulo | Wimoveis | Sob consulta |
| DF Imóveis | Wimoveis | R$ 150–500 |
| SP Imóvel | Wimoveis | R$ 150–400 |
| DWV | Wimoveis | Sob consulta |
| Casa Mineira | Wimoveis | R$ 150–500 |
| **Loft** | ❌ Não aceita XML | Cadastro manual |
| **Mercado Livre** | ❌ Descontinuado em 2022 | — |

### Boas práticas

- **Capriche nas fotos**: mín. 6 fotos, boa iluminação. Anúncios sem foto têm 80% menos cliques.
- **Descrição longa detalhada**: bairro, comércio próximo, transporte, escolas
- **Valor honesto**: publique o valor real
- **Atualize sempre**: marque "alugado/vendido" rapidamente
- **Teste 2-3 meses**: foque nos portais que trazem retorno real

---

## 12. Operadores e perfis

### Como criar um operador

1. **Configurações** → role até **"👥 Usuários e perfis"**
2. Botão **"+ Adicionar usuário"**
3. Preencha: nome, e-mail, tipo de acesso, perfil customizado
4. **Tipo**:
   - **Administrador**: acesso total ao tenant
   - **Operador**: acesso limitado pelo perfil
5. **Senha inicial**: gerada automaticamente (ou você define)
6. ✅ "Enviar e-mail ao usuário" (recomendado)

### Como criar um perfil customizado

1. **Configurações** → seção **"Perfis e permissões"**
2. Botão **"+ Novo perfil"**
3. **Nome**: ex: "Captador", "Financeiro", "Atendente"
4. Marque os checkboxes dos módulos que esse perfil pode acessar
5. Salvar

### Exemplos práticos de perfis

| Perfil | Módulos típicos |
|---|---|
| Captador | Locadores, Imóveis, Fotos |
| Atendente | Locatários, Compradores, Negociações |
| Financeiro | Contratos, Balancetes, Relatórios |
| Marketing | Vitrine Pública, Portais |

### Vincular operador a perfil

Ao criar/editar um operador, escolha o perfil customizado no select.
Operadores sem perfil usam o padrão (todos os cadastros e operação).

---

## 13. Importação CSV em massa

Pra cadastros em volume:

1. Menu → **Importação CSV**
2. Selecione a entidade: Locadores / Locatários / Imóveis
3. **Baixe o template CSV** (já com cabeçalhos corretos)
4. Preencha no Excel/Google Sheets
5. Salve como CSV (separador vírgula, UTF-8)
6. **Subir arquivo** → veja o preview
7. Confirme → todos são criados

⚠️ **Atenção**: revise o preview antes de confirmar. Linhas com erro são marcadas em vermelho.

---

## 14. Alertas e relatórios

### Alertas (proativos)

- 🔔 **Contratos vencendo** (próximos 90 dias)
- 🔔 **Garantias expirando** (seguros fiança)
- 🔔 **Balancetes não fechados** (mês corrente passado do dia 5)
- 🔔 **Locatários em análise há +7 dias**
- 🔔 **Imóveis disponíveis há +60 dias** (sugestão de baixar preço)

### Relatórios

- 💰 **Receita por período** (taxa de administração capturada)
- 🏠 **Ocupação por imóvel** (% tempo locado)
- 👤 **Performance por captador** (operador que cadastrou)
- 📊 **Distribuição de contratos** (por faixa de valor, tipo)

Exporta tudo em CSV ou PDF.

### 14a. Card "🚨 Contratos atrasados"

Detecta contratos com aluguel inadimplente:
- **Automaticamente**: olha balancete do mês anterior — se não tem entrada de aluguel, considera atrasado
- **Manualmente**: você marca um contrato como atrasado pelo botão `inadimplente`

Card no Dashboard mostra o total — clica pra ver a lista clicável de devedores.

### 14b. Cards "🤖 IA" no Dashboard

✨ **Novo em 2026-05** — Visibilidade do ROI da IA:

- **🤖 Contratos via IA (este mês)**: conta contratos criados pelo Wizard (`geradoPorWizard`) + importados via IA (`importadoPorIA`)
- **📑 Comprovantes via IA (este mês)**: conta lançamentos no balancete lidos pelo Gemini multi-comprovante

Mostra quanto tempo a IA está economizando pro escritório.

---

## 15. LGPD e auditoria

### O que o sistema garante

- **Multi-tenant isolado**: dados de uma imobiliária nunca vazam pra outra
- **Logs imutáveis** (auditoria): toda ação sensível é registrada por 5 anos
- **Páginas públicas**: dados pessoais sempre ocultos
- **Backup automático**: Firebase faz backup contínuo
- **Criptografia em trânsito**: HTTPS obrigatório

### Como ver os logs

Menu → **Auditoria** (admin only)

Filtra por:
- Entidade (locador, locatário, contrato, etc.)
- Ação (criação, atualização, exclusão, login)
- Período

Mostra os últimos 200 registros. Logs são imutáveis (não podem ser apagados nem editados).

---

## 16. Monitor legislativo

🤖 **Novo em 2026-05** — Vigia diariamente o **Planalto** e te avisa quando lei relevante mudar.

### Como funciona

1. **Cron diário às 7h (Brasília)**: um robô (Cloudflare Worker) baixa as páginas das leis monitoradas:
   - Lei do Inquilinato (Lei 8.245/91)
   - Código Civil (artigos relevantes)
   - LGPD
   - Outras URLs do Planalto cadastradas
2. Compara com a versão anterior salva no KV (banco-chave-valor do Cloudflare)
3. **Se detecta mudança**: chama o **Gemini** pra analisar o impacto:
   - Classifica em **Alto / Médio / Baixo**
   - Resume em linguagem clara o que mudou
   - Sugere ações pra imobiliária
4. **Envia e-mail** pra DRG (e pra você, se configurar)
5. **Histórico** fica salvo em `tenants/{id}/legisAlertas` pra você consultar

### Onde ver

**Configurações → Monitor legislativo** (admin only)
- Status: 🟢 Ativo · 🟡 Sem mudanças hoje · 🔴 Erro
- Última execução
- Lista de alertas recentes (clica pra ver detalhes da análise IA)
- Botão **🔄 Executar agora** (forçar análise sem esperar cron)

### Vantagem competitiva

Concorrentes (Superlógica, Group Software) **não têm isso**. Argumento de venda: *"o DRG-Rently te avisa antes da Receita mudar a Lei do Inquilinato"*.

---

## 17. App mobile (PWA)

📱 **Novo em 2026-05** — O DRG-Rently se instala como **app nativo** no celular.

### Como instalar

#### Android (Chrome / Edge / Firefox)
1. Abre **https://zett-romao.github.io/drg-rently/** no celular
2. Aparece banner **"📱 Instale o DRG-Rently"** no rodapé
3. Toca em **"Instalar"** → confirma
4. Ícone do app aparece na tela inicial
5. Abre o app → roda sem barra de URL, em tela cheia

#### iOS (Safari)
1. Abre o app no Safari
2. Toca no ícone de **compartilhar** (quadrado com seta pra cima)
3. **"Adicionar à Tela de Início"**
4. Confirma

### Recursos do PWA

- **Funciona offline** (cache inteligente — mas sem internet, não consegue salvar)
- **Atalhos longos no ícone**:
  - 📊 Dashboard
  - 🏢 Novo Imóvel
  - 🌐 Vitrine Pública
- **Atualizações automáticas** — banner "🔄 Nova versão disponível!" aparece
- **Notificações push** (em desenvolvimento — backend já pronto)

### Layout mobile

- **Sidebar** vira menu hamburger (☰) que desliza da esquerda
- **Tabelas** com scroll horizontal
- **Modais** em tela cheia
- **Cards** se reorganizam em uma coluna

---

## 18. Manutenção administrativa

🛠 **Novo em 2026-05** — Em **Configurações → 🛠 Manutenção (administrador)**:

### Renumerar contratos / negociações

Renumera **todos** os contratos (ou negociações) em ordem cronológica:
1. Sistema busca todos os registros do tipo
2. Ordena por `criadoEm` ASC
3. Renumera: 00001, 00002, 00003…
4. Atualiza o contador de sequência

**Quando usar**:
- Tenant migrou de outro sistema e contratos antigos não têm número
- Quer "limpar" a sequência depois de muitas exclusões
- Quer começar do zero (zerar e renumerar)

⚠️ **Cuidado**:
- **Ação irreversível** (não tem desfazer)
- Confirma 2 vezes (clique + digitar "RENUMERAR")
- Recomendado: backup antes via Firebase Console
- Restrito a role `admin` ou `super_admin`

---

## 19. Solução de problemas

### "Missing or insufficient permissions"
→ Suas regras Firestore podem estar desatualizadas. Contate o suporte D.R. Global.

### "Erro ao carregar perfil"
→ Sua conta pode estar desativada. Contate o admin da sua imobiliária.

### "Esta conta está suspensa"
→ O plano da imobiliária está inadimplente. Contate a D.R. Global.

### Imagens não carregam
→ Verifique se você está no plano Blaze (Firebase Storage requer plano pago).

### XML feed retorna erro
→ Verifique se a URL do Worker está correta em Configurações.

### Boleto não é lido pelo Gemini
→ Verifique a URL do Worker Gemini. Se falhar, lance o boleto manualmente.

### E-mail de balancete não chega
→ Verifique o e-mail "from" (deve ser de domínio verificado no Resend).

### Esqueci minha senha
→ Tela de login → link "Esqueci minha senha" → siga as instruções por e-mail.

---

## 🆘 Suporte

**D.R. Global Multi Services**
- 📧 E-mail: zett.romao@gmail.com
- 🌐 Site: drglobal.com.br
- 📱 WhatsApp: (consulte com seu vendedor)

**Horário de atendimento:**
- Segunda a sexta: 9h às 18h
- Resposta em até 24h úteis

---

## 📚 Glossário

| Termo | Significado |
|---|---|
| **Tenant** | Cada imobiliária cliente do SaaS |
| **Operador** | Usuário comum da imobiliária |
| **Admin** | Usuário com acesso total ao tenant |
| **Super Admin** | Equipe D.R. Global (gestão do SaaS) |
| **Perfil** | Conjunto de permissões customizáveis |
| **Pacote** | Conjunto de módulos contratados (Locação/Venda/Completo) |
| **Vitrine** | Página pública com os imóveis publicados |
| **Feed XML** | Endpoint que portais consomem pra puxar seus imóveis |
| **Slug** | Nome amigável da URL pública (ex: `drglobal`) |
| **Worker** | Cloudflare Worker (proxy pra APIs externas) |

---

**🏠 Boa operação com o DRG-Rently!**
*— Equipe D.R. Global Multi Services*

---

## 📑 Apêndice — Detalhes das novidades v1.4

### 4a. Locadores / Vendedores (cadastro unificado)

**O que mudou:** o cadastro de "Locadores" virou **"Locadores / Vendedores"**. Cada pessoa cadastrada tem checkbox indicando se atua como:

- 🏠 **Locador** (proprietário que aluga imóveis)
- 💼 **Vendedor** (proprietário que vende imóveis)
- 🔁 **Ambos** (atua nos dois papéis)

**Como funciona:**

1. **+ Novo Locador/Vendedor** → na caixa "Esta pessoa pode atuar como" marca um ou os dois
2. Validação: pelo menos UM papel deve estar marcado
3. Na lista, aparece um **chip colorido** ao lado do nome indicando os papéis
4. **Filtros rápidos**: [Todos | 🏠 Só locadores | 💼 Só vendedores]

**Impacto nos modais:**

- **Modal de Contrato** (locação) → select de "Locador" filtra automaticamente só quem tem `papel.locador=true`
- **Modal de Negociação** (venda) → select de "Vendedor" filtra só quem tem `papel.vendedor=true`

**Compatibilidade com cadastros antigos:** se o cadastro foi feito antes da v1.4 e não tem o campo `papeis`, o sistema assume **ambos os papéis ativos** (não quebra nada).

### 4b. IA preenche cadastros

Nos modais de **Locador, Locatário e Comprador**, há uma caixa roxo-claro com 🤖 **"Preencher automaticamente com IA"**:

1. Clica **📎 Anexar documento**
2. Escolhe um arquivo: PDF, JPG, PNG, WebP
3. Documentos aceitos:
   - RG (frente e verso)
   - CNH (Carteira Nacional de Habilitação)
   - CPF (cartão ou comprovante)
   - Carteira de Trabalho (CTPS)
   - Comprovante de residência (luz, água, telefone, contrato)
   - Cartão CNPJ ou Contrato Social (PJ)
   - Selfie com documento
4. Em ~10-20s a IA lê o documento e preenche:
   - Tipo (PF/PJ) — dispara onChange automaticamente
   - Nome / Razão social
   - CPF/CNPJ (com máscara)
   - RG (com órgão expedidor)
   - Data de nascimento
   - Estado civil, profissão, nacionalidade
   - E-mail e telefone
   - Endereço completo
5. **Sempre confira os dados antes de salvar** — a IA é precisa mas pode confundir caracteres em fotos de baixa qualidade

**Privacidade:** o documento é enviado para o Worker Gemini (Cloudflare → Google Gemini Vision API) e **não é armazenado** após a extração. Apenas os dados estruturados ficam no Firestore.

### 5a. Fotos do imóvel

3 melhorias importantes:

**1. Drag & drop pra subir:**
- Arrasta arquivos do desktop direto pra zona "Fotos do imóvel"
- Aparece overlay "📷 Solte aqui pra fazer upload"
- Múltiplos arquivos de uma vez

**2. Drag & drop pra reordenar:**
- Clica e arrasta uma foto pra qualquer posição
- A **primeira foto da lista vira a capa do anúncio** (badge dourado 👑 Capa)
- A nova ordem é salva automaticamente no Firestore

**3. Auto-rascunho:**
- Antes: o card de fotos só aparecia DEPOIS de salvar o imóvel completo
- Agora: o card aparece já na criação
- Quando você anexa a primeira foto sem ter completado os dados:
  - Sistema cria automaticamente um **rascunho** com flag `rascunho:true`
  - Mostra mensagem "📋 Imóvel salvo como rascunho. Complete os campos antes de publicar"
  - As fotos seguintes já vinculam ao mesmo imóvel
- Rascunhos aparecem na lista com **chip 📋 rascunho** e opacity reduzida

### 5b. Filtros da tabela (Imóveis)

Na seção Imóveis há agora 2 linhas de filtros em chips:

**Linha 1 — Finalidade:**
- [Todos] [🏠 Locação] [💼 Venda] [🔁 Ambos]

**Linha 2 — Status:**
- [Todos] [🟢 Disponível] [🏘 Alugado] [💰 Vendido] [🔧 Em reforma]

Os filtros combinam (AND). Exemplo: **🏠 Locação + 🟢 Disponível** = só os imóveis pra alugar que estão livres no momento.

Coluna nova "Finalidade" com chips coloridos. Coluna "Valor" mostra o valor adaptado à finalidade:
- Locação: `R$ 2.500/mês`
- Venda: `R$ 450.000`
- Ambos: ambos os valores

### 9b. Taxa de administração configurável

No modal de Balancete, dentro do bloco "🧾 Taxa de administração", há um novo select **"Incidência da taxa"** com 3 opções:

1. **Sobre o aluguel base** (padrão) — taxa só sobre o aluguel-base do contrato
2. **Sobre TODAS as verbas de receita** — taxa sobre entradas + reembolsos
3. **Sobre verbas selecionadas** — abre lista de checkboxes; você marca quais receitas entram

O valor da taxa recalcula em tempo real.

### 9c. Asaas no balancete

**Setup uma vez (em Configurações):**
- URL do Worker Asaas (botão **🔗 Preencher automaticamente** facilita)
- Sua chave API Asaas (botão **↗ pegar no Asaas** abre o painel)
- **🧪 Testar conexão** → ✅ deve aparecer nome da sua conta
- **💰 Ver saldo Asaas** → mostra saldo disponível

**No modal de Balancete (caixa azul-claro no rodapé):**

- **💳 Cobrar locatário via Asaas** — cria PIX/boleto automaticamente com o total das entradas, vencimento +10 dias. Retorna link da fatura pro locatário pagar.
- **💸 Pagar locador (PIX)** — transfere o valor líquido pra chave PIX cadastrada no locador. Detecta tipo da chave (CPF/CNPJ/EMAIL/PHONE/EVP) automaticamente.

**Segurança:** cada imobiliária usa SUA própria chave Asaas. A D.R. Global **não vê** seus pagamentos.

### 10a. Tabs da vitrine

A vitrine pública (`imoveis.html`) agora tem 3 tabs visíveis no topo:

- **🏘 Todos os imóveis** — cor slate (padrão)
- **🏠 Para Alugar** — cor **teal** (verde-azulado)
- **💼 Para Comprar** — cor **âmbar/dourada**

Cada tab muda:
- A cor do hero (banner do topo)
- O título da página: "Imóveis para Alugar" vs "Para Comprar"
- O título da aba do navegador (SEO + bookmark)
- O filtro aplicado

**Links compartilháveis em Configurações:**
- Vitrine geral → `imoveis.html?t=slug`
- 🏠 Só Aluguel → `imoveis.html?t=slug&finalidade=locacao`
- 💼 Só Venda → `imoveis.html?t=slug&finalidade=venda`

Cada link tem botões **📋 Copiar** e **↗ Abrir**.

### 10b. Captação de leads

No header da vitrine pública aparece o botão **📤 Anuncie seu imóvel** (gradient âmbar). Clica:

1. Abre modal com formulário:
   - Nome + WhatsApp (obrigatórios)
   - E-mail (opcional)
   - Quero: 🏠 Alugar / 💼 Vender / 🏘 Tanto faz
   - Tipo do imóvel
   - Cidade / bairro
   - Descrição livre
2. Envia → cria documento na coleção `tenants/{id}/leadsImoveis` com status `novo`
3. Mensagem de sucesso "✅ Vai entrar em contato em 1 dia útil"

Os leads ficam armazenados no Firestore. Uma futura versão terá uma seção "📥 Leads" no painel admin pra gerenciá-los.

### 10c. WhatsApp FAB

Bolinha verde fixa no canto inferior direito, em **todas as páginas públicas** (vitrine + página individual do imóvel).

- Logo oficial do WhatsApp
- Animação pulse suave
- Lê o campo "Telefone / WhatsApp" do seu tenant em Configurações
- Adiciona DDI 55 (Brasil) automaticamente
- Mensagem pré-preenchida:
  - Vitrine: *"Olá, [imobiliária]! Vim pela vitrine de imóveis..."*
  - Página do imóvel: *"...Tenho interesse no imóvel [apelido]."*
- **Some** se você não tiver telefone cadastrado

### 14b. Painel de alertas no Dashboard

Logo abaixo dos cards de KPI no Dashboard, há um **painel resumido** com:

**3 contadores grandes coloridos** (clicáveis):
- 🚨 **Crítico** — vermelho
- ⚠️ **Atenção** — âmbar
- ℹ️ **Info** — azul

**Top 5 alertas** ordenados por gravidade:
- 🚨 Contratos vencidos / vencendo em ≤30 dias
- ⚠️ Locatários pendentes há ≥5 dias
- ⚠️ Negociações abertas há ≥15 dias
- ⚠️ Garantias vencendo em 60 dias
- ℹ️ Contratos sem balancete do mês
- ℹ️ Imóveis em rascunho (5a)

Cada alerta é clicável e leva direto à seção correspondente.

Se total > 5: aparece link "+N alertas. Ver todos →" que abre a seção Alertas completa.

Se zero: ✅ "Tudo em dia! Nenhuma pendência detectada no momento."

### 19. Login biométrico (Passkeys)

**Pré-requisito do dispositivo:**
- Windows: **Windows Hello** configurado (Configurações → Contas → Opções de entrada)
- Mac: **Touch ID** ou **Face ID** ativo
- Android/iOS: biometria do sistema

**Como cadastrar (1 vez por dispositivo):**

1. Faça login normalmente (e-mail + senha)
2. ⚙️ Configurações → role até **"🔐 Login com biometria (Passkeys)"** (banner verde)
3. Clique **🔐 Cadastrar biometria neste dispositivo**
4. O navegador pede biometria → olhe pra câmera ou coloque o dedo
5. ✅ Cadastrada!

**Como logar com biometria:**

1. Na tela de login, abaixo do botão "Entrar" aparece **🔐 Entrar com biometria**
2. Clica → SO pede biometria → entra direto, sem digitar senha

**Privacidade:**
- Os dados biométricos **NUNCA saem do seu dispositivo**
- O servidor só recebe um **token criptográfico** assinado
- Padrão W3C WebAuthn — mesma tecnologia que bancos e Big Tech estão adotando
- **LGPD compliant** (não há armazenamento centralizado de biometria)

**Gerenciar passkeys cadastradas:**
- Configurações → "🔐 Login com biometria" → **↻ Recarregar lista**
- Cada passkey mostra data de cadastro e tipo (☁ sincronizada / 🔒 só este dispositivo)
- Botão 🗑 Remover por passkey

### 20. Solução de problemas (atualizada)

**"Recém-loguei mas o sidebar mostra outra imobiliária"**
- Você é Super Admin e o sistema escolheu o tenant errado
- Super Admin → linha do seu tenant → **🎯 Operar aqui** (azul)
- Opcional: **🏠 Marcar como meu** (fixa esse tenant como padrão pra futuros logins)

**"Failed to fetch" em Asaas, Legis ou outros Workers**
- Provavelmente cache do navegador
- **Ctrl+Shift+R** força reload sem cache
- Persistindo: F12 → Application → Storage → "Clear site data" → recarrega

**"Apelido / Identificação é obrigatório" no salvar imóvel**
- Você não preencheu o campo "Apelido" no topo do modal
- A mensagem agora aparece **logo acima do botão Salvar**
- O sistema rola automaticamente até o campo e pisca a borda em vermelho 3x
- Preenche → salva

**"As 3 fotos que arrastei ficaram fora de ordem"**
- Clica e arrasta cada uma pra posição desejada
- A primeira sempre vira a 👑 Capa do anúncio público
- A ordem é salva automaticamente

**"O WhatsApp FAB não aparece na vitrine"**
- Configurações → seção "Contato público" → preencha o campo **"Telefone / WhatsApp"**
- Aceita formatos: `(11) 99999-9999`, `11999999999`, `+5511999999999`
- O sistema adiciona DDI 55 automaticamente se faltar

**"Passkey diz 'navegador não suporta'"**
- Atualize o Chrome/Edge pra versão 108+
- Confirme que tem **Windows Hello** configurado (Configurações → Contas → Opções de entrada → Reconhecimento facial / digital)
- Em alguns laptops sem câmera infravermelha o Hello facial não funciona — use leitor de digital

---

**🏠 Versão 1.4 — boa operação com o DRG-Rently!**
*— Equipe D.R. Global Multi Services*
