import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, MAX_VALUE, OFFLINE_CAP_MS, createState, getStats, getPrice, harvest,
  purchase, advance, parseSave, serializeSave, createSaveStore, getMilestones, getGardenStage } from '../assets/game-core.js';
const NOW = 1_800_000_000_000;
function memoryStorage() {
  const data = new Map();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
}
test('a fresh garden has one seed per tap and no automatic production', () => {
  const state = createState(NOW); assert.equal(state.seeds, 0); assert.deepEqual(getStats(state), { perTap: 1, perSecond: 0 });
  const next = harvest(state, NOW); assert.equal(next.seeds, 1); assert.equal(next.totalEarned, 1); assert.equal(next.taps, 1); assert.equal(state.seeds, 0);
});
test('unaffordable upgrades do not spend seeds or change levels', () => {
  const result = purchase(createState(NOW), 'sprinkler', NOW); assert.equal(result.purchased, false); assert.equal(result.state.seeds, 0); assert.equal(result.state.upgrades.sprinkler, 0);
});
test('buy gloves, increase tap power, and raise the next price', () => {
  const state = { ...createState(NOW), seeds: 50, totalEarned: 50 };
  const firstPrice = getPrice(state, 'gloves'); assert.equal(firstPrice, 15);
  const result = purchase(state, 'gloves', NOW); assert.equal(result.purchased, true); assert.equal(result.state.seeds, 35);
  assert.equal(getStats(result.state).perTap, 2); assert.ok(getPrice(result.state, 'gloves') > firstPrice);
  assert.equal(harvest(result.state, NOW).seeds, 37);
});
test('timestamp-based helpers generate seeds without timer-count assumptions', () => {
  const state = { ...createState(NOW), seeds: 25, totalEarned: 25 };
  const bought = purchase(state, 'sprinkler', NOW).state;
  const result = advance(bought, NOW + 10_500); assert.equal(result.earned, 10.5); assert.equal(result.state.seeds, 10.5); assert.equal(result.state.totalEarned, 35.5);
  assert.equal(advance(result.state, NOW + 11_000).earned, 0.5);
});
test('offline catch-up is capped at two hours and does not double-credit', () => {
  const state = createState(NOW); state.upgrades.sunbot = 1;
  const result = advance(state, NOW + 10 * OFFLINE_CAP_MS);
  assert.equal(result.earned, 36_000); assert.equal(result.capped, true);
  assert.equal(advance(result.state, NOW + 10 * OFFLINE_CAP_MS).earned, 0);
});
test('backward clocks give no extra seeds', () => {
  const state = createState(NOW); state.upgrades.sprinkler = 1;
  const result = advance(state, NOW - 10_000); assert.equal(result.earned, 0); assert.equal(result.state.lastSeen, NOW - 10_000);
});
test('a clock rollback exceeding one minute can still save, export, and restore', () => {
  const storage = memoryStorage(); const store = createSaveStore(storage);
  const state = { ...createState(NOW), seeds: 20, totalEarned: 100 };
  state.upgrades.sprinkler = 1;
  const rollbackNow = NOW - 120_000;
  const rolled = advance(state, rollbackNow);
  assert.equal(rolled.earned, 0); assert.equal(rolled.state.seeds, 20);
  assert.equal(rolled.state.lastSeen, rollbackNow);
  assert.equal(store.save(rolled.state, rollbackNow), true);
  const exported = serializeSave(rolled.state, rollbackNow);
  assert.deepEqual(parseSave(exported, rollbackNow), rolled.state);
  assert.deepEqual(store.load(rollbackNow).state, rolled.state);
  assert.equal(advance(rolled.state, rollbackNow + 1000).earned, 1);
});
test('loading a pre-rollback local save preserves progress, earns zero, and can save again', () => {
  const storage = memoryStorage(); const store = createSaveStore(storage);
  const state = { ...createState(NOW), seeds: 87, totalEarned: 450, taps: 29 };
  state.upgrades.gloves = 2; state.upgrades.sprinkler = 3; state.upgrades.sunbot = 1;
  assert.equal(store.save(state, NOW), true);
  const rollbackNow = NOW - 120_000;
  const loaded = store.load(rollbackNow);
  assert.equal(loaded.earned, 0); assert.equal(loaded.elapsedMs, 0);
  assert.deepEqual(loaded.state, { ...state, lastSeen: rollbackNow });
  assert.equal(store.save(loaded.state, rollbackNow), true);
  assert.deepEqual(store.load(rollbackNow).state, loaded.state);
  // A file supplied from outside the browser is deliberately still strict.
  assert.throws(() => parseSave(serializeSave(state, NOW), rollbackNow), /future timestamp/);
});
test('local save clock recovery never bypasses structural or timestamp validation', () => {
  const storage = memoryStorage(); const store = createSaveStore(storage);
  const state = createState(NOW);
  for (const bad of [
    { ...state, lastSeen: -1 }, { ...state, lastSeen: null }, { ...state, lastSeen: 'today' },
    { ...state, lastSeen: NOW + 0.5 }, { ...state, lastSeen: MAX_VALUE + 1 },
    { ...state, seeds: -1 }, { ...state, extra: true },
    { ...state, upgrades: { ...state.upgrades, extra: 1 } },
    { ...state, upgrades: { ...state.upgrades, sprinkler: 51 } }, [], null,
  ]) {
    storage.setItem(STORAGE_KEY, JSON.stringify(bad));
    assert.throws(() => store.load(NOW - 120_000));
  }
  storage.setItem(STORAGE_KEY, '{'); assert.throws(() => store.load(NOW));
  storage.setItem(STORAGE_KEY, JSON.stringify(state).replace('"lastSeen":' + NOW, '"lastSeen":1e999'));
  assert.throws(() => store.load(NOW));
});
test('save serialization round-trips and values remain bounded', () => {
  const state = harvest(createState(NOW), NOW); assert.deepEqual(parseSave(serializeSave(state, NOW), NOW), state);
  const full = { ...state, seeds: MAX_VALUE - 0.5, totalEarned: MAX_VALUE - 0.5 };
  assert.equal(harvest(full, NOW).seeds, MAX_VALUE);
});
test('reject broken JSON, NaN-like values, negatives, overflows, unknown fields and future saves', () => {
  assert.throws(() => parseSave('{', NOW)); assert.throws(() => parseSave('x'.repeat(16_385), NOW));
  const state = createState(NOW);
  for (const bad of [
    { ...state, seeds: -1 }, { ...state, seeds: null }, { ...state, totalEarned: MAX_VALUE + 1 },
    { ...state, seeds: 10, totalEarned: 1 }, { ...state, lastSeen: NOW + 70_000 },
    { ...state, admin: true }, { ...state, upgrades: { ...state.upgrades, extra: 1 } },
    { ...state, upgrades: { ...state.upgrades, gloves: 0.5 } },
    { ...state, upgrades: { ...state.upgrades, gloves: 51 } }, [], null,
  ]) assert.throws(() => parseSave(JSON.stringify(bad), NOW));
  assert.throws(() => parseSave(JSON.stringify(state).replace('"seeds":0', '"seeds":1e999'), NOW));
});
test('storage reset removes only the game key, preserving a sentinel and all other data', () => {
  const storage = memoryStorage(); storage.setItem('other-game.sentinel', 'untouched');
  const store = createSaveStore(storage); assert.equal(store.save(harvest(createState(NOW), NOW), NOW), true);
  assert.ok(storage.getItem(STORAGE_KEY)); assert.equal(store.load(NOW).state.seeds, 1);
  assert.equal(store.reset(), true); assert.equal(storage.getItem(STORAGE_KEY), null); assert.equal(storage.getItem('other-game.sentinel'), 'untouched');
});
test('blocked/quota-limited storage fails gracefully without blocking the game', () => {
  const blocked = createSaveStore({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } });
  assert.equal(blocked.load(NOW), null); assert.equal(blocked.available, false); assert.match(blocked.warning, /blocked/);
  assert.equal(harvest(createState(NOW), NOW).seeds, 1);
  const quota = createSaveStore({ getItem() { return null; }, setItem() { throw new Error('full'); }, removeItem() {} });
  assert.equal(quota.save(createState(NOW), NOW), false); assert.equal(quota.available, false);
});
test('milestones and garden stages depend on lifetime seeds rather than current balance', () => {
  const state = { ...createState(NOW), totalEarned: 1000, seeds: 5 };
  assert.equal(getMilestones(state).filter((item) => item.achieved).length, 4); assert.equal(getGardenStage(state).index, 3);
});
test('maximum upgrade level is bounded and an invalid id cannot purchase anything', () => {
  const state = { ...createState(NOW), seeds: MAX_VALUE, totalEarned: MAX_VALUE }; state.upgrades.gloves = 50;
  assert.equal(purchase(state, 'gloves', NOW).purchased, false); assert.throws(() => purchase(state, '__proto__', NOW));
});
