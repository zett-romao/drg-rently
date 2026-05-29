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
  `drg-rently-zapsign` (assinatura), `drg-rently-legis-monitor` (monitor de leis),
  `drg-rently-passkey` (login biométrico), `drg-rently-asaas` (cobrança).
  URLs/secrets em `MANUAL_URLS_E_CHAVES.md` (gitignored, não versionado).

**Hospedagem:** `https://zett-romao.github.io/drg-rently/` — **ativo**
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

## Histórico de decisões

- **2026-05-10**: Projeto criado. Stack mantida igual DRG-Kronos (HTML/JS + Firebase + GitHub Pages) por familiaridade do dev. Multi-tenant escolhido desde o início pra suportar modelos A+B+C com mesmo código. Paleta teal pra diferenciar visualmente do DRG-Kronos. Cobrança inicialmente manual (super-admin suspende/ativa), Stripe/MP fica pra depois. Pix (Fase 4) adiado até decisão sobre PSP.

- **2026-05-29**: 🎉 **Primeira licença vendida** (mensalidade → Modelo B/SaaS, infra da DRG). Onboarding de novo tenant nesse modelo:
  1. Cliente acessa o app e faz **"Criar conta"** → nasce tenant `plano: 'trial'`, `ativo: true` + user `role: 'admin'` (ver `doSignupTenant`).
  2. Super_admin ajusta o **plano** (trial → basic/pro) no painel **Super Admin → Editar plano e módulos**.
  3. Configs **por-tenant** em Configurações (preencher via "Atuar como"):
     - **IA/Gemini** (`workerGeminiUrl`): cola URL compartilhada da DRG. Sem módulo separado — IA é embutida em balancetes/cadastros/contratos. Cota Gemini free é **compartilhada entre todos os tenants**.
     - **Portais/Feed** (`workerFeedUrl`): URL compartilhada + módulo **Portais** habilitado no plano.
     - **E-mail/Resend** (`workerUrl` + `emailFrom`): URL/chave compartilhadas da DRG. ⚠️ `onboarding@resend.dev` só entrega pra você; pra entregar a locadores precisa **domínio verificado** na conta Resend (pode verificar o domínio da cliente na MESMA conta — não criar conta Resend por cliente; o worker usa 1 chave só).
     - **ZapSign** (`workerZapsignUrl` + `zapsignToken`): worker compartilhado, mas **token é da conta ZapSign DA CLIENTE** (X-ZapSign-Token por request; créditos/docs ficam na conta dela).
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
