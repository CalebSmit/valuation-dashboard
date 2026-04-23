/**
 * Dexie.js (IndexedDB) database for persisting valuation runs and settings.
 */
import Dexie, { type Table } from 'dexie'
import type { ValuationRun } from '../types/ValuationRun.ts'

interface SettingRecord {
  key: string
  value: string
}

class ValuationDB extends Dexie {
  runs!: Table<ValuationRun>
  settings!: Table<SettingRecord>

  constructor() {
    super('ValuationDashboard')
    this.version(1).stores({
      runs: 'id, ticker, createdAt, status',
      settings: 'key',
    })
  }
}

export const db = new ValuationDB()

const MAX_RUNS = 100

async function enforceRunLimit(): Promise<void> {
  const count = await db.runs.count()
  if (count > MAX_RUNS) {
    const oldest = await db.runs
      .orderBy('createdAt')
      .limit(count - MAX_RUNS)
      .toArray()
    const idsToDelete = oldest.map(r => r.id)
    await db.runs.bulkDelete(idsToDelete)
  }
}

export async function saveRun(run: ValuationRun): Promise<string> {
  await db.runs.put(run)
  await enforceRunLimit()
  return run.id
}

export async function updateRun(
  id: string,
  partial: Partial<ValuationRun>,
): Promise<void> {
  await db.runs.update(id, partial)
}

export async function getAllRuns(): Promise<ValuationRun[]> {
  return db.runs.orderBy('createdAt').reverse().toArray()
}

export async function getRun(id: string): Promise<ValuationRun | undefined> {
  return db.runs.get(id)
}

export async function deleteRun(id: string): Promise<void> {
  await db.runs.delete(id)
}

export async function getSetting(key: string): Promise<string | undefined> {
  const record = await db.settings.get(key)
  return record?.value
}

export async function saveSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value })
}
