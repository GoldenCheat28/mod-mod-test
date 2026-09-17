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
let upgradeInProgress = false;
let needleAngle = 0; // накопленный угол стрелки (для непрерывного вращения)
const WHEEL_RADIUS = 88;
const WHEEL_CIRCUMFERENCE = 2 * Math.PI * WHEEL_RADIUS;

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
    return `<img src="${item.img}" alt="${item.name}" class="item-img">`;
  }
  return `<div class="item-tile" style="background:${item.color}">${item.emoji}</div>`;
}

// ==== Drag & Drop (инвентарь → ставка) ====
const DRAG_THRESHOLD = 8; // px, чтобы отличить тап от перетаскивания

function makeDraggableToStake(el, item) {
  el.addEventListener("pointerdown", (e) => {
    const owned = invQty(item.id);
    const inStake = stake[item.id] || 0;
    if (owned - inStake <= 0) return;

    const startX = e.clientX, startY = e.clientY;
    let dragging = false;
    let ghost = null;
    const stakeSlot = document.getElementById("stakeSlot");

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
        stakeSlot.classList.toggle("drop-target-active", isOverElement(ev, stakeSlot));
      }
    }

    function onUp(ev) {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      el.classList.remove("drag-source");
      stakeSlot.classList.remove("drop-target-active");
      if (ghost) ghost.remove();

      if (dragging) {
        if (isOverElement(ev, stakeSlot)) {
          stake[item.id] = (stake[item.id] || 0) + 1;
          renderAll();
        }
      } else {
        // короткий тап — тоже добавляет один предмет в ставку
        stake[item.id] = (stake[item.id] || 0) + 1;
        renderAll();
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
    el.className = "inv-item" + (available <= 0 ? " depleted" : "");
    el.innerHTML = `
      ${renderIcon(item)}
      <div class="inv-name">${item.name}</div>
      <div class="inv-qty">x${available}</div>
      <div class="inv-worth">${item.value} ⛃</div>
    `;
    makeDraggableToStake(el, item);
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
    el.className = "target-item" + (item.id === targetId ? " selected" : "");
    el.innerHTML = `
      ${renderIcon(item)}
      <div class="inv-name">${item.name}</div>
      <div class="inv-worth">${item.value} ⛃</div>
    `;
    el.addEventListener("click", () => {
      targetId = item.id;
      renderAll();
    });
    grid.appendChild(el);
  });
}

function renderTargetSlot() {
  const content = document.getElementById("targetContent");
  if (!targetId) {
    content.innerHTML = `<span class="slot-empty">выбери цель →</span>`;
    document.getElementById("targetValueLabel").textContent = "0 ⛃";
    return;
  }
  const item = ITEM_BY_ID[targetId];
  content.innerHTML = renderIcon(item) + `<span>${item.name}</span>`;
  document.getElementById("targetValueLabel").textContent = `${item.value} ⛃`;
}

// ==== Шанс ====
function computeChance() {
  const sv = stakeValue();
  const target = targetId ? ITEM_BY_ID[targetId] : null;
  if (!target || sv <= 0) return 0;
  const raw = (sv / target.value) * HOUSE_EDGE;
  return Math.min(MAX_CHANCE, Math.max(MIN_CHANCE, raw));
}

function renderChance() {
  const chance = computeChance();
  const pct = Math.round(chance * 100);
  const active = sv() > 0 && targetId;

  document.getElementById("wheelChance").textContent = active ? `${pct}%` : "--%";

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

  // списываем ставку сразу, чтобы нельзя было менять её во время вращения
  Object.entries(stake).forEach(([id, qty]) => removeItem(id, qty));
  saveState();
  stake = {};
  upgradeInProgress = true;
  renderAll();

  spinNeedleTo(targetDeg);

  setTimeout(() => {
    if (success) addItem(targetId, 1);
    saveState();
    showResult(success, targetItem);
    targetId = null;
    upgradeInProgress = false;
    renderAll();
  }, SPIN_DURATION_MS + 100);
}

function showResult(success, item) {
  const overlay = document.getElementById("resultOverlay");
  document.getElementById("resultTitle").textContent = success ? "УСПЕХ!" : "Неудача";
  document.getElementById("resultTitle").className = success ? "win" : "lose";
  document.getElementById("resultItem").innerHTML = success
    ? `${renderIcon(item)}<span>${item.name}</span>`
    : `<span class="lose-note">Предметы потеряны</span>`;
  overlay.classList.remove("hidden");
}

// ==== Toast ====
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
}

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
function renderAll() {
  renderInventory();
  renderStake();
  renderTargetSlot();
  renderChance();
  updateClaimButton();
}

renderTargetCatalog();
renderAll();
setInterval(() => {
  updateClaimButton();
}, 1000);

// PWA service worker (для офлайна/установки на телефон)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
