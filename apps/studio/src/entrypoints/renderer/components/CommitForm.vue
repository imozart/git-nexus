<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import type { CommitPolicy, ConventionalCommitInput, ConventionalCommitType } from '@git-nexus/git-core/pure';
import { COMMIT_TYPES, DEFAULT_POLICY, compileTicketPattern, formatCommitMessage } from '@git-nexus/governance-policy';
import { api, errMsg, isHookRejection, stripHookPrefix } from '../api';

const props = defineProps<{ repoPath: string; stagedCount: number }>();
const emit = defineEmits<{ (e: 'committed', hash: string): void }>();

// --- Política (persistida no localStorage => fica no diretório portátil) -------------------
const POLICY_KEY = 'gitnexus.commitPolicy';
function loadPolicy(): CommitPolicy {
  try {
    return { ...DEFAULT_POLICY, ...JSON.parse(localStorage.getItem(POLICY_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}
const policy = reactive<CommitPolicy>(loadPolicy());
watch(policy, (p) => localStorage.setItem(POLICY_KEY, JSON.stringify(p)), { deep: true });
const showPolicy = ref(false);
const patternValid = computed(() => compileTicketPattern(policy.ticketPattern) !== null);

// --- Formulário -------------------------------------------------------------------------
const TYPE_HINT: Record<ConventionalCommitType, string> = {
  feat: 'Nova funcionalidade',
  fix: 'Correção de bug',
  docs: 'Documentação',
  style: 'Formatação (sem mudar lógica)',
  refactor: 'Refatoração',
  perf: 'Melhoria de performance',
  test: 'Testes',
  build: 'Build / dependências',
  ci: 'Integração contínua',
  chore: 'Tarefas diversas',
};

const form = reactive({
  type: 'feat' as ConventionalCommitType,
  scope: '',
  ticketNumber: '',
  subject: '',
  body: '',
  breakingChanges: '',
});
const touched = ref(false);
watch(form, () => (touched.value = true), { deep: true });

const input = computed<ConventionalCommitInput>(() => ({
  type: form.type,
  scope: form.scope || undefined,
  ticketNumber: form.ticketNumber || undefined,
  subject: form.subject,
  body: form.body || undefined,
  breakingChanges: form.breakingChanges || undefined,
}));

// Linter em tempo real: roda a cada tecla, sem I/O.
const validation = computed(() => api.validateCommitMessage(input.value, { ...policy }));
const subjectLen = computed(() => form.subject.trim().length);
const preview = computed(() => formatCommitMessage(input.value));

const committing = ref(false);
const canCommit = computed(() => validation.value.isValid && props.stagedCount > 0 && !committing.value);

// --- Resultado / saída dos hooks ----------------------------------------------------------
const output = ref<{ ok: boolean; text: string } | null>(null);

async function submit(): Promise<void> {
  if (!canCommit.value) return;
  committing.value = true;
  output.value = null;
  try {
    const r = await api.executeCommit(props.repoPath, input.value, { ...policy });
    output.value = { ok: true, text: `Commit ${r.commitHash.slice(0, 7)} criado.\n\n${r.output}`.trim() };
    form.subject = '';
    form.body = '';
    form.breakingChanges = '';
    form.ticketNumber = '';
    touched.value = false;
    emit('committed', r.commitHash);
  } catch (e) {
    const msg = errMsg(e);
    output.value = { ok: false, text: isHookRejection(msg) ? stripHookPrefix(msg) : msg };
  } finally {
    committing.value = false;
  }
}
</script>

<template>
  <form class="cf" @submit.prevent="submit">
    <div class="cf__title">
      <h3>Novo commit</h3>
      <GnButton size="sm" type="button" @click="showPolicy = !showPolicy">Política</GnButton>
    </div>

    <fieldset v-if="showPolicy" class="cf__policy">
      <label><input v-model="policy.scopeRequired" type="checkbox" /> Escopo obrigatório</label>
      <label><input v-model="policy.ticketRequired" type="checkbox" /> Ticket obrigatório</label>
      <label>
        Regex do ticket
        <input v-model="policy.ticketPattern" :class="{ bad: !patternValid }" spellcheck="false" />
      </label>
      <small v-if="!patternValid" class="err">Regex inválida.</small>
    </fieldset>

    <div class="cf__field">
      <span class="cf__label">Tipo</span>
      <div class="cf__types">
        <button
          v-for="t in COMMIT_TYPES"
          :key="t"
          type="button"
          class="chip"
          :class="{ 'chip--on': form.type === t }"
          :title="TYPE_HINT[t]"
          @click="form.type = t"
        >
          {{ t }}
        </button>
      </div>
      <small class="muted">{{ TYPE_HINT[form.type] }}</small>
    </div>

    <div class="cf__row">
      <label class="cf__field">
        <span class="cf__label">Escopo {{ policy.scopeRequired ? '*' : '(opcional)' }}</span>
        <input v-model="form.scope" placeholder="ex.: auth" spellcheck="false" />
      </label>
      <label class="cf__field">
        <span class="cf__label">Ticket {{ policy.ticketRequired ? '*' : '(opcional)' }}</span>
        <input v-model="form.ticketNumber" placeholder="ex.: ABC-123" spellcheck="false" />
      </label>
    </div>

    <label class="cf__field">
      <span class="cf__label">
        Título *
        <span class="counter" :class="{ 'counter--over': subjectLen > policy.maxSubjectLength }">
          {{ subjectLen }}/{{ policy.maxSubjectLength }}
        </span>
      </span>
      <input v-model="form.subject" placeholder="resumo imperativo e curto" />
    </label>

    <label class="cf__field">
      <span class="cf__label">Corpo (opcional)</span>
      <textarea v-model="form.body" rows="3" placeholder="Contexto: o quê e por quê."></textarea>
    </label>

    <label class="cf__field">
      <span class="cf__label">Breaking changes (opcional)</span>
      <textarea v-model="form.breakingChanges" rows="2" placeholder="Descreva a quebra de compatibilidade."></textarea>
    </label>

    <div class="cf__lint" :class="{ ok: validation.isValid }">
      <template v-if="validation.isValid">✔ Mensagem 100% em conformidade.</template>
      <ul v-else-if="touched">
        <li v-for="er in validation.errors" :key="er">✖ {{ er }}</li>
      </ul>
      <template v-else>Preencha o formulário para habilitar o commit.</template>
    </div>

    <details class="cf__preview">
      <summary>Pré-visualizar mensagem</summary>
      <pre>{{ preview }}</pre>
    </details>

    <GnButton variant="primary" type="submit" :disabled="!canCommit">
      {{ committing ? 'Executando commit e hooks…' : `Commit (${stagedCount} arquivo(s))` }}
    </GnButton>
    <small v-if="stagedCount === 0" class="muted">Faça stage de ao menos um arquivo.</small>

    <div v-if="output" class="cf__out" :class="output.ok ? 'cf__out--ok' : 'cf__out--err'">
      <strong>{{ output.ok ? 'Commit concluído' : 'Commit rejeitado — saída do git / hooks' }}</strong>
      <pre>{{ output.text }}</pre>
    </div>
  </form>
</template>

<style scoped lang="scss">
.cf {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  h3 { margin: 0; font-size: 14px; }
  &__title { display: flex; justify-content: space-between; align-items: center; }
  &__field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  &__label { color: var(--gn-muted); font-size: 12px; display: flex; justify-content: space-between; }
  &__row { display: flex; gap: 8px; }
  &__types { display: flex; flex-wrap: wrap; gap: 5px; }
  &__policy {
    display: grid;
    gap: 6px;
    border: 1px dashed var(--gn-border);
    border-radius: var(--gn-radius);
    padding: 8px 10px;
    margin: 0;
    label { display: flex; align-items: center; gap: 6px; }
    input[type='text'], input:not([type]) { flex: 1; }
  }
  &__lint {
    font-size: 12px;
    color: var(--gn-muted);
    ul { margin: 0; padding: 0; list-style: none; color: var(--gn-danger); }
    &.ok { color: var(--gn-success); }
  }
  &__preview { font-size: 12px; summary { cursor: pointer; color: var(--gn-muted); } pre { margin: 6px 0 0; } }
  &__out {
    border-radius: var(--gn-radius);
    padding: 8px 10px;
    border: 1px solid var(--gn-border);
    pre { margin: 6px 0 0; max-height: 220px; overflow: auto; }
    &--ok { border-color: var(--gn-success); }
    &--err { border-color: var(--gn-danger); }
  }
}
pre { font-family: var(--gn-mono); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.chip {
  background: var(--gn-bg);
  color: var(--gn-text);
  border: 1px solid var(--gn-border);
  border-radius: 999px;
  padding: 2px 10px;
  font: inherit;
  cursor: pointer;
  &:hover { border-color: var(--gn-accent); }
  &--on { background: var(--gn-accent); border-color: var(--gn-accent); color: #fff; }
}
.counter { font-variant-numeric: tabular-nums; &--over { color: var(--gn-danger); font-weight: 600; } }
.bad { border-color: var(--gn-danger); }
.err { color: var(--gn-danger); }
.muted { color: var(--gn-muted); }
</style>
