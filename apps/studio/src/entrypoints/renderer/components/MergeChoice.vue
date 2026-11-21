<script setup lang="ts">
// Conflitos sem "linha contra linha" (issue #231, fase 4): apagado × alterado, apagado nos dois lados, binário, ponteiro do LFS,
// modo/tipo diferente e submódulo. A tela mostra o que cada lado guarda e pede uma escolha simples: ficar com um dos lados.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import type { ConflictKind, MergeConflictBlock } from '@git-nexus/git-core/pure';
import { api } from '../api';
import { choiceView, formatSize, isImagePath, modeKind, previewLines, shortSha, type ChoiceOption, type ChoiceSide, type Stage } from '../merge-choice-core';
import { dateLocale, t, type MessageKey } from '../i18n';

const props = defineProps<{ block: MergeConflictBlock; busy?: boolean; rebase?: boolean; repoPath: string }>();
const emit = defineEmits<{ (e: 'resolve', stage: Stage): void }>();

const view = computed(() => choiceView(props.block, !!props.rebase));
const both = computed(() => [view.value.mine, view.value.theirs]);

const TITLE: Partial<Record<ConflictKind, MessageKey>> = {
  deleted: 'mc.title.deleted',
  'both-deleted': 'mc.title.bothDeleted',
  binary: 'mc.title.binary',
  lfs: 'mc.title.lfs',
  mode: 'mc.title.mode',
  submodule: 'mc.title.submodule',
};
const title = computed(() => t(view.value.oneSide ? 'mc.title.oneSide' : (TITLE[view.value.kind] ?? 'mc.title.binary')));

const explain = computed(() => {
  const v = view.value;
  switch (v.kind) {
    case 'deleted':
      if (v.oneSide) return t('mc.explain.oneSide');
      if (v.deletedBy === 'mine') return t(v.keptUnchanged ? 'mc.explain.deletedMineMoved' : 'mc.explain.deletedMine');
      return t(v.keptUnchanged ? 'mc.explain.deletedTheirsMoved' : 'mc.explain.deletedTheirs');
    case 'both-deleted':
      return t('mc.explain.bothDeleted');
    case 'lfs':
      return t('mc.explain.lfs');
    case 'mode':
      return t('mc.explain.mode');
    case 'submodule':
      return t('mc.explain.submodule');
    default:
      return t('mc.explain.binary');
  }
});

const when = (iso: string) => new Date(iso).toLocaleString(dateLocale.value);
const sideName = (s: ChoiceSide) => (s.side === 'mine' ? t('mr.mine') : t('mr.theirs'));
const MODE_KEY = { file: 'mc.mode.file', exec: 'mc.mode.exec', link: 'mc.mode.link', submodule: 'mc.mode.submodule', other: 'mc.mode.other' } as const;

/** Rótulo do botão: ficar com o conteúdo daquele lado ou apagar o arquivo. */
function optionLabel(o: ChoiceOption): string {
  if (view.value.kind === 'both-deleted') return t('mc.confirmRemoval');
  if (view.value.kind === 'deleted') return o.effect === 'keep' ? t('mc.keepFile') : t('mc.removeFile');
  return o.side === 'mine' ? t('mc.useMine') : t('mc.useTheirs');
}
const optionFor = (s: ChoiceSide) => view.value.options.find((o) => o.side === s.side);
/** Em "apagado nos dois lados" só há uma escolha (confirmar a remoção): um botão, fora dos cartões. */
const single = computed(() => (view.value.kind === 'both-deleted' ? view.value.options[0] : undefined));

const related = computed(() => (props.block.relatedPaths ?? []).join(', '));

// Prévia de imagem (só binário com extensão de imagem; até 5 MB, pelo núcleo). A imagem é decodificada aqui (createImageBitmap) e desenhada num
// canvas: assim a CSP do app (que não aceita `data:` nem `blob:`) continua como está.
const bitmaps = new Map<Stage, ImageBitmap>();
const loaded = ref<Partial<Record<Stage, boolean>>>({});
const freeBitmaps = (): void => {
  for (const b of bitmaps.values()) b.close();
  bitmaps.clear();
  loaded.value = {};
};
async function decode(img: { mime: string; base64: string } | null): Promise<ImageBitmap | null> {
  if (!img) return null;
  try {
    const bytes = Uint8Array.from(atob(img.base64), (c) => c.charCodeAt(0));
    return await createImageBitmap(new Blob([bytes], { type: img.mime }));
  } catch {
    return null; // arquivo que não decodifica (corrompido): fica sem prévia
  }
}
/** Desenha a imagem do lado no canvas (chamado como `ref` da função: roda a cada atualização do elemento). */
function paint(stage: Stage, el: unknown): void {
  const bmp = bitmaps.get(stage);
  if (!bmp || !(el instanceof HTMLCanvasElement)) return;
  if (el.width !== bmp.width || el.height !== bmp.height) {
    el.width = bmp.width;
    el.height = bmp.height;
  }
  el.getContext('2d')?.drawImage(bmp, 0, 0);
}
watch(
  () => [props.repoPath, props.block.filePath, props.block.kind] as const,
  async ([repoPath, file, kind]) => {
    freeBitmaps();
    if (kind !== 'binary' || !isImagePath(file)) return;
    const stages = ['ours', 'theirs'] as const;
    const got = await Promise.all(stages.map(async (s) => decode(await api.getConflictImage(repoPath, file, s).catch(() => null))));
    if (props.block.filePath !== file) {
      got.forEach((b) => b?.close()); // a tela já mudou de arquivo
      return;
    }
    stages.forEach((s, i) => got[i] && bitmaps.set(s, got[i]!));
    loaded.value = { ours: bitmaps.has('ours'), theirs: bitmaps.has('theirs') };
  },
  { immediate: true },
);
onBeforeUnmount(freeBitmaps);

const PREVIEW_LINES = 40;
const preview = (s: ChoiceSide) => previewLines(s.text, PREVIEW_LINES);
</script>

<template>
  <div class="mc" role="region" :aria-label="title" data-testid="merge-choice" :data-kind="view.kind">
    <div class="mc__top">
      <h3 class="mc__title" data-testid="mc-title">{{ title }}</h3>
      <p class="mc__explain" data-testid="mc-explain">{{ explain }}</p>
      <p v-if="related" class="mc__notice" role="status" data-testid="mc-related">{{ t('mc.related', { files: related }) }}</p>
    </div>

    <div class="mc__cards">
      <section v-for="s in both" :key="s.side" class="mc__card" :class="`mc__card--${s.side}`" :data-side="s.side" data-testid="mc-side">
        <header class="mc__head">
          <b class="mc__sym">{{ s.side === 'mine' ? 'M' : 'O' }}</b>
          <strong>{{ sideName(s) }}</strong>
        </header>

        <p v-if="!s.info" class="mc__gone" data-testid="mc-gone">{{ view.kind === 'both-deleted' ? t('mc.goneBoth') : t('mc.gone') }}</p>
        <template v-else>
          <dl class="mc__facts">
            <dt>{{ t('mc.kind') }}</dt>
            <dd data-testid="mc-mode">{{ t(MODE_KEY[modeKind(s.info.mode)]) }}</dd>
            <template v-if="s.info.size !== undefined">
              <dt>{{ t('mc.size') }}</dt>
              <dd data-testid="mc-size">{{ formatSize(s.info.size, dateLocale) }}</dd>
            </template>
            <template v-if="view.kind === 'submodule'">
              <dt>{{ t('mc.commit') }}</dt>
              <dd class="mc__mono" data-testid="mc-commit">{{ shortSha(s.info.sha) }}</dd>
              <template v-if="s.info.detail">
                <dt>{{ t('mc.subject') }}</dt>
                <dd>{{ s.info.detail }}</dd>
              </template>
            </template>
            <template v-else-if="view.kind === 'lfs' && s.info.detail">
              <dt>{{ t('mc.lfsOid') }}</dt>
              <dd class="mc__mono" data-testid="mc-oid">{{ s.info.detail.slice(0, 19) }}…</dd>
            </template>
            <template v-if="s.info.date">
              <dt>{{ t('mc.date') }}</dt>
              <dd data-testid="mc-date">{{ when(s.info.date) }}</dd>
            </template>
          </dl>

          <p v-if="view.kind === 'deleted' && view.base" class="mc__tag" :class="{ 'mc__tag--same': view.keptUnchanged }" data-testid="mc-changed">
            {{ view.keptUnchanged ? t('mc.sameAsBase') : t('mc.changedSinceBase') }}
          </p>
          <canvas v-if="loaded[s.stage]" :ref="(el) => paint(s.stage, el)" class="mc__img" role="img" :aria-label="t('mc.imageAlt', { side: sideName(s) })" data-testid="mc-image" />
          <div v-if="view.kind === 'deleted' && s.text" class="mc__text" data-testid="mc-text" tabindex="0" :aria-label="t('mc.textLabel', { side: sideName(s) })">
            <pre>{{ preview(s).lines.join('\n') }}</pre>
            <p v-if="preview(s).more" class="mc__more">{{ t('mc.moreLines', { n: preview(s).more }) }}</p>
          </div>
        </template>

        <div v-if="!single && optionFor(s)" class="mc__actions">
          <GnButton
            variant="primary"
            :tone="optionFor(s)!.effect === 'remove' ? 'warn' : undefined"
            :disabled="busy"
            :data-testid="`mc-use-${s.side}`"
            @click="emit('resolve', optionFor(s)!.stage)"
          >
            {{ optionLabel(optionFor(s)!) }}
          </GnButton>
        </div>
      </section>
    </div>

    <div v-if="single" class="mc__single">
      <GnButton variant="primary" tone="warn" :disabled="busy" data-testid="mc-use-mine" @click="emit('resolve', single.stage)">{{ optionLabel(single) }}</GnButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.mc {
  display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; overflow: auto; min-height: 0;
  &__top { display: flex; flex-direction: column; gap: 4px; }
  &__title { margin: 0; font-size: 15px; }
  &__explain { margin: 0; color: var(--gn-muted); max-width: 760px; }
  &__notice { margin: 4px 0 0; padding: 4px 10px; border-radius: var(--gn-radius); font-size: 12px; background: color-mix(in srgb, var(--gn-accent) 12%, transparent); color: var(--gn-text); max-width: 760px; }
  &__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; align-items: start; max-width: 980px; }
  &__card { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--gn-border); border-radius: var(--gn-radius-lg); background: var(--gn-surface); min-width: 0; }
  &__head { display: flex; align-items: center; gap: 8px; }
  &__sym { font-size: 10px; padding: 0 5px; border-radius: 3px; }
  &__card--mine &__sym { color: var(--gn-accent); background: color-mix(in srgb, var(--gn-accent) 18%, transparent); }
  &__card--theirs &__sym { color: var(--gn-renamed); background: color-mix(in srgb, var(--gn-renamed) 18%, transparent); }
  &__gone { margin: 0; padding: 8px 10px; border-radius: var(--gn-radius); color: var(--gn-danger); background: color-mix(in srgb, var(--gn-danger) 10%, transparent); }
  &__facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 12px; margin: 0; dt { color: var(--gn-muted); } dd { margin: 0; overflow-wrap: anywhere; } }
  &__mono { font-family: var(--gn-mono); }
  &__tag { margin: 0; align-self: flex-start; padding: 0 8px; border-radius: 9px; font-size: 11px; color: var(--gn-warn); background: color-mix(in srgb, var(--gn-warn) 18%, transparent); &--same { color: var(--gn-muted); background: color-mix(in srgb, var(--gn-muted) 18%, transparent); } }
  &__img { max-width: 100%; max-height: 220px; object-fit: contain; align-self: flex-start; border: 1px solid var(--gn-border); border-radius: var(--gn-radius); background: repeating-conic-gradient(var(--gn-surface-2) 0 25%, var(--gn-bg) 0 50%) 0 0 / 14px 14px; }
  &__text { max-height: 240px; overflow: auto; border: 1px solid var(--gn-border); border-radius: var(--gn-radius); background: var(--gn-bg); pre { margin: 0; padding: 6px 10px; font-family: var(--gn-mono); font-size: 12.5px; } }
  &__more { margin: 0; padding: 0 10px 6px; color: var(--gn-muted); font-size: 11px; }
  &__actions { display: flex; }
  &__single { display: flex; }
}
</style>
