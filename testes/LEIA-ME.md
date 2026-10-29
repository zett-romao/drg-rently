# Testes das regras do Firestore

Tudo roda em **emuladores locais** do Firebase — nada toca a produção, nenhuma senha real.
Precisa de Java 21+ e Node.

```bash
npm i -D firebase-tools@13 @firebase/rules-unit-testing@3 firebase@10 playwright
cp ../firestore.rules . && echo '{"firestore":{"rules":"firestore.rules"},"emulators":{"firestore":{"port":8080},"auth":{"port":9099}}}' > firebase.json
```

1. **`teste-regras.mjs`** — 52 cenários de permissão (perfis 3.0/2.0/lista/sem perfil, admin,
   corretor, visitante do site, fraude em contadores e leads):
   `npx firebase emulators:exec --only firestore --project demo-rently "node teste-regras.mjs"`

2. **`teste-telas.mjs`** — o **app de verdade** (servido em `localhost:5503`) contra Firestore+Auth
   emulados: entra com admin, operador sem perfil, operador restrito e corretor (contas
   fictícias do emulador), abre **todas as telas do menu** e faz as gravações principais,
   acusando qualquer "permission denied". O `firebase-config.js` é trocado em tempo real para
   apontar ao emulador e as chamadas à produção são bloqueadas.
   ```bash
   (cd .. && python -m http.server 5503 &)
   PLAYWRIGHT_PATH=$(npm root -g)/playwright npx firebase emulators:exec --only firestore,auth --project drg-rently "node teste-telas.mjs"
   ```

3. **`teste-alcance-equipes.mjs`** — 👁 alcance por módulo + 👥 equipes (29/10/2026): o administrador cria
   equipe e recalcula vínculos; um gerente com "Dele + a equipe dele" vê só a carteira da equipe em
   12 telas, e o servidor nega ler/abrir/mexer fora dela mesmo contornando a tela:
   `PLAYWRIGHT_PATH=... npx firebase emulators:exec --only firestore,auth --project drg-rently "node teste-alcance-equipes.mjs"`

Rode **antes de colar regras novas no Console**. Mudou um efeito colateral no app
(algo que grava fora do próprio módulo)? Acrescente o cenário.
