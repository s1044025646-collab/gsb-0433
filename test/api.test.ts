import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Store } from "../src/db";
import { createServer } from "../src/server";

const PUZZLE =
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079";

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sudoku-test-"));
  const store = new Store(path.join(dir, "test.db"));
  const server = createServer(store);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  return { store, server, base: `http://127.0.0.1:${port}`, dir };
}

async function post(base: string, p: string, body: unknown) {
  const res = await fetch(base + p, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}
async function get(base: string, p: string) {
  const res = await fetch(base + p);
  return { status: res.status, body: await res.json() as any };
}

test("API 全流程：导入、求解、步骤分页、核验、导出、重启读取", async () => {
  const { store, server, base, dir } = await startServer();
  try {
    // 校验合法线索
    let r = await post(base, "/api/validate", { givens: PUZZLE });
    assert.equal(r.status, 200);
    // 校验冲突线索
    r = await post(base, "/api/validate", { givens: "11" + "0".repeat(79) });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, "CLUE_CONFLICT");
    // 非法格式
    r = await post(base, "/api/validate", { givens: "abc" });
    assert.equal(r.status, 400);

    // 导入
    r = await post(base, "/api/puzzles", { givens: PUZZLE });
    assert.equal(r.status, 201);
    const { puzzleId, versionId } = r.body;

    // 求解
    r = await post(base, `/api/versions/${versionId}/solve`, { budget: 50000 });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "unique");
    const resultId = r.body.resultId;
    const solution = r.body.solutions[0].join("").replace(/\./g, "0");

    // 结果读取
    r = await get(base, `/api/results/${resultId}`);
    assert.equal(r.body.status, "unique");
    assert.equal(r.body.budget, 50000);

    // 步骤分页
    r = await get(base, `/api/results/${resultId}/steps?page=1&pageSize=10`);
    assert.equal(r.status, 200);
    assert.equal(r.body.steps.length, 10);
    assert.ok(r.body.total > 10);
    const r2 = await get(base, `/api/results/${resultId}/steps?page=2&pageSize=10`);
    assert.notDeepEqual(r.body.steps[0], r2.body.steps[0]);

    // 核验正确解
    r = await post(base, `/api/results/${resultId}/verify`, { solution });
    assert.equal(r.status, 200);
    assert.ok(r.body.ok);
    // 核验篡改解
    const bad = "6" + solution.slice(1);
    r = await post(base, `/api/results/${resultId}/verify`, { solution: bad });
    assert.equal(r.status, 422);
    assert.ok(r.body.failures.length > 0);

    // 导出
    r = await get(base, `/api/results/${resultId}/export`);
    assert.equal(r.status, 200);
    assert.equal(r.body.givens, PUZZLE);
    assert.ok(Array.isArray(r.body.trace));

    // 新版本
    r = await post(base, `/api/puzzles/${puzzleId}/versions`, { givens: "0".repeat(81) });
    assert.equal(r.status, 201);
    assert.equal(r.body.version, 2);

    // 404
    r = await get(base, "/api/results/9999");
    assert.equal(r.status, 404);
    // 非法预算
    r = await post(base, `/api/versions/${versionId}/solve`, { budget: 0 });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, "INVALID_PARAM");

    // 重启（新 Store 实例读同一文件）后仍能读原解与原限制
    store.close();
    server.close();
    const store2 = new Store(path.join(dir, "test.db"));
    const saved = store2.getResult(resultId);
    assert.equal(saved.status, "unique");
    assert.equal(saved.budget, 50000);
    assert.equal(saved.algorithm, "exact-cover-algorithm-x-v1");
    store2.close();
  } finally {
    try { server.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
