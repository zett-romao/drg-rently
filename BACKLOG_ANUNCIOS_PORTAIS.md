# 📋 Backlog — Anúncios e Portais

**Status:** feature Anúncios no ar desde 2026-10-12 ✅ (código do anúncio, portais/relevância, gerador com IA)
**Gatilho:** operação ainda não começou — 0 imóveis cadastrados e nenhum portal assinado.
Os itens abaixo só andam quando o Dr. Donizete iniciar as atividades.

---

## ✅ Feito (2026-10-12)

- Código do anúncio sequencial (`DRG-00001`…), busca por código em Imóveis e na Rede
- Bloco "📣 Anúncio": título, portais contratados e nível (Padrão/Destaque/Super/Premium) com cota
- 📡 Portais: chave "Contratado" + cotas por card, "📋 Plano de publicação", botão de códigos que faltam
- Feed filtra por `&portal=` e manda o nível ao ZAP/Viva (`PublicationType`)
- Gerador de anúncios com IA (texto, região via OpenStreetMap, curadoria e correção honesta das fotos)
- Regras do Firestore (`contadores/anuncios`) coladas no Console

---

## ⏳ Ao assinar cada portal (roteiro combinado)

Quando ele disser "assinei o <portal>":

1. Abrir o painel do portal no navegador da máquina.
2. **Parar na tela de login** e avisar "⏸ aguardando seu login no <portal>" — login e senha são
   sempre digitados por ele (regra global).
3. Depois do login: achar a área de integração XML / carga automática, colar a URL do card
   (📡 Portais → 📋 Copiar, já com `&portal=<id>`) e salvar.
   - ZAP e Viva Real = um painel só (Canal Pro), uma integração: usar a URL do ZAP.
4. No Rently: ligar **"Contratado"** no card e preencher as cotas do plano contratado.
5. Conferir no portal se os imóveis entraram (o portal lê o feed de tempos em tempos; cache 10 min).

**Não** ligar "Contratado" antes da assinatura: o portal passaria a aparecer nos anúncios e o feed
enviaria imóveis para portal não pago.

## ⏳ Ao cadastrar o 1º imóvel

- Conferir o 1º anúncio publicado: feed com título, código e nível; página pública com `Cód.`;
  fotos corrigidas pelo gerador; geolocalização (vitrine.geo) no lugar certo.

---

## ✅ Domínio próprio — FEITO 2026-10-13: https://rently.dev.br (roteiro abaixo fica como registro)

Sugestão: `imoveis.drglobal.com.br`. O GitHub Pages é **um domínio por repositório**: o sistema
(index.html) muda junto com o site. Passo a passo quando ele decidir:

1. Hostinger → DNS de `drglobal.com.br` → registro **CNAME** `imoveis` → `zett-romao.github.io`.
2. GitHub → repo `drg-rently` → Settings → Pages → Custom domain = `imoveis.drglobal.com.br`
   → esperar o certificado → marcar **Enforce HTTPS**. (O GitHub cria o arquivo `CNAME`; **não**
   criar antes do DNS existir, senão o site sai do ar.)
3. Firebase → Authentication → Authorized domains: adicionar o domínio novo.
4. Google Cloud → Credentials → chave do navegador: liberar `https://imoveis.drglobal.com.br/*`.
5. Workers: acrescentar a origem nova em `ALLOWED_ORIGINS` (gemini, resend, asaas,
   passkey…) e `SITE_URL` no worker do feed (prévia do WhatsApp) → commit = deploy.
6. ⚠️ **Login por biometria (passkey) é preso ao domínio**: quem usa vai precisar cadastrar de novo.
7. Links antigos (`zett-romao.github.io/drg-rently/...`) passam a redirecionar sozinhos (GitHub).

## ⏳ Contatos dos portais entrando sozinhos (item 10) — depende de assinar um portal

O destino já existe: coleção `leadsImoveis` + tela **Leads** (pedidos de visita do site já caem lá,
`origem: 'interesse_imovel'`). Ao assinar o primeiro portal: pegar a documentação de "integração de
leads" dele (ZAP/Viva: webhook do Canal Pro; OLX: e-mail/API), criar o endpoint no Worker do feed
gravando `origem: 'portal_<id>'` via service account, e mostrar o portal na tela Leads.

## 💡 Oferecidos, aguardando decisão

1. ~~**Gerador com IA para o corretor**~~ ✅ feito 2026-10-13 (`config/ia`).
2. **Sincronizar `INSTALACAO/codigo-fonte`** (Modelo C self-hosted) — já estava defasado antes de
   2026-10-12 e nem tem `rede.js`.
3. **2 alertas Dependabot (low)** no repositório.
4. Nível de destaque automático só existe no ZAP/Viva; nos demais é marcado à mão no painel do portal
   (o Plano de publicação lista quais).
5. ~~Importação x perfil no servidor~~ ✅ a tela confere "✅ Criar" no módulo de destino antes de começar.
