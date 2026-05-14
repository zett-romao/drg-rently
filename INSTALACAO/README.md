# 📦 DRG-Rently — Kit de Instalação

Pasta completa para implantação do DRG-Rently em um novo ambiente
(novo cliente self-hosted ou nova conta D.R. Global).

## 📋 Conteúdo

```
INSTALACAO/
├── README.md                    ← você está aqui
├── LEIA-ME-PRIMEIRO.txt         ← visão geral rápida
├── PASSO-A-PASSO.md             ← guia completo de instalação (1-2h)
│
├── codigo-fonte/                ← arquivos do app web
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── imoveis.html             ← vitrine pública
│   ├── imovel.html              ← página de imóvel individual
│   ├── public-imoveis.js
│   ├── public-imovel.js
│   ├── public.css
│   ├── logo.png
│   ├── firebase-config.template.js  ← renomear e preencher!
│   ├── firestore.rules          ← regras de segurança Firebase
│   └── SETUP-GIT.bat            ← script de setup automático (Windows)
│
├── workers/                     ← 7 Cloudflare Workers
│   ├── cloudflare-worker-resend.js       ← envio de e-mail
│   ├── cloudflare-worker-gemini.js       ← Gemini Vision (4 modos: boleto/contrato/multi/documento_pessoa)
│   ├── cloudflare-worker-feed.js         ← XML feed pros portais
│   ├── cloudflare-worker-zapsign.js      ← assinatura eletrônica (proxy)
│   ├── cloudflare-worker-legis-monitor.js ← monitor diário Planalto (cron + KV)
│   ├── cloudflare-worker-passkey.js      ← login biométrico WebAuthn (npm dep)
│   └── cloudflare-worker-asaas.js        ← cobrança Asaas (admin DRG + tenant /tenant/*)
│
└── manuais/
    ├── MANUAL_IMOBILIARIA.md    ← manual operacional pra usuários (v1.4)
    ├── MANUAL_DRG_SYSTEMS.md    ← manual interno DRG (gestão de licenças, v1.1)
    └── SETUP_PASSKEY.md         ← setup do Worker Passkey (Firebase service account, RP_ID etc)
```

## 🚀 Por onde começar

1. **Lê o `LEIA-ME-PRIMEIRO.txt`** para visão geral
2. **Lê o `PASSO-A-PASSO.md`** para instalação completa
3. **Configura `firebase-config.template.js`** com suas credenciais
4. **Roda `SETUP-GIT.bat`** (Windows) ou os comandos manuais do guia
5. **Deploy dos 7 Workers** no Cloudflare (resend, gemini, feed, zapsign, legis-monitor, passkey, asaas)
6. **Setup do Worker Passkey** (Firebase service account + KV + variables — ver `SETUP_PASSKEY.md`)
7. **Bootstrap do super_admin** (último passo)

## 🎯 Modelos de uso

### Modelo A — D.R. Global Imóveis
Operação própria. Você é admin do seu próprio tenant dentro do SaaS principal.

### Modelo B — SaaS multi-cliente
Você (DRG) é o `super_admin`. Imobiliárias clientes contratam o SaaS e viram tenants.

### Modelo C — Self-hosted (este kit)
Cliente quer rodar no Firebase próprio. Você entrega este kit + serviço de setup.

## 💰 Estimativa de custos mensais

| Serviço | Custo típico (1 imobiliária pequena) |
|---|---|
| Firebase Blaze | R$ 0–10 |
| Cloudflare Workers | Grátis (10M req/dia) |
| GitHub Pages | Grátis |
| Resend (até 3k emails/mês) | Grátis |
| Gemini API | Grátis (60 req/min, 1500/dia) |
| **TOTAL** | **R$ 0–10/mês** |

Cliente com 50+ imóveis: ~R$ 30/mês. Cliente com 200+: ~R$ 80/mês.

## 🔒 Segurança

- ✅ Regras Firestore com isolamento por tenant
- ✅ HTTP Referrer restriction na API Key
- ✅ Push protection no GitHub
- ✅ Secrets dos Workers criptografados
- ✅ HTTPS obrigatório (GitHub Pages + Cloudflare)

## 📞 Suporte

**D.R. Global Multi Services**
📧 zett.romao@gmail.com
🌐 drglobal.com.br

---

*Última atualização: 2026-05-14 · v1.1*
