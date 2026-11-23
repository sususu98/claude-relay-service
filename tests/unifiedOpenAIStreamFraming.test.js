const EventEmitter = require('events')
const http = require('http')
const express = require('express')
const compression = require('compression')
const CodexToOpenAIConverter = require('../src/services/codexToOpenAI')

function createHttpAppWithUnifiedAndRelay({ upstreamPort, mockLogger }) {
  jest.resetModules()

  jest.doMock('../src/utils/logger', () => mockLogger)
  jest.doMock('../config/config', () => ({
    requestTimeout: 10000,
    security: { encryptionKey: 'test-key' }
  }))
  jest.doMock('../src/routes/openaiClaudeRoutes', () => ({
    handleChatCompletion: jest.fn()
  }))
  jest.doMock('../src/handlers/geminiHandlers', () => ({
    handleStandardGenerateContent: jest.fn(),
    handleStandardStreamGenerateContent: jest.fn()
  }))
  jest.doMock('../src/middleware/auth', () => ({
    authenticateApiKey: (req, _res, next) => {
      req.apiKey = { id: 'key-1', name: 'osr-test', permissions: 'all' }
      next()
    }
  }))
  jest.doMock('../src/services/apiKeyService', () => ({
    hasPermission: jest.fn(() => true),
    recordUsage: jest.fn(async () => ({}))
  }))
  jest.doMock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
    hasMatchingChatPassthroughAccount: jest.fn(async () => false),
    selectAccountForApiKey: jest.fn(async () => ({
      accountId: 'acc-responses-1',
      accountType: 'openai-responses'
    })),
    _deleteSessionMapping: jest.fn(async () => {}),
    markAccountRateLimited: jest.fn(async () => {})
  }))
  jest.doMock('../src/services/account/openaiResponsesAccountService', () => ({
    normalizeProviderEndpoint: (ep) => (ep === 'completions' ? 'chat' : ep || 'responses'),
    getAccount: jest.fn(async () => ({
      id: 'acc-responses-1',
      name: 'cch-us-responses',
      baseApi: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: 'upstream-secret',
      providerEndpoint: 'auto',
      dailyQuota: '0'
    })),
    updateAccount: jest.fn(async () => {}),
    updateAccountUsage: jest.fn(async () => {})
  }))
  jest.doMock('../src/services/account/openaiAccountService', () => ({
    getAccount: jest.fn(),
    isTokenExpired: jest.fn(() => false),
    decrypt: jest.fn((v) => v)
  }))
  jest.doMock('../src/services/requestBodyRuleService', () => ({
    applyRules: jest.fn((body) => body)
  }))

  const unifiedRoutes = require('../src/routes/unified')
  const app = express()
  app.use(
    compression({
      filter: (req, res) => {
        if (res.getHeader('Content-Type') === 'text/event-stream') {
          return false
        }
        return compression.filter(req, res)
      }
    })
  )
  app.use(express.json())
  app.use('/openai', unifiedRoutes)
  return app
}

function sendHttpRequest({ port, path, body, agent }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
          })
        })
        res.on('error', reject)
      }
    )
    req.setTimeout(3000, () => {
      req.destroy(new Error('Client request timed out (Content-Length framing hang)'))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

describe('Unified OpenAI /v1/chat/completions stream framing & disconnect handling', () => {
  describe('CodexToOpenAIConverter.buildRequestFromOpenAI stream normalization', () => {
    it('explicitly normalizes omitted, false, non-boolean, and true stream values', () => {
      const converter = new CodexToOpenAIConverter()
      const base = { model: 'gpt-6.2-sol', messages: [{ role: 'user', content: 'hi' }] }

      expect(converter.buildRequestFromOpenAI(base).stream).toBe(false)
      expect(converter.buildRequestFromOpenAI({ ...base, stream: false }).stream).toBe(false)
      expect(converter.buildRequestFromOpenAI({ ...base, stream: 'false' }).stream).toBe(false)
      expect(converter.buildRequestFromOpenAI({ ...base, stream: true }).stream).toBe(true)
    })
  })

  describe('End-to-end HTTP framing over keep-alive with compression', () => {
    let upstreamServer
    let upstreamPort
    let appServer
    let appPort
    let upstreamHandler
    let receivedUpstreamBodies
    let mockLogger

    beforeEach(async () => {
      receivedUpstreamBodies = []
      mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        success: jest.fn(),
        security: jest.fn(),
        api: jest.fn()
      }

      upstreamHandler = (req, res, parsedBody) => {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            id: 'resp_test_1',
            object: 'response',
            created_at: 1795421000,
            model: parsedBody.model,
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Hello from upstream!' }]
              }
            ],
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
          })
        )
      }

      upstreamServer = http.createServer((req, res) => {
        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          receivedUpstreamBodies.push({ url: req.url, body: parsed })
          upstreamHandler(req, res, parsed)
        })
      })

      await new Promise((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve))
      upstreamPort = upstreamServer.address().port

      const app = createHttpAppWithUnifiedAndRelay({ upstreamPort, mockLogger })
      appServer = app.listen(0, '127.0.0.1')
      await new Promise((resolve) => appServer.once('listening', resolve))
      appPort = appServer.address().port
    })

    afterEach(async () => {
      if (appServer) {
        await new Promise((resolve) => appServer.close(resolve))
      }
      if (upstreamServer) {
        await new Promise((resolve) => upstreamServer.close(resolve))
      }
    })

    it('returns full chat.completion JSON without hanging when stream is omitted (Go omitempty)', async () => {
      const agent = new http.Agent({ keepAlive: true })
      try {
        const resp = await sendHttpRequest({
          port: appPort,
          path: '/openai/v1/chat/completions',
          agent,
          body: {
            model: 'gpt-6.2-sol',
            messages: [{ role: 'user', content: 'Say hello' }]
          }
        })

        expect(resp.statusCode).toBe(200)
        expect(resp.headers['content-type']).toContain('application/json')
        expect(Number(resp.headers['content-length'])).toBe(Buffer.byteLength(resp.body, 'utf8'))

        const json = JSON.parse(resp.body)
        expect(json.object).toBe('chat.completion')
        expect(json.choices[0].message.content).toBe('Hello from upstream!')
        expect(json.usage.total_tokens).toBe(15)

        expect(receivedUpstreamBodies).toHaveLength(1)
        expect(receivedUpstreamBodies[0].url).toBe('/v1/responses')
        expect(receivedUpstreamBodies[0].body.stream).toBe(false)

        // Allow any close ticks to flush and verify no false client-disconnected log fired
        await new Promise((resolve) => setTimeout(resolve, 30))
        const disconnectLogs = mockLogger.info.mock.calls.filter(([msg]) =>
          String(msg).includes('Client disconnected, aborting OpenAI-Responses request')
        )
        expect(disconnectLogs).toHaveLength(0)
      } finally {
        agent.destroy()
      }
    })

    it('returns full chat.completion JSON when stream is explicitly false', async () => {
      const resp = await sendHttpRequest({
        port: appPort,
        path: '/openai/v1/chat/completions',
        body: {
          model: 'gpt-6.2-sol',
          stream: false,
          messages: [{ role: 'user', content: 'Say hello' }]
        }
      })

      expect(resp.statusCode).toBe(200)
      const json = JSON.parse(resp.body)
      expect(json.object).toBe('chat.completion')
      expect(json.choices[0].message.content).toBe('Hello from upstream!')
      expect(receivedUpstreamBodies[0].body.stream).toBe(false)
    })

    it('streams SSE correctly and preserves split multi-byte UTF-8 characters + data: without space', async () => {
      upstreamHandler = (_req, res) => {
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')

        const created = Buffer.from(
          `data:${JSON.stringify({
            type: 'response.created',
            response: { id: 'resp_utf8', created_at: 1795421000, model: 'gpt-6.2-sol' }
          })}\n\n`,
          'utf8'
        )
        const deltaPayload = Buffer.from(
          `data: ${JSON.stringify({
            type: 'response.output_text.delta',
            delta: '你好世界🚀'
          })}\n\n`,
          'utf8'
        )
        // Split right in the middle of the 3-byte UTF-8 sequence for '你'
        const idxNi = deltaPayload.indexOf(Buffer.from('你', 'utf8'))
        const part1 = deltaPayload.subarray(0, idxNi + 1)
        const part2 = deltaPayload.subarray(idxNi + 1)

        const completed = Buffer.from(
          `data: ${JSON.stringify({
            type: 'response.completed',
            response: {
              id: 'resp_utf8',
              status: 'completed',
              model: 'gpt-6.2-sol',
              usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 }
            }
          })}\n\n`,
          'utf8'
        )

        res.write(created)
        res.write(part1)
        setTimeout(() => {
          res.write(part2)
          res.write(completed)
          res.end()
        }, 10)
      }

      const resp = await sendHttpRequest({
        port: appPort,
        path: '/openai/v1/chat/completions',
        body: {
          model: 'gpt-6.2-sol',
          stream: true,
          messages: [{ role: 'user', content: 'hi' }]
        }
      })

      expect(resp.statusCode).toBe(200)
      expect(resp.headers['content-type']).toContain('text/event-stream')
      expect(resp.body).toContain('你好世界🚀')
      expect(resp.body).not.toContain('\uFFFD')
      expect(resp.body).toContain('data: [DONE]\n\n')
      expect(receivedUpstreamBodies[0].body.stream).toBe(true)
    })

    it('passes through 4xx upstream error cleanly on streaming requests', async () => {
      upstreamHandler = (_req, res) => {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: { message: 'bad param', type: 'invalid_request_error' } }))
      }

      const resp = await sendHttpRequest({
        port: appPort,
        path: '/openai/v1/chat/completions',
        body: {
          model: 'gpt-6.2-sol',
          stream: true,
          messages: [{ role: 'user', content: 'hi' }]
        }
      })

      expect(resp.statusCode).toBe(400)
      const json = JSON.parse(resp.body)
      expect(json.error).toBeDefined()
    })

    it('aborts upstream request when client genuinely disconnects before response finishes', async () => {
      let upstreamAborted = false
      upstreamHandler = (req, _res) => {
        req.on('close', () => {
          upstreamAborted = true
        })
        // Hold open intentionally until client aborts
      }

      await new Promise((resolve) => {
        const payload = JSON.stringify({
          model: 'gpt-6.2-sol',
          messages: [{ role: 'user', content: 'long wait' }]
        })
        const req = http.request({
          hostname: '127.0.0.1',
          port: appPort,
          path: '/openai/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        })
        req.on('error', () => {})
        req.write(payload)
        req.end()
        setTimeout(() => {
          req.destroy()
          setTimeout(resolve, 60)
        }, 50)
      })

      expect(upstreamAborted).toBe(true)
      const disconnectLogs = mockLogger.info.mock.calls.filter(([msg]) =>
        String(msg).includes('Client disconnected, aborting OpenAI-Responses request')
      )
      expect(disconnectLogs.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('openaiResponsesRelayService disconnect listener cleanup on 429 & error', () => {
    it('removes close listener on 429 response so normal close does not log disconnect', async () => {
      jest.resetModules()
      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        success: jest.fn()
      }
      jest.doMock('axios', () =>
        jest.fn(async () => ({
          status: 429,
          statusText: 'Too Many Requests',
          headers: {},
          data: { error: { message: 'rate limited', resets_in_seconds: 60 } }
        }))
      )
      jest.doMock('../src/utils/logger', () => mockLogger)
      jest.doMock('../config/config', () => ({ requestTimeout: 10000 }))
      jest.doMock('../src/services/apiKeyService', () => ({ recordUsage: jest.fn() }))
      jest.doMock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
        _deleteSessionMapping: jest.fn(async () => {}),
        markAccountRateLimited: jest.fn(async () => {})
      }))
      jest.doMock('../src/services/account/openaiResponsesAccountService', () => ({
        normalizeProviderEndpoint: (ep) => ep || 'responses',
        getAccount: jest.fn(async () => ({
          id: 'acc-1',
          name: 'acc-1',
          baseApi: 'https://example.com',
          apiKey: 'k',
          providerEndpoint: 'responses'
        })),
        updateAccount: jest.fn(async () => {}),
        updateAccountUsage: jest.fn(async () => {})
      }))
      jest.doMock('../src/utils/upstreamErrorHelper', () => ({
        markTempUnavailable: jest.fn(async () => {}),
        parseRetryAfter: jest.fn(() => 60),
        sanitizeErrorForClient: jest.fn((e) => e)
      }))

      const relay = require('../src/services/relay/openaiResponsesRelayService')
      const req = new EventEmitter()
      req.method = 'POST'
      req.path = '/v1/responses'
      req.headers = {}
      req.body = { model: 'gpt-6.2-sol', stream: false }

      const res = new EventEmitter()
      res.statusCode = 200
      res.writableFinished = false
      res.status = jest.fn(() => res)
      res.json = jest.fn(() => {
        res.writableFinished = true
        res.emit('close')
        return res
      })

      await relay.handleRequest(req, res, { id: 'acc-1', name: 'acc-1' }, { id: 'key-1' })

      expect(res.status).toHaveBeenCalledWith(429)
      expect(res.listenerCount('close')).toBe(0)
      const disconnectLogs = mockLogger.info.mock.calls.filter(([msg]) =>
        String(msg).includes('Client disconnected')
      )
      expect(disconnectLogs).toHaveLength(0)
    })
  })

  describe('api.js /v1/messages preserves pre-set Connection: close header', () => {
    it('does not overwrite Connection: close set by concurrency queue middleware', async () => {
      jest.resetModules()
      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        success: jest.fn(),
        security: jest.fn(),
        api: jest.fn()
      }
      jest.doMock('../src/utils/logger', () => mockLogger)
      jest.doMock('../src/middleware/auth', () => ({
        authenticateApiKey: (req, res, next) => {
          req.apiKey = { id: 'key-q', name: 'queued-key', permissions: 'all' }
          if (req.headers['x-test-queued'] === '1') {
            res.setHeader('Connection', 'close')
          }
          next()
        }
      }))
      jest.doMock('../src/services/relay/claudeRelayService', () => ({
        relayStreamRequestWithUsageCapture: jest.fn(async (_body, _key, res) => {
          res.write('event: message_stop\ndata: {}\n\n')
          res.end()
        }),
        relayRequest: jest.fn()
      }))
      jest.doMock('../src/services/relay/claudeConsoleRelayService', () => ({
        relayStreamRequestWithUsageCapture: jest.fn(),
        relayRequest: jest.fn()
      }))
      jest.doMock('../src/services/relay/bedrockRelayService', () => ({
        handleStreamRequest: jest.fn(),
        handleRequest: jest.fn()
      }))
      jest.doMock('../src/services/relay/ccrRelayService', () => ({
        relayStreamRequestWithUsageCapture: jest.fn(),
        relayRequest: jest.fn()
      }))
      jest.doMock('../src/services/account/bedrockAccountService', () => ({}))
      jest.doMock('../src/services/account/claudeAccountService', () => ({}))
      jest.doMock('../src/services/account/claudeConsoleAccountService', () => ({}))
      jest.doMock('../src/services/scheduler/unifiedClaudeScheduler', () => ({
        selectAccountForApiKey: jest.fn(async () => ({
          accountId: 'acc-claude-1',
          accountType: 'claude-official'
        }))
      }))
      jest.doMock('../src/services/apiKeyService', () => ({
        hasPermission: jest.fn(() => true),
        recordUsageWithDetails: jest.fn(async () => ({}))
      }))
      jest.doMock('../src/utils/modelHelper', () => ({
        getEffectiveModel: (m) => m,
        parseVendorPrefixedModel: (m) => ({ model: m, vendor: null })
      }))
      jest.doMock('../src/utils/sessionHelper', () => ({
        generateSessionHash: jest.fn(() => 'hash-1')
      }))
      jest.doMock('../src/utils/rateLimitHelper', () => ({
        updateRateLimitCounters: jest.fn(async () => ({ totalTokens: 0, totalCost: 0 }))
      }))
      jest.doMock('../src/services/claudeRelayConfigService', () => ({
        isGlobalSessionBindingEnabled: jest.fn(async () => false)
      }))
      jest.doMock('../src/utils/warmupInterceptor', () => ({
        isWarmupRequest: jest.fn(() => false),
        buildMockWarmupResponse: jest.fn(),
        sendMockWarmupStream: jest.fn()
      }))
      jest.doMock('../src/utils/errorSanitizer', () => ({
        sanitizeUpstreamError: jest.fn((e) => e)
      }))
      jest.doMock('../src/utils/anthropicRequestDump', () => ({
        dumpAnthropicMessagesRequest: jest.fn()
      }))
      jest.doMock('../src/utils/requestDetailHelper', () => ({
        createRequestDetailMeta: jest.fn(() => ({}))
      }))
      jest.doMock('../src/services/anthropicGeminiBridgeService', () => ({
        handleAnthropicMessagesToGemini: jest.fn(),
        handleAnthropicCountTokensToGemini: jest.fn()
      }))

      const apiRoutes = require('../src/routes/api')
      const app = express()
      app.use(express.json())
      app.use('/api', apiRoutes)

      const srv = app.listen(0, '127.0.0.1')
      await new Promise((resolve) => srv.once('listening', resolve))
      const { port } = srv.address()

      try {
        const makeReq = (queued) =>
          new Promise((resolve, reject) => {
            const payload = JSON.stringify({
              model: 'claude-sonnet-4-5',
              stream: true,
              messages: [{ role: 'user', content: 'hi' }]
            })
            const req = http.request(
              {
                hostname: '127.0.0.1',
                port,
                path: '/api/v1/messages',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                  ...(queued ? { 'x-test-queued': '1' } : {})
                }
              },
              (res) => {
                res.resume()
                res.on('end', () => resolve(res.headers))
              }
            )
            req.on('error', reject)
            req.write(payload)
            req.end()
          })

        const queuedHeaders = await makeReq(true)
        expect(queuedHeaders.connection).toBe('close')

        const normalHeaders = await makeReq(false)
        expect(normalHeaders.connection).toBe('keep-alive')
      } finally {
        await new Promise((resolve) => srv.close(resolve))
      }
    })
  })
})
