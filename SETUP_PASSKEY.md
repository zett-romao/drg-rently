# 🔐 Setup do Worker Passkey (login biométrico)

Login sem senha via WebAuthn / Passkeys (Windows Hello, Touch ID, Face ID).
Esse documento descreve os passos **manuais** que você (administrador) precisa
fazer **uma única vez** pra ativar a feature.

> ⚠️ Sem completar esses 4 passos, o botão "🔐 Entrar com biometria" não vai funcionar.

---

## ✅ Pré-requisitos

- Conta Cloudflare com Workers ativados (já tem)
- Conta Firebase com Authentication ativado (já tem)
- Wrangler API token e Account ID configurados no GitHub (já tem)

---

## Passo 1 — Criar a KV namespace "PASSKEYS_KV" no Cloudflare

1. Acesse <https://dash.cloudflare.com> → **Workers & Pages → KV**
2. Clique em **"Create namespace"**
3. Nome: `PASSKEYS_KV`
4. Confirme. Vai aparecer um **ID** (32 caracteres hexadecimais).
5. **Copie esse ID.**
6. Abra `wrangler-passkey.toml` neste repo e substitua:

   ```toml
   [[kv_namespaces]]
   binding = "PASSKEYS_KV"
   id = "REPLACE_WITH_KV_NAMESPACE_ID"  ← cole o ID aqui
   ```

7. Commit + push. O workflow `deploy-passkey.yml` redeploy.

---

## Passo 2 — Criar Service Account do Firebase

1. Acesse <https://console.firebase.google.com> → seu projeto
2. ⚙️ **Configurações do projeto → Contas de serviço**
3. Aba **"Contas de serviço"** → **"Gerar nova chave privada"** → confirma
4. Vai baixar um arquivo JSON tipo `seu-projeto-firebase-adminsdk-xxxxx.json`
5. **Abre o JSON num editor** e copia **TUDO** (do `{` até o `}`, incluindo as chaves)

> ⚠️ **NUNCA commite esse JSON no repo!** É uma credencial sensível.

---

## Passo 3 — Cadastrar Secret no Worker Passkey

1. Acesse Cloudflare → **Workers & Pages → drg-rently-passkey**
2. Aba **"Settings" → "Variables and Secrets"**
3. Clique em **"Add" → Type: Secret**
4. Nome: `FIREBASE_SERVICE_ACCOUNT_JSON`
5. Valor: cole o JSON inteiro do Passo 2 (incluindo as chaves `{...}`)
6. Confirme.

---

## Passo 4 — Cadastrar Variables (não-secret) no Worker

Mesma tela do Passo 3, adicione **3 variáveis tipo "Text" (não Secret)**:

| Nome | Valor | Observação |
|---|---|---|
| `RP_ID` | `zett-romao.github.io` | **Sem** `https://`, **sem** path. Apenas o domínio. |
| `RP_NAME` | `DRG-Rently` | Nome exibido pro usuário no prompt do navegador |
| `ORIGIN` | `https://zett-romao.github.io` | **Com** `https://`. Sem path. Domínio completo |

> ⚠️ Se você usa um **custom domain** (ex: `drg-rently.app`), use ele em vez de
> `zett-romao.github.io` nos dois campos. **TEM QUE COINCIDIR EXATAMENTE** com o
> domínio onde o usuário acessa o app, ou o WebAuthn falha por segurança.

---

## Passo 5 — Confirmar deploy

1. Faça qualquer push pra `main` (ex: edição neste arquivo) que toque em
   `cloudflare-worker-passkey.js`, `wrangler-passkey.toml` ou `package.json`.
2. O workflow `deploy-passkey.yml` roda automaticamente.
3. Acompanhe em <https://github.com/zett-romao/drg-rently/actions>
4. URL final do Worker: `https://drg-rently-passkey.zett-romao.workers.dev`
5. Teste o health endpoint:

   ```bash
   curl https://drg-rently-passkey.zett-romao.workers.dev/health
   ```

   Deve retornar:

   ```json
   {
     "ok": true,
     "rpId": "zett-romao.github.io",
     "origin": "https://zett-romao.github.io",
     "hasServiceAccount": true
   }
   ```

   Se algum campo aparecer como `(não configurado)` ou `hasServiceAccount: false`,
   revise o Passo 3 ou 4.

---

## Passo 6 — Cadastrar sua primeira passkey

1. Faça login normalmente (email + senha) no app
2. Vá em **⚙️ Configurações → 🔐 Login com biometria (Passkeys)**
3. Clique em **"🔐 Cadastrar biometria neste dispositivo"**
4. O navegador vai pedir biometria do SO:
   - Windows: olhe pra câmera (Hello) ou coloque o dedo no leitor
   - Mac: use Touch ID ou Face ID
   - Android/iOS: digital ou face
5. ✅ Sucesso! Clique em **"↻ Recarregar lista"** pra confirmar que aparece a passkey

---

## Passo 7 — Logar com biometria

1. Saia do app (botão **"Sair"** no canto superior direito)
2. Na tela de login, agora aparece o botão **"🔐 Entrar com biometria"**
3. Clique nele → SO pede biometria → você entra direto, sem senha

---

## 🆘 Troubleshooting

### "Seu dispositivo não suporta biometria"
- Windows: certifique-se que **Windows Hello** está configurado em
  Configurações → Contas → Opções de entrada → Reconhecimento facial/digital
- Chrome: precisa estar atualizado (versão 108+)
- Em alguns laptops sem câmera infravermelha, o Windows Hello facial não funciona —
  mas leitor de digital sim

### "Challenge expirou. Tente cadastrar novamente."
- O usuário demorou mais de 5 minutos pra completar o cadastro. Comece de novo.

### "Falha ao gerar token Firebase"
- Verifique se o `FIREBASE_SERVICE_ACCOUNT_JSON` foi cadastrado corretamente
  no Cloudflare (Passo 3). Tem que ser o JSON COMPLETO, não só uma chave.
- Verifique se a service account tem a role **"Firebase Authentication Admin"**.
  Sem ela, não consegue criar custom tokens.

### "Origin mismatch"
- O `ORIGIN` cadastrado no Worker não coincide com o domínio que você está
  acessando. Confira o Passo 4.

### A passkey funciona num dispositivo mas não em outro
- Cada dispositivo precisa cadastrar **sua própria** passkey (passo 6 em cada um).
- Exceções: passkeys sincronizadas pela Apple Keychain ou Google Password Manager
  funcionam em todos os dispositivos vinculados à mesma conta Apple/Google.

---

## 🔒 Segurança

- ✅ Dados biométricos **NUNCA saem** do dispositivo do usuário
- ✅ Worker armazena apenas a **chave pública** (não a privada)
- ✅ Counter anti-replay (cada login incrementa um contador)
- ✅ Challenge de 5min de validade
- ✅ Validação de origem (RP_ID + ORIGIN) impede phishing
- ✅ Firebase custom token tem 1h de validade
- ⚠️ Service account JSON é a **única credencial sensível** — guarde-a no
     password manager e nunca commite no repo

---

## 📝 Arquitetura

```
[Frontend] ───POST /register/begin───▶ [Worker Passkey]
[Frontend] ◀──options───────────────── [Worker Passkey]
   │
   │ navigator.credentials.create()
   │ (SO pede biometria)
   ▼
[Frontend] ───POST /register/complete─▶ [Worker Passkey] ──salva em KV──▶
[Frontend] ◀──ok─────────────────────  [Worker Passkey]

────────  Login  ────────

[Frontend] ───POST /login/begin─────▶ [Worker Passkey]
[Frontend] ◀──options───────────────── [Worker Passkey]
   │
   │ navigator.credentials.get()
   │ (SO pede biometria)
   ▼
[Frontend] ───POST /login/complete──▶ [Worker Passkey] ─verifica assinatura─
                                       [Worker Passkey] ─cria custom token Firebase─
[Frontend] ◀──{customToken}───────── [Worker Passkey]
   │
   │ auth.signInWithCustomToken(token)
   ▼
[Firebase Auth] ──sessão autenticada──▶ [App]
```

---

**Última atualização:** 2026-05-13
