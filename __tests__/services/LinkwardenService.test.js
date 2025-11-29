const LinkwardenService = require('../../services/LinkwardenService');

describe('LinkwardenService', () => {
  let service;
  const mockConfig = {
    linkwarden: {
      baseUrl: 'https://linkwarden.aklabs.io',
      externalUrl: 'https://linkwarden.aklabs.io',
      apiToken: 'test-token',
      sourceCollectionId: 1
    }
  };

  beforeEach(() => {
    service = new LinkwardenService(mockConfig);
  });

  describe('buildLinkwardenUrl', () => {
    it('should return a monolith format URL if monolith is available', () => {
      const link = { id: 10, monolith: true };
      const expectedUrl = 'https://linkwarden.aklabs.io/preserved/10?format=4';
      expect(service.buildLinkwardenUrl(link)).toBe(expectedUrl);
    });

    it('should return a readable format URL if monolith is unavailable', () => {
      const link = { id: 10, monolith: 'unavailable' };
      const expectedUrl = 'https://linkwarden.aklabs.io/preserved/10?format=2';
      expect(service.buildLinkwardenUrl(link)).toBe(expectedUrl);
    });

    it('should return a readable format URL if monolith property is missing', () => {
      const link = { id: 10 };
      const expectedUrl = 'https://linkwarden.aklabs.io/preserved/10?format=2';
      expect(service.buildLinkwardenUrl(link)).toBe(expectedUrl);
    });

    it('should handle different link IDs', () => {
      const link = { id: 123, monolith: true };
      const expectedUrl = 'https://linkwarden.aklabs.io/preserved/123?format=4';
      expect(service.buildLinkwardenUrl(link)).toBe(expectedUrl);
    });
  });
});