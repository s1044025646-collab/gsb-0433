// 精确覆盖 + Algorithm X 求解器
// 729 个候选行 (r,c,n)，324 个约束列：
//   0-80    格占用 (r,c)
//   81-161  行 r 含数字 n
//   162-242 列 c 含数字 n
//   243-323 宫 b 含数字 n
import { Grid, boxIndex } from "./sudoku";

export type SolveStatus = "unique" | "multiple" | "none" | "budget_exhausted";

export interface TraceStep {
  depth: number;
  column: number;          // 被选中的约束列（候选数最少）
  columnKind: "cell" | "row-digit" | "col-digit" | "box-digit";
  columnDesc: string;
  candidateCount: number;  // 该列当时可选候选数
  chosen: { row: number; col: number; digit: number };
  outcome: "solution-path" | "backtracked";
}

export interface SolveReport {
  status: SolveStatus;
  solutions: Grid[];       // 最多 2 份
  nodesVisited: number;    // 口径：每次"选中一个候选行并递归进入"计 1
  backtracks: number;      // 候选失败撤销次数
  stopReason: string;
  budget: number;
  trace: TraceStep[];      // 受限搜索步骤（上限 MAX_TRACE）
  traceTruncated: boolean;
}

const MAX_TRACE = 10000;

function colKindDesc(col: number): { kind: TraceStep["columnKind"]; desc: string } {
  if (col < 81) {
    return { kind: "cell", desc: `cell(${Math.floor(col / 9) + 1},${(col % 9) + 1}) must be filled` };
  }
  if (col < 162) {
    const x = col - 81;
    return { kind: "row-digit", desc: `row ${Math.floor(x / 9) + 1} must contain digit ${(x % 9) + 1}` };
  }
  if (col < 243) {
    const x = col - 162;
    return { kind: "col-digit", desc: `col ${Math.floor(x / 9) + 1} must contain digit ${(x % 9) + 1}` };
  }
  const x = col - 243;
  return { kind: "box-digit", desc: `box ${Math.floor(x / 9) + 1} must contain digit ${(x % 9) + 1}` };
}

export function solveExactCover(givens: Grid, budget: number = 100000): SolveReport {
  // 构建 729 行，每行覆盖 4 列
  const rowCols: number[][] = new Array(729);
  const rowMeta: [number, number, number][] = new Array(729);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      for (let n = 1; n <= 9; n++) {
        const id = (r * 9 + c) * 9 + (n - 1);
        const b = boxIndex(r, c);
        rowCols[id] = [r * 9 + c, 81 + r * 9 + (n - 1), 162 + c * 9 + (n - 1), 243 + b * 9 + (n - 1)];
        rowMeta[id] = [r, c, n];
      }
    }
  }
  const colRows: Set<number>[] = Array.from({ length: 324 }, () => new Set<number>());
  for (let id = 0; id < 729; id++) for (const col of rowCols[id]) colRows[col].add(id);

  const activeRows: boolean[] = new Array(729).fill(true);
  const coveredCols: boolean[] = new Array(324).fill(false);

  // 覆盖一行：对其每列，停用所有冲突行（含自身），撤销栈保证精确恢复
  function coverRow(rowId: number, undo: Array<() => void>): void {
    const deactivate = (id: number) => {
      if (!activeRows[id]) return;
      activeRows[id] = false;
      undo.push(() => { activeRows[id] = true; });
      for (const oc of rowCols[id]) {
        if (colRows[oc].delete(id)) undo.push(() => { colRows[oc].add(id); });
      }
    };
    for (const col of rowCols[rowId]) {
      if (!coveredCols[col]) {
        coveredCols[col] = true;
        undo.push(() => { coveredCols[col] = false; });
      }
      for (const other of Array.from(colRows[col])) deactivate(other);
    }
  }

  const solutions: Grid[] = [];
  const chosenRows: number[] = [];
  const trace: TraceStep[] = [];
  let nodesVisited = 0;
  let backtracks = 0;
  let exhausted = false;
  let traceTruncated = false;

  function currentGrid(): Grid {
    const g: Grid = givens.slice();
    for (const id of chosenRows) {
      const [r, c, n] = rowMeta[id];
      g[r * 9 + c] = n;
    }
    return g;
  }

  function search(depth: number): void {
    if (solutions.length >= 2 || exhausted) return;
    // 选候选数最少的未覆盖列（平局取列号最小，保证确定性）
    let bestCol = -1;
    let bestCount = Infinity;
    for (let col = 0; col < 324; col++) {
      if (coveredCols[col]) continue;
      const cnt = colRows[col].size;
      if (cnt < bestCount) { bestCount = cnt; bestCol = col; if (cnt === 0) break; }
    }
    if (bestCol === -1) {
      solutions.push(currentGrid());
      return;
    }
    if (bestCount === 0) return; // 死路
    // 候选顺序固定：按行 id 升序（即 (r,c,n) 字典序）
    const candidates = Array.from(colRows[bestCol]).sort((a, b) => a - b);
    const { kind, desc } = colKindDesc(bestCol);
    for (const rowId of candidates) {
      if (solutions.length >= 2 || exhausted) return;
      if (nodesVisited >= budget) { exhausted = true; return; }
      nodesVisited++;
      const undo: Array<() => void> = [];
      coverRow(rowId, undo);
      chosenRows.push(rowId);
      const [r, c, n] = rowMeta[rowId];
      let traceIdx = -1;
      if (trace.length < MAX_TRACE) {
        traceIdx = trace.length;
        trace.push({
          depth, column: bestCol, columnKind: kind, columnDesc: desc,
          candidateCount: candidates.length,
          chosen: { row: r + 1, col: c + 1, digit: n },
          outcome: "solution-path",
        });
      } else traceTruncated = true;
      const before = solutions.length;
      search(depth + 1);
      if (solutions.length === before) {
        backtracks++;
        if (traceIdx >= 0) trace[traceIdx].outcome = "backtracked";
      }
      chosenRows.pop();
      for (let i = undo.length - 1; i >= 0; i--) undo[i]();
    }
  }

  // 先覆盖线索（直接冲突由调用方先行校验，这里假定无冲突）
  for (let i = 0; i < 81; i++) {
    const n = givens[i];
    if (n === 0) continue;
    const r = Math.floor(i / 9), c = i % 9;
    const id = (r * 9 + c) * 9 + (n - 1);
    const undo: Array<() => void> = [];
    coverRow(id, undo);
    chosenRows.push(id);
  }

  search(0);

  let status: SolveStatus;
  let stopReason: string;
  if (exhausted) {
    status = "budget_exhausted";
    stopReason = `node budget ${budget} exhausted, ${solutions.length} solution(s) kept, search space not exhausted, result unknown`;
  } else if (solutions.length >= 2) {
    status = "multiple";
    stopReason = "two distinct solutions found, at least two solutions (remaining branches not exhausted)";
  } else if (solutions.length === 1) {
    status = "unique";
    stopReason = "all branches exhausted with exactly one solution, unique";
  } else {
    status = "none";
    stopReason = "all branches exhausted, no solution";
  }

  return { status, solutions, nodesVisited, backtracks, stopReason, budget, trace, traceTruncated };
}
