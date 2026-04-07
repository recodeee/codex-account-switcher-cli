#!/usr/bin/env node

const fs = require("node:fs")
const net = require("node:net")
const path = require("node:path")
const { spawn, execSync } = require("node:child_process")

const preferredPort = Number.parseInt(process.env.MEDUSA_PORT || process.env.PORT || "9000", 10)
const projectRoot = path.resolve(__dirname, "..", "..", "..")
const portRegistryFile = path.join(projectRoot, ".dev-ports.json")
const lockDir = path.resolve(__dirname, "..", ".medusa")
const lockFile = path.join(lockDir, "dev-singleton.lock")
const logFile = path.join(lockDir, "backend-dev.log")

const isPidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const isPortInUse = (targetPort) =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        resolve(true)
      } else {
        resolve(false)
      }
    })
    server.once("listening", () => {
      server.close(() => resolve(false))
    })
    server.listen(targetPort, "0.0.0.0")
  })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const findFreePort = async (startPort, limit = 100) => {
  for (let currentPort = startPort; currentPort < startPort + limit; currentPort += 1) {
    // eslint-disable-next-line no-await-in-loop
    const inUse = await isPortInUse(currentPort)
    if (!inUse) {
      return currentPort
    }
  }

  throw new Error(
    `No free backend port found in range ${startPort}-${startPort + limit - 1}`
  )
}

const getPidsOnPort = (targetPort) => {
  try {
    const raw = execSync(`lsof -ti tcp:${targetPort}`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    return raw.map((value) => Number.parseInt(value, 10)).filter(Number.isInteger)
  } catch {
    return []
  }
}

const getPidCommand = (pid) => {
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8")
    return cmdline.replace(/\0/g, " ").trim()
  } catch {
    return ""
  }
}

const isBackendMedusaProcess = (command) =>
  (command.includes("/services/medusa-backend") || command.includes("/apps/backend")) &&
  (command.includes("medusa") || command.includes("node"))

const acquireLock = () => {
  fs.mkdirSync(lockDir, { recursive: true })

  try {
    const fd = fs.openSync(lockFile, "wx")
    fs.writeFileSync(
      fd,
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
        },
        null,
        2
      )
    )
    fs.closeSync(fd)
    return true
  } catch (error) {
    if (error && error.code === "EEXIST") {
      const raw = fs.readFileSync(lockFile, "utf8")
      const payload = JSON.parse(raw)
      if (isPidAlive(payload.pid)) {
        return false
      }

      fs.rmSync(lockFile, { force: true })
      return acquireLock()
    }

    throw error
  }
}

const releaseLock = () => {
  try {
    fs.rmSync(lockFile, { force: true })
  } catch {
    // Ignore cleanup errors on shutdown.
  }
}

const readActiveLauncherPid = () => {
  try {
    const raw = fs.readFileSync(lockFile, "utf8")
    const payload = JSON.parse(raw)
    return Number.isInteger(payload.pid) ? payload.pid : null
  } catch {
    return null
  }
}

const ensureLogFile = () => {
  fs.mkdirSync(lockDir, { recursive: true })
  if (!fs.existsSync(logFile)) {
    fs.closeSync(fs.openSync(logFile, "a"))
  }
}

const readPortRegistry = () => {
  if (!fs.existsSync(portRegistryFile)) {
    return {}
  }

  try {
    return JSON.parse(fs.readFileSync(portRegistryFile, "utf8"))
  } catch {
    return {}
  }
}

const writePortRegistry = (payload) => {
  const current = readPortRegistry()
  const next = {
    ...current,
    ...payload,
    updatedAt: new Date().toISOString(),
  }
  fs.writeFileSync(portRegistryFile, `${JSON.stringify(next, null, 2)}\n`)
}

const attachToExistingLogs = (launcherPid) =>
  new Promise((resolve) => {
    ensureLogFile()
    console.log(`[backend:dev] Another backend dev launcher is already active (pid ${launcherPid}).`)
    console.log(`[backend:dev] Attaching to logs at ${logFile}. Press Ctrl+C to detach.`)

    const tail = spawn("tail", ["-n", "200", "-f", logFile], {
      stdio: "inherit",
      env: process.env,
    })

    let resolved = false
    const finish = (code) => {
      if (resolved) {
        return
      }
      resolved = true
      resolve(code)
    }

    const stopTail = () => {
      try {
        tail.kill("SIGTERM")
      } catch {
        // Ignore kill errors on shutdown.
      }
    }

    const onSignal = () => {
      stopTail()
      finish(0)
    }

    process.on("SIGINT", onSignal)
    process.on("SIGTERM", onSignal)

    const launcherWatch = setInterval(() => {
      if (!isPidAlive(launcherPid)) {
        stopTail()
        finish(0)
      }
    }, 1000)
    launcherWatch.unref()

    tail.on("exit", (code) => {
      clearInterval(launcherWatch)
      process.off("SIGINT", onSignal)
      process.off("SIGTERM", onSignal)
      finish(code || 0)
    })

    tail.on("error", (error) => {
      clearInterval(launcherWatch)
      process.off("SIGINT", onSignal)
      process.off("SIGTERM", onSignal)
      console.error("[backend:dev] Failed to attach to existing logs:", error)
      finish(1)
    })
  })

const waitUntilPortFree = async (targetPort, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const inUse = await isPortInUse(targetPort)
    if (!inUse) {
      return true
    }
    await sleep(200)
  }
  return false
}

const terminateBackendOnPort = async (targetPort) => {
  const pids = getPidsOnPort(targetPort)
  if (pids.length === 0) {
    return true
  }

  const backendPids = pids.filter((pid) => isBackendMedusaProcess(getPidCommand(pid)))
  if (backendPids.length === 0) {
    return false
  }

  for (const pid of backendPids) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // Ignore already-dead pids.
    }
  }

  const freedAfterTerm = await waitUntilPortFree(targetPort, 5000)
  if (freedAfterTerm) {
    return true
  }

  for (const pid of backendPids) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // Ignore already-dead pids.
    }
  }

  return waitUntilPortFree(targetPort, 2000)
}

const main = async () => {
  const locked = acquireLock()
  if (!locked) {
    const launcherPid = readActiveLauncherPid()
    if (launcherPid && isPidAlive(launcherPid)) {
      const code = await attachToExistingLogs(launcherPid)
      process.exit(code)
      return
    }
    console.log("[backend:dev] Another backend dev launcher is already active. Reusing existing instance.")
    process.exit(0)
  }

  const cleanupAndExit = (code) => {
    releaseLock()
    process.exit(code)
  }

  process.on("exit", () => releaseLock())
  process.on("SIGINT", () => cleanupAndExit(0))
  process.on("SIGTERM", () => cleanupAndExit(0))

  let selectedPort = preferredPort
  const inUse = await isPortInUse(preferredPort)
  if (inUse) {
    const reclaimed = await terminateBackendOnPort(preferredPort)
    if (!reclaimed) {
      console.log(
        `[backend:dev] Port ${preferredPort} is in use by a non-backend process. Searching for a free backend port...`
      )
      selectedPort = await findFreePort(preferredPort + 1)
      console.log(
        `[backend:dev] Using fallback backend port ${selectedPort}.`
      )
    }
  }

  ensureLogFile()
  writePortRegistry({
    backend: selectedPort,
  })
  const logStream = fs.createWriteStream(logFile, { flags: "a" })

  const child = spawn("medusa", ["develop"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(selectedPort),
      MEDUSA_PORT: String(selectedPort),
    },
  })

  const pipeChildOutput = (stream, target) => {
    stream.on("data", (chunk) => {
      target.write(chunk)
      logStream.write(chunk)
    })
  }

  pipeChildOutput(child.stdout, process.stdout)
  pipeChildOutput(child.stderr, process.stderr)

  const forwardSignal = (signal) => {
    if (child.killed) {
      return
    }
    try {
      child.kill(signal)
    } catch {
      // Ignore propagation errors on shutdown.
    }
  }

  process.on("SIGINT", () => forwardSignal("SIGINT"))
  process.on("SIGTERM", () => forwardSignal("SIGTERM"))

  child.on("exit", (code, signal) => {
    logStream.end()
    if (signal) {
      cleanupAndExit(0)
      return
    }
    cleanupAndExit(code || 0)
  })

  child.on("error", (error) => {
    logStream.end()
    console.error("[backend:dev] Failed to start medusa develop:", error)
    cleanupAndExit(1)
  })
}

main().catch((error) => {
  console.error("[backend:dev] Fatal launcher error:", error)
  releaseLock()
  process.exit(1)
})
