// Кейсы: покупаются за конкретный предмет-валюту (медь / алмаз / незерит),
// внутри — рандомный дроп по весам. В среднем цена дропа немного ниже
// цены кейса (это казино, шанс всегда чуть против игрока), но топовый
// приз всегда самый дорогой предмет в пуле — редкий, но возможный.

const CASES = [
  {
    id: "beggar_case",
    name: "Кейс для нищих",
    costItem: "dirt",
    costAmount: 15,
    drops: [
      { id: "dirt", weight: 35 },
      { id: "cobblestone", weight: 28 },
      { id: "wood", weight: 18 },
      { id: "copper", weight: 12 },
      { id: "coal", weight: 6 },
      { id: "iron", weight: 1 },
    ],
  },
  {
    id: "copper_case",
    name: "Медный кейс",
    costItem: "copper",
    costAmount: 10,
    drops: [
      { id: "coal", weight: 5 },
      { id: "iron", weight: 10 },
      { id: "redstone", weight: 15 },
      { id: "lapis", weight: 20 },
      { id: "gold", weight: 30 },
      { id: "diamond", weight: 20 },
    ],
  },
  {
    id: "diamond_case",
    name: "Алмазный кейс",
    costItem: "diamond",
    costAmount: 1,
    drops: [
      { id: "redstone", weight: 5 },
      { id: "lapis", weight: 15 },
      { id: "gold", weight: 30 },
      { id: "diamond", weight: 35 },
      { id: "emerald", weight: 13 },
      { id: "netherite", weight: 2 },
    ],
  },
  {
    id: "netherite_case",
    name: "Незеритовый кейс",
    costItem: "netherite",
    costAmount: 1,
    drops: [
      { id: "gold", weight: 3 },
      { id: "diamond", weight: 10 },
      { id: "emerald", weight: 18 },
      { id: "netherite", weight: 64 },
      { id: "netherite_block", weight: 5 },
    ],
  },
];

function pickCaseDrop(caseDef) {
  const totalWeight = caseDef.drops.reduce((sum, d) => sum + d.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const drop of caseDef.drops) {
    if (roll < drop.weight) return drop.id;
    roll -= drop.weight;
  }
  return caseDef.drops[caseDef.drops.length - 1].id;
}
