# The gin lab

Everything needed to build, train and prove a tournament player for
Napoletane gin, played in full matches to 100.

## The pieces

| file | what it is |
|---|---|
| `fast.ts` | The game again, for speed: cards as 0..39, hands as four 10-bit suit masks, exact deadwood by table lookup (~40ns). Same deal, same rules, same scoring as `game.ts` — `fast.test.ts` plays 1,500 seeds through both and demands identical results. ~90k hands/s per core. |
| `expert.ts` | A fast player with 14 weights: live outs (unseen cards that would meld — buried or opponent-held cards don't count), discard danger read from the public record, a knock threshold that moves with the stock, the opponent's pickups, and the match score, and an upcard rule that weighs taking against a *blind draw* (`blind`), not against standing still -- see "The bait bug" below. |
| `panel.ts` | The opponents, as data: the arena's bots rebuilt, the `human` model (takes upcards that complete a meld from loose cards without poaching, never breaks a meld, shies from feeding your pickups unless holding costs 5+, slips 15%, knocks when legal), plus other human-shaped ones (`casual` takes anything that pairs, `cautious` never throws near your pickups, `forgetful` slips 15% of the time), a gin hunter, and a random player. |
| `inference.ts` | The particle filter from `belief.ts` on integer cards (~30× cheaper). Only public evidence goes in; there is no method that accepts the opponent's cards. |
| `champion.ts` | The tournament player: sample the opponent's hand from the filter, shuffle the rest into a stock, play each candidate move out with the expert in both chairs on the *same* worlds, score in match equity. The expert's move is the default; search overrules it only when the paired difference clears a confidence bar. |
| `equity.ts` | Chance of winning the match from any score, built backwards from the finish line using a measured distribution of single-hand results. |
| `match.ts` | Matches to 100. Opening alternates every deal (pushes included); no game or box bonuses. These are assumptions — the ruleset only says "to 100". |
| `analysis.ts` | Hand review for a person: the champion shadows their seat, searches every decision, re-prices any disagreement on fresh worlds (so the cost isn't flattered by best-of-N noise), grades it best / close / inaccuracy / mistake / blunder, and adds plain reasons read off the public record -- a discard that feeds their pickup, outs already buried, a knock undercut in N% of worlds. Powers the in-game **Analyze hand** button and `lab:logs --review`. |
| `adapter.ts` | Seats any lab player at the real referee through `GinView` + public history only. `adapter.test.ts` proves identical decisions in both engines. |
| `pool.ts`, `worker.ts`, `jobs.ts` | All cores. Results are sums, so any number of workers add up exactly. |

## Running things

```bash
npm run lab:league -- 4000                 # round robin of the panel, hands
npm run lab:tune -- 60 --out expert-v1     # train the expert (cross-entropy method)
npm run lab:tune -- 25 --matches --from src/gin/lab/champions/expert-v1.json --out expert-v2
npm run lab:equity -- 500000               # measure hand results, build the equity table
npm run lab:duel -- champion expert-v1 1500 --worlds 200
npm run lab:duel -- champion-eq champion 3000 --matches
npm run lab:tune -- 15 --against champion --from src/gin/lab/champions/expert-v1.json --out exploit-v1 --pop 24 --deals 300
npm run lab:championship -- champion-eq 1000 --extra expert-v1,exploit-v1
npm run lab:referee -- champion-eq 150 --vs solver
```

Player names: anything in `panel.ts`, any `champions/*.json`, or `champion` with
suffixes `-eq` (score in match equity) and `-uniform` (ablation: ignore the
inference). Search flags: `--worlds`, `--width`, `--particles`, `--z`, `--rollout`.

## In the game

The game is **Napoletane Gin Rummy**, served at `/gin`.


`src/gin/opponents.ts` is what the solo screen plays: **Easy** is the human
model, **Medium** is the released expert (`champions/release.json`) with no
search, **Hard** is the champion at 150 worlds per decision (~20ms in a
browser). All three play through `adapter.ts`, seeing only their own cards and
the public record. Matches go to 100; the opening alternates every deal.

After each hand, **Analyze hand** opens a review of every decision you made
(`src/gin-ui/GinAnalysis.tsx`), computed in a web worker by `analysis.ts`:
what you did, what the champion would have done, what it cost in points per
hand, and why where the table makes it plain.

## Logs of real games

Every finished solo hand is posted to `/gin/api/hands` and appended to
`logs/gin-hands.jsonl` (gitignored; also stored in Postgres when the server has
a database). A record is the seed, every action, ms timings, the level, and the
match score going in -- enough for the referee to replay it exactly. If the
server is unreachable, records queue in the browser and go with the next hand.

```bash
npm run lab:logs                     # results per level, outcomes, think time
npm run lab:logs -- --review         # the champion shadows your seat and prices every call
npm run lab:logs -- --review --all   # every flagged decision, with its reasons
npm run lab:logs -- --review --level hard
```

To play locally with logging: run `npm run server` and `npm run dev:gin`, then
open http://localhost:5174/gin/.

## How a claim gets made

* **Mirrored deals.** Every hand, and every match, is played twice on the same
  shuffle with the seats swapped. Deal luck cancels; what's left is decisions.
* **Standard errors on everything.** A difference under two is noise.
* **Robustness, not averages.** The tuner scores half the mean edge and half
  the mean of the three worst pairings; the championship verdict is the worst
  pairing.
* **Exploiters.** Freeze the champion and train a fresh player whose only goal
  is to beat it. How far that player gets is a direct measure of how
  exploitable the champion is — the practical stand-in for distance from
  equilibrium in a game too big to solve.
* **No peeking, tested.** `lab.test.ts` gives the champion two deals that look
  identical from its chair but differ in every hidden card, and requires
  identical decisions.

## The bait bug (found through hand review, fixed in expert-v4)

A person reviewing their own games flagged a "blunder" that made no sense:
throwing a loose King instead of the 4 of swords, priced at 8 points. Taking
the position apart (`probe.run.ts`) showed why. Up to v3 the expert decided
whether to take the upcard by comparing "take it and throw my worst card"
with **keeping the hand exactly as it is** -- but the real alternative, a blind
draw, also lets you throw your worst card. So any low upcard looked like a
bargain to a hand holding a high loose card, and the rollout opponent took
the 4 of swords 70% of the time. The search had learned to *bait* that
opponent with low discards. Against an opponent who does not bite (the
human model), the verdict vanished: the King throw was equal-best.

`blind` (0..1) blends the comparison toward the expected hand after a blind
draw. Tuned from v3 with it free, the tuner pushed it to 0.99 and the take
margin down to 1.55. Results:

* expert-v4 beats v3 by +0.23 points a hand (400k hands, 25σ) and wins 52.4%
  of 200k matches (37σ); it beats v3's numbers against every panel member.
* The champion rolling out with v4 beats the champion rolling out with v3:
  +0.35 ± 0.15 a hand over 8,000 hands, 52.6% ± 1.2 of 1,200 matches.
* v4 is `release.json`: Medium, Hard's rollouts, and the analysis.

Two review fixes came out of the same investigation: costs now come from
8,000-particle inference (at 800 the cloud itself was noisy enough to flag
equal moves as errors on some seeds -- `deepreview.run.ts` reruns one decision
under many seeds to show this), and an error must clear 2.5 standard errors.

```bash
npx tsx src/gin/lab/probe.run.ts MATCH HAND TURN throw --opponents --their-reply
npx tsx src/gin/lab/deepreview.run.ts MATCH HAND TURN 600 1500 8000 --runs 6
```
