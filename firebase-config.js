// =============================================================
// DRG-Rently — Configuração Firebase do SaaS principal
//
// Projeto: drg-rently (criado em 2026-05-10)
//
// Pendências de hardening (rodar depois do 1º push):
//   Google Cloud Console → APIs & Services → Credentials
//   → editar a "Browser key" criada automaticamente pelo Firebase
//   → Application restrictions: HTTP referrers
//   → adicionar: zett-romao.github.io/drg-rently/*
//                localhost/*
//                127.0.0.1/*
// =============================================================

const firebaseConfig = {
  apiKey: "AIzaSyBnkH-HvtOnrXBwupBHdhF107C7ysDUnI4",
  authDomain: "drg-rently.firebaseapp.com",
  projectId: "drg-rently",
  storageBucket: "drg-rently.firebasestorage.app",
  messagingSenderId: "838607866137",
  appId: "1:838607866137:web:20ccc69985309e95811d88"
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

window.db = firebase.firestore();
window.storage = firebase.storage();
window.auth = firebase.auth();
