import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

interface Props {
  doc: Y.Doc;
  awareness: Awareness;
}

/**
 * Collaborative notes editor backed by Y.Text (CRDT).
 * Concurrent edits at the same position merge automatically — no conflicts lost.
 */
export default function NotesEditor({ doc, awareness }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const yText = doc.getText('content');
  const isLocalChange = useRef(false);

  // Sync Y.Text → DOM
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const syncToDom = () => {
      if (isLocalChange.current) return;
      el.textContent = yText.toString();
    };
    syncToDom();
    yText.observe(syncToDom);
    return () => yText.unobserve(syncToDom);
  }, [yText]);

  // Track cursor for presence
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const updateCursor = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer)) return;

      const preRange = range.cloneRange();
      preRange.selectNodeContents(el);
      preRange.setEnd(range.startContainer, range.startOffset);
      const cursor = preRange.toString().length;

      awareness.setLocalStateField('cursor', { anchor: cursor, head: cursor + range.toString().length });
    };

    el.addEventListener('keyup', updateCursor);
    el.addEventListener('mouseup', updateCursor);
    document.addEventListener('selectionchange', updateCursor);
    return () => {
      el.removeEventListener('keyup', updateCursor);
      el.removeEventListener('mouseup', updateCursor);
      document.removeEventListener('selectionchange', updateCursor);
    };
  }, [awareness]);

  const handleInput = () => {
    const el = editorRef.current;
    if (!el) return;

    isLocalChange.current = true;
    doc.transact(() => {
      const newText = el.textContent || '';
      const oldText = yText.toString();
      // Find common prefix/suffix and apply minimal diff
      let prefix = 0;
      while (prefix < oldText.length && prefix < newText.length && oldText[prefix] === newText[prefix]) {
        prefix++;
      }
      let suffix = 0;
      while (
        suffix < oldText.length - prefix &&
        suffix < newText.length - prefix &&
        oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
      ) {
        suffix++;
      }
      const deleteLen = oldText.length - prefix - suffix;
      const insertText = newText.slice(prefix, newText.length - suffix);
      if (deleteLen > 0) yText.delete(prefix, deleteLen);
      if (insertText.length > 0) yText.insert(prefix, insertText);
    });
    isLocalChange.current = false;
  };

  return (
    <div className="notes-editor-wrap">
      <div className="editor-toolbar">
        <span className="toolbar-label">Live document</span>
        <span className="toolbar-hint">Edits sync instantly · CRDT handles concurrent changes</span>
      </div>
      <div
        ref={editorRef}
        className="notes-editor"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder="Start typing — invite your team to edit together…"
      />
      <RemoteCursors awareness={awareness} />
    </div>
  );
}

function RemoteCursors({ awareness }: { awareness: Awareness }) {
  const cursors: { name: string; color: string; anchor: number }[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return;
    const user = state.user as { name: string; color: string } | undefined;
    const cursor = state.cursor as { anchor: number; head: number } | undefined;
    if (user && cursor) {
      cursors.push({ name: user.name, color: user.color, anchor: cursor.anchor });
    }
  });

  if (cursors.length === 0) return null;

  return (
    <div className="remote-cursors-legend">
      {cursors.map((c) => (
        <span key={c.name} style={{ color: c.color }}>
          ● {c.name} editing
        </span>
      ))}
    </div>
  );
}
