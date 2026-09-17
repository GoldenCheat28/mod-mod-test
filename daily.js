// Ежедневное колесо удачи: раз в 24 часа бесплатный спин с призом.
// Дешёвые предметы падают чаще и пачками, дорогие — очень редко и по одному.

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

const DAILY_PRIZES = [
  { id: "dirt",        weight: 20, qty: 5 },
  { id: "cobblestone", weight: 18, qty: 4 },
  { id: "wood",        weight: 15, qty: 3 },
  { id: "copper",      weight: 15, qty: 3 },
  { id: "coal",        weight: 12, qty: 2 },
  { id: "iron",        weight: 10, qty: 1 },
  { id: "redstone",    weight: 5,  qty: 1 },
  { id: "gold",        weight: 3,  qty: 1 },
  { id: "diamond",     weight: 1.5, qty: 1 },
  { id: "emerald",     weight: 0.4, qty: 1 },
  { id: "netherite",   weight: 0.1, qty: 1 },
];

const DAILY_TOTAL_WEIGHT = DAILY_PRIZES.reduce((s, p) => s + p.weight, 0);

function pickDailyPrize() {
  let roll = Math.random() * DAILY_TOTAL_WEIGHT;
  for (const prize of DAILY_PRIZES) {
    if (roll < prize.weight) return prize;
    roll -= prize.weight;
  }
  return DAILY_PRIZES[DAILY_PRIZES.length - 1];
}
