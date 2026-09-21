import { scan as ramcardsScan } from '../scan.js';

// Thin adapter over the existing ramcards.ro scanner (GoMag store, HTML + JSON-LD).
// Keeps the proven scan logic untouched; just exposes it through the shop interface.
// Uses the original state file path (data/state.json) so the live baseline carries over
// with no re-baseline.
async function scan({ scannedAt, log } = {}) {
  const snapshot = await ramcardsScan({ scannedAt, log });
  return snapshot.products;
}

export const ramcards = {
  id: 'ramcards',
  name: 'RamCards — Pokémon TCG',
  stateFile: 'data/state.json',
  scan,
};
