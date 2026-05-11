// =============================================================
// DRG-Rently — Configuração Firebase do SaaS principal
//
// ⚠️  PLACEHOLDERS — substituir antes de rodar.
//
// Passos:
// 1. Acesse https://console.firebase.google.com
// 2. Crie projeto novo com ID `drg-rently` (ou o ID que preferir)
// 3. No projeto criado, habilite:
//    - Build → Authentication → Sign-in method → E-mail/Senha (ativar)
//    - Build → Firestore Database (criar, modo produção, região southamerica-east1)
//    - Build → Storage (criar, mesma região)
// 4. Configurações do projeto (engrenagem) → Geral → Seus apps
//    → adicionar app Web (apelido: "drg-rently web")
// 5. Copie o objeto `firebaseConfig` exibido e substitua o objeto
//    abaixo. NÃO troque a estrutura, só os valores.
// 6. (depois do push pra GitHub) → No Google Cloud Console
//    → APIs & Services → Credentials → editar a "Browser key"
//    → Application restrictions: HTTP referrers
//    → adicionar: zett-romao.github.io/drg-rently/*  e  localhost/*
// =============================================================

const firebaseConfig = {
  apiKey: "PREENCHER",
  authDomain: "PREENCHER.firebaseapp.com",
  projectId: "PREENCHER",
  storageBucket: "PREENCHER.appspot.com",
  messagingSenderId: "PREENCHER",
  appId: "PREENCHER"
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

window.db = firebase.firestore();
window.storage = firebase.storage();
window.auth = firebase.auth();
