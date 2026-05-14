# DRG-Rently — Prompt do Projeto

**Última atualização:** 2026-05-14
**Versão atual:** 0.4.0
**Estado:** ✅ SaaS em produção — multi-tenant + portais + biometria + IA + Asaas tenant

> Documento serve como ponto de partida pra qualquer pessoa (ou IA) que vai
> retomar o projeto. Cole no início de uma conversa nova ou leia antes de
> mexer no código.

## 🆕 Mudanças notáveis 2026-05-14 (v0.4.0)

- **🔐 Login biométrico (Passkeys)** — Worker drg-rently-passkey + `@simplewebauthn/server`
- **💳 Asaas multi-tenant** — Worker `drg-rently-asaas` ganhou rotas `/tenant/*` (cada imobiliária com sua chave)
- **🤖 IA preenche cadastros** — modo `documento_pessoa` no Worker Gemini, dropzone em 3 modais
- **🏠💼 Locador/Vendedor unificado** — campo `papeis: {locador, vendedor}` + filtros
- **🏷 Vitrine pública com tabs Aluguel/Venda** + WhatsApp FAB + captação de leads
- **🗄 Arquivar / Restaurar / Excluir tenants** — soft + hard delete com proteção
- **🎯 Operar aqui / Marcar como meu** — Super Admin escolhe tenant ativo persistido
- **📷 Fotos: drag&drop subir + reordenar + auto-rascunho + badge Capa**
- **🧾 Taxa adm configurável** (aluguel/verbas/todas)
- **📊 Painel de alertas no Dashboard**
- **📥 Importação CSV redesenhada** (4 passos visuais + dropzone)
- **📰 CRUD de URLs do monitor legislativo** via painel
- **📝 Editor de perguntas do wizard** (override por tenant)
- **🎨 Mensagens contextuais inline** (sweep UX em modais)

---

## 1. O que é

Sistema **SaaS B2B multi-tenant** pra **gestão de locações e vendas de imóveis residenciais
e comerciais**. Atende imobiliárias que administram imóveis de terceiros (locadores)
e os disponibilizam para inquilinos (locatários) ou compradores, com garantia
(fiador / caução / seguro fiança) e contrato vigente.

### Modelo de negócio

Mesmo codebase atende três modos:

- **A — Operação própria:** o dono opera como imobiliária; D.R. Global Imóveis
  é um tenant dentro do SaaS principal.
- **B — SaaS multi-cliente:** outras imobiliárias assinam plano; cada uma vira
  um tenant isolado. Cobrança hoje é manual (super-admin suspende/ativa pelo
  painel); Stripe/MP fica pra fase posterior.
- **C — Self-hosted (pen drive):** mesmo código distribuído pra cliente que
  prefere rodar no Firebase próprio. Pasta `INSTALACAO/` contém kit completo.

### Fluxo operacional (negócio)

1. Locador assina autorização de administração → vira `locador` do tenant
2. Imobiliária capta locatário, examina ficha sócio-econômica → status `aprovado`
3. Define garantia: fiador / caução / seguro fiança
4. Contrato vincula os três + imóvel, prazo 6/12/24/36 meses
5. Multa rescisória padrão = 3× valor do aluguel (editável)
6. Taxa de administração padrão = 10% (editável por contrato)
7. Flag "1º aluguel para o escritório" quando a captação foi da imobiliária
8. Mensalmente: balancete por imóvel → PDF + envio ao locador (Resend) ✅
9. Repasse do líquido via Pix *(Fase 4 — planejado)*
10. Anúncios automáticos nos portais via XML feed (ZAP/Viva/OLX/etc.) ✅

---

## 2. Stack e infraestrutura

- **Frontend:** HTML/CSS/JS puro (sem framework). Paleta slate-blue `#475569`
  fotofobia-friendly.
- **Backend:** Firebase (Auth + Firestore + Storage) — plano Blaze ativo.
- **Hosting:** GitHub Pages em `https://zett-romao.github.io/drg-rently/`
- **APIs externas via Cloudflare Workers** (7+ deployados):
  - `drg-rently-resend` — envio de e-mail via Resend (balancetes, leads)
  - `drg-rently-gemini` — Gemini Vision com 4 modos (boleto, contrato, multi, documento_pessoa)
  - `drg-rently-feed` — gera XML feed pros portais imobiliários
  - `drg-rently-zapsign` — proxy de assinatura eletrônica (cada tenant com sua chave)
  - `drg-rently-legis-monitor` — monitor diário Planalto (cron) + endpoints CRUD URLs
  - `drg-rently-passkey` — WebAuthn (passkeys) + emite custom token Firebase (RS256)
  - `drg-rently-asaas` — Asaas dual-auth (admin DRG p/ mensalidade SaaS + tenant p/ cobrança própria)
  - `drg-rently-telemetria` — opcional (instâncias self-hosted Modelo C)
- **Domínio do e-mail:** `drglobal.com.br` verificado no Resend (SPF + DKIM).
  Remetente final: `balancetes@drglobal.com.br`.

### Repositório

- **GitHub:** `zett-romao/drg-rently` (público)
- **Pasta local:** `G:\Meu Drive\DRG-Rently\`
- **Branch principal:** `main`
- **Cache buster atual:** `?v=20260512o`

---

## 3. Estrutura de dados (Firestore)

### Coleções globais

- **`users/{uid}`** — dados do usuário (vinculado ao Auth UID)
  - `nome`, `email`, `role` (`super_admin` / `operador_drg` / `admin` / `operador`)
  - `tenantId` (null se equipe DRG; preenchido se é admin/operador de tenant)
  - `perfilId` — perfil customizado (operador de tenant)
  - `drgPerfilId` — perfil customizado DRG (operador_drg)
  - `ativo` (bool)

- **`tenants/{tenantId}`** — uma imobiliária OU corretor autônomo
  - `nome` (razão social se PJ, nome completo se PF)
  - `tipoPessoa` (`PJ` ou `PF`) ✨ **NOVO**
  - `cnpj` (se PJ) OU `cpf` (se PF) ✨ **NOVO** — só um dos dois preenchido
  - `creci`, `slug`, `telefone`, `emailContato`
  - `plano` (`trial` / `basic` / `pro`), `valorMensalidade`, `proximoVencimento`
  - `pacote` (`locacao` / `venda` / `completo` / `custom`)
  - `modulosHabilitados` (array de strings)
  - `logoUrl` (logo customizada do tenant)
  - `ativo` (bool)

- **`drgPerfis/{perfilId}`** ✨ **NOVA** — perfis customizáveis pra equipe DRG
  - `nome`, `modulos` (array de áreas administrativas permitidas)

- **`auditoria/{logId}`** — logs imutáveis para LGPD

### Subcoleções por tenant

- **`tenants/{tid}/locadores/{id}`** — proprietários dos imóveis
- **`tenants/{tid}/locatarios/{id}`** — inquilinos
- **`tenants/{tid}/compradores/{id}`** — interessados em comprar
- **`tenants/{tid}/garantias/{id}`** — fiadores, caução, seguro fiança
- **`tenants/{tid}/imoveis/{id}`** — imóveis cadastrados
  - Campos extras pra portais: `descricaoLonga`, `videoUrl`, `tourUrl`, `vitrineFeed`
- **`tenants/{tid}/imoveis/{id}/fotos/{id}`** — fotos públicas
- **`tenants/{tid}/imoveis/{id}/docs/{id}`** — documentos (privados)
- **`tenants/{tid}/contratos/{id}`** — contratos de locação OU venda
- **`tenants/{tid}/negociacoes/{id}`** — funil de vendas
- **`tenants/{tid}/balancetes/{id}`** — fechamento mensal
- **`tenants/{tid}/pagamentos/{id}`** — histórico de mensalidades pagas
- **`tenants/{tid}/perfis/{id}`** — perfis customizáveis do tenant
- **`tenants/{tid}/config/site`** — configurações gerais

---

## 4. Funcionalidades por módulo

### Visão Geral
- 📊 **Dashboard** — KPIs principais + drag-and-drop dos cards
- 🔔 **Alertas** — vencimentos, garantias expirando, contratos a renovar
- 📈 **Relatórios** — receita, ocupação, comissões

### Cadastros
- 🏠 **Locadores** — proprietários (auto-fill por CNPJ via BrasilAPI)
- 👤 **Locatários** — inquilinos (ficha sócio-econômica + documentos)
- ✍️ **Compradores** — funil de vendas (interessados em compra)
- 🛡 **Garantias** — fiadores / caução / seguro fiança
- 🏢 **Imóveis** — endereço (CEP automático via ViaCEP), fotos com watermark, documentos

### Operação
- 📝 **Contratos** — geração em Word/PDF/texto, templates customizáveis
- 🤝 **Negociações** — funil de vendas + contrato compra/venda
- 💰 **Balancetes** — fechamento mensal, leitura de boleto via Gemini, envio por e-mail
- 🌐 **Vitrine Pública** — link compartilhável por tenant (slug ou ID)
- 📡 **Portais** — XML feed pra ZAP/Viva/OLX/Imovelweb/Wimoveis (12 portais documentados)

### Administração
- 📥 **Importação CSV** — em massa pra locadores/locatários/imóveis
- 📜 **Auditoria** — logs imutáveis (LGPD)
- ⚙️ **Super Admin** — painel SaaS (só visível pra equipe DRG)
- 🔧 **Configurações** — usuários, perfis, logo, templates, workers

---

## 5. Permissões e perfis

### Roles do sistema

| Role | Contexto | O que pode fazer |
|---|---|---|
| `super_admin` | Equipe DRG | Acesso total (SaaS + tenant) |
| `operador_drg` | Equipe DRG | Painel SaaS limitado por perfil DRG |
| `admin` | Tenant | Acesso total ao próprio tenant |
| `operador` | Tenant | Limitado por perfil do tenant |

### Pacotes por tenant (módulos contratados)

- **🏠 Locação** — só locações (sem vendas)
- **💼 Venda** — só vendas (sem locações)
- **🌟 Completo** — locação + venda
- **⚙️ Customizado** — Super Admin escolhe checkboxes

### Áreas DRG (módulos pra operador_drg)

- `drg_dashboard` — Dashboard / KPIs
- `drg_tenants_view` — Ver imobiliárias
- `drg_tenants_edit` — Editar plano e módulos
- `drg_tenants_pagamentos` — Gerenciar pagamentos
- `drg_tenants_atuar_como` — Atuar como cliente
- `drg_equipe` — Gerenciar equipe DRG

---

## 6. Branding dinâmico

- **Equipe DRG no painel Super Admin** → sidebar exibe `DRG-Systems` / `DevOps`
  + logo D.R. Global padrão
- **Equipe DRG "atuando como" um tenant** → sidebar exibe `DRG-Rently` / nome
  do tenant + logo customizada
- **Admin/operador do tenant** → idem (DRG-Rently + nome do tenant)

---

## 7. Workers Cloudflare (URLs em produção)

| Worker | URL | Função |
|---|---|---|
| Resend | `https://drg-rently-resend.zett-romao.workers.dev` | Envio de e-mail |
| Gemini | `https://drg-rently-gemini.zett-romao.workers.dev` | Leitura de boletos |
| Feed | `https://drg-rently-feed.zett-romao.workers.dev` | XML feed pros portais |

### Secrets configurados (por Worker)

- Resend: `RESEND_API_KEY`
- Gemini: `GEMINI_API_KEY`
- Feed: `FIREBASE_API_KEY`, var `PROJECT_ID=drg-rently`

---

## 8. Portais Imobiliários — XML Feed

### Formatos suportados pelo Worker `drg-rently-feed`

| Formato | Portais que aceitam |
|---|---|
| `wimoveis` (default) | Chaves na Mão, DF Imóveis, SP Imóvel, Casa Mineira, Órulo, DWV, regionais |
| `zap` | ZAP Imóveis, Viva Real |
| `olx` | OLX Imóveis |
| `imovelweb` | Imovelweb |

### Não aceitam XML

- **Loft** — captação direta, cadastro manual
- **Mercado Livre Imóveis** — categoria descontinuada em 2022

### Como usar

```
https://drg-rently-feed.zett-romao.workers.dev/?tenant=<id-ou-slug>&format=<wimoveis|zap|olx|imovelweb>
```

Filtros aplicados:
- Imóveis com `linkPublico === true`
- Imóveis com `vitrineFeed !== false` (toggle do operador)
- Máximo 500 imóveis/tenant, 30 fotos/imóvel
- Cache CDN: 10 minutos

---

## 9. Histórico de implementação (commits relevantes)

| Commit | Descrição |
|---|---|
| `840ae8f` | Logo customizada por tenant + perfis customizáveis com permissões |
| `f1cbc38` | Tela informativa de integração com portais imobiliários (Fase 1) |
| `08da279` | Módulos customizáveis por tenant + equipe DRG com perfis |
| `dae6361` | Marca dinâmica conforme contexto (SaaS vs tenant) |
| `a50bf17` | Fase 2 — XML Feed gerador via Cloudflare Worker |

---

## 10. Pendências / Roadmap

### Curto prazo

- 🟡 Marcar imóveis publicados com toggle "Incluir no feed XML" (UX automático)
- 🟡 Conectar URL do Worker Feed em Configurações de cada tenant

### Fase 3 dos Portais (planejado)

- Painel de monitoramento (última sincronização, erros, imóveis publicados por portal)
- Webhooks de recebimento de leads dos portais → criar negociações no CRM

### Fase 4 — Pix (planejado)

- Integração com PSP (BB, Itaú, Sicredi, Asaas, Efí, Cora — a definir)
- Repasse automático do líquido ao locador via chave Pix
- Requer certificado mTLS, OAuth, conta jurídica habilitada

### Cobrança da assinatura (planejado)

- Stripe ou Mercado Pago
- Plano por número de imóveis administrados
- Hoje: cobrança manual; super-admin suspende/ativa pelo painel

---

## 11. Estilo de comunicação que o usuário prefere

- Português direto, sem rodeios
- Diagnósticos curtos antes de propor solução
- Passo a passo numerado quando há trabalho de UI
- Termos técnicos OK (ele entende: Firestore, Worker, Auth, etc.)
- Erros: mostrar o problema, depois a correção
- Não inventar requisitos — perguntar quando ambíguo

---

## 12. Convenções de código

- **Commits:** Conventional Commits + Co-Authored-By Claude
- **Cache busting:** `?v=YYYYMMDDx` em `index.html` (bumpar a cada deploy de JS/CSS)
- **Funções no `app.js`:** prefixadas por entidade (`loadLocadores`, `saveImovel`)
- **IDs HTML:** kebab-case (`imovel-apelido`, `cfg-worker-feed-url`)
- **Constantes globais:** SCREAMING_SNAKE (`MODULOS_DISPONIVEIS`, `TENANT_PACOTES`)

---

## 13. Como retomar

1. Leia este documento por inteiro
2. Olhe os 5 commits mais recentes: `git log --oneline -5`
3. Confira `CLAUDE.md` pra detalhes técnicos (regras Firestore, deploy)
4. Antes de mexer em código, pergunte ao usuário o que ele quer
5. Use o `TodoWrite` se a tarefa tem 3+ passos
6. Sempre bumpar cache buster ao mudar JS/CSS
7. Commit + push em cada mudança visível na produção
