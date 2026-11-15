import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { UpdateInfo } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { t } from '../i18n';

const ENABLED_KEY = 'gitnexus.updateCheck';
const SKIP_KEY = 'gitnexus.skipVersion';

export const useUpdateStore = defineStore('update', () => {
  const info = ref<UpdateInfo | null>(null);
  const checking = ref(false);
  /** "Depois": esconde só nesta sessão. */
  const dismissed = ref(false);
  /** Mensagem passageira (resultado de uma verificação manual). */
  const flash = ref('');
  const enabled = ref(localStorage.getItem(ENABLED_KEY) !== '0');
  const skipped = ref(localStorage.getItem(SKIP_KEY) ?? '');

  /** Há versão nova, e a pessoa não pediu para ignorá-la nem dispensou o aviso nesta sessão. */
  const visible = computed(() => info.value?.status === 'available' && !dismissed.value && info.value.latest !== skipped.value);

  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  function say(text: string): void {
    flash.value = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flash.value = ''), 9000);
  }

  /** `manual`: mostra o resultado mesmo quando não há novidade e ignora a opção "ignorar esta versão". */
  async function check(manual = false): Promise<void> {
    if (checking.value || (!manual && !enabled.value)) return;
    checking.value = true;
    try {
      info.value = await api.checkForUpdate();
      if (manual) {
        dismissed.value = false;
        if (info.value.status === 'available') skipped.value = '';
        else if (info.value.status === 'up-to-date') say(t('update.upToDate', { current: info.value.current }));
        else say(info.value.message ?? t('update.failed'));
      }
    } catch (e) {
      if (manual) say(errMsg(e));
    } finally {
      checking.value = false;
    }
  }

  const later = () => (dismissed.value = true);
  function skip(): void {
    if (!info.value?.latest) return;
    skipped.value = info.value.latest;
    localStorage.setItem(SKIP_KEY, skipped.value);
  }
  function setEnabled(v: boolean): void {
    enabled.value = v;
    localStorage.setItem(ENABLED_KEY, v ? '1' : '0');
    say(v ? t('update.autoOn') : t('update.autoOff'));
  }
  async function download(): Promise<void> {
    const i = info.value;
    if (!i) return;
    try {
      await api.openExternal(i.downloadUrl ?? i.url ?? '');
    } catch (e) {
      say(errMsg(e));
    }
  }
  async function openNotes(): Promise<void> {
    if (info.value?.url) await api.openExternal(info.value.url).catch((e) => say(errMsg(e)));
  }

  return { info, checking, flash, enabled, visible, check, later, skip, setEnabled, download, openNotes };
});
