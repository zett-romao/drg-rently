# DRG-Rently

Sistema SaaS multi-tenant para gestão de locações residenciais e comerciais.

## Setup inicial (uma vez)

1. **Firebase**
   - Criar projeto em https://console.firebase.google.com (ID sugerido: `drg-rently`)
   - Habilitar: Authentication (E-mail/Senha), Firestore Database, Storage
   - Copiar o `firebaseConfig` da app web para `firebase-config.js`
   - Aplicar as regras Firestore/Storage que estão em `CLAUDE.md`

2. **GitHub**
   - Criar repositório `drg-rently` na conta `zett-romao`
   - `git remote add origin git@github.com:zett-romao/drg-rently.git`
   - `git push -u origin main`
   - Settings → Pages → Source: `main` branch / root

3. **Domínio (Google Cloud)**
   - APIs & Services → Credentials → "Browser key" → restringir referrers para:
     - `zett-romao.github.io/drg-rently/*`
     - `localhost/*`
     - `127.0.0.1/*`

4. **Bootstrap do primeiro super-admin**
   - Veja seção "Bootstrap super-admin" no `CLAUDE.md`

## Stack

HTML/CSS/JS puro · Firebase (Auth + Firestore + Storage) · GitHub Pages

## Roadmap

- **Fase 0** — Fundação multi-tenant (Auth, tenants, regras de isolamento, painel super-admin)
- **Fase 1** — Cadastros (locador, locatário, garantias, imóvel, contrato)
- **Fase 2** — Balancete mensal + PDF + envio por e-mail
- **Fase 3** — Leitura automática de boleto via Gemini Vision
- **Fase 4** — Integração Pix com PSP

Ver `CLAUDE.md` para o contexto completo.
