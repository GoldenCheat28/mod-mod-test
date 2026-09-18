// Рамки аватарки — косметика, выбивается из "золотых" кейсов рамок.
// Эффекты сделаны на CSS (см. style.css, классы frame-*); большинство —
// чистые conic-gradient, но frame_halo — готовая PNG-текстура кольца.

const FRAME_COLLECTIONS = [
  {
    id: "classic",
    name: "Классическая коллекция",
    costItem: "diamond",
    costAmount: 2,
    frames: [
      { id: "frame_bronze", name: "Бронзовая",   rarity: "common",    css: "frame-bronze",  weight: 40 },
      { id: "frame_silver", name: "Серебряная",  rarity: "uncommon",  css: "frame-silver",  weight: 28 },
      { id: "frame_gold",   name: "Золотая",     rarity: "rare",      css: "frame-gold",    weight: 18 },
      { id: "frame_neon",   name: "Неоновая",    rarity: "epic",      css: "frame-neon",    weight: 10 },
      { id: "frame_rainbow",name: "Радужная",    rarity: "legendary", css: "frame-rainbow", weight: 4 },
    ],
  },
  {
    id: "premium",
    name: "Премиум коллекция",
    costItem: "netherite",
    costAmount: 1,
    frames: [
      { id: "frame_void",   name: "Пустота",     rarity: "epic",      css: "frame-void",    weight: 35 },
      { id: "frame_fire",   name: "Огненная",    rarity: "epic",      css: "frame-fire",    weight: 30 },
      { id: "frame_ice",    name: "Ледяная",     rarity: "epic",      css: "frame-ice",     weight: 25 },
      { id: "frame_galaxy", name: "Галактика",   rarity: "legendary", css: "frame-galaxy",  weight: 10 },
      { id: "frame_halo",   name: "Сияние",      rarity: "legendary", css: "frame-halo",    weight: 0.5 },
    ],
  },
];

const FRAME_BY_ID = Object.fromEntries(
  FRAME_COLLECTIONS.flatMap(c => c.frames).map(f => [f.id, f])
);

function pickFrameFromCollection(collection) {
  const total = collection.frames.reduce((s, f) => s + f.weight, 0);
  let roll = Math.random() * total;
  for (const f of collection.frames) {
    if (roll < f.weight) return f;
    roll -= f.weight;
  }
  return collection.frames[collection.frames.length - 1];
}
