/**
 * Tests for the cost-aware Polly voice/engine resolution (COST-FIX).
 */
const { resolveVoiceAndEngine } = require('../../../src/lib/polly');

describe('resolveVoiceAndEngine', () => {
  afterEach(() => {
    delete process.env.POLLY_ALLOW_GENERATIVE;
    delete process.env.POLLY_DEFAULT_ENGINE;
    delete process.env.ALLOWED_VOICES;
  });

  it('defaults neural-capable voices to the neural engine', () => {
    expect(resolveVoiceAndEngine('Ruth', null)).toEqual({ voice: 'Ruth', engine: 'neural' });
    expect(resolveVoiceAndEngine('Matthew', null)).toEqual({ voice: 'Matthew', engine: 'neural' });
  });

  it('substitutes generative-only voices in cost-saver mode (default)', () => {
    // Tiffany only supports generative; without opt-in, swap to Ruth/neural
    expect(resolveVoiceAndEngine('Tiffany', null)).toEqual({ voice: 'Ruth', engine: 'neural' });
    expect(resolveVoiceAndEngine('Ruth', 'generative')).toEqual({ voice: 'Ruth', engine: 'neural' });
  });

  it('honours generative when explicitly allowed via env', () => {
    process.env.POLLY_ALLOW_GENERATIVE = 'true';
    expect(resolveVoiceAndEngine('Tiffany', null)).toEqual({ voice: 'Tiffany', engine: 'generative' });
    expect(resolveVoiceAndEngine('Ruth', 'generative')).toEqual({ voice: 'Ruth', engine: 'generative' });
  });

  it('falls back to the cheapest supported engine on mismatch', () => {
    // Amy does not support generative; cheapest she offers is standard
    process.env.ALLOWED_VOICES = 'Ruth,Amy';
    expect(resolveVoiceAndEngine('Amy', 'generative')).toEqual({ voice: 'Amy', engine: 'standard' });
  });

  it('replaces unknown voices with the cost-saver voice', () => {
    expect(resolveVoiceAndEngine('NotARealVoice', null)).toEqual({ voice: 'Ruth', engine: 'neural' });
  });

  it('respects POLLY_DEFAULT_ENGINE for capable voices', () => {
    process.env.ALLOWED_VOICES = 'Ruth,Amy';
    process.env.POLLY_DEFAULT_ENGINE = 'standard';
    expect(resolveVoiceAndEngine('Amy', null)).toEqual({ voice: 'Amy', engine: 'standard' });
  });

  it('honours generative for a Premium request (allowGenerative) without the env flag', () => {
    // Premium voice mode: the per-request opt-in unlocks Tiffany/generative.
    expect(resolveVoiceAndEngine('Tiffany', 'generative', { allowGenerative: true }))
      .toEqual({ voice: 'Tiffany', engine: 'generative' });
  });

  it('still substitutes for a cost-saver request even if it asks for generative', () => {
    expect(resolveVoiceAndEngine('Tiffany', 'generative', { allowGenerative: false }))
      .toEqual({ voice: 'Ruth', engine: 'neural' });
  });

  it('lets POLLY_ALLOW_GENERATIVE=false hard-block even a Premium request', () => {
    process.env.POLLY_ALLOW_GENERATIVE = 'false';
    expect(resolveVoiceAndEngine('Tiffany', 'generative', { allowGenerative: true }))
      .toEqual({ voice: 'Ruth', engine: 'neural' });
  });
});
