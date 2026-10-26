# Long-history performance

`npm run benchmark` (`scripts/benchmark-transcript.ts`) builds a synthetic 10,000-item transcript
(about 5 MB serialized) and times the **data path** only. It does not start Electron, the CLI or
the renderer, so it says nothing about DOM render time, scrolling frame rate or renderer memory.
The transcript is **not virtualized yet**; do not infer smooth 10,000-item rendering from these numbers.

## Measured (this run)

Environment: Linux 6.17 x64, AMD EPYC 7763 (4 vCPU, 15.6 GB), Node v22.23.3, 15 runs each.

| Operation                                                               | Median ms | p95 ms |
| ----------------------------------------------------------------------- | --------: | -----: |
| Whole-transcript snapshot structured clone (IPC proxy, 5,068,168 bytes) |     17.45 |  23.31 |
| Single-item delta structured clone (422 bytes)                          |     0.006 |  0.013 |
| Display text for every user message                                     |     0.168 |  0.568 |
| Find in conversation (`needle`, all items)                              |     1.425 |  5.416 |
| Normalize all items for history indexing                                |     1.727 |  2.409 |

Heap growth for the item set plus serialized copies: 71.5 MB. These are shared-VM numbers; rerun on
your hardware. The structured-clone proxy approximates, but is not, Electron's IPC cost.

## What this shows and does not show

- Sending a whole transcript per streamed update costs ~12,000x more bytes than a one-item delta
  (5,068,168 vs 422). Revisioned deltas are the planned fix and are **not implemented**; the
  current host still emits whole-session views on its 32 ms timer.
- Find and indexing normalization are cheap at this size.

## Budgets enforced by the script (deliberately loose for shared CI runners)

Single-item delta clone p95 ≤ 5 ms; find over all items p95 ≤ 250 ms; user-text derivation p95 ≤ 250 ms.
Budgets for render time and memory will be added when virtualization exists and can be measured.
