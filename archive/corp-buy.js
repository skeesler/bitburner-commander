/** @param {NS} ns
 *
 *  CORP BUY — set per-second purchase rates for input / boost materials. 31.6GB.
 *
 *      run corp-buy.js [--mix "Water=10,Chemicals=4"] [--division NAME] [--clear] [--dry]
 *      run corp-buy.js --show          # just report what's stored and flowing
 *
 *  buyMaterial sets a PER-SECOND rate, not a one-off purchase. Enter 10 and you get 100 units
 *  per 10-second cycle, every cycle, FOREVER — until you set it back to 0. That is the single
 *  most common way to jam a warehouse, so this script always reports what's stored and offers
 *  --clear as a first-class option.
 *
 *  The per-second path is also the one that can run the corporation into DEBT, and that's fine
 *  and intended in round 1 — unlike bulkPurchase, which demands the full price upfront and is
 *  therefore useless when you're broke.
 *
 *  Agriculture consumes Water 0.5 and Chemicals 0.2 per unit of raw production, so a sane mix
 *  keeps that 5:2 ratio. The default here is deliberately CONSERVATIVE (10/4): a level-1
 *  warehouse holds only ~100-120 units, and inputs that arrive faster than they're consumed
 *  are exactly what causes congestion. Raise it once warehouses are upgraded and you can see
 *  headroom in the --show output.
 *
 *  Getting this rate right, automatically, is what "Smart Supply" does — the $25b unlock we
 *  deliberately skipped to keep round-1 budget. A custom replacement is the next real module;
 *  until then, tune by watching --show.
 *
 *  BOOST MATERIALS (Real Estate, Hardware, Robots, AI Cores) are bought the same way, but they
 *  are a stock-up-once job, not a standing order: set a rate, wait until stored reaches your
 *  target, then --clear. Do it AFTER warehouse upgrades, and remember Real Estate is the
 *  standout for Agriculture (factor 0.72, size 0.005 — enormous multiplier per unit of space).
 *
 *  RAM: buyMaterial (20) + getMaterial (10) + 1.6 base = 31.6GB.
 */

const DIVISION = "Agriculture";
const STATE_FILE = "corp-state.txt";
const MIX = "Water=10,Chemicals=4";   // Agriculture inputs, 5:2, conservative starting rate

export async function main(ns) {
  const opts = ns.flags([
    ["mix", ""], ["show", false], ["clear", false],
    ["division", ""], ["dry", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const division = resolveDivision(ns, opts.division);
  const cities = Object.values(ns.enums.CityName);

  // --show and --clear both need to know which materials to look at; default to the mix's.
  const mix = parseMix(ns, opts.mix || MIX);
  if (!mix) return;
  const names = Object.keys(mix);

  // ---- report mode -------------------------------------------------------
  if (opts.show) {
    const rows = [];
    // productionAmount is SIGNED: negative means the division consumed it (correct for an
    // input), positive means it made it (correct for an output). Only a literal 0 is the
    // congestion signal, and only for a material the division actually produces. This footer
    // used to print unconditionally, which reads as a diagnosis of your corporation and isn't.
    let idle = 0;
    for (const city of cities) {
      const bits = [];
      for (const mat of names) {
        try {
          const m = ns.corporation.getMaterial(division, city, mat);
          if (m.productionAmount === 0) idle++;
          const flow = m.productionAmount < 0 ? `consumed ${num(-m.productionAmount)}/s`
            : m.productionAmount > 0 ? `made ${num(m.productionAmount)}/s`
              : `NOT MOVING`;
          bits.push(`${mat} stored ${num(m.stored)} (buy ${num(m.buyAmount)}/s, ${flow}, ` +
            `sold ${num(m.actualSellAmount)}, qual ${num(m.quality)})`);
        } catch (e) {
          if (/no division named/i.test(String(e))) { abortNoDivision(ns, division); return; }
          bits.push(`${mat} — ${short(String(e))}`);
        }
      }
      rows.push(`  ${city}:\n    ${bits.join("\n    ")}`);
    }
    // --mix picks WHICH materials to report, and defaults to the inputs — so a plain --show
    // cannot tell you anything about your outputs. Say so, because that is exactly the
    // question people run --show to answer.
    const footer = idle
      ? `\n  ${idle} material(s) NOT MOVING. If that persists for several cycles on something\n` +
        `  this division PRODUCES, the warehouse is congested. Check what's filling it first:\n` +
        `      run corp-boost.js                                    # boost material over target?\n` +
        `  If not, dump the output for ONE cycle, then restore pricing:\n` +
        `      run corp-sell.js --materials "NAME" --price 0\n` +
        `      run corp-sell.js\n`
      : `\n  Everything is moving. Showing: ${names.join(", ")} (--mix picks these; it defaults\n` +
        `  to the inputs). For your outputs:  run corp-buy.js --show --mix "Plants=0,Food=0"\n`;
    ns.tprint(`\n===== corp-buy --show: ${division} =====\n${rows.join("\n")}\n${footer}=====`);
    return;
  }

  // ---- set rates ---------------------------------------------------------
  const rates = {};
  for (const mat of names) rates[mat] = opts.clear ? 0 : mix[mat];

  const done = [], failed = [];
  for (const city of cities) {
    for (const mat of names) {
      if (opts.dry) { done.push(`${city}/${mat} -> ${rates[mat]}/s`); continue; }
      try {
        ns.corporation.buyMaterial(division, city, mat, rates[mat]);
        done.push(`${city}/${mat}`);
      } catch (e) {
        const msg = String(e);
        if (/no division named/i.test(msg)) { abortNoDivision(ns, division); return; }
        failed.push(`${city}/${mat} (${short(msg)})`);
      }
    }
  }

  ns.tprint(
    `\n===== corp-buy: ${division} ${opts.dry ? "(DRY RUN)" : ""}=====\n` +
    (opts.clear
      ? `  CLEARED purchase orders for: ${names.join(", ")}\n`
      : `  buying per second: ${names.map((m) => `${m}=${rates[m]}`).join(", ")}\n`) +
    `  set:    ${done.length} order(s) across ${cities.length} cities\n` +
    `  failed: ${failed.length ? failed.join("; ") : "(none)"}\n` +
    (opts.dry ? "  [dry] nothing changed.\n" :
      `\n  Purchases land in the PURCHASE state; production follows in PRODUCTION.\n` +
      `  Check in a couple of cycles:  run corp-buy.js --show\n` +
      `  REMEMBER: this buys forever until you run --clear.\n`) +
    `=====`
  );
}

/** Parse "Water=10,Chemicals=4" (or "Real Estate=30000"). Material names are exact. */
function parseMix(ns, text) {
  const out = {};
  for (const part of String(text).split(",")) {
    const bit = part.trim();
    if (!bit) continue;
    const at = bit.lastIndexOf("=");
    if (at < 1) { ns.tprint(`\nBad mix entry "${bit}" — expected Name=rate.`); return null; }
    const name = bit.slice(0, at).trim();
    const n = Number(bit.slice(at + 1));
    if (!Number.isFinite(n) || n < 0) { ns.tprint(`\nBad rate for "${name}".`); return null; }
    out[name] = n;
  }
  if (!Object.keys(out).length) { ns.tprint("\nEmpty mix."); return null; }
  return out;
}

function abortNoDivision(ns, division) {
  ns.tprint(`\nABORT: no division named "${division}".\n  run corp-status.js\n`);
}

function short(msg) { return msg.replace(/\s+/g, " ").slice(0, 110); }
function num(n) { return Number.isFinite(n) ? (Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(2)) : "?"; }

/** Explicit flag > corp-state.txt > built-in guess. ns.read is 0GB, so this is free. */
function resolveDivision(ns, flagValue) {
  if (flagValue) return flagValue;
  try {
    const raw = ns.read(STATE_FILE);
    if (raw) {
      const st = JSON.parse(raw) || {};
      if (st.roles && st.roles.material) return st.roles.material;
      if (Array.isArray(st.divisions) && st.divisions.length === 1) return st.divisions[0];
    }
  } catch (e) { /* fall through */ }
  return DIVISION;
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-buy.js — per-second purchase rates for inputs and boost materials (31.6GB).\n" +
    "  run corp-buy.js                                Water=10, Chemicals=4 (Agriculture inputs)\n" +
    "  run corp-buy.js --show                         what's stored / flowing / produced\n" +
    "  run corp-buy.js --mix \"Real Estate=200\"        stock a boost material\n" +
    "  run corp-buy.js --mix \"Real Estate=0\" --clear  stop buying it\n" +
    "  run corp-buy.js --clear                        stop buying the default inputs\n" +
    "  Rates are PER SECOND and run forever until cleared. Watch --show for congestion.\n"
  );
}
