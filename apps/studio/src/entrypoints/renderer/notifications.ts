// Notificações do sistema (opção "Notificações do sistema", ligada por padrão): avisa, com o app em segundo plano, que a busca automática trouxe
// commits novos para a branch atual e que a atualização do app terminou de baixar. A notificação em si é do processo principal (api.notify).
import { ref, watch } from 'vue';
import { api } from './api';
import { shouldNotify, type Notice } from './notifications-core';

const KEY = 'gitnexus.notifications';

/** Preferência (no localStorage, ou seja, no diretório de dados do portátil). */
export const notificationsEnabled = ref(localStorage.getItem(KEY) !== '0');
watch(notificationsEnabled, (v) => localStorage.setItem(KEY, v ? '1' : '0'));

/**
 * Mostra a notificação, se a opção estiver ligada e a janela em segundo plano (`force` ignora as duas regras: é o "enviar um teste").
 * Devolve se o sistema chegou a mostrar. Nunca lança: uma notificação que falha não pode atrapalhar o que a motivou.
 */
export async function notifyUser(notice: Notice, force = false): Promise<boolean> {
  if (!force && !shouldNotify({ enabled: notificationsEnabled.value, windowFocused: document.hasFocus() })) return false;
  try {
    return (await api.notify(notice)) === true;
  } catch {
    return false;
  }
}
