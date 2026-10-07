// CLI：九行数字直接展示题与答案
import * as fs from "node:fs";
import { parseGrid, validateClues, verifySolution, gridToLines } from "./sudoku";
import { solveExactCover } from "./exactCover";

const UNIQUE_PUZZLE =
  "530070000" +
  "600195000" +
  "098000060" +
  "800060003" +
  "400803001" +
  "700020006" +
  "060000280" +
  "000419005" +
  "000080079";

function printGrid(title: string, grid: number[]): void {
  console.log(title);
  for (const line of gridToLines(grid)) console.log("  " + line);
}

function readInput(arg: string): string {
  if (fs.existsSync(arg)) return fs.readFileSync(arg, "utf8");
  return arg;
}

function cmdSolve(input: string, budget: number): number {
  const { grid, error } = parseGrid(readInput(input));
  if (error || !grid) { console.error(`INVALID_FORMAT: ${error}`); return 2; }
  const v = validateClues(grid);
  if (!v.ok) {
    console.error(`${v.errorCode}: ${v.message}`);
    for (const c of v.conflicts ?? []) {
      console.error(`  ${c.unit} ${c.unitIndex + 1} 数字 ${c.digit} 冲突于 ${c.cells.map(([r, cc]) => `(${r + 1},${cc + 1})`).join(" 与 ")}`);
    }
    return 2;
  }
  printGrid("题面:", grid);
  const report = solveExactCover(grid, budget);
  console.log(`状态: ${report.status}`);
  console.log(`停止原因: ${report.stopReason}`);
  console.log(`访问节点: ${report.nodesVisited}, 回溯: ${report.backtracks}, 预算: ${report.budget}`);
  report.solutions.forEach((s, i) => printGrid(`解 ${i + 1}:`, s));
  return report.status === "budget_exhausted" ? 3 : 0;
}

function cmdVerify(puzzleInput: string, solutionInput: string): number {
  const p = parseGrid(readInput(puzzleInput));
  if (p.error || !p.grid) { console.error(`INVALID_FORMAT(题面): ${p.error}`); return 2; }
  const s = parseGrid(readInput(solutionInput));
  if (s.error || !s.grid) { console.error(`INVALID_FORMAT(答案): ${s.error}`); return 2; }
  const vr = verifySolution(s.grid, p.grid);
  if (vr.ok) { console.log("核验通过：答案合法且保留全部原线索"); return 0; }
  console.log("核验失败:");
  for (const f of vr.failures) console.log(`  [${f.code}] ${f.message}`);
  return 1;
}

function cmdDemo(): number {
  console.log("=== 演示 1：唯一解题 ===");
  cmdSolve(UNIQUE_PUZZLE, 100000);
  console.log("\n=== 演示 2：直接冲突题 ===");
  cmdSolve("113456789" + "0".repeat(72), 100000);
  console.log("\n=== 演示 3：无直接重复但无解 ===");
  cmdSolve(
    "531070000600195000098000060800060003400803001700020006060000280" +
    "000419005000080079", 100000);
  console.log("\n=== 演示 4：空棋盘（多解，取前两份见证） ===");
  cmdSolve("0".repeat(81), 1000000);
  console.log("\n=== 演示 5：极小预算（结论未知） ===");
  cmdSolve(UNIQUE_PUZZLE, 5);
  return 0;
}

function main(): void {
  const [cmd, ...args] = process.argv.slice(2);
  let code = 0;
  if (cmd === "solve" && args[0]) {
    const bi = args.indexOf("--budget");
    const budget = bi >= 0 ? Number(args[bi + 1]) : 100000;
    if (!Number.isInteger(budget) || budget < 1) { console.error("INVALID_PARAM: --budget 必须是正整数"); process.exit(2); }
    code = cmdSolve(args[0], budget);
  } else if (cmd === "verify" && args[0] && args[1]) {
    code = cmdVerify(args[0], args[1]);
  } else if (cmd === "demo") {
    code = cmdDemo();
  } else {
    console.log(`用法:
  node dist/cli.js solve <81位数字|文件> [--budget N]   求解并分类
  node dist/cli.js verify <题面> <答案>                 独立核验外部答案
  node dist/cli.js demo                                 运行全部演示`);
    code = 2;
  }
  process.exit(code);
}

main();




