/// <reference lib="webworker" />
import type { ExpertParams } from '../gin/lab/expert';
import { type HandForAnalysis, analyzeHand } from '../gin/lab/analysis';
import release from '../gin/lab/champions/release.json';

/**
 * Hand analysis off the main thread. A few thousand play-outs per decision is
 * a second or two of solid computation, which on the main thread would freeze
 * the table; here it streams each decision back as it is judged.
 */
export interface AnalysisRequest {
  id: number;
  hand: HandForAnalysis;
}

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  const { id, hand } = e.data;
  try {
    for (const p of analyzeHand(hand, { rollout: release.params as ExpertParams })) {
      self.postMessage({ id, done: p.done, total: p.total, moment: p.moment });
    }
    self.postMessage({ id, finished: true });
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
