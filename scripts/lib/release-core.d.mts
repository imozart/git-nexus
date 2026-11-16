// Tipos do núcleo puro de versão/notas (release-core.mjs), para uso no TypeScript do app.

export interface ParsedCommit {
  hash: string;
  short: string;
  author: string;
  type: string;
  scope: string;
  breaking: boolean;
  breakingNote: string | null;
  title: string;
  pr: string | null;
  ticket: string | null;
}

export type BumpKind = 'major' | 'minor' | 'patch';

export interface Section {
  id: string;
  title: string;
}

export interface CommitGroup extends Section {
  items: ParsedCommit[];
}

export const SECTIONS: Section[];
export const RELEASE_TYPES: string[];
export function shouldRelease(commits: ParsedCommit[]): boolean;
export function latestTag(tags: string[]): string | null;
export function latestBetaTag(tags: string[], base: string): string | null;
export function parseCommit(c: { hash: string; author: string; subject: string; body?: string }): ParsedCommit;
export function decideBump(commits: ParsedCommit[]): BumpKind;
export function bumpVersion(base: string, bump: BumpKind): string;
export function computeNext(o: {
  tags: string[];
  commits: ParsedCommit[];
  bumpOverride?: 'auto' | BumpKind;
  initialVersion: string;
}): { previous: string | null; version: string; bump: BumpKind | 'initial' };
export function computeBeta(o: {
  tags: string[];
  commits: ParsedCommit[];
  bumpOverride?: 'auto' | BumpKind;
  initialVersion: string;
}): { previous: string | null; version: string; stable: string; bump: BumpKind | 'initial'; channel: 'beta' };
export function isReleaseCommit(c: ParsedCommit): boolean;
export function groupCommits(commits: ParsedCommit[]): CommitGroup[];
export function renderCommitLine(c: ParsedCommit, repo?: string): string;
export function renderSections(commits: ParsedCommit[], repo?: string): string[];
export function renderNotes(o: {
  version: string;
  previous: string | null;
  commits: ParsedCommit[];
  repo?: string;
  assets?: Array<{ name: string; size: number }>;
  stats?: string;
  sha?: string;
}): string;
