// ==== Рынок: боты, цены, тайминги ====
// Живая площадка поверх items.js: тут только генерация ботов и чистая
// математика (цены, вероятности продажи/подмены лота). Состояние —
// state.market.listings/soldLog — живёт и рендерится в app.js, здесь
// нет обращений к DOM.

const MARKET_BOT_NAMES = [
  "Miner228", "Steve_09", "CaveRat", "OreQueen", "PickaxePro", "DirtLord",
  "RedstoneRick", "LapisLady", "GoldRush99", "DiamondDan", "EmeraldEve",
  "NetherKnight", "BlockBaron", "TunnelTom", "CraftyCat", "OreBaron",
  "SkyBlockSam", "DeepSlateDee", "VeinViper", "ForgeFox", "AnvilAnna",
  "QuarryQuinn", "ShaftShady", "LootLuna", "GrindGary",
];

// База — item.value уже сама по себе прокси сложности добычи через
// апгрейдер (чем реже предмет, тем он дороже), так что честная рыночная
// цена — это value с разбросом, а не отдельная модель EV апгрейдера.
const MARKET_NORMAL_BAND = [0.7, 1.5];   // большинство лотов
const MARKET_OUTLIER_BAND = [0.4, 2.2];  // редкие выбросы — и находки, и переплаты
const MARKET_OUTLIER_CHANCE = 0.15;

// Цена ЗА ШТУКУ — за весь лот (qty > 1) умножается отдельно в
// makeBotListing. listing.price по всему остальному коду (avgSellTimeMs,
// rollListingSniped, отображение) всегда трактуется как цена за ВЕСЬ лот.
function rollBotUnitPrice(item) {
  const [lo, hi] = Math.random() < MARKET_OUTLIER_CHANCE ? MARKET_OUTLIER_BAND : MARKET_NORMAL_BAND;
  const mult = lo + Math.random() * (hi - lo);
  return Math.max(1, Math.round(item.value * mult));
}

// Обычные предметы боты выставляют пачками, дорогие — почти всегда по одному.
function rollBotQty(item) {
  if (item.value <= 3) return 1 + Math.floor(Math.random() * 30);
  if (item.value <= 10) return 1 + Math.floor(Math.random() * 15);
  if (item.value <= 35) return 1 + Math.floor(Math.random() * 6);
  if (item.value <= 100) return 1 + Math.floor(Math.random() * 3);
  return Math.random() < 0.15 ? 2 : 1;
}

// Хорошие (дешёвые/редкие) предметы должны попадаться на рынке реже —
// вес обратно пропорционален ценности, но не линейно, иначе топ-лут
// вообще никогда бы не всплывал.
function rollBotItem() {
  const weights = ITEMS.map(it => 1 / Math.sqrt(it.value));
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < ITEMS.length; i++) {
    if (roll < weights[i]) return ITEMS[i];
    roll -= weights[i];
  }
  return ITEMS[0];
}

function makeBotListing(now) {
  const item = rollBotItem();
  const qty = rollBotQty(item);
  return {
    id: `bot_${now}_${Math.random().toString(36).slice(2, 9)}`,
    sellerType: "bot",
    sellerName: MARKET_BOT_NAMES[Math.floor(Math.random() * MARKET_BOT_NAMES.length)],
    itemId: item.id,
    qty,
    price: rollBotUnitPrice(item) * qty, // цена лота целиком, не за штуку
    listedAt: now,
  };
}

const MARKET_TARGET_BOT_LISTINGS = 48;
const MARKET_BOT_LISTING_LIFETIME_MS = 45 * 60 * 1000; // боты снимают лот максимум через ~45 мин
const MARKET_ROTATION_STEP_MS = 20 * 1000; // раз в 20с (и один раз офлайн-нагоном) подкидываем/снимаем часть лотов

// Ротация ботов — вызывается и по таймеру, пока открыта вкладка, и один
// раз при загрузке (elapsedMs может быть часами простоя — тогда честно
// досыпаем/чистим рынок до целевого состояния без покадровой симуляции).
function rotateBotListings(listings, now, elapsedMs) {
  let result = listings.filter(l => l.sellerType !== "bot" || now - l.listedAt < MARKET_BOT_LISTING_LIFETIME_MS);

  const steps = Math.min(50, Math.max(1, Math.floor(elapsedMs / MARKET_ROTATION_STEP_MS)));
  for (let i = 0; i < steps && result.filter(l => l.sellerType === "bot").length < MARKET_TARGET_BOT_LISTINGS; i++) {
    result.push(makeBotListing(now));
  }
  const botCount = result.filter(l => l.sellerType === "bot").length;
  for (let i = botCount; i < MARKET_TARGET_BOT_LISTINGS; i++) {
    result.push(makeBotListing(now));
  }
  return result;
}

// ==== Скупка твоих лотов ботами (работает и офлайн) ====
// Процесс Пуассона: постоянная интенсивность продажи λ = 1/avgTimeMs,
// поэтому вероятность продажи за произвольный интервал Δt (хоть 5с онлайн,
// хоть трое суток офлайн) считается одной и той же формулой без разницы
// в подходе — только сам avgTimeMs зависит от того, насколько выгодна цена.
function avgSellTimeMs(item, price, qty) {
  const ratio = price / (item.value * qty);
  let baseMinutes;
  if (ratio <= 0.7) baseMinutes = 2 + Math.random() * 6;
  else if (ratio <= 1.0) baseMinutes = 15 + Math.random() * 25;
  else if (ratio <= 1.5) baseMinutes = 60 + Math.random() * 180;
  else baseMinutes = 360 + Math.random() * 1080;
  return baseMinutes * 60 * 1000;
}

function rollPlayerListingSold(listing, item, now) {
  const elapsed = now - listing.lastCheckedAt;
  if (elapsed <= 0) return false;
  const avg = listing._avgMs || (listing._avgMs = avgSellTimeMs(item, listing.price, listing.qty));
  const p = 1 - Math.exp(-elapsed / avg);
  return Math.random() < p;
}

// ==== "Обработка сделки..." — шанс, что бот перехватил лот, пока думал ====
function rollListingSniped(item, listing) {
  const ratio = listing.price / (item.value * listing.qty);
  if (ratio <= 0.6) return Math.random() < 0.35;
  if (ratio <= 0.9) return Math.random() < 0.15;
  if (ratio <= 1.3) return Math.random() < 0.05;
  return Math.random() < 0.01;
}

const MARKET_COMMISSION = 0.05; // с продавца при продаже лота
const MARKET_LISTING_FEE = 0.01; // невозвратно при выставлении, отдельно от комиссии
