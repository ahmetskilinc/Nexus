import { type AddressInfo, createServer, type Socket } from "node:net";
import { RuntimeError } from "@nexus/protocol";
import { percentDecode } from "../encoding";

export const DEFAULT_CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
/// Overall sign-in deadline (5 minutes, as in the Rust runtime).
const CALLBACK_TIMEOUT_MS = 300_000;

export interface LoopbackListener {
  /// The actual bound port (differs from the requested one when 0 was asked).
  readonly port: number;
  waitForCode(expectedState: string, timeoutMs?: number): Promise<string>;
  close(): Promise<void>;
}

/// Binds 127.0.0.1:<port>. Any bind failure is reported as the port being in
/// use — that is what it means in practice, and the message the Rust runtime
/// showed for every bind error.
export function bindLoopback(
  port: number = DEFAULT_CALLBACK_PORT,
): Promise<LoopbackListener> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    const sockets = new Set<Socket>();
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      /// A reset from an impatient client must not crash the process.
      socket.on("error", () => {});
    });
    server.once("error", () => {
      reject(
        RuntimeError.msg(
          `Port ${port} is already in use. Quit the process listening on it (for example a Codex CLI login) and try again.`,
        ),
      );
    });
    server.listen(port, "127.0.0.1", () => {
      const boundPort = (server.address() as AddressInfo).port;
      const close = (): Promise<void> =>
        new Promise((done) => {
          for (const socket of sockets) socket.end();
          server.close(() => done());
          /// close() waits for open connections; resolve regardless so a
          /// lingering socket can never wedge the sign-in flow.
          setTimeout(done, 250).unref();
        });
      resolve({
        port: boundPort,
        close,
        waitForCode(expectedState, timeoutMs = CALLBACK_TIMEOUT_MS) {
          return new Promise<string>((resolveCode, rejectCode) => {
            let settled = false;
            const settle = (finish: () => void) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              void close();
              finish();
            };
            const timer = setTimeout(() => {
              settle(() =>
                rejectCode(RuntimeError.msg("Sign-in timed out. Try again.")),
              );
            }, timeoutMs);
            const handleSocket = (socket: Socket) => {
              /// Like the Rust runtime, parse a single read: browser GET
              /// request lines arrive whole in the first segment.
              socket.once("data", (buffer) => {
                const outcome = processRequest(
                  buffer.toString("utf8"),
                  socket,
                  expectedState,
                );
                if (outcome.kind === "pending") return;
                if (outcome.kind === "code")
                  settle(() => resolveCode(outcome.code));
                else settle(() => rejectCode(outcome.error));
              });
            };
            for (const socket of sockets) handleSocket(socket);
            server.on("connection", handleSocket);
          });
        },
      });
    });
  });
}

type CallbackOutcome =
  | { kind: "pending" }
  | { kind: "code"; code: string }
  | { kind: "error"; error: RuntimeError };

/// "pending" means the flow is not finished — unrelated requests such as
/// favicons (and forged callbacks) keep the listener open.
function processRequest(
  request: string,
  socket: Socket,
  expectedState: string,
): CallbackOutcome {
  const requestLine = request.split("\r\n")[0] ?? "";
  const target = requestLine.startsWith("GET ")
    ? (requestLine.slice(4).split(" ")[0] ?? "")
    : "";
  const questionMark = target.indexOf("?");
  const path = questionMark === -1 ? target : target.slice(0, questionMark);
  const query = questionMark === -1 ? "" : target.slice(questionMark + 1);
  if (path !== CALLBACK_PATH) {
    respond(socket, "404 Not Found", "Not found.");
    return { kind: "pending" };
  }

  const value = (name: string): string | undefined => {
    for (const pair of query.split("&")) {
      const equals = pair.indexOf("=");
      if (equals === -1) continue;
      if (pair.slice(0, equals) === name)
        return percentDecode(pair.slice(equals + 1));
    }
    return undefined;
  };

  /// Validate state BEFORE honoring anything else, including `error`. The
  /// loopback listener accepts requests from any local origin (e.g. a page in
  /// the user's browser), so an unauthenticated caller must not be able to
  /// abort the flow or inject text into the UI via `error_description`. A
  /// callback whose state doesn't match this flow is ignored entirely.
  if (value("state") !== expectedState) {
    respond(socket, "400 Bad Request", "Invalid request.");
    return { kind: "pending" };
  }
  const error = value("error");
  if (error !== undefined) {
    respond(
      socket,
      "400 Bad Request",
      "Sign-in failed. You can close this tab.",
    );
    const detail = sanitizeDetail(value("error_description") ?? error);
    return {
      kind: "error",
      error: RuntimeError.msg(`Sign-in was not completed: ${detail}`),
    };
  }
  const code = value("code");
  if (code === undefined) {
    respond(socket, "400 Bad Request", "Missing authorization code.");
    return {
      kind: "error",
      error: RuntimeError.msg(
        "Nexus could not complete the ChatGPT sign-in: The callback had no authorization code.",
      ),
    };
  }
  respond(
    socket,
    "200 OK",
    "Signed in. You can close this tab and return to Nexus.",
  );
  return { kind: "code", code };
}

/// Bounds provider-supplied error text before it reaches the UI: strips
/// control characters (Unicode Cc, matching Rust's `char::is_control`) and
/// caps the length at 200 code points, so a callback cannot inject arbitrary
/// or oversized content into the "Sign-in was not completed" message.
export function sanitizeDetail(detail: string): string {
  let out = "";
  let count = 0;
  for (const ch of detail) {
    if (/\p{Cc}/u.test(ch)) continue;
    out += ch;
    count += 1;
    if (count === 200) break;
  }
  return out;
}

function respond(socket: Socket, status: string, body: string): void {
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><title>Nexus</title></head>' +
    '<body style="font-family: -apple-system, sans-serif; background: #0e0e11; color: #eee; ' +
    'display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">' +
    `<p>${body}</p></body></html>`;
  const head =
    `HTTP/1.1 ${status}\r\nContent-Type: text/html; charset=utf-8\r\n` +
    `Content-Length: ${Buffer.byteLength(html, "utf8")}\r\nConnection: close\r\n\r\n`;
  socket.end(head + html);
}
