import { useEffect } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { Placeholder } from '@tiptap/extensions';
import type { CollabState } from '../hooks/useCollab';
import { colorForName } from '../lib/colors';
import { downloadBlob, safeFilename } from '../lib/download';

interface Props {
  collab: CollabState;
  userName: string;
  title: string;
  canEdit: boolean;
}

function ToolbarButton({ active, disabled, onClick, label, children }: { active?: boolean; disabled?: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`tb-btn${active ? ' active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, canEdit }: { editor: Editor; canEdit: boolean }) {
  const c = () => editor.chain().focus();
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
      <ToolbarButton label="Bold" active={editor.isActive('bold')} disabled={!canEdit} onClick={() => c().toggleBold().run()}><b>B</b></ToolbarButton>
      <ToolbarButton label="Italic" active={editor.isActive('italic')} disabled={!canEdit} onClick={() => c().toggleItalic().run()}><i>I</i></ToolbarButton>
      <ToolbarButton label="Strikethrough" active={editor.isActive('strike')} disabled={!canEdit} onClick={() => c().toggleStrike().run()}><s>S</s></ToolbarButton>
      <ToolbarButton label="Inline code" active={editor.isActive('code')} disabled={!canEdit} onClick={() => c().toggleCode().run()}>{'</>'}</ToolbarButton>
      <span className="tb-sep" />
      <ToolbarButton label="Heading 1" active={editor.isActive('heading', { level: 1 })} disabled={!canEdit} onClick={() => c().toggleHeading({ level: 1 }).run()}>H1</ToolbarButton>
      <ToolbarButton label="Heading 2" active={editor.isActive('heading', { level: 2 })} disabled={!canEdit} onClick={() => c().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
      <ToolbarButton label="Bulleted list" active={editor.isActive('bulletList')} disabled={!canEdit} onClick={() => c().toggleBulletList().run()}>• List</ToolbarButton>
      <ToolbarButton label="Numbered list" active={editor.isActive('orderedList')} disabled={!canEdit} onClick={() => c().toggleOrderedList().run()}>1. List</ToolbarButton>
      <ToolbarButton label="Quote" active={editor.isActive('blockquote')} disabled={!canEdit} onClick={() => c().toggleBlockquote().run()}>❝</ToolbarButton>
      <ToolbarButton label="Code block" active={editor.isActive('codeBlock')} disabled={!canEdit} onClick={() => c().toggleCodeBlock().run()}>{'{ }'}</ToolbarButton>
      <span className="tb-sep" />
      <ToolbarButton label="Undo" disabled={!canEdit || !editor.can().undo()} onClick={() => c().undo().run()}>↶</ToolbarButton>
      <ToolbarButton label="Redo" disabled={!canEdit || !editor.can().redo()} onClick={() => c().redo().run()}>↷</ToolbarButton>
    </div>
  );
}

export default function NotesEditor({ collab, userName, title, canEdit }: Props) {
  const { doc, provider } = collab;

  const editor = useEditor(
    {
      editable: canEdit,
      // the toolbar's active/disabled states are derived from the editor state on every transaction
      shouldRerenderOnTransaction: true,
      extensions: [
        // the built-in undo/redo is replaced by Yjs' undo manager (per-user undo, safe with concurrent edits)
        StarterKit.configure({ undoRedo: false }),
        Placeholder.configure({ placeholder: 'Start typing — everyone here sees it live…' }),
        Collaboration.configure({ document: doc, field: 'content' }),
        CollaborationCaret.configure({
          provider: { awareness: provider.awareness },
          user: { name: userName, color: colorForName(userName) },
        }),
      ],
      editorProps: { attributes: { class: 'notes-prose', 'aria-label': 'Document editor' } },
    },
    [doc, provider]
  );

  useEffect(() => {
    editor?.setEditable(canEdit);
  }, [editor, canEdit]);

  if (!editor) return null;

  const exportHtml = () => {
    const html = `<!doctype html><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title><body style="font-family:system-ui;max-width:720px;margin:40px auto;line-height:1.6">${editor.getHTML()}</body>`;
    downloadBlob(new Blob([html], { type: 'text/html' }), safeFilename(title, 'html'));
  };

  return (
    <div className="notes-editor-wrap">
      <div className="editor-bar">
        <Toolbar editor={editor} canEdit={canEdit} />
        <button className="btn btn-ghost" onClick={exportHtml}>Export HTML</button>
      </div>
      {!canEdit && <p className="readonly-banner">You have view-only access to this document.</p>}
      <EditorContent editor={editor} className="notes-editor" />
    </div>
  );
}
