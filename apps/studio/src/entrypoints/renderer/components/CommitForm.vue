<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import type {
  CommitPolicy,
  ConventionalCommitInput,
  ConventionalCommitType,
  RepoPolicyInfo,
  SecretFinding,
  SecretsMode,
} from '@git-nexus/git-core/pure';
import {
  COMMIT_TYPES,
  DEFAULT_POLICY,
  compileTicketPattern,
  formatCommitMessage,
  mergePolicy,
  ticketFromBranch,
  typeFromBranch,
} from '@git-nexus/governance-policy';
import { api, errMsg, isHookRejection, stripHookPrefix } from '../api';
import { locale, t } from '../i18n';
import ComboBox from './ComboBox.vue';

const props = defineProps<{ repoPath: string; branch: string; stagedCount: number }>();
const emit = defineEmits<{ (e: 'committed', hash: string): void }>();

// --- Política -------------------------------------------------------------------------------
// Local (localStorage => fica no diretório portátil) + política do time (.gitnexus.json no repositório),
// que sempre prevalece sobre a local.
const POLICY_KEY = 'gitnexus.commitPolicy';
function loadPolicy(): CommitPolicy {
  try {
    return { ...DEFAULT_POLICY, ...JSON.parse(localStorage.getItem(POLICY_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}
const localPolicy = reactive<CommitPolicy>(loadPolicy());
watch(localPolicy, (p) => localStorage.setItem(POLICY_KEY, JSON.stringify(p)), { deep: true });

const team = ref<RepoPolicyInfo | null>(null);
const policy = computed<CommitPolicy>(() => mergePolicy({ ...localPolicy }, team.value?.commit ?? {}));
const teamLocked = computed(() => !!team.value?.found);
const showPolicy = ref(false);
const patternValid = computed(() => compileTicketPattern(localPolicy.ticketPattern) !== null);
const allowedTypes = computed(() => COMMIT_TYPES.filter((t) => !policy.value.types?.length || policy.value.types.includes(t)));
const policyNote = ref('');

async function loadTeamPolicy(): Promise<void> {
  const path = props.repoPath;
  const info = await api.getRepoPolicy(path).catch(() => null);
  if (path === props.repoPath) team.value = info;
}

// --- Formulário -------------------------------------------------------------------------
const typeHint = (ty: ConventionalCommitType) => t(`commit.type.${ty}` as const);

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

// Ticket e tipo sugeridos pelo nome da branch (feat/PROJ-123-login => feat + PROJ-123).
const autoTicket = ref(false);
const ticketHint = ref('');
function applyBranchHints(): void {
  if (!policy.value.ticketFromBranch) {
    ticketHint.value = '';
    return;
  }
  const found = ticketFromBranch(props.branch, policy.value.ticketPattern);
  if (found && (!form.ticketNumber || autoTicket.value)) {
    form.ticketNumber = found;
    autoTicket.value = true;
    ticketHint.value = t('commit.ticketFromBranchHint', { ticket: found, branch: props.branch });
  } else if (!found && autoTicket.value) {
    form.ticketNumber = '';
    autoTicket.value = false;
    ticketHint.value = '';
  }
  const bt = typeFromBranch(props.branch);
  if (bt && allowedTypes.value.includes(bt)) form.type = bt;
  touched.value = false;
}
// Se o usuário editar o ticket à mão, deixa de ser "automático" (não será sobrescrito nem apagado).
watch(
  () => form.ticketNumber,
  (v) => {
    if (autoTicket.value && v !== ticketFromBranch(props.branch, policy.value.ticketPattern)) autoTicket.value = false;
  },
);
watch(
  () => props.repoPath,
  async () => {
    team.value = null;
    await loadTeamPolicy();
    applyBranchHints();
  },
  { immediate: true },
);
watch(() => props.branch, applyBranchHints);

// Se a política do time restringe tipos, garante que o tipo selecionado seja permitido.
watch(allowedTypes, (types) => {
  if (!types.includes(form.type) && types[0]) form.type = types[0];
});

const input = computed<ConventionalCommitInput>(() => ({
  type: form.type,
  scope: form.scope || undefined,
  ticketNumber: form.ticketNumber || undefined,
  subject: form.subject,
  body: form.body || undefined,
  breakingChanges: form.breakingChanges || undefined,
}));

// Linter em tempo real: roda a cada tecla, sem I/O.
const validation = computed(() => api.validateCommitMessage(input.value, { ...policy.value }, locale.value));
const subjectLen = computed(() => form.subject.trim().length);
const preview = computed(() => formatCommitMessage(input.value));

const committing = ref(false);
const canCommit = computed(() => validation.value.isValid && props.stagedCount > 0 && !committing.value && !secretReport.value);

// --- Segredos: o scanner roda antes do commit ------------------------------------------------
const secretReport = ref<{ mode: SecretsMode; findings: SecretFinding[] } | null>(null);
const KIND_ICON: Record<SecretFinding['kind'], string> = { secret: '🔑', 'sensitive-file': '📄', 'large-file': '📦' };

// --- Resultado / saída dos hooks ----------------------------------------------------------
const output = ref<{ ok: boolean; text: string } | null>(null);

async function submit(): Promise<void> {
  if (!canCommit.value) return;
  committing.value = true;
  output.value = null;
  try {
    const scan = await api.scanStagedSecrets(props.repoPath).catch(() => null);
    if (scan && scan.findings.length) {
      secretReport.value = scan; // o usuário decide (ou é bloqueado, no modo "block")
      return;
    }
    await doCommit();
  } finally {
    committing.value = false;
  }
}

/** Confirma o commit mesmo com avisos do scanner (somente no modo "warn"). */
async function commitAnyway(): Promise<void> {
  secretReport.value = null;
  committing.value = true;
  try {
    await doCommit();
  } finally {
    committing.value = false;
  }
}

async function doCommit(): Promise<void> {
  try {
    const r = await api.executeCommit(props.repoPath, input.value, { ...policy.value });
    output.value = { ok: true, text: `${t('commit.created', { hash: r.commitHash.slice(0, 7) })}\n\n${r.output}`.trim() };
    form.subject = '';
    form.body = '';
    form.breakingChanges = '';
    form.ticketNumber = '';
    autoTicket.value = false;
    touched.value = false;
    emit('committed', r.commitHash);
    applyBranchHints();
  } catch (e) {
    const msg = errMsg(e);
    output.value = { ok: false, text: isHookRejection(msg) ? stripHookPrefix(msg) : msg };
  }
}

// --- Compartilhar a política com o time -------------------------------------------------------
async function saveTeamPolicy(): Promise<void> {
  const p = localPolicy;
  try {
    await api.saveRepoConfig(props.repoPath, {
      commit: {
        maxSubjectLength: p.maxSubjectLength,
        scopeRequired: p.scopeRequired,
        ticketRequired: p.ticketRequired,
        ticketPattern: p.ticketPattern,
        ticketFromBranch: p.ticketFromBranch,
      },
      secrets: { mode: 'warn' },
    });
    await loadTeamPolicy();
    policyNote.value = t('commit.policySaved');
  } catch (e) {
    policyNote.value = errMsg(e);
  }
}
</script>

<template>
  <form class="cf" @submit.prevent="submit" @keydown.ctrl.enter.prevent="submit" @keydown.meta.enter.prevent="submit">
    <div class="cf__title">
      <h3>{{ t('commit.title') }}</h3>
      <GnButton size="sm" type="button" @click="showPolicy = !showPolicy">{{ t('commit.policy') }}</GnButton>
    </div>

    <div v-if="teamLocked" class="cf__team" :title="t('commit.teamTitle')">
      {{ t('commit.teamActive') }}
      <small v-if="policy.types?.length">{{ t('commit.teamTypes', { list: policy.types.join(', ') }) }}</small>
      <small v-if="policy.scopes?.length">{{ t('commit.teamScopes', { list: policy.scopes.join(', ') }) }}</small>
    </div>
    <ul v-if="team?.errors.length" class="cf__teamerr">
      <li v-for="er in team.errors" :key="er">⚠ {{ er }}</li>
    </ul>

    <fieldset v-if="showPolicy" class="cf__policy">
      <template v-if="teamLocked">
        <small class="muted">{{ t('commit.teamNote') }}</small>
        <small>
          {{
            t('commit.teamSummary', {
              max: policy.maxSubjectLength,
              scope: policy.scopeRequired ? t('commit.required') : t('commit.optional'),
              ticket: policy.ticketRequired ? t('commit.required') : t('commit.optional'),
              pattern: policy.ticketPattern,
              secrets: team?.secrets.mode ?? '',
            })
          }}
        </small>
      </template>
      <template v-else>
        <label><input v-model="localPolicy.scopeRequired" type="checkbox" /> {{ t('commit.scopeRequired') }}</label>
        <label><input v-model="localPolicy.ticketRequired" type="checkbox" /> {{ t('commit.ticketRequired') }}</label>
        <label><input v-model="localPolicy.ticketFromBranch" type="checkbox" /> {{ t('commit.ticketFromBranch') }}</label>
        <label>
          {{ t('commit.ticketRegex') }}
          <input v-model="localPolicy.ticketPattern" :class="{ bad: !patternValid }" spellcheck="false" />
        </label>
        <small v-if="!patternValid" class="err">{{ t('commit.regexInvalid') }}</small>
        <GnButton size="sm" type="button" @click="saveTeamPolicy">{{ t('commit.savePolicy') }}</GnButton>
        <small class="muted">{{ t('commit.savePolicyHelp') }}</small>
      </template>
      <small v-if="policyNote" class="muted">{{ policyNote }}</small>
    </fieldset>

    <div class="cf__field">
      <span class="cf__label">{{ t('commit.type') }}</span>
      <div class="cf__types">
        <button
          v-for="ty in allowedTypes"
          :key="ty"
          type="button"
          class="chip"
          :class="{ 'chip--on': form.type === ty }"
          :title="typeHint(ty)"
          @click="form.type = ty"
        >
          {{ ty }}
        </button>
      </div>
      <small class="muted">{{ typeHint(form.type) }}</small>
    </div>

    <div class="cf__row">
      <label class="cf__field">
        <span class="cf__label">{{ t('commit.scope') }} {{ policy.scopeRequired ? '*' : `(${t('commit.optional')})` }}</span>
        <ComboBox v-model="form.scope" searchable :options="policy.scopes ?? []" :placeholder="t('commit.scopePh')" :aria-label="t('commit.scope')" />
      </label>
      <label class="cf__field">
        <span class="cf__label">{{ t('commit.ticket') }} {{ policy.ticketRequired ? '*' : `(${t('commit.optional')})` }}</span>
        <input v-model="form.ticketNumber" :placeholder="t('commit.ticketPh')" spellcheck="false" />
      </label>
    </div>
    <small v-if="ticketHint && autoTicket" class="muted">{{ ticketHint }}</small>

    <label class="cf__field">
      <span class="cf__label">
        {{ t('commit.subject') }}
        <span class="counter" :class="{ 'counter--over': subjectLen > policy.maxSubjectLength }">
          {{ subjectLen }}/{{ policy.maxSubjectLength }}
        </span>
      </span>
      <input v-model="form.subject" data-focus="commit-subject" :placeholder="t('commit.subjectPh')" />
    </label>

    <label class="cf__field">
      <span class="cf__label">{{ t('commit.body') }}</span>
      <textarea v-model="form.body" rows="3" :placeholder="t('commit.bodyPh')"></textarea>
    </label>

    <label class="cf__field">
      <span class="cf__label">{{ t('commit.breaking') }}</span>
      <textarea v-model="form.breakingChanges" rows="2" :placeholder="t('commit.breakingPh')"></textarea>
    </label>

    <div class="cf__lint" :class="{ ok: validation.isValid }">
      <template v-if="validation.isValid">{{ t('commit.ok') }}</template>
      <ul v-else-if="touched">
        <li v-for="er in validation.errors" :key="er">✖ {{ er }}</li>
      </ul>
      <template v-else>{{ t('commit.fill') }}</template>
    </div>

    <details class="cf__preview">
      <summary>{{ t('commit.preview') }}</summary>
      <pre>{{ preview }}</pre>
    </details>

    <div v-if="secretReport" class="cf__secrets" role="alert">
      <strong>
        {{ secretReport.mode === 'block' ? t('commit.secretsBlocked') : t('commit.secretsWarn') }}
      </strong>
      <ul>
        <li v-for="(f, i) in secretReport.findings" :key="i">
          {{ KIND_ICON[f.kind] }} <b>{{ f.file }}</b><template v-if="f.line">:{{ f.line }}</template> — {{ f.rule }}
          <code v-if="f.kind === 'secret'">{{ f.preview }}</code>
        </li>
      </ul>
      <small class="muted">{{ t('commit.secretsHelp') }}</small>
      <div class="cf__secrets-actions">
        <GnButton size="sm" type="button" @click="secretReport = null">{{ t('commit.back') }}</GnButton>
        <GnButton v-if="secretReport.mode !== 'block'" size="sm" variant="danger" type="button" @click="commitAnyway">
          {{ t('commit.anyway') }}
        </GnButton>
      </div>
    </div>

    <GnButton variant="primary" tone="success" type="submit" :disabled="!canCommit" title="Ctrl+Enter">
      {{ committing ? t('commit.submitting') : t('commit.submit', { n: stagedCount }) }}
    </GnButton>
    <small v-if="stagedCount === 0" class="muted">{{ t('commit.needStage') }}</small>

    <div v-if="output" class="cf__out" :class="output.ok ? 'cf__out--ok' : 'cf__out--err'">
      <strong>{{ output.ok ? t('commit.done') : t('commit.rejected') }}</strong>
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
  &__team {
    font-size: 12px;
    border: 1px solid var(--gn-accent);
    border-radius: var(--gn-radius);
    padding: 5px 9px;
    small { color: var(--gn-muted); }
  }
  &__teamerr { margin: 0; padding: 0; list-style: none; font-size: 12px; color: var(--gn-warn); }
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
  &__secrets {
    border: 1px solid var(--gn-warn);
    border-radius: var(--gn-radius);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; max-height: 180px; overflow: auto; }
    code { font-family: var(--gn-mono); background: var(--gn-bg); padding: 0 4px; border-radius: 3px; }
  }
  &__secrets-actions { display: flex; gap: 8px; }
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
