// ==== Константы ====
const CLAIM_INTERVAL_MS = 3 * 60 * 1000; // раз в 3 минуты
const CLAIM_AMOUNT = [1, 2, 3];          // случайное кол-во меди
const HOUSE_EDGE = 0.9;                  // множитель шанса (казино всегда чуть против тебя)
const MIN_CHANCE = 0.02;
const MAX_CHANCE = 0.95;
const STORAGE_KEY = "ore_upgrader_save_v1";
const COIN_ICON = `<img class="coin-icon" src="assets/textures/coin.png" alt="" draggable="false">`;

// ==== Состояние ====
let state = loadState();
let stake = {}; // { itemId: qty } — текущая ставка
let targetId = null;
let targetQty = 1; // сколько копий цели пытаемся выиграть за один спин
const MAX_TARGET_QTY = 10;
let upgradeInProgress = false;
let frozenChance = null; // шанс, "замороженный" на время вращения колеса
let needleAngle = 0; // накопленный угол стрелки (для непрерывного вращения)
const WHEEL_RADIUS = 88;
const WHEEL_CIRCUMFERENCE = 2 * Math.PI * WHEEL_RADIUS;

let dailySpinInProgress = false;
let dailyNeedleAngle = 0;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.inventory) {
        if (typeof parsed.coins !== "number") parsed.coins = 0; // сейвы до маркетплейса ещё не знают про монеты
        if (!parsed.market) parsed.market = { listings: [], soldLog: [], lastTick: Date.now() };
        return parsed;
      }
    }
  } catch (e) {}
  return {
    inventory: { ...STARTER_INVENTORY },
    lastClaim: 0,
    coins: 0,
    market: { listings: [], soldLog: [], lastTick: Date.now() },
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function invQty(id) {
  return state.inventory[id] || 0;
}

function addItem(id, qty) {
  state.inventory[id] = (state.inventory[id] || 0) + qty;
}

function removeItem(id, qty) {
  state.inventory[id] = Math.max(0, (state.inventory[id] || 0) - qty);
  if (state.inventory[id] === 0) delete state.inventory[id];
}

function totalInventoryValue() {
  return Object.entries(state.inventory).reduce((sum, [id, qty]) => {
    return sum + (getEffectiveItem(id)?.value || 0) * qty;
  }, 0);
}

function stakeValue() {
  return Object.entries(stake).reduce((sum, [id, qty]) => {
    return sum + (getEffectiveItem(id)?.value || 0) * qty;
  }, 0);
}

// ==== Рендер иконки (плейсхолдер, пока нет текстур MC) ====
function renderIcon(item) {
  if (item.img) {
    return `<img src="${item.img}" alt="${item.name}" class="item-img" draggable="false">`;
  }
  return `<div class="item-tile" style="background:${item.color}">${item.emoji}</div>`;
}

// ==== Drag & Drop (инвентарь → ставка, каталог → цель) ====
// Блокируем нативный drag картинок — иначе браузер перехватывает жест
// как обычное перетаскивание <img> и наш pointermove/pointerup не доходит.
document.addEventListener("dragstart", (e) => e.preventDefault());

const DRAG_THRESHOLD = 8; // px, чтобы отличить тап от перетаскивания

// canDrag: () => bool — можно ли вообще начинать перетаскивание.
// onDrop: () => void — что сделать при успешном drop (или коротком тапе).
function makeDraggable(el, item, dropZoneEl, canDrag, onDrop) {
  el.addEventListener("pointerdown", (e) => {
    if (!canDrag()) return;

    const startX = e.clientX, startY = e.clientY;
    let dragging = false;
    let ghost = null;

    function onMove(ev) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        dragging = true;
        el.classList.add("drag-source");
        ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        ghost.innerHTML = renderIcon(item);
        document.body.appendChild(ghost);
      }
      if (dragging) {
        ghost.style.left = ev.clientX + "px";
        ghost.style.top = ev.clientY + "px";
        dropZoneEl.classList.toggle("drop-target-active", isOverElement(ev, dropZoneEl));
      }
    }

    function onUp(ev) {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      el.classList.remove("drag-source");
      dropZoneEl.classList.remove("drop-target-active");
      if (ghost) ghost.remove();

      if (dragging) {
        if (isOverElement(ev, dropZoneEl)) onDrop();
      } else {
        // короткий тап делает то же самое одним движением
        onDrop();
      }
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

function isOverElement(pointerEvent, el) {
  const r = el.getBoundingClientRect();
  return pointerEvent.clientX >= r.left && pointerEvent.clientX <= r.right &&
         pointerEvent.clientY >= r.top && pointerEvent.clientY <= r.bottom;
}

// ==== Инвентарь ====
function renderInventory() {
  const grid = document.getElementById("inventoryGrid");
  grid.innerHTML = "";
  // Не просто ITEMS.filter — предметы с качеством (id вида "diamond__q2")
  // не сидят в статическом каталоге, а достраиваются getEffectiveItem,
  // поэтому источник списка — реальные ключи инвентаря.
  const ordered = Object.keys(state.inventory)
    .filter(id => state.inventory[id] > 0)
    .map(id => getEffectiveItem(id))
    .filter(Boolean)
    .sort((a, b) => {
      const ia = ITEMS.findIndex(it => it.id === (a.baseId || a.id));
      const ib = ITEMS.findIndex(it => it.id === (b.baseId || b.id));
      if (ia !== ib) return ia - ib;
      return (a.qualityTier || 0) - (b.qualityTier || 0);
    });
  if (ordered.length === 0) {
    grid.innerHTML = `<div class="empty-note">Пусто. Дождись бесплатной меди.</div>`;
  }
  ordered.forEach(item => {
    const owned = invQty(item.id);
    const inStake = stake[item.id] || 0;
    const available = owned - inStake;
    const el = document.createElement("div");
    el.className = `inv-item rarity-${getRarity(item)}` + (available <= 0 ? " depleted" : "");
    el.innerHTML = `
      ${renderIcon(item)}
      <div class="inv-name">${item.name}</div>
      <div class="inv-qty">x${available}</div>
      <div class="inv-worth">${item.value} ${COIN_ICON}</div>
    `;
    makeDraggable(
      el, item,
      document.getElementById("stakeSlot"),
      () => invQty(item.id) - (stake[item.id] || 0) > 0 && !upgradeInProgress,
      () => { stake[item.id] = (stake[item.id] || 0) + 1; renderAll(); }
    );
    grid.appendChild(el);
  });

  document.getElementById("totalValue").textContent = totalInventoryValue();
}

// ==== Ставка ====
function renderStake() {
  const content = document.getElementById("stakeContent");
  const entries = Object.entries(stake).filter(([, qty]) => qty > 0);
  if (entries.length === 0) {
    content.innerHTML = `<span class="slot-empty">+</span>`;
  } else {
    content.innerHTML = entries.map(([id, qty]) => {
      const item = getEffectiveItem(id);
      // содержимое в отдельной обёртке: при сгорании маска съедает только
      // её, а огонь и угли (::before/::after чипа) остаются поверх
      return `<div class="stake-chip" data-id="${id}">
        <div class="stake-chip-body">${renderIcon(item)}<span>x${qty}</span></div>
      </div>`;
    }).join("");
    content.querySelectorAll(".stake-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const id = chip.dataset.id;
        stake[id] -= 1;
        if (stake[id] <= 0) delete stake[id];
        renderAll();
      });
    });
  }
  document.getElementById("stakeValueLabel").innerHTML = `${stakeValue()} ${COIN_ICON}`;
}

// ==== Каталог целей ====
function renderTargetCatalog() {
  const wrap = document.getElementById("targetCatalog");
  wrap.innerHTML = `<h3>Выбери, во что улучшать:</h3><div class="target-grid"></div>`;
  const grid = wrap.querySelector(".target-grid");
  ITEMS.forEach(item => {
    const el = document.createElement("div");
    el.className = `target-item rarity-${getRarity(item)}` + (item.id === targetId ? " selected" : "");
    el.innerHTML = `
      ${renderIcon(item)}
      <div class="inv-name">${item.name}</div>
      <div class="inv-worth">${item.value} ${COIN_ICON}</div>
    `;
    makeDraggable(
      el, item,
      document.getElementById("targetSlot"),
      () => !upgradeInProgress,
      () => { targetId = item.id; targetQty = 1; renderAll(); }
    );
    grid.appendChild(el);
  });
}

function renderTargetSlot() {
  const content = document.getElementById("targetContent");
  const stepper = document.getElementById("targetQtyStepper");
  document.getElementById("qtyValue").textContent = `x${targetQty}`;
  document.getElementById("qtyMinus").disabled = upgradeInProgress || !targetId || targetQty <= 1;
  document.getElementById("qtyPlus").disabled = upgradeInProgress || !targetId || targetQty >= MAX_TARGET_QTY;

  if (!targetId) {
    content.innerHTML = `<span class="slot-empty">+</span>`;
    document.getElementById("targetValueLabel").innerHTML = `0 ${COIN_ICON}`;
    stepper.style.visibility = "hidden";
    return;
  }
  stepper.style.visibility = "visible";
  const item = ITEM_BY_ID[targetId];
  content.innerHTML = renderIcon(item) + `<span>${item.name}</span>`;
  document.getElementById("targetValueLabel").innerHTML = `${item.value * targetQty} ${COIN_ICON}`;
}

document.getElementById("qtyMinus").addEventListener("click", () => {
  if (upgradeInProgress || !targetId || targetQty <= 1) return;
  targetQty -= 1;
  renderAll();
});
document.getElementById("qtyPlus").addEventListener("click", () => {
  if (upgradeInProgress || !targetId || targetQty >= MAX_TARGET_QTY) return;
  targetQty += 1;
  renderAll();
});

// ==== Шанс ====
function computeChance() {
  const sv = stakeValue();
  const target = targetId ? ITEM_BY_ID[targetId] : null;
  if (!target || sv <= 0) return 0;
  const raw = (sv / (target.value * targetQty)) * HOUSE_EDGE;
  return Math.min(MAX_CHANCE, Math.max(MIN_CHANCE, raw));
}

function renderChance() {
  const active = sv() > 0 && targetId;

  // Во время вращения колесо не пересчитывается — иначе ставка уже
  // списана (stakeValue = 0) и зелёная зона мгновенно пропадала бы,
  // хотя стрелка ещё крутится к результату, посчитанному ДО списания.
  const chance = upgradeInProgress && frozenChance !== null ? frozenChance : computeChance();

  const greenLen = chance * WHEEL_CIRCUMFERENCE;
  const redLen = WHEEL_CIRCUMFERENCE - greenLen;
  document.getElementById("wheelGreen").setAttribute("stroke-dasharray", `${greenLen} ${redLen}`);
  document.getElementById("wheelRed").setAttribute("stroke-dasharray", `${WHEEL_CIRCUMFERENCE} 0`);

  const btn = document.getElementById("upgradeBtn");
  btn.disabled = !active || upgradeInProgress;
}
function sv() { return stakeValue(); }

// Крутит стрелку колеса до угла targetDeg (0 = верх, по часовой),
// делая перед этим несколько полных оборотов для эффекта рулетки.
function spinNeedleTo(targetDeg) {
  const current = needleAngle % 360;
  let delta = targetDeg - current;
  if (delta < 0) delta += 360;
  needleAngle += 5 * 360 + delta;
  document.getElementById("needle").style.transform = `rotate(${needleAngle}deg)`;
}

// ==== Клейм меди ====
function updateClaimButton() {
  const btn = document.getElementById("claimBtn");
  const elapsed = Date.now() - (state.lastClaim || 0);
  const remaining = CLAIM_INTERVAL_MS - elapsed;
  if (remaining <= 0) {
    btn.disabled = false;
    btn.textContent = "Забрать медь 🟠";
  } else {
    btn.disabled = true;
    const s = Math.ceil(remaining / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    btn.textContent = `Медь: ${mm}:${ss}`;
  }
}

function claimCopper() {
  const elapsed = Date.now() - (state.lastClaim || 0);
  if (elapsed < CLAIM_INTERVAL_MS) return;
  const amount = CLAIM_AMOUNT[Math.floor(Math.random() * CLAIM_AMOUNT.length)];
  addItem("copper", amount);
  state.lastClaim = Date.now();
  saveState();
  showToast(`+${amount} медь 🟠`);
  renderAll();
}

// ==== Апгрейд ====
const SPIN_DURATION_MS = 3000;
const BURN_DURATION_MS = 1450; // синхронизировано с @keyframes в style.css

// Угольки, разлетающиеся вверх от горящей карточки — каждому свой
// разброс, задержка и длительность, иначе искры летят "строем".
function spawnEmbers(container) {
  container.querySelectorAll(".stake-chip").forEach((chip) => {
    for (let i = 0; i < 6; i++) {
      const ember = document.createElement("i");
      ember.className = "ember";
      ember.style.setProperty("--x", `${(Math.random() * 26 - 13).toFixed(1)}px`);
      ember.style.setProperty("--rise", `${(26 + Math.random() * 22).toFixed(0)}px`);
      ember.style.setProperty("--delay", `${(Math.random() * 0.8).toFixed(2)}s`);
      ember.style.setProperty("--dur", `${(0.7 + Math.random() * 0.5).toFixed(2)}s`);
      chip.appendChild(ember);
    }
  });
}

function doUpgrade() {
  const sv_ = stakeValue();
  if (sv_ <= 0 || !targetId || upgradeInProgress) return;

  const chance = computeChance();
  const success = Math.random() < chance;
  const chanceDeg = chance * 360;
  const targetDeg = success
    ? Math.random() * chanceDeg
    : chanceDeg + Math.random() * (360 - chanceDeg);

  const targetItem = ITEM_BY_ID[targetId];
  const wonQty = targetQty;

  // списываем ставку сразу, чтобы нельзя было менять её во время вращения,
  // но "замораживаем" шанс — иначе зелёная зона на колесе обнулится
  // вместе со списанной ставкой прямо во время анимации
  frozenChance = chance;

  // поджигаем ставку: огонь съедает карточки снизу вверх, как подношение в DBD
  const stakeContentEl = document.getElementById("stakeContent");
  spawnEmbers(stakeContentEl);
  stakeContentEl.classList.add("stake-burning");

  Object.entries(stake).forEach(([id, qty]) => removeItem(id, qty));
  saveState();
  stake = {};
  upgradeInProgress = true;
  renderAll({ skipStake: true });

  setTimeout(() => {
    stakeContentEl.classList.remove("stake-burning");
    renderStake();
  }, BURN_DURATION_MS + 80);

  spinNeedleTo(targetDeg);

  setTimeout(() => {
    // Качество катается ПОШТУЧНО и только на победе — рынок ждёт от
    // апгрейдера именно такие "улучшенные" экземпляры на продажу,
    // покупка на рынке у ботов качества не даёт (см. QUALITY_TIERS).
    let wonItems = [];
    if (success) {
      for (let i = 0; i < wonQty; i++) {
        const tier = pickQualityTier();
        const effId = targetId + tier.suffix;
        addItem(effId, 1);
        wonItems.push(getEffectiveItem(effId));
      }
    }
    saveState();
    showResult(success, targetItem, wonQty, wonItems);
    targetId = null;
    targetQty = 1;
    upgradeInProgress = false;
    frozenChance = null;
    renderAll();
  }, SPIN_DURATION_MS + 100);
}

// Дорогие призы (эпик/легендарка) показываем с 3D-переворотом карточки,
// а не просто плоским попапом — по значимости приза это заметнее.
const REVEAL_3D_VALUE_THRESHOLD = 150;

function playResultCardAnimation(bestValue) {
  const card = document.getElementById("resultCard");
  card.classList.remove("reveal-3d");
  if (bestValue >= REVEAL_3D_VALUE_THRESHOLD) {
    void card.offsetWidth; // перезапуск CSS-анимации
    card.classList.add("reveal-3d");
  }
}

function showResult(success, item, qty, wonItems) {
  const overlay = document.getElementById("resultOverlay");
  document.getElementById("resultTitle").textContent = success ? "УСПЕХ!" : "Неудача";
  document.getElementById("resultTitle").className = success ? "win" : "lose";

  if (!success) {
    document.getElementById("resultItem").innerHTML = `<span class="lose-note">Предметы потеряны</span>`;
    overlay.classList.remove("hidden");
    playResultCardAnimation(0);
    return;
  }

  // wonQty штук катались на качество по отдельности — сгруппировать
  // одинаковые (тот же id, значит тот же уровень качества) для показа,
  // а не печатать N одинаковых строк подряд.
  const grouped = {};
  (wonItems || [item]).forEach(it => { grouped[it.id] = grouped[it.id] || { item: it, qty: 0 }; grouped[it.id].qty += 1; });
  const rows = Object.values(grouped);
  document.getElementById("resultItem").innerHTML = rows.map(({ item: it, qty: q }) =>
    `${renderIcon(it)}<span>${it.name}${q > 1 ? ` x${q}` : ""}</span>`
  ).join("");

  overlay.classList.remove("hidden");
  const bestValue = Math.max(...rows.map(r => r.item.value));
  playResultCardAnimation(bestValue);
}

// ==== Кейсы (рулетка в стиле CS:GO) ====
let caseOpening = false;
const REEL_TILE_FULL_WIDTH = 96; // 82px плитка + 7+7px отступов (см. style.css)
const REEL_TILE_COUNT = 40;
const REEL_WINNER_INDEX = 34;
const REEL_SPIN_MS = 4200;

function renderCases() {
  const grid = document.getElementById("casesGrid");
  grid.innerHTML = "";
  CASES.forEach(caseDef => {
    const costItem = ITEM_BY_ID[caseDef.costItem];
    const owned = invQty(caseDef.costItem);
    const affordable = owned >= caseDef.costAmount;

    const el = document.createElement("div");
    el.className = "case-card";
    el.id = `case-${caseDef.id}`;
    el.innerHTML = `
      <div class="case-icon">📦</div>
      <div class="case-info">
        <div class="case-name">${caseDef.name}</div>
        <div class="case-cost">Цена: ${caseDef.costAmount}× ${renderIcon(costItem)} ${costItem.name}</div>
        <div class="case-pool">Выпадает: ${caseDef.drops.map(d => ITEM_BY_ID[d.id].name).join(", ")}</div>
      </div>
      <button class="case-open-btn" ${(!affordable || caseOpening) ? "disabled" : ""}>Открыть</button>
    `;
    el.querySelector(".case-open-btn").addEventListener("click", () => openCase(caseDef));
    grid.appendChild(el);
  });
}

function openCase(caseDef) {
  if (caseOpening) return;
  if (invQty(caseDef.costItem) < caseDef.costAmount) return;

  caseOpening = true;
  removeItem(caseDef.costItem, caseDef.costAmount);
  saveState();
  renderAll();

  const winnerId = pickCaseDrop(caseDef);
  runCaseReel(caseDef, winnerId);
}

// Горизонтальная лента из случайных предметов пула + один точно
// расставленный "победный" тайл — лента крутится и тормозит ровно
// на нём, как в кейсах CS:GO.
function runCaseReel(caseDef, winnerId) {
  const overlay = document.getElementById("caseRevealOverlay");
  const track = document.getElementById("reelTrack");
  const closeBtn = document.getElementById("caseRevealClose");
  const pool = caseDef.drops.map(d => d.id);

  document.getElementById("caseRevealTitle").textContent = caseDef.name;
  closeBtn.disabled = true;
  closeBtn.textContent = "Открываю...";

  const tileIds = [];
  for (let i = 0; i < REEL_TILE_COUNT; i++) {
    tileIds.push(i === REEL_WINNER_INDEX ? winnerId : pool[Math.floor(Math.random() * pool.length)]);
  }

  track.style.transition = "none";
  track.style.transform = "translateX(0px)";
  track.innerHTML = tileIds.map((id, i) => {
    const item = ITEM_BY_ID[id];
    return `<div class="reel-tile rarity-${getRarity(item)}" data-i="${i}">${renderIcon(item)}</div>`;
  }).join("");

  overlay.classList.remove("hidden");
  void track.offsetWidth; // force reflow, чтобы translateX(0) точно применился до анимации

  const viewportWidth = document.getElementById("reelViewport").clientWidth;
  const jitter = (Math.random() - 0.5) * (REEL_TILE_FULL_WIDTH * 0.5);
  const targetX = -(REEL_WINNER_INDEX * REEL_TILE_FULL_WIDTH + REEL_TILE_FULL_WIDTH / 2 - viewportWidth / 2) + jitter;

  requestAnimationFrame(() => {
    track.style.transition = `transform ${REEL_SPIN_MS}ms cubic-bezier(0.08, 0.66, 0.1, 1)`;
    track.style.transform = `translateX(${targetX}px)`;
  });

  setTimeout(() => {
    const winnerTile = track.querySelector(`[data-i="${REEL_WINNER_INDEX}"]`);
    if (winnerTile) winnerTile.classList.add("reel-winner");
    addItem(winnerId, 1);
    saveState();
    caseOpening = false;
    closeBtn.disabled = false;
    closeBtn.textContent = "ОК";
    renderAll(); // не только карточки кейсов — иначе выигранный предмет не появится в инвентаре на экране
  }, REEL_SPIN_MS + 150);
}

document.getElementById("caseRevealClose").addEventListener("click", () => {
  document.getElementById("caseRevealOverlay").classList.add("hidden");
});

// ==== Маркетплейс: живой рынок с ботами ====
// state.market.listings — общий пул лотов (и боты, и свои), но UI их не
// мешает: вкладка "Рынок" показывает только чужие (боты), "Мои
// объявления" — только свои. Монеты (state.coins) — отдельная валюта от
// "ценности инвентаря" в шапке (та просто сумма для отображения).
const MARKET_PAGE_SIZE = 12;
let marketSubTab = "browse";
let marketPage = 0;
const marketPendingBuys = new Set(); // id лотов, для которых сейчас идёт "Обработка сделки..."

function ensureMarket() {
  if (!state.market) state.market = { listings: [], soldLog: [], lastTick: Date.now() };
  return state.market;
}

// Единая точка входа для симуляции рынка — вызывается один раз при
// загрузке (elapsed может быть часами простоя) и раз в 20с, пока вкладка
// открыта. Порядок важен: сперва решаем судьбу СВОИХ лотов по старому
// таймингу, потом уже крутим ротацию ботов на новый now.
function marketTick() {
  const market = ensureMarket();
  const now = Date.now();
  const elapsed = Math.max(0, now - (market.lastTick || now));

  market.listings.forEach(listing => {
    if (listing.sellerType !== "player") return;
    const item = getEffectiveItem(listing.itemId);
    if (!item) return;
    if (rollPlayerListingSold(listing, item, now)) {
      const proceeds = Math.max(1, Math.round(listing.price * (1 - MARKET_COMMISSION - MARKET_LISTING_FEE)));
      state.coins += proceeds;
      market.soldLog.unshift({
        itemId: listing.itemId, qty: listing.qty, price: listing.price,
        proceeds, soldAt: now,
      });
      market.soldLog = market.soldLog.slice(0, 30);
      listing._sold = true;
    } else {
      listing.lastCheckedAt = now;
    }
  });
  market.listings = market.listings.filter(l => !l._sold);

  market.listings = rotateBotListings(market.listings, now, elapsed);
  market.lastTick = now;
  saveState();
}

function buyListing(listingId) {
  const market = ensureMarket();
  const listing = market.listings.find(l => l.id === listingId);
  if (!listing || marketPendingBuys.has(listingId)) return;

  marketPendingBuys.add(listingId);
  renderMarket();

  setTimeout(() => {
    marketPendingBuys.delete(listingId);
    const stillThere = ensureMarket().listings.find(l => l.id === listingId);
    const item = stillThere ? getEffectiveItem(stillThere.itemId) : null;

    if (!stillThere || rollListingSniped(item, stillThere)) {
      if (stillThere) market.listings = market.listings.filter(l => l.id !== listingId);
      showToast("Лот уже продан");
      renderAll();
      return;
    }
    if (state.coins < stillThere.price) {
      showToast("Не хватает монет");
      renderMarket();
      return;
    }
    state.coins -= stillThere.price;
    addItem(stillThere.itemId, stillThere.qty);
    market.listings = market.listings.filter(l => l.id !== listingId);
    saveState();
    showToast(`Куплено: ${getEffectiveItem(stillThere.itemId).name} x${stillThere.qty}`);
    renderAll();
  }, 1000 + Math.random() * 1000);
}

function createListing() {
  const hint = document.getElementById("marketCreateHint");
  const itemId = document.getElementById("marketItemSelect").value;
  const qty = Math.max(1, Math.floor(Number(document.getElementById("marketQtyInput").value) || 0));
  const price = Math.max(1, Math.floor(Number(document.getElementById("marketPriceInput").value) || 0));
  const owned = invQty(itemId);

  function fail(msg) { hint.textContent = msg; hint.classList.add("error"); }
  if (!itemId || owned <= 0) return fail("Нечего выставлять.");
  if (qty > owned) return fail(`Максимум ${owned} шт.`);
  if (!price) return fail("Укажи цену.");

  // Плата за размещение (1%) берётся не сразу монетами (иначе с балансом 0
  // выставить вообще ничего нельзя — тупик для нового игрока), а вычитается
  // вместе с комиссией из выручки при продаже, см. marketTick().
  removeItem(itemId, qty);
  ensureMarket().listings.push({
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    sellerType: "player",
    sellerName: "Вы",
    itemId, qty, price,
    listedAt: Date.now(),
    lastCheckedAt: Date.now(),
  });
  saveState();
  renderAll();
}

function cancelListing(listingId) {
  const market = ensureMarket();
  const listing = market.listings.find(l => l.id === listingId && l.sellerType === "player");
  if (!listing) return;
  addItem(listing.itemId, listing.qty);
  market.listings = market.listings.filter(l => l.id !== listingId);
  saveState();
  renderAll();
}

function renderMarketListingCard(listing, { own } = {}) {
  const item = getEffectiveItem(listing.itemId);
  if (!item) return "";
  const pending = marketPendingBuys.has(listing.id);
  const actionHtml = own
    ? `<button class="market-cancel-btn" data-id="${listing.id}">Снять</button>`
    : `<button class="market-buy-btn" data-id="${listing.id}" ${pending ? "disabled" : ""}>${pending ? "Обработка сделки..." : "Купить"}</button>`;
  // listing.price всегда за ВЕСЬ лот — при qty>1 отдельно показываем цену
  // за штуку, иначе "x15 — 30" читается неоднозначно (за всё или за одну?).
  const perUnitHtml = listing.qty > 1
    ? `<div class="market-price-unit">${Math.round(listing.price / listing.qty)} ${COIN_ICON} / шт</div>`
    : "";
  return `
    <div class="market-item rarity-${getRarity(item)}">
      <div class="market-seller">${listing.sellerName}</div>
      ${renderIcon(item)}
      <div class="inv-name">${item.name}${listing.qty > 1 ? ` x${listing.qty}` : ""}</div>
      <div class="market-price">${listing.price} ${COIN_ICON}${listing.qty > 1 ? " всего" : ""}</div>
      ${perUnitHtml}
      <div class="market-actions">${actionHtml}</div>
    </div>
  `;
}

function renderMarket() {
  document.getElementById("marketBalance").textContent = state.coins;
  document.querySelectorAll(".market-subtab-btn").forEach(b => b.classList.toggle("active", b.dataset.msub === marketSubTab));
  document.getElementById("marketBrowsePage").classList.toggle("hidden", marketSubTab !== "browse");
  document.getElementById("marketMinePage").classList.toggle("hidden", marketSubTab !== "mine");

  const market = ensureMarket();

  if (marketSubTab === "browse") {
    const botLots = market.listings.filter(l => l.sellerType === "bot").sort((a, b) => a.id < b.id ? -1 : 1);
    const maxPage = Math.max(0, Math.ceil(botLots.length / MARKET_PAGE_SIZE) - 1);
    marketPage = Math.min(marketPage, maxPage);
    const pageItems = botLots.slice(marketPage * MARKET_PAGE_SIZE, marketPage * MARKET_PAGE_SIZE + MARKET_PAGE_SIZE);

    const grid = document.getElementById("marketGrid");
    grid.innerHTML = pageItems.length
      ? pageItems.map(l => renderMarketListingCard(l)).join("")
      : `<div class="empty-note">Рынок пуст, загляни чуть позже.</div>`;
    grid.querySelectorAll(".market-buy-btn").forEach(btn => {
      btn.addEventListener("click", () => buyListing(btn.dataset.id));
    });

    const pager = document.getElementById("marketPagination");
    pager.innerHTML = `
      <button id="marketPrevBtn" ${marketPage <= 0 ? "disabled" : ""}>←</button>
      <span>${marketPage + 1} / ${maxPage + 1}</span>
      <button id="marketNextBtn" ${marketPage >= maxPage ? "disabled" : ""}>→</button>
    `;
    document.getElementById("marketPrevBtn").addEventListener("click", () => { marketPage--; renderMarket(); });
    document.getElementById("marketNextBtn").addEventListener("click", () => { marketPage++; renderMarket(); });
  } else {
    const hint = document.getElementById("marketCreateHint");
    hint.classList.remove("error");
    hint.textContent = `При продаже с выручки удержится ${Math.round((MARKET_COMMISSION + MARKET_LISTING_FEE) * 100)}% (комиссия + размещение).`;

    // Выпадашка предметов на продажу — тот же источник, что у renderInventory
    // (реальные ключи инвентаря через getEffectiveItem, а не статичный ITEMS,
    // иначе предметы с ★-качеством из апгрейда туда бы не попали).
    const select = document.getElementById("marketItemSelect");
    const prevSelected = select.value;
    const sellable = Object.keys(state.inventory)
      .filter(id => state.inventory[id] > 0)
      .map(id => getEffectiveItem(id))
      .filter(Boolean);
    select.innerHTML = sellable.length
      ? sellable.map(it => `<option value="${it.id}">${it.name} (есть ${invQty(it.id)})</option>`).join("")
      : `<option value="">Нечего продавать</option>`;
    if (sellable.some(it => it.id === prevSelected)) select.value = prevSelected;
    const selectedItem = sellable.find(it => it.id === select.value);
    document.getElementById("marketQtyInput").max = selectedItem ? invQty(selectedItem.id) : 1;

    const mine = market.listings.filter(l => l.sellerType === "player");
    const activeEl = document.getElementById("marketMineActive");
    activeEl.innerHTML = mine.length
      ? mine.map(l => renderMarketListingCard(l, { own: true })).join("")
      : `<div class="empty-note">Нет активных лотов.</div>`;
    activeEl.querySelectorAll(".market-cancel-btn").forEach(btn => {
      btn.addEventListener("click", () => cancelListing(btn.dataset.id));
    });

    const soldEl = document.getElementById("marketMineSold");
    soldEl.innerHTML = market.soldLog.length
      ? market.soldLog.map(s => {
          const it = getEffectiveItem(s.itemId);
          return `<div class="market-sold-row">${renderIcon(it)}<span>${it.name}${s.qty > 1 ? ` x${s.qty}` : ""} — продано за ${s.price}, получено ${s.proceeds} ${COIN_ICON}</span></div>`;
        }).join("")
      : `<div class="empty-note">Пока ничего не продано.</div>`;
  }
}

document.querySelectorAll(".market-subtab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    marketSubTab = btn.dataset.msub;
    marketPage = 0;
    renderMarket();
  });
});
document.getElementById("marketCreateBtn").addEventListener("click", createListing);

// Живая подсказка "= X за шт." под полем цены — цена в форме всегда за
// ВЕСЬ лот (как и everywhere в listing.price), но при qty>1 легко забыть
// и вписать цену за штуку по привычке, отсюда и была путаница на скрине.
function updateMarketPriceUnitHint() {
  const qty = Math.max(1, Math.floor(Number(document.getElementById("marketQtyInput").value) || 0));
  const price = Math.floor(Number(document.getElementById("marketPriceInput").value) || 0);
  const hint = document.getElementById("marketPriceUnitHint");
  hint.textContent = (qty > 1 && price > 0) ? `= ${Math.round(price / qty)} 🪙 за 1 шт.` : "";
}
document.getElementById("marketQtyInput").addEventListener("input", updateMarketPriceUnitHint);
document.getElementById("marketPriceInput").addEventListener("input", updateMarketPriceUnitHint);

function showItemResult(title, item, qty) {
  const overlay = document.getElementById("resultOverlay");
  document.getElementById("resultTitle").textContent = title;
  document.getElementById("resultTitle").className = "win";
  const qtyLabel = qty > 1 ? ` x${qty}` : "";
  document.getElementById("resultItem").innerHTML = `${renderIcon(item)}<span>${item.name}${qtyLabel}</span>`;
  overlay.classList.remove("hidden");
  playResultCardAnimation(item);
}

// ==== Ежедневное колесо удачи ====
const DAILY_SPIN_DURATION_MS = 3000;

// Сегменты считаем один раз — порядок и веса совпадают с DAILY_PRIZES,
// поэтому визуальный сектор всегда соответствует реально выпавшему призу.
const dailySegments = (() => {
  let acc = 0;
  return DAILY_PRIZES.map((prize) => {
    const startDeg = (acc / DAILY_TOTAL_WEIGHT) * 360;
    acc += prize.weight;
    const endDeg = (acc / DAILY_TOTAL_WEIGHT) * 360;
    return { prize, startDeg, endDeg, color: ITEM_BY_ID[prize.id].color };
  });
})();

function initDailyWheel() {
  const stops = dailySegments
    .map((s) => `${s.color} ${s.startDeg}deg ${s.endDeg}deg`)
    .join(", ");
  document.getElementById("dailyWheelDisc").style.background = `conic-gradient(${stops})`;
}

function updateDailyButton() {
  const btn = document.getElementById("dailySpinBtn");
  if (dailySpinInProgress) {
    btn.disabled = true;
    return;
  }
  const elapsed = Date.now() - (state.lastDailySpin || 0);
  const remaining = DAILY_INTERVAL_MS - elapsed;
  if (remaining <= 0) {
    btn.disabled = false;
    btn.textContent = "Крутить";
  } else {
    btn.disabled = true;
    const totalMin = Math.ceil(remaining / 60000);
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    btn.textContent = `Приз через ${hh}ч ${mm}м`;
  }
}

function spinDailyWheel() {
  const elapsed = Date.now() - (state.lastDailySpin || 0);
  if (elapsed < DAILY_INTERVAL_MS || dailySpinInProgress) return;

  const prize = pickDailyPrize();
  const segment = dailySegments.find((s) => s.prize.id === prize.id);
  const landingDeg = segment.startDeg + Math.random() * (segment.endDeg - segment.startDeg);

  dailySpinInProgress = true;
  updateDailyButton();

  const current = dailyNeedleAngle % 360;
  let delta = landingDeg - current;
  if (delta < 0) delta += 360;
  dailyNeedleAngle += 6 * 360 + delta;
  document.getElementById("dailyNeedle").style.transform = `rotate(${dailyNeedleAngle}deg)`;

  setTimeout(() => {
    addItem(prize.id, prize.qty);
    state.lastDailySpin = Date.now();
    saveState();
    dailySpinInProgress = false;
    showItemResult("Приз дня!", ITEM_BY_ID[prize.id], prize.qty);
    renderAll();
  }, DAILY_SPIN_DURATION_MS + 100);
}

document.getElementById("dailySpinBtn").addEventListener("click", spinDailyWheel);

// ==== Кликер ====
const CLICKER_TARGET = 10;
const CLICKER_REWARD_ITEM = "dirt";
const CLICKER_REWARD_QTY = 2;

function renderClicker() {
  document.getElementById("clickerCount").textContent = state.clickerProgress || 0;
}

function handleClickerClick() {
  state.clickerProgress = (state.clickerProgress || 0) + 1;
  const btn = document.getElementById("clickerBtn");
  btn.classList.remove("bump");
  void btn.offsetWidth; // перезапуск анимации при частых кликах
  btn.classList.add("bump");

  if (state.clickerProgress >= CLICKER_TARGET) {
    state.clickerProgress = 0;
    addItem(CLICKER_REWARD_ITEM, CLICKER_REWARD_QTY);
    showToast(`+${CLICKER_REWARD_QTY} ${ITEM_BY_ID[CLICKER_REWARD_ITEM].name} 🎉`);
    renderInventory();
  }
  saveState();
  renderClicker();
}

document.getElementById("clickerBtn").addEventListener("click", handleClickerClick);

// ==== Профиль ====
const USERNAME_REGEX = /^[A-Za-z0-9_А-Яа-яЁё]{5,20}$/;

function ensureProfile() {
  if (!state.profile) {
    state.profile = {
      username: null,
      avatar: null,
      banner: null,
      bio: "",
      socials: { telegram: "", discord: "", youtube: "" },
      theme: "dark",
      equippedFrame: null,
    };
  }
  if (!state.frames) state.frames = [];
  return state.profile;
}

function applyTheme() {
  const profile = ensureProfile();
  document.body.classList.toggle("theme-minimal", profile.theme === "minimal");
}

function renderProfile() {
  const profile = ensureProfile();
  const hasUsername = !!profile.username;

  document.getElementById("usernameSetup").classList.toggle("hidden", hasUsername);
  document.getElementById("profileCard").classList.toggle("hidden", !hasUsername);
  if (!hasUsername) return;

  document.getElementById("profileUsername").textContent = `@${profile.username}`;
  document.getElementById("profileBanner").style.backgroundImage = profile.banner ? `url(${profile.banner})` : "none";
  document.getElementById("profileAvatarImg").src = profile.avatar || "icon.svg";

  const frame = profile.equippedFrame ? FRAME_BY_ID[profile.equippedFrame] : null;
  document.getElementById("profileAvatarFrame").className = `frame-ring ${frame ? frame.css : "frame-none"}`;

  document.getElementById("profileBio").value = profile.bio || "";
  document.getElementById("socialTelegram").value = profile.socials.telegram || "";
  document.getElementById("socialDiscord").value = profile.socials.discord || "";
  document.getElementById("socialYoutube").value = profile.socials.youtube || "";
  document.getElementById("minimalThemeToggle").checked = profile.theme === "minimal";

  renderOwnedFrames();
  renderFrameCases();
}

function renderOwnedFrames() {
  const grid = document.getElementById("ownedFramesGrid");
  const profile = ensureProfile();
  if (state.frames.length === 0) {
    grid.innerHTML = `<div class="frames-empty-note">Пока нет рамок — открой кейс рамок ниже.</div>`;
    return;
  }
  grid.innerHTML = "";
  state.frames.forEach((frameId) => {
    const frame = FRAME_BY_ID[frameId];
    if (!frame) return;
    const el = document.createElement("div");
    el.className = `owned-frame-slot frame-ring ${frame.css}` + (profile.equippedFrame === frameId ? " equipped" : "");
    el.innerHTML = `<div class="frame-ring-inner"></div>`;
    el.title = frame.name;
    el.addEventListener("click", () => {
      profile.equippedFrame = profile.equippedFrame === frameId ? null : frameId;
      saveState();
      renderProfile();
    });
    grid.appendChild(el);
  });
}

function renderFrameCases() {
  const grid = document.getElementById("frameCasesGrid");
  grid.innerHTML = "";
  FRAME_COLLECTIONS.forEach((collection) => {
    const costItem = ITEM_BY_ID[collection.costItem];
    const affordable = invQty(collection.costItem) >= collection.costAmount;
    const el = document.createElement("div");
    el.className = "case-card";
    el.innerHTML = `
      <div class="case-icon">🎁</div>
      <div class="case-info">
        <div class="case-name">${collection.name}</div>
        <div class="case-cost">Цена: ${collection.costAmount}× ${renderIcon(costItem)} ${costItem.name}</div>
        <div class="case-pool">Рамки: ${collection.frames.map(f => f.name).join(", ")}</div>
      </div>
      <button class="case-open-btn" ${(!affordable || frameCaseOpening) ? "disabled" : ""}>Открыть</button>
    `;
    el.querySelector(".case-open-btn").addEventListener("click", () => openFrameCase(collection));
    grid.appendChild(el);
  });
}

// --- Юзернейм ---
function trySaveUsername() {
  const input = document.getElementById("usernameInput");
  const errEl = document.getElementById("usernameError");
  const value = input.value.trim();
  if (!USERNAME_REGEX.test(value)) {
    errEl.textContent = "От 5 до 20 символов: буквы, цифры, подчёркивание.";
    return;
  }
  const profile = ensureProfile();
  profile.username = value;
  saveState();
  errEl.textContent = "";
  input.value = "";
  renderProfile();
}
document.getElementById("usernameSaveBtn").addEventListener("click", trySaveUsername);
document.getElementById("usernameChangeBtn").addEventListener("click", () => {
  ensureProfile().username = null;
  saveState();
  renderProfile();
});

// --- Аватар / баннер (локально, через FileReader) ---
function readFileAsDataUrl(file, callback) {
  const reader = new FileReader();
  reader.onload = () => callback(reader.result);
  reader.readAsDataURL(file);
}

document.getElementById("avatarEditBtn").addEventListener("click", () => {
  document.getElementById("avatarFileInput").click();
});
document.getElementById("avatarFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  readFileAsDataUrl(file, (dataUrl) => {
    ensureProfile().avatar = dataUrl;
    saveState();
    renderProfile();
  });
});

document.getElementById("bannerEditBtn").addEventListener("click", () => {
  document.getElementById("bannerFileInput").click();
});
document.getElementById("bannerFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  readFileAsDataUrl(file, (dataUrl) => {
    ensureProfile().banner = dataUrl;
    saveState();
    renderProfile();
  });
});

// --- Био / соцсети / тема ---
document.getElementById("profileSaveBtn").addEventListener("click", () => {
  const profile = ensureProfile();
  profile.bio = document.getElementById("profileBio").value.slice(0, 140);
  profile.socials.telegram = document.getElementById("socialTelegram").value.trim();
  profile.socials.discord = document.getElementById("socialDiscord").value.trim();
  profile.socials.youtube = document.getElementById("socialYoutube").value.trim();
  saveState();
  showToast("Профиль сохранён");
});

document.getElementById("minimalThemeToggle").addEventListener("change", (e) => {
  ensureProfile().theme = e.target.checked ? "minimal" : "dark";
  saveState();
  applyTheme();
});

// --- Кейс рамок: та же рулетка CS:GO-style, что и у предметных кейсов ---
let frameCaseOpening = false;
const FRAME_REEL_TILE_FULL_WIDTH = 96; // 82px плитка + 7+7px отступов (см. .frame-reel-tile)
const FRAME_REEL_TILE_COUNT = 40;
const FRAME_REEL_WINNER_INDEX = 34;
const FRAME_REEL_SPIN_MS = 4200;

function openFrameCase(collection) {
  if (frameCaseOpening) return;
  if (invQty(collection.costItem) < collection.costAmount) return;

  frameCaseOpening = true;
  removeItem(collection.costItem, collection.costAmount);
  saveState();
  renderAll();

  const wonFrame = pickFrameFromCollection(collection);
  runFrameReel(collection, wonFrame);
}

function runFrameReel(collection, wonFrame) {
  const overlay = document.getElementById("frameRevealOverlay");
  const viewport = document.getElementById("frameReelViewport");
  const track = document.getElementById("frameReelTrack");
  const resultStage = document.getElementById("frameResultStage");
  const closeBtn = document.getElementById("frameRevealClose");
  const pool = collection.frames;

  viewport.classList.remove("hidden");
  resultStage.classList.add("hidden");
  closeBtn.disabled = true;
  closeBtn.textContent = "Открываю...";
  overlay.classList.remove("hidden");

  const tiles = [];
  for (let i = 0; i < FRAME_REEL_TILE_COUNT; i++) {
    tiles.push(i === FRAME_REEL_WINNER_INDEX ? wonFrame : pool[Math.floor(Math.random() * pool.length)]);
  }

  track.style.transition = "none";
  track.style.transform = "translateX(0px)";
  track.innerHTML = tiles.map((f, i) => `
    <div class="frame-reel-tile" data-i="${i}">
      <div class="frame-ring ${f.css}"><div class="frame-ring-inner"></div></div>
    </div>
  `).join("");

  void track.offsetWidth; // force reflow, чтобы translateX(0) точно применился до анимации

  const viewportWidth = viewport.clientWidth;
  const jitter = (Math.random() - 0.5) * (FRAME_REEL_TILE_FULL_WIDTH * 0.5);
  const targetX = -(FRAME_REEL_WINNER_INDEX * FRAME_REEL_TILE_FULL_WIDTH + FRAME_REEL_TILE_FULL_WIDTH / 2 - viewportWidth / 2) + jitter;

  requestAnimationFrame(() => {
    track.style.transition = `transform ${FRAME_REEL_SPIN_MS}ms cubic-bezier(0.08, 0.66, 0.1, 1)`;
    track.style.transform = `translateX(${targetX}px)`;
  });

  setTimeout(() => {
    const winnerTile = track.querySelector(`[data-i="${FRAME_REEL_WINNER_INDEX}"]`);
    if (winnerTile) winnerTile.classList.add("reel-winner");

    setTimeout(() => {
      viewport.classList.add("hidden");
      resultStage.classList.remove("hidden");

      document.getElementById("frameResultAvatarImg").src = ensureProfile().avatar || "icon.svg";
      document.getElementById("frameResultFrame").className = `frame-ring ${wonFrame.css}`;
      document.getElementById("frameResultName").textContent = wonFrame.name;
      document.getElementById("frameResultRarity").textContent = wonFrame.rarity;

      if (!state.frames.includes(wonFrame.id)) state.frames.push(wonFrame.id);
      saveState();
      frameCaseOpening = false;
      closeBtn.disabled = false;
      closeBtn.textContent = "ОК";
      renderAll();
    }, 500);
  }, FRAME_REEL_SPIN_MS + 150);
}

document.getElementById("frameRevealClose").addEventListener("click", () => {
  document.getElementById("frameRevealOverlay").classList.add("hidden");
});

// --- Тестовая кнопка: выдать всё для проверки ---
document.getElementById("debugGrantBtn").addEventListener("click", () => {
  addItem("netherite", 5);
  ensureProfile();
  const allFrameIds = FRAME_COLLECTIONS.flatMap(c => c.frames.map(f => f.id));
  allFrameIds.forEach(id => { if (!state.frames.includes(id)) state.frames.push(id); });
  saveState();
  showToast("Выдано: 5 незеритовых слитков + все рамки");
  renderAll();
});

// ==== Toast ====
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
}

// ==== Вкладки ====
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-page").forEach((p) => p.classList.add("hidden"));
    document.getElementById(`${btn.dataset.tab}Panel`).classList.remove("hidden");
  });
});

// ==== Fullscreen ====
document.getElementById("fullscreenBtn").addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.();
  }
});

// ==== События ====
document.getElementById("claimBtn").addEventListener("click", claimCopper);
document.getElementById("upgradeBtn").addEventListener("click", doUpgrade);
document.getElementById("resultClose").addEventListener("click", () => {
  document.getElementById("resultOverlay").classList.add("hidden");
});

// ==== Общий рендер ====
function renderAll(opts = {}) {
  renderInventory();
  if (!opts.skipStake) renderStake();
  renderTargetCatalog();
  renderTargetSlot();
  renderChance();
  renderCases();
  renderMarket();
  renderClicker();
  renderProfile();
  updateClaimButton();
  updateDailyButton();
}

applyTheme();
initDailyWheel();
marketTick(); // разово при загрузке — досыпает рынок и досчитывает офлайн-продажи твоих лотов
renderAll();
setInterval(() => {
  updateClaimButton();
  updateDailyButton();
}, 1000);
setInterval(() => {
  marketTick();
  renderMarket();
}, MARKET_ROTATION_STEP_MS);

// PWA service worker (для офлайна/установки на телефон).
// Автообновление: как только активируется новый service worker,
// перезагружаем страницу один раз, чтобы новая версия игры точно
// подхватилась, а не осталась висеть в старом кэше.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.update();
  }).catch(() => {});

  let reloadedOnce = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedOnce) return;
    reloadedOnce = true;
    window.location.reload();
  });
}
