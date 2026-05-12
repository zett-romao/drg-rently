# 📘 Manual de Operação — DRG-Rently

**Versão:** 1.1
**Atualizado em:** 2026-05-13
**Para quem:** Imobiliárias (PJ) e Corretores Autônomos (PF) clientes da D.R. Global

> 💡 O DRG-Rently atende **tanto Pessoa Jurídica** (imobiliárias) **quanto
> Pessoa Física** (corretores autônomos com CRECI). Os fluxos são os mesmos —
> apenas o cadastro inicial muda.

---

## Sumário

1. [Primeiro acesso](#1-primeiro-acesso)
2. [Conhecendo a interface](#2-conhecendo-a-interface)
3. [Configurações iniciais (importantíssimo)](#3-configurações-iniciais-importantíssimo)
4. [Cadastros — quem é quem no sistema](#4-cadastros)
5. [Imóveis — coração do sistema](#5-imóveis)
6. [Garantias](#6-garantias)
7. [Contratos](#7-contratos)
8. [Negociações (Vendas)](#8-negociações-vendas)
9. [Balancetes mensais](#9-balancetes-mensais)
10. [Vitrine pública](#10-vitrine-pública)
11. [Portais imobiliários (XML Feed)](#11-portais-imobiliários)
12. [Operadores e perfis customizados](#12-operadores-e-perfis)
13. [Importação CSV em massa](#13-importação-csv-em-massa)
14. [Alertas e relatórios](#14-alertas-e-relatórios)
15. [LGPD e auditoria](#15-lgpd-e-auditoria)
16. [Solução de problemas](#16-solução-de-problemas)

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

## 16. Solução de problemas

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
