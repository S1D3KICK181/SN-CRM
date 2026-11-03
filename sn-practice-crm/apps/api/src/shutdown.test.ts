import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler } from './shutdown';

const silentLogger = {
  log: () => undefined,
  error: () => undefined,
};

describe('Graceful Shutdown Handler', () => {
  it('closes idle connections immediately, drains active connections, and awaits repository close', async () => {
    let idleClosed = false;
    let allClosed = false;
    let closeCallback: ((err?: Error) => void) | undefined;

    const fakeServer = {
      closeIdleConnections: vi.fn(() => {
        idleClosed = true;
      }),
      closeAllConnections: vi.fn(() => {
        allClosed = true;
      }),
      close: vi.fn((cb?: (err?: Error) => void) => {
        closeCallback = cb;
        return fakeServer;
      }),
    };

    let repoClosed = false;
    const fakeRepo = {
      close: vi.fn(async () => {
        repoClosed = true;
      }),
    };

    const onTimeout = vi.fn();
    const onSuccess = vi.fn();

    const shutdown = createShutdownHandler({
      server: fakeServer,
      repository: fakeRepo,
      timeoutMs: 500,
      onTimeout,
      onSuccess,
      logger: silentLogger,
    });

    const shutdownPromise = shutdown('SIGINT');

    // 1. Idle connections closed immediately
    expect(fakeServer.closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(idleClosed).toBe(true);

    // 2. Active connections NOT force-closed immediately
    expect(fakeServer.closeAllConnections).not.toHaveBeenCalled();
    expect(allClosed).toBe(false);

    // 3. server.close initiated to drain active connections
    expect(fakeServer.close).toHaveBeenCalledTimes(1);

    // Simulate server.close completion (drained active requests)
    expect(closeCallback).toBeDefined();
    closeCallback!();

    await shutdownPromise;

    // 4. Repository close was awaited
    expect(fakeRepo.close).toHaveBeenCalledTimes(1);
    expect(repoClosed).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(fakeServer.closeAllConnections).not.toHaveBeenCalled();
  });

  it('arms a bounded watchdog that force-closes connections and invokes onTimeout if draining hangs', async () => {
    vi.useFakeTimers();
    try {
      const fakeServer = {
        closeIdleConnections: vi.fn(),
        closeAllConnections: vi.fn(),
        close: vi.fn(), // never calls callback -> simulating hang
      };

      const onTimeout = vi.fn();
      const onSuccess = vi.fn();

      const shutdown = createShutdownHandler({
        server: fakeServer,
        timeoutMs: 200,
        onTimeout,
        onSuccess,
        logger: silentLogger,
      });

      const shutdownPromise = shutdown('SIGTERM');

      expect(fakeServer.closeIdleConnections).toHaveBeenCalledTimes(1);
      expect(fakeServer.closeAllConnections).not.toHaveBeenCalled();
      expect(onTimeout).not.toHaveBeenCalled();

      // Fast-forward past timeout
      await vi.advanceTimersByTimeAsync(250);
      await shutdownPromise;

      expect(fakeServer.closeAllConnections).toHaveBeenCalledTimes(1);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(onSuccess).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is idempotent: repeated shutdown signals do not duplicate drain or timer work', async () => {
    const fakeServer = {
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
      close: vi.fn((cb?: (err?: Error) => void) => {
        cb?.();
        return fakeServer;
      }),
    };

    const fakeRepo = {
      close: vi.fn(async () => undefined),
    };

    const shutdown = createShutdownHandler({
      server: fakeServer,
      repository: fakeRepo,
      timeoutMs: 500,
      logger: silentLogger,
    });

    await Promise.all([shutdown('SIGINT'), shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(fakeServer.closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(fakeServer.close).toHaveBeenCalledTimes(1);
    expect(fakeRepo.close).toHaveBeenCalledTimes(1);
  });

  it('invokes onError when server close encounters an error', async () => {
    const serverError = new Error('server failed to close');
    const fakeServer = {
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
      close: vi.fn((cb?: (err?: Error) => void) => {
        cb?.(serverError);
        return fakeServer;
      }),
    };

    const onError = vi.fn();
    const shutdown = createShutdownHandler({
      server: fakeServer,
      onError,
      logger: silentLogger,
    });

    await shutdown('SIGINT');
    expect(onError).toHaveBeenCalledWith(serverError);
  });

  it('invokes onError when repository close encounters an error', async () => {
    const repoError = new Error('repository close failed');
    const fakeServer = {
      closeIdleConnections: vi.fn(),
      close: vi.fn((cb?: (err?: Error) => void) => {
        cb?.();
        return fakeServer;
      }),
    };
    const fakeRepo = {
      close: vi.fn(async () => {
        throw repoError;
      }),
    };

    const onError = vi.fn();
    const shutdown = createShutdownHandler({
      server: fakeServer,
      repository: fakeRepo,
      onError,
      logger: silentLogger,
    });

    await shutdown('SIGTERM');
    expect(onError).toHaveBeenCalledWith(repoError);
  });

  it('guarantees repository close cannot start before server drain callback fires', async () => {
    const events: string[] = [];
    let serverCloseCallback: ((err?: Error) => void) | undefined;

    const fakeServer = {
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
      close: vi.fn((cb?: (err?: Error) => void) => {
        events.push('server:close:start');
        serverCloseCallback = cb;
        return fakeServer;
      }),
    };

    const fakeRepo = {
      close: vi.fn(async () => {
        events.push('repo:close:start');
      }),
    };

    const shutdown = createShutdownHandler({
      server: fakeServer,
      repository: fakeRepo,
      timeoutMs: 500,
      logger: silentLogger,
    });

    const shutdownPromise = shutdown('SIGINT');

    expect(events).toEqual(['server:close:start']);
    expect(fakeRepo.close).not.toHaveBeenCalled();

    // Trigger server drain completion
    expect(serverCloseCallback).toBeDefined();
    events.push('server:close:callback');
    serverCloseCallback!();

    await shutdownPromise;
    expect(events).toEqual(['server:close:start', 'server:close:callback', 'repo:close:start']);
  });

  it('times out and force-closes connections when repository close hangs after server drain', async () => {
    vi.useFakeTimers();
    try {
      const fakeServer = {
        closeIdleConnections: vi.fn(),
        closeAllConnections: vi.fn(),
        close: vi.fn((cb?: (err?: Error) => void) => {
          cb?.(); // server drain succeeds immediately
          return fakeServer;
        }),
      };

      const hangingRepo = {
        close: vi.fn(() => new Promise<void>(() => {})), // never settles
      };

      const onTimeout = vi.fn();
      const onSuccess = vi.fn();
      const onError = vi.fn();

      const shutdown = createShutdownHandler({
        server: fakeServer,
        repository: hangingRepo,
        timeoutMs: 200,
        onTimeout,
        onSuccess,
        onError,
        logger: silentLogger,
      });

      const shutdownPromise = shutdown('SIGTERM');

      expect(fakeServer.closeIdleConnections).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(hangingRepo.close).toHaveBeenCalledTimes(1);
      expect(fakeServer.closeAllConnections).not.toHaveBeenCalled();
      expect(onTimeout).not.toHaveBeenCalled();

      // Fast-forward past watchdog timeout
      await vi.advanceTimersByTimeAsync(250);
      await shutdownPromise;

      expect(fakeServer.closeAllConnections).toHaveBeenCalledTimes(1);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(onSuccess).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('successful cleanup clears the timeout and calls onSuccess exactly once without firing timeout', async () => {
    vi.useFakeTimers();
    try {
      const fakeServer = {
        closeIdleConnections: vi.fn(),
        closeAllConnections: vi.fn(),
        close: vi.fn((cb?: (err?: Error) => void) => {
          cb?.();
          return fakeServer;
        }),
      };

      const fakeRepo = {
        close: vi.fn(async () => undefined),
      };

      const onTimeout = vi.fn();
      const onSuccess = vi.fn();

      const shutdown = createShutdownHandler({
        server: fakeServer,
        repository: fakeRepo,
        timeoutMs: 200,
        onTimeout,
        onSuccess,
        logger: silentLogger,
      });

      await shutdown('SIGINT');

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onTimeout).not.toHaveBeenCalled();

      // Advance timers past timeoutMs to confirm watchdog timer was cancelled
      await vi.advanceTimersByTimeAsync(500);
      expect(onTimeout).not.toHaveBeenCalled();
      expect(fakeServer.closeAllConnections).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles server drain and repository errors once and prevents the watchdog timer from firing later', async () => {
    vi.useFakeTimers();
    try {
      const drainError = new Error('drain failure');
      const fakeServer = {
        closeIdleConnections: vi.fn(),
        closeAllConnections: vi.fn(),
        close: vi.fn((cb?: (err?: Error) => void) => {
          cb?.(drainError);
          return fakeServer;
        }),
      };

      const repoClosed = vi.fn(async () => undefined);
      const onTimeout = vi.fn();
      const onError = vi.fn();

      const shutdown = createShutdownHandler({
        server: fakeServer,
        repository: { close: repoClosed },
        timeoutMs: 200,
        onTimeout,
        onError,
        logger: silentLogger,
      });

      await shutdown('SIGINT');

      expect(onError).toHaveBeenCalledWith(drainError);
      expect(repoClosed).toHaveBeenCalledTimes(1);

      // Fast-forward past timeout - timer must not fire
      await vi.advanceTimersByTimeAsync(500);
      expect(onTimeout).not.toHaveBeenCalled();
      expect(fakeServer.closeAllConnections).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces repeated shutdown calls into a single shared execution', async () => {
    let serverCloseCount = 0;
    const fakeServer = {
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
      close: vi.fn((cb?: (err?: Error) => void) => {
        serverCloseCount++;
        cb?.();
        return fakeServer;
      }),
    };

    let repoCloseCount = 0;
    const fakeRepo = {
      close: vi.fn(async () => {
        repoCloseCount++;
      }),
    };

    const onSuccess = vi.fn();

    const shutdown = createShutdownHandler({
      server: fakeServer,
      repository: fakeRepo,
      timeoutMs: 500,
      onSuccess,
      logger: silentLogger,
    });

    const [p1, p2, p3] = [shutdown('SIGINT'), shutdown('SIGTERM'), shutdown('SIGINT')];
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    await Promise.all([p1, p2, p3]);

    expect(fakeServer.closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(serverCloseCount).toBe(1);
    expect(repoCloseCount).toBe(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
