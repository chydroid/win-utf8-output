// win-utf8-output — OpenCode 插件 (server part)
//
// 问题: Windows 上 OpenCode 的无窗口 shell(pwsh / ConPTY / 重定向管道) 中,
// PowerShell 的 [Console]::OutputEncoding 会回落到系统 ANSI 代码页(936/GBK),
// 中文 stdout 变成 GBK 字节, OpenCode 按 UTF-8 解码 -> 乱码;
// 输入侧同样会把 UTF-8 命令字节按 936 解释 -> 中文路径/参数乱码。
//
// 修复: 在执行层注入编码前缀, 强制 .NET 控制台 I/O 走 UTF-8。
//   1. tool 层  execute.before — 拦截模型调 shell 工具的命令
//      (仅当命令含 PowerShell 特征或非 ASCII 时注入, 纯 ASCII bash 命令零干扰)
//   2. shell 层 create.before  — 拦截用户在 Shell 框直接执行的命令
//      (载荷带解释器, 仅 PowerShell 系宿主注入)
//   3. 幂等保护: 已含 [Console]::OutputEncoding 的命令不再叠加
//
// 兜底(可选, 见 README): 在用户 pwsh profile 里设置同样的编码,
// 保证新启动的 shell 即使插件缺席也是 UTF-8。
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const LOG = join(homedir(), ".config", "opencode", "win-utf8-output.log")
const PREFIX =
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::InputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; "
// PowerShell 特征(大小写敏感, 避免 new-feature / test-suite 等 bash 标识符误判):
// 显式 pwsh/powershell、$env:、[Console]、大写开头的 Verb-Noun cmdlet
const PS_RX =
  /\b(?:pwsh|powershell)\b|\$env:|\[Console\]|::OutputEncoding|\b(?:Get|Set|Out|Where|Select|ForEach|Invoke|Test|Measure|Sort|Group|Convert|Export|Import|Add|Remove|Move|Copy|Rename|Read|Write|Start|Stop|Resume|Suspend|Clear|Register|Unregister|New|Find|Format|Show|Split|Join|Compare|Wait|Watch|Block|Unblock|Close|Open|Disable|Enable|Install|Uninstall|Publish|Update|Debug|Trace|Sync|Undo|Redo|Reset|Limit|Skip|Optimize|Pop|Push|Save|Connect|Disconnect|Expand|Send|Submit|Switch|Use)-[A-Za-z]+/
// 非 ASCII(中文等)命令: pwsh 下 echo/Write-Output 中文同样受 GBK 影响;
// bash 宿主下不注入(bash 直通 UTF-8)
const NON_ASCII_RX = /[^\x00-\x7F]/
const IS_WINDOWS = typeof process !== "undefined" && process.platform === "win32"

let logged = 0
let capWarned = false
const append = (line) => {
  try {
    mkdirSync(join(homedir(), ".config", "opencode"), { recursive: true })
    appendFileSync(LOG, line)
  } catch {}
}
const log = (msg) => {
  if (logged > 800) {
    if (!capWarned) {
      capWarned = true
      append(new Date().toISOString() + " log cap reached; further entries dropped for this process\n")
    }
    return
  }
  logged++
  append(new Date().toISOString() + " " + msg + "\n")
}

const isPatched = (cmd) => cmd.startsWith(PREFIX) || cmd.includes("[Console]::OutputEncoding")

export default {
  id: "win-utf8-output",
  setup: async (ctx) => {
    if (!IS_WINDOWS) {
      log("skipped: not win32")
      return
    }

    // 工具层: 模型调 shell 工具
    if (typeof ctx?.tool?.hook !== "function") {
      log("FATAL: ctx.tool.hook unavailable; ctx.tool=" + (ctx?.tool ? Object.keys(ctx.tool).join(",") : String(ctx?.tool)))
    } else {
      await ctx.tool.hook("execute.before", (e) => {
        const cmd = e?.input?.command
        if (typeof cmd !== "string" || cmd.length === 0) return
        if (isPatched(cmd)) {
          log("skip already-patched tool=" + (e?.tool ?? "?"))
          return
        }
        if (!PS_RX.test(cmd) && !NON_ASCII_RX.test(cmd)) {
          log("skip non-ps tool=" + (e?.tool ?? "?") + " cmd=" + cmd.slice(0, 80))
          return
        }
        e.input = { ...e.input, command: PREFIX + cmd }
        log("patched tool=" + (e?.tool ?? "?") + " cmd=" + cmd.slice(0, 80))
      })
      log("execute.before hook registered")
    }

    // shell 层: 用户直接在 Shell 框执行 + 所有经 Shell.create 的命令。
    // 事件载荷 {command,cwd,timeout,shell,env} 是引用传递, 改 e.command 直接影响实际执行。
    if (typeof ctx?.shell?.hook === "function") {
      try {
        await ctx.shell.hook("create.before", (e) => {
          const cmd = e?.command
          if (typeof cmd !== "string" || cmd.length === 0) return
          if (isPatched(cmd)) return
          if (!/pwsh|powershell/i.test(String(e?.shell ?? ""))) return
          e.command = PREFIX + cmd
          log("shell-create patched shell=" + String(e?.shell).slice(0, 50) + " cmd=" + cmd.slice(0, 80))
        })
        log("shell create.before hook registered")
      } catch (err) {
        log("FATAL: shell.hook: " + String(err).slice(0, 150))
      }
    } else {
      log("note: ctx.shell.hook unavailable (OpenCode < 2.x?); tool hook only")
    }
  },
}
