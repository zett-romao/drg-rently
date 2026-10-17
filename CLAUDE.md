# DRG-Rently — Notas de Projeto

Memória de contexto pro Claude (ou outra IA) que abrir este projeto. **Leia antes de fazer mudanças relevantes.**

---

## O que é

Sistema **SaaS multi-tenant** para gestão de locações residenciais e comerciais.
Versão controlada por `APP_VERSION` no topo de `app.js` (atualmente `0.1.0`).

### Modelos comerciais suportados pelo mesmo codebase
- **Modelo A** — o próprio dono opera como imobiliária (1 tenant é o dele).
- **Modelo B** — SaaS: outras imobiliárias assinam, dados isolados por `tenantId`.
- **Modelo C** — distribuição self-hosted: cliente roda no Firebase dele, 1 tenant, com `firebase-config.template.js`.

### Fluxo de negócio
1. Locador assina autorização de administração → vira `locador` do tenant
2. Imobiliária capta locatário, examina ficha sócio-econômica
3. Define garantia: **fiador**, **caução** ou **seguro fiança**
4. Contrato vinculando os três + imóvel, prazo 6/12/24/36 meses
5. Multa rescisória padrão = 3× valor do aluguel
6. Mensal: balancete por imóvel → PDF + envio por e-mail ao locador
7. Transferência do líquido via Pix ao locador (Fase 4)
8. Taxa de administração default 10% (editável por contrato)
9. Flag "1º aluguel para o escritório" quando a captação foi feita pela imobiliária

---

## Stack

- HTML/CSS/JS puro (sem framework)
- Firebase **10.7.1 compat** (Auth + Firestore + Storage)
- GitHub Pages (hosting) — **no ar**
- Cloudflare Workers (vários, já deployados): `drg-rently-gemini` (IA Vision),
  `drg-rently-resend` (e-mail), `drg-rently-feed` (XML portais),
  `drg-rently-legis-monitor` (monitor de leis),
  `drg-rently-passkey` (login biométrico), `drg-rently-asaas` (cobrança).
  URLs/secrets em `MANUAL_URLS_E_CHAVES.md` (gitignored, não versionado).

**Hospedagem:** **`https://rently.dev.br`** (domínio próprio desde 13/10/2026, DNS no Registro.br,
GitHub Pages com arquivo `CNAME`; `www` e o antigo `zett-romao.github.io/drg-rently/` redirecionam
sozinhos). Domínio autorizado no Firebase Auth e na chave do navegador do Google Cloud (projeto drg-rently).
**Repo:** `github.com/zett-romao/drg-rently` — **criado** (deploy = `git push origin main`)

---

## Estrutura de arquivos

```
.
├── index.html                   # App (login + signup + painel)
├── app.js                       # Toda a lógica
├── styles.css                   # Visual (paleta teal)
├── firebase-config.js           # Config Firebase do SaaS principal (placeholders!)
├── firebase-config.template.js  # Template pro modelo C (sem credenciais)
├── README.md                    # Setup rápido
└── CLAUDE.md                    # Este arquivo
```

`.gitignore` cobre: backups, `.claude/`, `_pendrive/`, `.env`, files de IDE/SO.

---

## Modelo de dados (Firestore)

### Top-level
- **`tenants/{tenantId}`** — imobiliárias cadastradas
  - Campos: `nome`, `cnpj`, `creci`, `plano` ('trial'|'basic'|'pro'), `ativo` (bool), `criadoEm`, `criadoPor` (uid)
- **`users/{uid}`** — usuários (uid = Firebase Auth uid)
  - Campos: `nome`, `email`, `tenantId` (ou ausente se super_admin), `role` ('admin'|'operador'|'super_admin'), `criadoEm`

### Subcoleções por tenant (Fase 1+)
- `tenants/{tenantId}/locadores/{id}`
- `tenants/{tenantId}/locatarios/{id}`
- `tenants/{tenantId}/garantias/{id}` — campo `tipo`: 'fiador' | 'caucao' | 'seguro_fianca'
- `tenants/{tenantId}/imoveis/{id}`
- `tenants/{tenantId}/contratos/{id}` — referencia locador, locatário, imóvel, garantia
- `tenants/{tenantId}/balancetes/{ano}_{mes}_{imovelId}` (Fase 2)
- `tenants/{tenantId}/documentos/{id}` — metadados (path no Storage)

### Storage layout
```
/tenants/{tenantId}/locadores/{id}/docs/{file}
/tenants/{tenantId}/locatarios/{id}/docs/{file}
/tenants/{tenantId}/imoveis/{id}/docs/{file}
/tenants/{tenantId}/contratos/{id}/docs/{file}
/tenants/{tenantId}/balancetes/{ano}_{mes}/{imovelId}/{file}
```

---

## Regras Firestore (aplicar no Console)

⚠️ Após criar o projeto Firebase, aplicar essas regras em **Firestore Database → Rules**:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }

    function userExists() {
      return exists(/databases/$(database)/documents/users/$(request.auth.uid));
    }

    function userDoc() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    function isSuperAdmin() {
      return isSignedIn() && userExists() && userDoc().role == 'super_admin';
    }

    function isDRGTeam() {
      // Equipe DRG (super_admin ou operador_drg) — vê o painel Super Admin
      return isSignedIn() && userExists()
             && (userDoc().role == 'super_admin' || userDoc().role == 'operador_drg');
    }

    function belongsToTenant(tenantId) {
      return isSignedIn() && userExists() && userDoc().tenantId == tenantId;
    }

    // users — allow read separado em duas regras pra evitar avaliação eager
    // do isSuperAdmin (que chama get() em doc que pode não existir durante o signup)
    match /users/{uid} {
      allow read: if isSignedIn() && request.auth.uid == uid;
      allow read: if isDRGTeam();
      // Admin do tenant pode ler/listar usuários do mesmo tenant
      allow read: if isSignedIn() && userExists()
                  && userDoc().role == 'admin'
                  && resource.data.tenantId == userDoc().tenantId;
      // Self-create (signup) ou admin criando operador do mesmo tenant
      allow create: if isSignedIn() && request.auth.uid == uid;
      allow create: if isSignedIn() && userExists()
                    && userDoc().role == 'admin'
                    && request.resource.data.tenantId == userDoc().tenantId;
      // Super admin pode criar membros da equipe DRG (tenantId == null)
      allow create: if isSuperAdmin()
                    && (!('tenantId' in request.resource.data) || request.resource.data.tenantId == null);
      allow update: if isSignedIn() && request.auth.uid == uid;
      allow update: if isSuperAdmin();
      // Admin pode atualizar (desativar/reativar) usuários do mesmo tenant
      allow update: if isSignedIn() && userExists()
                    && userDoc().role == 'admin'
                    && resource.data.tenantId == userDoc().tenantId;
      allow delete: if isSuperAdmin();
    }

    // drgPerfis — perfis customizáveis para equipe interna DRG
    // Leitura: qualquer membro DRG (super_admin OU operador_drg) precisa pra carregar próprio perfil
    // Escrita: só super_admin
    match /drgPerfis/{perfilId} {
      allow read: if isDRGTeam();
      allow create, update, delete: if isSuperAdmin();
    }

    // instalacoesSelfHosted — telemetria do Modelo C (pendrive)
    // Worker grava via Firebase REST API (bypassa regras do client).
    // Aqui só liberamos LEITURA pra equipe DRG monitorar.
    match /instalacoesSelfHosted/{instalacaoId} {
      allow read: if isDRGTeam();
      allow write: if false;
    }

    // tenants — leitura pública dos campos públicos (nome, telefone, emailContato)
    // usada pelas páginas públicas; a regra continua restritiva para escrita.
    match /tenants/{tenantId} {
      allow read;
      allow create: if isSignedIn(); // primeiro tenant no signup
      allow update: if belongsToTenant(tenantId) && userDoc().role == 'admin';
      allow update: if isSuperAdmin();
      allow delete: if isSuperAdmin();

      // subcoleções genéricas (locadores, locatarios, garantias, contratos, config, pagamentos)
      match /{collection}/{docId} {
        allow read, write: if belongsToTenant(tenantId);
        allow read, write: if isDRGTeam();
      }

      // Imóveis: leitura pública SE linkPublico === true
      match /imoveis/{imovelId} {
        allow read: if resource.data.linkPublico == true;
        allow read, write: if belongsToTenant(tenantId);
        allow read, write: if isDRGTeam();

        // Fotos do imóvel: leitura sempre pública (galeria)
        match /fotos/{fotoId} {
          allow read;
          allow write: if belongsToTenant(tenantId);
          allow write: if isDRGTeam();
        }
      }
    }
  }
}
```

> ⚠️ Sobre `allow read` em `/tenants/{tenantId}`: leitura pública é segura porque
> o tenant doc só guarda nome, CNPJ, CRECI, plano e status. Dados sensíveis ficam
> nas subcoleções, que continuam protegidas. CNPJ é considerado público (sai em
> nota fiscal, site corporativo, etc.).

## Regras Storage (aplicar no Console)

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function userDoc() {
      return firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data;
    }
    function belongsToTenant(tenantId) {
      return request.auth != null && userDoc().tenantId == tenantId;
    }
    function isSuperAdmin() {
      return request.auth != null && userDoc().role == 'super_admin';
    }

    match /tenants/{tenantId}/{allPaths=**} {
      allow read, write: if belongsToTenant(tenantId) || isSuperAdmin();
    }
  }
}
```

---

## Bootstrap super-admin (uma vez, manualmente)

O primeiro super-admin precisa ser criado manualmente porque o signup só cria admins de tenant.

1. Acesse a app e use o "Criar conta" pra criar uma conta qualquer (vai criar um tenant também — pode ser descartado depois)
2. No **Firebase Console → Authentication** copie o UID do usuário criado
3. No **Firestore → users/{uid}** edite o documento:
   - Mude `role` de `'admin'` para `'super_admin'`
   - Remova o campo `tenantId` (ou deixe vazio)
4. (Opcional) No **Firestore → tenants** apague o tenant que foi criado nesse processo
5. Faça logout e login de novo. O item "Super Admin" deve aparecer no sidebar.

---

## Auth — comportamento

- Firebase Auth e-mail/senha (sem hash caseiro, diferente do DRG-Kronos).
- `onAuthStateChanged` busca `users/{uid}`; se `tenant.ativo === false` e não é super_admin → força logout com mensagem "conta suspensa".
- Roles: `super_admin` (você), `admin` (admin da imobiliária), `operador` (Fase 1+).

---

## Convenções importantes

### Cache busting
Assets locais (`app.js`, `styles.css`, `firebase-config.js`) são referenciados em `index.html` com query string `?v=YYYYMMDDX`. **Sempre que mexer em qualquer um deles, bumpe a letra final** (a → b → c…) ou a data.

### Multi-tenant em queries
**Toda query** de dados (locadores, contratos, etc.) que for adicionada nas próximas fases deve obrigatoriamente filtrar por `State.tenant.id` ou usar a subcoleção `tenants/{tenantId}/...`. As regras Firestore protegem como segunda barreira, mas a primeira é a query.

### Convenção de IDs
- Tenants: ID auto-gerado pelo Firestore
- Subcoleções: IDs auto-gerados, exceto `balancetes/{ano}_{mes}_{imovelId}` (composto, único por mês/imóvel)

### Paleta visual
Teal (`#00897B`) — deliberadamente diferente do DRG-Kronos (azul `#1565C0`) pra usuário distinguir os dois sistemas à primeira vista.

---

## Roadmap detalhado

### ✅ Fase 0 — Fundação multi-tenant (esta entrega)
- Firebase Auth (e-mail/senha)
- Signup de tenant + admin
- Painel principal (sidebar + topbar + placeholders dos módulos)
- Painel Super Admin com lista de tenants e suspender/reativar
- Regras Firestore + Storage com isolamento por `tenantId`

### Fase 1 — Cadastros (próxima)
- Locadores, locatários, imóveis (CRUD + upload de docs)
- Garantias: fiador / caução / seguro fiança (campos condicionais por tipo)
- Contratos: locador + locatário + imóvel + garantia, prazo 6/12/24/36, valor aluguel, multa 3×, taxa adm % editável, flag "1º aluguel pro escritório"
- Receitas extras pro locador, despesas do locador e do locatário (templates)

### Fase 2 — Balancete mensal
- Lançamentos do mês por imóvel (entradas e saídas)
- Upload de comprovantes (Firebase Storage)
- Fechamento do balancete → gera PDF
- E-mail automático ao locador com link de visualização (Cloud Function + Resend ou SendGrid)
- Download do PDF + documentos anexos

### Fase 3 — Boleto do condomínio via Gemini
- Upload do PDF/imagem do boleto
- Cloudflare Worker proxy (novo, separado do DRG-Kronos) → Gemini Vision
- Extrai: valor, vencimento, beneficiário, linha digitável
- Operador confirma antes de gravar

### Portais imobiliários — XML Feed (Fase 2 do submódulo)
**Status**: implementado em 2026-05-12.

Worker `drg-rently-feed` (código em `cloudflare-worker-feed.js`) expõe endpoint público que retorna o XML feed dos imóveis publicados de um tenant em 4 formatos (Wimoveis, Zap, OLX, Imovelweb).

**Deploy no Cloudflare:**
1. Acesse https://dash.cloudflare.com/ → Workers & Pages → Create
2. Nome: `drg-rently-feed`
3. Cole o conteúdo de `cloudflare-worker-feed.js`
4. **Variables**:
   - `PROJECT_ID` = `drg-rently` (texto plano)
5. **Secrets**:
   - `FIREBASE_API_KEY` = a mesma do `firebase-config.js` (é pública por design Firebase)
6. Deploy. URL final ficará tipo `https://drg-rently-feed.zett-romao.workers.dev`
7. No app: vá em **Configurações → XML Feed para portais** e cole essa URL
8. Em **Portais** os cards mostrarão "✅ Feed XML pronto" + botão "📋 Copiar URL"

**Endpoints suportados:**
- `?tenant=<id|slug>&format=wimoveis` (default) — Chaves na Mão, regionais, DF/SP/Casa Mineira, Órulo, DWV
- `?tenant=<id|slug>&format=zap` — ZAP Imóveis + Viva Real
- `?tenant=<id|slug>&format=olx` — OLX Imóveis
- `?tenant=<id|slug>&format=imovelweb` — Imovelweb

**Filtros aplicados:**
- Imóvel com `linkPublico === true`
- Imóvel com `vitrineFeed !== false` (toggle do operador no modal)
- Máximo 500 imóveis por tenant, 30 fotos por imóvel
- Cache CDN: 10 minutos

**Próximos passos (Fase 3 do submódulo):**
- Painel de monitoramento (última sincronização por portal)
- Webhooks de recebimento de leads dos portais → criar negociações no CRM

### Fase 4 — Pix
- Integração com PSP (Banco do Brasil, Itaú, Sicredi, Asaas, Efí, Cora — a definir)
- Transferência do líquido ao locador via chave Pix cadastrada
- Cuidado: requer certificado mTLS, OAuth, conta jurídica habilitada
- Fallback intermediário: botão "copiar chave Pix + valor" para pagamento manual

### Pós-Fase 4 — Cobrança da assinatura
- Stripe ou Mercado Pago
- Plano por número de imóveis administrados (sugestão)
- Por ora: cobrança manual; super-admin suspende/ativa pelo painel

---

## Livro Caixa — Conta Pool (módulo `caixa`)

Adicionado em 2026-06-01. Controla **tudo que entra e sai da conta pool** (a conta
Asaas usada como pool), **por competência mensal** (dia 1 → último dia). Cada
lançamento tem `data`, `nome`, `rubrica`, `tipo` ('entrada'|'saida'), `valor`,
`competencia` (AAAA-MM) e `origem`. **É por tenant** (isolado), não uma pool única da DRG.

**Coleções Firestore (por tenant):**
- `tenants/{tid}/caixaPool/{id}` — lançamentos (cobertos pela regra genérica de subcoleção).
- `tenants/{tid}/caixaPoolFechamento/{ano}_{mes}` — fechamento (saldo residual, totais, quem/quando).

**Alimentação automática (Worker Asaas):**
- **Entrada** + **Tarifa Asaas** (saída) → gravadas no webhook quando uma cobrança é
  paga. Pra rotear, a cobrança do locatário manda `externalReference =
  "caixa:<tenantId>:<contratoId>:<AAAA-MM>"`; o webhook parseia, resolve o nome do
  locatário pelo contrato e grava via service account. Entrada = valor BRUTO;
  tarifa = bruto − `netValue`.
- **Saída** (Repasse ao locador) → gravada no `/aprovar-pagamento` após a transferência.
- Tudo isso usa `registrarCaixa()` no worker (service account, ignora regras com segurança).

**⚠️ Pré-requisito do automático:** as cobranças precisam passar pela **conta que tem o
webhook** (a conta pool da DRG). Pra Modelo A, basta o tenant usar a chave Asaas dessa
conta. Cobranças por contas de outros tenants (chave própria) não disparam este webhook.

**App:** módulo `caixa` no menu (grupo Operação, só admin/super/operador_drg). Tela com
navegação por mês, totais (entradas/saídas/**saldo residual** = entradas − saídas),
lançamentos manuais (add/editar/excluir), **fechar/reabrir competência** e **export .xlsx**
(SheetJS via CDN, lazy-load). Rubrica padrão editável; **taxa de adm retida fica no saldo
residual** (não é saída).

**Google Sheets (ETAPA 2 — pendente):** espelhar cada competência numa aba do Google
Sheets, atualizada sozinha. Exige: planilha criada + compartilhada com uma service account
+ Sheets API; um endpoint no worker que faz `append` das linhas no mesmo ponto em que
grava no `caixaPool`. Fazer depois que o fluxo acima estiver testado em produção. Por ora,
o **export .xlsx** já entrega uma planilha real por mês.

## Rede de corretores (`rede.js` + papel `corretor`)

Adicionado em 2026-10-11. Corretores (equipe **ou** parceiros autônomos) entram no tenant
com `role: 'corretor'`, cadastram os imóveis que captam e veem os dos outros só como
**ficha da rede**. Código em `rede.js` (carregado depois do `app.js`).

**Fonte da verdade das regras:** `firestore.rules` e `storage.rules` na raiz do repo
(os blocos de regras mais acima neste arquivo são históricos — **não** colar esses).

**Modelo (por tenant):**
- `users/{uid}` com `role: 'corretor'`, `ativo`, `status` ('ativo'|'pendente'|'suspenso').
- `corretores/{uid}` — cartão: nome, email, telefone, creci, `tipo` ('equipe'|'parceiro'), status.
- `config/rede` — `campos` (quais campos vão pra ficha) + `visibilidadePadrao` ('rede'|'privado').
  **Customizável em tela** (Corretores → Visibilidade da rede). Lista de campos possíveis = `REDE_CAMPOS`.
- `imoveis/{id}` ganha `redeVisibilidade` ('padrao'|'rede'|'privado') e `compartilhadoCom` [uids].
  Dono = `criadoPor` (campo que já existia).
- `imoveisRede/{id}` — **ficha**: cópia só com os campos liberados + `captadorUid`, `visivel`,
  `compartilhadoCom`. `imoveisRede/{id}/completo/dados` — todos os campos (captador + liberados).

**Por que cópia e não filtro:** Firestore não esconde campo — quem lê um doc lê ele inteiro.
Então o imóvel original fica trancado (corretor só lê o que captou) e a rede lê a cópia.
A cópia é recalculada em `sincronizarFichaRede()` ao salvar/fechar o modal do imóvel; mudou a
config → botão "Reaplicar a todos os imóveis".

**Travas (firestore.rules):** corretor fica FORA da regra genérica de subcoleção
(`isEquipeTenant`). Ele só tem: imóveis/locadores/fotos/arquivos que ele mesmo criou,
fichas visíveis/dele/liberadas, `corretores` (leitura), `perfis` (leitura), `config/rede`
(leitura). Não pode ligar `linkPublico` (publicar no site é decisão da imobiliária).
Fotos que ele grava precisam ter URL do `firebasestorage.googleapis.com`.
**Consultas do corretor precisam bater com a regra** (Firestore não filtra) → use
`queryDoUsuario()` (filtra `criadoPor`) em vez de `.collection(x).get()`.

**Programa "Seja corretor parceiro"** (`parceiro.html` + `parceiro.js`, público):
config em `tenants/{tid}.programaParceiros` = `{ ativo, titulo, texto, exigeCreci,
comissao:{captadorPct, vendedorPct, escritorioPct} }` — fica no doc do tenant porque ele
já é público (a página lê dali; **nunca** pôr segredo nesse objeto). Autocadastro cria
`users/{uid}` (`role:'corretor', ativo:false, status:'pendente'`) + `corretores/{uid}`
(`tipo:'parceiro', status:'pendente'`); regras só aceitam com `programaParceiros.ativo`.
Admin aprova em Corretores (badge vermelho no menu = pendentes). Login de pendente mostra
"aguardando aprovação". Editado no card "Programa Seja corretor parceiro".

**Comissão dividida** (negociações de venda): bloco "Divisão da comissão" no modal da
negociação → `negociacoes/{id}.divisaoComissao` (captador/quem fechou/escritório: uid,
nome, %, R$; base = valor × comissão%). Padrão vem de `programaParceiros.comissao`
(30/30/40 se não configurado). Espelho `comissoes/{negId}` com `participantes:[uids]` —
corretor lê só o dele ("Minhas comissões" na tela Imóveis da Rede); admin vê o total por
corretor na tela Corretores. Contratos de locação ainda NÃO têm divisão (fazer se pedirem).

**Vitrine pública segura:** `tenants/{tid}/vitrine/{id}` = cópia pública do imóvel
publicado (gerada em `sincronizarVitrine()`, junto com a ficha da rede). Sem proprietário,
número/complemento, matrícula, IPTU, observações; respeita os toggles `publicacao`.
`imoveis.html`/`imovel.html` e o Worker `drg-rently-feed` leem `vitrine` (com fallback
pro modelo antigo só enquanto a vitrine estiver vazia). Feed não manda mais `obs` aos portais.
**Limpeza feita (2026-10-11):** a leitura pública de `imoveis`
foi removida; Worker do feed já lê `vitrine`.

## Anúncios (`anuncios.js`) — código, portais/relevância e gerador com IA

Adicionado em 2026-10-12. Carregado depois do `rede.js`.

**Código do anúncio** (`imoveis.codigoAnuncio`, ex. `DRG-00012`): sequencial por imobiliária em
`contadores/anuncios` (`{ seq, prefixo }`, transação). Prefixo = iniciais do nome do tenant, gravado
no 1º uso e nunca mais muda. Dado no **Salvar** (criar ou editar sem código) e **nunca muda**;
imóveis antigos ganham no botão "🔢 Gerar códigos que faltam" (📡 Portais → Plano de publicação).
Falha ao reservar NÃO barra o salvar. Vai na vitrine, na ficha da rede, no fim da descrição do feed
("Código do anúncio: …") e na página pública (`#hero-codigo`, mensagem do WhatsApp) — o cliente cita,
a equipe acha na busca de Imóveis (`#imoveis-busca`; Enter com 1 resultado abre o cadastro).
O `ListingID`/`CodigoImovel` do feed continua sendo o **id do Firestore**: trocar criaria anúncio
duplicado nos portais.

**Portais e relevância por anúncio**: `config/site.portaisConfig.{portalId} = { ativo, cotas:{destaque,
super, premium} }` (chave "Contratado" + cotas no card de cada portal). No imóvel,
`anuncioPortais = { portalId: 'padrao'|'destaque'|'super'|'premium' }`. **Sem o mapa = anúncio antigo,
vai para todos os feeds** (comportamento de sempre). O feed só filtra quando a URL tem `&portal=<id>`
(os cards copiam já com ele) — URLs antigas coladas nos portais continuam mandando tudo até serem
trocadas. Nível vai no feed só para ZAP/Viva (`<PublicationType>` STANDARD/PREMIUM/SUPER_PREMIUM/
PREMIERE_1); nos demais, o Plano de publicação lista o que marcar no painel do portal. Passar da cota
só avisa (o portal rebaixa), não bloqueia. Título dos portais = `tituloAnuncio || apelido`.

**Gerador com IA** (✨ no bloco 📣 Anúncio): fotos salvas + novas (até 24, reduzidas a 768px) + dados
do formulário (respeita os toggles de privacidade: bairro oculto = sem região; valor oculto = sem
valores) + **pontos da região** reais do OpenStreetMap (Overpass, 4 espelhos, teto 45s; raio 1,5 km;
distância em linha reta). Worker Gemini `modo: 'anuncio'` (`PROMPT_ANUNCIO`): título, descrição,
destaques, região, tags, curadoria das fotos (capa/ordem/descartar/privacidade), ajustes de luz e cor,
relevância sugerida, nota e o que falta. **Correção de foto é honesta** (níveis + balanço de branco
parcial + brilho/contraste/saturação/temperatura, rotação só 90/180/270) — nada de IA generativa
mexendo no imóvel (anúncio enganoso, CDC art. 37). Original fica guardada (`originalPath`).
"Aplicar" põe o texto no formulário (grava no **Salvar**, com a fila de aprovação de sempre) e grava
as fotos na hora (anexo → exige ✅ Pode). Foto salva que a IA manda tirar vai pro fim
(`sugestaoIA: 'remover'`), **nunca é apagada sozinha**.

**Geolocalização** (`coordenadaPorCep` em `rede.js`): 1º Nominatim pelo CEP, BrasilAPI só de reserva —
o BrasilAPI devolvia o **centro da cidade** para muitos CEPs (01310-100, Av. Paulista → Praça da Sé),
o que punha imóvel no lugar errado no catálogo da Meta. Nominatim: máx. 1 consulta/s (`nominatimBusca`).

**Regra nova a colar no Console** (só para o corretor ganhar código): bloco `match /contadores/anuncios`
no `firestore.rules`. Sem ela, imóvel cadastrado por corretor fica sem código até a equipe salvar.

## 🔒 Regras travadas

Rently está no LOCK GERAL de 07/08/2026: vale o comportamento que o código já tem. Só o
dono destrava, com `DESTRAVAR:` ou `ALTERAR: <assunto>`. Regra alterada não se apaga: o
texto original fica, e a regra nova entra à vista com 🔓 ALTERADA + data.

### Repasse — para quem vai o dinheiro do aluguel

- **Original (comportamento travado em 07/08/2026):** o repasse vai sempre para a chave Pix
  (ou conta) do **proprietário** (`locador.pix`). Sem Pix do proprietário, não há solicitação.
- 🔓 **ALTERADA 12/10/2026** (o dono: *"O repasse deve ir para quem for cadastrado e tivermos a
  autorização expressa para fazer"*; aprovou o desenho com "siga por este caminho"):
  1. **Padrão continua o proprietário.** O representante (imobiliária/procurador da seção
     "Imóveis administrados por terceiros") só recebe se a opção **"Repassar os aluguéis ao
     representante"** estiver ligada no cadastro do proprietário.
  2. **Autorização expressa = 4 condições, todas obrigatórias:** instrumento com **poderes para
     receber e dar quitação** (`representante.instrumento.poderesReceber`), **PDF assinado
     anexado** (`instrumento.arquivo`, Storage `locadores/{id}/instrumento-representacao/`),
     **validade em dia** (vazia = indeterminada) e CPF/CNPJ válido.
  3. **Chave Pix = CPF/CNPJ do próprio representante** — nunca chave de terceiro.
  4. **Faltou autorização → BLOQUEIA**, com alerta clicável para o cadastro. Não cai para o
     proprietário em silêncio.
  5. **O servidor confere de novo na aprovação** (`destinoRepasseServidor` no worker Asaas):
     relê o proprietário, recalcula o destino e recusa se a autorização caiu ou se o destino
     mudou depois da solicitação. Espelho de `destinoRepasse()` no `app.js` — mudou um, muda o outro.
  6. Solicitação, Aprovações, auditoria e Livro Caixa mostram o favorecido e o instrumento.

### Permissões — quem pode fazer o quê (Perfis 3.0)

- **Original (comportamento travado em 07/08/2026):** o tipo de usuário decidia quase tudo.
  Admin fazia tudo; operador via os módulos do perfil e **editava tudo o que via** (o "Editar"
  do perfil não era conferido em lugar nenhum); corretor criava e alterava livremente o que
  ele mesmo captou. Só o admin criava usuários, e perfil só valia para operador.
- 🔓 **ALTERADA 12/10/2026** (o dono: *"o corretor precisará de autorizações para fazer
  alterações… autorizado pelo gestor com autorizações delegadas pelo super admin… perfil
  customizável… o que interessa para um e o que interessa para outro"*; escolheu 3 níveis,
  Ver/Criar/Editar/Excluir e delegação em cadeia):
  1. **Todo usuário tem perfil**, qualquer que seja o tipo (admin, operador, corretor). Sem
     perfil escolhido vale o perfil-base do tipo (`seed_<role>`) e, sem ele, o padrão do código.
  2. **Por módulo:** Ver (sim/não) + Criar / Editar / Excluir em **3 níveis**: ✅ Pode ·
     🕓 Com aprovação · ⛔ Não pode. **Ações delicadas** à parte (Pix/conta de repasse, repasse
     ao representante, solicitar repasse, fechar balancete, aprovar pagamento, gerenciar
     usuários e perfis, aprovar alterações…).
  3. **🕓 Com aprovação** = a gravação vai para `alteracoesPendentes` e só vale quando alguém
     aprova. **Aprovar exige** "✔ Aprovar alterações da equipe" **e** ✅ Pode no mesmo item
     (módulo+operação e cada ação delicada envolvida). Ninguém aprova o próprio pedido.
  4. **Delegação:** só quem tem "👥 Gerenciar usuários e perfis" mexe em perfis e usuários;
     **ninguém concede o que não tem**, ninguém altera o próprio perfil nem mexe em quem está
     acima. Super Admin é a raiz, sem limite. Administrador só é criado por Administrador.
  5. **Corretor (padrão):** cria ✅, edita 🕓, exclui ⛔; Pix/conta e repasse ao representante 🕓.
     O alcance "só o que ele captou" continua vindo das regras do Firestore.
  6. **Sem perda para quem já usa:** perfis 2.0 antigos são convertidos sem tirar nada (quem
     editava continua com ✅ em criar/editar/excluir; ações novas herdam o que a pessoa já fazia).
     Operador sem perfil continua fazendo o que fazia.
  7. Telas que **não passam pela fila** (Configurações, Importação, Corretores, anexos e fotos)
     exigem ✅ Pode: arquivo e chave não ficam guardados num pedido pendente.
- **Código:** `normalizarPerfil`, `nivelPermissao`, `excessosSobreMeuPerfil`, `gravar()`,
  `POS_APROVACAO`/`EXCLUSAO_CUSTOM` (efeitos que a tela faria ao salvar), `PERFIS_MODELO`.
- ✅ **Fase 4 (2026-10-13): trava também no servidor** (`firestore.rules`: `podeNoModulo`,
  `podeGravar`, `nivelDoPerfil`). Grava direto só com "✅ Pode" no módulo da coleção
  (`colecaoProtegida`, espelho de `MODULO_COLECAO`); sem perfil nenhum = padrão do código (libera,
  como antes); admin tem piso. Efeitos colaterais previstos em `efeitoColateralPermitido`
  (contrato/venda/distrato mudam **só** `status` do imóvel; assinatura eletrônica; envio do balancete por e-mail)
  e `exclusaoEmCascata` (garantia do contrato). **Mudou um efeito colateral no app → atualizar a
  regra.** Testado no emulador (49 cenários; suíte em `testes/teste-regras.mjs`).
  Ainda só na tela: "não concede o que não tem" ao editar perfis.

## Histórico de decisões

- **2026-10-13 (noite)**: **Leads × corretores** (pedido do dono: "vincular um lead a um corretor").
  Tela Leads: coluna Corretor ("⚠️ sem contato há X dias" a partir de 2 dias), botão **👤 Repassar/
  Trocar** (sugere o captador do imóvel; abre WhatsApp do corretor com mensagem pronta — a aba é
  aberta NO CLIQUE, antes do await, senão o navegador bloqueia), filtros "Sem corretor"/"Devolvidos",
  **+ Lead manual** (WhatsApp/telefone/e-mail de portal/indicação; `origem:'manual'`, `canal`,
  `tipoLead` cliente|proprietario). Corretor: tela **📥 Meus leads** (`section-meusleads`, só
  `isCorretor()`, badge vermelho = novos) — Contatei/Converti/Sem interesse/Anotar/**Devolver com
  motivo** (volta sem corretor, `status:'devolvido'`). Campos no lead: `corretorUid/Nome`,
  `atribuidoEm/Por`, `notaRepasse`, `notaCorretor`, `motivoDevolucao`, `historico[]`. Regra nova em
  `leadsImoveis`: corretor lê/atualiza só `corretorUid == ele`, só campos de atendimento, não passa
  pra outro. Código em `rede.js` (fim do arquivo). Testes: +14 cenários em `teste-regras.mjs`
  (66/66) e fluxos de repasse/Meus leads em `teste-telas.mjs`.
  **Rodar os testes nesta máquina (Windows):** Java 21 portátil (Adoptium JRE zip) no PATH no
  formato `/c/...` (o `C:` quebra o PATH do Git Bash); `teste-telas.mjs` agora acha o
  `firebase-config.js` pelo caminho relativo (antes estava fixo em `C:/Projetos/...`). Leva ~10 min.

- **2026-10-13 (tarde 2)**: **domínio próprio `rently.dev.br`** (registrado por 2 anos no Registro.br;
  zona: 4×A 185.199.108-111.153 + CNAME www → zett-romao.github.io). Workers aceitam o domínio novo
  (ALLOWED_ORIGINS); passkey com RP por origem (`RPS_EXTRAS` — biometria cadastrada no github.io
  continua valendo só lá); `SITE_URL` padrão do feed = rently.dev.br; links de boas-vindas usam
  `urlDoSistema()`. 🔎 Achado: deploy automático (wrangler) **apagava variáveis cadastradas só no
  painel** — passkey ficou sem RP_ID; agora `keep_vars = true` em todos os wrangler*.toml e as
  variáveis não-secretas do passkey e do legis-monitor ficam em `[vars]`.

- **2026-10-13 (tarde)**: pacote de melhorias pedido pelo dono ("faça todos"): (1) **prévia com foto
  no WhatsApp** — `/compartilhar` no Worker do feed devolve og:* do imóvel/lista e redireciona
  (destino sempre `SITE_URL`); botões Compartilhar, lista de favoritos e "Copiar link" do cadastro
  usam esse link; (2) **"📅 Agendar visita"** na página do imóvel → `leadsImoveis` com
  `origem: 'interesse_imovel'` (regra própria, campos fechados, só imóvel da vitrine) → tela Leads;
  (3) vídeo YouTube/Vimeo e tour Matterport na página; (4) vitrine com bairro, faixa de preço e
  ordenação; (5) **estatísticas** `estatisticas/{imovelId}_{AAAA-MM}` (visitas/favoritos/contatos/
  compartilhamentos, +1 por sessão; regra só deixa somar 1) + bloco "📊 Desempenho" e relatório ao
  proprietário por WhatsApp no cadastro; (7) mapa OSM da região aproximada (sem pino);
  (8) `config/ia` para o corretor usar o gerador; (9) Perfis fase 4 no servidor (ver Permissões).
  (6) domínio e (10) leads dos portais: roteiro em `BACKLOG_ANUNCIOS_PORTAIS.md`.
  🔎 Lição: regras do Firestore **não têm `toList()`** — o emulador pegou antes de ir pro Console.

- **2026-10-12 (noite 2)**: **Anúncios** (ver seção acima) — pedido do dono: *"cada anúncio deve receber
  um código de publicação… dentro de cada anúncio já devem aparecer os portais ativos e em qual relevância
  enquadrá-lo"* + *"gerador de anúncios inteligente… escolherá e melhorará as imagens… pontos relevantes
  da região, tudo por IA"*. Worker do feed ganhou deploy automático (`wrangler-feed.toml` +
  `deploy-feed.yml`, `keep_vars = true`). Corrigido de quebra: excluir foto não apagava o arquivo no
  Storage (caminho relativo ao tenant era usado a partir da raiz) e o geocode do CEP (ver acima).
  🔎 Lição: patch por `python -c "..."` dentro do bash converte `\b` em backspace — usar arquivo ou Edit.

- **2026-10-12 (revisão)**: correções da revisão do Perfis 3.0 — 20 linhas `$g` soltas (sobra de
  `sed`) quebravam todo upload/exclusão de arquivo (hotfix `dff7a7a`); aprovação da fila confere
  módulo×coleção (`MODULO_COLECAO`), recalcula ações delicadas sobre o registro atual, reserva o
  pedido em transação (`EM_DECISAO`) e grava só os campos alterados, avisando conflito;
  comparação de mapas estável (`jsonEstavel`); worker exige `locadorId` em todo repasse;
  "gerenciar usuários"/"aprovar alterações" não vêm mais por herança (só admin tem piso);
  regras: delegação também pelo `seed_<role>` e pedido do corretor só em imóvel/proprietário dele.
  🔎 Lição: depois de inserir linhas por script, rodar ESLint `no-undef` comparando com a versão
  anterior — `node --check` não pega identificador indefinido.

- **2026-10-12 (noite)**: 🔓 **Perfis 3.0** (ver "Permissões" acima): seção nova
  "👥 Equipe e permissões" (saiu de Configurações), perfis-modelo Gerente/Gestor/Corretor/
  Aux. Administrativo/Financeiro/Cobrança, fila "🕓 Alterações aguardando aprovação" na tela
  ✅ Aprovações, `gravar()` em todos os cadastros. Regras novas (colar no Console): delegação
  em `users` + `alteracoesPendentes` para o corretor.

- **2026-10-12 (tarde)**: 🔓 regra do **repasse** alterada — repasse ao representante com
  autorização expressa (ver "🔒 Regras travadas"). De quebra, "💸 Solicitar repasse" passou a
  travar no clique (antes um clique duplo criava duas solicitações) via helper `drgSubmit()`.
- **2026-10-12**: **"+ Novo cliente"** no Super Admin (`saveNovoCliente`): cadastra tenant PJ ou
  PF + login do admin via REST sem deslogar o super_admin (regra `users` (e): equipe DRG cria
  admin/operador/corretor em qualquer tenant). Autocadastro pela tela de login continua (`?signup=1`).
- **2026-10-11 (tarde)**: plano **♾️ Ilimitado** (cortesia: `modulosHabilitados=null` = todos os
  módulos, inclusive futuros; sem mensalidade/vencimento; nunca inadimplente; pacote e plano
  andam juntos). D.R. Global = tenant `K52yZ4nqu7Z7DJfVegYo`.
  **Equipe DRG**: abas Equipe/Arquivo/Lixeira (`users.situacao`) + exclusão definitiva só da
  lixeira (apaga `users/{uid}`; o login no Auth continua existindo — apagar exigiria Worker com
  service account). **Telefone** exibido como `+55 11 99734-7272` (`maskTelefone` aceita com/sem
  55; `telefoneWhatsApp` não duplica o 55). **Locador**: Pix no topo + banco/agência/conta/tipo
  separados em `dadosBancarios` (o texto `banco` continua gravado pro balancete).
  **Portais**: +10 cards (Facebook/Instagram, CRECI-SP, Lopes, Dream Casa, Moving, Homer,
  Casafy, Buskaza, Portais Imobiliários, Vale do Paraíba). Quase todos usam o feed `zap` (VRSync).
  Formato novo `format=facebook` (catálogo Meta Home Listing) — exige lat/long: `vitrine.geo`
  vem do CEP via BrasilAPI (bairro oculto = sem geo). CRECI-SP não publica layout: card manda
  o feed zap e orienta confirmar. Guia de Imóveis e Local do Imóvel ficaram de fora (site não achado).
  Dono prefere receber Worker/regras **completos** colados no chat (não "trocas" manuais).
- **2026-10-11**: **Rede de corretores** (ver seção acima) + **blindagem de `users`**: antes,
  qualquer usuário podia editar o próprio doc e se promover a `super_admin`, e qualquer um
  podia criar `users/{uid}` apontando pra tenant alheio como admin. Agora: self-update não
  mexe em role/tenantId/ativo/perfilId/status; self-create só como admin do tenant que ele
  criou no mesmo batch (`getAfter`) ou como corretor pendente; admin só cria/edita
  admin/operador/corretor. Visibilidade da ficha é configurável em tela (pedido do dono:
  "customizável, não travado no código").

- **2026-06-01**: Conta Asaas vira **conta pool** + módulo **Livro Caixa** (ver seção acima). Cora foi cogitado e **descartado** (API cobrada, mTLS, sem recorrência, repasse TED com aprovação no app). Decisão: ficar 100% no Asaas e ter um livro caixa por competência alimentado pelo webhook (entradas/tarifa) e pelo repasse (saídas), com export .xlsx; Google Sheets espelhado fica pra etapa 2.

- **2026-05-10**: Projeto criado. Stack mantida igual DRG-Kronos (HTML/JS + Firebase + GitHub Pages) por familiaridade do dev. Multi-tenant escolhido desde o início pra suportar modelos A+B+C com mesmo código. Paleta teal pra diferenciar visualmente do DRG-Kronos. Cobrança inicialmente manual (super-admin suspende/ativa), Stripe/MP fica pra depois. Pix (Fase 4) adiado até decisão sobre PSP.

- **2026-05-29**: 🎉 **Primeira licença vendida** (mensalidade → Modelo B/SaaS, infra da DRG). Onboarding de novo tenant nesse modelo:
  1. Cliente acessa o app e faz **"Criar conta"** → nasce tenant `plano: 'trial'`, `ativo: true` + user `role: 'admin'` (ver `doSignupTenant`).
  2. Super_admin ajusta o **plano** (trial → basic/pro) no painel **Super Admin → Editar plano e módulos**.
  3. Configs **por-tenant** em Configurações (preencher via "Atuar como"):
     - **IA/Gemini** (`workerGeminiUrl`): cola URL compartilhada da DRG. Sem módulo separado — IA é embutida em balancetes/cadastros/contratos. Cota Gemini free é **compartilhada entre todos os tenants**.
     - **Portais/Feed** (`workerFeedUrl`): URL compartilhada + módulo **Portais** habilitado no plano.
     - **E-mail/Resend** (`workerUrl` + `emailFrom`): URL/chave compartilhadas da DRG. ⚠️ `onboarding@resend.dev` só entrega pra você; pra entregar a locadores precisa **domínio verificado** na conta Resend (pode verificar o domínio da cliente na MESMA conta — não criar conta Resend por cliente; o worker usa 1 chave só).
     - ~~**ZapSign** (`workerZapsignUrl` + `zapsignToken`): worker compartilhado, mas **token é da conta ZapSign DA CLIENTE** (X-ZapSign-Token por request; créditos/docs ficam na conta dela).~~
       🔓 **ALTERADA 16/10/2026** (dono: *"TROQUE O ZAPSIGN … agora é o SIGN, nosso software"*; acoplamento Rently→Sign autorizado por ele):
       **Assinatura = DRG-Sign** (`signApiKey` + `signApiUrl` opcional, padrão `https://drg-sign-api.onrender.com`). A chave `sgn_…`
       é da **conta Sign DA CLIENTE** (Sign → Configurações → Integração (API)); cada envelope gasta 1 crédito dela. A cliente cola a chave — a assistente nunca digita.
       API: `POST /api/v1/documentos` (JSON, PDF base64, `external_id = rently:<tenant>:<id>`), `GET /api/v1/documentos/:id`, `GET …/final` (PDF), `Authorization: Bearer`.
       O resultado continua no campo **`zapsign`** do contrato/negociação (mesmo formato: `openId`, `status` pending|signed|refused|expired, `signers`) **+ `provedor: 'drg-sign'`** —
       a regra `efeitoColateralPermitido` depende desse nome; não renomear. ZapSign fica como legado (usado só se não houver `signApiKey`, e para consultar envios antigos).
       Signatário confirma CPF + nascimento ao assinar; assinatura eletrônica simples + blockchain — **não é ICP-Brasil**, não escrever isso nas telas.
       🔓 **ALTERADA 17/10/2026** (dono: *"VAMOS TIRAR O ZAP SIGN, MAS VAMOS DEIXAR UMA FERRAMENTA PARA O CLIENTE ESCOLHER QUAL PLATAFORMA DE ASSINATURA ELE QUER"*):
       **ZapSign removido** (worker, toml, workflow, campos; o salvar apaga `workerZapsignUrl`/`zapsignToken` do banco). Configurações → **Plataforma de assinatura**
       (`assinaturaPlataforma`): `drg-sign` (integrada) · `govbr` · `clicksign` · `d4sign` · `docusign` · `autentique` · `outra` (`assinaturaOutraNome/Url`) · `papel`.
       Externas: o Rently baixa o PDF e abre o site; a equipe **anexa o PDF assinado** (Storage `tenants/{t}/{contratos|negociacoes}/{id}/assinado-*.pdf`)
       → `zapsign.status='signed'` + `arquivoAssinadoPath` → vigente/aceita. Registro: `zapsign.provedor` = 'drg-sign' | 'externo' (sem provedor = ZapSign antigo).
       "↩ Desfazer envio" apaga o `zapsign` (externo, ou Sign recusado/expirado). Sem plataforma escolhida o botão de assinar some (quem já tinha chave do Sign = drg-sign).
       `sw.js` não cacheia `onrender.com` (status/PDF do Sign). Teste do fluxo: `scratchpad/emu/teste-sign.mjs` (Sign simulado + emulador).
     - **Monitor Legislativo** (`workerLegisUrl`): só a URL (status `/status` é público, read-only). **Não** dar o `legisAdminToken` pra cliente — é controle interno DRG (lei federal é compartilhada).

- **2026-05-29**: Menu lateral — arraste pra reordenar agora exige **long-press (~450ms)**. Antes os `.nav-link` tinham `draggable="true"` + `cursor: grab` fixo (mãozinha o tempo todo). Agora cursor é normal (`default`); `mousedown` arma um timer que adiciona `.drag-armed` (cursor grab) e libera o drag; `dragstart` faz `preventDefault()` se não estiver armado. Const `LONG_PRESS_MS` em `enableSidebarDnD`. **Não reverter** pra draggable-sempre — foi pedido explícito do dono.

---

## Estilo de comunicação que o usuário prefere

(Herdado do DRG-Kronos)

- Português direto, sem rodeios
- Diagnósticos curtos antes de propor solução
- Passo a passo numerado quando há trabalho de UI
- Honestidade sobre risco e trade-offs ("isso pode quebrar X", "essa abordagem é hacky mas resolve")
- Confirmar antes de ações destrutivas
- Não rodar comandos sem necessidade
