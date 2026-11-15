<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton } from '@git-nexus/ui-kit';
import type { BumpChoice, ReleaseInfo, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../../api';
import { useWorkspaceStore } from '../../stores/workspace';
import ConfirmDialog from '../ConfirmDialog.vue';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const bump = ref<BumpChoice>('auto');
const info = ref<ReleaseInfo | null>(null);
const loading = ref(false);
const error = ref('');
const done = ref('');
const confirm = ref<{ title: string; lines: string[]; label: string; run: () => Promise<void> } | null>(null);

const BUMPS: Array<{ id: BumpChoice; label: string; hint: string }> = [
  { id: 'auto', label: 'Automático', hint: 'breaking → major, feat → minor, demais → patch' },
  { id: 'patch', label: 'Patch', hint: 'Correções' },
  { id: 'minor', label: 'Minor', hint: 'Novidades compatíveis' },
  { id: 'major', label: 'Major', hint: 'Quebra de compatibilidade' },
];
const BUMP_TONE = { initial: 'accent', major: 'danger', minor: 'success', patch: 'neutral' } as const;
const BUMP_LABEL = { initial: 'primeira versão', major: 'major', minor: 'minor', patch: 'patch' } as const;

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
  done.value = 'Notas copiadas (Markdown).';
}

function askTag(): void {
  if (!info.value) return;
  const i = info.value;
  confirm.value = {
    title: `Criar a tag ${tag.value}?`,
    lines: [
      `A tag anotada ${tag.value} é criada no HEAD atual (${i.branch || 'HEAD desanexado'}), com o changelog na mensagem. Ela fica só no seu repositório.`,
      'Se este repositório usa o pipeline de release automático do GitNexus, a tag é criada pelo CI no merge: não crie manualmente.',
    ],
    label: 'Criar tag',
    run: async () => {
      try {
        const r = await api.createReleaseTag(props.repo.path, i.version, i.markdown);
        done.value = `Tag ${r.tag} criada. Para publicar: git push origin ${r.tag}`;
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
    done.value = `${r.path} atualizado com a versão ${tag.value}. Revise e faça o commit.`;
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
        <h2>Versão e changelog</h2>
        <p class="muted">
          Calculados dos Conventional Commits desde a última tag <code>vX.Y.Z</code>, com as mesmas regras do pipeline de release do
          GitNexus: breaking → major, <code>feat</code> → minor, o resto → patch.
        </p>
      </div>
      <GnButton size="sm" :disabled="loading" @click="load">Atualizar</GnButton>
    </header>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="done" class="ok">✔ {{ done }}</p>

    <template v-if="info">
      <section class="box">
        <div class="vp__ver">
          <span class="vp__prev">{{ info.previous ?? 'sem tags' }}</span>
          <span class="vp__arrow">→</span>
          <strong class="vp__next">{{ tag }}</strong>
          <GnBadge :tone="BUMP_TONE[info.bump]">{{ BUMP_LABEL[info.bump] }}</GnBadge>
          <span class="muted">{{ info.commitCount }} commit(s) desde {{ info.previous ?? 'o início' }}</span>
        </div>
        <p v-if="info.initialFromPackage" class="muted">Ainda não há tags: a primeira versão vem do package.json.</p>
        <p v-else-if="!info.hasTags" class="muted">Ainda não há tags: a primeira versão sugerida é {{ tag }}.</p>
        <p v-if="info.tagExists" class="warn">A tag {{ tag }} já existe neste repositório.</p>
        <p v-if="info.hasTags && !info.commitCount" class="muted">Nenhum commit novo desde {{ info.previous }}: não há o que lançar.</p>

        <div class="vp__ctl">
          <span class="muted">Incremento:</span>
          <span class="seg">
            <button v-for="b in BUMPS" :key="b.id" type="button" :class="{ on: bump === b.id }" :title="b.hint" @click="bump = b.id">{{ b.label }}</button>
          </span>
          <span class="spacer" />
          <GnButton size="sm" :disabled="!info.commitCount" @click="copy">Copiar notas</GnButton>
          <GnButton size="sm" :disabled="!info.commitCount" title="Insere a versão no topo do CHANGELOG.md" @click="saveChangelog">Salvar no CHANGELOG.md</GnButton>
          <GnButton size="sm" variant="primary" :disabled="!canAct" @click="askTag">Criar tag {{ tag }}</GnButton>
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
