import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShareDialog from './ShareDialog';

const api = vi.hoisted(() => ({
  listMembers: vi.fn(),
  listInvites: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
  setMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));
vi.mock('../lib/api', () => ({ api }));

const owner = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'owner' as const };
const live = {
  id: 'inv1',
  role: 'viewer' as const,
  singleUse: true,
  expiresAt: '2026-10-20T10:00:00.000Z',
  createdAt: '2026-10-13T10:00:00.000Z',
  createdBy: 'Ada',
};

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.listMembers.mockResolvedValue({ members: [owner] });
  api.listInvites.mockResolvedValue({ invites: [live] });
});

const setup = () => render(<ShareDialog documentId="d1" currentUserId="u1" onClose={() => {}} />);

describe('ShareDialog invite links', () => {
  it('lists active links and revokes one', async () => {
    api.revokeInvite.mockResolvedValue(undefined);
    setup();
    const list = await screen.findByRole('list', { name: 'Active invite links' });
    expect(within(list).getByText('Can view')).toBeInTheDocument();
    expect(within(list).getByText(/single use/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Revoke viewer link' }));
    expect(api.revokeInvite).toHaveBeenCalledWith('d1', 'inv1');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Active invite links' })).not.toBeInTheDocument());
  });

  it('creates a single-use link when the box is ticked', async () => {
    api.listInvites.mockResolvedValue({ invites: [] });
    api.createInvite.mockResolvedValue({ invite: { id: 'inv2', token: 'tok123', role: 'editor', singleUse: true, expiresAt: '2026-10-20T10:00:00.000Z' } });
    setup();
    await userEvent.click(await screen.findByLabelText(/single use/i));
    await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    expect(api.createInvite).toHaveBeenCalledWith('d1', 'editor', true);
    expect(await screen.findByLabelText('Invite link')).toHaveValue(`${location.origin}/invite/tok123`);
  });

  it('shows the server error if revoking fails', async () => {
    api.revokeInvite.mockRejectedValue(new Error('Invite not found'));
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke viewer link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invite not found');
  });
});
