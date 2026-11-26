# opencode-win-utf8

OpenCode 插件：修复 Windows 上 PowerShell shell 中文输出/输入乱码（GBK/CP936 → UTF-8）。

## 背景

Windows 中文系统上，OpenCode 以无窗口方式运行 PowerShell（pwsh，ConPTY/持久 PTY）时，
`[Console]::OutputEncoding` 回落到系统 ANSI 代码页 936（GBK）：

- **输出**：中文字符串被 GBK 编码进 stdout，OpenCode 按 UTF-8 解码 → 乱码；
- **输入**：OpenCode 以 UTF-8 字节下发命令，pwsh 按 936 解释 → 中文路径/参数乱码。

本插件在两个执行层注入编码前缀（`[Console]::OutputEncoding` / `[Console]::InputEncoding` /
`$OutputEncoding` = UTF-8）：

| 层 | 事件 | 拦截对象 | 注入条件 |
|---|---|---|---|
| 工具层 | `tool` `execute.before` | 模型调 `shell` 工具的命令 | 命令含 PowerShell 特征（cmdlet / pwsh / `$env:`）或含非 ASCII 字符 |
| Shell 层 | `shell` `create.before` | 用户在 Shell 框直接执行的命令 | 解释器为 pwsh/powershell（载荷自带解释器，精确分支） |

纯 ASCII 的 bash 命令零干扰；前缀幂等（不会叠加）；日志写入
`~/.config/opencode/win-utf8-output.log`（每进程 800 行上限，排错用）。

非 Windows 平台自动跳过。

## 安装

### 方式 1：npm（发布后）

```bash
opencode plugin add opencode-win-utf8@latest
```

`@latest` 会随 OpenCode 启动每 24h 自动检查并更新；也可固定版本
`opencode plugin add opencode-win-utf8@0.1.0`。

### 方式 2：GitHub 仓库

```bash
opencode plugin add github:chydroid/win-utf8-output#main
```

带 `#main` 的 Git 包会随启动自动检查更新；不带 ref 则固定已安装版本。

### 方式 3：本地目录（开发/自用）

`opencode.json`（全局或项目级）：

```jsonc
{
  "plugins": ["D:/develop/win-utf8-output"]
}
```

### 管理

```bash
opencode plugin list      # 查看已安装
opencode plugin check     # 检查更新
opencode plugin update    # 更新
opencode plugin remove opencode-win-utf8@latest   # 卸载
```

卸载后用 `-id` 前缀可在配置里禁用：`"plugins": ["-win-utf8-output"]`。

## 验证

在 OpenCode 的 Shell 框执行（或让模型跑）：

```powershell
Get-Content "C:\任意路径\中文文件.txt"
```

中文正常显示即生效。日志确认：`win-utf8-output.log` 末行应为
`shell-create patched ...` 或 `patched tool=shell ...`。

## 可选兜底：pwsh profile

插件缺席（被禁用/未安装）时，让新启动的 pwsh 也默认 UTF-8，
在 `~\Documents\PowerShell\Microsoft.PowerShell_profile.ps1` 加入：

```powershell
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
    $OutputEncoding           = [System.Text.Encoding]::UTF8
} catch {}
```

## 已知边界

- bash 宿主里嵌套 `pwsh -Command "..."` 且 stdout 被重定向到管道时，
  .NET 的 Console 编码只读，前缀无效——bash 场景请优先用
  `cat`/`rg`/`type` 读文件（UTF-8 直通）。
- 小写 cmdlet（`get-content`）+ 纯 ASCII 内容无法被工具层识别
  （模型惯例写 PascalCase，实际罕见；shell 层不受此限制）。

## 发布

```bash
# npm
npm publish            # 或 npm publish --access restricted (scoped)

# 或推 GitHub，用户按方式 2 安装
```
