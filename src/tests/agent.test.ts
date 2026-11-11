import { describe, it, expect, vi } from 'vitest'
import { Agent, type AgentDependencies } from '../core/agent'
import type { AppEvent } from '../shared/types'

function setup(responses: unknown[], approve = true) {
  const events: AppEvent[] = [],
    requests: any[] = []
  const remote = {
    connection: { state: 'connected' as const, deviceId: 'mac-one', home: '/Users/test' },
    connected: (id?: string) => !id || id === remote.connection.deviceId,
    list: vi.fn(async () => ({ path: '/Users/test', entries: [] })),
    read: vi.fn(async () => 'untrusted file data'),
    execute: vi.fn(async () => ({ code: 0, stdout: 'macOS', stderr: '', truncated: false })),
  }
  const deps: AgentDependencies = {
    remote,
    settings: () => ({
      baseUrl: 'https://provider.example/v1',
      model: 'test-model',
      moonlightPath: '',
    }),
    apiKey: async () => 'private-test-key',
    approve: vi.fn(async () => approve),
    emit: (event) => events.push(event),
    fetch: vi.fn(async (_url, options) => {
      requests.push(JSON.parse(String(options?.body)))
      return new Response(JSON.stringify(responses.shift()), { status: 200 })
    }),
  }
  const agent = new Agent(deps)
  return { agent, deps, events, requests, remote }
}
function response(content: string | null, name?: string, args = '{}') {
  return {
    choices: [
      {
        message: {
          content,
          ...(name
            ? {
                tool_calls: [
                  { id: 'call-1', type: 'function', function: { name, arguments: args } },
                ],
              }
            : {}),
        },
      },
    ],
  }
}
describe('AI harness', () => {
  it('executes read tools and returns results with matching call IDs', async () => {
    const { agent, requests, remote, deps } = setup([
      response(null, 'list_directory', '{"path":"~"}'),
      response('目录为空。'),
    ])
    await agent.run('查看主目录')
    expect(remote.list).toHaveBeenCalledWith('~')
    expect(deps.approve).not.toHaveBeenCalled()
    expect(requests[1].messages.slice(-2)[0].tool_calls[0].id).toBe('call-1')
    expect(requests[1].messages.at(-1).tool_call_id).toBe('call-1')
    expect(agent.events.at(-1)?.text).toBe('目录为空。')
    expect(agent.running).toBe(false)
    expect(JSON.stringify(agent.events)).not.toContain('private-test-key')
  })
  it('does not execute a command rejected by the user', async () => {
    const { agent, remote, deps, requests } = setup(
      [response(null, 'run_command', '{"command":"touch example"}'), response('已取消。')],
      false,
    )
    await agent.run('创建文件')
    expect(deps.approve).toHaveBeenCalled()
    expect(remote.execute).not.toHaveBeenCalled()
    expect(requests[1].messages.at(-1).content).toContain('拒绝')
  })
  it('validates unknown tools and malformed arguments before execution', async () => {
    for (const [name, args] of [
      ['run_command', '{"command":2}'],
      ['constructor', '{}'],
      ['read_file', '{"path":"~","extra":true}'],
    ]) {
      const { agent, remote } = setup([response(null, name, args), response('无法执行。')])
      await agent.run('test')
      expect(remote.execute).not.toHaveBeenCalled()
      expect(remote.read).not.toHaveBeenCalled()
      expect(agent.events.some((event) => event.text.includes('工具失败'))).toBe(true)
    }
  })
  it('does not execute after cancellation while awaiting approval', async () => {
    const { agent, deps, remote } = setup([response(null, 'run_command', '{"command":"id"}')])
    deps.approve = async () => {
      agent.cancel()
      return true
    }
    await agent.run('check')
    expect(remote.execute).not.toHaveBeenCalled()
    expect(agent.events.at(-1)?.text).toContain('任务已停止')
  })
  it('clears conversation context on device changes', async () => {
    const { agent, remote, requests } = setup([
      response('private reply for one'),
      response('reply for two'),
    ])
    await agent.run('private request for one')
    remote.connection.deviceId = 'mac-two'
    await agent.run('request for two')
    expect(JSON.stringify(requests[1])).not.toContain('private request for one')
    expect(agent.events.every((event) => event.deviceId === 'mac-two')).toBe(true)
  })
  it('bounds the tool loop and ends without claiming completion', async () => {
    const { agent, requests } = setup(
      Array.from({ length: 8 }, () => response(null, 'list_directory', '{"path":"~"}')),
    )
    await agent.run('loop')
    expect(requests).toHaveLength(8)
    expect(agent.events.at(-1)?.kind).toBe('error')
    expect(agent.events.at(-1)?.text).toContain('上限')
  })
  it('reports provider errors without echoing an error body containing secrets', async () => {
    const { agent, deps } = setup([])
    deps.fetch = async () => new Response('Authorization: Bearer private-test-key', { status: 401 })
    await agent.run('test')
    expect(agent.events.at(-1)?.text).toContain('HTTP 401')
    expect(JSON.stringify(agent.events)).not.toContain('private-test-key')
  })
})
