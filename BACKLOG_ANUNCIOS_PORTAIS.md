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

## 💡 Oferecidos, aguardando decisão

1. **Gerador com IA para o corretor** — hoje ele vê "peça ao administrador" porque a URL do Worker
   Gemini fica em `config/site`, que o corretor não lê. Solução: expor só a URL (não é segredo).
2. **Sincronizar `INSTALACAO/codigo-fonte`** (Modelo C self-hosted) — já estava defasado antes de
   2026-10-12 e nem tem `rede.js`.
3. **2 alertas Dependabot (low)** no repositório.
4. Nível de destaque automático só existe no ZAP/Viva; nos demais é marcado à mão no painel do portal
   (o Plano de publicação lista quais).
