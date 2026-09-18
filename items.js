// Каталог предметов. value — условная ценность (базовая единица — "руда", ⛃).
// icon — плейсхолдер (эмодзи/цвет), пока нет настоящих текстур Minecraft.
// Когда положишь текстуры в assets/textures/<id>.png — просто пропиши поле img,
// и рендер (см. app.js -> renderIcon) сам подставит картинку вместо цветной плитки.

const ITEMS = [
  { id: "dirt",        name: "Грязь",        value: 1,     color: "#6b4a2b", emoji: "🟫", img: "assets/textures/dirt.png" },
  { id: "cobblestone", name: "Булыжник",     value: 2,     color: "#8a8a8a", emoji: "🪨", img: "assets/textures/cobblestone.png" },
  { id: "wood",        name: "Дерево",       value: 3,     color: "#9a6b3d", emoji: "🪵", img: "assets/textures/wood.png" },
  { id: "copper",      name: "Медь",         value: 6,     color: "#c96f3a", emoji: "🟠", img: "assets/textures/copper.png" },
  { id: "coal",        name: "Уголь",        value: 8,     color: "#2b2b2b", emoji: "⚫", img: "assets/textures/coal.png" },
  { id: "iron",        name: "Железо",       value: 18,    color: "#d8d2c4", emoji: "⚪", img: "assets/textures/iron.png" },
  { id: "redstone",    name: "Редстоун",     value: 25,    color: "#b3271a", emoji: "🔴", img: "assets/textures/redstone.png" },
  { id: "lapis",       name: "Лазурит",      value: 32,    color: "#2148c9", emoji: "🔵", img: "assets/textures/lapis.png" },
  { id: "gold",        name: "Золото",       value: 45,    color: "#f2c94c", emoji: "🟡", img: "assets/textures/gold.png" },
  { id: "diamond",     name: "Алмаз",        value: 120,   color: "#5de3e0", emoji: "💎", img: "assets/textures/diamond.png" },
  { id: "emerald",     name: "Изумруд",      value: 150,   color: "#2ecc71", emoji: "🟢", img: "assets/textures/emerald.png" },
  { id: "netherite",   name: "Незерит",      value: 600,   color: "#4a3b3b", emoji: "⬛", img: "assets/textures/netherite.png" },
  { id: "netherite_block", name: "Незеритовый блок", value: 2000, color: "#1a1414", emoji: "💠", img: "assets/textures/netherite_block.png" },
];

const ITEM_BY_ID = Object.fromEntries(ITEMS.map(it => [it.id, it]));

// Редкость карточки предмета по её ценности (для цветной DBD-style рамки).
function getRarity(item) {
  if (item.value <= 3) return "common";
  if (item.value <= 10) return "uncommon";
  if (item.value <= 35) return "rare";
  if (item.value <= 100) return "epic";
  return "legendary";
}

// Стартовый инвентарь для новой игры
const STARTER_INVENTORY = {
  dirt: 20,
  cobblestone: 10,
  wood: 5,
};

// ==== Качество предметов ====
// Апгрейдер иногда (только при ПОБЕДЕ, не при покупке на рынке) даёт
// предмет повышенного качества — суффикс приклеивается прямо к id в
// инвентаре ("diamond__q2"), поэтому не нужна отдельная система хранения:
// addItem/removeItem/invQty работают с ним как с обычным id.
const QUALITY_TIERS = [
  { suffix: "",     stars: 0, mult: 1,    weight: 70 },
  { suffix: "__q1", stars: 1, mult: 1.15, weight: 20 },
  { suffix: "__q2", stars: 2, mult: 1.4,  weight: 8 },
  { suffix: "__q3", stars: 3, mult: 1.8,  weight: 2 },
];

function pickQualityTier() {
  const total = QUALITY_TIERS.reduce((s, t) => s + t.weight, 0);
  let roll = Math.random() * total;
  for (const t of QUALITY_TIERS) {
    if (roll < t.weight) return t;
    roll -= t.weight;
  }
  return QUALITY_TIERS[0];
}

// ITEM_BY_ID хранит только базовые предметы — пара (предмет × качество)
// достраивается на лету, а не как 44×4 статических записи в каталоге.
// Для базового id (без суффикса) просто возвращает ITEM_BY_ID[id].
function getEffectiveItem(id) {
  const base = ITEM_BY_ID[id];
  if (base) return base;
  const idx = id.indexOf("__q");
  if (idx === -1) return null;
  const baseId = id.slice(0, idx);
  const baseItem = ITEM_BY_ID[baseId];
  if (!baseItem) return null;
  const tier = QUALITY_TIERS.find(t => t.suffix === id.slice(idx));
  if (!tier) return baseItem;
  return {
    ...baseItem,
    id,
    baseId,
    qualityTier: tier.stars,
    name: `${baseItem.name} ${"★".repeat(tier.stars)}`,
    value: Math.round(baseItem.value * tier.mult),
  };
}
