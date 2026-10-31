import { loadConfig } from "./config.ts";
import { createPracticeHttpServer } from "./http.ts";

const config = loadConfig();
const runtime = createPracticeHttpServer({ config });
let shuttingDown = false;

runtime.server.on("error", (error) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "practice_server_error",
      message: error.message,
    }),
  );
  process.exitCode = 1;
});

runtime.server.listen(config.port, config.host, () => {
  console.log(
    JSON.stringify({
      level: "info",
      event: "practice_server_listening",
      mode: config.mode,
      address: "http://" + config.host + ":" + config.port,
    }),
  );
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: "info", event: "practice_server_shutdown", signal }));

  const closed = new Promise<void>((resolve) => {
    runtime.server.close(() => resolve());
  });
  runtime.server.closeIdleConnections();
  const forceTimer = setTimeout(() => {
    runtime.abortActiveRequests(new Error("Server shutdown deadline reached"));
    runtime.server.closeAllConnections();
  }, config.shutdownTimeoutMs);
  forceTimer.unref();

  await closed;
  clearTimeout(forceTimer);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
