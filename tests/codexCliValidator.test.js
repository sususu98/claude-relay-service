jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn()
}))

const CodexCliValidator = require('../src/validators/clients/codexCliValidator')

function createReq({
  userAgent = 'codex_cli_rs/0.38.0 (Ubuntu 22.4.0; x86_64) WindowsTerminal',
  originator = 'codex_cli_rs',
  instructions = "You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer."
} = {}) {
  return {
    headers: {
      'user-agent': userAgent,
      originator,
      session_id: '019dce8e-4843-7c50-aaad-fbd70ae46a6d'
    },
    path: '/openai/responses',
    body: {
      model: 'gpt-5-codex',
      instructions
    }
  }
}

describe('CodexCliValidator', () => {
  test('accepts Codex Desktop requests with desktop instructions', () => {
    const req = createReq({
      userAgent:
        'Codex Desktop/0.125.0-alpha.3 (Windows 10.0.26100; x86_64) unknown (Codex Desktop; 26.422.30944)',
      originator: 'Codex Desktop',
      instructions:
        'You are Codex, a coding agent based on GPT-5. You and the user share one workspace.'
    })

    expect(CodexCliValidator.validate(req)).toBe(true)
  })

  test('keeps accepting existing Codex CLI requests', () => {
    expect(CodexCliValidator.validate(createReq())).toBe(true)
  })

  test('rejects Codex Desktop requests with mismatched originator', () => {
    const req = createReq({
      userAgent:
        'Codex Desktop/0.125.0-alpha.3 (Windows 10.0.26100; x86_64) unknown (Codex Desktop; 26.422.30944)',
      originator: 'codex_cli_rs',
      instructions:
        'You are Codex, a coding agent based on GPT-5. You and the user share one workspace.'
    })

    expect(CodexCliValidator.validate(req)).toBe(false)
  })
})
