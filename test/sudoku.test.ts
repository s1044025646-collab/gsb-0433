import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGrid, validateClues, verifySolution, Grid } from "../src/sudoku";
import { solveExactCover } from "../src/exactCover";

const PUZZLE =
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION =
  "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

function toGrid(s: string): Grid { return s.split("").map((c) => (c === "0" || c === "." ? 0 : Number(c))); }

// 独立朴素逐格回溯计数器（测试对照用，数到 2 即停）
function naiveCount(grid: Grid, limit = 2): number {
  const g = grid.slice();
  let count = 0;
  function ok(i: number, n: number): boolean {
    const r = Math.floor(i / 9), c = i % 9;
    for (let k = 0; k < 9; k++) {
      if (g[r * 9 + k] === n || g[k * 9 + c] === n) return false;
      const br = Math.floor(r / 3) * 3 + Math.floor(k / 3);
      const bc = Math.floor(c / 3) * 3 + (k % 3);
      if (g[br * 9 + bc] === n) return false;
    }
    return true;
  }
  function bt(): void {
    if (count >= limit) return;
    let i = -1;
    for (let k = 0; k < 81; k++) if (g[k] === 0) { i = k; break; }
    if (i === -1) { count++; return; }
    for (let n = 1; n <= 9; n++) {
      if (ok(i, n)) { g[i] = n; bt(); g[i] = 0; if (count >= limit) return; }
    }
  }
  bt();
  return count;
}

test("解析：81 字符与 9 行等价，拒绝非法输入", () => {
  const a = parseGrid(PUZZLE);
  const b = parseGrid(PUZZLE.match(/.{9}/g)!.join("\n"));
  assert.deepEqual(a.grid, b.grid);
  assert.ok(parseGrid("123").error);
  assert.ok(parseGrid("x".repeat(81)).error);
});

test("线索校验：检出直接重复并给出坐标", () => {
  const g = toGrid("11" + "0".repeat(79));
  const v = validateClues(g);
  assert.equal(v.ok, false);
  assert.equal(v.errorCode, "CLUE_CONFLICT");
  assert.ok(v.conflicts!.some((c) => c.unit === "row" && c.digit === 1));
  assert.ok(v.conflicts!.some((c) => c.unit === "box" && c.digit === 1));
});

test("求解：唯一解题，解通过独立核验", () => {
  const report = solveExactCover(toGrid(PUZZLE), 100000);
  assert.equal(report.status, "unique");
  assert.equal(report.solutions.length, 1);
  assert.equal(report.solutions[0].join(""), SOLUTION);
  assert.ok(verifySolution(report.solutions[0], toGrid(PUZZLE)).ok);
  assert.ok(report.nodesVisited > 0);
});

test("求解：无直接重复但无解", () => {
  const g = toGrid("531070000600195000098000060800060003400803001700020006060000280000419005000080079");
  assert.ok(validateClues(g).ok);
  const report = solveExactCover(g, 100000);
  assert.equal(report.status, "none");
  assert.equal(report.solutions.length, 0);
});

test("求解：空棋盘多解，两份见证均通过核验", () => {
  const g = toGrid("0".repeat(81));
  const report = solveExactCover(g, 1_000_000);
  assert.equal(report.status, "multiple");
  assert.equal(report.solutions.length, 2);
  assert.notDeepEqual(report.solutions[0], report.solutions[1]);
  for (const s of report.solutions) assert.ok(verifySolution(s, g).ok);
});

test("预算：极小预算耗尽，不冒充无解或唯一", () => {
  const report = solveExactCover(toGrid(PUZZLE), 5);
  assert.equal(report.status, "budget_exhausted");
  assert.equal(report.nodesVisited, 5);
  assert.ok(report.stopReason.includes("unknown") || report.stopReason.length > 0);
});

test("确定性：重复求解首批结果一致", () => {
  const a = solveExactCover(toGrid(PUZZLE), 100000);
  const b = solveExactCover(toGrid(PUZZLE), 100000);
  assert.equal(a.nodesVisited, b.nodesVisited);
  assert.deepEqual(a.solutions, b.solutions);
  assert.deepEqual(a.trace.slice(0, 20), b.trace.slice(0, 20));
});

test("对照：接近完成的少量空格盘与朴素计数一致", () => {
  const full = toGrid(SOLUTION);
  // 挖 4 个空格
  const holes = [0, 10, 40, 80];
  const g = full.slice();
  for (const h of holes) g[h] = 0;
  const naive = naiveCount(g, 2);
  const report = solveExactCover(g, 100000);
  const expect = naive === 0 ? "none" : naive === 1 ? "unique" : "multiple";
  assert.equal(report.status, expect);
  // 挖两个属于同一行可交换的空格 -> 多解
  const g2 = full.slice();
  // 找同一行中两格交换仍合法的少见，改为直接挖 2 格并对比朴素结果
  g2[0] = 0; g2[1] = 0;
  const naive2 = naiveCount(g2, 2);
  const report2 = solveExactCover(g2, 100000);
  const expect2 = naive2 === 0 ? "none" : naive2 === 1 ? "unique" : "multiple";
  assert.equal(report2.status, expect2);
});

test("核验：完整合法盘通过", () => {
  const vr = verifySolution(toGrid(SOLUTION), toGrid(PUZZLE));
  assert.ok(vr.ok);
});

test("核验：仅缺一个格 -> MISSING_CELL 定位", () => {
  const s = toGrid(SOLUTION);
  s[40] = 0;
  const vr = verifySolution(s, toGrid(PUZZLE));
  assert.equal(vr.ok, false);
  assert.ok(vr.failures.some((f) => f.code === "MISSING_CELL" && f.row === 4 && f.col === 4));
});

test("核验：宫内冲突但不同行列 -> BOX_DUP", () => {
  // 构造：完整盘基础上交换同宫不同行列的两格，制造宫内重复
  const s = toGrid(SOLUTION);
  // (0,0)=5 与 (1,1)=7 同宫不同行列，交换后行列宫均可能冲突；直接构造纯宫冲突：
  // 把 (0,0) 改成 (1,1) 的值 7，并置 (1,1)=0 避免行/列重复？行1 已有 7 于 (1,1) 原位置。
  // 简单做法：从合法盘把 (0,0) 改为 6（(0,3)=6 同行会冲突）——改用 (2,2)=8 改到 (0,0)：
  // (0,0)=8：行0 无 8？行0=534678912 含 8 -> 行冲突。改用独立构造：
  const g: Grid = new Array(81).fill(0);
  g[0] = 5;  // (0,0)
  g[10] = 5; // (1,1) 同宫不同行列
  const vr = verifySolution(g, new Array(81).fill(0));
  assert.ok(vr.failures.some((f) => f.code === "BOX_DUP" && f.digit === 5));
  assert.ok(!vr.failures.some((f) => f.code === "ROW_DUP"));
  assert.ok(!vr.failures.some((f) => f.code === "COL_DUP"));
});

test("核验：篡改原线索 -> CLUE_CHANGED", () => {
  const s = toGrid(SOLUTION);
  s[0] = s[0] === 5 ? 6 : 5; // 原线索 (0,0)=5
  const vr = verifySolution(s, toGrid(PUZZLE));
  assert.ok(vr.failures.some((f) => f.code === "CLUE_CHANGED" && f.row === 0 && f.col === 0));
});


