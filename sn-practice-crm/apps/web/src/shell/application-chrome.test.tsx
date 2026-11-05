// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionActor } from '@sn/contracts';
import { ApplicationChrome } from './application-chrome';

afterEach(() => {
  cleanup();
});

describe('ApplicationChrome Shell', () => {
  const actor: SessionActor = {
    id: '00000000-0000-4000-a000-000000000001',
    name: 'Suresh Narayanan',
    role: 'founder',
    reportsToId: null,
  };

  it('TC-CHR-01: "Preview as" <select> and demo banner are completely absent', () => {
    const onSignOut = vi.fn();
    const onNavigate = vi.fn();
    const onQuickAdd = vi.fn();
    const onToast = vi.fn();

    render(
      <ApplicationChrome
        actor={actor}
        activePage="Dashboard"
        toast={null}
        onSignOut={onSignOut}
        onNavigate={onNavigate}
        onQuickAdd={onQuickAdd}
        onToast={onToast}
      >
        <div>Main Content</div>
      </ApplicationChrome>,
    );

    // "Preview as" label and select must not exist
    expect(screen.queryByLabelText(/preview as/i)).toBeNull();
    expect(screen.queryByText(/clean-slate preview/i)).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('TC-CHR-02: Renders verified session badge with actor.name and ROLE_LABELS[actor.role]', () => {
    const onSignOut = vi.fn();
    const onNavigate = vi.fn();
    const onQuickAdd = vi.fn();
    const onToast = vi.fn();

    render(
      <ApplicationChrome
        actor={actor}
        activePage="Dashboard"
        toast={null}
        onSignOut={onSignOut}
        onNavigate={onNavigate}
        onQuickAdd={onQuickAdd}
        onToast={onToast}
      >
        <div>Main Content</div>
      </ApplicationChrome>,
    );

    expect(screen.getByText(/verified:/i)).toBeTruthy();
    expect(screen.getByText(/suresh narayanan \(founder\)/i)).toBeTruthy();
  });

  it('TC-CHR-03: Topbar avatar and sidebar profile display computed initials and verified user identity', () => {
    const onSignOut = vi.fn();
    const onNavigate = vi.fn();
    const onQuickAdd = vi.fn();
    const onToast = vi.fn();

    render(
      <ApplicationChrome
        actor={actor}
        activePage="Dashboard"
        toast={null}
        onSignOut={onSignOut}
        onNavigate={onNavigate}
        onQuickAdd={onQuickAdd}
        onToast={onToast}
      >
        <div>Main Content</div>
      </ApplicationChrome>,
    );

    // "SN" initials in topbar and sidebar
    const avatars = screen.getAllByText('SN');
    expect(avatars.length).toBeGreaterThanOrEqual(2);

    // Profile card displays actor name
    expect(screen.getAllByText('Suresh Narayanan').length).toBeGreaterThanOrEqual(1);
  });

  it('TC-CHR-04: Clicking "Sign Out" invokes onSignOut', () => {
    const onSignOut = vi.fn();
    const onNavigate = vi.fn();
    const onQuickAdd = vi.fn();
    const onToast = vi.fn();

    render(
      <ApplicationChrome
        actor={actor}
        activePage="Dashboard"
        toast={null}
        onSignOut={onSignOut}
        onNavigate={onNavigate}
        onQuickAdd={onQuickAdd}
        onToast={onToast}
      >
        <div>Main Content</div>
      </ApplicationChrome>,
    );

    const signOutBtn = screen.getByRole('button', { name: /sign out/i });
    fireEvent.click(signOutBtn);
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
