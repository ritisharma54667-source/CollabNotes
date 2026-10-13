import * as Y from 'yjs';

export type Column = 'todo' | 'doing' | 'done';
export type Priority = 'low' | 'medium' | 'high';

export const COLUMNS: { id: Column; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'In progress' },
  { id: 'done', label: 'Done' },
];
export const PRIORITIES: Priority[] = ['low', 'medium', 'high'];

export interface Task {
  id: string;
  text: string;
  column: Column;
  order: number;
  priority: Priority;
  due: string; // YYYY-MM-DD or ''
}

/**
 * Each task is a Y.Map and a move only *sets fields* (`column`, `order`). Two people moving the
 * same card therefore resolve last-writer-wins per field — it can never be duplicated, which a
 * delete+insert based move would do.
 */
export function readTasks(yTasks: Y.Array<Y.Map<unknown>>): Task[] {
  return yTasks.toArray().map((m) => ({
    id: String(m.get('id')),
    text: String(m.get('text') ?? ''),
    column: (m.get('column') as Column) ?? 'todo',
    order: Number(m.get('order') ?? 0),
    priority: (m.get('priority') as Priority) ?? 'medium',
    due: String(m.get('due') ?? ''),
  }));
}

export function sortedColumn(tasks: Task[], column: Column): Task[] {
  return tasks
    .filter((t) => t.column === column)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)); // id tie-break keeps order stable across clients
}

export function orderBetween(prev?: number, next?: number): number {
  if (prev === undefined && next === undefined) return 1;
  if (prev === undefined) return next! - 1;
  if (next === undefined) return prev + 1;
  return (prev + next) / 2;
}

/** The `order` value that puts a task into `column`, directly before `beforeId` (or at the end). */
export function dropOrder(tasks: Task[], column: Column, movingId: string, beforeId: string | null): number {
  const list = sortedColumn(tasks, column).filter((t) => t.id !== movingId);
  if (beforeId === null) return orderBetween(list.at(-1)?.order, undefined);
  const idx = list.findIndex((t) => t.id === beforeId);
  if (idx === -1) return orderBetween(list.at(-1)?.order, undefined);
  return orderBetween(list[idx - 1]?.order, list[idx].order);
}

export function isOverdue(due: string, now = new Date()): boolean {
  if (!due) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return new Date(`${due}T00:00:00`).getTime() < today;
}
