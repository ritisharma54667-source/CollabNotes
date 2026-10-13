import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { dropOrder, isOverdue, orderBetween, readTasks, sortedColumn, type Task } from './tasks';

const t = (id: string, column: Task['column'], order: number): Task => ({ id, text: id, column, order, priority: 'medium', due: '' });

describe('orderBetween', () => {
  it('handles empty, head, tail and middle positions', () => {
    expect(orderBetween()).toBe(1);
    expect(orderBetween(undefined, 5)).toBe(4);
    expect(orderBetween(5, undefined)).toBe(6);
    expect(orderBetween(1, 2)).toBe(1.5);
  });
});

describe('dropOrder', () => {
  const tasks = [t('a', 'todo', 1), t('b', 'todo', 2), t('c', 'todo', 3), t('x', 'done', 1)];

  it('places a card before another card', () => {
    const order = dropOrder(tasks, 'todo', 'c', 'b');
    expect(order).toBeGreaterThan(1);
    expect(order).toBeLessThan(2);
  });
  it('places a card first in a column', () => {
    expect(dropOrder(tasks, 'todo', 'c', 'a')).toBeLessThan(1);
  });
  it('appends when dropped on the column itself', () => {
    expect(dropOrder(tasks, 'done', 'a', null)).toBe(2);
    expect(dropOrder(tasks, 'doing', 'a', null)).toBe(1);
  });
  it('ignores the moving card when computing neighbours', () => {
    // moving "b" before "c": neighbours are a(1) and c(3), not b itself
    expect(dropOrder(tasks, 'todo', 'b', 'c')).toBe(2);
  });
});

describe('sortedColumn', () => {
  it('sorts by order with a deterministic id tie-break', () => {
    const list = sortedColumn([t('b', 'todo', 1), t('a', 'todo', 1), t('c', 'todo', 0)], 'todo');
    expect(list.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('concurrent moves (CRDT)', () => {
  it('never duplicates a card when two users move it at the same time', () => {
    const a = new Y.Doc();
    const tasksA = a.getArray<Y.Map<unknown>>('tasks');
    const card = new Y.Map<unknown>();
    a.transact(() => {
      card.set('id', 'card-1');
      card.set('text', 'Ship it');
      card.set('column', 'todo');
      card.set('order', 1);
      tasksA.push([card]);
    });
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // both users drag the same card to different columns while offline from each other
    a.getArray<Y.Map<unknown>>('tasks').get(0).set('column', 'doing');
    b.getArray<Y.Map<unknown>>('tasks').get(0).set('column', 'done');

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const ra = readTasks(a.getArray('tasks'));
    const rb = readTasks(b.getArray('tasks'));
    expect(ra).toHaveLength(1);
    expect(rb).toHaveLength(1);
    expect(ra[0].column).toBe(rb[0].column); // converged to one winner
  });
});

describe('isOverdue', () => {
  const now = new Date(2026, 9, 12, 15, 0);
  it('flags past dates only', () => {
    expect(isOverdue('2026-10-11', now)).toBe(true);
    expect(isOverdue('2026-10-12', now)).toBe(false);
    expect(isOverdue('2026-10-13', now)).toBe(false);
    expect(isOverdue('', now)).toBe(false);
  });
});
