const EventEmitter = require('events')
const express = require('express')
const request = require('supertest')

describe('CPA Chat Completions & Responses passthrough', () => {
  describe('openaiResponsesAccountService helpers', () => {
    let service

    beforeEach(() => {
      jest.useFakeTimers()
      jest.resetModules()
      jest.doMock('../src/models/redis', () => ({
        getClientSafe: jest.fn(),
        getDateStringInTimezone: jest.fn(() => '2026-11-22')
      }))
      jest.doMock('../src/utils/logger', () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        success: jest.fn()
      }))
      jest.doMock('../config/config', () => ({ security: { encryptionKey: 'test-key' } }))
      service = require('../src/services/account/openaiResponsesAccountService')
    })

    afterEach(() => {
      jest.clearAllTimers()
      jest.useRealTimers()
    })

    it('normalizes providerEndpoint including completions alias', () => {
      expect(service.normalizeProviderEndpoint('responses')).toBe('responses')
      expect(service.normalizeProviderEndpoint('auto')).toBe('auto')
      expect(service.normalizeProviderEndpoint('chat')).toBe('chat')
      expect(service.normalizeProviderEndpoint('completions')).toBe('chat')
      expect(service.normalizeProviderEndpoint('passthrough')).toBe('passthrough')
      expect(service.normalizeProviderEndpoint('')).toBe('responses')
    })

    it('enforces endpoint compatibility per providerEndpoint mode', () => {
      expect(service.accountSupportsEndpoint({ providerEndpoint: 'responses' }, 'responses')).toBe(
        true
      )
      expect(service.accountSupportsEndpoint({ providerEndpoint: 'responses' }, 'chat')).toBe(false)
      expect(service.accountSupportsEndpoint({ providerEndpoint: 'chat' }, 'chat')).toBe(true)
      expect(service.accountSupportsEndpoint({ providerEndpoint: 'chat' }, 'responses')).toBe(false)
      expect(service.accountSupportsEndpoint({ providerEndpoint: 'passthrough' }, 'chat')).toBe(
        true
      )
      expect(
        service.accountSupportsEndpoint({ providerEndpoint: 'passthrough' }, 'responses')
      ).toBe(true)
    })

    it('matches exact and wildcard supportedModels and defaults empty to allow all', () => {
      expect(service.matchesSupportedModels({ supportedModels: [] }, 'agy/gemini-4-neon')).toBe(
        true
      )
      expect(service.matchesSupportedModels({}, 'agy/gemini-4-neon')).toBe(true)
      expect(
        service.matchesSupportedModels(
          { supportedModels: ['agy/*', 'gemini-4*'] },
          'agy/gemini-4-neon'
        )
      ).toBe(true)
      expect(
        service.matchesSupportedModels(
          { supportedModels: ['agy/*', 'gemini-4*'] },
          'gemini-4-hydrogen'
        )
      ).toBe(true)
      expect(service.matchesSupportedModels({ supportedModels: ['agy/*'] }, 'gpt-5.6-sol')).toBe(
        false
      )
    })
  })

  describe('unified POST /v1/chat/completions direct passthrough', () => {
    it('forwards matching model directly to CPA chat upstream without translation', async () => {
      jest.resetModules()
      const mockHandleChatCompletion = jest.fn((req, res) => res.json({ via: 'claude' }))
      const mockRelayHandleRequest = jest.fn((req, res, account) =>
        res.json({ via: 'direct-chat', path: req.path, body: req.body, account: account.name })
      )
      const mockHasMatching = jest.fn(async (_key, model) => model.startsWith('agy/'))
      const mockSelectAccount = jest.fn(async () => ({
        accountId: 'cpa-chat-1',
        accountType: 'openai-responses'
      }))
      const mockGetAccount = jest.fn(async () => ({
        id: 'cpa-chat-1',
        name: 'cpa-us-chat',
        providerEndpoint: 'passthrough',
        baseApi: 'https://cpa.us.xcodecli.com'
      }))

      jest.doMock('../src/middleware/auth', () => ({
        authenticateApiKey: (req, _res, next) => {
          req.apiKey = { id: 'key-1', permissions: 'all' }
          next()
        }
      }))
      jest.doMock('../src/utils/logger', () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        api: jest.fn(),
        success: jest.fn(),
        security: jest.fn()
      }))
      jest.doMock('../src/routes/openaiClaudeRoutes', () => ({
        handleChatCompletion: (...args) => mockHandleChatCompletion(...args)
      }))
      jest.doMock('../src/handlers/geminiHandlers', () => ({
        handleStandardGenerateContent: jest.fn(),
        handleStandardStreamGenerateContent: jest.fn()
      }))
      jest.doMock('../src/routes/openaiRoutes', () => ({
        handleResponses: jest.fn(),
        CODEX_CLI_INSTRUCTIONS: 'SHOULD_NOT_BE_INJECTED'
      }))
      jest.doMock('../src/services/apiKeyService', () => ({
        hasPermission: jest.fn(() => true)
      }))
      jest.doMock('../src/services/geminiToOpenAI', () => jest.fn())
      jest.doMock('../src/services/codexToOpenAI', () => jest.fn())
      jest.doMock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
        hasMatchingChatPassthroughAccount: (...args) => mockHasMatching(...args),
        selectAccountForApiKey: (...args) => mockSelectAccount(...args)
      }))
      jest.doMock('../src/services/account/openaiResponsesAccountService', () => ({
        getAccount: (...args) => mockGetAccount(...args)
      }))
      jest.doMock('../src/services/relay/openaiResponsesRelayService', () => ({
        handleRequest: (...args) => mockRelayHandleRequest(...args)
      }))

      const unifiedRoutes = require('../src/routes/unified')
      const app = express()
      app.use(express.json())
      app.use('/openai', unifiedRoutes)

      // 1. Matching agy/* model bypasses CRS translation completely
      const resPassthrough = await request(app)
        .post('/openai/v1/chat/completions')
        .send({
          model: 'agy/gemini-4-neon',
          messages: [{ role: 'user', content: 'hello' }],
          stream: false
        })

      expect(resPassthrough.status).toBe(200)
      expect(resPassthrough.body.via).toBe('direct-chat')
      expect(resPassthrough.body.path).toBe('/v1/chat/completions')
      expect(resPassthrough.body.body.messages).toEqual([{ role: 'user', content: 'hello' }])
      expect(resPassthrough.body.body.instructions).toBeUndefined()
      expect(mockSelectAccount).toHaveBeenCalledWith(
        expect.any(Object),
        null,
        'agy/gemini-4-neon',
        { requiredEndpoint: 'chat' }
      )
      expect(mockHandleChatCompletion).not.toHaveBeenCalled()

      // 2. Non-matching model falls back to existing Claude route
      const resFallback = await request(app)
        .post('/openai/v1/chat/completions')
        .send({
          model: 'claude-sonnet-4-5',
          messages: [{ role: 'user', content: 'hello' }]
        })

      expect(resFallback.status).toBe(200)
      expect(resFallback.body).toEqual({ via: 'claude' })
      expect(mockHandleChatCompletion).toHaveBeenCalledTimes(1)
    })
  })

  describe('openaiResponsesRelayService Chat Completions streaming passthrough & billing', () => {
    it('forwards /v1/chat/completions with include_usage, captures SSE usage, and omits Connection keep-alive', async () => {
      jest.resetModules()
      jest.dontMock('../src/services/relay/openaiResponsesRelayService')
      const mockAxios = jest.fn()
      const mockRecordUsage = jest.fn(async () => ({}))
      const mockUpdateAccountUsage = jest.fn(async () => {})
      const mockUpdateAccount = jest.fn(async () => {})

      jest.doMock('axios', () => mockAxios)
      jest.doMock('../src/utils/logger', () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        success: jest.fn()
      }))
      jest.doMock('../config/config', () => ({ requestTimeout: 30000 }))
      jest.doMock('../src/services/apiKeyService', () => ({
        recordUsage: (...args) => mockRecordUsage(...args)
      }))
      jest.doMock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
        _deleteSessionMapping: jest.fn(async () => {}),
        markAccountRateLimited: jest.fn(async () => {})
      }))
      jest.doMock('../src/services/account/openaiResponsesAccountService', () => ({
        normalizeProviderEndpoint: (ep) => (ep === 'completions' ? 'chat' : ep || 'responses'),
        getAccount: jest.fn(async () => ({
          id: 'cpa-1',
          name: 'cpa-us-chat',
          baseApi: 'https://cpa.us.xcodecli.com',
          apiKey: 'secret-key',
          providerEndpoint: 'passthrough',
          dailyQuota: '0'
        })),
        updateAccount: (...args) => mockUpdateAccount(...args),
        updateAccountUsage: (...args) => mockUpdateAccountUsage(...args)
      }))

      const stream = new EventEmitter()
      stream.pipe = jest.fn()
      mockAxios.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/event-stream' },
        data: stream
      })

      const relay = require('../src/services/relay/openaiResponsesRelayService')
      const req = new EventEmitter()
      req.method = 'POST'
      req.path = '/v1/chat/completions'
      req.headers = { 'user-agent': 'test-client/1.0' }
      req.body = {
        model: 'agy/gemini-4-neon',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true
      }

      const headers = {}
      const chunks = []
      const res = new EventEmitter()
      res.statusCode = 200
      res.destroyed = false
      res.setHeader = (k, v) => {
        headers[k.toLowerCase()] = v
      }
      res.write = (c) => chunks.push(c.toString())
      let endResolve
      const endPromise = new Promise((r) => {
        endResolve = r
      })
      res.end = () => endResolve()

      await relay.handleRequest(req, res, { id: 'cpa-1', name: 'cpa-us-chat' }, { id: 'key-1' })

      expect(mockAxios).toHaveBeenCalledTimes(1)
      const axiosArg = mockAxios.mock.calls[0][0]
      expect(axiosArg.url).toBe('https://cpa.us.xcodecli.com/v1/chat/completions')
      expect(axiosArg.data.stream_options).toEqual({ include_usage: true })
      expect(headers['connection']).toBeUndefined()

      // Emit Chat Completions SSE chunks (with CRLF)
      stream.emit(
        'data',
        Buffer.from(
          'data: {"id":"c1","object":"chat.completion.chunk","model":"agy/gemini-4-neon","choices":[{"index":0,"delta":{"content":"OK"}}]}\r\n\r\n'
        )
      )
      stream.emit(
        'data',
        Buffer.from(
          'data: {"id":"c1","object":"chat.completion.chunk","model":"agy/gemini-4-neon","choices":[],"usage":{"prompt_tokens":500,"completion_tokens":20,"total_tokens":520,"prompt_tokens_details":{"cached_tokens":100}}}\r\n\r\n'
        )
      )
      stream.emit('data', Buffer.from('data: [DONE]\r\n\r\n'))
      stream.emit('end')

      await endPromise
      expect(mockRecordUsage).toHaveBeenCalledTimes(1)
      const [keyId, actualInput, output, cacheCreate, cacheRead, model] =
        mockRecordUsage.mock.calls[0]
      expect(keyId).toBe('key-1')
      expect(actualInput).toBe(400) // 500 - 100 cached
      expect(output).toBe(20)
      expect(cacheCreate).toBe(0)
      expect(cacheRead).toBe(100)
      expect(model).toBe('agy/gemini-4-neon')
      expect(mockUpdateAccountUsage).toHaveBeenCalledWith('cpa-1', 520)
    })
  })

  describe('pricingService gateway prefix fallback', () => {
    it('strips agy/ and antigravity/ prefixes when exact prefixed entry is absent', () => {
      jest.resetModules()
      jest.dontMock('../src/services/pricingService')
      const pricingService = require('../src/services/pricingService')
      pricingService.pricingData = {
        'gemini-4-neon': {
          input_cost_per_token: 3e-6,
          output_cost_per_token: 1.5e-5
        }
      }
      expect(pricingService.getModelPricing('agy/gemini-4-neon')).toEqual(
        pricingService.pricingData['gemini-4-neon']
      )
      expect(pricingService.getModelPricing('antigravity/gemini-4-neon')).toEqual(
        pricingService.pricingData['gemini-4-neon']
      )
      pricingService.cleanup?.()
    })
  })
})
