// __tests__/personalities/PersonalityManager.test.js
const path = require('path');

// Mock the logger
jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('PersonalityManager', () => {
  let personalityManager;

  beforeEach(() => {
    // Clear the require cache to get a fresh instance
    jest.resetModules();
    personalityManager = require('../../personalities');
  });

  describe('loadPersonalities', () => {
    it('should load all personality files', () => {
      const personalities = personalityManager.getAll();
      expect(personalities.length).toBeGreaterThan(0);
    });

    it('should have required fields for each personality', () => {
      const personalities = personalityManager.getAll();

      for (const personality of personalities) {
        expect(personality).toHaveProperty('id');
        expect(personality).toHaveProperty('name');
        expect(personality).toHaveProperty('description');
        expect(personality).toHaveProperty('systemPrompt');
        expect(typeof personality.id).toBe('string');
        expect(typeof personality.name).toBe('string');
        expect(typeof personality.systemPrompt).toBe('string');
      }
    });
  });

  describe('get', () => {
    it('should return a personality by ID', () => {
      const personality = personalityManager.get('grumpy-historian');
      expect(personality).not.toBeNull();
      expect(personality.name).toBe('Professor Grimsworth');
    });

    it('should return null for non-existent personality', () => {
      const personality = personalityManager.get('does-not-exist');
      expect(personality).toBeNull();
    });
  });

  describe('exists', () => {
    it('should return true for existing personality', () => {
      expect(personalityManager.exists('noir-detective')).toBe(true);
    });

    it('should return false for non-existent personality', () => {
      expect(personalityManager.exists('fake-personality')).toBe(false);
    });
  });

  describe('list', () => {
    it('should return array of personality summaries', () => {
      const list = personalityManager.list();

      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);

      for (const item of list) {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('description');
        expect(item).toHaveProperty('emoji');
      }
    });

    it('should not include systemPrompt in list output', () => {
      const list = personalityManager.list();

      for (const item of list) {
        expect(item).not.toHaveProperty('systemPrompt');
      }
    });
  });

  describe('specific personalities', () => {
    it('should have grumpy-historian personality', () => {
      const personality = personalityManager.get('grumpy-historian');
      expect(personality).not.toBeNull();
      expect(personality.emoji).toBe('📚');
    });

    it('should have noir-detective personality', () => {
      const personality = personalityManager.get('noir-detective');
      expect(personality).not.toBeNull();
      expect(personality.emoji).toBe('🕵️');
    });

    it('should have existential personality', () => {
      const personality = personalityManager.get('existential');
      expect(personality).not.toBeNull();
      expect(personality.emoji).toBe('🤔');
    });

    it('should have irc-gamer personality', () => {
      const personality = personalityManager.get('irc-gamer');
      expect(personality).not.toBeNull();
      expect(personality.emoji).toBe('💾');
    });

    it('should have friendly personality', () => {
      const personality = personalityManager.get('friendly');
      expect(personality).not.toBeNull();
      expect(personality.name).toBe('Friendly Assistant');
      expect(personality.emoji).toBe('😊');
    });
  });
});
