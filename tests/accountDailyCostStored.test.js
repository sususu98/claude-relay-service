jest.mock(
  '../config/config',
  () => ({
    system: {
      timezoneOffset: 0
    }
  }),
  { virtual: true }
)

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  debug: jest.fn()
}))

jest.mock('../src/utils/costCalculator', () => ({
  isOpenAIModel: jest.fn((model, pricing) => {
    return model.includes('gpt') || pricing?.litellm_provider === 'openai'
  }),
  calculateCost: jest.fn(() => ({
    costs: { total: 999 },
    debug: { isLongContextRequest: false }
  }))
}))

jest.mock('../src/services/pricingService', () => ({
  getModelPricing: jest.fn()
}))

const redis = require('../src/models/redis')
const CostCalculator = require('../src/utils/costCalculator')
const pricingService = require('../src/services/pricingService')

describe('redis account daily cost stored cost', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-04T10:15:00.000Z'))
    jest.clearAllMocks()
    pricingService.getModelPricing.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
    redis.client = null
  })

  test('getAccountDailyCost uses stored real cost instead of recalculating aggregate tokens', async () => {
    const pipeline = {
      hgetall: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [
          null,
          {
            inputTokens: '1000000',
            outputTokens: '100000',
            realCostMicro: '1234567',
            ratedCostMicro: '2345678'
          }
        ]
      ])
    }
    redis.client = {
      smembers: jest.fn().mockResolvedValue(['acct-1:gpt-5.5-fast']),
      pipeline: jest.fn(() => pipeline)
    }

    const result = await redis.getAccountDailyCost('acct-1')

    expect(result).toBe(1.234567)
    expect(CostCalculator.calculateCost).not.toHaveBeenCalled()
    expect(pipeline.hgetall).toHaveBeenCalledWith(
      'account_usage:model:daily:acct-1:gpt-5.5-fast:2026-06-04'
    )
  })

  test('getAccountDailyCost does not use rated-only stored cost for account quota', async () => {
    const pipeline = {
      hgetall: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [
          null,
          {
            inputTokens: '1000000',
            outputTokens: '100000',
            ratedCostMicro: '2345678'
          }
        ]
      ])
    }
    redis.client = {
      smembers: jest.fn().mockResolvedValue(['acct-1:gpt-5.5-fast']),
      pipeline: jest.fn(() => pipeline)
    }

    const result = await redis.getAccountDailyCost('acct-1')

    expect(result).toBe(0)
    expect(CostCalculator.calculateCost).not.toHaveBeenCalled()
  })

  test('getAccountDailyCost uses base pricing for legacy aggregate long-context fallback', async () => {
    CostCalculator.calculateCost.mockReturnValueOnce({
      costs: { total: 10 },
      debug: { isLongContextRequest: true }
    })
    pricingService.getModelPricing.mockReturnValue({
      input_cost_per_token: 0.000005,
      output_cost_per_token: 0.00003,
      cache_read_input_token_cost: 0.0000005,
      litellm_provider: 'openai'
    })
    const pipeline = {
      hgetall: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [
          null,
          {
            inputTokens: '300000',
            outputTokens: '1000',
            cacheCreateTokens: '0',
            cacheReadTokens: '0'
          }
        ]
      ])
    }
    redis.client = {
      smembers: jest.fn().mockResolvedValue(['acct-1:gpt-5.5']),
      pipeline: jest.fn(() => pipeline)
    }

    const result = await redis.getAccountDailyCost('acct-1')

    expect(result).toBeCloseTo(1.53, 10)
    expect(CostCalculator.calculateCost).toHaveBeenCalled()
  })

  test('incrementAccountUsage stores real and rated cost micro values by account model period', async () => {
    redis.client = {
      hincrby: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1)
    }

    await redis.incrementAccountUsage(
      'acct-1',
      1100,
      1000,
      100,
      0,
      0,
      0,
      0,
      'gpt-5.5-fast',
      false,
      1.234567,
      2.345678
    )

    expect(redis.client.hincrby).toHaveBeenCalledWith(
      'account_usage:model:daily:acct-1:gpt-5.5-fast:2026-06-04',
      'realCostMicro',
      1234567
    )
    expect(redis.client.hincrby).toHaveBeenCalledWith(
      'account_usage:model:monthly:acct-1:gpt-5.5-fast:2026-06',
      'ratedCostMicro',
      2345678
    )
    expect(redis.client.hincrby).toHaveBeenCalledWith(
      'account_usage:model:hourly:acct-1:gpt-5.5-fast:2026-06-04:18',
      'realCostMicro',
      1234567
    )
  })
})
