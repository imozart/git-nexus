<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { GnBadge, GnButton, GnIcon } from '@git-nexus/ui-kit';
import type { ChangelogData } from '@git-nexus/git-core/pure';
import { CHANGELOG_URL, parseChangelog, releaseUrl, withCurrentVersion } from '../../../shared/changelog';
import { isAllowedUpdateUrl } from '../../../shared/update';
import { api, errMsg } from '../api';
import { dateLocale, t } from '../i18n';
import GitHubButton from './GitHubButton.vue';

const emit = defineEmits<{ (e: 'close'): void }>();

const data = ref<ChangelogData | null>(null);
const loading = ref(true);
const error = ref('');
const box = ref<HTMLElement | null>(null);

const versions = computed(() => withCurrentVersion(parseChangelog(data.value?.markdown ?? ''), data.value?.version ?? ''));
const isCurrent = (v: string) => v.replace(/^v/, '') === data.value?.version;
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(dateLocale.value, { day: '2-digit', month: 'long', year: 'numeric' });

/** Só abre endereços do GitHub do projeto (o mesmo filtro do processo principal); qualquer outro vira texto simples. */
const canOpen = (href: string) => isAllowedUpdateUrl(href);
function openLink(href: string): void {
  if (canOpen(href)) api.openExternal(href).catch((e) => (error.value = errMsg(e)));
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') emit('close');
}
onMounted(async () => {
  document.addEventListener('keydown', onKey);
  box.value?.focus();
  try {
    data.value = await api.getChangelog();
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="cl" @mousedown.self="emit('close')">
      <div ref="box" class="cl__box" role="dialog" aria-modal="true" aria-labelledby="cl-title" tabindex="-1">
        <header class="cl__head">
          <div>
            <h3 id="cl-title">{{ t('changelog.title') }}</h3>
            <p v-if="data" class="muted">{{ t('changelog.using', { version: data.version }) }}</p>
          </div>
          <div class="cl__actions">
            <GitHubButton :title="t('changelog.githubTitle')" @click="openLink(CHANGELOG_URL)">{{ t('changelog.github') }}</GitHubButton>
            <GnButton @click="emit('close')">{{ t('home.close') }}</GnButton>
          </div>
        </header>

        <div class="cl__body">
          <p v-if="loading" class="muted">{{ t('changelog.loading') }}</p>
          <p v-else-if="error" class="cl__err">{{ error }}</p>
          <p v-else-if="!versions.length" class="muted">{{ t('changelog.empty') }}</p>

          <details v-for="(v, i) in versions" :key="v.version" class="ver" :open="i === 0 || isCurrent(v.version)">
            <summary>
              <GnIcon class="ver__chev" name="chevron-right" />
              <strong>v{{ v.version }}</strong>
              <span v-if="v.date" class="muted">{{ fmtDate(v.date) }}</span>
              <GnBadge v-if="isCurrent(v.version)" tone="accent">{{ t('changelog.current') }}</GnBadge>
            </summary>
            <section v-for="(s, si) in v.sections" :key="si">
              <h4 v-if="s.title">{{ s.title }}</h4>
              <ul>
                <li v-for="(item, k) in s.items" :key="k">
                  <template v-for="(p, pi) in item" :key="pi">
                    <strong v-if="p.kind === 'bold'">{{ p.text }}</strong>
                    <code v-else-if="p.kind === 'code'">{{ p.text }}</code>
                    <template v-else-if="p.kind === 'link'">
                      <a v-if="canOpen(p.href)" :class="{ 'is-code': p.code }" href="#" :title="p.href" @click.prevent="openLink(p.href)">{{ p.text }}</a>
                      <span v-else>{{ p.text }}</span>
                    </template>
                    <template v-else>{{ p.text }}</template>
                  </template>
                </li>
              </ul>
            </section>
            <div v-if="v.pending" class="ver__pending">
              <p class="muted">{{ t('changelog.pending') }}</p>
              <a href="#" :title="releaseUrl(v.version)" @click.prevent="openLink(releaseUrl(v.version))">{{ t('changelog.pendingLink') }}</a>
            </div>
            <p v-else-if="!v.sections.length" class="muted">{{ t('changelog.noChanges') }}</p>
          </details>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.cl {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
  &__box {
    width: min(780px, 94vw);
    max-height: 84vh;
    display: flex;
    flex-direction: column;
    background: var(--gn-surface);
    border: 1px solid var(--gn-border);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
    outline: none;
  }
  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--gn-border);
    h3 { margin: 0; font-size: 16px; }
    p { margin: 2px 0 0; font-size: 12px; }
  }
  &__actions { display: flex; align-items: center; gap: 8px; }
  &__body { display: grid; gap: 8px; align-content: start; padding: 14px 20px 18px; overflow: auto; }
  &__err { color: var(--gn-danger, #e5646b); }
}
.muted { color: var(--gn-muted); }
// cada versão é um cartão (o mesmo desenho das linhas da aba Repositórios): fundo, contorno, cantos arredondados e destaque ao passar o mouse e quando aberto
.ver {
  background: var(--gn-surface-2);
  border: 1px solid var(--gn-border);
  border-radius: var(--gn-radius);
  padding: 0 14px;
  &:hover, &[open] { border-color: var(--gn-accent); }
  // a faixa inteira do cabeçalho é clicável; a seta (no lugar do triângulo do navegador) gira ao abrir
  summary { display: flex; align-items: center; gap: 10px; padding: 10px 0; cursor: pointer; font-size: 14px; list-style: none; &::-webkit-details-marker { display: none; } &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: 2px; border-radius: var(--gn-radius); } }
  &__chev { flex: none; color: var(--gn-muted); transition: transform var(--gn-motion-base) ease-out; }
  &[open] &__chev { transform: rotate(90deg); }
  &[open] > summary { border-bottom: 1px solid var(--gn-border); }
  &[open] { padding-bottom: 10px; }
  h4 { margin: 12px 0 4px; font-size: 13px; }
  &__pending { margin: 8px 0 4px; font-size: 13px; p { margin: 0 0 4px; } a { color: var(--gn-accent); text-decoration: none; &:hover { text-decoration: underline; } } }
  ul { margin: 0; padding-left: 20px; }
  li { margin: 3px 0; font-size: 13px; line-height: 1.45; word-break: break-word; }
  code { font-family: var(--gn-mono); font-size: 12px; }
  a { color: var(--gn-accent); text-decoration: none; &:hover { text-decoration: underline; } }
  a.is-code { font-family: var(--gn-mono); font-size: 11px; color: var(--gn-muted); }
}
</style>
