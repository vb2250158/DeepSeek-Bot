// npm's Windows launchers are batch files. Resolve their program instead of
// introducing a shell process that would own the CLI's PID and arguments.
import { execFile, spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import readCmdShim from 'read-cmd-shim'

export function agentCommand(file, args) {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { file, args }
  const unsupported = () => Object.assign(new Error('This Windows launcher is not a Node npm shim. Choose the agent executable or its Node entry point instead.'), { code: 'UNSUPPORTED_AGENT_WRAPPER' })
  if (!/\.cmd$/i.test(file) || statSync(file).size > 65_536) throw unsupported()
  let relative
  try { relative = readCmdShim.sync(`${file.slice(0, -4)}.cmd`) } catch (error) {
    if (error.code !== 'ENOTASHIM') throw error
    throw unsupported()
  }
  const entry = resolve(dirname(file), relative)
  if (extname(entry).toLowerCase() === '.exe') return { file: entry, args }
  const fd = openSync(entry, 'r')
  const head = Buffer.alloc(512)
  let count
  try { count = readSync(fd, head, 0, head.length, 0) } finally { closeSync(fd) }
  if (!/^#!(?:[^\s]*[/\\])?(?:env[ \t]+)?node(?:\.exe)?[ \t]*(?:\r?\n|$)/.test(head.subarray(0, count).toString())) throw unsupported()
  const nearbyNode = resolve(dirname(file), 'node.exe')
  return { file: existsSync(nearbyNode) ? nearbyNode : process.execPath, args: [entry, ...args] }
}

// No shell or batch wrapper: cancellation and timeouts address the CLI itself.
export function spawnAgent(file, args, options) {
  const command = agentCommand(file, args)
  return spawn(command.file, command.args, { ...options, shell: false, windowsHide: true })
}

export function execAgent(file, args, options, callback) {
  const command = agentCommand(file, args)
  return execFile(command.file, command.args, { ...options, shell: false, windowsHide: true }, callback)
}
