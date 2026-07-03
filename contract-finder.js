/** @param {NS} ns
 *  Usage: run contract-finder.js [--auto-solve] [--quiet]
 *
 *  Scans every reachable server for Coding Contract (.cct) files.
 *  Without --auto-solve: just lists what it finds (host, file, type, tries left).
 *  With --auto-solve: attempts to solve and submit every contract type it
 *  has a solver for. Types it doesn't recognize are left alone (never
 *  guesses blind — a wrong guess burns a try, so unknown types are only
 *  ever reported, never attempted).
 *  With --quiet: print only real solves/failures — used by commander.js so it
 *  can auto-solve in the background without spamming the terminal.
 *
 *  Covers: Find Largest Prime Factor, Subarray with Maximum Sum,
 *  Total Ways to Sum (I & II), Spiralize Matrix, Array Jumping Game (I & II),
 *  Merge Overlapping Intervals, Generate IP Addresses,
 *  Algorithmic Stock Trader (I-IV), Minimum Path Sum in a Triangle,
 *  Unique Paths in a Grid (I & II), Shortest Path in a Grid,
 *  Sanitize Parentheses in Expression, Proper 2-Coloring of a Graph,
 *  Compression I: RLE Compression, Encryption I: Caesar Cipher,
 *  Encryption II: Vigenère Cipher.
 *
 *  NOTE: contract type strings are matched exactly against what
 *  ns.codingcontract.getContractType() returns. If the game has renamed
 *  any of these since this was written, that type will just show up as
 *  "no solver" below rather than crash or misfire.
 */

// ---------- solver implementations ----------

function largestPrimeFactor(n) {
  let factor = 2, num = n;
  while (factor * factor <= num) {
    if (num % factor === 0) num /= factor;
    else factor++;
  }
  return num;
}

function maxSubarray(arr) {
  let here = arr[0], best = arr[0];
  for (let i = 1; i < arr.length; i++) {
    here = Math.max(arr[i], here + arr[i]);
    best = Math.max(best, here);
  }
  return best;
}

function totalWaysToSum(n) {
  const ways = new Array(n + 1).fill(0);
  ways[0] = 1;
  for (let i = 1; i < n; i++) for (let j = i; j <= n; j++) ways[j] += ways[j - i];
  return ways[n];
}

function totalWaysToSumII(n, nums) {
  const ways = new Array(n + 1).fill(0);
  ways[0] = 1;
  for (const num of nums) for (let j = num; j <= n; j++) ways[j] += ways[j - num];
  return ways[n];
}

function spiralize(matrix) {
  const result = [];
  let top = 0, bottom = matrix.length - 1, left = 0, right = matrix[0].length - 1;
  while (top <= bottom && left <= right) {
    for (let i = left; i <= right; i++) result.push(matrix[top][i]);
    top++;
    for (let i = top; i <= bottom; i++) result.push(matrix[i][right]);
    right--;
    if (top <= bottom) { for (let i = right; i >= left; i--) result.push(matrix[bottom][i]); bottom--; }
    if (left <= right) { for (let i = bottom; i >= top; i--) result.push(matrix[i][left]); left++; }
  }
  return result;
}

function canJump(arr) {
  let maxReach = 0;
  for (let i = 0; i < arr.length; i++) {
    if (i > maxReach) return 0;
    maxReach = Math.max(maxReach, i + arr[i]);
  }
  return 1;
}

function minJumps(arr) {
  if (arr.length <= 1) return 0;
  let jumps = 0, currentEnd = 0, farthest = 0;
  for (let i = 0; i < arr.length - 1; i++) {
    farthest = Math.max(farthest, i + arr[i]);
    if (i === currentEnd) {
      jumps++;
      currentEnd = farthest;
      if (currentEnd >= arr.length - 1) break;
    }
  }
  return currentEnd >= arr.length - 1 ? jumps : 0;
}

function mergeIntervals(intervals) {
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of sorted) {
    if (merged.length === 0 || merged[merged.length - 1][1] < iv[0]) merged.push(iv.slice());
    else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
  }
  return merged;
}

function generateIPs(s) {
  const result = [];
  const isValid = (seg) => seg.length > 0 && seg.length <= 3 &&
    !(seg.length > 1 && seg[0] === '0') && parseInt(seg, 10) <= 255;
  function backtrack(start, parts) {
    if (parts.length === 4) { if (start === s.length) result.push(parts.join('.')); return; }
    for (let len = 1; len <= 3 && start + len <= s.length; len++) {
      const seg = s.substring(start, start + len);
      if (isValid(seg)) backtrack(start + len, [...parts, seg]);
    }
  }
  backtrack(0, []);
  return result;
}

function maxProfit1(prices) {
  let minPrice = Infinity, profit = 0;
  for (const p of prices) { minPrice = Math.min(minPrice, p); profit = Math.max(profit, p - minPrice); }
  return profit;
}

function maxProfit2(prices) {
  let profit = 0;
  for (let i = 1; i < prices.length; i++) if (prices[i] > prices[i - 1]) profit += prices[i] - prices[i - 1];
  return profit;
}

function maxProfitK(prices, k) {
  const n = prices.length;
  if (n === 0) return 0;
  if (k > n / 2) return maxProfit2(prices);
  const buy = new Array(k + 1).fill(-Infinity);
  const sell = new Array(k + 1).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 1; j <= k; j++) {
      buy[j] = Math.max(buy[j], sell[j - 1] - prices[i]);
      sell[j] = Math.max(sell[j], buy[j] + prices[i]);
    }
  }
  return sell[k];
}

function minPathSumTriangle(triangle) {
  const n = triangle.length;
  const dp = triangle[n - 1].slice();
  for (let row = n - 2; row >= 0; row--)
    for (let i = 0; i <= row; i++) dp[i] = triangle[row][i] + Math.min(dp[i], dp[i + 1]);
  return dp[0];
}

function uniquePathsI([rows, cols]) {
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(1));
  for (let i = 1; i < rows; i++) for (let j = 1; j < cols; j++) dp[i][j] = dp[i - 1][j] + dp[i][j - 1];
  return dp[rows - 1][cols - 1];
}

function uniquePathsII(grid) {
  const rows = grid.length, cols = grid[0].length;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    if (grid[i][j] === 1) continue;
    dp[i][j] = i === 0 && j === 0 ? 1 : (i > 0 ? dp[i - 1][j] : 0) + (j > 0 ? dp[i][j - 1] : 0);
  }
  return dp[rows - 1][cols - 1];
}

function shortestPathGrid(grid) {
  const rows = grid.length, cols = grid[0].length;
  if (grid[0][0] === 1 || grid[rows - 1][cols - 1] === 1) return "";
  const dirs = [[-1, 0, 'U'], [1, 0, 'D'], [0, -1, 'L'], [0, 1, 'R']];
  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
  visited[0][0] = true;
  const queue = [[0, 0, ""]];
  while (queue.length) {
    const [r, c, path] = queue.shift();
    if (r === rows - 1 && c === cols - 1) return path;
    for (const [dr, dc, ch] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc] && grid[nr][nc] === 0) {
        visited[nr][nc] = true;
        queue.push([nr, nc, path + ch]);
      }
    }
  }
  return "";
}

function sanitizeParens(s) {
  const isValid = (str) => {
    let count = 0;
    for (const c of str) { if (c === '(') count++; else if (c === ')') { count--; if (count < 0) return false; } }
    return count === 0;
  };
  let level = [s];
  const visited = new Set([s]);
  while (true) {
    const valid = level.filter(isValid);
    if (valid.length > 0) return valid;
    const next = new Set();
    for (const str of level) for (let i = 0; i < str.length; i++) {
      if (str[i] !== '(' && str[i] !== ')') continue;
      const cand = str.slice(0, i) + str.slice(i + 1);
      if (!visited.has(cand)) { visited.add(cand); next.add(cand); }
    }
    if (next.size === 0) return [];
    level = [...next];
  }
}

function twoColoring(numVertices, edges) {
  const adj = Array.from({ length: numVertices }, () => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
  const colors = new Array(numVertices).fill(-1);
  for (let start = 0; start < numVertices; start++) {
    if (colors[start] !== -1) continue;
    colors[start] = 0;
    const queue = [start];
    while (queue.length) {
      const node = queue.shift();
      for (const nb of adj[node]) {
        if (colors[nb] === -1) { colors[nb] = 1 - colors[node]; queue.push(nb); }
        else if (colors[nb] === colors[node]) return [];
      }
    }
  }
  return colors;
}

function rleCompress(str) {
  let result = '', i = 0;
  while (i < str.length) {
    let j = i;
    while (j < str.length && str[j] === str[i] && j - i < 9) j++;
    result += (j - i) + str[i];
    i = j;
  }
  return result;
}

function caesarCipher(text, shift) {
  return text.split('').map(c => {
    if (c === ' ') return ' ';
    return String.fromCharCode(((c.charCodeAt(0) - 65 - shift) % 26 + 26) % 26 + 65);
  }).join('');
}

function vigenereCipher(text, keyword) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ') { result += ' '; continue; }
    const shift = keyword[i % keyword.length].charCodeAt(0) - 65;
    result += String.fromCharCode(((text.charCodeAt(i) - 65 + shift) % 26 + 26) % 26 + 65);
  }
  return result;
}

// ---------- type -> solver dispatch ----------

const solvers = {
  "Find Largest Prime Factor": (d) => largestPrimeFactor(d),
  "Subarray with Maximum Sum": (d) => maxSubarray(d),
  "Total Ways to Sum": (d) => totalWaysToSum(d),
  "Total Ways to Sum II": (d) => totalWaysToSumII(d[0], d[1]),
  "Spiralize Matrix": (d) => spiralize(d),
  "Array Jumping Game": (d) => canJump(d),
  "Array Jumping Game II": (d) => minJumps(d),
  "Merge Overlapping Intervals": (d) => mergeIntervals(d),
  "Generate IP Addresses": (d) => generateIPs(d),
  "Algorithmic Stock Trader I": (d) => maxProfit1(d),
  "Algorithmic Stock Trader II": (d) => maxProfit2(d),
  "Algorithmic Stock Trader III": (d) => maxProfitK(d, 2),
  "Algorithmic Stock Trader IV": (d) => maxProfitK(d[1], d[0]),
  "Minimum Path Sum in a Triangle": (d) => minPathSumTriangle(d),
  "Unique Paths in a Grid I": (d) => uniquePathsI(d),
  "Unique Paths in a Grid II": (d) => uniquePathsII(d),
  "Shortest Path in a Grid": (d) => shortestPathGrid(d),
  "Sanitize Parentheses in Expression": (d) => sanitizeParens(d),
  "Proper 2-Coloring of a Graph": (d) => twoColoring(d[0], d[1]),
  "Compression I: RLE Compression": (d) => rleCompress(d),
  "Encryption I: Caesar Cipher": (d) => caesarCipher(d[0], d[1]),
  "Encryption II: Vigenère Cipher": (d) => vigenereCipher(d[0], d[1]),
};

// ---------- scanner ----------

export async function main(ns) {
  const flags = ns.flags([["auto-solve", false], ["quiet", false]]);
  const autoSolve = flags["auto-solve"];
  const quiet = flags["quiet"];   // suppress everything except real solves/failures

  const visited = new Set(["home"]);
  const queue = ["home"];
  while (queue.length > 0) {
    const host = queue.shift();
    for (const neighbor of ns.scan(host)) if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
  }

  const found = [];
  for (const host of visited) {
    for (const file of ns.ls(host, ".cct")) {
      const type = ns.codingcontract.getContractType(file, host);
      const triesLeft = ns.codingcontract.getNumTriesRemaining(file, host);
      found.push({ host, file, type, triesLeft });
    }
  }

  if (found.length === 0) { if (!quiet) ns.tprint("No coding contracts found on any scanned server."); return; }

  if (!quiet) ns.tprint(`Found ${found.length} contract(s):`);
  for (const c of found) {
    if (!autoSolve) {
      ns.tprint(`  [${c.host}] ${c.file}  ->  "${c.type}"  (${c.triesLeft} tries left)`);
      continue;
    }

    const solver = solvers[c.type];
    if (!solver) {
      if (!quiet) ns.tprint(`  [${c.host}] ${c.file}  ->  "${c.type}"  -- no solver available, skipping`);
      continue;
    }

    try {
      const data = ns.codingcontract.getData(c.file, c.host);
      const answer = solver(data);
      const reward = ns.codingcontract.attempt(answer, c.file, c.host, { returnReward: true });
      if (reward) ns.tprint(`  [${c.host}] ${c.file}  ->  "${c.type}"  SOLVED: ${reward}`);
      else ns.tprint(`  [${c.host}] ${c.file}  ->  "${c.type}"  FAILED (bad answer, ${c.triesLeft - 1} tries left now)`);
    } catch (e) {
      ns.tprint(`  [${c.host}] ${c.file}  ->  "${c.type}"  ERROR while solving: ${e}`);
    }
  }
}
