import { Grid, boxIndex } from './sudoku';

// 精确覆盖映射：
// 729 个候选行 (r,c,n)，行号 = (r*9+c)*9 + (n-1)
// 324 个约束列：
//   0..80    格占用 cell(r,c)  = r*9+c
//   81..161  行内数字 row(r,n) = 81 + r*9+(n-1)
//   162..242 列内数字 col(c,n) = 162 + c*9+(n-1)
//   243..323 宫内数字 box(b,n) = 243 + b*9+(n-1)

export const ALGORITHM_ID = 'exact-cover-algorithm-x-v1';

export interface StepRecord {
  depth: number;
  column: { id: number; type: 'cell' | 'row-digit' | 'col-digit' | 'box-digit'; desc: string; size: number };
  chosen: { row: number; col: number; digit: number };
  alternatives: number; // 该列当时可选候选数
}

export type SolveStatus = 'unique' | 'multiple' | 'none' | 'exhausted';

export interface SolveOptions {
  nodeBudget?: number;      // 节点预算：每“选中一列并尝试一个候选行”计 1 个节点
  maxSolutions?: number;    // 默认 2
  maxStepsLogged?: number;  // 默认 10000
}

export interface SolveResult {
  status: SolveStatus;
  solutions: string[];      // 81 字符解，最多 maxSolutions 份
  nodesVisited: number;
  backtracks: number;
  stopReason: string;
  steps: StepRecord[];
  stepsTruncated: boolean;
  algorithm: string;
  nodeBudget: number;
}

function colDesc(id: number): { type: StepRecord['column']['type']; desc: string } {
  if (id < 81) return { type: 'cell', desc: `格(${(id / 9 | 0) + 1},${(id % 9) + 1})占用` };
  if (id < 162) { const k = id - 81; return { type: 'row-digit', desc: `行${(k / 9 | 0) + 1}含数字${(k % 9) + 1}` }; }
  if (id < 243) { const k = id - 162; return { type: 'col-digit', desc: `列${(k / 9 | 0) + 1}含数字${(k % 9) + 1}` }; }
  const k = id - 243; return { type: 'box-digit', desc: `宫${(k / 9 | 0) + 1}含数字${(k % 9) + 1}` };
}

/** 调用前需保证题面无直接行列宫重复。 */
export function solveExactCover(givens: Grid, opts: SolveOptions = {}): SolveResult {
  const nodeBudget = opts.nodeBudget ?? 1_000_000;
  const maxSolutions = opts.maxSolutions ?? 2;
  const maxStepsLogged = opts.maxStepsLogged ?? 10_000;

  // 每列 -> 候选行列表（构建顺序即 r,c,n 升序，保证平局顺序固定）
  const colRows: number[][] = Array.from({ length: 324 }, () => []);
  const rowCols: number[][] = new Array(729);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const b = boxIndex(r, c);
      for (let n = 1; n <= 9; n++) {
        const row = (r * 9 + c) * 9 + (n - 1);
        const cols = [r * 9 + c, 81 + r * 9 + (n - 1), 162 + c * 9 + (n - 1), 243 + b * 9 + (n - 1)];
        rowCols[row] = cols;
        for (const col of cols) colRows[col].push(row);
      }
    }
  }

  // 引用计数式覆盖：一行可能被多个已覆盖列禁用，计数归零才恢复，保证撤回精确
  const rowBlockCount = new Array<number>(729).fill(0);
  const colSize = new Array<number>(324).fill(9);
  const colCovered = new Array<boolean>(324).fill(false);
  const coverCol = (col: number) => {
    colCovered[col] = true;
    for (const row of colRows[col]) {
      rowBlockCount[row]++;
      if (rowBlockCount[row] === 1) {
        for (const c2 of rowCols[row]) colSize[c2]--;
      }
    }
  };
  const uncoverCol = (col: number) => {
    colCovered[col] = false;
    for (const row of colRows[col]) {
      rowBlockCount[row]--;
      if (rowBlockCount[row] === 0) {
        for (const c2 of rowCols[row]) colSize[c2]++;
      }
    }
  };

  const placementRows: number[] = [];
  const solutions: string[] = [];
  const steps: StepRecord[] = [];
  let nodesVisited = 0;
  let backtracks = 0;
  let exhausted = false;

  // 先覆盖固定线索（按格位升序，确定性）
  for (let i = 0; i < 81; i++) {
    const v = givens[i];
    if (v === 0) continue;
    const row = i * 9 + (v - 1);
    placementRows.push(row);
    for (const col of rowCols[row]) coverCol(col);
  }

  const recordStep = (col: number, row: number, size: number) => {
    if (steps.length >= maxStepsLogged) return;
    const r = row / 81 | 0;
    const c = (row / 9 | 0) % 9;
    const n = (row % 9) + 1;
    const d = colDesc(col);
    steps.push({
      depth: placementRows.length - 1,
      column: { id: col, type: d.type, desc: d.desc, size },
      chosen: { row: r + 1, col: c + 1, digit: n },
      alternatives: size,
    });
  };

  const search = (): void => {
    if (solutions.length >= maxSolutions || exhausted) return;
    // 选未覆盖且候选最少的列；平局取列号最小者（确定性）
    let best = -1;
    let bestSize = Infinity;
    for (let col = 0; col < 324; col++) {
      if (colCovered[col]) continue;
      const size = colSize[col];
      if (size < bestSize) { bestSize = size; best = col; if (size === 0) break; }
    }
    if (best === -1) {
      const sol = new Array<number>(81).fill(0);
      for (const row of placementRows) {
        sol[row / 9 | 0] = (row % 9) + 1;
      }
      solutions.push(sol.join(''));
      return;
    }
    if (bestSize === 0) return; // 死路，回溯
    for (const row of colRows[best]) {
      if (rowBlockCount[row] !== 0) continue;
      nodesVisited++;
      if (nodesVisited > nodeBudget) { exhausted = true; nodesVisited--; return; }
      recordStep(best, row, bestSize);
      placementRows.push(row);
      for (const col of rowCols[row]) coverCol(col);
      search();
      for (const col of rowCols[row]) uncoverCol(col);
      placementRows.pop();
      backtracks++;
      if (solutions.length >= maxSolutions || exhausted) return;
    }
  };
  search();

  let status: SolveStatus;
  let stopReason: string;
  if (exhausted) {
    status = 'exhausted';
    stopReason = `节点预算 ${nodeBudget} 耗尽，搜索未穷尽，已保留 ${solutions.length} 份已找到的解（边界未知）`;
  } else if (solutions.length >= 2) {
    status = 'multiple';
    stopReason = `找到 ${solutions.length} 份不同解，达到上限 ${maxSolutions}，判定至少两解`;
  } else if (solutions.length === 1) {
    status = 'unique';
    stopReason = '已穷尽全部剩余分支且恰好找到 1 份解，判定唯一解';
  } else {
    status = 'none';
    stopReason = '已穷尽全部分支且未找到任何解，判定无解';
  }
  return {
    status,
    solutions,
    nodesVisited,
    backtracks,
    stopReason,
    steps,
    stepsTruncated: steps.length >= maxStepsLogged,
    algorithm: ALGORITHM_ID,
    nodeBudget,
  };
}
