const { PassThrough } = require('stream')

jest.mock('axios', () => jest.fn())
jest.mock('../src/services/scheduler/unifiedGeminiScheduler', () => ({
  selectAccountForApiKey: jest.fn()
}))
jest.mock('../src/services/account/geminiApiAccountService', () => ({
  getAccount: jest.fn()
}))
jest.mock('../src/services/account/geminiAccountService', () => ({
  getAccount: jest.fn()
}))
jest.mock('../src/utils/rateLimitHelper', () => ({
  updateRateLimitCounters: jest.fn().mockResolvedValue({ rateLimitHeaders: {} })
}))
jest.mock('../src/services/apiKeyService', () => ({
  hasPermission: jest.fn().mockReturnValue(true),
  recordUsage: jest.fn().mockResolvedValue(undefined)
}))

const axios = require('axios')
const unifiedGeminiScheduler = require('../src/services/scheduler/unifiedGeminiScheduler')
const geminiApiAccountService = require('../src/services/account/geminiApiAccountService')
const {
  sanitizeFunctionResponsesForApiKey,
  handleStandardGenerateContent,
  handleStandardStreamGenerateContent
} = require('../src/handlers/geminiHandlers')

function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    chunks: [],
    ended: false,
    headersSent: false,
    writableEnded: false,
    status(code) {
      this.statusCode = code
      return this
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    json(payload) {
      this.body = payload
      this.headersSent = true
      this.writableEnded = true
      return this
    },
    write(chunk) {
      this.chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
      this.headersSent = true
      return true
    },
    end() {
      this.ended = true
      this.writableEnded = true
    }
  }
  return res
}

describe('geminiHandlers functionResponse.id preservation', () => {
  const prevStripEnv = process.env.STRIP_GEMINI_FUNCTION_RESPONSE_ID

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.STRIP_GEMINI_FUNCTION_RESPONSE_ID
    unifiedGeminiScheduler.selectAccountForApiKey.mockResolvedValue({
      accountId: 'acc-gemini-api-1',
      accountType: 'gemini-api'
    })
    geminiApiAccountService.getAccount.mockResolvedValue({
      id: 'acc-gemini-api-1',
      baseUrl: 'https://cpa.us.xcodecli.com',
      apiKey: 'sk-cpa-test'
    })
  })

  afterEach(() => {
    if (prevStripEnv === undefined) {
      delete process.env.STRIP_GEMINI_FUNCTION_RESPONSE_ID
    } else {
      process.env.STRIP_GEMINI_FUNCTION_RESPONSE_ID = prevStripEnv
    }
  })

  it('preserves functionResponse.id, extra fields, and part sibling fields by default', () => {
    const contents = [
      {
        role: 'user',
        parts: [{ text: 'Check weather' }]
      },
      {
        role: 'model',
        parts: [
          {
            functionCall: { id: 'call_123', name: 'get_weather', args: { city: 'Tokyo' } },
            thoughtSignature: 'sig-1'
          }
        ]
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'call_123',
              name: 'get_weather',
              response: { temp: '22C' },
              willContinue: false
            }
          }
        ]
      }
    ]

    const result = sanitizeFunctionResponsesForApiKey(contents)
    expect(result).toBe(contents)
    expect(result[2].parts[0].functionResponse.id).toBe('call_123')
    expect(result[2].parts[0].functionResponse.willContinue).toBe(false)
    expect(result[1].parts[0].thoughtSignature).toBe('sig-1')
  })

  it('strips functionCall.id and functionResponse.id symmetrically only when explicitly enabled', () => {
    process.env.STRIP_GEMINI_FUNCTION_RESPONSE_ID = 'true'
    const contents = [
      {
        role: 'model',
        parts: [
          {
            functionCall: { id: 'call_123', name: 'get_weather', args: { city: 'Tokyo' } },
            thoughtSignature: 'sig-1'
          }
        ]
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'call_123',
              name: 'get_weather',
              response: { temp: '22C' }
            }
          }
        ]
      }
    ]

    const result = sanitizeFunctionResponsesForApiKey(contents)
    expect(result[0].parts[0]).toEqual({
      functionCall: { name: 'get_weather', args: { city: 'Tokyo' } },
      thoughtSignature: 'sig-1'
    })
    expect(result[1].parts[0]).toEqual({
      functionResponse: { name: 'get_weather', response: { temp: '22C' } }
    })
  })

  it('forwards functionResponse.id intact in handleStandardGenerateContent for gemini-api accounts', async () => {
    axios.mockResolvedValue({
      data: {
        candidates: [{ content: { role: 'model', parts: [{ text: '22C sunny' }] } }]
      }
    })

    const req = {
      params: { modelName: 'agy/gemini-4-hydrogen' },
      path: '/v1beta/models/agy%2Fgemini-4-hydrogen:generateContent',
      originalUrl: '/gemini/v1beta/models/agy%2Fgemini-4-hydrogen:generateContent',
      headers: {},
      apiKey: { id: 'key-1', name: 'test-key' },
      body: {
        contents: [
          { role: 'user', parts: [{ text: 'Call get_weather' }] },
          {
            role: 'model',
            parts: [
              { functionCall: { id: 'call_abc', name: 'get_weather', args: { city: 'Tokyo' } } }
            ]
          },
          {
            role: 'user',
            parts: [
              { functionResponse: { id: 'call_abc', name: 'get_weather', response: { ok: true } } }
            ]
          }
        ]
      }
    }
    const res = createMockResponse()

    await handleStandardGenerateContent(req, res)

    expect(res.statusCode).toBe(200)
    expect(axios).toHaveBeenCalledTimes(1)
    const sentPayload = axios.mock.calls[0][0].data
    expect(sentPayload.contents[1].parts[0].functionCall.id).toBe('call_abc')
    expect(sentPayload.contents[2].parts[0].functionResponse.id).toBe('call_abc')
  })

  it('forwards functionResponse.id intact in handleStandardStreamGenerateContent for gemini-api accounts', async () => {
    const stream = new PassThrough()
    axios.mockResolvedValue({ data: stream })

    const req = {
      params: { modelName: 'agy/gemini-4-neon' },
      path: '/v1beta/models/agy%2Fgemini-4-neon:streamGenerateContent',
      originalUrl: '/gemini/v1beta/models/agy%2Fgemini-4-neon:streamGenerateContent',
      headers: {},
      apiKey: { id: 'key-1', name: 'test-key' },
      on: jest.fn(),
      body: {
        contents: [
          { role: 'user', parts: [{ text: 'Call get_weather' }] },
          {
            role: 'model',
            parts: [
              {
                functionCall: { id: 'call_stream_1', name: 'get_weather', args: { city: 'Tokyo' } }
              }
            ]
          },
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  id: 'call_stream_1',
                  name: 'get_weather',
                  response: { ok: true }
                }
              }
            ]
          }
        ]
      }
    }
    const res = createMockResponse()

    const pending = handleStandardStreamGenerateContent(req, res)
    setImmediate(() => {
      stream.write(
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"done"}]}}]}\n\n'
      )
      stream.end()
    })
    await pending

    expect(axios).toHaveBeenCalledTimes(1)
    const sentPayload = axios.mock.calls[0][0].data
    expect(sentPayload.contents[1].parts[0].functionCall.id).toBe('call_stream_1')
    expect(sentPayload.contents[2].parts[0].functionResponse.id).toBe('call_stream_1')
  })
})
