import type { DesktopCapabilities } from './types'

export const setupResourceIds = [
  'sunshine-download',
  'sunshine-guide',
  'moonlight-download',
] as const
export type SetupResource = (typeof setupResourceIds)[number]
export const setupResources: Record<SetupResource, string> = {
  'sunshine-download': 'https://github.com/LizardByte/Sunshine/releases/latest',
  'sunshine-guide':
    'https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2getting__started.html',
  'moonlight-download': 'https://github.com/moonlight-stream/moonlight-qt/releases/latest',
}

// Prefer a concrete next step over treating usable VNC as completed streaming setup.
export function streamingSetup(report: DesktopCapabilities) {
  if (
    report.state === 'checking' ||
    report.sunshineInstalled === null ||
    report.sunshineRunning === null
  )
    return {
      stage: 'check',
      title: '检查高性能串流环境',
      detail: '检查尚未完成，重新检查后会显示安装或启动建议。',
    } as const
  if (!report.sunshineInstalled)
    return {
      stage: 'install-server',
      title: '建议安装 Sunshine，启用高性能串流',
      detail: '在这台 Mac 安装服务端，即可使用 Moonlight 的低延迟画面与声音。',
    } as const
  if (!report.sunshineRunning)
    return {
      stage: 'start-server',
      title: '启动 Sunshine，启用高性能串流',
      detail: '服务端已经安装。请在 Mac 桌面启动它，并完成录屏与输入权限设置。',
    } as const
  if (!report.streamReachable)
    return {
      stage: 'network',
      title: '完成 Sunshine 配置与网络检查',
      detail: '服务正在运行，但串流端口不可达。请检查管理页初始化、主机地址和防火墙。',
    } as const
  if (!report.moonlightInstalled)
    return {
      stage: 'install-client',
      title: '在本机安装 Moonlight 客户端',
      detail: '远端串流服务已响应；在当前电脑安装 Moonlight 后重新检查。',
    } as const
  return {
    stage: 'pair',
    title: '配对并连接 Moonlight',
    detail: '环境检查已通过；配对、画面与声音需要实际连接验证。',
  } as const
}
