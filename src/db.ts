// SQLite 持久化：题面版本、预算、算法口径与求解结果
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { SolveReport } from "./exactCover";

export const ALGORITHM_ID = "exact-cover-algorithm-x-v1";

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS puzzles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS puzzle_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        puzzle_id INTEGER NOT NULL REFERENCES puzzles(id),
        version INTEGER NOT NULL,
        givens TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(puzzle_id, version)
      );
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER NOT NULL REFERENCES puzzle_versions(id),
        budget INTEGER NOT NULL,
        algorithm TEXT NOT NULL,
        status TEXT NOT NULL,
        nodes_visited INTEGER NOT NULL,
        backtracks INTEGER NOT NULL,
        stop_reason TEXT NOT NULL,
        solutions TEXT NOT NULL,
        trace TEXT NOT NULL,
        trace_truncated INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  close(): void { this.db.close(); }

  createPuzzle(givens: string): { puzzleId: number; versionId: number; version: number } {
    const tx = this.db.prepare("INSERT INTO puzzles DEFAULT VALUES");
    const info = tx.run();
    const puzzleId = Number(info.lastInsertRowid);
    try {
      const v = this.addVersion(puzzleId, givens);
      return { puzzleId, versionId: v.versionId, version: v.version };
    } catch (e) {
      this.db.prepare("DELETE FROM puzzles WHERE id = ?").run(puzzleId);
      throw e;
    }
  }

  addVersion(puzzleId: number, givens: string): { versionId: number; version: number } {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(version), 0) AS mv FROM puzzle_versions WHERE puzzle_id = ?"
    ).get(puzzleId) as { mv: number } | undefined;
    if (!row) throw Object.assign(new Error("puzzle not found"), { code: "NOT_FOUND" });
    // 确认题面存在
    const p = this.db.prepare("SELECT id FROM puzzles WHERE id = ?").get(puzzleId);
    if (!p) throw Object.assign(new Error("puzzle not found"), { code: "NOT_FOUND" });
    const version = row.mv + 1;
    const info = this.db.prepare(
      "INSERT INTO puzzle_versions (puzzle_id, version, givens) VALUES (?, ?, ?)"
    ).run(puzzleId, version, givens);
    return { versionId: Number(info.lastInsertRowid), version };
  }

  getPuzzle(puzzleId: number) {
    const p = this.db.prepare("SELECT * FROM puzzles WHERE id = ?").get(puzzleId) as any;
    if (!p) return null;
    const versions = this.db.prepare(
      "SELECT id, version, givens, created_at FROM puzzle_versions WHERE puzzle_id = ? ORDER BY version"
    ).all(puzzleId) as any[];
    return { ...p, versions };
  }

  getVersion(versionId: number) {
    return this.db.prepare("SELECT * FROM puzzle_versions WHERE id = ?").get(versionId) as any;
  }

  saveResult(versionId: number, budget: number, report: SolveReport): number {
    const info = this.db.prepare(
      `INSERT INTO results (version_id, budget, algorithm, status, nodes_visited, backtracks,
        stop_reason, solutions, trace, trace_truncated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      versionId, budget, ALGORITHM_ID, report.status, report.nodesVisited, report.backtracks,
      report.stopReason, JSON.stringify(report.solutions), JSON.stringify(report.trace),
      report.traceTruncated ? 1 : 0
    );
    return Number(info.lastInsertRowid);
  }

  getResult(resultId: number) {
    return this.db.prepare("SELECT * FROM results WHERE id = ?").get(resultId) as any;
  }

  listResults(versionId: number) {
    return this.db.prepare(
      "SELECT id, budget, algorithm, status, nodes_visited, backtracks, stop_reason, created_at FROM results WHERE version_id = ? ORDER BY id"
    ).all(versionId) as any[];
  }
}
