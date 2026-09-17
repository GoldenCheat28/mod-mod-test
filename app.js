// ==== Константы ====
const CLAIM_INTERVAL_MS = 3 * 60 * 1000; // раз в 3 минуты
const CLAIM_AMOUNT = [1, 2, 3];          // случайное кол-во меди
const HOUSE_EDGE = 0.9;                  // множитель шанса (казино всегда чуть против тебя)
const MIN_CHANCE = 0.02;
const MAX_CHANCE = 0.95;
const STORAGE_KEY = "ore_upgrader_save_v1";

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
      if (parsed && parsed.inventory) return parsed;
    }
  } catch (e) {}
  return { inventory: { ...STARTER_INVENTORY }, lastClaim: 0 };
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
    return sum + (ITEM_BY_ID[id]?.value || 0) * qty;
  }, 0);
}

function stakeValue() {
  return Object.entries(stake).reduce((sum, [id, qty]) => {
    return sum + (ITEM_BY_ID[id]?.value || 0) * qty;
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
  const ordered = ITEMS.filter(it => invQty(it.id) > 0);
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
      <div class="inv-worth">${item.value} ⛃</div>
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
    content.innerHTML = `<span class="slot-empty">выбери предметы →</span>`;
  } else {
    content.innerHTML = entries.map(([id, qty]) => {
      const item = ITEM_BY_ID[id];
      return `<div class="stake-chip" data-id="${id}">${renderIcon(item)}<span>x${qty}</span></div>`;
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
  document.getElementById("stakeValueLabel").textContent = `${stakeValue()} ⛃`;
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
      <div class="inv-worth">${item.value} ⛃</div>
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
    content.innerHTML = `<span class="slot-empty">перетащи цель →</span>`;
    document.getElementById("targetValueLabel").textContent = "0 ⛃";
    stepper.style.visibility = "hidden";
    return;
  }
  stepper.style.visibility = "visible";
  const item = ITEM_BY_ID[targetId];
  content.innerHTML = renderIcon(item) + `<span>${item.name}</span>`;
  document.getElementById("targetValueLabel").textContent = `${item.value * targetQty} ⛃`;
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

  // проигрываем анимацию "сгорания" списанных предметов ставки —
  // раньше слот просто мгновенно очищался при рендере и это было незаметно
  const stakeContentEl = document.getElementById("stakeContent");
  stakeContentEl.classList.add("stake-burning");

  Object.entries(stake).forEach(([id, qty]) => removeItem(id, qty));
  saveState();
  stake = {};
  upgradeInProgress = true;
  renderAll({ skipStake: true });

  setTimeout(() => {
    stakeContentEl.classList.remove("stake-burning");
    renderStake();
  }, 560);

  spinNeedleTo(targetDeg);

  setTimeout(() => {
    if (success) addItem(targetId, wonQty);
    saveState();
    showResult(success, targetItem, wonQty);
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

function playResultCardAnimation(item) {
  const card = document.getElementById("resultCard");
  card.classList.remove("reveal-3d");
  if (item && item.value >= REVEAL_3D_VALUE_THRESHOLD) {
    void card.offsetWidth; // перезапуск CSS-анимации
    card.classList.add("reveal-3d");
  }
}

function showResult(success, item, qty) {
  const overlay = document.getElementById("resultOverlay");
  document.getElementById("resultTitle").textContent = success ? "УСПЕХ!" : "Неудача";
  document.getElementById("resultTitle").className = success ? "win" : "lose";
  const qtyLabel = qty > 1 ? ` x${qty}` : "";
  document.getElementById("resultItem").innerHTML = success
    ? `${renderIcon(item)}<span>${item.name}${qtyLabel}</span>`
    : `<span class="lose-note">Предметы потеряны</span>`;
  overlay.classList.remove("hidden");
  playResultCardAnimation(success ? item : null);
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
  document.getElementById("profileAvatarFrame").className = frame ? frame.css : "frame-none";

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
    el.className = `owned-frame-slot ${frame.css}` + (profile.equippedFrame === frameId ? " equipped" : "");
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

// --- Кейс рамок: золотая коробка с "?" в стиле CS:GO ---
let frameCaseOpening = false;
const FRAME_BOX_SHAKE_MS = 1100;

function openFrameCase(collection) {
  if (frameCaseOpening) return;
  if (invQty(collection.costItem) < collection.costAmount) return;

  frameCaseOpening = true;
  removeItem(collection.costItem, collection.costAmount);
  saveState();
  renderAll();

  const wonFrame = pickFrameFromCollection(collection);
  runFrameBoxReveal(wonFrame);
}

function runFrameBoxReveal(frame) {
  const overlay = document.getElementById("frameRevealOverlay");
  const boxStage = document.getElementById("frameBoxStage");
  const resultStage = document.getElementById("frameResultStage");
  const box = document.getElementById("goldBox");
  const closeBtn = document.getElementById("frameRevealClose");

  boxStage.classList.remove("hidden");
  resultStage.classList.add("hidden");
  box.classList.remove("opening");
  box.className = "shaking";
  box.id = "goldBox";
  closeBtn.disabled = true;
  closeBtn.textContent = "Открываю...";
  overlay.classList.remove("hidden");

  setTimeout(() => {
    box.classList.remove("shaking");
    box.classList.add("opening");

    setTimeout(() => {
      boxStage.classList.add("hidden");
      resultStage.classList.remove("hidden");

      document.getElementById("frameResultAvatarImg").src = ensureProfile().avatar || "icon.svg";
      document.getElementById("frameResultFrame").className = frame.css;
      document.getElementById("frameResultName").textContent = frame.name;
      document.getElementById("frameResultRarity").textContent = frame.rarity;

      if (!state.frames.includes(frame.id)) state.frames.push(frame.id);
      saveState();
      frameCaseOpening = false;
      closeBtn.disabled = false;
      closeBtn.textContent = "ОК";
      renderAll();
    }, 400);
  }, FRAME_BOX_SHAKE_MS);
}

document.getElementById("frameRevealClose").addEventListener("click", () => {
  document.getElementById("frameRevealOverlay").classList.add("hidden");
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
  renderClicker();
  renderProfile();
  updateClaimButton();
  updateDailyButton();
}

applyTheme();
initDailyWheel();
renderAll();
setInterval(() => {
  updateClaimButton();
  updateDailyButton();
}, 1000);

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
