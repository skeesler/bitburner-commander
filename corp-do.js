/** @param {NS} ns
 *
 *  CORP-DO — the corporation commands you run ON PURPOSE. Each one acts and exits.
 *
 *      run corp-do.js                        # the command list
 *      run corp-do.js <command> ... --dry    # any command: say what it would do, change nothing
 *
 *  corp.js keeps the corporation running; this file is for decisions — building, sizing, and the
 *  one-way levers. The split is the point: nothing in a resident loop should ever be able to
 *  accept an offer or go public by accident. Those commands here also need --yes, and without it
 *  they print the numbers and stop — the same contract as ascend.js holding the install behind
 *  --install.
 *
 *  BUILD      create · expand · office · warehouse · jobs · export · sell · unlock · upgrade ·
 *             advert · research
 *  MONEY OUT  offer · accept · public · sellshares · dividend · bribe
 *  HOUSEKEEP  cleanup (delete the pre-rewrite corp-*.js copies still sitting on home)
 *
 *  RAM: ~565GB (36 charged corporation functions), under the game's 1024GB per-script cap. It runs and
 *  exits, so it only needs that room for a second. See corp-design.md.
 */
import {
  fmt, short, round, pct, listOf, sameName, parseMoney, readConfig, writeConfig, validJobPolicy,
  mixForJobs, autoJobPolicy, assignJobs, fillOffice, parseRoutes, EXPORT_AMOUNT, JOB_PRESETS,
  shareSale, ipoPrice,
} from "corp-lib.js";

const CORP_NAME = "Astarte Industries";

// The pre-rewrite rig. RFA sync never deletes, so these stay runnable on home after the move to
// archive/ — and a stale in-game copy has already cost us $30b once (corp-design.md, gotcha 12).
const LEGACY = [
  "corp-advert.js", "corp-api.js", "corp-boost.js", "corp-boot.js", "corp-bribe.js", "corp-buy.js",
  "corp-cities.js", "corp-conductor.js", "corp-dividend.js", "corp-division.js", "corp-export.js",
  "corp-hire.js", "corp-jobs.js", "corp-morale.js", "corp-office.js", "corp-product.js",
  "corp-research.js", "corp-scan-city.js", "corp-scan-corp.js", "corp-scan-cost.js", "corp-sell.js",
  "corp-smartsupply.js", "corp-status.js", "corp-supply.js", "corp-ta.js", "corp-upgrade.js",
  "corp-warehouse-upgrade.js", "corp-warehouses.js",
  "corp-state.txt", "corp-rep-1.txt", "corp-rep-2.txt", "corp-rep-3.txt",
];

const COMMANDS = {
  create:     [cmdCreate,     "create [--name X] [--seed]             new corporation (self-funded $150b unless --seed, BN3 only)"],
  expand:     [cmdExpand,     "expand INDUSTRY [--name N]             division + all 6 offices + all 6 warehouses (idempotent)"],
  office:     [cmdOffice,     "office DIV|all SIZE                    grow offices to SIZE and fill the seats"],
  warehouse:  [cmdWarehouse,  "warehouse DIV|all LEVEL | --add N      raise warehouse levels"],
  jobs:       [cmdJobs,       `jobs DIV|all POLICY                    ${JOB_PRESETS.join("|")} or "ops=2,eng=1"; corp.js keeps it`],
  export:     [cmdExport,     "export agri-chem | \"A/Plants > B\" | --show | ... --clear"],
  sell:       [cmdSell,       "sell DIV MATS [--price MP] [--amount MAX] [--clear]   (--price 0 DUMPS; never boosts)"],
  unlock:     [cmdUnlock,     "unlock [NAME]                          list unlocks, or buy one"],
  upgrade:    [cmdUpgrade,    "upgrade NAME [N]                       buy N levels of a corporation upgrade"],
  advert:     [cmdAdvert,     "advert DIV [N]                         hire N AdVerts"],
  research:   [cmdResearch,   "research DIV [NAME]                    list a division's research, or buy one"],
  offer:      [cmdOffer,      "offer                                  the current investment offer"],
  accept:     [cmdAccept,     "accept --yes                           ACCEPT it (one-way; four in a corp's life)"],
  ipo:        [cmdIpo,        "ipo [--goal 100q]                      what going public + selling shares would pay today (changes nothing)"],
  public:     [cmdPublic,     "public SHARES --yes                    GO PUBLIC (one-way: no more offers, ever)"],
  sellshares: [cmdSellShares, "sellshares N|10% [--yes]               sell your shares for cash (1h cooldown)"],
  dividend:   [cmdDividend,   "dividend RATE                          0..1 of profit paid out (public corps only)"],
  bribe:      [cmdBribe,      "bribe FACTION AMOUNT|all               funds -> reputation, past the valuation threshold"],
  filler:     [cmdFiller,     "filler DIV [--off]                     valuation filler: corp.js stops managing (and spending on) it"],
  cleanup:    [cmdCleanup,    "cleanup [--yes]                        remove the pre-rewrite corp scripts from home"],
};

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["dry", false], ["yes", false], ["help", false],
    ["name", ""], ["seed", false], ["add", 0], ["price", "MP"], ["amount", "MAX"], ["clear", false],
    ["show", false], ["agri", "Agriculture"], ["chem", "Chemical"], ["off", false], ["goal", "100q"],
  ]);
  const [cmd, ...args] = opts._.map(String);
  if (!cmd || opts.help || !COMMANDS[cmd]) {
    if (cmd && !COMMANDS[cmd]) ns.tprint(`\ncorp-do: unknown command "${cmd}".`);
    ns.tprint("\ncorp-do.js — deliberate corporation commands (every one takes --dry):\n" +
      Object.values(COMMANDS).map(([, h]) => `  run corp-do.js ${h}`).join("\n") + "\n");
    return;
  }
  if (cmd !== "create" && cmd !== "cleanup" && !ns.corporation.hasCorporation()) {
    ns.tprint("\ncorp-do: no corporation yet — run corp-do.js create\n"); return;
  }
  const say = [];
  const ctx = { ns, opts, args, say, cities: Object.values(ns.enums.CityName) };
  try { await COMMANDS[cmd][0](ctx); }
  catch (e) { say.push(`FAILED: ${short(e, 300)}`); }
  ns.tprint(`\n===== corp-do ${cmd}${opts.dry ? " (DRY RUN — nothing changed)" : ""} =====\n` +
    say.map((s) => `  ${s}`).join("\n") + "\n=====");
}

/** Do it, or say what would be done. Returns true if it happened (or would have).
 *
 *  `landed` is for the actions that FAIL SILENTLY on short funds — upgradeOfficeSize,
 *  upgradeWarehouse, purchaseWarehouse and hireAdVert all just `return` without spending
 *  [SRC v3.0.1: Corporation/Actions.ts:398,426,446,454]. For those, "no error" proves nothing, so
 *  the change is re-read and only reported once it's really there. (Found live 2026-09-27:
 *  `office Agriculture 5` printed six successes and grew nothing.) */
function doIt(ctx, desc, fn, landed = null) {
  if (ctx.opts.dry) { ctx.say.push(`would: ${desc}`); return true; }
  try {
    const r = fn();
    if (landed && !landed()) {
      ctx.say.push(`DID NOT HAPPEN: ${desc} — corp funds are $${fmt(ctx.ns, ctx.ns.corporation.getCorporation().funds)}. Stopping.`);
      return false;
    }
    ctx.say.push(desc);
    return r === undefined ? true : r;
  } catch (e) { ctx.say.push(`FAILED ${desc}: ${short(e)}`); return false; }
}

/** DIV|all -> division names, checked against the live corporation. */
function divisionsArg(ctx, arg) {
  const all = ctx.ns.corporation.getCorporation().divisions;
  if (!arg) throw new Error(`name a division (${all.join(", ") || "none yet"}) or "all"`);
  if (sameName(arg, "all")) return all;
  const hit = all.find((d) => sameName(d, arg));
  if (!hit) throw new Error(`no division "${arg}" — have: ${all.join(", ") || "(none)"}`);
  return [hit];
}

// =============================== BUILD ======================================

function cmdCreate(ctx) {
  const { ns, opts, say } = ctx;
  if (ns.corporation.hasCorporation()) { say.push("a corporation already exists."); return; }
  // Seed money: free, but the government keeps 500m shares forever, and it only exists in BN3.
  // Self-funding costs $150b of YOUR money for 100% ownership — which is what makes share sales
  // and dividends worth having later. With a gang paying for it, self-fund is the default.
  const selfFund = !opts.seed;
  const check = ns.corporation.canCreateCorporation(selfFund);   // a reason STRING, not a bool
  if (check !== "Success") { say.push(`cannot create (${check}).`); return; }
  const name = opts.name || CORP_NAME;
  // TRAP: createCorporation's selfFund defaults to TRUE — always pass it explicitly.
  if (doIt(ctx, `created "${name}" (${selfFund ? "self-funded, $150b from your wallet" : "seed money"})`,
    () => ns.corporation.createCorporation(name, selfFund))) {
    say.push("next:  run corp-do.js expand Agriculture   then   run corp.js");
  }
}

function cmdExpand(ctx) {
  const { ns, args, opts, say, cities } = ctx;
  const industry = args[0];
  const known = ns.corporation.getConstants().industryNames;
  const ind = known.find((i) => sameName(i, industry || ""));
  if (!ind) throw new Error(`name an industry: ${known.join(", ")}`);
  const name = opts.name || args[1] || ind;
  const corp = ns.corporation.getCorporation();
  // THE WHOLE BILL, up front. The first live run showed only the $10b division price, then ran
  // out of funds two offices in (2026-09-28): a division is division + 5 offices + 5 warehouses
  // (Sector-12's pair comes free), and those are ~80% of it.
  const K = ns.corporation.getConstants();
  const exists = corp.divisions.includes(name);
  const haveCities = exists ? ns.corporation.getDivision(name).cities : ["Sector-12"];
  const haveWh = exists ? haveCities.filter((c) => ns.corporation.hasWarehouse(name, c)).length : 1;
  const bill = (exists ? 0 : ns.corporation.getIndustryData(ind).startingCost) +
    (cities.length - haveCities.length) * K.officeInitialCost +
    (cities.length - haveWh) * K.warehouseInitialCost;
  if (bill > 0) {
    say.push(`total to finish "${name}": $${fmt(ns, bill)} · corp funds $${fmt(ns, corp.funds)}` +
      (bill > corp.funds ? " — NOT ENOUGH: it will stop partway; re-run later to finish (done parts are skipped)." +
        " To let funds build up: restart corp.js with --reserve " + fmt(ns, Math.ceil(bill / 1e9) * 1e9) : ""));
  }
  if (!exists) {
    const cost = ns.corporation.getIndustryData(ind).startingCost;
    if (!doIt(ctx, `expanded into ${ind} as "${name}" ($${fmt(ns, cost)}, Sector-12 office + warehouse free)`,
      () => ns.corporation.expandIndustry(ind, name))) return;
    if (opts.dry) { say.push("(dry: the division doesn't exist yet, so cities/warehouses aren't checked)"); return; }
  } else say.push(`"${name}" exists.`);

  const have = new Set(ns.corporation.getDivision(name).cities);
  for (const city of cities) {
    if (have.has(city)) continue;
    // expandCity throws on short funds — stop there rather than failing five times.
    if (!doIt(ctx, `office in ${city}`, () => ns.corporation.expandCity(name, city))) return;
  }
  for (const city of ns.corporation.getDivision(name).cities) {
    if (ns.corporation.hasWarehouse(name, city)) continue;
    // purchaseWarehouse fails SILENTLY on short funds (Actions.ts:425) — verify it landed.
    if (!doIt(ctx, `warehouse in ${city}`, () => ns.corporation.purchaseWarehouse(name, city),
      () => ns.corporation.hasWarehouse(name, city))) return;
  }
  say.push(`"${name}" is in all ${cities.length} cities with warehouses. corp.js staffs it and places sell orders.`);
  say.push(`only here for the valuation bonus? run corp-do.js filler ${name}   (so corp.js stops spending on it)`);
}

function cmdOffice(ctx) {
  const { ns, args, say } = ctx;
  const size = Number(args[1]);
  if (!Number.isInteger(size) || size < 3) throw new Error("usage: office DIV|all SIZE  (SIZE >= 3)");
  for (const div of divisionsArg(ctx, args[0])) {
    for (const city of ns.corporation.getDivision(div).cities) {
      const o = ns.corporation.getOffice(div, city);
      if (o.size < size) {
        const cost = ns.corporation.getOfficeSizeUpgradeCost(div, city, size - o.size);
        if (!doIt(ctx, `${div}/${city} office ${o.size} -> ${size} ($${fmt(ns, cost)})`,
          () => ns.corporation.upgradeOfficeSize(div, city, size - o.size),
          () => ns.corporation.getOffice(div, city).size >= size)) return;
      }
      if (!ctx.opts.dry) {
        const hired = fillOffice(ns, div, city, ns.corporation.getOffice(div, city));
        if (hired) say.push(`${div}/${city} hired ${hired} (corp.js assigns their jobs next cycle)`);
      }
    }
  }
}

function cmdWarehouse(ctx) {
  const { ns, args, opts, say } = ctx;
  const level = Number(args[1]) || 0, add = Number(opts.add) || 0;
  if (!level === !add) throw new Error("usage: warehouse DIV|all LEVEL   or   warehouse DIV|all --add N");
  for (const div of divisionsArg(ctx, args[0])) {
    for (const city of ns.corporation.getDivision(div).cities) {
      if (!ns.corporation.hasWarehouse(div, city)) continue;
      const w = ns.corporation.getWarehouse(div, city);
      const n = add || level - w.level;
      if (n <= 0) continue;
      const cost = ns.corporation.getUpgradeWarehouseCost(div, city, n);
      if (!doIt(ctx, `${div}/${city} warehouse L${w.level} -> L${w.level + n} ($${fmt(ns, cost)})`,
        () => ns.corporation.upgradeWarehouse(div, city, n),
        () => ns.corporation.getWarehouse(div, city).level > w.level)) return;
    }
  }
  say.push("boost materials are a SHARE of the warehouse: corp.js --auto-boost refills to match.");
}

function cmdJobs(ctx) {
  const { ns, args, say } = ctx;
  const policy = String(args[1] || "").toLowerCase();
  if (!validJobPolicy(policy)) throw new Error(`usage: jobs DIV|all POLICY — ${JOB_PRESETS.join(", ")}, or "ops=2,eng=1,rnd=1"`);
  const divs = divisionsArg(ctx, args[0]);
  const cfg = readConfig(ns);
  for (const div of divs) {
    if (policy === "auto") delete cfg.jobs[div]; else cfg.jobs[div] = policy;
    const d = ns.corporation.getDivision(div);
    for (const city of d.cities) {
      if (policy === "hold") break;
      const o = ns.corporation.getOffice(div, city);
      const p = policy === "auto" ? autoJobPolicy({ makesProducts: d.makesProducts, exportsAllOutput: false }) : policy;
      const target = mixForJobs(p, o.numEmployees);
      if (!target) { say.push(`${div}/${city}: "${p}" doesn't fit ${o.numEmployees} staff — skipped`); continue; }
      doIt(ctx, `${div}/${city} -> ${Object.entries(target).map(([r, n]) => `${n} ${r}`).join(", ")}`, () => {
        const err = assignJobs(ns, div, city, target);
        if (err) throw new Error(err);
      });
    }
  }
  if (!ctx.opts.dry) writeConfig(ns, cfg);
  say.push(`recorded in corp-config.txt — corp.js holds ${divs.join(", ")} at "${policy}" from now on. ` +
    `Changes land at the next START (~10s).`);
}

function cmdExport(ctx) {
  const { ns, args, opts, say, cities } = ctx;
  if (opts.show || args[0] === "show") return showExports(ctx);
  let routes;
  if (sameName(args[0] || "", "agri-chem")) {
    routes = [
      { from: opts.agri, material: "Plants", to: opts.chem, toCity: null },
      { from: opts.chem, material: "Chemicals", to: opts.agri, toCity: null },
    ];
  } else {
    const parsed = parseRoutes(args.join(" "));
    if (parsed.error) throw new Error(`${parsed.error}. e.g. export "Agriculture/Plants > Tobacco"`);
    routes = parsed.routes;
  }
  for (const r of routes) {
    for (const city of cities) {
      const toCity = r.toCity || city;
      let src;
      try { src = ns.corporation.getMaterial(r.from, city, r.material); } catch (e) { continue; }   // no warehouse here
      const existing = (src.exports || []).find((x) => x.division === r.to && x.city === toCity);
      const where = `${r.from}/${city} ${r.material} -> ${r.to}/${toCity}`;
      if (opts.clear) {
        if (existing) doIt(ctx, `cancelled ${where}`, () => ns.corporation.cancelExportMaterial(r.from, city, r.to, toCity, r.material));
        continue;
      }
      if (existing && existing.amount === EXPORT_AMOUNT) continue;
      // exportMaterial THROWS on a duplicate route, so replace rather than stack.
      if (existing) doIt(ctx, `replaced old amount on ${where}`, () => ns.corporation.cancelExportMaterial(r.from, city, r.to, toCity, r.material));
      doIt(ctx, `export ${where}`, () => ns.corporation.exportMaterial(r.from, city, r.to, toCity, r.material, EXPORT_AMOUNT));
    }
  }
  if (!opts.clear) say.push(`amount "${EXPORT_AMOUNT}" — ships what the far end burns, and starts from cold.`);
}

function showExports(ctx) {
  const { ns, say, cities } = ctx;
  const mats = ns.corporation.getConstants().materialNames;
  let n = 0;
  for (const div of ns.corporation.getCorporation().divisions) {
    for (const city of cities) {
      for (const mat of mats) {
        let m;
        try { m = ns.corporation.getMaterial(div, city, mat); } catch (e) { continue; }
        for (const x of m.exports || []) {
          let arrived = "?";
          try { arrived = round(ns.corporation.getMaterial(x.division, x.city, mat).importAmount, 2); } catch (e) { /* gone */ }
          say.push(`${div}/${city} ${mat} -> ${x.division}/${x.city} "${x.amount}" · arrived last cycle ${arrived}`);
          n++;
        }
      }
    }
  }
  if (!n) say.push("no export orders.  run corp-do.js export agri-chem");
}

function cmdSell(ctx) {
  const { ns, args, opts, say } = ctx;
  const [divArg, matsArg] = args;
  const mats = listOf(matsArg);
  if (!mats.length) throw new Error("usage: sell DIV \"Plants,Food\" [--price MP] [--amount MAX] [--clear]");
  const boost = ns.corporation.getConstants().boostMaterials || [];
  const price = String(opts.price), amount = opts.clear ? "0" : String(opts.amount);
  if (price === "0" && mats.some((m) => boost.includes(m))) {
    throw new Error(`refusing to DUMP boost material (${mats.filter((m) => boost.includes(m)).join(", ")}) at price 0. ` +
      `Sell the excess at MP instead: corp.js --auto-boost --trim`);
  }
  for (const div of divisionsArg(ctx, divArg)) {
    for (const city of ns.corporation.getDivision(div).cities) {
      for (const mat of mats) {
        doIt(ctx, `${div}/${city} ${mat}: ${amount} @ ${price}`, () => ns.corporation.sellMaterial(div, city, mat, amount, price));
      }
    }
  }
  if (price === "0") say.push("DUMP is on. Restore after ONE cycle:  run corp-do.js sell DIV MATS   (corp.js won't — it only fills EMPTY orders)");
}

function cmdUnlock(ctx) {
  const { ns, args, say } = ctx;
  const names = ns.corporation.getConstants().unlockNames;
  const want = args.join(" ");
  if (!want) {
    for (const u of names) {
      const owned = ns.corporation.hasUnlock(u);
      say.push(`${owned ? "OWNED  " : "       "}${u}${owned ? "" : `  $${fmt(ns, ns.corporation.getUnlockCost(u))}`}`);
    }
    return;
  }
  const hit = names.find((u) => sameName(u, want));
  if (!hit) throw new Error(`no unlock "${want}" — ${names.join(", ")}`);
  if (ns.corporation.hasUnlock(hit)) { say.push(`already own ${hit}.`); return; }
  doIt(ctx, `bought ${hit} ($${fmt(ns, ns.corporation.getUnlockCost(hit))})`, () => ns.corporation.purchaseUnlock(hit));
  if (sameName(hit, "Smart Supply")) say.push("corp.js switches it on in every warehouse next cycle.");
}

function cmdUpgrade(ctx) {
  const { ns, args } = ctx;
  const names = ns.corporation.getConstants().upgradeNames;
  // "upgrade Smart Storage 5": a trailing integer is the count, everything before it the name.
  const trailing = args.length > 1 && /^\d+$/.test(args[args.length - 1]);
  const count = trailing ? Math.max(1, Number(args[args.length - 1])) : 1;
  const want = (trailing ? args.slice(0, -1) : args).join(" ");
  const hit = names.find((u) => sameName(u, want));
  if (!hit) throw new Error(`usage: upgrade NAME [N] — ${names.join(", ")}`);
  for (let i = 0; i < count; i++) {
    const cost = ns.corporation.getUpgradeLevelCost(hit);
    if (!doIt(ctx, `${hit} -> L${ns.corporation.getUpgradeLevel(hit) + 1} ($${fmt(ns, cost)})`,
      () => ns.corporation.levelUpgrade(hit))) return;
    if (ctx.opts.dry) return;
  }
}

function cmdAdvert(ctx) {
  const { ns, args } = ctx;
  const [div] = divisionsArg(ctx, args[0]);
  const count = Math.max(1, Number(args[1]) || 1);
  for (let i = 0; i < count; i++) {
    const cost = ns.corporation.getHireAdVertCost(div);
    const had = ns.corporation.getHireAdVertCount(div);
    if (!doIt(ctx, `${div} AdVert #${had + 1} ($${fmt(ns, cost)})`,
      () => ns.corporation.hireAdVert(div),
      () => ns.corporation.getHireAdVertCount(div) > had)) return;
    if (ctx.opts.dry) return;
  }
}

function cmdResearch(ctx) {
  const { ns, args, say } = ctx;
  const [div] = divisionsArg(ctx, args[0]);
  const names = ns.corporation.getConstants().researchNames;
  const want = args.slice(1).join(" ");
  const rp = ns.corporation.getDivision(div).researchPoints;
  if (!want) {
    say.push(`${div}: ${fmt(ns, rp)} RP`);
    for (const r of names) {
      let owned;
      try { owned = ns.corporation.hasResearched(div, r); } catch (e) { continue; }
      say.push(`${owned ? "OWNED  " : "       "}${r}${owned ? "" : `  ${fmt(ns, ns.corporation.getResearchCost(div, r))} RP`}`);
    }
    return;
  }
  const hit = names.find((r) => sameName(r, want));
  if (!hit) throw new Error(`no research "${want}"`);
  const cost = ns.corporation.getResearchCost(div, hit);
  say.push(`RP feeds product quality and is banked when a product finishes — spending ${fmt(ns, cost)} of ${fmt(ns, rp)}.`);
  doIt(ctx, `${div}: researched ${hit}`, () => ns.corporation.research(div, hit));
}

// =============================== MONEY OUT ==================================

function cmdOffer(ctx) {
  const { ns, say } = ctx;
  const c = ns.corporation.getCorporation();
  if (c.public) { say.push("public — investment offers are over for good. Money out: sellshares, dividend."); return; }
  const o = ns.corporation.getInvestmentOffer();
  if (!o.funds) { say.push(`no offer (round ${o.round} — all four taken?)`); return; }
  say.push(`round ${o.round}/4: $${fmt(ns, o.funds)} for ${fmt(ns, o.shares)} shares ` +
    `(${pct(o.shares / c.totalShares)} of the company; you own ${pct(c.numShares / c.totalShares)} now)`);
  say.push(`valuation $${fmt(ns, c.valuation)} · funds $${fmt(ns, c.funds)}. Offer = valuation x share x round multiplier, ` +
    `so growing the valuation first is free money.`);
  say.push("take it:  run corp-do.js accept --yes");
}

function cmdAccept(ctx) {
  const { ns, opts, say } = ctx;
  const o = ns.corporation.getInvestmentOffer();
  if (!o.funds) { say.push("no offer on the table."); return; }
  if (!opts.yes) { say.push(`would accept round ${o.round}: $${fmt(ns, o.funds)} for ${fmt(ns, o.shares)} shares. ONE-WAY. Add --yes.`); return; }
  doIt(ctx, `ACCEPTED round ${o.round}: +$${fmt(ns, o.funds)}`, () => ns.corporation.acceptInvestmentOffer());
}

function cmdPublic(ctx) {
  const { ns, args, opts, say } = ctx;
  const c = ns.corporation.getCorporation();
  if (c.public) { say.push("already public."); return; }
  const shares = Math.floor(Number(args[0]) || 0);
  say.push(`going public issues ${fmt(ns, shares)} new shares for cash, and ENDS investment offers forever ` +
    `(round ${ns.corporation.getInvestmentOffer().round} would have been next). It is what unlocks sellshares and dividends.`);
  if (!opts.yes) { say.push("ONE-WAY. Re-run with --yes. (0 shares is a valid choice: public, nothing diluted.)"); return; }
  doIt(ctx, `WENT PUBLIC, issued ${fmt(ns, shares)} shares`, () => ns.corporation.goPublic(shares));
}

/** Plan the exit: what going public and selling at once would pay, at today's valuation.
 *
 *  Two facts from the source shape this [v3.0.1]:
 *   - goPublic sets the share price to the target for the CURRENT valuation (Actions.ts:144), so
 *     a sale in the same minute is priced off the private valuation;
 *   - but a public corp is then valued by a harsher formula — funds + profit x 85k, against
 *     10b + funds/3 + profit x 315k while private (Corporation.ts:198-222) — and the price drifts
 *     toward the new, lower target by up to 1% a cycle. So the first sale is the big one, and the
 *     hourly ones after it are priced off a smaller number. */
function cmdIpo(ctx) {
  const { ns, opts, say } = ctx;
  const c = ns.corporation.getCorporation();
  const goal = parseMoney(String(opts.goal));
  const base = { ownedShares: c.numShares, totalShares: c.totalShares, valuation: c.valuation };
  const p0 = c.public ? c.sharePrice : ipoPrice(base);
  say.push(`valuation $${fmt(ns, c.valuation)} (${c.public ? "public" : "private"}) · you own ${fmt(ns, c.numShares)} of ` +
    `${fmt(ns, c.totalShares)} (${pct(c.numShares / c.totalShares)}) · ${c.public ? "share price" : "price at IPO (0 new shares)"} $${fmt(ns, p0)}`);
  let half = 0;
  for (const f of [0.1, 0.25, 0.5, 0.75]) {
    const n = Math.floor(c.numShares * f / 1e6) * 1e6;
    const r = shareSale({ ...base, numShares: n, sharePrice: p0 });
    if (f === 0.5) half = r.proceeds;
    say.push(`  sell ${pct(f).padStart(6)} of your shares (${fmt(ns, n)}) -> $${fmt(ns, r.proceeds)}` +
      `   (price ends $${fmt(ns, r.endPrice)}, you keep ${pct((c.numShares - n) / c.totalShares)} of the company)`);
  }
  // Every price is proportional to valuation, so proceeds scale linearly with it.
  if (goal > 0 && half > 0) {
    say.push(`to raise $${fmt(ns, goal)} by selling HALF your shares at once, the valuation needs to be ` +
      `~$${fmt(ns, c.valuation * goal / half)} (${fmt(ns, goal / half)}x today).`);
  }
  if (!c.public) {
    const P = Math.max(0, c.revenue - c.expenses), F = c.funds;
    const ratio = (F + P * 85e3) / (10e9 + F / 3 + P * 315e3);
    say.push(`after going public the valuation re-bases toward ~${pct(ratio)} of today's (profit x 85k instead of x 315k),`);
    say.push(`and the price follows by up to 1% a cycle — so the sale made the same minute you go public is the big one.`);
    // The valuation is the mean of the last 10 cycles (valuationLength), and a cycle whose assets
    // FELL — offices, upgrades, AdVert and research are not assets — records no profit term at all:
    // just 10b + funds/3 [Corporation.ts:214-217]. corp.js --auto spends half the funds a pass.
    say.push(`BEFORE SELLING: freeze spending for 10+ cycles, or a big purchase in the last 10 drags the averaged`);
    say.push(`valuation (and the sale price) down:  kill corp.js ; run corp.js --reserve ${fmt(ns, Math.ceil(c.funds * 2 / 1e12) * 1e12)}`);
    say.push(`nothing changed. When ready: run corp-do.js public 0 --yes, then run corp-do.js sellshares 50% --yes at once.`);
  }
}

/** The BN10 money tap. Dividends are paid as payout^(1 - tribute), and tribute is
 *  1.15 - CorporationSoftcap [SRC: Corporation.ts:54,195] — BN10's 0.9 softcap makes that ^0.75.
 *  A share sale is paid at share price, which tracks valuation, and has no such exponent. */
function cmdSellShares(ctx) {
  const { ns, args, opts, say } = ctx;
  const c = ns.corporation.getCorporation();
  if (!c.public) { say.push("not public — shares can't be sold until you go public (corp-do.js public)."); return; }
  const raw = String(args[0] || "");
  const n = raw.endsWith("%") ? Math.floor(c.numShares * Number(raw.slice(0, -1)) / 100) : Math.floor(parseMoney(raw));
  if (!(n > 0) || n >= c.numShares) throw new Error(`usage: sellshares N|PCT%  (you hold ${fmt(ns, c.numShares)}; can't sell all)`);
  const cd = c.shareSaleCooldown;
  const est = shareSale({ numShares: n, sharePrice: c.sharePrice, ownedShares: c.numShares,
    totalShares: c.totalShares, valuation: c.valuation });
  say.push(`you hold ${fmt(ns, c.numShares)} of ${fmt(ns, c.totalShares)} · share price $${fmt(ns, c.sharePrice)} · ` +
    `${fmt(ns, n)} shares -> ~$${fmt(ns, est.proceeds)} (the price walks down 0.5% per 1m sold, to ~$${fmt(ns, est.endPrice)})` +
    (cd ? ` · COOLDOWN ${Math.ceil(cd / 5)}s left` : ""));
  if (!opts.yes) { say.push("add --yes to sell. Selling lowers your ownership, and with it share price and future dividends."); return; }
  doIt(ctx, `sold ${fmt(ns, n)} shares`, () => {
    const got = ns.corporation.sellShares(n);
    say.push(`+$${fmt(ns, got)} to your wallet`);
  });
}

function cmdDividend(ctx) {
  const { ns, args, say } = ctx;
  const c = ns.corporation.getCorporation();
  const K = ns.corporation.getConstants();
  const rate = Number(args[0]);
  say.push(`public ${c.public ? "yes" : "NO"} · rate ${c.dividendRate} · paying you $${fmt(ns, c.dividendEarnings)}/s · ` +
    `tribute ${round(c.tributeModifier, 2)} (payout^${round(1 - c.tributeModifier, 2)})`);
  if (!c.public) { say.push("a private corporation pays no dividends."); return; }
  if (!(rate >= 0 && rate <= K.dividendMaxRate)) { say.push(`usage: dividend RATE (0..${K.dividendMaxRate})`); return; }
  doIt(ctx, `dividend rate -> ${rate}`, () => ns.corporation.issueDividends(rate));
}

function cmdBribe(ctx) {
  const { ns, args, say } = ctx;
  const [faction, amt] = args;
  const c = ns.corporation.getCorporation();
  const K = ns.corporation.getConstants();
  if (c.valuation < K.bribeThreshold) { say.push(`valuation $${fmt(ns, c.valuation)} < threshold $${fmt(ns, K.bribeThreshold)}`); return; }
  const joined = ns.getPlayer().factions;
  if (!faction || !joined.some((f) => sameName(f, faction))) throw new Error(`usage: bribe FACTION AMOUNT — joined: ${joined.join(", ")}`);
  const amount = parseMoney(amt || "", c.funds);
  if (!(amount > 0 && amount <= c.funds)) throw new Error(`bad amount — funds $${fmt(ns, c.funds)}`);
  doIt(ctx, `bribed ${faction} $${fmt(ns, amount)} = ${fmt(ns, amount / K.bribeAmountPerReputation)} rep`,
    () => ns.corporation.bribe(faction, amount));
}

/** Mark a division as valuation filler. It exists for its offices and warehouses (valuation
 *  x1.008 each), so corp.js must stop pouring boost, AdVert and upgrades into it. */
function cmdFiller(ctx) {
  const { ns, args, opts, say } = ctx;
  const [div] = divisionsArg(ctx, args[0]);
  const cfg = readConfig(ns);
  const list = new Set(cfg.filler || []);
  if (opts.off) list.delete(div); else list.add(div);
  cfg.filler = [...list];
  if (!opts.dry) writeConfig(ns, cfg);
  say.push(opts.off ? `${div} is a real division again — corp.js manages it from the next cycle.`
    : `${div} is now valuation FILLER. corp.js stops managing it next cycle and zeroes its buy orders.\n` +
      `  It still counts: ${ns.corporation.getDivision(div).cities.length} offices + warehouses toward the x1.008-each valuation bonus.`);
  say.push(`fillers: ${cfg.filler.join(", ") || "(none)"}`);
}

// =============================== HOUSEKEEP ==================================

function cmdCleanup(ctx) {
  const { ns, opts, say } = ctx;
  const found = LEGACY.filter((f) => ns.fileExists(f, "home"));
  const running = ns.ps("home").filter((p) => LEGACY.includes(p.filename));
  if (!found.length) { say.push("nothing to clean — no pre-rewrite corp files on home."); return; }
  say.push(`${found.length} pre-rewrite file(s) on home: ${found.join(" ")}`);
  if (running.length) say.push(`RUNNING: ${running.map((p) => `${p.filename} (pid ${p.pid})`).join(", ")} — will be killed first`);
  if (!opts.yes) { say.push("the copies in archive/ are untouched either way. Add --yes to delete these."); return; }
  if (opts.dry) { say.push("would delete them."); return; }
  for (const p of running) ns.kill(p.pid);
  const gone = found.filter((f) => ns.rm(f, "home"));
  say.push(`deleted ${gone.length}.`);
}
