// =============================================================
// DRG-Rently — Template de configuração Firebase (modelo C / self-hosted)
//
// Use este template para implantar uma instância dedicada num
// Firebase próprio do cliente. NÃO contém credenciais.
//
// Como preencher:
// 1. Crie projeto em https://console.firebase.google.com
// 2. Habilite: Authentication (E-mail/Senha), Firestore, Storage
// 3. Configurações do projeto → Geral → Seus apps → adicionar app Web
// 4. Copie o objeto firebaseConfig abaixo do campo "Adicionar SDK"
// 5. Renomeie este arquivo para `firebase-config.js`
// =============================================================

const firebaseConfig = {
  apiKey: "PREENCHER",
  authDomain: "PREENCHER.firebaseapp.com",
  projectId: "PREENCHER",
  storageBucket: "PREENCHER.appspot.com",
  messagingSenderId: "PREENCHER",
  appId: "PREENCHER"
};

// =============================================================
// TELEMETRIA (opcional — Modelo C / self-hosted)
// =============================================================
// Por padrão, o DRG-Rently envia metadados não-pessoais à D.R. Global
// quando o usuário faz login. Isso permite que a equipe de suporte
// monitore se a instalação está funcionando e ofereça manutenção.
//
// Dados enviados (LGPD compliant — não são dados pessoais):
//   - Nome da empresa (público, sai em NF)
//   - CNPJ (público)
//   - Quantidade de imóveis e usuários
//   - Versão do app
//   - Project ID do Firebase (não dá acesso a nada)
//
// Dados NUNCA enviados:
//   ❌ Nomes de pessoas, CPF
//   ❌ Endereços, fotos, documentos
//   ❌ Valores, contratos, balancetes
//   ❌ Senhas ou tokens
//
// Para DESABILITAR a telemetria, descomente a linha abaixo:
// window.DISABLE_TELEMETRY = true;
// =============================================================

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

window.db = firebase.firestore();
window.storage = firebase.storage();
window.auth = firebase.auth();
