import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { UpdateInfo, UpdateProgress } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { t } from '../i18n';

const ENABLED_KEY = 'gitnexus.updateCheck';
const SKIP_KEY = 'gitnexus.skipVersion';
const LAST_KEY = 'gitnexus.lastVersion';

export const useUpdateStore = defineStore('update', () => {
  const info = ref<UpdateInfo | null>(null);
  const checking = ref(false);
  /** "Depois": esconde só nesta sessão. */
  const dismissed = ref(false);
  /** Mensagem passageira (resultado de uma verificação manual). */
  const flash = ref('');
  const enabled = ref(localStorage.getItem(ENABLED_KEY) !== '0');
  const skipped = ref(localStorage.getItem(SKIP_KEY) ?? '');
  /** Instalação dentro do app: baixando → pronto (conferido pelo SHA-256) → instalando (o app vai reiniciar). */
  const phase = ref<'idle' | 'downloading' | 'ready' | 'installing'>('idle');
  const progress = ref<UpdateProgress>({ done: 0, total: 0 });
  /** O pacote baixado é o da versão `info.latest`? (se uma versão mais nova sair depois, volta a pedir o download). */
  let readyVersion = '';
  /** O último download falhou: oferece tentar de novo e, como saída, baixar manualmente. */
  const failed = ref(false);
  /** Pacote já conferido; extraindo os arquivos (ZIP portátil). Sem percentual. */
  const preparing = computed(() => progress.value.stage === 'prepare');
  /** Dá para instalar sem sair do app (Windows instalado, ZIP portátil, AppImage) e há hash para conferir. */
  const canInstall = computed(() => info.value?.install === 'installer' || info.value?.install === 'appimage' || info.value?.install === 'portable');
  const percent = computed(() => (progress.value.total > 0 ? Math.min(100, Math.round((progress.value.done / progress.value.total) * 100)) : 0));

  /** Há versão nova, e a pessoa não pediu para ignorá-la nem dispensou o aviso nesta sessão. */
  const visible = computed(() => info.value?.status === 'available' && !dismissed.value && info.value.latest !== skipped.value);

  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  function say(text: string): void {
    flash.value = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flash.value = ''), 9000);
  }

  /** Primeira abertura depois de uma atualização: confirma a nova versão (a anterior fica guardada neste computador). */
  function announceUpdated(current: string): void {
    const prev = localStorage.getItem(LAST_KEY);
    localStorage.setItem(LAST_KEY, current);
    if (prev && prev !== current) say(t('update.updated', { version: current }));
  }

  /** `manual`: mostra o resultado mesmo quando não há novidade e ignora a opção "ignorar esta versão". */
  async function check(manual = false): Promise<void> {
    if (checking.value || (!manual && !enabled.value)) return;
    checking.value = true;
    try {
      info.value = await api.checkForUpdate();
      announceUpdated(info.value.current);
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
  /** Baixa o pacote e confere o SHA-256. Depois disso a pessoa escolhe quando reiniciar (nada é fechado sozinho). */
  async function downloadAndVerify(): Promise<void> {
    if (phase.value === 'downloading' || phase.value === 'installing') return;
    phase.value = 'downloading';
    failed.value = false;
    progress.value = { done: 0, total: 0 };
    const off = api.onUpdateProgress((p) => (progress.value = p));
    try {
      const r = await api.downloadUpdate();
      readyVersion = r.version;
      phase.value = 'ready';
    } catch (e) {
      phase.value = 'idle';
      failed.value = true;
      say(errMsg(e));
    } finally {
      off();
    }
  }
  async function installAndRestart(): Promise<void> {
    if (phase.value !== 'ready' || readyVersion !== info.value?.latest) return;
    phase.value = 'installing';
    try {
      await api.installUpdate();
    } catch (e) {
      phase.value = 'ready';
      say(errMsg(e));
    }
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

  return { info, checking, flash, enabled, visible, phase, progress, percent, failed, preparing, canInstall, check, later, skip, setEnabled, download, downloadAndVerify, installAndRestart, openNotes };
});
