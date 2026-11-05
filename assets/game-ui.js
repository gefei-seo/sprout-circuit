import { UPGRADES, MAX_UPGRADE_LEVEL, createState, getStats, getPrice, harvest, purchase,
  advance, parseSave, serializeSave, createSaveStore, getMilestones, getGardenStage } from './game-core.js';

const byId = (id) => document.getElementById(id);
const harvestButton = byId('harvest-button');
if (harvestButton) initializeGame();

function initializeGame() {
  let browserStorage;
  try { browserStorage = window.localStorage; } catch { browserStorage = null; }
  const store = createSaveStore(browserStorage);
  let state = createState();
  let feedbackTimeout;
  let announcementTimeout;
  let lastStage = -1;
  const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const number = (value) => value >= 1e6 ? compact.format(value) : formatter.format(Math.floor(value + 1e-8));
  const setText = (id, value) => { const element = byId(id); if (element && element.textContent !== String(value)) element.textContent = value; };
  const status = byId('game-status');
  function announce(message, persistent = false) {
    clearTimeout(announcementTimeout);
    if (status) status.textContent = message;
    if (!persistent) announcementTimeout = setTimeout(() => { if (status) status.textContent = store.warning || 'Progress saves automatically in this browser.'; }, 4500);
  }
  function showOffline(result) {
    const element = byId('offline-notice');
    if (!element || !result || result.earned < 1 || result.elapsedMs < 10_000) return;
    element.hidden = false;
    element.textContent = `Welcome back! Your helpers grew ${number(result.earned)} seeds while you were away.${result.capped ? ' Offline growth is capped at 2 hours.' : ''}`;
  }
  try {
    const loaded = store.load();
    if (loaded) { state = loaded.state; showOffline(loaded); }
  } catch (error) {
    announce(`${error.message} Starting a fresh garden.`, true);
  }
  if (!store.available) announce(store.warning, true);

  // Build each upgrade once. Updating affordability does not remove keyboard focus.
  const shop = byId('upgrade-shop');
  const shopRows = [];
  UPGRADES.forEach((upgrade) => {
    const card = document.createElement('article'); card.className = 'upgrade-card';
    const icon = document.createElement('span'); icon.className = 'upgrade-icon'; icon.textContent = upgrade.icon; icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div'); copy.className = 'upgrade-copy';
    const heading = document.createElement('h3'); heading.textContent = upgrade.name;
    const description = document.createElement('p'); description.textContent = upgrade.description;
    const level = document.createElement('span'); level.className = 'upgrade-level';
    copy.append(heading, description, level);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'upgrade-buy'; button.dataset.upgrade = upgrade.id;
    button.addEventListener('click', () => {
      const result = purchase(state, upgrade.id); state = result.state;
      if (result.purchased) { announce(`${upgrade.name} upgraded to level ${state.upgrades[upgrade.id]}.`); save(false); }
      else announce(result.reason);
      render();
    });
    card.append(icon, copy, button); if (shop) shop.append(card);
    shopRows.push({ upgrade, card, level, button });
  });
  const milestoneRows = getMilestones(state).map((milestone) => {
    const li = document.createElement('li'); li.className = 'milestone';
    const icon = document.createElement('span'); icon.className = 'milestone-check'; icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong'); title.textContent = milestone.label;
    const description = document.createElement('span'); description.textContent = milestone.description;
    li.append(icon, title, description); byId('milestone-list')?.append(li);
    return { li, icon };
  });
  function render() {
    const stats = getStats(state);
    setText('seed-count', number(state.seeds)); setText('per-tap', number(stats.perTap));
    setText('per-second', number(stats.perSecond)); setText('lifetime-count', number(state.totalEarned));
    const stage = getGardenStage(state); setText('garden-level', stage.name);
    if (lastStage !== stage.index) {
      const scene = byId('garden-scene');
      if (scene) { scene.dataset.stage = String(stage.index); scene.setAttribute('aria-label', `Your garden: ${stage.name}`); }
      lastStage = stage.index;
    }
    shopRows.forEach(({ upgrade, card, level, button }) => {
      const count = state.upgrades[upgrade.id]; const price = getPrice(state, upgrade.id); const maxed = count >= MAX_UPGRADE_LEVEL;
      level.textContent = `Level ${count}`;
      button.disabled = maxed || state.seeds + 1e-9 < price;
      button.textContent = maxed ? 'Max level' : `${number(price)} seeds`;
      button.setAttribute('aria-label', maxed ? `${upgrade.name}, maximum level reached` : `Buy ${upgrade.name} for ${formatter.format(price)} seeds`);
      card.classList.toggle('affordable', !button.disabled);
    });
    getMilestones(state).forEach((milestone, index) => {
      const row = milestoneRows[index]; row.li.classList.toggle('achieved', milestone.achieved);
      row.icon.textContent = milestone.achieved ? '✓' : '○';
      row.li.setAttribute('aria-label', `${milestone.label}: ${milestone.achieved ? 'achieved' : milestone.description}`);
    });
  }
  function save(manual = true) {
    try {
      state = advance(state).state;
      const saved = store.save(state);
      if (!saved) announce(store.warning, true);
      else if (manual) announce('Garden saved in this browser.');
      return saved;
    } catch (error) {
      announce(`Progress could not be saved. ${error.message}`, true);
      return false;
    }
  }
  harvestButton.addEventListener('click', () => {
    state = harvest(state); render();
    harvestButton.classList.add('is-harvesting'); clearTimeout(feedbackTimeout);
    feedbackTimeout = setTimeout(() => harvestButton.classList.remove('is-harvesting'), 130);
  });
  byId('save-button')?.addEventListener('click', () => save());
  byId('export-button')?.addEventListener('click', () => {
    try {
      state = advance(state).state;
      const blob = new Blob([serializeSave(state)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'sprout-circuit-save.json'; document.body.append(anchor);
      try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      announce('Save exported. Keep the JSON file to restore your garden later.');
    } catch (error) {
      announce(`Save could not be exported. ${error.message}`, true);
    }
  });
  byId('import-input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 16_384) throw new Error('Choose a save smaller than 16 KB.');
      const imported = parseSave(await file.text());
      if (!window.confirm('Replace your current garden with this save?')) return;
      const result = advance(imported); state = result.state; showOffline(result); render();
      if (save(false)) announce('Garden imported and saved.');
    } catch (error) { announce(`Import not applied. ${error.message}`, true); }
    finally { event.target.value = ''; }
  });
  byId('reset-button')?.addEventListener('click', () => {
    if (!window.confirm('Start a new garden? This deletes only Sprout Circuit progress in this browser. Export your save first if you want to keep it.')) return;
    const removed = store.reset(); state = createState();
    const offline = byId('offline-notice'); if (offline) offline.hidden = true;
    render(); announce(removed ? 'A fresh garden is ready. Other browser data was not changed.' : 'A fresh garden is running in this tab. Browser storage is blocked; the old save could not be removed.', true);
  });
  setInterval(() => { state = advance(state).state; render(); }, 250);
  setInterval(() => save(false), 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save(false);
    else { const result = advance(state); state = result.state; showOffline(result); render(); }
  });
  window.addEventListener('pagehide', () => save(false));
  render();
  if (status && !status.textContent.trim()) status.textContent = store.warning || 'Progress saves automatically in this browser.';
}
