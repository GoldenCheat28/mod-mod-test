// Каталог предметов. value — условная ценность (базовая единица — "руда", ⛃).
// icon — плейсхолдер (эмодзи/цвет), пока нет настоящих текстур Minecraft.
// Когда положишь текстуры в assets/textures/<id>.png — просто пропиши поле img,
// и рендер (см. app.js -> renderIcon) сам подставит картинку вместо цветной плитки.

const ITEMS = [
  { id: "dirt",        name: "Грязь",        value: 1,     color: "#6b4a2b", emoji: "🟫", img: "assets/textures/dirt.png" },
  { id: "cobblestone", name: "Булыжник",     value: 2,     color: "#8a8a8a", emoji: "🪨" },
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
];

const ITEM_BY_ID = Object.fromEntries(ITEMS.map(it => [it.id, it]));

// Стартовый инвентарь для новой игры
const STARTER_INVENTORY = {
  dirt: 20,
  cobblestone: 10,
  wood: 5,
};
