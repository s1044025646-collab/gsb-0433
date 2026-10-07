// HTTP API 服务（仅后端，无界面）
import * as http from "node:http";
import * as path from "node:path";
import { parseGrid, validateClues, verifySolution, gridToLines, Grid } from "./sudoku";
import { solveExactCover } from "./exactCover";
import { Store, ALGORITHM_ID } from "./db";

const DEFAULT_BUDGET = 100000;
const MAX_BUDGET = 10_000_000;

interface ApiError { code: string; message: string; details?: unknown }

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}
function sendErr(res: http.ServerResponse, status: number, err: ApiError): void {
  send(res, status, { error: err });
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error("invalid JSON body"), { code: "INVALID_FORMAT" })); }
    });
    req.on("error", reject);
  });
}

function parseGivensParam(body: any): { grid?: Grid; givens?: string; err?: ApiError } {
  if (typeof body?.givens !== "string") {
    return { err: { code: "INVALID_PARAM", message: "缺少字符串参数 givens（81 个 0-9/. 字符或 9 行）" } };
  }
  const { grid, error } = parseGrid(body.givens);
  if (error || !grid) return { err: { code: "INVALID_FORMAT", message: error! } };
  return { grid, givens: grid.join("") };
}

function parseBudget(v: unknown): { budget?: number; err?: ApiError } {
  if (v === undefined || v === null) return { budget: DEFAULT_BUDGET };
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > MAX_BUDGET) {
    return { err: { code: "INVALID_PARAM", message: `budget 必须是 1..${MAX_BUDGET} 的整数` } };
  }
  return { budget: v as number };
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      // POST /api/validate { givens }
      if (req.method === "POST" && url.pathname === "/api/validate") {
        const body = await readBody(req);
        const { grid, err } = parseGivensParam(body);
        if (err) return sendErr(res, 400, err);
        const v = validateClues(grid!);
        if (!v.ok) return sendErr(res, 422, { code: v.errorCode!, message: v.message!, details: v.conflicts });
        return send(res, 200, { ok: true, message: "线索格式合法且无直接重复" });
      }

      // POST /api/puzzles { givens } 导入题面（首个版本）
      if (req.method === "POST" && url.pathname === "/api/puzzles") {
        const body = await readBody(req);
        const { grid, givens, err } = parseGivensParam(body);
        if (err) return sendErr(res, 400, err);
        const v = validateClues(grid!);
        if (!v.ok) return sendErr(res, 422, { code: v.errorCode!, message: v.message!, details: v.conflicts });
        const created = store.createPuzzle(givens!);
        return send(res, 201, { ...created, givens });
      }

      // POST /api/puzzles/:id/versions { givens } 修改线索 -> 新版本
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "puzzles" && parts[3] === "versions") {
        const puzzleId = Number(parts[2]);
        if (!Number.isInteger(puzzleId)) return sendErr(res, 400, { code: "INVALID_PARAM", message: "puzzle id 非法" });
        const body = await readBody(req);
        const { grid, givens, err } = parseGivensParam(body);
        if (err) return sendErr(res, 400, err);
        const v = validateClues(grid!);
        if (!v.ok) return sendErr(res, 422, { code: v.errorCode!, message: v.message!, details: v.conflicts });
        if (!store.getPuzzle(puzzleId)) return sendErr(res, 404, { code: "NOT_FOUND", message: "题面不存在" });
        const created = store.addVersion(puzzleId, givens!);
        return send(res, 201, { puzzleId, ...created, givens });
      }

      // GET /api/puzzles/:id
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "puzzles" && parts.length === 3) {
        const puzzleId = Number(parts[2]);
        const p = store.getPuzzle(puzzleId);
        if (!p) return sendErr(res, 404, { code: "NOT_FOUND", message: "题面不存在" });
        return send(res, 200, p);
      }

      // POST /api/versions/:id/solve { budget? }
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "versions" && parts[3] === "solve") {
        const versionId = Number(parts[2]);
        const version = store.getVersion(versionId);
        if (!version) return sendErr(res, 404, { code: "NOT_FOUND", message: "版本不存在" });
        const body = await readBody(req);
        const { budget, err } = parseBudget(body?.budget);
        if (err) return sendErr(res, 400, err);
        const givens = version.givens.split("").map((ch: string) => Number(ch));
        const report = solveExactCover(givens, budget!);
        const resultId = store.saveResult(versionId, budget!, report);
        return send(res, 200, {
          resultId, versionId, budget, algorithm: ALGORITHM_ID,
          status: report.status, nodesVisited: report.nodesVisited,
          backtracks: report.backtracks, stopReason: report.stopReason,
          solutions: report.solutions.map(gridToLines),
          traceSteps: report.trace.length, traceTruncated: report.traceTruncated,
        });
      }

      // GET /api/versions/:id/results
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "versions" && parts[3] === "results") {
        const versionId = Number(parts[2]);
        if (!store.getVersion(versionId)) return sendErr(res, 404, { code: "NOT_FOUND", message: "版本不存在" });
        return send(res, 200, { results: store.listResults(versionId) });
      }

      // GET /api/results/:id
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "results" && parts.length === 3) {
        const r = store.getResult(Number(parts[2]));
        if (!r) return sendErr(res, 404, { code: "NOT_FOUND", message: "结果不存在" });
        const solutions = (JSON.parse(r.solutions) as Grid[]).map(gridToLines);
        return send(res, 200, {
          resultId: r.id, versionId: r.version_id, budget: r.budget, algorithm: r.algorithm,
          status: r.status, nodesVisited: r.nodes_visited, backtracks: r.backtracks,
          stopReason: r.stop_reason, solutions, traceSteps: JSON.parse(r.trace).length,
          traceTruncated: !!r.trace_truncated, createdAt: r.created_at,
        });
      }

      // GET /api/results/:id/steps?page=1&pageSize=100
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "results" && parts[3] === "steps") {
        const r = store.getResult(Number(parts[2]));
        if (!r) return sendErr(res, 404, { code: "NOT_FOUND", message: "结果不存在" });
        const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
        const pageSize = Math.min(1000, Math.max(1, Number(url.searchParams.get("pageSize") ?? "100") || 100));
        const trace = JSON.parse(r.trace) as unknown[];
        const start = (page - 1) * pageSize;
        return send(res, 200, {
          resultId: r.id, page, pageSize, total: trace.length,
          steps: trace.slice(start, start + pageSize),
        });
      }

      // POST /api/results/:id/verify { solution: "81chars" } 核验外部答案
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "results" && parts[3] === "verify") {
        const r = store.getResult(Number(parts[2]));
        if (!r) return sendErr(res, 404, { code: "NOT_FOUND", message: "结果不存在" });
        const version = store.getVersion(r.version_id);
        const body = await readBody(req);
        if (typeof body?.solution !== "string") {
          return sendErr(res, 400, { code: "INVALID_PARAM", message: "缺少字符串参数 solution" });
        }
        const { grid, error } = parseGrid(body.solution);
        if (error || !grid) return sendErr(res, 400, { code: "INVALID_FORMAT", message: error! });
        const givens = version.givens.split("").map((ch: string) => Number(ch));
        const vr = verifySolution(grid, givens);
        return send(res, vr.ok ? 200 : 422, { ok: vr.ok, failures: vr.failures });
      }

      // GET /api/results/:id/export
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "results" && parts[3] === "export") {
        const r = store.getResult(Number(parts[2]));
        if (!r) return sendErr(res, 404, { code: "NOT_FOUND", message: "结果不存在" });
        const version = store.getVersion(r.version_id);
        return send(res, 200, {
          exportedAt: new Date().toISOString(),
          algorithm: r.algorithm,
          givens: version.givens,
          budget: r.budget,
          status: r.status,
          nodesVisited: r.nodes_visited,
          backtracks: r.backtracks,
          stopReason: r.stop_reason,
          solutions: JSON.parse(r.solutions),
          trace: JSON.parse(r.trace),
        });
      }

      return sendErr(res, 404, { code: "NOT_FOUND", message: "路由不存在" });
    } catch (e: any) {
      return sendErr(res, 500, { code: "INTERNAL", message: String(e?.message ?? e) });
    }
  });
}

function main(): void {
  const dbPath = process.env.SUDOKU_DB ?? path.join(__dirname, "..", "data", "sudoku.db");
  const store = new Store(dbPath);
  const server = createServer(store);
  // 默认端口 0 = 让系统分配空闲端口；可用 PORT 环境变量指定
  const port = process.env.PORT ? Number(process.env.PORT) : 0;
  server.listen(port, () => {
    const addr = server.address();
    const p = typeof addr === "object" && addr ? addr.port : port;
    console.log(`Sudoku API listening on http://127.0.0.1:${p}`);
    console.log(`Database: ${dbPath}`);
  });
}

if (require.main === module) main();
