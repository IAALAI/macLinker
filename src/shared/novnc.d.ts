declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      channel: object | string,
      options?: { credentials?: { username?: string; password?: string }; shared?: boolean },
    )
    scaleViewport: boolean
    resizeSession: boolean
    viewOnly: boolean
    focusOnClick: boolean
    background: string
    disconnect(): void
    sendCredentials(credentials: { username?: string; password?: string }): void
    sendCtrlAltDel(): void
    focus(): void
  }
}
