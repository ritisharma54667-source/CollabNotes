import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import type { CollabState } from '../hooks/useCollab';
import { downloadBlob, safeFilename } from '../lib/download';
import {
  COLUMNS,
  PRIORITIES,
  dropOrder,
  isOverdue,
  readTasks,
  sortedColumn,
  type Column,
  type Priority,
  type Task,
} from '../lib/tasks';

interface Props {
  collab: CollabState;
  canEdit: boolean;
  title: string;
}

export default function TaskBoard({ collab, canEdit, title }: Props) {
  const { doc } = collab;
  const yTasks = useMemo(() => doc.getArray<Y.Map<unknown>>('tasks'), [doc]);
  const [tasks, setTasks] = useState<Task[]>(() => readTasks(yTasks));
  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<Column | null>(null);

  useEffect(() => {
    const update = () => setTasks(readTasks(yTasks));
    update();
    yTasks.observeDeep(update);
    return () => yTasks.unobserveDeep(update);
  }, [yTasks]);

  const find = (id: string) => yTasks.toArray().find((m) => m.get('id') === id);

  const addTask = () => {
    const text = newText.trim().slice(0, 200);
    if (!text || !canEdit) return;
    const todo = sortedColumn(tasks, 'todo');
    const m = new Y.Map<unknown>();
    doc.transact(() => {
      m.set('id', crypto.randomUUID());
      m.set('text', text);
      m.set('column', 'todo');
      m.set('order', (todo.at(-1)?.order ?? 0) + 1);
      m.set('priority', 'medium');
      m.set('due', '');
      yTasks.push([m]);
    });
    setNewText('');
  };

  const moveTask = (id: string, column: Column, beforeId: string | null) => {
    const m = find(id);
    if (!m || !canEdit) return;
    const order = dropOrder(tasks, column, id, beforeId);
    doc.transact(() => {
      m.set('column', column);
      m.set('order', order);
    });
  };

  const setField = (id: string, key: 'priority' | 'due', value: string) => {
    if (canEdit) find(id)?.set(key, value);
  };

  const removeTask = (id: string) => {
    const idx = yTasks.toArray().findIndex((m) => m.get('id') === id);
    if (idx >= 0 && canEdit) yTasks.delete(idx, 1);
  };

  const commitEdit = () => {
    const text = editText.trim().slice(0, 200);
    if (editingId && text) find(editingId)?.set('text', text);
    setEditingId(null);
  };

  const shift = (t: Task, dir: -1 | 1) => {
    const next = COLUMNS[COLUMNS.findIndex((c) => c.id === t.column) + dir];
    if (next) moveTask(t.id, next.id, null);
  };

  const cyclePriority = (t: Task) =>
    setField(t.id, 'priority', PRIORITIES[(PRIORITIES.indexOf(t.priority) + 1) % PRIORITIES.length]);

  const exportJson = () =>
    downloadBlob(new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' }), safeFilename(title, 'json'));

  const done = tasks.filter((t) => t.column === 'done').length;

  return (
    <div className="task-board">
      <div className="task-top">
        {canEdit ? (
          <form className="task-add-row" onSubmit={(e) => { e.preventDefault(); addTask(); }}>
            <input
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Add a task and press Enter…"
              maxLength={200}
              aria-label="New task"
            />
            <button className="btn btn-primary" type="submit" disabled={!newText.trim()}>Add</button>
          </form>
        ) : (
          <span className="muted">You have view-only access to this board.</span>
        )}
        <span className="spacer" />
        <span className="muted">{done}/{tasks.length} done</span>
        <button className="btn btn-ghost" onClick={exportJson}>Export JSON</button>
      </div>

      <div className="kanban-columns">
        {COLUMNS.map((col) => {
          const items = sortedColumn(tasks, col.id);
          return (
            <section
              key={col.id}
              className={`kanban-column${overColumn === col.id ? ' drag-over' : ''}`}
              aria-label={col.label}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverColumn(col.id); } }}
              onDragLeave={() => setOverColumn((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) moveTask(dragId, col.id, null);
                setDragId(null);
                setOverColumn(null);
              }}
            >
              <h3>{col.label} <span className="count">{items.length}</span></h3>
              <ul>
                {items.map((t) => (
                  <li
                    key={t.id}
                    className={`task-card prio-${t.priority}${dragId === t.id ? ' dragging' : ''}`}
                    draggable={canEdit && editingId !== t.id}
                    onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); }}
                    onDragEnd={() => { setDragId(null); setOverColumn(null); }}
                    onDragOver={(e) => { if (dragId && dragId !== t.id) e.preventDefault(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (dragId && dragId !== t.id) moveTask(dragId, col.id, t.id);
                      setDragId(null);
                      setOverColumn(null);
                    }}
                  >
                    {editingId === t.id ? (
                      <input
                        className="task-edit"
                        autoFocus
                        value={editText}
                        maxLength={200}
                        onChange={(e) => setEditText(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        aria-label="Edit task"
                      />
                    ) : (
                      <p onDoubleClick={() => { if (canEdit) { setEditingId(t.id); setEditText(t.text); } }}>{t.text}</p>
                    )}
                    <div className="task-meta">
                      <button className={`chip chip-${t.priority}`} onClick={() => cyclePriority(t)} disabled={!canEdit} title="Change priority">
                        {t.priority}
                      </button>
                      <input
                        type="date"
                        className={`due-input${isOverdue(t.due) && t.column !== 'done' ? ' overdue' : ''}`}
                        value={t.due}
                        disabled={!canEdit}
                        onChange={(e) => setField(t.id, 'due', e.target.value)}
                        aria-label="Due date"
                      />
                    </div>
                    {canEdit && (
                      <div className="task-actions">
                        <button onClick={() => shift(t, -1)} disabled={col.id === 'todo'} aria-label="Move left">←</button>
                        <button onClick={() => shift(t, 1)} disabled={col.id === 'done'} aria-label="Move right">→</button>
                        <button onClick={() => { setEditingId(t.id); setEditText(t.text); }} aria-label="Edit task">✎</button>
                        <button className="delete-btn" onClick={() => removeTask(t.id)} aria-label="Delete task">✕</button>
                      </div>
                    )}
                  </li>
                ))}
                {items.length === 0 && <li className="empty-col">{canEdit ? 'Drop tasks here' : 'No tasks'}</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export type { Priority };
