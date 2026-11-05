/** Sprout Circuit — original, dependency-free incremental game logic. */
export const STORAGE_KEY = 'tapsprout.sprout-circuit.v1';
export const SAVE_VERSION = 1;
export const OFFLINE_CAP_MS = 2 * 60 * 60 * 1000;
export const MAX_VALUE = 1e15;
export const MAX_UPGRADE_LEVEL = 50;

export const UPGRADES = Object.freeze([
  Object.freeze({ id: 'gloves', name: 'Garden gloves', icon: '✦', description: '+1 seed with every harvest', baseCost: 15, growth: 1.6, perTap: 1, perSecond: 0 }),
  Object.freeze({ id: 'sprinkler', name: 'Little sprinkler', icon: '◒', description: '+1 seed per second, automatically', baseCost: 25, growth: 1.65, perTap: 0, perSecond: 1 }),
  Object.freeze({ id: 'sunbot', name: 'Solar helper', icon: '☀', description: '+5 seeds per second, automatically', baseCost: 120, growth: 1.72, perTap: 0, perSecond: 5 }),
]);

const MILESTONES = Object.freeze([
  { amount: 10, label: 'First sprouts', description: 'Grow 10 seeds in total.' },
  { amount: 50, label: 'A tiny garden', description: 'Grow 50 seeds in total.' },
  { amount: 250, label: 'Growing together', description: 'Grow 250 seeds in total.' },
  { amount: 1000, label: 'An orchard of ideas', description: 'Grow 1,000 seeds in total.' },
  { amount: 5000, label: 'Pocket paradise', description: 'Grow 5,000 seeds in total.' },
]);
const STAGES = Object.freeze([
  { threshold: 0, name: 'First seedling' }, { threshold: 50, name: 'Tiny garden' },
  { threshold: 250, name: 'Growing grove' }, { threshold: 1000, name: 'Solar orchard' },
  { threshold: 5000, name: 'Pocket paradise' },
]);

function timestamp(now) {
  if (!Number.isFinite(now) || now < 0) throw new Error('Invalid clock value.');
  return Math.floor(now);
}
function cap(value) { return Math.min(MAX_VALUE, Math.max(0, value)); }
function copy(state) { return { ...state, upgrades: { ...state.upgrades } }; }

export function createState(now = Date.now()) {
  return { version: SAVE_VERSION, seeds: 0, totalEarned: 0, taps: 0,
    upgrades: { gloves: 0, sprinkler: 0, sunbot: 0 }, lastSeen: timestamp(now) };
}
export function getStats(state) {
  return UPGRADES.reduce((stats, item) => ({
    perTap: stats.perTap + item.perTap * state.upgrades[item.id],
    perSecond: stats.perSecond + item.perSecond * state.upgrades[item.id],
  }), { perTap: 1, perSecond: 0 });
}
export function getPrice(state, id) {
  const item = UPGRADES.find((upgrade) => upgrade.id === id);
  if (!item) throw new Error('Unknown upgrade.');
  return Math.min(MAX_VALUE, Math.ceil(item.baseCost * item.growth ** state.upgrades[id]));
}
/** Timestamp accounting also handles throttled/background tabs. Any single catch-up is capped at two hours. */
export function advance(state, now = Date.now()) {
  const next = copy(state);
  const current = timestamp(now);
  const elapsed = Math.max(0, current - state.lastSeen);
  const creditedMs = Math.min(OFFLINE_CAP_MS, elapsed);
  const earned = Math.min(MAX_VALUE - next.seeds, getStats(state).perSecond * creditedMs / 1000);
  next.seeds = cap(next.seeds + earned);
  next.totalEarned = cap(next.totalEarned + earned);
  // Rebase after a clock rollback: award zero catch-up, then keep future saves valid.
  next.lastSeen = current;
  return { state: next, earned, elapsedMs: elapsed, capped: elapsed > OFFLINE_CAP_MS };
}
export function harvest(state, now = Date.now()) {
  const next = advance(state, now).state;
  const earned = Math.min(MAX_VALUE - next.seeds, getStats(next).perTap);
  next.seeds = cap(next.seeds + earned);
  next.totalEarned = cap(next.totalEarned + earned);
  next.taps = Math.min(MAX_VALUE, next.taps + 1);
  return next;
}
export function purchase(state, id, now = Date.now()) {
  const next = advance(state, now).state;
  const cost = getPrice(next, id);
  if (next.upgrades[id] >= MAX_UPGRADE_LEVEL) return { state: next, purchased: false, cost, reason: 'Maximum level reached.' };
  if (next.seeds + 1e-9 < cost) return { state: next, purchased: false, cost, reason: 'Not enough seeds yet.' };
  next.seeds = Math.max(0, next.seeds - cost);
  next.upgrades[id] += 1;
  return { state: next, purchased: true, cost, reason: '' };
}
export function getMilestones(state) {
  return MILESTONES.map((item) => ({ ...item, achieved: state.totalEarned >= item.amount }));
}
export function getGardenStage(state) {
  let index = 0;
  STAGES.forEach((stage, i) => { if (state.totalEarned >= stage.threshold) index = i; });
  return { index, ...STAGES[index] };
}

function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, allowed) {
  return plainObject(value) && Object.keys(value).length === allowed.length &&
    Object.keys(value).every((key) => allowed.includes(key));
}
function validNumber(value, integer = false) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_VALUE && (!integer || Number.isSafeInteger(value));
}
function validateSaveValue(value, now, allowFutureTimestamp) {
  const clock = timestamp(now);
  if (!exactKeys(value, ['version', 'seeds', 'totalEarned', 'taps', 'upgrades', 'lastSeen']) || value.version !== SAVE_VERSION) {
    throw new Error('This is not a supported Sprout Circuit save.');
  }
  if (!validNumber(value.seeds) || !validNumber(value.totalEarned) || value.seeds > value.totalEarned + 1e-6 ||
      !validNumber(value.taps, true) || !validNumber(value.lastSeen, true) || (!allowFutureTimestamp && value.lastSeen > clock + 60_000)) {
    throw new Error('The save contains invalid numbers or a future timestamp.');
  }
  const ids = UPGRADES.map((item) => item.id);
  if (!exactKeys(value.upgrades, ids) || ids.some((id) => !validNumber(value.upgrades[id], true) || value.upgrades[id] > MAX_UPGRADE_LEVEL)) {
    throw new Error('The save contains invalid upgrades.');
  }
  // Rebuild explicitly: no arbitrary imported fields, prototypes, or HTML enter state.
  return { version: SAVE_VERSION, seeds: value.seeds, totalEarned: value.totalEarned, taps: value.taps,
    upgrades: { gloves: value.upgrades.gloves, sprinkler: value.upgrades.sprinkler, sunbot: value.upgrades.sunbot },
    lastSeen: Math.min(clock, value.lastSeen) };
}
export function validateSave(value, now = Date.now()) {
  return validateSaveValue(value, now, false);
}
function parseSaveJSON(raw) {
  if (typeof raw !== 'string' || raw.length > 16_384) throw new Error('Choose a Sprout Circuit JSON save smaller than 16 KB.');
  try { return JSON.parse(raw); } catch { throw new Error('That file is not valid JSON.'); }
}
export function parseSave(raw, now = Date.now()) {
  return validateSave(parseSaveJSON(raw), now);
}
export function serializeSave(state, now = Date.now()) {
  return JSON.stringify(validateSave(state, now));
}

/** Injectable browser storage adapter. Never clears other games or website settings. */
export function createSaveStore(storage) {
  let usable = Boolean(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function' && typeof storage.removeItem === 'function');
  let problem = usable ? '' : 'Browser storage is unavailable. Progress stays in this tab; export a save to keep it.';
  return {
    get available() { return usable; },
    get warning() { return problem; },
    load(now = Date.now()) {
      if (!usable) return null;
      let raw;
      try { raw = storage.getItem(STORAGE_KEY); }
      catch { usable = false; problem = 'Browser storage is blocked. Export a save before closing this tab.'; return null; }
      if (raw === null) return null;
      // A device clock can move backward while the game is closed. Validate the
      // same strict structure/numbers, but rebase a local future timestamp with
      // zero offline credit. External file imports remain strict in parseSave().
      return advance(validateSaveValue(parseSaveJSON(raw), now, true), now);
    },
    save(state, now = Date.now()) {
      if (!usable) return false;
      const raw = serializeSave(state, now);
      try { storage.setItem(STORAGE_KEY, raw); return true; }
      catch { usable = false; problem = 'Your browser could not save progress. Export a save before closing this tab.'; return false; }
    },
    reset() {
      if (!usable) return false;
      try { storage.removeItem(STORAGE_KEY); return true; }
      catch { usable = false; problem = 'Browser storage is blocked. The old save could not be removed.'; return false; }
    },
  };
}
