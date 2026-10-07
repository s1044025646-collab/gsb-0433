import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Store } from './db';
import { parsePuzzle, findDirectConflicts, verifySolution, PuzzleError, gridToString } from './sudoku';
import { solveExactCover, ALGORITHM_ID } from './exactCover';

const MIN_BUDGET = 1;
const MAX_BUDGET = 10_000_000;
const MAX_STEP_LIMIT = 500;

function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}

function sendError(res: ServerResponse, status: number, code: string, message: string, details?: unknown): void {
  send(res, status, { error: { code, message, details } });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new PuzzleError('INVALID_JSON', '请求体不是合法 JSON');
  }
}

function parseBudget(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_BUDGET || n > MAX_BUDGET) {
    throw new PuzzleError('BUDGET_RANGE', `预算必须是 ${MIN_BUDGET}..${MAX_BUDGET} 的整数`, { min: MIN_BUDGET, max: MAX_BUDGET });
  }
  return n;
}

function validateGivens(raw: unknown): { givens: string } {
  const grid = parsePuzzle(raw as string | string[]);
  const conflicts = findDirectConflicts(grid);
  if (conflicts.length > 0) {
    throw new PuzzleError('DIRECT_CONFLICT', '题面存在行/列/宫直接重复', conflicts);
  }
  return { givens: gridToString(grid) };
}

export function createApp(store: Store) {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'POST' && path === '/api/puzzles') {
      const body = (await readBody(req)) as Record<string, unknown>;
      const { givens } = validateGivens(body.givens);
      const budget = parseBudget(body.budget, 1_000_000);
      const { puzzleId, versionId } = store.createPuzzle(givens, budget, ALGORITHM_ID);
      send(res, 201, { puzzleId, versionId, version: 1, givens, budget, algorithm: ALGORITHM_ID });
      return;
    }

    const putPuzzle = path.match(/^\/api\/puzzles\/(\d+)$/);
    if (method === 'PUT' && putPuzzle) {
      const puzzleId = Number(putPuzzle[1]);
      const body = (await readBody(req)) as Record<string, unknown>;
      const { givens } = validateGivens(body.givens);
      const budget = parseBudget(body.budget, 1_000_000);
      const { versionId, version } = store.addVersion(puzzleId, givens, budget, ALGORITHM_ID);
      send(res, 201, { puzzleId, versionId, version, givens, budget, algorithm: ALGORITHM_ID });
      return;
    }

    if (method === 'GET' && putPuzzle) {
      const data = store.getPuzzle(Number(putPuzzle[1]));
      if (!data) return sendError(res, 404, 'NOT_FOUND', '题目不存在');
      const versions = (data.versions as Array<Record<string, unknown>>).map((v) => ({
        ...v,
        results: store.listResults(v.id as number).map((r) => ({
          resultId: r.id, status: r.status, nodes: r.nodes, backtracks: r.backtracks,
          stopReason: r.stop_reason, solutions: JSON.parse(r.solutions), algorithm: r.algorithm,
          nodeBudget: r.node_budget, createdAt: r.created_at,
        })),
      }));
      send(res, 200, { puzzle: data.puzzle, versions });
      return;
    }

    const solveVersion = path.match(/^\/api\/versions\/(\d+)\/solve$/);
    if (method === 'POST' && solveVersion) {
      const version = store.getVersion(Number(solveVersion[1]));
      if (!version) return sendError(res, 404, 'NOT_FOUND', '版本不存在');
      const body = (await readBody(req)) as Record<string, unknown>;
      const budget = parseBudget(body.budget, version.budget);
      const grid = parsePuzzle(version.givens);
      const result = solveExactCover(grid, { nodeBudget: budget });
      // 所有输出解必须经独立行列宫核验
      for (const sol of result.solutions) {
        const check = verifySolution(sol, grid);
        if (!check.ok) return sendError(res, 500, 'INTERNAL', '求解器输出未通过独立核验', check.failures);
      }
      const resultId = store.saveResult(version.id, result);
      send(res, 200, {
        resultId, versionId: version.id, status: result.status, solutions: result.solutions,
        nodesVisited: result.nodesVisited, backtracks: result.backtracks, stopReason: result.stopReason,
        stepsTruncated: result.stepsTruncated, algorithm: result.algorithm, nodeBudget: result.nodeBudget,
      });
      return;
    }

    if (method === 'POST' && path === '/api/solve') {
      const body = (await readBody(req)) as Record<string, unknown>;
      const { givens } = validateGivens(body.givens);
      const budget = parseBudget(body.budget, 1_000_000);
      const grid = parsePuzzle(givens);
      const result = solveExactCover(grid, { nodeBudget: budget });
      for (const sol of result.solutions) {
        const check = verifySolution(sol, grid);
        if (!check.ok) return sendError(res, 500, 'INTERNAL', '求解器输出未通过独立核验', check.failures);
      }
      send(res, 200, { ...result, steps: undefined, stepCount: result.steps.length });
      return;
    }

    const resultMatch = path.match(/^\/api\/results\/(\d+)$/);
    if (method === 'GET' && resultMatch) {
      const r = store.getResult(Number(resultMatch[1]));
      if (!r) return sendError(res, 404, 'NOT_FOUND', '结果不存在');
      send(res, 200, {
        resultId: r.id, versionId: r.version_id, status: r.status, solutions: JSON.parse(r.solutions),
        nodesVisited: r.nodes, backtracks: r.backtracks, stopReason: r.stop_reason,
        stepCount: (JSON.parse(r.steps) as unknown[]).length, stepsTruncated: !!r.steps_truncated,
        algorithm: r.algorithm, nodeBudget: r.node_budget, createdAt: r.created_at,
      });
      return;
    }

    const stepsMatch = path.match(/^\/api\/results\/(\d+)\/steps$/);
    if (method === 'GET' && stepsMatch) {
      const r = store.getResult(Number(stepsMatch[1]));
      if (!r) return sendError(res, 404, 'NOT_FOUND', '结果不存在');
      const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
      const limit = Math.min(MAX_STEP_LIMIT, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100));
      const steps = JSON.parse(r.steps) as unknown[];
      send(res, 200, { resultId: r.id, total: steps.length, offset, limit, steps: steps.slice(offset, offset + limit) });
      return;
    }

    const exportMatch = path.match(/^\/api\/results\/(\d+)\/export$/);
    if (method === 'GET' && exportMatch) {
      const r = store.getResult(Number(exportMatch[1]));
      if (!r) return sendError(res, 404, 'NOT_FOUND', '结果不存在');
      const version = store.getVersion(r.version_id);
      send(res, 200, {
        resultId: r.id, version, status: r.status, solutions: JSON.parse(r.solutions),
        nodesVisited: r.nodes, backtracks: r.backtracks, stopReason: r.stop_reason,
        steps: JSON.parse(r.steps), stepsTruncated: !!r.steps_truncated,
        algorithm: r.algorithm, nodeBudget: r.node_budget, createdAt: r.created_at,
      });
      return;
    }

    if (method === 'POST' && path === '/api/verify') {
      const body = (await readBody(req)) as Record<string, unknown>;
      const grid = parsePuzzle(body.givens as string | string[]);
      const check = verifySolution(body.solution, grid);
      send(res, check.ok ? 200 : 422, { ok: check.ok, failures: check.failures });
      return;
    }

    sendError(res, 404, 'NOT_FOUND', `${method} ${path} 不存在`);
  };

  return createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (e instanceof PuzzleError) {
        const status = e.code === 'DIRECT_CONFLICT' ? 409 : e.code === 'NOT_FOUND' ? 404 : 400;
        sendError(res, status, e.code, e.message, e.details);
      } else if (e && (e as { code?: string }).code === 'NOT_FOUND') {
        sendError(res, 404, 'NOT_FOUND', (e as Error).message);
      } else {
        sendError(res, 500, 'INTERNAL', e instanceof Error ? e.message : String(e));
      }
    });
  });
}

export function startServer(dbPath: string, port: number): Promise<{ port: number; close: () => void }> {
  const store = new Store(dbPath);
  const server = createApp(store);
  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ port: actual, close: () => { server.close(); store.close(); } });
    });
  });
}
