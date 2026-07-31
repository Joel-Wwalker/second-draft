# Second Draft review: 114 rewrites

Every paragraph below was generated to order (its own topic, register, writer situation
and sentence-structure constraint), then rewritten by the shipped engine running the real
on-device model, including the retry. Nothing is hand-picked.

## Where it stands

| | before | after |
| --- | --- | --- |
| flat pacing (spread under 0.22) | 31% | 11% |
| heavy vocabulary (over 30% long words) | 64% | 12% |
| mean sentence-length spread | 0.297 | 0.339 |
| mean long-word rate | 0.329 | 0.233 |
| mean words | 123 | 110 |

Human writing, measured over 1000 Wikipedia introductions, runs a median spread of 0.41
and a median long-word rate of 0.19. Those are the targets, not zero.

- rewrites that needed a second pass: **48%**
- tell count went up: **3**
- came back byte-identical to the input: **0**
- flagged for lost content: **2**

## Read these first

The ones most likely to show a real problem.

### Came back unchanged

None.

### Tell count rose (3)

The rewrite introduced more tells than it removed.

- [20](part-000.md#20-database-migration-downtime) business memo, database migration downtime
- [67](part-050.md#67-papermaking) report, papermaking
- [112](part-100.md#112-remote-onboarding) how-to, remote onboarding


### Still flat after rewriting (12)

Sentence lengths still sit in one narrow band.

- [2](part-000.md#2-remote-onboarding) how-to, remote onboarding
- [16](part-000.md#16-internal-wiki-neglect) email, internal wiki neglect
- [22](part-000.md#22-a-memory-leak-in-production) how-to, a memory leak in production
- [38](part-000.md#38-tidal-energy) marketing, tidal energy
- [74](part-050.md#74-cat-behaviour-at-night) encyclopedic, cat behaviour at night
- [76](part-050.md#76-meal-planning-on-a-budget) email, meal planning on a budget
- [77](part-050.md#77-moving-house-with-children) report, moving house with children
- [92](part-050.md#92-a-council-budget-shortfall) how-to, a council budget shortfall
- [100](part-100.md#100-jazz-improvisation) business memo, jazz improvisation
- [107](part-100.md#107-long-distance-hiking) report, long distance hiking
- [109](part-100.md#109-bookbinding) news, bookbinding
- [110](part-100.md#110-quarterly-hiring-plans) business memo, quarterly hiring plans


### Still heavy after rewriting (14)

Vocabulary is still above the human 90th percentile.

- [0](part-000.md#0-quarterly-hiring-plans) business memo, quarterly hiring plans
- [3](part-000.md#3-a-failed-product-launch) review, a failed product launch
- [5](part-000.md#5-succession-planning) academic, succession planning
- [11](part-000.md#11-shift-scheduling) blog, shift scheduling
- [14](part-000.md#14-open-plan-office-noise) encyclopedic, open-plan office noise
- [20](part-000.md#20-database-migration-downtime) business memo, database migration downtime
- [22](part-000.md#22-a-memory-leak-in-production) how-to, a memory leak in production
- [29](part-000.md#29-monitoring-alert-fatigue) news, monitoring alert fatigue
- [45](part-000.md#45-seed-bank-storage) academic, seed bank storage
- [53](part-050.md#53-byzantine-mosaics) review, Byzantine mosaics
- [68](part-050.md#68-sanskrit-grammar) marketing, Sanskrit grammar
- [92](part-050.md#92-a-council-budget-shortfall) how-to, a council budget shortfall
- [96](part-050.md#96-a-charity-annual-report) email, a charity annual report
- [100](part-100.md#100-jazz-improvisation) business memo, jazz improvisation


### Lost content (2)

The fidelity check found something missing that the retry could not restore.

- [50](part-050.md#50-the-silk-road) business memo, the Silk Road
- [80](part-050.md#80-secondhand-furniture-restoration) business memo, secondhand furniture restoration


## All pairs

- [part-000.md](part-000.md) — 50 pairs, 0 to 49
- [part-050.md](part-050.md) — 50 pairs, 50 to 99
- [part-100.md](part-100.md) — 14 pairs, 100 to 113