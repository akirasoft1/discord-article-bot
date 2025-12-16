// __tests__/services/NickMappingService.test.js

const NickMappingService = require('../../services/NickMappingService');
const path = require('path');

describe('NickMappingService', () => {
  let service;
  const testMappingsPath = path.join(__dirname, '../fixtures/test_nick_mappings.json');

  beforeAll(() => {
    service = new NickMappingService(testMappingsPath);
  });

  describe('constructor', () => {
    it('should load mappings from file', () => {
      expect(service.mappings).toBeDefined();
      expect(service.mappings.length).toBeGreaterThan(0);
    });

    it('should build reverse lookup index', () => {
      expect(service.nickToDiscord).toBeDefined();
      expect(service.nickToDiscord.size).toBeGreaterThan(0);
    });

    it('should handle missing file gracefully', () => {
      const emptyService = new NickMappingService('/nonexistent/path.json');
      expect(emptyService.mappings).toEqual([]);
    });
  });

  describe('getIrcNicks', () => {
    it('should return IRC nicks for a Discord user ID', () => {
      const nicks = service.getIrcNicks('123456789');
      expect(nicks).toEqual(['Akira1', 'Akira1_', 'cAd_Akira1']);
    });

    it('should return empty array for unknown Discord user', () => {
      const nicks = service.getIrcNicks('unknown_user');
      expect(nicks).toEqual([]);
    });

    it('should be case-sensitive for Discord IDs', () => {
      const nicks = service.getIrcNicks('123456789');
      expect(nicks.length).toBeGreaterThan(0);
    });
  });

  describe('getDiscordUser', () => {
    it('should return Discord user info for an IRC nick', () => {
      const user = service.getDiscordUser('Akira1');
      expect(user).toBeDefined();
      expect(user.id).toBe('123456789');
      expect(user.username).toBe('akirasoft');
    });

    it('should handle case-insensitive nick lookup', () => {
      const user1 = service.getDiscordUser('akira1');
      const user2 = service.getDiscordUser('AKIRA1');
      expect(user1).toEqual(user2);
    });

    it('should return null for unknown nick', () => {
      const user = service.getDiscordUser('unknown_nick');
      expect(user).toBeNull();
    });
  });

  describe('isNickOwnedBy', () => {
    it('should return true if nick belongs to Discord user', () => {
      expect(service.isNickOwnedBy('Akira1', '123456789')).toBe(true);
      expect(service.isNickOwnedBy('cAd_Akira1', '123456789')).toBe(true);
    });

    it('should return false if nick does not belong to user', () => {
      expect(service.isNickOwnedBy('Akira1', '987654321')).toBe(false);
    });

    it('should return false for unknown nick', () => {
      expect(service.isNickOwnedBy('unknown_nick', '123456789')).toBe(false);
    });
  });

  describe('getAllMappedNicks', () => {
    it('should return all IRC nicks that have mappings', () => {
      const allNicks = service.getAllMappedNicks();
      expect(allNicks).toContain('Akira1');
      expect(allNicks).toContain('inc');
      expect(Array.isArray(allNicks)).toBe(true);
    });
  });

  describe('searchNicks', () => {
    it('should find nicks matching a pattern', () => {
      const matches = service.searchNicks('akira');
      expect(matches.some(m => m.nick.toLowerCase().includes('akira'))).toBe(true);
    });

    it('should return empty array for no matches', () => {
      const matches = service.searchNicks('zzzznonexistent');
      expect(matches).toEqual([]);
    });
  });
});
