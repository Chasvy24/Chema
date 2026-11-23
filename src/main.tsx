import { render } from 'preact';
import '@fontsource/fraunces/latin-600.css';
import './styles/app.css';
import { App } from './app';
import { loadAll, loadError } from './db/store';
import { purgeTrash } from './db/actions';
import { initReminders, registerSW } from './services/reminders';
import { initAutoLock } from './services/lock';

const root = document.getElementById('app')!;

async function start() {
  try {
    await loadAll();
  } catch (e) {
    loadError.value = (e as Error).message || String(e);
    root.innerHTML = `<div class="splash" style="padding:24px;text-align:center"><div><p>Impossible d’ouvrir la base de données locale.</p><p style="font-family:var(--font-body);font-size:15px;color:#665b53">${loadError.value}<br/>Vérifiez que le navigateur n’est pas en navigation privée et que l’espace de stockage n’est pas plein.</p></div></div>`;
    return;
  }
  initAutoLock();
  render(<App />, root);
  // Tâches de fond, après l'affichage.
  initReminders();
  purgeTrash(30).catch(() => null);
  registerSW();
  navigator.storage?.persisted?.().then((p) => {
    if (!p) navigator.storage?.persist?.().catch(() => null);
  });
}

start();
