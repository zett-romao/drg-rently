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
├── workers/                     ← 3 Cloudflare Workers
│   ├── cloudflare-worker-resend.js  ← envio de e-mail
│   ├── cloudflare-worker-gemini.js  ← leitura de boletos
│   └── cloudflare-worker-feed.js    ← XML feed pros portais
│
└── manuais/
    ├── MANUAL_IMOBILIARIA.md    ← manual operacional pra usuários
    └── MANUAL_DRG_SYSTEMS.md    ← manual interno DRG (gestão de licenças)
```

## 🚀 Por onde começar

1. **Lê o `LEIA-ME-PRIMEIRO.txt`** para visão geral
2. **Lê o `PASSO-A-PASSO.md`** para instalação completa
3. **Configura `firebase-config.template.js`** com suas credenciais
4. **Roda `SETUP-GIT.bat`** (Windows) ou os comandos manuais do guia
5. **Deploy dos 3 Workers** no Cloudflare
6. **Bootstrap do super_admin** (último passo)

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

*Última atualização: 2026-05-12 · v1.0*
