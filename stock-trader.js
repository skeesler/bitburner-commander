/** @param {NS} ns
 *
 *  STOCK TRADER — 4S long-only. Puts spare cash into the stocks most likely to
 *  rise (per 4S forecast) and sells the instant their forecast flips. With 4S
 *  market data this is about as close to free money as the game offers.
 *
 *      run stock-trader.js [keepLiquid]
 *
 *  keepLiquid = dollars to ALWAYS leave uninvested, so the commander still has
 *  cash to buy/upgrade servers. Default 0 (invest all spare). Keep $50b:
 *      run stock-trader.js 50e9
 *
 *  Requires the TIX API + 4S Market Data TIX API (the "full API + data access"
 *  from the World Stock Exchange). Long-only: safe, and works in any game.
 */

const BUY_THRESH   = 0.60;  // open/add when a stock's forecast is above this
const SELL_THRESH  = 0.50;  // sell when its forecast falls below this (the edge is gone)
const MIN_POSITION = 5e6;   // skip positions smaller than this — $100k commission each way would eat them
const COMMISSION   = 1e5;   // per transaction
const STATUS_EVERY = 5;     // print a status line every N market ticks

export async function main(ns) {
  ns.disableLog("ALL");
  const keepLiquid = Number(ns.args[0]) || 0;

  if (!has(ns, "hasTixApiAccess") || !ns.stock.hasTixApiAccess()) { ns.tprint("ERROR: no TIX API access."); return; }
  if (!has(ns, "has4SDataTixApi") || !ns.stock.has4SDataTixApi()) { ns.tprint("ERROR: need 4S Market Data TIX API (forecast access)."); return; }

  ns.ui.openTail();
  ns.print(`Stock trader online (4S long-only). Keeping $${fmt(keepLiquid)} liquid.`);

  const symbols = ns.stock.getSymbols();
  let startWorth = null, startT = 0, tick = 0;

  while (true) {
    // 0) Honor the keepLiquid reserve. If liquid cash has fallen below it — because
    //    you RAISED keepLiquid, or spent cash elsewhere — sell the weakest-forecast
    //    positions (keeping the strong ones) until it's topped back up. This makes
    //    keepLiquid a real guarantee, not just a "don't invest below this" cap.
    let deficit = keepLiquid - ns.getServerMoneyAvailable("home");
    if (deficit > 0) {
      const held = symbols
        .map(sym => ({ sym, shares: ns.stock.getPosition(sym)[0], fc: ns.stock.getForecast(sym) }))
        .filter(x => x.shares > 0)
        .sort((a, b) => a.fc - b.fc);   // weakest forecast first
      for (const h of held) {
        if (deficit <= 0) break;
        deficit -= ns.stock.getSaleGain(h.sym, h.shares, "Long");
        ns.stock.sellStock(h.sym, h.shares);
      }
    }

    // 1) SELL any long whose forecast has flipped below SELL_THRESH.
    for (const sym of symbols) {
      const [shares] = ns.stock.getPosition(sym);
      if (shares > 0 && ns.stock.getForecast(sym) < SELL_THRESH) ns.stock.sellStock(sym, shares);
    }

    // 2) BUY: pour spare cash into the strongest forecasts, best first.
    const candidates = symbols
      .map(sym => ({ sym, fc: ns.stock.getForecast(sym) }))
      .filter(x => x.fc > BUY_THRESH)
      .sort((a, b) => b.fc - a.fc);

    for (const { sym } of candidates) {
      const spendable = ns.getServerMoneyAvailable("home") - keepLiquid;
      if (spendable < MIN_POSITION + COMMISSION) break;      // nothing meaningful left to invest
      const [held] = ns.stock.getPosition(sym);
      const room = ns.stock.getMaxShares(sym) - held;
      if (room <= 0) continue;                               // already maxed on this one
      const ask = ns.stock.getAskPrice(sym);
      const shares = Math.min(room, Math.floor((spendable - COMMISSION) / ask));
      if (shares * ask < MIN_POSITION) continue;             // too small to be worth the commission
      ns.stock.buyStock(sym, shares);
    }

    // 3) Status: this-run P&L (realized + unrealized), avg rate, portfolio, positions.
    const now = Date.now();
    if (startWorth === null) { startWorth = netWorth(ns, symbols); startT = now; }
    if (tick % STATUS_EVERY === 0) printStatus(ns, symbols, startWorth, startT);
    tick++;

    // Wait for the next market tick (falls back to a ~6s sleep if unavailable).
    if (has(ns, "nextUpdate")) await ns.stock.nextUpdate();
    else await ns.sleep(6000);
  }
}

/** true if ns.stock has a callable method by that name (version-robust). */
function has(ns, name) { return typeof ns.stock[name] === "function"; }

/** Net cash flow from stocks so far (negative while holding — buys are cash out). */
function stockCashFlow(ns) {
  try { return ns.getMoneySources().sinceInstall.stock; } catch { return 0; }
}

/** Liquidation value of all current long holdings (at bid price). */
function portfolioValue(ns, symbols) {
  let v = 0;
  for (const sym of symbols) {
    const [shares] = ns.stock.getPosition(sym);
    if (shares > 0) v += shares * ns.stock.getBidPrice(sym);
  }
  return v;
}

/** True stock net worth = cash already realized + value of current holdings. */
function netWorth(ns, symbols) { return stockCashFlow(ns) + portfolioValue(ns, symbols); }

function printStatus(ns, symbols, startWorth, startT) {
  const pl = netWorth(ns, symbols) - startWorth;             // profit since this run started
  const rate = pl / Math.max(1, (Date.now() - startT) / 1000);
  const value = portfolioValue(ns, symbols);
  let positions = 0, best = null;
  for (const sym of symbols) {
    const [shares] = ns.stock.getPosition(sym);
    if (shares > 0) {
      positions++;
      const fc = ns.stock.getForecast(sym);
      if (!best || fc > best.fc) best = { sym, fc };
    }
  }
  const bestStr = best ? `${best.sym} f=${best.fc.toFixed(2)}` : "—";
  ns.print(`stocks: $${fmt(pl)} run (~$${fmt(rate)}/s) | $${fmt(value)} held in ${positions} | strongest ${bestStr}`);
}

/** Short currency-ish formatting, handles negatives (P&L dips negative while holding). */
function fmt(n) {
  if (!Number.isFinite(n)) return "0";
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  for (const [v, s] of [[1e12, "t"], [1e9, "b"], [1e6, "m"], [1e3, "k"]]) if (a >= v) return sign + (a / v).toFixed(2) + s;
  return n.toFixed(0);
}
