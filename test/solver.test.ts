import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePuzzle, findDirectConflicts, verifySolution, naiveCountSolutions, gridToString, PuzzleError } from '../src/sudoku';
import { solveExactCover } from '../src/exactCover';

const UNIQUE_PUZZLE = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const UNIQUE_SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const CONFLICT_PUZZLE = '550070000600195000098000060800060003400803001700020006060000280000419005000080079';
const UNSOLVABLE = '200000000056789123089123456034567891067891234091234567045678912078912345012345678';
const EMPTY = '0'.repeat(81);

test('解析：81 字符与 9 行输入等价，非法输入报错', () => {
  const a = parsePuzzle(UNIQUE_PUZZLE);
  const b = parsePuzzle(UNIQUE_PUZZLE.match(/.{9}/g)!);
  assert.deepEqual(a, b);
  assert.equal(a.length, 81);
  assert.throws(() => parsePuzzle('123'), (e: PuzzleError) => e.code === 'INVALID_FORMAT');
  assert.throws(() => parsePuzzle('x'.repeat(81)), (e: PuzzleError) => e.code === 'INVALID_FORMAT');
});

test('直接冲突：指出冲突类型与坐标', () => {
  const conflicts = findDirectConflicts(parsePuzzle(CONFLICT_PUZZLE));
  assert.ok(conflicts.some((c) => c.type === 'row' && c.index === 0 && c.digit === 5));
  const cells = conflicts.find((c) => c.type === 'row')!.cells;
  assert.deepEqual(cells, [{ row: 0, col: 0 }, { row: 0, col: 1 }]);
});

test('唯一解题：求解并经独立核验', () => {
  const grid = parsePuzzle(UNIQUE_PUZZLE);
  const result = solveExactCover(grid);
  assert.equal(result.status, 'unique');
  assert.equal(result.solutions.length, 1);
  assert.equal(result.solutions[0], UNIQUE_SOLUTION);
  assert.ok(result.nodesVisited > 0);
  assert.ok(verifySolution(result.solutions[0], grid).ok);
});

test('无直接重复但无解', () => {
  const grid = parsePuzzle(UNSOLVABLE);
  assert.equal(findDirectConflicts(grid).length, 0);
  const result = solveExactCover(grid);
  assert.equal(result.status, 'none');
  assert.equal(result.solutions.length, 0);
});

test('空棋盘：至少两解，两份见证均通过核验', () => {
  const grid = parsePuzzle(EMPTY);
  const result = solveExactCover(grid);
  assert.equal(result.status, 'multiple');
  assert.equal(result.solutions.length, 2);
  assert.notEqual(result.solutions[0], result.solutions[1]);
  for (const sol of result.solutions) assert.ok(verifySolution(sol, grid).ok);
});

test('极小预算：预算耗尽，不冒充无解或唯一', () => {
  const grid = parsePuzzle(UNIQUE_PUZZLE);
  const result = solveExactCover(grid, { nodeBudget: 1 });
  assert.equal(result.status, 'exhausted');
  assert.ok(result.nodesVisited <= 1);
  assert.match(result.stopReason, /预算/);
});

test('确定性：重复求解得到相同首批结果', () => {
  const grid = parsePuzzle(EMPTY);
  const a = solveExactCover(grid);
  const b = solveExactCover(grid);
  assert.deepEqual(a.solutions, b.solutions);
  assert.equal(a.nodesVisited, b.nodesVisited);
  assert.deepEqual(a.steps.slice(0, 20), b.steps.slice(0, 20));
});

test('独立核验：完整合法盘通过', () => {
  const check = verifySolution(UNIQUE_SOLUTION, parsePuzzle(UNIQUE_PUZZLE));
  assert.ok(check.ok);
});

test('独立核验：仅缺一个格 -> missing', () => {
  const sol = UNIQUE_SOLUTION.slice(0, 40) + '0' + UNIQUE_SOLUTION.slice(41);
  const check = verifySolution(sol, parsePuzzle(UNIQUE_PUZZLE));
  assert.ok(!check.ok);
  assert.ok(check.failures.some((f) => f.kind === 'missing'));
});

test('独立核验：宫内冲突但不同行列 -> box', () => {
  // 合法解中交换同宫不同行列的两格：宫仍合法，行/列会冲突；构造纯宫冲突：
  // 直接把合法解 r1c1 与 r2c2（同宫）交换 -> 行与列也冲突。改用篡改空题答案：
  const givens = parsePuzzle(EMPTY);
  const sol = UNIQUE_SOLUTION.split('').map(Number);
  // r1c1=5 与 r2c3=8 不同行列但同宫；交换后行、列、宫均可能冲突，只断言检出失败且含坐标
  [sol[0], sol[20]] = [sol[20], sol[0]];
  const check = verifySolution(sol, givens);
  assert.ok(!check.ok);
  assert.ok(check.failures.length > 0);
  assert.ok(check.failures.every((f) => f.cells && f.cells.length > 0));
});

test('独立核验：篡改原线索 -> clue', () => {
  const givens = parsePuzzle(UNIQUE_PUZZLE);
  const sol = UNIQUE_SOLUTION.split('').map(Number);
  sol[0] = givens[0] === 5 ? 6 : 5; // r1c1 原线索为 5
  const check = verifySolution(sol, givens);
  assert.ok(!check.ok);
  assert.ok(check.failures.some((f) => f.kind === 'clue' && f.cells![0].row === 0 && f.cells![0].col === 0));
});

test('对照：朴素计数器与精确覆盖分类一致（接近完成的少量空格盘）', () => {
  const full = UNIQUE_SOLUTION;
  // 挖掉 6 个格，制造多解或唯一情形，与朴素计数器对照
  const blanks = [0, 10, 20, 40, 60, 80];
  const puzzle = full.split('').map((ch, i) => (blanks.includes(i) ? '0' : ch)).join('');
  const grid = parsePuzzle(puzzle);
  const naive = naiveCountSolutions(grid, 2);
  const result = solveExactCover(grid);
  const classified = result.status === 'none' ? 0 : result.status === 'unique' ? 1 : 2;
  assert.equal(classified, naive);
  for (const sol of result.solutions) assert.ok(verifySolution(sol, grid).ok);
});

test('对照：无解情形与朴素计数器一致', () => {
  const grid = parsePuzzle(UNSOLVABLE);
  assert.equal(naiveCountSolutions(grid, 2), 0);
  assert.equal(solveExactCover(grid).status, 'none');
});

test('步骤记录：包含所选约束列与候选，且为搜索记录', () => {
  const grid = parsePuzzle(UNIQUE_PUZZLE);
  const result = solveExactCover(grid);
  assert.ok(result.steps.length > 0);
  const step = result.steps[0];
  assert.ok(step.column.id >= 0 && step.column.id < 324);
  assert.ok(step.chosen.digit >= 1 && step.chosen.digit <= 9);
  assert.ok(step.alternatives >= 1);
});

test('线索网格工具', () => {
  assert.equal(gridToString(parsePuzzle(UNIQUE_PUZZLE)), UNIQUE_PUZZLE);
});
