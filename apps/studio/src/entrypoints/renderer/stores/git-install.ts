import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { GitAvailability, GitInstallProgress } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { t } from '../i18n';
import { useUpdateStore } from './update';

/**
 * Situação do Git no computador. Sem Git (ou com um antigo demais) o app inteiro fica bloqueado por uma sobreposição (GitGate.vue); o bloqueio de
 * verdade é no processo principal (as chamadas recusam com GIT_UNAVAILABLE). Daqui saem a instalação, a nova verificação e o andamento.
 */
export const useGitInstallStore = defineStore('git-install', () => {
  const info = ref<GitAvailability | null>(null);
  /** `idle`: aviso com as ações · `working`: instalando (barra de progresso) · `failed`: a instalação falhou (mensagem e como seguir). */
  const phase = ref<'idle' | 'working' | 'failed'>('idle');
  const progress = ref<GitInstallProgress>({ step: 'finding' });
  const error = ref('');
  /** Aviso passageiro dentro do diálogo (por exemplo "ainda não foi encontrado"). */
  const notice = ref('');
  const checking = ref(false);

  /** Só bloqueia depois de saber que falta: antes da primeira resposta o app abre normalmente. */
  const blocked = computed(() => info.value !== null && info.value.status !== 'ok');
  const percent = computed(() => (progress.value.step === 'downloading' && (progress.value.total ?? 0) > 0 ? Math.min(100, Math.round(((progress.value.done ?? 0) / (progress.value.total ?? 1)) * 100)) : 0));
  /** Sem percentual (instalando, compilando, conferindo…): a barra anda de um lado a outro. */
  const indeterminate = computed(() => !(progress.value.step === 'downloading' && (progress.value.total ?? 0) > 0));
  /** Cancelar só até a instalação propriamente dita começar (interromper o instalador deixaria um Git pela metade). */
  const cancellable = computed(() => phase.value === 'working' && (progress.value.step !== 'installing' || progress.value.method === 'command-line-tools') && progress.value.step !== 'validating' && progress.value.step !== 'done');

  async function refresh(): Promise<void> {
    try {
      info.value = await api.getGitAvailability();
    } catch {
      /* sem a ponte (testes) ou sem resposta: não bloqueia por engano */
    }
  }

  /** "Já instalei": procura de novo. Se continuar sem Git, avisa. */
  async function recheck(quiet = false): Promise<void> {
    if (checking.value || phase.value === 'working') return;
    checking.value = true;
    notice.value = '';
    try {
      info.value = await api.recheckGit();
      if (info.value.status !== 'ok') {
        if (!quiet) notice.value = t('git.stillMissing');
      } else {
        done(info.value);
      }
    } catch (e) {
      if (!quiet) notice.value = errMsg(e);
    } finally {
      checking.value = false;
    }
  }

  function done(a: GitAvailability): void {
    phase.value = 'idle';
    error.value = '';
    useUpdateStore().say(t('git.done', { version: a.version ?? '' }));
  }

  async function install(): Promise<void> {
    if (phase.value === 'working') return;
    phase.value = 'working';
    error.value = '';
    notice.value = '';
    progress.value = { step: 'finding', method: info.value?.method };
    const off = api.onGitInstallProgress((p) => (progress.value = p));
    try {
      info.value = await api.installGit();
      done(info.value);
    } catch (e) {
      phase.value = 'failed';
      error.value = errMsg(e);
    } finally {
      off();
    }
  }

  const cancel = () => void api.cancelGitInstall().catch(() => undefined);
  const openManual = () => void api.openGitDownloadPage().catch(() => undefined);

  /** Texto para colar num pedido de ajuda: o motivo, o sistema e o que o app sabia do Git. */
  function details(): string {
    const i = info.value;
    return [error.value, `status: ${i?.status ?? '?'}`, `método: ${i?.method ?? '?'}`, `etapa: ${progress.value.step}`, `userAgent: ${navigator.userAgent}`].join('\n');
  }
  async function copyDetails(): Promise<void> {
    await api.copyText(details()).catch(() => undefined);
    notice.value = t('git.copied');
  }

  /** Abertura: pergunta ao processo principal e, enquanto bloqueado, procura de novo quando a janela volta ao foco (a pessoa pode ter instalado por fora). */
  function start(): () => void {
    void refresh();
    const onFocus = () => {
      if (blocked.value && phase.value !== 'working') void recheck(true);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }

  return { info, phase, progress, error, notice, checking, blocked, percent, indeterminate, cancellable, refresh, recheck, install, cancel, openManual, copyDetails, start };
});
