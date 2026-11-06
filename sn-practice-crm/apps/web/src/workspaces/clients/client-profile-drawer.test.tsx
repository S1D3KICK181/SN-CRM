// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ClientProfileDrawer } from './client-profile-drawer';
import { toClientDetailViewModel } from './clients-view-model';
import { ClientOperationError } from '../../api/clients-types';
import type { ClientDto } from '@sn/contracts';

afterEach(() => {
  cleanup();
});

function createMockDto(overrides: Partial<ClientDto> = {}): ClientDto {
  return {
    id: 'c1111111-1111-4111-8111-111111111111',
    code: 'CL-000001',
    displayName: 'Aster Foods',
    legalName: 'Aster Foods Private Limited',
    gstinMasked: '27**********1Z5',
    panMasked: '******1234',
    email: 'contact@asterfoods.in',
    phone: '+91 98200 12345',
    relationshipOwnerId: 'u2222222-2222-4222-8222-222222222222',
    relationshipOwnerName: 'S. Narayanan',
    status: 'active',
    notes: 'Key FMCG account with monthly GST filings.',
    activeAssignmentsCount: 3,
    createdById: 'u1111111-1111-4111-8111-111111111111',
    createdAt: '2026-04-01T09:30:00.000Z',
    updatedAt: '2026-04-15T14:20:00.000Z',
    ...overrides,
  };
}

describe('ClientProfileDrawer', () => {
  it('renders loading skeleton when loading with no client data, hiding tabs until client exists', () => {
    render(
      <ClientProfileDrawer
        client={null}
        loading={true}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Loading client…')).toBeTruthy();
    expect(screen.getByLabelText('Loading client details')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Tabs must be hidden until client exists
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('renders error state with retry button when loading fails', () => {
    const onRetry = vi.fn();
    const error = new ClientOperationError({
      code: 'network',
      message: 'Failed to fetch client record from server.',
    });

    render(
      <ClientProfileDrawer
        client={null}
        loading={false}
        error={error}
        onClose={vi.fn()}
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Unable to load client details')).toBeTruthy();
    expect(screen.getByText('Failed to fetch client record from server.')).toBeTruthy();

    const retryButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders proper dialog semantics, focuses on open, and closes on Escape key', () => {
    const dto = createMockDto();
    const client = toClientDetailViewModel(dto);
    const onClose = vi.fn();

    render(
      <ClientProfileDrawer
        client={client}
        loading={false}
        onClose={onClose}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('client-drawer-title');

    // Focus on open
    expect(document.activeElement).toBe(dialog);

    // Escape closes
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders client overview details with accurate fields and formatting', () => {
    const dto = createMockDto();
    const client = toClientDetailViewModel(dto);
    const onClose = vi.fn();

    render(
      <ClientProfileDrawer
        client={client}
        loading={false}
        onClose={onClose}
      />
    );

    // Header checks
    expect(screen.getByRole('heading', { name: 'Aster Foods', level: 2 })).toBeTruthy();
    expect(screen.getByText('AF')).toBeTruthy();
    expect(screen.getByText(/Aster Foods Private Limited · CL-000001/i)).toBeTruthy();
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);

    // Overview tab fields
    expect(screen.getByText('CL-000001')).toBeTruthy();
    expect(screen.getByText('Aster Foods Private Limited')).toBeTruthy();
    expect(screen.getByText('S. Narayanan')).toBeTruthy();
    expect(screen.getByText('contact@asterfoods.in')).toBeTruthy();
    expect(screen.getByText('+91 98200 12345')).toBeTruthy();
    expect(screen.getByText('01/04/2026')).toBeTruthy();
    expect(screen.getByText('15/04/2026')).toBeTruthy();
    expect(screen.getByText('Key FMCG account with monthly GST filings.')).toBeTruthy();

    // Verify close buttons
    const closeIconBtn = screen.getByLabelText('Close drawer');
    fireEvent.click(closeIconBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    const footerCloseBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(footerCloseBtn);
    expect(onClose).toHaveBeenCalledTimes(2);

    const backdrop = screen.getByTestId('drawer-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('handles absent legal name in header by showing code once, never "code · code"', () => {
    const dto = createMockDto({
      legalName: null,
      email: null,
      phone: null,
      notes: null,
      relationshipOwnerName: null,
    });
    const client = toClientDetailViewModel(dto);

    render(
      <ClientProfileDrawer
        client={client}
        loading={false}
        onClose={vi.fn()}
      />
    );

    // Subtitle must show code once, without middle dot or duplication
    const headerLead = screen.getByRole('heading', { name: 'Aster Foods', level: 2 }).parentElement;
    expect(headerLead?.querySelector('p')?.textContent).toBe('CL-000001');

    // Null fallbacks
    expect(screen.getAllByText('Not provided').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('strictly excludes edit, form, and mutation controls', () => {
    const dto = createMockDto();
    const client = toClientDetailViewModel(dto);

    render(
      <ClientProfileDrawer
        client={client}
        loading={false}
        onClose={vi.fn()}
      />
    );

    // No edit or save buttons
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /compose/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /new assignment/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /request docs/i })).toBeNull();

    // No input or select form controls
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('switches tabs with compact visible labels and proper tablist/tab/tabpanel semantics', () => {
    const dto = createMockDto();
    const client = toClientDetailViewModel(dto);

    render(
      <ClientProfileDrawer
        client={client}
        loading={false}
        onClose={vi.fn()}
      />
    );

    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeTruthy();

    // Default tab: Overview
    const overviewTab = screen.getByRole('tab', { name: /^overview$/i });
    expect(overviewTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: /^overview$/i })).toBeTruthy();

    // Switch to compact KYC tab
    const kycTab = screen.getByRole('tab', { name: /^kyc$/i });
    expect(kycTab.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(kycTab);

    expect(kycTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: /^kyc$/i })).toBeTruthy();
    expect(screen.getByText('******1234')).toBeTruthy();
    expect(screen.getByText('27**********1Z5')).toBeTruthy();
    expect(screen.getByText('Routine views expose masked identifiers only.')).toBeTruthy();
    expect(screen.getByText('Not available in this view')).toBeTruthy();

    // Switch to compact Schedules tab
    const schedulesTab = screen.getByRole('tab', { name: /^schedules$/i });
    fireEvent.click(schedulesTab);
    expect(screen.getByText('Compliance schedules are not available in this view.')).toBeTruthy();

    // Switch to compact Work tab
    const workTab = screen.getByRole('tab', { name: /^work$/i });
    fireEvent.click(workTab);
    expect(screen.getByText('3 active')).toBeTruthy();
    expect(screen.getByText('Detailed assignment records and historical engagement logs are not available in this view.')).toBeTruthy();

    // Switch to compact Billing tab
    const billingTab = screen.getByRole('tab', { name: /^billing$/i });
    fireEvent.click(billingTab);
    expect(screen.getByText('Billing & ledgers are not available in this view.')).toBeTruthy();
  });

  it('applies text containment classes for worst-case unbreakable values', () => {
    const unbreakableName = 'Supercalifragilisticexpialidocious_Unbreakable_Corporation_Global_Industries_Limited';
    const unbreakableEmail = 'contact_unbreakable_officer_extremely_long_identifier_address@subdomain.practice.internal';
    const unbreakableNotes = 'Note_without_spaces_1234567890123456789012345678901234567890';
    const dto = createMockDto({
      displayName: unbreakableName,
      legalName: unbreakableName,
      email: unbreakableEmail,
      notes: unbreakableNotes,
    });
    const client = toClientDetailViewModel(dto);

    render(<ClientProfileDrawer client={client} loading={false} onClose={vi.fn()} />);

    const title = screen.getByRole('heading', { level: 2 });
    expect(title.className).toContain('drawer-title-contain');
    expect(title.textContent).toBe(unbreakableName);

    const notesEl = screen.getByText(unbreakableNotes);
    expect(notesEl.className).toContain('drawer-text-contain');
  });
});
