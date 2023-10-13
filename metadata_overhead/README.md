# Metadata overhead

Microbenchmarks to measure metadata overhead, as described in the paper's Section 7.2.

## Usage

### Install

```bash
npm ci
```

### Scripts

- `npm run loadSave`: Run without args for usage. Measures time to load and save `.savedState` files output by the analysis script. These files store the frameworks-specific saved state at the end of each trial; we measure the time for the framework to load and re-save that state.
- `npm run memory`: Run without args for usage. Measures memory usage of saved states, after being loaded by the framework.
- `npm run yjsDelta`: See header comment in `src/yjs_delta.ts` for usage. Source of data mentioned in the analysis of Yjs's results (Section 7.1.6).
- `npm run automergeMark`: See header comment in `src/automerge_mark.ts` for usage. Source of data mentioned in the analysis of Automerge's results (Section 7.1.6).
