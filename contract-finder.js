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
 *  Encryption II: Vigenère Cipher, Compression II: LZ Decompression,
 *  HammingCodes: Encoded Binary to Integer, Square Root,
 *  Find All Valid Math Expressions, Compression III: LZ Compression,
 *  HammingCodes: Integer to Encoded Binary, Largest Rectangle in a Matrix,
 *  Total Number of Primes.
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

/** Compression II — decode the LZ variant Bitburner uses.
 *
 *  Chunks ALTERNATE, starting with a literal chunk, and each begins with a single length digit L:
 *    - literal chunk: the next L characters are copied straight out;
 *    - backreference chunk: one more digit X follows, then L characters are emitted, each a copy of
 *      the character X places before the CURRENT end of the output.
 *  L = 0 means the chunk is empty and we move straight to the next one — and crucially, a zero-length
 *  backreference chunk consumes NO offset digit. Getting that wrong desynchronises the whole stream.
 *
 *  The backreference reads from `plain` as it grows, so an offset shorter than the run length copies
 *  the same few characters repeatedly (that's how the format encodes long runs) — which is why this
 *  appends one character at a time instead of slicing a fixed window. */
function lzDecompress(compressed) {
  let plain = "";
  let i = 0;
  let literal = true;
  while (i < compressed.length) {
    const len = Number(compressed[i]);
    i++;
    if (Number.isNaN(len)) break;                 // malformed input: stop rather than emit garbage
    if (len > 0) {
      if (literal) {
        plain += compressed.substr(i, len);
        i += len;
      } else {
        const offset = Number(compressed[i]);
        i++;
        for (let n = 0; n < len; n++) plain += plain[plain.length - offset];
      }
    }
    literal = !literal;
  }
  return plain;
}

/** HammingCodes: Encoded Binary to Integer — correct the single flipped bit, then read the data out.
 *
 *  Extended Hamming layout: index 0 is the overall parity bit, every power-of-two index (1, 2, 4, 8…)
 *  is a section parity bit, and everything else is data, most significant first.
 *
 *  The neat part: XOR together the INDICES of all set bits and the result is exactly the index of the
 *  flipped bit (0 if the code is clean). No need to test each parity section separately — each
 *  section's parity contributes its own bit to that XOR. Index 0 is skipped because XORing 0 is a
 *  no-op anyway.
 *
 *  Returns a NUMBER — that's what the contract validates. */
function hammingDecode(encoded) {
  const bits = encoded.trim().split("").map(Number);
  let err = 0;
  for (let i = 1; i < bits.length; i++) if (bits[i] === 1) err ^= i;
  if (err !== 0 && err < bits.length) bits[err] ^= 1;           // flip the one corrupted bit back
  let binary = "";
  for (let i = 3; i < bits.length; i++) {
    if ((i & (i - 1)) === 0) continue;                          // power of two -> parity, not data
    binary += bits[i];
  }
  if (!binary) return 0;
  return Number(BigInt("0b" + binary));
}

/** Square Root — nearest integer square root of a ~200-digit BigInt.
 *
 *  Must be done in BigInt throughout: the input overflows a double long before you could Math.sqrt it,
 *  and the contract wants a BIGINT back (not a string, not a number).
 *
 *  Newton's method converges to FLOOR(sqrt(n)), so the last step picks whichever of x and x+1 is
 *  actually closer — "to the nearest integer" is the contract's wording, and a floor answer is wrong
 *  slightly more than half the time. */
function squareRootNearest(value) {
  const n = typeof value === "bigint" ? value : BigInt(String(value).trim());
  if (n < 2n) return n;
  // Seed at 2^ceil(bits/2) — a good enough starting point that Newton converges in a few steps.
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  let y = (x + n / x) >> 1n;
  while (y < x) { x = y; y = (x + n / x) >> 1n; }
  return n - x * x <= (x + 1n) * (x + 1n) - n ? x : x + 1n;
}

/** Find All Valid Math Expressions — insert +, - and * between digits to hit the target.
 *
 *  Backtracking over every split point. The subtlety is operator PRECEDENCE: multiplication binds
 *  tighter than the running total, so we carry `prev` (the value of the last term applied) and undo
 *  it before re-applying it multiplied — `value - prev + prev * num`. Tracking only the running total
 *  would evaluate strictly left to right and quietly produce wrong answers.
 *
 *  Leading zeros are illegal unless the operand IS "0", and the `break` matters: once a slice starting
 *  at this position has a leading zero, every LONGER slice from here does too. */
function findMathExpressions(data) {
  const digits = String(data[0]);
  const target = Number(data[1]);
  const out = [];
  const walk = (pos, expr, value, prev) => {
    if (pos === digits.length) {
      if (value === target) out.push(expr);
      return;
    }
    for (let len = 1; pos + len <= digits.length; len++) {
      const part = digits.slice(pos, pos + len);
      if (part.length > 1 && part[0] === "0") break;            // no leading zeros, and none longer either
      const num = Number(part);
      if (pos === 0) {
        walk(len, part, num, num);                              // first operand takes no operator
      } else {
        walk(pos + len, expr + "+" + part, value + num, num);
        walk(pos + len, expr + "-" + part, value - num, -num);
        walk(pos + len, expr + "*" + part, value - prev + prev * num, prev * num);
      }
    }
  };
  walk(0, "", 0, 0);
  return out;
}

/** Compression III — produce an LZ encoding at least as short as the game's own.
 *
 *  The validator is `answer.length <= encoded.length && comprLZDecode(answer) === plain`, where
 *  `encoded` is the game's DP-optimal encoding. So "any valid encoding" is NOT enough — this has to
 *  be optimal too. Hence a real dynamic program rather than a greedy pass.
 *
 *  Chunks alternate literal/backref (see lzDecompress). Costs: a literal of length L is 1+L characters
 *  (length digit + the literals); a backref is 2 (length digit + offset digit); a zero-length chunk is
 *  1 and exists purely to switch type without consuming input.
 *
 *  Two arrays per position, because the cost depends on whose turn it is:
 *    A[pos] = cheapest encoding of plain[pos..] with a LITERAL chunk due
 *    B[pos] = cheapest encoding of plain[pos..] with a BACKREF chunk due
 *  and the primed variants forbid a zero-length chunk. That's what stops the search cycling: a zero
 *  literal followed by a zero backref costs 2 and returns to the identical state, so it can never be
 *  optimal, and forbidding it makes the recurrence well-founded instead of circular.
 *
 *  A backref is legal at pos with offset X and length L iff X <= pos and plain[pos+k] === plain[pos-X+k]
 *  for every k — the decoder's output so far is exactly plain[0..pos-1], so overlapping copies (X < L)
 *  are checked correctly by that same test. */
function lzCompress(plain) {
  const n = plain.length;
  if (n === 0) return "";
  const INF = Infinity;
  // A/B allow a zero-length chunk; A0/B0 forbid one.
  const A = new Array(n + 1).fill(INF), B = new Array(n + 1).fill(INF);
  const A0 = new Array(n + 1).fill(INF), B0 = new Array(n + 1).fill(INF);
  A[n] = B[n] = 0;

  /** Longest run at `pos` that a backref of offset X can reproduce, capped at 9. */
  const runFor = (pos, x) => {
    let len = 0;
    while (len < 9 && pos + len < n && plain[pos + len] === plain[pos - x + len]) len++;
    return len;
  };

  for (let pos = n - 1; pos >= 0; pos--) {
    let best = INF;
    for (let len = 1; len <= 9 && pos + len <= n; len++) {
      const cost = 1 + len + B[pos + len];
      if (cost < best) best = cost;
    }
    A0[pos] = best;

    best = INF;
    for (let x = 1; x <= 9 && x <= pos; x++) {
      const max = runFor(pos, x);
      for (let len = 1; len <= max; len++) {
        const cost = 2 + A[pos + len];
        if (cost < best) best = cost;
      }
    }
    B0[pos] = best;

    A[pos] = Math.min(A0[pos], 1 + B0[pos]);
    B[pos] = Math.min(B0[pos], 1 + A0[pos]);
  }

  // Walk the table back out, emitting the chunks that achieved the optimum.
  let out = "";
  let pos = 0, literal = true;
  while (pos < n) {
    if (literal) {
      if (A[pos] === 1 + B0[pos] && A0[pos] !== A[pos]) { out += "0"; literal = false; continue; }
      let pick = -1;
      for (let len = 1; len <= 9 && pos + len <= n; len++) {
        if (1 + len + B[pos + len] === A0[pos]) { pick = len; break; }
      }
      out += String(pick) + plain.substr(pos, pick);
      pos += pick;
      literal = false;
    } else {
      if (B[pos] === 1 + A0[pos] && B0[pos] !== B[pos]) { out += "0"; literal = true; continue; }
      let pickLen = -1, pickX = -1;
      outer: for (let x = 1; x <= 9 && x <= pos; x++) {
        const max = runFor(pos, x);
        for (let len = 1; len <= max; len++) {
          if (2 + A[pos + len] === B0[pos]) { pickLen = len; pickX = x; break outer; }
        }
      }
      out += String(pickLen) + String(pickX);
      pos += pickLen;
      literal = true;
    }
  }
  return out;
}

/** HammingCodes: Integer to Encoded Binary — the inverse of hammingDecode above.
 *
 *  Layout: index 0 is the overall parity, every power-of-two index is a section parity, everything
 *  else is data, most significant bit first. The codeword is SHORTENED, not padded to a power of two:
 *  we take the fewest parity bits p with (2^p - 1 - p) >= dataBits, giving a total of data + p + 1.
 *
 *  The parity bits fall out of one XOR. Lay the data in with parities zeroed, XOR the indices of every
 *  set bit, and the result read bitwise IS the parity vector — bit k belongs at position 2^k. Setting
 *  them that way drives the whole XOR to zero, which is exactly the property hammingDecode relies on
 *  to locate a flipped bit. Position 0 goes in last, making the total number of set bits even.
 *
 *  Returns a STRING, which is what the contract validates. */
function hammingEncode(value) {
  const data = Number(value).toString(2).split("").map(Number);
  let p = 0;
  while (Math.pow(2, p) - 1 - p < data.length) p++;
  const total = data.length + p + 1;
  const bits = new Array(total).fill(0);
  let d = 0;
  for (let i = 3; i < total; i++) {
    if ((i & (i - 1)) === 0) continue;                    // power of two -> parity slot
    bits[i] = data[d++];
  }
  let x = 0;
  for (let i = 1; i < total; i++) if (bits[i] === 1) x ^= i;
  for (let k = 0; 1 << k < total; k++) bits[1 << k] = (x >> k) & 1;
  let count = 0;
  for (let i = 1; i < total; i++) count += bits[i];
  bits[0] = count % 2;
  return bits.join("");
}

/** Largest Rectangle in a Matrix — the largest all-ZERO rectangle, returned as CORNERS.
 *
 *  Two things make this unlike the textbook problem, and either one silently fails the contract:
 *    - it maximises a rectangle of 0s, not 1s;
 *    - the answer is [[r1,c1],[r2,c2]] — ROW first, column second, bottom-right INCLUSIVE — not an area.
 *
 *  The validator only requires that our rectangle is in bounds, contains no 1s, and has the SAME AREA
 *  as its own answer. So any maximal rectangle passes; we don't have to find the same one.
 *
 *  Method: build a histogram of consecutive zeros ending at each cell going down, then for each row
 *  widen left and right while the neighbouring bars are at least as tall. Grids are 4-15 per side, so
 *  the simple quadratic widening is plenty and much easier to read than a stack. */
function largestRectangle(grid) {
  const rows = grid.length, cols = grid[0].length;
  const hist = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let c = 0; c < cols; c++) {
    let run = 0;
    for (let r = 0; r < rows; r++) {
      run = grid[r][c] === 0 ? run + 1 : 0;
      hist[r][c] = run;
    }
  }
  let best = 0, top = 0, left = 0, bottom = 0, right = 0;
  for (let r = 0; r < rows; r++) {
    const row = hist[r];
    for (let c = 0; c < cols; c++) {
      const h = row[c];
      if (h === 0) continue;
      let l = c, rr = c;
      while (l - 1 >= 0 && row[l - 1] >= h) l--;
      while (rr + 1 < cols && row[rr + 1] >= h) rr++;
      const area = (rr - l + 1) * h;
      if (area > best) { best = area; top = r - h + 1; left = l; bottom = r; right = rr; }
    }
  }
  // An all-1s grid has no valid rectangle at all; mirror the game's own degenerate [[0,0],[0,0]].
  return [[top, left], [bottom, right]];
}

/** Total Number of Primes — count primes in [low, high], both ends inclusive.
 *
 *  The contract caps low at 5,000,000 and high at low + 1,000,000, so a plain sieve to `high` is at
 *  most a ~6 MB Uint8Array — cheap enough that a segmented sieve would only add bugs. Bounds are
 *  sorted defensively and clamped at 2, since low may legitimately be 0 or 1. */
function totalPrimesInRange(data) {
  const a = Number(data[0]), b = Number(data[1]);
  const high = Math.max(a, b);
  const low = Math.max(2, Math.min(a, b));
  if (high < 2 || high < low) return 0;
  const composite = new Uint8Array(high + 1);
  for (let i = 2; i * i <= high; i++) {
    if (composite[i]) continue;
    for (let j = i * i; j <= high; j += i) composite[j] = 1;
  }
  let count = 0;
  for (let i = low; i <= high; i++) if (!composite[i]) count++;
  return count;
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
  "Compression II: LZ Decompression": (d) => lzDecompress(d),
  "HammingCodes: Encoded Binary to Integer": (d) => hammingDecode(d),
  "Square Root": (d) => squareRootNearest(d),
  "Find All Valid Math Expressions": (d) => findMathExpressions(d),
  "Compression III: LZ Compression": (d) => lzCompress(d),
  "HammingCodes: Integer to Encoded Binary": (d) => hammingEncode(d),
  "Largest Rectangle in a Matrix": (d) => largestRectangle(d),
  "Total Number of Primes": (d) => totalPrimesInRange(d),
};

// Exported so contract-finder.test.mjs can prove these under plain Node before they ever touch a
// real contract. A wrong answer burns one of a contract's limited tries, so "it looks right" is not
// good enough — see the test file for the worked cases behind each solver.
export {
	lzDecompress, hammingDecode, squareRootNearest, findMathExpressions,
	lzCompress, hammingEncode, largestRectangle, totalPrimesInRange,
	solvers,
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
