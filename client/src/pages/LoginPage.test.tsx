import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';

const auth = { user: null as null | { id: string }, login: vi.fn(), register: vi.fn() };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));

const setup = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>
  );

beforeEach(() => {
  auth.user = null;
  auth.login.mockReset();
  auth.register.mockReset();
});

describe('LoginPage', () => {
  it('signs in with the entered credentials', async () => {
    auth.login.mockResolvedValue(undefined);
    setup();
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.login).toHaveBeenCalledWith('ada@example.com', 'password123');
  });

  it('shows the server error message', async () => {
    auth.login.mockRejectedValue(new Error('Invalid email or password'));
    setup();
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('switches to registration, which asks for a name', async () => {
    auth.register.mockResolvedValue(undefined);
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(auth.register).toHaveBeenCalledWith('ada@example.com', 'Ada', 'password123'));
  });
});
