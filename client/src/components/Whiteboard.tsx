import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';


interface Stroke {
  id: string;
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

interface PeerState {
  user?: {
    name: string;
    color: string;
  };
}

interface Props {
  doc: Y.Doc;
  awareness: Awareness;
  peers: Map<number, PeerState>;
}
export default function Whiteboard({ doc, awareness, peers }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const yStrokes = doc.getMap<Stroke>('strokes');
  const [color, setColor] = useState('#6366f1');
  const [drawing, setDrawing] = useState(false);
  const currentStroke = useRef<Stroke | null>(null);

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    yStrokes.forEach((stroke) => {
      if (stroke.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    });

    // Remote cursors
    peers.forEach((state, clientId) => {
      if (clientId === awareness.clientID) return;
      const user = state.user as { name: string; color: string } | undefined;
      const pointer = state.pointer as { x: number; y: number } | undefined;
      if (!user || !pointer) return;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = user.color;
      ctx.fill();
      ctx.font = '12px DM Sans';
      ctx.fillText(user.name, pointer.x + 10, pointer.y - 8);
    });
  };

  useEffect(() => {
    const resize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      redraw();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  });

  useEffect(() => {
    yStrokes.observe(redraw);
    return () => yStrokes.unobserve(redraw);
  }, [yStrokes]);

  useEffect(redraw, [peers]);

  const getPos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.MouseEvent) => {
    setDrawing(true);
    const pos = getPos(e);
    currentStroke.current = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      points: [pos],
      color,
      width: 3,
    };
  };

  const onPointerMove = (e: React.MouseEvent) => {
    const pos = getPos(e);
    awareness.setLocalStateField('pointer', pos);

    if (!drawing || !currentStroke.current) return;
    currentStroke.current.points.push(pos);
    yStrokes.set(currentStroke.current.id, { ...currentStroke.current });
  };

  const onPointerUp = () => {
    setDrawing(false);
    currentStroke.current = null;
  };

  const clearBoard = () => {
    doc.transact(() => {
      yStrokes.forEach((_, key) => yStrokes.delete(key));
    });
  };

  const colors = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444', '#1e293b'];

  return (
    <div className="whiteboard-wrap" ref={containerRef}>
      <div className="wb-toolbar">
        <span>Whiteboard</span>
        <div className="color-picker">
          {colors.map((c) => (
            <button
              key={c}
              className={`color-dot ${color === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <button className="btn btn-ghost" onClick={clearBoard}>Clear</button>
      </div>
      <canvas
        ref={canvasRef}
        className="whiteboard-canvas"
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
      />
    </div>
  );
}
