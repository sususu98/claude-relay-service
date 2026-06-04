const express = require('express')
const request = require('supertest')

jest.mock('../src/middleware/auth', () => ({
  authenticateAdmin: jest.fn((_req, _res, next) => next())
}))

jest.mock('../src/utils/logger', () => ({
  api: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn(),
  database: jest.fn(),
  security: jest.fn()
}))

jest.mock('../src/models/redis', () => ({
  getDateStringInTimezone: jest.fn(() => '2026-06-04'),
  getDateInTimezone: jest.fn(() => new Date(Date.UTC(2026, 5, 4))),
  scanAndGetAllChunked: jest.fn()
}))

jest.mock('../src/utils/costCalculator', () => ({
  calculateCost: jest.fn(() => ({
    costs: { total: 999, input: 999, output: 0, cacheCreate: 0, cacheRead: 0 },
    formatted: { total: '$999.00' },
    pricing: { input: 999 }
  })),
  formatCost: jest.fn((cost) => `$${cost.toFixed(6)}`)
}))

jest.mock('../src/services/apiKeyService', () => ({}))
jest.mock('../src/services/account/claudeAccountService', () => ({}))
jest.mock('../src/services/account/claudeConsoleAccountService', () => ({}))
jest.mock('../src/services/account/bedrockAccountService', () => ({}))
jest.mock('../src/services/account/ccrAccountService', () => ({}))
jest.mock('../src/services/account/geminiAccountService', () => ({}))
jest.mock('../src/services/account/droidAccountService', () => ({}))
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({}))
jest.mock('../src/utils/upstreamErrorHelper', () => ({}))
jest.mock('../config/config', () => ({}), { virtual: true })

describe('admin dashboard model stats', () => {
  let app
  let redis
  let CostCalculator

  beforeEach(() => {
    jest.resetModules()
    redis = require('../src/models/redis')
    CostCalculator = require('../src/utils/costCalculator')

    redis.scanAndGetAllChunked.mockImplementation(async (pattern) => {
      if (pattern === 'usage:model:monthly:*:2026-06') {
        return [
          {
            key: 'usage:model:monthly:gpt-5.5-fast:2026-06',
            data: {
              requests: '2',
              inputTokens: '1000000',
              outputTokens: '100000',
              cacheCreateTokens: '0',
              cacheReadTokens: '0',
              allTokens: '1100000'
            }
          }
        ]
      }

      if (pattern === 'usage:*:model:monthly:*:2026-06') {
        return [
          {
            key: 'usage:key-a:model:monthly:gpt-5.5-fast:2026-06',
            data: {
              realCostMicro: '1234567',
              ratedCostMicro: '2345678'
            }
          }
        ]
      }

      return []
    })

    const dashboardRoutes = require('../src/routes/admin/dashboard')
    app = express()
    app.use('/admin', dashboardRoutes)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('uses stored API-key model cost instead of recomputing global aggregate token cost', async () => {
    const response = await request(app).get('/admin/model-stats?period=monthly').expect(200)

    expect(redis.scanAndGetAllChunked).toHaveBeenCalledWith('usage:model:monthly:*:2026-06')
    expect(redis.scanAndGetAllChunked).toHaveBeenCalledWith('usage:*:model:monthly:*:2026-06')
    expect(CostCalculator.calculateCost).toHaveBeenCalled()

    expect(response.body.success).toBe(true)
    expect(response.body.data).toHaveLength(1)
    expect(response.body.data[0]).toMatchObject({
      model: 'gpt-5.5-fast',
      usingStoredCost: true,
      storedCostBreakdownAvailable: false,
      isLegacy: false,
      costs: {
        input: 0,
        output: 0,
        cacheCreate: 0,
        cacheRead: 0,
        total: 1.234567,
        real: 1.234567,
        rated: 2.345678
      },
      formatted: {
        input: '$0.000000',
        output: '$0.000000',
        cacheCreate: '$0.000000',
        cacheRead: '$0.000000',
        total: '$1.234567',
        real: '$1.234567',
        rated: '$2.345678'
      }
    })
  })
})
