// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignInGate } from './sign-in-gate';

afterEach(() => {
  cleanup();
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SignInGate Component', () => {
  it('TC-SIG-01: Renders accessible email and password inputs with required attributes', () => {
    const onSignIn = vi.fn().mockResolvedValue({});
    render(<SignInGate onSignIn={onSignIn} />);

    const emailInput = screen.getByLabelText(/email address/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    expect(emailInput).toBeTruthy();
    expect(emailInput.required).toBe(true);
    expect(emailInput.type).toBe('email');

    expect(passwordInput).toBeTruthy();
    expect(passwordInput.required).toBe(true);
    expect(passwordInput.type).toBe('password');

    expect(submitButton).toBeTruthy();
  });

  it('TC-SIG-02: Disables submit button and shows loading state while submission is pending', async () => {
    const deferred = createDeferred();
    const onSignIn = vi.fn().mockReturnValue(deferred.promise);
    render(<SignInGate onSignIn={onSignIn} />);

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);

    fireEvent.change(emailInput, { target: { value: 'test@sn-demo.local' } });
    fireEvent.change(passwordInput, { target: { value: 'secret123' } });

    const submitButton = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(submitButton);

    const pendingButton = screen.getByRole('button', { name: /signing in/i }) as HTMLButtonElement;
    expect(pendingButton.disabled).toBe(true);

    deferred.resolve({});
    await waitFor(() => {
      expect(onSignIn).toHaveBeenCalledWith({
        email: 'test@sn-demo.local',
        password: 'secret123',
      });
    });
  });

  it('TC-SIG-03: Renders accessible error banner (role="alert") when onSignIn rejects', async () => {
    const onSignIn = vi.fn().mockRejectedValue(new Error('Invalid credentials provided'));
    render(<SignInGate onSignIn={onSignIn} />);

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);

    fireEvent.change(emailInput, { target: { value: 'test@sn-demo.local' } });
    fireEvent.change(passwordInput, { target: { value: 'wrong-pass' } });

    const submitButton = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(submitButton);

    const alertBanner = await screen.findByRole('alert');
    expect(alertBanner).toBeTruthy();
    expect(alertBanner.textContent).toContain('Invalid credentials provided');

    // Button should be re-enabled after rejection
    const reenabledButton = screen.getByRole('button', { name: /sign in/i }) as HTMLButtonElement;
    expect(reenabledButton.disabled).toBe(false);
  });

  it('TC-SIG-04: Calls onSignIn with entered credentials upon form submission', async () => {
    const onSignIn = vi.fn().mockResolvedValue({});
    render(<SignInGate onSignIn={onSignIn} />);

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);

    fireEvent.change(emailInput, { target: { value: 'suresh@sn-demo.local' } });
    fireEvent.change(passwordInput, { target: { value: 'founderPass123' } });

    const submitButton = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(onSignIn).toHaveBeenCalledTimes(1);
      expect(onSignIn).toHaveBeenCalledWith({
        email: 'suresh@sn-demo.local',
        password: 'founderPass123',
      });
    });
  });
});
