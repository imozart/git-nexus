<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton } from '@git-nexus/ui-kit';
import type { BumpChoice, ReleaseInfo, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../../api';
import { useWorkspaceStore } from '../../stores/workspace';
import { t, type MessageKey } from '../../i18n';
import ConfirmDialog from '../ConfirmDialog.vue';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const bump = ref<BumpChoice>('auto');
const info = ref<ReleaseInfo | null>(null);
const loading = ref(false);
const error = ref('');
const done = ref('');
const confirm = ref<{ title: string; lines: string[]; label: string; run: () => Promise<void> } | null>(null);

const BUMPS: Array<{ id: BumpChoice; label: MessageKey; hint: MessageKey }> = [
  { id: 'auto', label: 'ver.auto', hint: 'ver.autoHint' },
  { id: 'patch', label: 'ver.patch', hint: 'ver.patchHint' },
  { id: 'minor', label: 'ver.minor', hint: 'ver.minorHint' },
  { id: 'major', label: 'ver.major', hint: 'ver.majorHint' },
];
const BUMP_TONE = { initial: 'accent', major: 'danger', minor: 'success', patch: 'neutral' } as const;
const BUMP_LABEL: Record<ReleaseInfo['bump'], MessageKey> = { initial: 'ver.initial', major: 'ver.major', minor: 'ver.minor', patch: 'ver.patch' };

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    info.value = await api.getReleaseInfo(props.repo.path, bump.value);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

const tag = computed(() => (info.value ? `v${info.value.version}` : ''));
const canAct = computed(() => !!info.value && info.value.commitCount > 0 && !info.value.tagExists);

async function copy(): Promise<void> {
  if (!info.value) return;
  await api.copyText(`## ${tag.value}\n\n${info.value.markdown}`);
  done.value = t('ver.copied');
}

function askTag(): void {
  if (!info.value) return;
  const i = info.value;
  confirm.value = {
    title: t('ver.tagTitle', { tag: tag.value }),
    lines: [t('ver.tagBody', { tag: tag.value, branch: i.branch || t('ver.detached') }), t('ver.tagCiNote')],
    label: t('ver.tagCreate'),
    run: async () => {
      try {
        const r = await api.createReleaseTag(props.repo.path, i.version, i.markdown);
        done.value = t('ver.tagDone', { tag: r.tag });
        ws.bump(props.repo.id);
      } catch (e) {
        error.value = errMsg(e);
      }
      await load();
    },
  };
}

async function saveChangelog(): Promise<void> {
  if (!info.value) return;
  error.value = '';
  try {
    const r = await api.writeChangelog(props.repo.path, info.value.version, info.value.markdown);
    done.value = t('ver.changelogDone', { path: r.path, tag: tag.value });
    ws.bump(props.repo.id);
  } catch (e) {
    error.value = errMsg(e);
  }
}

async function runConfirm(): Promise<void> {
  const c = confirm.value;
  confirm.value = null;
  await c?.run();
}

watch(bump, load);
watch(() => ws.versions[props.repo.id], load);
onMounted(load);
</script>

<template>
  <div class="vp">
    <header class="vp__head">
      <div>
        <h2>{{ t('ver.title') }}</h2>
        <p class="muted">{{ t('ver.intro') }}</p>
      </div>
      <GnButton size="sm" :disabled="loading" @click="load">{{ t('rv.refresh') }}</GnButton>
    </header>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="done" class="ok">✔ {{ done }}</p>

    <template v-if="info">
      <section class="box">
        <div class="vp__ver">
          <span class="vp__prev">{{ info.previous ?? t('ver.noTags') }}</span>
          <span class="vp__arrow">→</span>
          <strong class="vp__next">{{ tag }}</strong>
          <GnBadge :tone="BUMP_TONE[info.bump]">{{ t(BUMP_LABEL[info.bump]) }}</GnBadge>
          <span class="muted">{{ t('ver.sinceN', { n: info.commitCount, since: info.previous ?? t('ver.theStart') }) }}</span>
        </div>
        <p v-if="info.initialFromPackage" class="muted">{{ t('ver.firstFromPackage') }}</p>
        <p v-else-if="!info.hasTags" class="muted">{{ t('ver.firstSuggested', { tag }) }}</p>
        <p v-if="info.tagExists" class="warn">{{ t('ver.tagExists', { tag }) }}</p>
        <p v-if="info.hasTags && !info.commitCount" class="muted">{{ t('ver.nothingNew', { since: info.previous ?? '' }) }}</p>

        <div class="vp__ctl">
          <span class="muted">{{ t('ver.increment') }}</span>
          <span class="seg">
            <button v-for="b in BUMPS" :key="b.id" type="button" :class="{ on: bump === b.id }" :title="t(b.hint)" @click="bump = b.id">{{ t(b.label) }}</button>
          </span>
          <span class="spacer" />
          <GnButton size="sm" :disabled="!info.commitCount" @click="copy">{{ t('ver.copyNotes') }}</GnButton>
          <GnButton size="sm" :disabled="!info.commitCount" :title="t('ver.saveChangelogTip')" @click="saveChangelog">{{ t('ver.saveChangelog') }}</GnButton>
          <GnButton size="sm" variant="primary" :disabled="!canAct" @click="askTag">{{ t('ver.createTag', { tag }) }}</GnButton>
        </div>
      </section>

      <section v-for="s in info.sections" :key="s.id" class="sec">
        <h3>{{ s.title }}</h3>
        <ul>
          <li v-for="c in s.items" :key="c.hash">
            <b v-if="c.scope">{{ c.scope }}:</b> {{ c.title }}
            <span v-if="c.pr" class="muted"> (#{{ c.pr }})</span>
            <code v-if="c.ticket" class="tk">{{ c.ticket }}</code>
            <span class="muted meta"> — <code>{{ c.short }}</code> · {{ c.author }}</span>
            <div v-if="c.breaking && c.breakingNote" class="bn">⚠ {{ c.breakingNote }}</div>
          </li>
        </ul>
      </section>
    </template>

    <ConfirmDialog
      v-if="confirm"
      :title="confirm.title"
      :lines="confirm.lines"
      :confirm-label="confirm.label"
      @confirm="runConfirm"
      @cancel="confirm = null"
    />
  </div>
</template>

<style scoped lang="scss">
.vp {
  padding: 16px 22px;
  max-width: 960px;
  display: grid;
  gap: 12px;
  &__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; h2 { margin: 0 0 4px; font-size: 16px; } p { margin: 0; max-width: 720px; } }
  &__ver { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  &__prev { font-family: var(--gn-mono); color: var(--gn-muted); }
  &__arrow { color: var(--gn-muted); }
  &__next { font-family: var(--gn-mono); font-size: 20px; }
  &__ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
}
.box { border: 1px solid var(--gn-border); border-radius: var(--gn-radius); padding: 12px 14px; p { margin: 6px 0 0; } }
.sec { h3 { margin: 6px 0; font-size: 14px; } ul { margin: 0; padding-left: 20px; display: grid; gap: 4px; } }
.seg {
  display: inline-flex; border: 1px solid var(--gn-border); border-radius: var(--gn-radius); overflow: hidden;
  button { padding: 3px 11px; font: inherit; font-size: 12px; color: var(--gn-muted); background: none; border: none; cursor: pointer; &.on { background: var(--gn-accent); color: #fff; } }
}
code { font-family: var(--gn-mono); font-size: 12px; }
.tk { margin-left: 6px; padding: 0 5px; border: 1px solid var(--gn-border); border-radius: 4px; }
.meta { font-size: 12px; }
.bn { color: var(--gn-warn); font-size: 12px; margin-top: 2px; }
.spacer { flex: 1; }
.muted { color: var(--gn-muted); font-size: 12px; }
.err { color: var(--gn-danger); margin: 0; }
.ok { color: var(--gn-success); margin: 0; word-break: break-all; }
.warn { color: var(--gn-warn); }
</style>
