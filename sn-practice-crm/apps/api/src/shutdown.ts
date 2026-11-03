export interface ShutdownServer {
  close(callback?: (err?: Error) => void): unknown;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export interface ShutdownLogger {
  log?: (message: string, ...args: unknown[]) => void;
  error?: (message: string, ...args: unknown[]) => void;
}

export interface ShutdownOptions {
  server: ShutdownServer;
  repository?: unknown;
  timeoutMs?: number;
  onTimeout?: () => void;
  onError?: (error: unknown) => void;
  onSuccess?: () => void;
  logger?: ShutdownLogger;
}

export function hasCloseMethod(target: unknown): target is { close: () => Promise<void> | void } {
  return (
    typeof target === 'object' &&
    target !== null &&
    'close' in target &&
    typeof (target as Record<string, unknown>)['close'] === 'function'
  );
}

export async function closeRepositorySafely(target: unknown): Promise<void> {
  if (hasCloseMethod(target)) {
    await target.close();
  }
}

export function createShutdownHandler(options: ShutdownOptions): (signal: string) => Promise<void> {
  const {
    server,
    repository,
    timeoutMs = 10_000,
    onTimeout = () => {
      process.exit(1);
    },
    onError = () => {
      process.exitCode = 1;
    },
    onSuccess,
    logger = console,
  } = options;

  let isShuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;

  return function handleShutdown(signal: string): Promise<void> {
    if (isShuttingDown && shutdownPromise) {
      return shutdownPromise;
    }
    isShuttingDown = true;

    shutdownPromise = (async () => {
      logger.log?.(`${signal} received; closing the API server.`);

      // 1. Close idle connections immediately when supported
      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }

      let timer: NodeJS.Timeout | undefined;
      let timedOut = false;

      const watchdogPromise = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          logger.error?.('Shutdown timed out; force-closing remaining connections.');
          if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections();
          }
          onTimeout();
          resolve();
        }, timeoutMs);
        timer.unref?.();
      });

      const cleanupPromise = (async (): Promise<void> => {
        let drainError: unknown;
        try {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          });
        } catch (err) {
          drainError = err;
          logger.error?.('API shutdown failed during drain.', err);
        }

        try {
          await closeRepositorySafely(repository);
        } catch (repoErr) {
          logger.error?.('Error closing repository during shutdown', repoErr);
          if (!drainError) {
            throw repoErr;
          }
        }

        if (drainError) {
          throw drainError;
        }
      })();

      // Prevent unhandled rejection if cleanupPromise rejects after watchdog timeout
      cleanupPromise.catch((err) => {
        if (timedOut) {
          logger.error?.('Error during late cleanup after shutdown timeout', err);
        }
      });

      try {
        await Promise.race([cleanupPromise, watchdogPromise]);
      } catch (err) {
        if (timer) clearTimeout(timer);
        onError(err);
        return;
      }

      if (timedOut) {
        return;
      }

      if (timer) clearTimeout(timer);
      onSuccess?.();
    })();

    return shutdownPromise;
  };
}
