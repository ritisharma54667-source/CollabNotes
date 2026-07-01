import { useEffect, useState } from 'react';
import * as Y from 'yjs';

interface Task {
  id: string;
  text: string;
  column: 'todo' | 'doing' | 'done';
}

interface Props {
  doc: Y.Doc;
}

const COLUMNS: { key: Task['column']; label: string }[] = [
  { key: 'todo', label: 'To Do' },
  { key: 'doing', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export default function TaskBoard({ doc }: Props) {
  const yTasks = doc.getArray<Task>('tasks');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newText, setNewText] = useState('');

  useEffect(() => {
    const sync = () => setTasks(yTasks.toArray());
    sync();
    yTasks.observe(sync);
    return () => yTasks.unobserve(sync);
  }, [yTasks]);

  const addTask = () => {
    if (!newText.trim()) return;
    doc.transact(() => {
      yTasks.push([
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          text: newText.trim(),
          column: 'todo',
        },
      ]);
    });
    setNewText('');
  };

  const moveTask = (taskId: string, column: Task['column']) => {
    doc.transact(() => {
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) return;
      const task = { ...tasks[idx], column };
      yTasks.delete(idx, 1);
      yTasks.insert(idx, [task]);
    });
  };

  const deleteTask = (taskId: string) => {
    doc.transact(() => {
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx !== -1) yTasks.delete(idx, 1);
    });
  };

  return (
    <div className="task-board">
      <div className="task-add-row">
        <input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTask()}
          placeholder="Add a task…"
        />
        <button className="btn btn-primary" onClick={addTask}>Add</button>
      </div>

      <div className="kanban-columns">
        {COLUMNS.map(({ key, label }) => (
          <div key={key} className="kanban-column">
            <h3>{label}</h3>
            <ul>
              {tasks
                .filter((t) => t.column === key)
                .map((task) => (
                  <li key={task.id} className="task-card">
                    <p>{task.text}</p>
                    <div className="task-actions">
                      {key !== 'todo' && (
                        <button onClick={() => moveTask(task.id, key === 'doing' ? 'todo' : 'doing')}>←</button>
                      )}
                      {key !== 'done' && (
                        <button onClick={() => moveTask(task.id, key === 'todo' ? 'doing' : 'done')}>→</button>
                      )}
                      <button className="delete-btn" onClick={() => deleteTask(task.id)}>×</button>
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
