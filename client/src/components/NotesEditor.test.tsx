import { act, render, screen, waitFor } from '@testing-library/react';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import type { CollabState } from '../hooks/useCollab';
import NotesEditor from './NotesEditor';

function fakeCollab(doc: Y.Doc): CollabState {
  return {
    doc,
    provider: { awareness: new Awareness(doc) } as unknown as CollabState['provider'],
    status: 'connected',
    synced: true,
    ready: true,
    presence: [],
    role: 'editor',
    fatalError: null,
  };
}

/** Builds <paragraph>text</paragraph> in the shared fragment, the way ProseMirror stores it. */
function addParagraph(doc: Y.Doc, text: string) {
  const fragment = doc.getXmlFragment('content');
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  fragment.insert(fragment.length, [p]);
}

describe('NotesEditor', () => {
  it('renders content that arrives through the shared Yjs document', async () => {
    const remote = new Y.Doc();
    const local = new Y.Doc();
    // relay updates between the two docs, as the WebSocket would
    remote.on('update', (u: Uint8Array) => Y.applyUpdate(local, u, 'remote'));

    render(<NotesEditor collab={fakeCollab(local)} userName="Ada" title="T" canEdit />);
    expect(await screen.findByLabelText('Document editor')).toBeInTheDocument();

    act(() => addParagraph(remote, 'Hello from a collaborator'));
    await waitFor(() => expect(screen.getByLabelText('Document editor')).toHaveTextContent('Hello from a collaborator'));
  });

  it('uses the "content" field, which the server relies on when restoring versions', async () => {
    const doc = new Y.Doc();
    addParagraph(doc, 'stored text');
    render(<NotesEditor collab={fakeCollab(doc)} userName="Ada" title="T" canEdit />);
    await waitFor(() => expect(screen.getByLabelText('Document editor')).toHaveTextContent('stored text'));
  });

  it('is read-only for viewers and disables formatting', async () => {
    render(<NotesEditor collab={fakeCollab(new Y.Doc())} userName="Ada" title="T" canEdit={false} />);
    const editor = await screen.findByLabelText('Document editor');
    expect(editor).toHaveAttribute('contenteditable', 'false');
    expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled();
    expect(screen.getByText(/view-only access/i)).toBeInTheDocument();
  });
});
