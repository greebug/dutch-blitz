import { existsSync, readFileSync } from 'node:fs';

import type { ChampionOptions } from './champion';
import { type Equity, buildEquity } from './equity';
import { PANEL, type Spec, specName } from './panel';

/**
 * Names to players, for the command-line runners.
 *
 *  - any panel name (`greedy`, `heuristic-sharp`, `casual`, ...)
 *  - any saved expert in champions/ (`expert-v1`, `exploit-v1`, ...)
 *  - `champion...` for the search player, with suffixes:
 *      `-eq`       score rollouts in match equity rather than points
 *      `@name`     roll out with that saved expert (`champion-eq@expert-v4`)
 *      `:pN`       N particles in its inference (`champion-eq:p4000`)
 *      `+read`     share the inference with its own rollouts (`champion-eq+read`)
 *      `-uniform`  ablation: ignore the inference, guess their hand uniformly
 */
export const CHAMPIONS_DIR = 'src/gin/lab/champions';

/** The equity table built from the measured margins in champions/margins.json. */
export function loadEquity(file = `${CHAMPIONS_DIR}/margins.json`, target = 100): Equity {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, number>;
  return buildEquity(new Map(Object.entries(raw).map(([m, p]) => [Number(m), p])), target);
}

export function saved(name: string) {
  return JSON.parse(readFileSync(`${CHAMPIONS_DIR}/${name}.json`, 'utf8')).params;
}

export interface SearchSettings {
  worlds: number;
  width: number;
  particles: number;
  confidence: number;
  rollout: string;
}

export const DEFAULT_SEARCH: SearchSettings = {
  worlds: 60,
  width: 4,
  particles: 600,
  confidence: 1.5,
  rollout: 'expert-v1',
};

export function resolve(name: string, settings: SearchSettings = DEFAULT_SEARCH): Spec {
  const panel = PANEL.find((s) => specName(s) === name);
  if (panel) return panel;
  if (name.startsWith('champion')) {
    const options: ChampionOptions = {
      worlds: settings.worlds,
      width: settings.width,
      // `champion-eq:p4000`: this player's own particle count.
      particles: /:p(\d+)/.test(name) ? Number(/:p(\d+)/.exec(name)![1]) : settings.particles,
      confidence: settings.confidence,
      // `champion-eq@expert-v4`: this player's own rollout expert, so two
      // champions differing only in their rollouts can meet in one duel.
      rollout: saved(name.includes('@') ? name.split('@')[1].split(':')[0] : settings.rollout),
      equity: name.includes('-eq') ? loadEquity() : null,
      uniform: name.includes('-uniform'),
      // `champion+read`: our side of the rollouts uses the inference for discard danger.
      readRollouts: name.includes('+read'),
      name,
    };
    return { kind: 'champion', options };
  }
  if (!existsSync(`${CHAMPIONS_DIR}/${name}.json`)) throw new Error(`no player called ${name}`);
  return { kind: 'expert', params: saved(name), name };
}

/** Read --flag value pairs. */
export function flag(args: readonly string[], name: string, fallback: number): number {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
}

export function settingsFrom(args: readonly string[]): SearchSettings {
  const r = args.indexOf('--rollout');
  return {
    worlds: flag(args, '--worlds', DEFAULT_SEARCH.worlds),
    width: flag(args, '--width', DEFAULT_SEARCH.width),
    particles: flag(args, '--particles', DEFAULT_SEARCH.particles),
    confidence: flag(args, '--z', DEFAULT_SEARCH.confidence),
    rollout: r >= 0 ? args[r + 1] : DEFAULT_SEARCH.rollout,
  };
}

/** Arguments that are not flags or flag values. `bare` lists flags that take no value. */
export function positional(args: readonly string[], bare: readonly string[] = ['--matches']): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (!bare.includes(args[i])) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}
