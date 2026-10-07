import { resolve } from 'node:path';
import { parsePuzzle, findDirectConflicts, verifySolution, gridToString } from './sudoku';
import { solveExactCover } from './exactCover';
import { startServer } from './server';

const DB_PATH = process.env.SUDOKU_DB ?? resolve(process.cwd(), 'data', 'sudoku.db');

function printGrid(s: string): void {
  for (let r = 0; r < 9; r++) {
    const row = s.slice(r * 9, r * 9 + 9).split('').map((ch) => (ch === '0' ? '.' : ch)).join(' ');
    console.log('  ' + row);
  }
}

function fail(msg: string): never {
  console.error('错误: ' + msg);
  process.exit(1);
}

const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(`数独精确覆盖求解器 CLI

用法:
  node dist/cli.js solve <81字符题面> [--budget N]   求解（0 或 . 表示空格）
  node dist/cli.js verify <题面> <答案>              独立核验外部答案
  node dist/cli.js check <题面>                      仅校验线索格式与直接冲突
  node dist/cli.js serve [--port N]                  启动 API 服务（默认端口 0=自动选空闲端口）
  node dist/cli.js demo                              运行内置演示（唯一解/冲突/无解/多解/预算耗尽）
`);
  process.exit(0);
}

if (cmd === 'solve') {
  const input = args[1] ?? fail('缺少题面参数');
  const bIdx = args.indexOf('--budget');
  const budget = bIdx >= 0 ? Number(args[bIdx + 1]) : 1_000_000;
  if (!Number.isInteger(budget) || budget < 1 || budget > 10_000_000) fail('预算必须是 1..10000000 的整数');
  let grid;
  try {
    grid = parsePuzzle(input);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  const conflicts = findDirectConflicts(grid);
  if (conflicts.length > 0) {
    console.error('题面存在直接冲突:');
    for (const c of conflicts) {
      console.error(`  ${c.type === 'row' ? '行' : c.type === 'col' ? '列' : '宫'} ${c.index + 1} 数字 ${c.digit} 重复于 ${c.cells.map((x) => `(${x.row + 1},${x.col + 1})`).join(' ')}`);
    }
    process.exit(2);
  }
  console.log('题面:');
  printGrid(gridToString(grid));
  const result = solveExactCover(grid, { nodeBudget: budget });
  const label = { unique: '唯一解', multiple: '至少两解', none: '无解', exhausted: '预算耗尽（未知）' }[result.status];
  console.log(`\n结论: ${label}`);
  console.log(`节点数: ${result.nodesVisited}  回溯数: ${result.backtracks}`);
  console.log(`停止原因: ${result.stopReason}`);
  result.solutions.forEach((sol, i) => {
    const check = verifySolution(sol, grid);
    console.log(`\n解 ${i + 1}（独立核验: ${check.ok ? '通过' : '失败'}）:`);
    printGrid(sol);
  });
  process.exit(0);
}

if (cmd === 'verify') {
  const [givens, solution] = [args[1], args[2]];
  if (!givens || !solution) fail('用法: verify <题面> <答案>');
  const grid = parsePuzzle(givens);
  const check = verifySolution(solution, grid);
  if (check.ok) {
    console.log('核验通过：答案合法且未改动原线索。');
  } else {
    console.log('核验失败:');
    for (const f of check.failures) console.log('  - ' + f.message);
    process.exit(2);
  }
  process.exit(0);
}

if (cmd === 'check') {
  const input = args[1] ?? fail('缺少题面参数');
  const grid = parsePuzzle(input);
  const conflicts = findDirectConflicts(grid);
  if (conflicts.length > 0) {
    console.log('存在直接冲突:');
    for (const c of conflicts) {
      console.log(`  ${c.type === 'row' ? '行' : c.type === 'col' ? '列' : '宫'} ${c.index + 1} 数字 ${c.digit} 重复于 ${c.cells.map((x) => `(${x.row + 1},${x.col + 1})`).join(' ')}`);
    }
    process.exit(2);
  }
  console.log('线索格式合法，无直接冲突。');
  process.exit(0);
}

const main = async () => {
if (cmd === 'serve') {
  const pIdx = args.indexOf('--port');
  const port = pIdx >= 0 ? Number(args[pIdx + 1]) : Number(process.env.PORT ?? 0);
  const { port: actual } = await startServer(DB_PATH, port);
  console.log(`API 服务已启动: http://127.0.0.1:${actual}  (数据库: ${DB_PATH})`);
} else if (cmd === 'demo') {
  const demos: Array<[string, string, number?]> = [
    ['唯一解题', '530070000600195000098000060800060003400803001700020006060000280000419005000080079'],
    ['直接冲突题（行内两个 5）', '550070000600195000098000060800060003400803001700020006060000280000419005000080079'],
    ['无直接重复但无解', '200000000056789123089123456034567891067891234091234567045678912078912345012345678'],
    ['空棋盘（多解）', '0'.repeat(81)],
    ['极小预算（尚未确定）', '530070000600195000098000060800060003400803001700020006060000280000419005000080079', 1],
  ];
  for (const [name, puzzle, budget] of demos) {
    console.log('='.repeat(50));
    console.log(`演示: ${name}`);
    let grid;
    try {
      grid = parsePuzzle(puzzle);
    } catch (e) {
      console.log('  解析失败: ' + (e instanceof Error ? e.message : String(e)));
      continue;
    }
    const conflicts = findDirectConflicts(grid);
    if (conflicts.length > 0) {
      for (const c of conflicts) {
        console.log(`  直接冲突: ${c.type === 'row' ? '行' : c.type === 'col' ? '列' : '宫'} ${c.index + 1} 数字 ${c.digit} 于 ${c.cells.map((x) => `(${x.row + 1},${x.col + 1})`).join(' ')}`);
      }
      continue;
    }
    const result = solveExactCover(grid, { nodeBudget: budget ?? 1_000_000 });
    const label = { unique: '唯一解', multiple: '至少两解', none: '无解', exhausted: '预算耗尽（未知）' }[result.status];
    console.log(`  结论: ${label}  节点: ${result.nodesVisited}  回溯: ${result.backtracks}`);
    console.log(`  停止原因: ${result.stopReason}`);
    if (result.solutions.length > 0 && result.solutions[0].length === 81) {
      const check = verifySolution(result.solutions[0], grid);
      console.log(`  首份解（独立核验${check.ok ? '通过' : '失败'}）:`);
      printGrid(result.solutions[0]);
    }
  }
} else {
  fail(`未知命令: ${cmd}，用 help 查看用法`);
}

}
void main();

