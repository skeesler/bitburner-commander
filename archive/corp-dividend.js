/** @param {NS} ns
 *
 *  CORP DIVIDEND — the tap that moves corporation profit into your wallet. 31.6GB.
 *
 *      run corp-dividend.js               # what you'd earn, at what rate. Changes nothing.
 *      run corp-dividend.js --rate 0.5 --go
 *      run corp-dividend.js --rate 0 --go # stop paying out, put it all back into the corp
 *
 *  "MY CORPORATION IS PROFITABLE BUT MY MONEY ISN'T GOING UP." That is not a bug and it is the
 *  most common confusion about this whole system: corporation funds are a completely separate
 *  pot from your wallet (bn3-runbook.md, Loop 3). This is one of the two taps between them —
 *  the other is sellShares, which is a lump sum on a 1-hour cooldown.
 *
 *  YOU MUST GO PUBLIC FIRST, AND THAT PART IS NOT SCRIPTED. goPublic() is a one-way lever: a
 *  public corporation can never take an investment offer again, and there are only four of
 *  those in the life of a corporation. So it stays a button in the Investors tab, the same way
 *  ascend.js holds the install behind --install and corp-product.js holds rotation behind
 *  --rotate. This script tells you plainly when that is what's blocking it.
 *
 *  THE RATE IS NOT A ONE-WAY LEVER, WHICH IS WHY IT IS SAFE TO SCRIPT. Unlike going public,
 *  a dividend rate can be raised, lowered or set back to zero every cycle. It is a dial, and the
 *  trade it controls is simple: profit paid out to you is profit NOT compounding inside the
 *  corporation, where corp-upgrade.js and corp-advert.js would be spending it.
 *
 *  IN BN3 THE PENALTY IS THE MINIMUM. TributeModifier = 1.15 - CorporationSoftcap and BN3's
 *  softcap is 1, so the tribute lands at 0.15 and payouts come out as (...)^0.85 — the gentlest
 *  it ever gets. This script does not model that: getCorporation reports dividendEarnings and
 *  tributeModifier directly, so the number you see is the game's own, not an estimate of it.
 *  Before you set a rate there is nothing to report but the rate itself, because the game does
 *  not compute the counterfactual.
 *
 *  WORTH KNOWING BEFORE YOU TURN IT UP: your share of the payout is numShares / totalShares.
 *  Every investment round you accepted sold part of that permanently, so the dividend tap and
 *  the investment offers are the same decision seen from two ends.
 *
 *  RAM: issueDividends (20) + getCorporation (10) + 1.6 base = 31.6GB.
 */

export async function main(ns) {
  ns.disableLog("ALL");
  const opts = ns.flags([
    ["rate", -1], ["go", false], ["quiet", false], ["help", false],
  ]);
  if (opts.help) { printHelp(ns); return; }

  const say = opts.quiet ? (msg) => ns.print(msg) : (msg) => ns.tprint(msg);

  let info;
  try { info = ns.corporation.getCorporation(); }
  catch (e) { ns.tprint(`\ncorp-dividend: no corporation (${short(e)}).\n`); return; }

  let maxRate = 1;
  try { const K = ns.corporation.getConstants(); if (Number.isFinite(K.dividendMaxRate)) maxRate = K.dividendMaxRate; }
  catch (e) { /* 1 is the v3.0.1 value */ }

  const profit = info.revenue - info.expenses;
  const ownership = info.totalShares ? info.numShares / info.totalShares : 0;
  const head =
    `\n===== corp-dividend =====\n` +
    `  public      ${info.public ? "YES" : "NO"}\n` +
    `  profit      $${fmt(ns, profit)}/s (revenue $${fmt(ns, info.revenue)} - expenses $${fmt(ns, info.expenses)})\n` +
    `  your shares ${fmt(ns, info.numShares)} of ${fmt(ns, info.totalShares)} (${(100 * ownership).toFixed(1)}%)\n` +
    `  rate        ${info.dividendRate || 0} (max ${maxRate})\n` +
    `  paying you  $${fmt(ns, info.dividendEarnings || 0)}/s` +
    (Number.isFinite(info.tributeModifier) ? ` · tribute x${info.tributeModifier}` : "") + `\n`;

  if (!info.public) {
    say(head +
      `\n  BLOCKED: a private corporation pays no dividends, so this rate would do nothing.\n` +
      `  Go public by hand first — Investors tab in the corporation UI.\n` +
      `  That is deliberate and permanent: a public corporation can NEVER take an investment\n` +
      `  offer again, so make sure you are done with the four rounds before you press it.\n` +
      `  While you are still private, corporation funds are still useful two ways:\n` +
      `    run corp-upgrade.js --go      turn funds back into revenue\n` +
      `    run corp-bribe.js             turn funds into faction reputation (needs $100t valuation)\n=====`);
    return;
  }

  const rate = Number(opts.rate);
  if (!(rate >= 0)) {
    say(head +
      `\n  Pass --rate to change it, e.g. run corp-dividend.js --rate 0.5 --go\n` +
      `  Every point you pay out is a point not compounding inside the corporation, where\n` +
      `  corp-upgrade.js and corp-advert.js would be spending it. The dial is free to move again.\n=====`);
    return;
  }
  if (rate > maxRate) { say(head + `\n  --rate ${rate} is above the maximum of ${maxRate}. Nothing changed.\n=====`); return; }

  if (!opts.go) {
    say(head + `\n  would set the dividend rate to ${rate}` +
      (profit > 0 ? ` — about $${fmt(ns, profit * rate * ownership)}/s of profit heading your way\n` +
                    `  before the x${info.tributeModifier} tribute, which the game applies on top.\n` : `\n`) +
      `  [report] nothing changed. Add --go.\n=====`);
    return;
  }

  try { ns.corporation.issueDividends(rate); }
  catch (e) { say(head + `\n  the game refused: ${short(e)}\n=====`); return; }

  say(head + `\n  dividend rate set to ${rate}. The first payout lands at the next cycle (~10s);\n` +
    `  re-run this to see the game's own dividendEarnings figure once it has.\n` +
    `  Then the outer loop is the one ascend.js already automates:\n` +
    `    run ascend.js                       plan the augmentation purchase\n` +
    `    run ascend.js --install --cb boot.js  install, and bring the stack back up\n=====`);
}

function short(msg) { return String(msg).replace(/\s+/g, " ").slice(0, 140); }

// ns.formatNumber was removed in 3.0.0; ns.format.number is the current name (0GB).
function fmt(ns, n) {
  if (!Number.isFinite(n)) return "?";
  try { return ns.format.number(n, 3); } catch (e) { return String(Math.round(n)); }
}

function printHelp(ns) {
  ns.tprint(
    "\ncorp-dividend.js — pay corporation profit into your wallet (31.6GB).\n" +
    "  run corp-dividend.js               current rate, ownership, what you're earning\n" +
    "  run corp-dividend.js --rate 0.5    preview\n" +
    "  run corp-dividend.js --rate 0.5 --go\n" +
    "  run corp-dividend.js --rate 0 --go stop paying out, compound inside the corp instead\n" +
    "  Requires going public first, which is a one-way lever and stays a manual button.\n" +
    "  The rate itself is a dial you can move as often as you like.\n"
  );
}
