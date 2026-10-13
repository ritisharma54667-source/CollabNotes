import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { CollabState } from '../hooks/useCollab';
import { downloadBlob, safeFilename } from '../lib/download';
import { BOARD_H, BOARD_W, drawStroke, round1, strokeHit, type Stroke } from '../lib/whiteboardGeometry';

const COLORS = ['#1e293b', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6'];
const WIDTHS = [3, 6, 12];
const LOCAL_ORIGIN = 'local-draw';
const BROADCAST_INTERVAL_MS = 40;
const BOARD_BG = '#fafafa';

type Tool = 'pen' | 'eraser';
interface Draft {
  color: string;
  width: number;
  points: number[];
}
interface RemoteState {
  user?: { name: string; color: string };
  draft?: Draft | null;
  pointer?: { x: number; y: number } | null;
}

interface Props {
  collab: CollabState;
  canEdit: boolean;
  title: string;
}

export default function Whiteboard({ collab, canEdit, title }: Props) {
  const { doc, provider } = collab;
  const awareness = provider.awareness;
  const yStrokes = useMemo(() => doc.getArray<Stroke>('strokes'), [doc]);
  const undoManager = useMemo(
    () => new Y.UndoManager(yStrokes, { trackedOrigins: new Set([LOCAL_ORIGIN]) }),
    [yStrokes]
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scaleRef = useRef(1);
  const draftRef = useRef<Draft | null>(null);
  const lastBroadcast = useRef(0);
  const rafRef = useRef(0);

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const k = scaleRef.current * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    yStrokes.forEach((s) => drawStroke(ctx, s));
    if (draftRef.current) drawStroke(ctx, draftRef.current);

    awareness.getStates().forEach((raw, clientId) => {
      if (clientId === doc.clientID) return;
      const st = raw as RemoteState;
      if (st.draft) drawStroke(ctx, st.draft);
      if (st.pointer && st.user) {
        ctx.fillStyle = st.user.color;
        ctx.beginPath();
        ctx.arc(st.pointer.x, st.pointer.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '600 14px system-ui, sans-serif';
        ctx.fillText(st.user.name, st.pointer.x + 10, st.pointer.y - 10);
      }
    });
  }, [yStrokes, awareness, doc]);

  const schedulePaint = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(paint);
  }, [paint]);

  // Fit the fixed-size board into the available space, crisp on high-DPI screens.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const scale = Math.min(wrap.clientWidth / BOARD_W, wrap.clientHeight / BOARD_H);
      if (!(scale > 0)) return;
      const dpr = window.devicePixelRatio || 1;
      scaleRef.current = scale;
      canvas.style.width = `${BOARD_W * scale}px`;
      canvas.style.height = `${BOARD_H * scale}px`;
      canvas.width = Math.round(BOARD_W * scale * dpr);
      canvas.height = Math.round(BOARD_H * scale * dpr);
      schedulePaint();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [schedulePaint]);

  useEffect(() => {
    yStrokes.observe(schedulePaint);
    awareness.on('change', schedulePaint);
    const syncUndo = () => setUndoState({ canUndo: undoManager.undoStack.length > 0, canRedo: undoManager.redoStack.length > 0 });
    undoManager.on('stack-item-added', syncUndo);
    undoManager.on('stack-item-popped', syncUndo);
    schedulePaint();
    return () => {
      yStrokes.unobserve(schedulePaint);
      awareness.off('change', schedulePaint);
      undoManager.off('stack-item-added', syncUndo);
      undoManager.off('stack-item-popped', syncUndo);
      cancelAnimationFrame(rafRef.current);
    };
  }, [yStrokes, awareness, undoManager, schedulePaint]);

  useEffect(() => () => undoManager.destroy(), [undoManager]);

  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable="true"]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) undoManager.redo();
        else undoManager.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, undoManager]);

  const toBoard = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: round1((e.clientX - rect.left) / scaleRef.current), y: round1((e.clientY - rect.top) / scaleRef.current) };
  };

  const broadcast = (force = false) => {
    const now = performance.now();
    if (!force && now - lastBroadcast.current < BROADCAST_INTERVAL_MS) return;
    lastBroadcast.current = now;
    awareness.setLocalStateField('draft', draftRef.current ? { ...draftRef.current } : null);
  };

  const eraseAt = (x: number, y: number) => {
    const hits: number[] = [];
    yStrokes.forEach((s, i) => {
      if (strokeHit(s, x, y, 10)) hits.push(i);
    });
    if (hits.length === 0) return;
    doc.transact(() => {
      for (let i = hits.length - 1; i >= 0; i--) yStrokes.delete(hits[i], 1);
    }, LOCAL_ORIGIN);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canEdit || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = toBoard(e);
    if (tool === 'eraser') {
      draftRef.current = null;
      eraseAt(x, y);
      return;
    }
    draftRef.current = { color, width, points: [x, y] };
    broadcast(true);
    schedulePaint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canEdit) return;
    const { x, y } = toBoard(e);
    const now = performance.now();
    if (now - lastBroadcast.current >= BROADCAST_INTERVAL_MS) awareness.setLocalStateField('pointer', { x, y });

    if (e.buttons === 0) return;
    if (tool === 'eraser') return eraseAt(x, y);
    const d = draftRef.current;
    if (!d) return;
    const n = d.points.length;
    if (Math.hypot(x - d.points[n - 2], y - d.points[n - 1]) < 1.5) return; // skip jitter
    d.points.push(x, y);
    broadcast();
    schedulePaint();
  };

  const finishStroke = () => {
    const d = draftRef.current;
    draftRef.current = null;
    if (d) {
      // One compact, immutable stroke is committed on pointer-up (not on every mouse move).
      doc.transact(() => yStrokes.push([{ id: crypto.randomUUID(), ...d }]), LOCAL_ORIGIN);
    }
    awareness.setLocalStateField('draft', null);
    schedulePaint();
  };

  const onPointerLeave = () => awareness.setLocalStateField('pointer', null);

  const clearBoard = () => {
    if (yStrokes.length === 0) return;
    if (window.confirm('Clear the whole board for everyone? You can undo this with Ctrl/⌘+Z.')) {
      doc.transact(() => yStrokes.delete(0, yStrokes.length), LOCAL_ORIGIN);
    }
  };

  const exportPng = () => {
    const out = document.createElement('canvas');
    out.width = BOARD_W;
    out.height = BOARD_H;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    yStrokes.forEach((s) => drawStroke(ctx, s));
    out.toBlob((blob) => blob && downloadBlob(blob, safeFilename(title, 'png')));
  };

  return (
    <div className="whiteboard-wrap">
      <div className="wb-toolbar" role="toolbar" aria-label="Whiteboard tools">
        {canEdit ? (
          <>
            <div className="seg">
              <button className={`tb-btn${tool === 'pen' ? ' active' : ''}`} onClick={() => setTool('pen')} aria-pressed={tool === 'pen'}>✎ Pen</button>
              <button className={`tb-btn${tool === 'eraser' ? ' active' : ''}`} onClick={() => setTool('eraser')} aria-pressed={tool === 'eraser'}>⌫ Eraser</button>
            </div>
            <div className="color-picker" role="group" aria-label="Color">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`color-dot${c === color && tool === 'pen' ? ' active' : ''}`}
                  style={{ background: c }}
                  onClick={() => { setColor(c); setTool('pen'); }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
            <div className="seg" role="group" aria-label="Brush size">
              {WIDTHS.map((w) => (
                <button key={w} className={`tb-btn${w === width ? ' active' : ''}`} onClick={() => setWidth(w)} aria-label={`Brush size ${w}`}>
                  <span className="brush-preview" style={{ width: w + 4, height: w + 4 }} />
                </button>
              ))}
            </div>
            <div className="seg">
              <button className="tb-btn" onClick={() => undoManager.undo()} disabled={!undoState.canUndo} aria-label="Undo">↶</button>
              <button className="tb-btn" onClick={() => undoManager.redo()} disabled={!undoState.canRedo} aria-label="Redo">↷</button>
            </div>
            <button className="btn btn-ghost" onClick={clearBoard}>Clear</button>
          </>
        ) : (
          <span className="muted">You have view-only access to this whiteboard.</span>
        )}
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={exportPng}>Export PNG</button>
      </div>
      <div className="whiteboard-stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="whiteboard-canvas"
          style={{ cursor: !canEdit ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onPointerLeave={onPointerLeave}
          aria-label="Shared whiteboard"
        />
      </div>
    </div>
  );
}
