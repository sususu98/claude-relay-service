jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))

const { createSafeErrorResponse, mapToErrorCode } = require('../src/utils/errorSanitizer')

describe('errorSanitizer cch_session_id passthrough', () => {
  it('passes through no_available_providers messages with cch_session_id', () => {
    const error = {
      error: {
        message: 'No available providers (cch_session_id: 083c8338-7334-41e6-b99c-aa2171cc81a7)',
        type: 'no_available_providers',
        code: 'no_available_providers'
      }
    }

    expect(mapToErrorCode(error, { logOriginal: false })).toEqual({
      code: 'E006',
      message: 'No available providers (cch_session_id: 083c8338-7334-41e6-b99c-aa2171cc81a7)',
      status: 503
    })
  })

  it('passes through service_unavailable_error messages with cch_session_id', () => {
    const error = {
      error: {
        message: '所有供应商暂时不可用，请稍后重试 (cch_session_id: sess_mpicb407_75b9a193739c)',
        type: 'service_unavailable_error',
        code: 'service_unavailable_error'
      }
    }

    expect(createSafeErrorResponse(error, { logOriginal: false })).toEqual({
      error: {
        code: 'E001',
        message: '所有供应商暂时不可用，请稍后重试 (cch_session_id: sess_mpicb407_75b9a193739c)'
      },
      status: 503
    })
  })

  it('passes through http_408 messages with cch_session_id as timeout errors', () => {
    const error = {
      error: {
        message: JSON.stringify({
          error: {
            message: '上游服务响应超时，请稍后重试 (cch_session_id: 7d0fcc36-b19f-43ac-b7ab-e9725e1c3655)',
            type: 'api_error',
            code: 'http_408'
          }
        })
      }
    }

    expect(mapToErrorCode(error, { logOriginal: false })).toEqual({
      code: 'E008',
      message: '上游服务响应超时，请稍后重试 (cch_session_id: 7d0fcc36-b19f-43ac-b7ab-e9725e1c3655)',
      status: 504
    })
  })

  it('keeps stripping cch_session_id from no_available_providers when it is absent', () => {
    const error = {
      error: {
        message: 'No available providers',
        type: 'no_available_providers',
        code: 'no_available_providers'
      }
    }

    expect(mapToErrorCode(error, { logOriginal: false })).toEqual({
      code: 'E006',
      message: 'No available providers',
      status: 503
    })
  })
})
