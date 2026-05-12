# 🛠 DRG-Rently — Guia Completo de Instalação

**Versão:** 1.0
**Atualizado em:** 2026-05-12
**Tempo estimado:** 1-2 horas

---

## 📋 Sumário

1. [Pré-requisitos](#1-pré-requisitos)
2. [Criar projeto Firebase](#2-criar-projeto-firebase)
3. [Configurar Authentication](#3-configurar-authentication)
4. [Criar Firestore](#4-criar-firestore)
5. [Configurar Storage](#5-configurar-storage)
6. [Subir código no GitHub](#6-subir-código-no-github)
7. [Ativar GitHub Pages](#7-ativar-github-pages)
8. [Deploy dos 3 Cloudflare Workers](#8-deploy-dos-3-cloudflare-workers)
9. [Configurar e-mail no Resend](#9-configurar-e-mail-no-resend)
10. [Bootstrap do Super Admin](#10-bootstrap-do-super-admin)
11. [Hardening de produção](#11-hardening-de-produção)
12. [Validação final](#12-validação-final)

---

## 1. Pré-requisitos

### Contas que você precisa criar antes

| Serviço | URL | Custo |
|---|---|---|
| Conta Google | accounts.google.com | Grátis |
| Firebase | firebase.google.com | Grátis (Spark) — depois Blaze |
| Cloudflare | cloudflare.com | Grátis |
| GitHub | github.com | Grátis |
| Resend | resend.com | Grátis até 3.000 emails/mês |
| Google Cloud | console.cloud.google.com | Grátis |

### Software no seu PC

- **Git** instalado e configurado (com nome + email)
- **Bloco de Notas** ou editor de texto (VS Code recomendado)
- **Navegador moderno** (Chrome, Edge, Firefox)

---

## 2. Criar projeto Firebase

### 2.1 Criar o projeto

1. Acesse **https://console.firebase.google.com/**
2. Clique em **"Adicionar projeto"**
3. **Nome do projeto**: `drg-rently-cliente-x` (ou nome da sua escolha)
4. Desabilite Analytics (não precisa)
5. Clica em **"Criar projeto"** → aguarda 30s

### 2.2 Adicionar app Web

1. Na visão geral do projeto, clica em **"</>"** (ícone web)
2. **Apelido do app**: `DRG-Rently`
3. Marca ✅ **"Configurar também o Firebase Hosting"** (opcional, podemos usar GitHub Pages)
4. **Registrar app**

### 2.3 Copiar configuração

Aparece um código tipo:
```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "...firebaseapp.com",
  projectId: "...",
  storageBucket: "...firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
```

**Copie esses valores** — vai usar daqui a pouco.

### 2.4 Habilitar plano Blaze (pay-as-you-go)

⚠️ **OBRIGATÓRIO** pra Storage funcionar (uploads de fotos).

1. Menu lateral → **"Faturamento"** ou **"Upgrade"**
2. **"Iniciar upgrade"** → Plano **Blaze**
3. Vincula cartão de crédito
4. **Configure orçamento**: R$ 10-50/mês (alerta se passar)

⚠️ **Custo real esperado**: R$ 0-5/mês até ter ~500 imóveis publicados.

---

## 3. Configurar Authentication

### 3.1 Habilitar e-mail/senha

1. Menu lateral → **Authentication** → **Get started**
2. Aba **Sign-in method** → clique em **"E-mail/senha"**
3. **Ativar** → Salvar
4. Aba **Settings** → role até **"Authorized domains"**
5. Adicione:
   - `localhost`
   - `127.0.0.1`
   - `<seu-usuario>.github.io` (substitua pelo seu usuário GitHub)

### 3.2 Personalizar e-mails (opcional)

- Templates de "redefinir senha", "verificar e-mail"
- Pode customizar com seu domínio depois

---

## 4. Criar Firestore

### 4.1 Criar database

1. Menu lateral → **Firestore Database** → **Criar banco de dados**
2. **Modo**: começa em "modo de teste" (vamos atualizar regras depois)
3. **Localização**: `southamerica-east1` (São Paulo) — **NÃO PODE MUDAR DEPOIS**
4. **Ativar**

### 4.2 Publicar regras de produção

1. Aba **"Rules"**
2. Apague todo o conteúdo
3. Abre o arquivo `INSTALACAO/codigo-fonte/firestore.rules`
4. Copie TUDO e cole no editor do Console
5. **Publicar**

---

## 5. Configurar Storage

### 5.1 Inicializar Storage

1. Menu lateral → **Storage** → **Get started**
2. **Modo**: começa em "modo de teste"
3. **Localização**: `southamerica-east1` (mesma do Firestore)
4. **Concluir**

### 5.2 Publicar regras de Storage

Aba **"Rules"** → cola:

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

**Publicar.**

---

## 6. Subir código no GitHub

### 6.1 Criar repositório

1. Acesse **https://github.com/new**
2. **Repository name**: `drg-rently` (ou outro nome)
3. **Public** (necessário pra GitHub Pages grátis)
4. **NÃO** inicializar com README
5. **Create repository**

### 6.2 Configurar firebase-config.js

1. Abra `INSTALACAO/codigo-fonte/firebase-config.template.js` no Bloco de Notas
2. **Renomeie pra `firebase-config.js`** (tira o `.template`)
3. **Substitua os valores** pelos do passo 2.3:
   ```js
   const firebaseConfig = {
     apiKey: "SUA_API_KEY_AQUI",
     authDomain: "SEU_PROJETO.firebaseapp.com",
     projectId: "SEU_PROJETO_ID",
     storageBucket: "SEU_PROJETO.firebasestorage.app",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
4. Salvar

### 6.3 Subir o código

Abra o **PowerShell** ou **Terminal** dentro da pasta `INSTALACAO/codigo-fonte/`:

```bash
cd "G:/Meu Drive/DRG-Rently/INSTALACAO/codigo-fonte"
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/drg-rently.git
git push -u origin main
```

(Substitua `SEU-USUARIO` pelo seu user no GitHub)

---

## 7. Ativar GitHub Pages

1. Vá no repositório → **Settings** → **Pages**
2. **Source**: `Deploy from a branch`
3. **Branch**: `main` / `(root)`
4. **Save**

Aguarda 1-2 minutos. URL fica:
```
https://SEU-USUARIO.github.io/drg-rently/
```

### Testar

Abre essa URL → deve aparecer a tela de login do DRG-Rently. 🎉

---

## 8. Deploy dos 3 Cloudflare Workers

### 8.1 Worker Resend (envio de e-mail)

#### A. Cadastro no Resend

1. Acesse **https://resend.com** → cria conta
2. Menu → **API Keys** → **+ Create API Key**
3. Nome: `drg-rently`
4. Permissão: **Sending access**
5. **Copia a key** (começa com `re_...`)

#### B. Verifica domínio (opcional, recomendado)

Sem domínio próprio você fica limitado a `onboarding@resend.dev` e só pode mandar pra teste.

1. Resend → **Domains** → **+ Add Domain**
2. Adiciona seu domínio (ex: `suaempresa.com.br`)
3. Configura registros DNS no Hostinger/Registro.br:
   - **SPF** (TXT)
   - **DKIM** (TXT)
   - **MX** (opcional, pra receber)
4. Aguarda verificação (5-30 min)

#### C. Deploy do Worker

1. Cloudflare Dashboard → **Workers & Pages** → **Create Worker**
2. Nome: `drg-rently-resend`
3. **Quick Edit** ou **Edit Code**
4. Apaga tudo
5. Abre `INSTALACAO/workers/cloudflare-worker-resend.js`, copia tudo, cola
6. **Save and Deploy**
7. Vai em **Settings** → **Variables and Secrets**
8. Adiciona Secret: `RESEND_API_KEY` = sua key do passo A

URL final: `https://drg-rently-resend.SEU-USUARIO.workers.dev`

### 8.2 Worker Gemini (leitura de boletos)

#### A. Habilita Gemini API

1. Google Cloud Console: **https://console.cloud.google.com/**
2. Cria novo projeto: `drg-rently-gemini` (ou usa o mesmo do Firebase)
3. **APIs & Services** → **Library** → busca **"Generative Language API"**
4. **Enable**
5. **APIs & Services** → **Credentials** → **+ Create credentials** → **API Key**
6. Copia a key (`AIza...`)
7. **Edita a key** → **Restrict** → API restrictions → **Generative Language API**

#### B. Deploy do Worker

1. Cloudflare → **Create Worker**
2. Nome: `drg-rently-gemini`
3. Quick Edit → apaga tudo → cola conteúdo de `INSTALACAO/workers/cloudflare-worker-gemini.js`
4. Save and Deploy
5. Settings → Variables and Secrets
6. Adiciona Secret: `GEMINI_API_KEY` = key do passo A

URL final: `https://drg-rently-gemini.SEU-USUARIO.workers.dev`

### 8.3 Worker Feed (XML pros portais)

1. Cloudflare → **Create Worker**
2. Nome: `drg-rently-feed`
3. Quick Edit → apaga tudo → cola conteúdo de `INSTALACAO/workers/cloudflare-worker-feed.js`
4. Save and Deploy
5. Settings → Variables and Secrets
6. Adiciona:
   - **Variable** (texto): `PROJECT_ID` = ID do seu projeto Firebase
   - **Secret**: `FIREBASE_API_KEY` = a apiKey do `firebase-config.js`

URL final: `https://drg-rently-feed.SEU-USUARIO.workers.dev`

---

## 9. Configurar e-mail no Resend

(Já feito no passo 8.1.A)

Se quiser remetente customizado:
- Verifica domínio (8.1.B)
- E-mail "from" usa: `balancetes@seudominio.com.br`

---

## 10. Bootstrap do Super Admin

A primeira conta sempre é criada como `admin` de tenant. Pra você ser `super_admin`:

### 10.1 Crie a conta inicial

1. Abre `https://SEU-USUARIO.github.io/drg-rently/`
2. **"Criar conta"**
3. Preenche dados de uma "imobiliária descartável" (ex: "Setup")
4. Cria a conta

### 10.2 Promova pra super_admin no Console

1. Firebase Console → **Authentication** → copia o UID do usuário criado
2. **Firestore** → coleção `users` → documento com esse UID
3. Edita campo `role`: muda de `admin` pra `super_admin`
4. Remove o campo `tenantId` (ou define como `null`)

### 10.3 Apague o tenant descartável

1. Firestore → coleção `tenants` → ache o tenant que foi criado no passo 10.1
2. **Delete** (e todas as subcoleções)

### 10.4 Re-login

1. Faz logout no app
2. Faz login de novo
3. **Sidebar agora mostra "DRG-Systems / DevOps"** ✅
4. Menu lateral tem **"⚙️ Super Admin"** ✅

🎉 **Você é super_admin!**

---

## 11. Hardening de produção

### 11.1 HTTP Referrer restriction (Firebase API Key)

⚠️ **IMPORTANTE** — evita que sua API key seja usada por terceiros.

1. **Google Cloud Console** → **APIs & Services** → **Credentials**
2. Acha a "Browser key" criada automaticamente pelo Firebase
3. **Edit** → **Application restrictions** → **HTTP referrers**
4. Adiciona:
   ```
   https://SEU-USUARIO.github.io/drg-rently/*
   http://localhost/*
   http://127.0.0.1/*
   ```

### 11.2 Push Protection (GitHub)

1. GitHub repo → **Settings** → **Code security**
2. **Secret scanning**: ON
3. **Push protection**: ON

### 11.3 Dependabot

Mesma página, ativa **Dependabot security updates**.

### 11.4 Backups manuais

Configura backup automático mensal do Firestore via Cloud Scheduler (opcional, gratuito).

---

## 12. Validação final

### Checklist de teste

- [ ] Abre `https://SEU-USUARIO.github.io/drg-rently/` → tela de login aparece
- [ ] Login com sua conta super_admin → sidebar mostra "DRG-Systems / DevOps"
- [ ] Vê o menu Super Admin
- [ ] Criar conta de uma imobiliária teste → tenant aparece no Super Admin
- [ ] Atuar como esse tenant → sidebar muda pra "DRG-Rently / Nome do Tenant"
- [ ] Cadastra um locador → CNPJ autopreenche
- [ ] Cadastra um imóvel → CEP autopreenche
- [ ] Faz upload de uma foto → aparece na galeria
- [ ] Publica o imóvel → vitrine pública mostra
- [ ] Configura URLs dos 3 Workers em Configurações
- [ ] Testa envio de e-mail (balancete) → e-mail chega
- [ ] Testa leitura de boleto (sobe PDF) → Gemini extrai dados
- [ ] Testa feed XML: abre `https://drg-rently-feed.SEU-USUARIO.workers.dev/?tenant=<id>` → XML aparece

Se tudo ✅, **PRONTO PRA OPERAÇÃO!**

---

## 📞 Suporte de instalação

**D.R. Global Multi Services**
- 📧 zett.romao@gmail.com
- 🌐 drglobal.com.br
- Tempo de resposta: 24h úteis

### Pacote de suporte sugerido (self-hosted)

- **Setup completo**: R$ 5.000–8.000 (1 dia de trabalho + revisão)
- **Manutenção mensal**: R$ 500/mês (atualizações + suporte por chat)
- **Customização**: R$ 200/hora (features sob demanda)

---

**🚀 Bem-vindo ao DRG-Rently!**
*— Equipe D.R. Global*
