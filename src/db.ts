import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SolveResult } from './exactCover';

export interface ResultRow {
  id: number;
  version_id: number;
  status: string;
  nodes: number;
  backtracks: number;
  stop_reason: string;
  solutions: string;   // JSON
  steps: string;       // JSON
  steps_truncated: number;
  algorithm: string;
  node_budget: number;
  created_at: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
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
        budget INTEGER NOT NULL,
        algorithm TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(puzzle_id, version)
      );
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER NOT NULL REFERENCES puzzle_versions(id),
        status TEXT NOT NULL,
        nodes INTEGER NOT NULL,
        backtracks INTEGER NOT NULL,
        stop_reason TEXT NOT NULL,
        solutions TEXT NOT NULL,
        steps TEXT NOT NULL,
        steps_truncated INTEGER NOT NULL,
        algorithm TEXT NOT NULL,
        node_budget INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  close(): void { this.db.close(); }

  /** 新建题目（含首个版本）。失败时事务回滚，不留半份结果。 */
  createPuzzle(givens: string, budget: number, algorithm: string): { puzzleId: number; versionId: number } {
    this.db.exec('BEGIN');
    try {
      const p = this.db.prepare('INSERT INTO puzzles DEFAULT VALUES').run();
      const puzzleId = Number(p.lastInsertRowid);
      const v = this.db.prepare('INSERT INTO puzzle_versions (puzzle_id, version, givens, budget, algorithm) VALUES (?, 1, ?, ?, ?)')
        .run(puzzleId, givens, budget, algorithm);
      this.db.exec('COMMIT');
      return { puzzleId, versionId: Number(v.lastInsertRowid) };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** 更改线索 -> 新版本。 */
  addVersion(puzzleId: number, givens: string, budget: number, algorithm: string): { versionId: number; version: number } {
    const row = this.db.prepare('SELECT MAX(version) AS mv FROM puzzle_versions WHERE puzzle_id = ?').get(puzzleId) as { mv: number | null } | undefined;
    if (!row || row.mv === null) throw Object.assign(new Error(`题目 ${puzzleId} 不存在`), { code: 'NOT_FOUND' });
    const version = row.mv + 1;
    const v = this.db.prepare('INSERT INTO puzzle_versions (puzzle_id, version, givens, budget, algorithm) VALUES (?, ?, ?, ?, ?)')
      .run(puzzleId, version, givens, budget, algorithm);
    return { versionId: Number(v.lastInsertRowid), version };
  }

  saveResult(versionId: number, result: SolveResult): number {
    const r = this.db.prepare(
      `INSERT INTO results (version_id, status, nodes, backtracks, stop_reason, solutions, steps, steps_truncated, algorithm, node_budget)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      versionId, result.status, result.nodesVisited, result.backtracks, result.stopReason,
      JSON.stringify(result.solutions), JSON.stringify(result.steps),
      result.stepsTruncated ? 1 : 0, result.algorithm, result.nodeBudget,
    );
    return Number(r.lastInsertRowid);
  }

  getPuzzle(puzzleId: number) {
    const puzzle = this.db.prepare('SELECT * FROM puzzles WHERE id = ?').get(puzzleId);
    if (!puzzle) return null;
    const versions = this.db.prepare('SELECT * FROM puzzle_versions WHERE puzzle_id = ? ORDER BY version').all(puzzleId);
    return { puzzle, versions };
  }

  getVersion(versionId: number) {
    return this.db.prepare('SELECT * FROM puzzle_versions WHERE id = ?').get(versionId) as
      | { id: number; puzzle_id: number; version: number; givens: string; budget: number; algorithm: string }
      | undefined;
  }

  getResult(resultId: number): ResultRow | undefined {
    return this.db.prepare('SELECT * FROM results WHERE id = ?').get(resultId) as ResultRow | undefined;
  }

  listResults(versionId: number): ResultRow[] {
    return this.db.prepare('SELECT * FROM results WHERE version_id = ? ORDER BY id').all(versionId) as unknown as ResultRow[];
  }
}
