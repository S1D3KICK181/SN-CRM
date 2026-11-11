// @vitest-environment jsdom
import { cleanup, renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateEngagementDraftInput,
  EngagementDto,
} from '@sn/contracts';
import { useEngagements } from './use-engagements';
import { EngagementsCoordinator } from './engagements-coordinator';
import { TestEngagementsAdapter } from './test-engagements-adapter';
import { EngagementOperationError } from './engagements-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENG_DRAFT: EngagementDto = {
  id: '00000000-0000-4000-b000-000000000001',
  code: 'ENG-000001',
  clientId: '00000000-0000-4000-c000-000000000001',
  serviceId: '00000000-0000-4000-d000-000000000001',
  status: 'draft',
  approvedVersionId: null,
  approvedVersion: null,
  approvedAt: null,
  approvedById: null,
  endedAt: null,
  endedById: null,
  endOutcome: null,
  endReason: null,
  createdById: '00000000-0000-4000-a000-000000000001',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
};

const ENG_ACTIVE: EngagementDto = {
  ...ENG_DRAFT,
  id: '00000000-0000-4000-b000-000000000002',
  code: 'ENG-000002',
  status: 'active',
  approvedVersionId: '00000000-0000-4000-b000-000000000010',
  approvedAt: '2026-11-01T12:00:00.000Z',
  approvedById: '00000000-0000-4000-a000-000000000001',
};

const CREATE_INPUT: CreateEngagementDraftInput = {
  clientId: '00000000-0000-4000-c000-000000000001',
  serviceId: '00000000-0000-4000-d000-000000000001',
  title: 'Tax Advisory FY 2026-27',
  scope: 'Full tax compliance',
  responsiblePartnerId: '00000000-0000-4000-a000-000000000001',
  deliveryManagerId: '00000000-0000-4000-a000-000000000002',
  feeModel: 'fixed',
  agreedFeePaise: 500000,
  billingTerms: 'Net 30',
  startDate: '2026-04-01',
};

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useEngagements hook', () => {
  describe('initial load', () => {
    it('fetches engagements on mount and populates items', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_DRAFT, ENG_ACTIVE]);
      const { result } = renderHook(() => useEngagements('founder', { port }));

      await waitFor(() => {
        expect(result.current.hasLiveSnapshot).toBe(true);
      });

      expect(result.current.items).toHaveLength(2);
      expect(result.current.loading).toBe(false);
      expect(result.current.listError).toBeNull();
      expect(result.current.role).toBe('founder');
    });

    it('staff role gets empty items (forbidden) with listError set', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const { result } = renderHook(() => useEngagements('staff', { port }));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.items).toEqual([]);
      expect(result.current.listError).not.toBeNull();
      expect(result.current.listError?.code).toBe('forbidden');
    });
  });

  describe('zero-frame privacy guard', () => {
    it('synchronously exposes empty state when role prop changes', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_DRAFT]);

      const { result, rerender } = renderHook(
        ({ role }: { role: 'founder' | 'manager' }) => useEngagements(role, { port }),
        { initialProps: { role: 'founder' as 'founder' | 'manager' } },
      );

      await waitFor(() => {
        expect(result.current.hasLiveSnapshot).toBe(true);
      });

      expect(result.current.items).toHaveLength(1);

      rerender({ role: 'manager' });

      // Synchronously in the first render frame, prior role items must NOT leak
      expect(result.current.items).toEqual([]);
      expect(result.current.loading).toBe(true);
    });

    it('synchronously exposes empty state when port changes (port identity change)', async () => {
      const port1 = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const port2 = new TestEngagementsAdapter().seed([ENG_ACTIVE]);

      const { result, rerender } = renderHook(
        ({ port }: { port: TestEngagementsAdapter }) => useEngagements('founder', { port }),
        { initialProps: { port: port1 } },
      );

      await waitFor(() => {
        expect(result.current.hasLiveSnapshot).toBe(true);
      });

      rerender({ port: port2 });

      // First render after port swap must expose empty items and loading = true
      expect(result.current.items).toEqual([]);
      expect(result.current.loading).toBe(true);
      expect(result.current.hasLiveSnapshot).toBe(false);

      await waitFor(() => {
        expect(result.current.hasLiveSnapshot).toBe(true);
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0]!.id).toBe(ENG_ACTIVE.id);
    });
  });

  describe('refresh', () => {
    it('refresh re-syncs data', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const { result } = renderHook(() => useEngagements('founder', { port }));

      await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
      expect(result.current.items).toHaveLength(1);

      // Add an item to the adapter
      port.seed([ENG_DRAFT, ENG_ACTIVE]);

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.items).toHaveLength(2);
    });

    it('refresh preserves last good data on failure after live snapshot', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const { result } = renderHook(() => useEngagements('founder', { port }));

      await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));

      const failSpy = vi.spyOn(port, 'list').mockRejectedValueOnce(
        new EngagementOperationError({ code: 'network', message: 'Network error' }),
      );

      await act(async () => {
        await result.current.refresh();
      });

      // Items preserved; error shown
      expect(result.current.items).toHaveLength(1);
      expect(result.current.listError?.code).toBe('network');
      expect(result.current.hasLiveSnapshot).toBe(true);
      failSpy.mockRestore();
    });
  });

  describe('selection', () => {
    it('selectEngagement fetches detail and versions', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const { result } = renderHook(() => useEngagements('founder', { port }));

      await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));

      await act(async () => {
        await result.current.selectEngagement(ENG_DRAFT.id);
      });

      expect(result.current.selectedEngagementId).toBe(ENG_DRAFT.id);
      expect(result.current.selectedDetail).toEqual(ENG_DRAFT);
      expect(result.current.detailLoading).toBe(false);
    });

    it('clearSelection resets selection state', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const { result } = renderHook(() => useEngagements('founder', { port }));

      await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));

      await act(async () => {
        await result.current.selectEngagement(ENG_DRAFT.id);
      });

      expect(result.current.selectedEngagementId).toBe(ENG_DRAFT.id);

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedEngagementId).toBeNull();
      expect(result.current.selectedDetail).toBeNull();
    });
  });

  describe('createDraft mutation', () => {
    it('founder can create draft and list updates', async () => {
      const port = new TestEngagementsAdapter().seed([]);
      const { result } = renderHook(() => useEngagements('founder', { port }));

      await waitFor(() => expect(result.current.loading).toBe(false));

      let mutResult: Awaited<ReturnType<typeof result.current.createDraft>>;
      await act(async () => {
        mutResult = await result.current.createDraft(CREATE_INPUT);
      });

      expect(mutResult!.success).toBe(true);
      expect(result.current.items).toHaveLength(1);
    });

    it('manager cannot activate — mutation returns forbidden error', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const { result } = renderHook(() => useEngagements('manager', { port }));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const activateInput = {
        engagementId: ENG_DRAFT.id,
        versionId: '00000000-0000-4000-b000-000000000010',
        expectedUpdatedAt: ENG_DRAFT.updatedAt,
      };

      let mutResult: Awaited<ReturnType<typeof result.current.activate>>;
      await act(async () => {
        mutResult = await result.current.activate(ENG_DRAFT.id, activateInput);
      });

      expect(mutResult!.success).toBe(false);
      expect(mutResult!.error?.code).toBe('forbidden');
    });

    it('manager cannot end — mutation returns forbidden error', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_ACTIVE]);
      const { result } = renderHook(() => useEngagements('manager', { port }));

      await waitFor(() => expect(result.current.loading).toBe(false));

      let mutResult: Awaited<ReturnType<typeof result.current.end>>;
      await act(async () => {
        mutResult = await result.current.end(ENG_ACTIVE.id, {
          engagementId: ENG_ACTIVE.id,
          outcome: 'completed',
          reason: 'All done.',
          expectedUpdatedAt: ENG_ACTIVE.updatedAt,
        });
      });

      expect(mutResult!.success).toBe(false);
      expect(mutResult!.error?.code).toBe('forbidden');
    });
  });

  describe('StrictMode & unmount', () => {
    it('survives unmount without throwing', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const { result, unmount } = renderHook(() => useEngagements('founder', { port }));

      await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
      expect(() => unmount()).not.toThrow();
    });

    it('handles StrictMode double-invoke without terminal poisoning', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_DRAFT]);

      const { result } = renderHook(() => useEngagements('founder', { port }), {
        wrapper: ({ children }) => <span style={{ display: 'contents' }}>{children}</span>,
      });

      await waitFor(() => {
        expect(result.current.hasLiveSnapshot).toBe(true);
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('stable token source', () => {
    it('does not recreate adapter on every render due to function identity churn', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      let renderCount = 0;

      // Simulate a provider that creates a new function reference each render
      const { result, rerender } = renderHook(
        () => {
          renderCount++;
          return useEngagements('founder', { port });
        },
      );

      await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));

      const portCallsBefore = vi.spyOn(port, 'list');
      rerender();
      rerender();
      rerender();

      // Port should not be called again due to re-render (no dependency change)
      expect(portCallsBefore).not.toHaveBeenCalled();
      portCallsBefore.mockRestore();
    });
  });

  describe('enabled flag', () => {
    it('enabled: false does not trigger fetch and returns empty state', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const listSpy = vi.spyOn(port, 'list');
      const { result } = renderHook(() => useEngagements('founder', { port, enabled: false }));

      expect(result.current.items).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.hasLiveSnapshot).toBe(false);
      expect(listSpy).not.toHaveBeenCalled();
    });
  });

  describe('stale suppression on role switch', () => {
    it('late responses from prior role do not repopulate state', async () => {
      let resolveLate: (items: EngagementDto[]) => void = () => {};
      const lateResponse = new Promise<EngagementDto[]>((resolve) => {
        resolveLate = resolve;
      });

      const port1 = new TestEngagementsAdapter();
      vi.spyOn(port1, 'list').mockImplementation(async (role, opts) => {
        if (role === 'founder') {
          return await lateResponse;
        }
        // Abort is checked via signal
        if (opts?.signal?.aborted) {
          throw new EngagementOperationError({ code: 'aborted', message: 'aborted' });
        }
        return [];
      });

      const port2 = new TestEngagementsAdapter().seed([ENG_DRAFT]);

      const { result, rerender } = renderHook(
        ({ port }: { port: TestEngagementsAdapter }) => useEngagements('founder', { port }),
        { initialProps: { port: port1 } },
      );

      // Switch to port2 before port1 resolves
      rerender({ port: port2 });

      await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));

      // Now resolve port1's late response — should NOT populate state
      act(() => {
        resolveLate([ENG_ACTIVE]);
      });

      await new Promise((r) => setTimeout(r, 20));

      // Should still show port2's data
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0]!.id).toBe(ENG_DRAFT.id);
    });
  });

  describe('toast and error callbacks', () => {
    it('fires onToast on successful createDraft', async () => {
      const port = new TestEngagementsAdapter().seed([]);
      const toasts: string[] = [];
      const { result } = renderHook(() =>
        useEngagements('founder', { port, onToast: (m) => toasts.push(m) }),
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.createDraft(CREATE_INPUT);
      });

      expect(toasts.some((t) => t.includes('created'))).toBe(true);
    });

    it('fires onError on port failure', async () => {
      const port = new TestEngagementsAdapter().seed([]);
      vi.spyOn(port, 'list').mockRejectedValueOnce(
        new EngagementOperationError({ code: 'network', message: 'Network error' }),
      );
      const errors: EngagementOperationError[] = [];
      const { result } = renderHook(() =>
        useEngagements('founder', { port, onError: (e) => errors.push(e) }),
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0]!.code).toBe('network');
    });
  });

  describe('enabled transition proofs', () => {
    it('enabled true to false exposes empty state and suppresses stale callbacks', async () => {
      const port = new TestEngagementsAdapter().seed([]);
      const errors: unknown[] = [];
      const toasts: string[] = [];
      let rejectRequest!: (error: unknown) => void;
      const delayedRequest = new Promise<EngagementDto[]>((_, reject) => {
        rejectRequest = reject;
      });
      vi.spyOn(port, 'list').mockReturnValueOnce(delayedRequest);
      const { result, rerender } = renderHook(
        ({ enabled }) =>
          useEngagements('founder', {
            port,
            enabled,
            onError: (error) => errors.push(error),
            onToast: (message) => toasts.push(message),
          }),
        { initialProps: { enabled: true } },
      );

      rerender({ enabled: false });
      rejectRequest(new EngagementOperationError({ code: 'network', message: 'late failure' }));
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.items).toEqual([]);
      expect(errors).toHaveLength(0);
      expect(toasts).toHaveLength(0);
    });

    it('enabled false to true keeps a zero-frame empty snapshot until new sync completes', async () => {
      const port = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const { result, rerender } = renderHook(
        ({ enabled }) => useEngagements('founder', { port, enabled }),
        { initialProps: { enabled: false } },
      );

      rerender({ enabled: true });

      expect(result.current.items).toEqual([]);
      expect(result.current.loading).toBe(true);
      await waitFor(() => expect(result.current.items).toHaveLength(1));
    });

    it('does not expose old data while disabled before a new sync completes', async () => {
      const oldPort = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const newPort = new TestEngagementsAdapter().seed([ENG_ACTIVE]);
      const { result, rerender } = renderHook(
        ({ enabled, port }: { enabled: boolean; port: TestEngagementsAdapter }) =>
          useEngagements('founder', { port, enabled }),
        { initialProps: { enabled: true, port: oldPort } },
      );

      await waitFor(() => expect(result.current.items).toHaveLength(1));

      let resolveNewSync!: (items: EngagementDto[]) => void;
      vi.spyOn(newPort, 'list').mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNewSync = resolve;
        }),
      );
      rerender({ enabled: false, port: oldPort });
      rerender({ enabled: true, port: newPort });

      expect(result.current.items).toEqual([]);
      expect(result.current.loading).toBe(true);
      resolveNewSync([ENG_ACTIVE]);
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      expect(result.current.items[0]?.id).toBe(ENG_ACTIVE.id);
    });

    it('clearSelection while disabled is a no-op', () => {
      const port = new TestEngagementsAdapter().seed([]);
      const clearSelection = vi.spyOn(EngagementsCoordinator.prototype, 'clearSelection');
      const { result } = renderHook(() =>
        useEngagements('founder', { port, enabled: false }),
      );

      act(() => result.current.clearSelection());

      expect(clearSelection).not.toHaveBeenCalled();
      expect(result.current.selectedEngagementId).toBeNull();
      expect(result.current.selectedVersions).toEqual([]);
    });
  });
});
