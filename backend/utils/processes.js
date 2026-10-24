const { spawn } = require("node:child_process");
const readline = require("node:readline");

function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const path = require("node:path");
      const script = require("node:fs")
        .readFileSync(path.join(__dirname, "kill-tree.ps1"), "utf8")
        .replace("__GSD_PROCESS_ID__", String(child.pid));
      const windows = process.env.SystemRoot || "C:\\Windows";
      const command = path.join(
        windows,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const killer = spawn(
        command,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        { windowsHide: true, stdio: "ignore" },
      );
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve();
      };
      const fallback = () => {
        const taskkill = spawn(
          path.join(windows, "System32", "taskkill.exe"),
          ["/pid", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        const timeout = setTimeout(() => {
          try {
            taskkill.kill();
            child.kill();
          } catch {}
          done();
        }, 3000);
        taskkill.once("error", () => {
          clearTimeout(timeout);
          try {
            child.kill();
          } catch {}
          done();
        });
        taskkill.once("close", () => {
          clearTimeout(timeout);
          try {
            child.kill();
          } catch {}
          done();
        });
      };
      const timer = setTimeout(() => {
        try {
          killer.kill();
        } catch {}
        fallback();
      }, 10000);
      killer.once("close", (code) => {
        if (!finished) {
          clearTimeout(timer);
          if (code === 0) done();
          else fallback();
        }
      });
      killer.once("error", () => {
        clearTimeout(timer);
        fallback();
      });
    });
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  return Promise.resolve();
}

function runProcess(
  command,
  args,
  {
    signal,
    timeoutMs = 0,
    onLine,
    maxOutput = 16 * 1024 * 1024,
    captureStdout = true,
    cwd,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(
        Object.assign(new Error("Cancelled"), { name: "AbortError" }),
      );
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
    });
    let stdout = "",
      stderr = "",
      timedOut = false,
      overflow = false;
    let stopping = null;
    const abort = () => {
      stopping ||= killTree(child);
    };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          abort();
        }, timeoutMs)
      : null;
    for (const [stream, isError] of [
      [child.stdout, false],
      [child.stderr, true],
    ]) {
      if (!stream) continue;
      stream.on("data", (chunk) => {
        if (isError) stderr = (stderr + chunk.toString()).slice(-65536);
        else if (!captureStdout) return;
        else if (stdout.length < maxOutput) stdout += chunk.toString();
        else {
          overflow = true;
          abort();
        }
      });
      if (onLine)
        readline
          .createInterface({ input: stream, crlfDelay: Infinity })
          .on("line", onLine);
    }
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    child.once("error", (error) => {
      cleanup();
      reject(
        new Error(
          error.code === "ENOENT"
            ? `Required tool is missing: ${command}. Reinstall GSD or configure its media tools.`
            : `Unable to start media tool: ${error.message}`,
        ),
      );
    });
    child.once("close", (code) => {
      cleanup();
      if (signal?.aborted)
        reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }));
      else if (timedOut)
        reject(
          new Error(
            "The media lookup timed out. Check the link and connection, then retry.",
          ),
        );
      else if (overflow)
        reject(
          new Error(
            "The media source returned too much metadata. Try a single media link.",
          ),
        );
      else resolve({ code, stdout, stderr });
    });
  });
}

async function probeTools(tools) {
  const entries = await Promise.all(
    Object.entries(tools).map(async ([name, command]) => {
      try {
        const result = await runProcess(
          command,
          [name === "ffmpeg" || name === "ffprobe" ? "-version" : "--version"],
          { timeoutMs: 45000, maxOutput: 65536 },
        );
        return [name, result.code === 0];
      } catch {
        return [name, false];
      }
    }),
  );
  return Object.fromEntries(entries);
}

module.exports = { runProcess, killTree, probeTools };
