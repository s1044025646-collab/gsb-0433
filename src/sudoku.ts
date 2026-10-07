// 数独基础工具：解析、线索校验、独立答案核验
export type Grid = number[]; // 长度 81，0 表示空格

export interface Conflict {
  unit: "row" | "col" | "box";
  unitIndex: number;
  digit: number;
  cells: [number, number][]; // [row, col] 坐标，0 起
}

export interface ClueValidation {
  ok: boolean;
  errorCode?: "INVALID_FORMAT" | "CLUE_CONFLICT";
  message?: string;
  conflicts?: Conflict[];
}

export function boxIndex(r: number, c: number): number {
  return Math.floor(r / 3) * 3 + Math.floor(c / 3);
}

// 接受 81 字符（0/. 为空）或 9 行字符串
export function parseGrid(input: string): { grid?: Grid; error?: string } {
  if (typeof input !== "string") return { error: "题面必须是字符串" };
  let digits: string;
  if (input.includes("\n") || input.includes("\r")) {
    const lines = input.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length !== 9) return { error: `需要 9 行，实际 ${lines.length} 行` };
    for (let i = 0; i < 9; i++) {
      if (!/^[0-9.]{9}$/.test(lines[i])) return { error: `第 ${i + 1} 行不是 9 个 0-9/. 字符` };
    }
    digits = lines.join("");
  } else {
    digits = input.trim();
    if (!/^[0-9.]{81}$/.test(digits)) return { error: "需要 81 个 0-9/. 字符，或 9 行各 9 字符" };
  }
  const grid: Grid = [];
  for (const ch of digits) grid.push(ch === "." || ch === "0" ? 0 : ch.charCodeAt(0) - 48);
  return { grid };
}

export function gridToString(grid: Grid): string {
  return grid.map((v) => (v === 0 ? "0" : String(v))).join("");
}

export function gridToLines(grid: Grid): string[] {
  const lines: string[] = [];
  for (let r = 0; r < 9; r++) {
    let line = "";
    for (let c = 0; c < 9; c++) line += grid[r * 9 + c] === 0 ? "." : String(grid[r * 9 + c]);
    lines.push(line);
  }
  return lines;
}

// 检查行/列/宫内直接重复线索
export function validateClues(grid: Grid): ClueValidation {
  if (!Array.isArray(grid) || grid.length !== 81) {
    return { ok: false, errorCode: "INVALID_FORMAT", message: "题面必须是 81 格数组" };
  }
  for (const v of grid) {
    if (!Number.isInteger(v) || v < 0 || v > 9) {
      return { ok: false, errorCode: "INVALID_FORMAT", message: "每格必须是 0-9 整数" };
    }
  }
  const conflicts: Conflict[] = [];
  const checkUnit = (unit: "row" | "col" | "box", unitIndex: number, cells: number[]) => {
    const seen = new Map<number, number[]>();
    for (const idx of cells) {
      const v = grid[idx];
      if (v === 0) continue;
      if (!seen.has(v)) seen.set(v, []);
      seen.get(v)!.push(idx);
    }
    for (const [digit, idxs] of seen) {
      if (idxs.length > 1) {
        conflicts.push({
          unit, unitIndex, digit,
          cells: idxs.map((i) => [Math.floor(i / 9), i % 9] as [number, number]),
        });
      }
    }
  };
  for (let r = 0; r < 9; r++) checkUnit("row", r, Array.from({ length: 9 }, (_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) checkUnit("col", c, Array.from({ length: 9 }, (_, r) => r * 9 + c));
  for (let b = 0; b < 9; b++) {
    const cells: number[] = [];
    const br = Math.floor(b / 3) * 3, bc = (b % 3) * 3;
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) cells.push((br + dr) * 9 + bc + dc);
    checkUnit("box", b, cells);
  }
  if (conflicts.length > 0) {
    return { ok: false, errorCode: "CLUE_CONFLICT", message: "线索存在直接重复", conflicts };
  }
  return { ok: true };
}

export interface VerifyFailure {
  code: "MISSING_CELL" | "ROW_DUP" | "COL_DUP" | "BOX_DUP" | "CLUE_CHANGED" | "INVALID_FORMAT";
  message: string;
  row?: number;
  col?: number;
  digit?: number;
}

export interface VerifyResult {
  ok: boolean;
  failures: VerifyFailure[];
}

// 独立朴素核验：不依赖精确覆盖搜索，直接逐行逐列逐宫检查
export function verifySolution(solution: Grid, givens: Grid): VerifyResult {
  const failures: VerifyFailure[] = [];
  if (!Array.isArray(solution) || solution.length !== 81 ||
      solution.some((v) => !Number.isInteger(v) || v < 0 || v > 9)) {
    return { ok: false, failures: [{ code: "INVALID_FORMAT", message: "答案必须是 81 个 0-9 整数" }] };
  }
  for (let i = 0; i < 81; i++) {
    if (solution[i] === 0) {
      failures.push({ code: "MISSING_CELL", message: `第 ${Math.floor(i / 9) + 1} 行第 ${(i % 9) + 1} 列未填`, row: Math.floor(i / 9), col: i % 9 });
    }
  }
  const checkUnit = (code: "ROW_DUP" | "COL_DUP" | "BOX_DUP", label: string, cells: number[], posOf: (i: number) => [number, number]) => {
    const seen = new Map<number, number>();
    for (const idx of cells) {
      const v = solution[idx];
      if (v === 0) continue;
      if (seen.has(v)) {
        const [r, c] = posOf(idx);
        failures.push({ code, message: `${label} 数字 ${v} 重复`, row: r, col: c, digit: v });
      } else seen.set(v, idx);
    }
  };
  for (let r = 0; r < 9; r++) {
    const cells = Array.from({ length: 9 }, (_, c) => r * 9 + c);
    checkUnit("ROW_DUP", `第 ${r + 1} 行`, cells, (i) => [r, i % 9]);
  }
  for (let c = 0; c < 9; c++) {
    const cells = Array.from({ length: 9 }, (_, r) => r * 9 + c);
    checkUnit("COL_DUP", `第 ${c + 1} 列`, cells, (i) => [Math.floor(i / 9), c]);
  }
  for (let b = 0; b < 9; b++) {
    const cells: number[] = [];
    const br = Math.floor(b / 3) * 3, bc = (b % 3) * 3;
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) cells.push((br + dr) * 9 + bc + dc);
    checkUnit("BOX_DUP", `第 ${b + 1} 宫`, cells, (i) => [Math.floor(i / 9), i % 9]);
  }
  for (let i = 0; i < 81; i++) {
    if (givens[i] !== 0 && solution[i] !== givens[i]) {
      failures.push({
        code: "CLUE_CHANGED",
        message: `第 ${Math.floor(i / 9) + 1} 行第 ${(i % 9) + 1} 列篡改了原线索 ${givens[i]} -> ${solution[i]}`,
        row: Math.floor(i / 9), col: i % 9, digit: solution[i],
      });
    }
  }
  return { ok: failures.length === 0, failures };
}
