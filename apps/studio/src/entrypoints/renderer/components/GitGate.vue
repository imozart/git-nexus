<script setup lang="ts">
// Aviso de Git ausente (ou antigo demais) e instalação automática. É um GnDialog "alertdialog" que NÃO se dispensa (sem Esc nem clique no fundo): enquanto
// o Git não estiver `ok` o app inteiro fica bloqueado (o fundo fica inerte, os atalhos ficam quietos e, no processo principal, as chamadas recusam com
// GIT_UNAVAILABLE). Três estados: aviso com as ações · instalando (barra de progresso com a mensagem de cada etapa) · falha (motivo e como seguir).
// Só o idioma continua escolhível aqui. Textos em pt-BR e en (i18n).
import { computed } from 'vue';
import { GnButton, GnDialog, GnSegmented } from '@git-nexus/ui-kit';
import { LOCALES, locale, setLocale, t, type Locale, type MessageKey } from '../i18n';
import { useGitInstallStore } from '../stores/git-install';

const git = useGitInstallStore();

const outdated = computed(() => git.info?.status === 'outdated');
const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
const languages = LOCALES.map((l) => ({ value: l.id, label: l.short, title: l.label }));

/** Mensagem da etapa atual; `{version}` entra com um espaço antes (ou some, quando ainda não se sabe a versão). */
const stepText = computed(() => {
  const p = git.progress;
  const version = p.version ? ` ${p.version}` : '';
  return t(`git.step.${p.step}` as MessageKey, { version });
});
const sizeText = computed(() => (git.progress.step === 'downloading' && (git.progress.total ?? 0) > 0 ? t('git.size', { done: mb(git.progress.done ?? 0), total: mb(git.progress.total ?? 0) }) : ''));
const methodText = computed(() => t(`git.method.${git.info?.method ?? 'manual'}` as MessageKey));
</script>

<template>
  <GnDialog v-if="git.blocked && git.info" role="alertdialog" labelledby="git-title" describedby="git-body" width="min(660px, 94vw)" :dismissable="false" initial-focus="[data-autofocus]">
    <div class="gg" data-testid="git-gate">
      <div class="gg__head">
        <h3 id="git-title" data-testid="git-title">{{ t(outdated ? 'git.title.outdated' : 'git.title.missing') }}</h3>
        <GnSegmented :model-value="locale" :options="languages" :aria-label="t('git.language')" :title="t('git.language')" @update:model-value="setLocale($event as Locale)" />
      </div>
      <p id="git-body" class="gg__body">
        {{ outdated ? t('git.body.outdated', { version: git.info.version ?? '', min: git.info.minVersion ?? '' }) : t('git.body.missing') }}
      </p>

      <!-- aviso: o que vai acontecer e as ações -->
      <template v-if="git.phase === 'idle'">
        <div class="gg__what">
          <strong>{{ t('git.what') }}</strong>
          <p data-testid="git-method">{{ methodText }}</p>
        </div>
        <p v-if="git.notice" class="gg__notice" role="status" data-testid="git-notice">{{ git.notice }}</p>
        <div class="gg__btns">
          <GnButton variant="primary" :disabled="!git.info.canInstall" data-autofocus data-testid="git-install" @click="git.install()">{{ t('git.install') }}</GnButton>
          <GnButton :disabled="git.checking" data-testid="git-recheck" @click="git.recheck()">{{ t('git.recheck') }}</GnButton>
          <GnButton variant="ghost" data-testid="git-manual" @click="git.openManual()">{{ t('git.manual') }}</GnButton>
        </div>
      </template>

      <!-- instalando: barra de progresso e a mensagem da etapa (região viva para leitor de tela) -->
      <template v-else-if="git.phase === 'working'">
        <div
          class="gg__bar"
          :class="{ 'gg__bar--busy': git.indeterminate }"
          role="progressbar"
          :aria-label="t('git.progress')"
          :aria-valuetext="stepText"
          :aria-valuemin="git.indeterminate ? undefined : 0"
          :aria-valuemax="git.indeterminate ? undefined : 100"
          :aria-valuenow="git.indeterminate ? undefined : git.percent"
          data-testid="git-progress"
        >
          <span class="gg__fill" :style="git.indeterminate ? undefined : { width: git.percent + '%' }" />
        </div>
        <p class="gg__step" aria-live="polite" data-testid="git-step" :data-step="git.progress.step">
          {{ stepText }}
          <span v-if="git.progress.step === 'downloading' && git.percent > 0"> {{ git.percent }}%</span>
          <span v-if="sizeText" class="gg__size"> ({{ sizeText }})</span>
        </p>
        <p v-if="git.progress.detail" class="gg__detail" data-testid="git-detail">{{ git.progress.detail }}</p>
        <div class="gg__btns">
          <GnButton v-if="git.cancellable" data-autofocus data-testid="git-cancel" @click="git.cancel()">{{ t('git.cancel') }}</GnButton>
        </div>
      </template>

      <!-- falhou: o motivo e como seguir (nunca fica sem saída) -->
      <template v-else>
        <div class="gg__fail" role="alert" data-testid="git-error">
          <strong>{{ t('git.error') }}</strong>
          <p>{{ git.error }}</p>
        </div>
        <p v-if="git.notice" class="gg__notice" role="status" data-testid="git-notice">{{ git.notice }}</p>
        <div class="gg__btns">
          <GnButton variant="primary" data-autofocus data-testid="git-retry" @click="git.install()">{{ t('git.retry') }}</GnButton>
          <GnButton data-testid="git-manual" @click="git.openManual()">{{ t('git.manual') }}</GnButton>
          <GnButton variant="ghost" data-testid="git-copy" @click="git.copyDetails()">{{ t('git.copy') }}</GnButton>
        </div>
      </template>
    </div>
  </GnDialog>
</template>

<style scoped lang="scss">
@keyframes gg-busy { from { margin-left: 0; } to { margin-left: 65%; } }
.gg {
  padding: 18px 20px;
  &__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; h3 { margin: 0; font-size: 16px; } }
  &__body { margin: 0 0 12px; font-size: 13px; color: var(--gn-muted); }
  &__what { margin: 0 0 14px; padding: 10px 12px; background: var(--gn-surface-2); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); font-size: 13px; p { margin: 4px 0 0; color: var(--gn-muted); } }
  &__notice { margin: 0 0 10px; font-size: 12px; color: var(--gn-warn, #d6a23a); }
  &__btns { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; min-height: 31px; }
  &__bar { height: 8px; margin: 6px 0 10px; background: var(--gn-border); border-radius: 4px; overflow: hidden; }
  &__fill { display: block; height: 100%; background: var(--gn-accent); transition: width var(--gn-motion-slow); }
  &__bar--busy &__fill { width: var(--gn-ind-width, 35%); opacity: var(--gn-ind-opacity, 1); animation: gg-busy var(--gn-motion-loop) ease-in-out infinite alternate; }
  &__step { margin: 0 0 6px; font-size: 13px; }
  &__size { color: var(--gn-muted); }
  &__detail { margin: 0 0 12px; font-family: var(--gn-mono); font-size: 11px; color: var(--gn-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  &__fail { margin: 0 0 12px; padding: 10px 12px; background: rgba(229, 100, 107, 0.14); border: 1px solid var(--gn-danger, #e5646b); border-radius: var(--gn-radius); font-size: 13px; p { margin: 4px 0 0; word-break: break-word; } }
}
</style>
