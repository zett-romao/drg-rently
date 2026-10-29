// Aponta os e-mails de conta do Firebase Auth (redefinir senha etc.) para a página própria
// https://rently.dev.br/acao.html, em português. Uso único e fixo — não aceita outros valores.
//   node C:/Users/doniz/drg-rently/scripts/firebase-auth-emails.mjs           → só mostra como está
//   node C:/Users/doniz/drg-rently/scripts/firebase-auth-emails.mjs --aplicar → aplica (faz backup antes)
// Usa o login do Firebase CLI deste computador (firebase login). Projeto fixo: drg-rently.
import fs from 'fs';
import os from 'os';
import path from 'path';

const PROJETO = 'drg-rently';
const ALVO = { callbackUri: 'https://rently.dev.br/acao.html', defaultLocale: 'pt-BR' };

const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/configstore/firebase-tools.json'), 'utf8'));
if (!cfg.tokens?.refresh_token) { console.error('Sem login do Firebase CLI. Rode: firebase login'); process.exit(1); }
// client id/secret públicos do próprio Firebase CLI (firebase-tools)
const t = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
  grant_type: 'refresh_token', refresh_token: cfg.tokens.refresh_token,
  client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com', client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi' }) });
const H = { Authorization: 'Bearer ' + (await t.json()).access_token, 'x-goog-user-project': PROJETO, 'Content-Type': 'application/json' };
const URL_CFG = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJETO}/config`;

const atual = await (await fetch(URL_CFG, { headers: H })).json();
if (atual.error) { console.error('ERRO ao ler:', atual.error.message); process.exit(1); }
const mostra = (c) => `URL de ação: ${c.notification?.sendEmail?.callbackUri || '(padrão)'} | idioma: ${c.notification?.defaultLocale || '(padrão)'}`;
console.log('Antes:', mostra(atual));

if (process.argv.includes('--aplicar')) {
  const bk = path.join(os.tmpdir(), `firebase-auth-config-backup-${Date.now()}.json`);
  fs.writeFileSync(bk, JSON.stringify({ notification: atual.notification }, null, 2));
  console.log('Backup:', bk);
  const r = await (await fetch(`${URL_CFG}?updateMask=notification.sendEmail.callbackUri,notification.defaultLocale`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ notification: { sendEmail: { callbackUri: ALVO.callbackUri }, defaultLocale: ALVO.defaultLocale } }),
  })).json();
  if (r.error) { console.error('ERRO ao aplicar:', r.error.message); process.exit(1); }
  console.log('Depois:', mostra(r));
}
