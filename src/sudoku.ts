export type Grid = number[]; // 长度 81，0 表示空格，行优先

export interface Conflict {
  type: 'row' | 'col' | 'box';
  index: number; // 0..8
  digit: number; // 1..9
  cells: Array<{ row: number; col: number }>;
}

export class PuzzleError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function boxIndex(r: number, c: number): number {
  return Math.floor(r / 3) * 3 + Math.floor(c / 3);
}

/** 解析题面：81 字符（0/. 为空）或 9 行字符串。 */
export function parsePuzzle(input: string | string[]): Grid {
  let s: string;
  if (Array.isArray(input)) {
    if (input.length !== 9) {
      throw new PuzzleError('INVALID_FORMAT', `需要 9 行，实际 ${input.length} 行`);
    }
    s = input.join('');
  } else if (typeof input === 'string') {
    s = input.replace(/[\s,;|]+/g, '');
  } else {
    throw new PuzzleError('INVALID_FORMAT', '题面必须是字符串或 9 行字符串数组');
  }
  if (s.length !== 81) {
    throw new PuzzleError('INVALID_FORMAT', `题面需 81 格，实际 ${s.length} 格`);
  }
  const grid: Grid = new Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = s[i];
    if (ch === '0' || ch === '.') grid[i] = 0;
    else if (ch >= '1' && ch <= '9') grid[i] = ch.charCodeAt(0) - 48;
    else throw new PuzzleError('INVALID_FORMAT', `第 ${i} 格含非法字符 '${ch}'（允许 0-9 或 .）`, { position: i });
  }
  return grid;
}

/** 检查行/列/宫中的直接重复线索。 */
export function findDirectConflicts(grid: Grid): Conflict[] {
  const conflicts: Conflict[] = [];
  const groups: Array<{ type: Conflict['type']; index: number; cells: number[] }> = [];
  for (let r = 0; r < 9; r++) groups.push({ type: 'row', index: r, cells: Array.from({ length: 9 }, (_, c) => r * 9 + c) });
  for (let c = 0; c < 9; c++) groups.push({ type: 'col', index: c, cells: Array.from({ length: 9 }, (_, r) => r * 9 + c) });
  for (let b = 0; b < 9; b++) {
    const cells: number[] = [];
    for (let i = 0; i < 9; i++) cells.push((Math.floor(b / 3) * 3 + Math.floor(i / 3)) * 9 + (b % 3) * 3 + (i % 3));
    groups.push({ type: 'box', index: b, cells });
  }
  for (const g of groups) {
    const seen = new Map<number, number[]>();
    for (const idx of g.cells) {
      const v = grid[idx];
      if (v === 0) continue;
      if (!seen.has(v)) seen.set(v, []);
      seen.get(v)!.push(idx);
    }
    for (const [digit, idxs] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
      if (idxs.length > 1) {
        conflicts.push({
          type: g.type,
          index: g.index,
          digit,
          cells: idxs.map((i) => ({ row: Math.floor(i / 9), col: i % 9 })),
        });
      }
    }
  }
  return conflicts;
}

export interface VerifyFailure {
  kind: 'shape' | 'range' | 'missing' | 'row' | 'col' | 'box' | 'clue';
  message: string;
  cells?: Array<{ row: number; col: number }>;
}

/** 独立答案核验：不依赖精确覆盖搜索，直接检查 81 格、行/列/宫与原线索。 */
export function verifySolution(solution: unknown, givens: Grid): { ok: boolean; failures: VerifyFailure[] } {
  const failures: VerifyFailure[] = [];
  let sol: number[] = [];
  if (typeof solution === 'string') {
    try {
      sol = parsePuzzle(solution);
    } catch (e) {
      failures.push({ kind: 'shape', message: e instanceof Error ? e.message : String(e) });
      return { ok: false, failures };
    }
  } else if (Array.isArray(solution)) {
    sol = solution.map(Number);
  } else {
    return { ok: false, failures: [{ kind: 'shape', message: '答案必须是 81 字符字符串或长度 81 的数组' }] };
  }
  if (sol.length !== 81) {
    return { ok: false, failures: [{ kind: 'shape', message: `答案需 81 格，实际 ${sol.length} 格` }] };
  }
  for (let i = 0; i < 81; i++) {
    const v = sol[i];
    if (!Number.isInteger(v) || v < 0 || v > 9) {
      failures.push({ kind: 'range', message: `第 ${i} 格（行 ${Math.floor(i / 9) + 1} 列 ${(i % 9) + 1}）取值非法：${v}`, cells: [{ row: Math.floor(i / 9), col: i % 9 }] });
    } else if (v === 0) {
      failures.push({ kind: 'missing', message: `第 ${i} 格（行 ${Math.floor(i / 9) + 1} 列 ${(i % 9) + 1}）缺格未填`, cells: [{ row: Math.floor(i / 9), col: i % 9 }] });
    }
  }
  const checkUnit = (kind: 'row' | 'col' | 'box', index: number, cells: number[]) => {
    const count = new Map<number, number[]>();
    for (const idx of cells) {
      const v = sol[idx];
      if (v < 1 || v > 9) continue;
      if (!count.has(v)) count.set(v, []);
      count.get(v)!.push(idx);
    }
    for (const [digit, idxs] of count) {
      if (idxs.length > 1) {
        failures.push({
          kind,
          message: `${kind === 'row' ? '行' : kind === 'col' ? '列' : '宫'} ${index + 1} 中数字 ${digit} 重复`,
          cells: idxs.map((i) => ({ row: Math.floor(i / 9), col: i % 9 })),
        });
      }
    }
  };
  for (let r = 0; r < 9; r++) checkUnit('row', r, Array.from({ length: 9 }, (_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) checkUnit('col', c, Array.from({ length: 9 }, (_, r) => r * 9 + c));
  for (let b = 0; b < 9; b++) {
    const cells: number[] = [];
    for (let i = 0; i < 9; i++) cells.push((Math.floor(b / 3) * 3 + Math.floor(i / 3)) * 9 + (b % 3) * 3 + (i % 3));
    checkUnit('box', b, cells);
  }
  for (let i = 0; i < 81; i++) {
    if (givens[i] !== 0 && sol[i] !== givens[i]) {
      failures.push({
        kind: 'clue',
        message: `第 ${i} 格（行 ${Math.floor(i / 9) + 1} 列 ${(i % 9) + 1}）篡改了原线索 ${givens[i]} -> ${sol[i]}`,
        cells: [{ row: Math.floor(i / 9), col: i % 9 }],
      });
    }
  }
  return { ok: failures.length === 0, failures };
}

/** 朴素逐格回溯计数器（测试对照用），最多计到 limit。 */
export function naiveCountSolutions(grid: Grid, limit = 2): number {
  const g = grid.slice();
  let count = 0;
  const usedRow = Array.from({ length: 9 }, () => new Array<boolean>(10).fill(false));
  const usedCol = Array.from({ length: 9 }, () => new Array<boolean>(10).fill(false));
  const usedBox = Array.from({ length: 9 }, () => new Array<boolean>(10).fill(false));
  for (let i = 0; i < 81; i++) {
    const v = g[i];
    if (v === 0) continue;
    const r = Math.floor(i / 9), c = i % 9, b = boxIndex(r, c);
    if (usedRow[r][v] || usedCol[c][v] || usedBox[b][v]) return 0;
    usedRow[r][v] = usedCol[c][v] = usedBox[b][v] = true;
  }
  const dfs = (pos: number): void => {
    if (count >= limit) return;
    while (pos < 81 && g[pos] !== 0) pos++;
    if (pos === 81) { count++; return; }
    const r = Math.floor(pos / 9), c = pos % 9, b = boxIndex(r, c);
    for (let n = 1; n <= 9; n++) {
      if (usedRow[r][n] || usedCol[c][n] || usedBox[b][n]) continue;
      g[pos] = n;
      usedRow[r][n] = usedCol[c][n] = usedBox[b][n] = true;
      dfs(pos + 1);
      usedRow[r][n] = usedCol[c][n] = usedBox[b][n] = false;
      g[pos] = 0;
      if (count >= limit) return;
    }
  };
  dfs(0);
  return count;
}

export function gridToString(grid: Grid): string {
  return grid.join('');
}
