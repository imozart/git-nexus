import '@git-nexus/ui-kit/styles/tokens.scss';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import './theme';
import App from './App.vue';

import { useAppErrorsStore } from './stores/app-errors';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

// Erros inesperados: log do app + aviso discreto (o app continua aberto).
const errors = useAppErrorsStore(pinia);
app.config.errorHandler = (err, _instance, info) => void errors.report(`vue (${info})`, err);
window.addEventListener('error', (ev) => void errors.report('janela', ev.error ?? ev.message));
window.addEventListener('unhandledrejection', (ev) => void errors.report('promessa rejeitada', ev.reason));

app.mount('#app');
