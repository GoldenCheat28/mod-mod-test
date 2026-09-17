// Каталог предметов. value — условная ценность (базовая единица — "руда", ⛃).
// icon — плейсхолдер (эмодзи/цвет), пока нет настоящих текстур Minecraft.
// Когда положишь текстуры в assets/textures/<id>.png — просто пропиши поле img,
// и рендер (см. app.js -> renderIcon) сам подставит картинку вместо цветной плитки.

const ITEMS = [
  { id: "dirt",        name: "Грязь",        value: 1,     color: "#6b4a2b", emoji: "🟫" },
  { id: "cobblestone", name: "Булыжник",     value: 2,     color: "#8a8a8a", emoji: "🪨" },
  { id: "wood",        name: "Дерево",       value: 3,     color: "#9a6b3d", emoji: "🪵" },
  { id: "copper",      name: "Медь",         value: 6,     color: "#c96f3a", emoji: "🟠" },
  { id: "coal",        name: "Уголь",        value: 8,     color: "#2b2b2b", emoji: "⚫" },
  { id: "iron",        name: "Железо",       value: 18,    color: "#d8d2c4", emoji: "⚪" },
  { id: "redstone",    name: "Редстоун",     value: 25,    color: "#b3271a", emoji: "🔴" },
  { id: "lapis",       name: "Лазурит",      value: 32,    color: "#2148c9", emoji: "🔵" },
  { id: "gold",        name: "Золото",       value: 45,    color: "#f2c94c", emoji: "🟡" },
  { id: "diamond",     name: "Алмаз",        value: 120,   color: "#5de3e0", emoji: "💎" },
  { id: "emerald",     name: "Изумруд",      value: 150,   color: "#2ecc71", emoji: "🟢" },
  { id: "netherite",   name: "Незерит",      value: 600,   color: "#4a3b3b", emoji: "⬛" },
];

const ITEM_BY_ID = Object.fromEntries(ITEMS.map(it => [it.id, it]));

// Стартовый инвентарь для новой игры
const STARTER_INVENTORY = {
  dirt: 20,
  cobblestone: 10,
  wood: 5,
};
