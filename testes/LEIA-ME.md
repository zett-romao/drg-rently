# Testes das regras do Firestore

`teste-regras.mjs` roda as regras de `../firestore.rules` no **emulador** do Firebase
(nada toca a produção). Precisa de Java 21+ e Node.

```bash
npm i -D firebase-tools@13 @firebase/rules-unit-testing@3 firebase@10
cp ../firestore.rules . && echo '{"firestore":{"rules":"firestore.rules"}}' > firebase.json
npx firebase emulators:exec --only firestore --project demo-rently "node teste-regras.mjs"
```

Rode **antes de colar regras novas no Console**. Mudou um efeito colateral no app
(algo que grava fora do próprio módulo)? Acrescente o cenário aqui.
