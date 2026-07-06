/** @param {NS} ns
 *  Flatten the stock portfolio: sell EVERY open position and exit. One-shot —
 *  it trades nothing, it just gets you to cash. Pair it with killing the trader:
 *
 *      kill stock-trader.js
 *      run liquidate.js
 *
 *  Sells both long and short positions (the trader is long-only, but this stays
 *  correct if you ever hold shorts). Does nothing else in the rig.
 */
export async function main(ns) {
  if (typeof ns.stock.hasTixApiAccess !== "function" || !ns.stock.hasTixApiAccess()) {
    ns.tprint("ERROR: no TIX API access — nothing to liquidate.");
    return;
  }

  let sold = 0, proceeds = 0;
  for (const sym of ns.stock.getSymbols()) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym);
    if (longShares > 0)  { proceeds += ns.stock.getSaleGain(sym, longShares, "L");   ns.stock.sellStock(sym, longShares);       sold++; }
    if (shortShares > 0) { proceeds += ns.stock.getSaleGain(sym, shortShares, "S"); ns.stock.sellShort(sym, shortShares);      sold++; }
  }

  ns.tprint(sold
    ? `Sold ${sold} position(s) for $${fmt(proceeds)}. Flat.`
    : "No open positions — already flat.");
}

/** Short currency-ish formatting (matches stock-trader.js). */
function fmt(n) {
  if (!Number.isFinite(n)) return "0";
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  for (const [v, s] of [[1e12, "t"], [1e9, "b"], [1e6, "m"], [1e3, "k"]]) if (a >= v) return sign + (a / v).toFixed(2) + s;
  return n.toFixed(0);
}
