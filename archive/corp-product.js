/** @param {NS} ns
 *
 *  CORP PRODUCT — keep a product division developing and selling products. 91.6GB.
 *
 *      run corp-product.js                  # one pass: start a product if there's room, sell finished ones
 *      run corp-product.js --loop           # resident: always have something in development
 *      run corp-product.js --loop --rotate  # ...and retire the weakest product when at the cap
 *      run corp-product.js --status         # what exists, how far along, what it's rated
 *
 *  THIS IS WHERE THE MONEY IS. Materials divisions are a farm; products are the exponential
 *  curve, and the round-3+ loop is "always have a product in development". A finished product
 *  sells at a price set by its RATING rather than a market price, so each generation you make
 *  is worth more than the last — your research, office size and employee productivity all feed
 *  the rating of products created AFTER they improve.
 *
 *  WHAT ACTUALLY DRIVES A PRODUCT'S QUALITY (Product.ts:147-150, v3.0.1):
 *
 *      designMult  = 1 + designInvestment^0.1 / 100
 *      balanceMult = 1.2*engineer + 0.9*management + 1.3*rnd + 1.5*operations + business
 *      sciMult     = 1 + researchPoints^researchFactor / 800
 *      quality     = balanceMult * designMult * sciMult * (employee production terms)
 *
 *  Three things follow, and they are the whole strategy:
 *
 *    1. MONEY BARELY MATTERS. That 0.1 exponent means $1b of design investment buys x1.079 and
 *       $1t buys x1.159 — a thousand times the spend for 7% more quality. The defaults here are
 *       1% of funds each, and raising them is close to pointless. Don't be tempted.
 *    2. THE JOB MIX MATTERS ENORMOUSLY. Operations (1.5) and R&D (1.3) are weighted highest,
 *       Management (0.9) lowest. The mix that is right for a materials division is NOT right for
 *       a division developing a product — see --preset product in corp-jobs.js.
 *    3. RESEARCH POINTS MATTER, and compound. Never drain the RP pool, and above all never spend
 *       it just before a product finishes — the product banks sciMult at completion.
 *
 *  ROTATION IS DESTRUCTIVE AND SO IT IS OPT-IN. A division is capped at maxProducts (3, or more
 *  with the Capacity researches), and a product still in development COUNTS toward that cap
 *  (Actions.ts:483). To make a fourth you must discontinue one, permanently, losing its revenue
 *  immediately. That is a one-way lever, so --rotate is off by default and this script will
 *  simply tell you it is blocked. Same principle as ascend.js holding the install behind
 *  --install: the grinding is automated, the irreversible bit stays yours.
 *
 *  RAM: makeProduct (20) + sellProduct (20) + discontinueProduct (20) + getProduct (10)
 *       + getDivision (10) + getCorporation (10) + 1.6 base = 91.6GB.
 */

// ---- Tuning (all overridable by flag) --------------------------------------
const STATE_FILE = "corp-state.txt";
const PREFIX = "Prod";          // product names become Prod-1, Prod-2, ...
const DESIGN_FRAC = 0.01;       // fraction of corp funds into design (exponent is 0.1 — see above)
const MARKET_FRAC = 0.01;       // ...and into marketing
const MIN_INVEST = 1e9;         // don't bother with a token investment
const MAX_INVEST = 1e12;        // ...and don't waste funds past the point of diminishing returns
// PRICING. "MP" is the right answer for a MATERIAL — there it means the market price, which is
// well above what you paid. For a PRODUCT it means something completely different: the product's
// own productionCost. Selling a product at "MP" sells it at cost, for a margin of approximately
// zero, and it always clears precisely because it is the cheapest possible price. This was live
// here for the whole of round 3: six cities x three products x ~33/s at a ~$14.9k unit cost gave
// Tobacco revenue of $8.94m/s — equal to units x cost to three significant figures.
//   Market-TA.II solves this permanently by pricing at the optimum every cycle, but it costs
// 50k RP and Tobacco had 18.9k. Until then "auto" below hunts the clearing price by experiment.
const PRICE = "auto";
const AMOUNT = "MAX";

// ---- auto-pricing controller ----------------------------------------------
// Per product PER CITY (demand and competition differ per city, and sellProduct is priced per
// city even though `all = true` writes them together) we hold a multiplier k and sell at MP*k.
// Each cycle: if it all cleared and no stock is sitting, raise; if a backlog is building, cut.
// Coarse steps until the first rejection tell us roughly where the ceiling is; fine steps after
// that track it as awareness, popularity and ratings drift upward.
const PRICE_FILE = "corp-product-price.txt";
const K_START = 1;              // MP*1 = at cost: where the game leaves you, and the safe floor
// K_MIN IS 1, NOT LESS. Below MP*1 you are selling a product for less than it cost to make, so
// every unit that moves is a loss and moving MORE of them is worse. The first version of this
// controller allowed 0.5, and when Prod-1 stopped clearing it duly cut and cut until it was
// dumping at MP*0.762 in all six cities. A product that will not clear at cost is not a pricing
// problem — it is an obsolete product, and the answer is --rotate, not a deeper discount.
const K_MIN = 1, K_MAX = 1e7;   // products with a high rating support very large markups
const STUCK_CYCLES = 8;         // ...how long at the floor, still backing up, before we say so
const K_COARSE = 1.25;          // climb fast while nothing has pushed back yet
const K_FINE = 1.05;            // ...then creep, so overshoot costs at most one cycle of sales
const K_DOWN = 0.9;             // and retreat faster than we advance — a backlog earns nothing
const GROWTH_TOL = 0.02;        // stock up more than this vs last cycle counts as "piling up"
// ---------------------------------------------------------------------------

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["division", ""], ["prefix", PREFIX], ["city", ""],
    ["design-frac", DESIGN_FRAC], ["marketing-frac", MARKET_FRAC],
    ["min-invest", MIN_INVEST], ["max-invest", MAX_INVEST],
    ["price", PRICE], ["amount", AMOUNT],
    ["rotate", false], ["loop", false], ["status", false],
    ["quiet", false], ["dry", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const division = resolveDivision(ns, opts.division);
  if (!division) {
    ns.tprint("\ncorp-product: no product division found.\n" +
      "  Round 3 starts by creating one — Tobacco is the standard choice:\n" +
      "      run corp-division.js --industry Tobacco --name Tobacco\n" +
      "      run corp-cities.js --division Tobacco\n" +
      "      run corp-warehouses.js --division Tobacco\n" +
      "      run corp-status.js            # records it, so this script can find it\n" +
      "  ...or pass --division NAME explicitly.\n");
    return;
  }

  let cycleSeconds = 10;
  try { cycleSeconds = ns.corporation.getConstants().secondsPerMarketCycle || 10; } catch (e) { /* default */ }
  const cities = Object.values(ns.enums.CityName);
  // Multipliers persist across restarts (installs, conductor restarts). Without this the hunt
  // starts again from MP*1 — at cost — every single time the script is bounced.
  const kState = loadPrices(ns);
  let lastLog = "";

  for (;;) {
    let snap;
    try { snap = survey(ns, division, cities); }
    catch (e) {
      ns.tprint(`\ncorp-product: ${e}\n  run corp-status.js to check the division name.\n`);
      return;
    }

    if (opts.status) { printStatus(ns, snap, opts, null, kState); return; }
    if (!snap.makesProducts) {
      ns.tprint(`\ncorp-product: "${division}" is a ${snap.industry} division and cannot make ` +
        `products.\n  Pass --division NAME for a product division (Tobacco, Pharmaceutical, ...).\n`);
      return;
    }

    const acted = act(ns, division, cities, snap, opts, kState);
    if (!opts.dry) savePrices(ns, kState);

    if (!opts.loop) { printStatus(ns, snap, opts, acted, kState); return; }
    // Only speak when something CHANGES. Several of the lines act() produces are standing
    // conditions rather than events — "at the product cap, pass --rotate", "cannot start, funds
    // too low" — and re-printing those every cycle buries the real events. Worse during bonus
    // time, when a cycle is 1s and the log fills ten times faster.
    const key = acted.join("|");
    if (!opts.quiet && acted.length && key !== lastLog) for (const line of acted) ns.print(line);
    lastLog = key;

    try { await ns.corporation.nextUpdate(); }
    catch (e) { await ns.sleep(cycleSeconds * 1000); }
  }
}

/** Read the division and every product. Changes nothing. */
function survey(ns, division, cities) {
  const d = ns.corporation.getDivision(division);
  const snap = {
    division, industry: d.industry, makesProducts: d.makesProducts,
    maxProducts: d.maxProducts, researchPoints: d.researchPoints,
    products: [], funds: 0, designCity: d.cities.includes("Sector-12") ? "Sector-12" : d.cities[0],
    cities: d.cities,
  };
  try { snap.funds = ns.corporation.getCorporation().funds; } catch (e) { /* leave 0 */ }

  for (const name of d.products) {
    // A product is division-wide, but priced per city — so read one city for its progress and
    // rating, and every city to find out whether a sell order is actually in place everywhere.
    let head = null;
    const noSellCities = [];
    const byCity = {};
    for (const city of cities) {
      if (!d.cities.includes(city)) continue;
      let p;
      try { p = ns.corporation.getProduct(division, city, name); } catch (e) { continue; }
      if (!head) head = p;
      if (isZero(p.desiredSellAmount)) noSellCities.push(city);
      // Per-city, because that is the grain the auto-pricer controls at: Volhaven's demand for
      // this product has nothing to do with Aevum's.
      byCity[city] = {
        stored: p.stored, made: p.productionAmount, sold: p.actualSellAmount,
        cost: p.productionCost,
      };
    }
    if (!head) continue;
    snap.products.push({
      name, byCity,
      progress: head.developmentProgress,
      finished: head.developmentProgress >= 100,
      rating: head.rating,
      effectiveRating: head.effectiveRating,
      stored: head.stored,
      productionAmount: head.productionAmount,
      actualSellAmount: head.actualSellAmount,
      productionCost: head.productionCost,
      designInvestment: head.designInvestment,
      advertisingInvestment: head.advertisingInvestment,
      noSellCities,
    });
  }
  return snap;
}

/** Do the three jobs: price what's finished, start one if there's room, rotate if allowed. */
function act(ns, division, cities, snap, opts, kState) {
  const log = [];

  // ---- 1. price what's finished --------------------------------------------
  if (String(opts.price).toLowerCase() === "auto") {
    log.push(...autoPrice(ns, division, snap, opts, kState));
  } else {
    for (const p of snap.products) {
      if (!p.finished || !p.noSellCities.length) continue;
      if (opts.dry) { log.push(`[dry] would set sell order on ${p.name} (${p.noSellCities.length} cities)`); continue; }
      try {
        // `all = true` sets every city in one call, which is also why this branch needs no
        // per-city loop.
        ns.corporation.sellProduct(division, snap.designCity, p.name,
          String(opts.amount), String(opts.price), true);
        log.push(`sell order set on ${p.name}: ${opts.amount} @ ${opts.price} (all cities)`);
      } catch (e) { log.push(`FAILED sell order on ${p.name}: ${short(e)}`); }
    }
  }

  // ---- 2. keep something in development -------------------------------------
  const developing = snap.products.filter((p) => !p.finished);
  const atCap = snap.products.length >= snap.maxProducts;

  if (!developing.length && !atCap) {
    const design = clamp(snap.funds * Number(opts["design-frac"]), opts);
    const marketing = clamp(snap.funds * Number(opts["marketing-frac"]), opts);
    const name = nextName(snap.products.map((p) => p.name), String(opts.prefix));
    if (snap.funds < design + marketing) {
      log.push(`cannot start ${name} — funds $${fmt(ns, snap.funds)} below the planned investment.`);
    } else if (opts.dry) {
      log.push(`[dry] would start ${name} in ${snap.designCity} ` +
        `(design $${fmt(ns, design)}, marketing $${fmt(ns, marketing)})`);
    } else {
      try {
        ns.corporation.makeProduct(division, snap.designCity, name, design, marketing);
        log.push(`STARTED ${name} in ${snap.designCity} — design $${fmt(ns, design)}, ` +
          `marketing $${fmt(ns, marketing)}`);
      } catch (e) { log.push(`FAILED to start ${name}: ${short(e)}`); }
    }
  }

  // ---- 3. rotation: retire the weakest so a better one can be built ---------
  if (!developing.length && atCap) {
    const finished = snap.products.filter((p) => p.finished);
    const worst = finished.slice().sort((a, b) => a.rating - b.rating)[0];
    if (!opts.rotate) {
      log.push(`at the ${snap.maxProducts}-product cap and nothing in development. ` +
        `To keep improving, retire the weakest (${worst ? worst.name : "?"}, rating ` +
        `${worst ? round(worst.rating) : "?"}) and build a better one:  --rotate`);
    } else if (!worst) {
      log.push(`at the cap but no finished product to retire.`);
    } else if (opts.dry) {
      log.push(`[dry] would DISCONTINUE ${worst.name} (rating ${round(worst.rating)})`);
    } else {
      try {
        ns.corporation.discontinueProduct(division, worst.name);
        log.push(`DISCONTINUED ${worst.name} (rating ${round(worst.rating)}) — ` +
          `a replacement starts next pass.`);
      } catch (e) { log.push(`FAILED to discontinue ${worst.name}: ${short(e)}`); }
    }
  }

  return log;
}

/** Hunt the clearing price for every finished product, in every city, one notch per cycle.
 *
 *  The only signal available is what happened last cycle: how much was made, how much sold, and
 *  how much is left sitting. That is enough. If it all went and nothing is on the shelf, the
 *  price was under the ceiling and we can ask for more. If stock is piling up, we asked too much.
 *  There is no formula to solve here — the ceiling depends on demand, competition, awareness,
 *  popularity and the product's rating, all of which drift — so we track it instead of computing
 *  it, which is also what Market-TA.II does once you can afford the 50k RP.
 */
function autoPrice(ns, division, snap, opts, kState) {
  const log = [];
  const stuckAt = [];
  let moved = 0, cut = 0, opened = 0;

  for (const p of snap.products) {
    if (!p.finished) continue;
    for (const city of Object.keys(p.byCity)) {
      const c = p.byCity[city];
      const id = `${p.name}@${city}`;
      const prev = kState[id] || {};
      let k = Number(prev.k);
      if (!Number.isFinite(k) || k <= 0) k = K_START;
      let coarse = prev.coarse !== false;

      // A city with no sell order yet produces but sells nothing, which looks exactly like a
      // catastrophic overprice. Don't let that bogus reading drive the controller — just open
      // the order at the price we already believe in and start measuring next cycle.
      let stuck = Number(prev.stuck) || 0;
      const unpriced = p.noSellCities.includes(city);
      if (unpriced) {
        opened++;
      } else {
        // The target is the highest price at which you still sell everything you make. So the
        // test is throughput, not emptiness: are we moving a full cycle of output, and is the
        // shelf not growing? Testing "stored is near zero" instead looks equivalent and isn't —
        // it leaves a dead band where a small permanent backlog satisfies neither raise nor cut,
        // and the controller freezes there and stops tracking demand for good.
        const last = Number.isFinite(Number(prev.stored)) ? Number(prev.stored) : c.stored;
        const growing = c.stored > last * (1 + GROWTH_TOL) + 0.5;
        const movingAll = c.made > 0 && c.sold >= c.made * 0.995;
        if (movingAll && !growing) {
          k *= coarse ? K_COARSE : K_FINE;
          moved++;
          stuck = 0;
        } else {
          k *= K_DOWN;
          coarse = false;  // we have now seen the ceiling; never go back to coarse steps
          cut++;
          // Already at the floor and STILL not shifting a full cycle of output? Then no price
          // this script is willing to name will fix it, and repeating the cut forever just
          // hides that. Count it so we can say so out loud.
          stuck = k <= K_MIN * 1.0001 ? stuck + 1 : 0;
        }
      }
      k = Math.max(K_MIN, Math.min(K_MAX, k));
      if (stuck >= STUCK_CYCLES) stuckAt.push(`${id} (${round(c.stored)} unsold)`);

      const priceStr = `MP*${k.toFixed(3)}`;
      kState[id] = { k, coarse, stuck, stored: c.stored, str: prev.str };
      if (priceStr === prev.str && !unpriced) continue;   // nothing to write this cycle
      if (opts.dry) { log.push(`[dry] ${id} -> ${priceStr}`); continue; }
      try {
        // all = false: the whole point is that each city gets its own price.
        ns.corporation.sellProduct(division, city, p.name,
          String(opts.amount), priceStr, false);
        kState[id].str = priceStr;
      } catch (e) { log.push(`FAILED sell order on ${id}: ${short(e)}`); }
    }
  }

  if (opened) log.push(`opened ${opened} sell order(s) that had none`);
  if (stuckAt.length) {
    // Name the product once, not every city — the verdict is the same everywhere.
    const names = [...new Set(stuckAt.map((s) => s.split("@")[0]))];
    log.push(`WON'T CLEAR EVEN AT COST: ${names.join(", ")} — ${stuckAt.length} city-slot(s) ` +
      `backing up. That is an obsolete product, not a price. Retire it:  --rotate`);
  }
  // One summary line, not eighteen: the per-city detail is in --status.
  if (moved || cut) {
    log.push(`auto-price: raised ${moved}, cut ${cut} · ${priceSummary(kState)}`);
  }
  return log;
}

/** Compact "cheapest -> dearest multiplier in play", for the log and for --status. */
function priceSummary(kState) {
  const ks = Object.values(kState).map((v) => Number(v.k)).filter(Number.isFinite);
  if (!ks.length) return "no prices yet";
  const lo = Math.min(...ks), hi = Math.max(...ks);
  const mean = ks.reduce((a, b) => a + b, 0) / ks.length;
  return `markup x${lo.toFixed(2)}-x${hi.toFixed(2)} (avg x${mean.toFixed(2)})`;
}

function loadPrices(ns) {
  try {
    const raw = ns.read(PRICE_FILE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch (e) { /* start fresh */ }
  return {};
}

function savePrices(ns, kState) {
  try { ns.write(PRICE_FILE, JSON.stringify(kState), "w"); } catch (e) { /* not fatal */ }
}

function printStatus(ns, snap, opts, acted, kState) {
  const auto = String(opts.price).toLowerCase() === "auto";
  const rows = snap.products.map((p) => {
    const head = `  ${p.name.padEnd(14)}`;
    if (!p.finished) {
      return `${head} developing ${round(p.progress)}% ` +
        `(design $${fmt(ns, p.designInvestment)}, marketing $${fmt(ns, p.advertisingInvestment)})`;
    }
    let line = `${head} rating ${round(p.rating)} (effective ${round(p.effectiveRating)}) · ` +
      `stored ${round(p.stored)} · produced ${round(p.productionAmount)} · sold ${round(p.actualSellAmount)} · ` +
      `cost $${fmt(ns, p.productionCost)}`;
    if (auto && kState) {
      // Per city, because that is where the money differs: same product, same cost, and the
      // ceiling in Volhaven has nothing to do with the ceiling in Aevum.
      const bits = Object.keys(p.byCity || {}).map((city) => {
        const e = kState[`${p.name}@${city}`];
        const k = e && Number.isFinite(Number(e.k)) ? Number(e.k) : null;
        return `${city} ${k === null ? "—" : "x" + k.toFixed(2) + (e.coarse === false ? "" : "↑")}`;
      });
      if (bits.length) line += `\n${" ".repeat(18)}markup: ${bits.join(" · ")}`;
    }
    if (p.noSellCities.length) {
      line += `\n${" ".repeat(18)}!! NO SELL ORDER in ${p.noSellCities.join(", ")}`;
    }
    return line;
  });

  const developing = snap.products.filter((p) => !p.finished).length;
  ns.tprint(
    `\n===== corp-product: ${snap.division} [${snap.industry}] ${opts.dry ? "(DRY RUN)" : ""}=====\n` +
    `  products ${snap.products.length}/${snap.maxProducts}` +
    (developing ? `, ${developing} in development` : `, none in development`) +
    ` · RP ${fmt(ns, snap.researchPoints)} · funds $${fmt(ns, snap.funds)}\n` +
    (rows.length ? rows.join("\n") : "  (no products yet)") +
    (acted && acted.length ? `\n\n  this pass:\n    ${acted.join("\n    ")}` : "") +
    (auto ? `\n\n  Pricing is AUTOMATIC: ${kState ? priceSummary(kState) : "no prices yet"}. ` +
      `A "↑" means that city has\n` +
      `  never been refused yet, so it is still climbing in coarse steps and the number below is\n` +
      `  a floor, not a finding. Selling a product at plain "MP" sells it at COST.\n` +
      `  The permanent fix is Market-TA.II (50k RP) — until then this hunts the same ceiling.\n`
      : `\n\n  Pricing is FIXED at "${opts.price}". For a product, "MP" means its own production\n` +
        `  cost — i.e. a zero margin. Use --price auto unless you know why you want this.\n`) +
    `\n  Keep one always in development:  run corp-product.js --loop\n` +
    `  Product quality is driven by the JOB MIX (Operations 1.5, R&D 1.3) and RESEARCH, not by\n` +
    `  investment — the investment exponent is 0.1, so 1000x the money is 7% more quality.\n` +
    `      run corp-jobs.js --preset product --division ${snap.division}\n` +
    `=====`
  );
}

/** Prod-1, Prod-2, ... skipping any index already taken. */
function nextName(existing, prefix) {
  let top = 0;
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
  for (const name of existing) {
    const hit = pattern.exec(name);
    if (hit) top = Math.max(top, Number(hit[1]));
  }
  return `${prefix}-${top + 1}`;
}

function clamp(value, opts) {
  const lo = Number(opts["min-invest"]), hi = Number(opts["max-invest"]);
  if (!Number.isFinite(value) || value < 0) return lo;
  return Math.max(lo, Math.min(hi, value));
}

function isZero(v) {
  if (v === undefined || v === null || v === "") return true;
  if (typeof v === "number") return v <= 0;
  const s = String(v).trim().toUpperCase();
  return s === "0" || s === "0.0";
}

/** Explicit flag > corp-state.txt's product role > a lone product-capable division. 0GB. */
/** Only a FRESH corp-state.txt counts (same rule as corp-supply.js): home files survive an
 *  install and a BitNode jump, so a stale roles.product is last life's corporation — BN3's
 *  "Tobacco" arriving in BN5. Stale file → "" → the no-division help text, which is the truth. */
function resolveDivision(ns, flagValue) {
  if (flagValue) return flagValue;
  try {
    const raw = ns.read(STATE_FILE);
    if (raw) {
      const st = JSON.parse(raw) || {};
      const fresh = Number.isFinite(st.ts) && Date.now() - st.ts <= 600e3;
      if (fresh && st.roles && st.roles.product) return st.roles.product;
    }
  } catch (e) { /* fall through */ }
  return "";
}

function short(msg) { return String(msg).replace(/\s+/g, " ").slice(0, 140); }
function round(n) { return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "?"; }

// ns.formatNumber was removed in 3.0.0 (tombstone: typeof passes, the call throws).
function fmt(ns, n) {
  if (!Number.isFinite(n)) return "0";
  try { return ns.format.number(n, 2); } catch (e) { return String(Math.round(n)); }
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-product.js — develop and sell products, continuously (91.6GB).\n" +
    "  run corp-product.js                  one pass: sell finished products, start one if there's room\n" +
    "  run corp-product.js --loop           resident: always keep something in development\n" +
    "  run corp-product.js --loop --rotate  ...and retire the weakest when at the product cap\n" +
    "  run corp-product.js --status         what exists, progress, ratings; changes nothing\n" +
    "  run corp-product.js --prefix Tob     name products Tob-1, Tob-2, ...\n" +
    "  run corp-product.js --dry            preview, change nothing\n" +
    "  run corp-product.js --price MP*8     pin the markup instead of hunting for it\n" +
    "  PRICING: default --price auto raises the markup while everything clears and cuts it when\n" +
    "  stock piles up, per product per city. Plain \"MP\" on a PRODUCT means its production cost,\n" +
    "  so it sells at a zero margin — that is not the same as \"MP\" on a material.\n" +
    "  Investment barely matters (exponent 0.1). The job mix and research points do.\n" +
    "  --rotate DISCONTINUES a product permanently, so it is off by default.\n"
  );
}
