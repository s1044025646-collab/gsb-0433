import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server';

const UNIQUE_PUZZLE = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const UNIQUE_SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const CONFLICT_PUZZLE = '550070000600195000098000060800060003400803001700020006060000280000419005000080079';

async function api(port: number, method: string, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

test('API 全流程：导入、求解、步骤分页、核验、导出、版本与重启读取', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sudoku-'));
  const dbPath = join(dir, 'test.db');
  let server = await startServer(dbPath, 0);
  const port = server.port;
  try {
    // 非法格式
    let r = await api(port, 'POST', '/api/puzzles', { givens: '123' });
    assert.equal(r.status, 400);
    assert.equal((r.body.error as { code: string }).code, 'INVALID_FORMAT');

    // 直接冲突
    r = await api(port, 'POST', '/api/puzzles', { givens: CONFLICT_PUZZLE });
    assert.equal(r.status, 409);
    assert.equal((r.body.error as { code: string }).code, 'DIRECT_CONFLICT');
    assert.ok(Array.isArray((r.body.error as { details: unknown[] }).details));

    // 预算越界
    r = await api(port, 'POST', '/api/puzzles', { givens: UNIQUE_PUZZLE, budget: 0 });
    assert.equal(r.status, 400);
    assert.equal((r.body.error as { code: string }).code, 'BUDGET_RANGE');

    // 正常导入
    r = await api(port, 'POST', '/api/puzzles', { givens: UNIQUE_PUZZLE, budget: 500000 });
    assert.equal(r.status, 201);
    const puzzleId = r.body.puzzleId as number;
    const versionId = r.body.versionId as number;

    // 求解
    r = await api(port, 'POST', `/api/versions/${versionId}/solve`, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'unique');
    assert.deepEqual(r.body.solutions, [UNIQUE_SOLUTION]);
    const resultId = r.body.resultId as number;

    // 步骤分页
    r = await api(port, 'GET', `/api/results/${resultId}/steps?offset=0&limit=10`);
    assert.equal(r.status, 200);
    assert.equal((r.body.steps as unknown[]).length, 10);
    assert.ok((r.body.total as number) > 10);
    const r2 = await api(port, 'GET', `/api/results/${resultId}/steps?offset=10&limit=10`);
    assert.notDeepEqual(r.body.steps, r2.body.steps);

    // 外部答案核验：正确
    r = await api(port, 'POST', '/api/verify', { givens: UNIQUE_PUZZLE, solution: UNIQUE_SOLUTION });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);

    // 外部答案核验：篡改线索
    const tampered = '6' + UNIQUE_SOLUTION.slice(1);
    r = await api(port, 'POST', '/api/verify', { givens: UNIQUE_PUZZLE, solution: tampered });
    assert.equal(r.status, 422);
    assert.ok(((r.body.failures as Array<{ kind: string }>).some((f) => f.kind === 'clue')));

    // 导出
    r = await api(port, 'GET', `/api/results/${resultId}/export`);
    assert.equal(r.status, 200);
    assert.equal(r.body.algorithm, 'exact-cover-algorithm-x-v1');
    assert.ok(Array.isArray(r.body.steps));

    // 更改线索 -> 新版本
    r = await api(port, 'PUT', `/api/puzzles/${puzzleId}`, { givens: UNIQUE_PUZZLE.slice(0, 80) + '9' });
    assert.equal(r.status, 201);
    assert.equal(r.body.version, 2);

    // 不存在资源
    r = await api(port, 'GET', '/api/results/9999');
    assert.equal(r.status, 404);

    // 免持久化求解
    r = await api(port, 'POST', '/api/solve', { givens: UNIQUE_PUZZLE });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'unique');
  } finally {
    server.close();
  }

  // 重启后仍能读原解与原限制
  server = await startServer(dbPath, 0);
  try {
    const r = await api(server.port, 'GET', '/api/puzzles/1');
    assert.equal(r.status, 200);
    const versions = r.body.versions as Array<{ version: number; budget: number; results: Array<{ status: string; solutions: string[] }> }>;
    assert.equal(versions.length, 2);
    assert.equal(versions[0].budget, 500000);
    assert.equal(versions[0].results[0].status, 'unique');
    assert.deepEqual(versions[0].results[0].solutions, [UNIQUE_SOLUTION]);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
