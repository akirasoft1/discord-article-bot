const { isArchiveUrl, transformArchiveUrl, processUrlForSummarization } = require('./bot');

// Mock the logger to prevent console output during tests
// Define the mock implementation directly inline
jest.mock('./logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock the 'discord.js' module
jest.mock('discord.js', () => {
  const mockLogin = jest.fn();
  const mockOn = jest.fn();
  const mockOnce = jest.fn();

  // Mock Client constructor
  const MockClient = jest.fn().mockImplementation(() => {
    return {
      login: mockLogin,
      on: mockOn,
      once: mockOnce,
      // Store mocks for potential assertion if needed, though not strictly necessary
      // if tests primarily focus on higher-level behavior.
      _mockLogin: mockLogin,
      _mockOn: mockOn,
      _mockOnce: mockOnce,
    };
  });

  return {
    Client: MockClient,
    Intents: {
      FLAGS: {
        GUILDS: 'mock_guilds_intent',
        GUILD_MESSAGES: 'mock_guild_messages_intent',
        GUILD_MESSAGE_REACTIONS: 'mock_guild_message_reactions_intent',
      },
    },
  };
});

// Mock the 'openai' module
jest.mock('openai', () => {
  // Create mock functions for the methods we expect to be called
  const mockChatCompletionsCreate = jest.fn();
  const mockResponsesCreate = jest.fn();

  // Return a mock constructor
  return jest.fn().mockImplementation(() => {
    // This is the mock OpenAI instance structure
    return {
      chat: {
        completions: {
          create: mockChatCompletionsCreate,
        },
      },
      responses: {
        create: mockResponsesCreate,
      },
      // Store the mocks on the instance if needed for direct access in tests,
      // or tests can access them via the module-level variables above.
      _mockChatCompletionsCreate: mockChatCompletionsCreate,
      _mockResponsesCreate: mockResponsesCreate,
    };
  });
});

describe('isArchiveUrl', () => {
  const archiveHosts = [
    'archive.is',
    'archive.today',
    'archive.ph',
    'archive.li',
    'archive.vn',
    'archive.md',
    'archive.fo',
    'archive.gg',
    'archive.wiki',
  ];

  archiveHosts.forEach(host => {
    it(`should return true for https://${host}/somepage`, () => {
      expect(isArchiveUrl(`https://${host}/somepage`)).toBe(true);
    });
    it(`should return true for http://${host}/another`, () => {
      expect(isArchiveUrl(`http://${host}/another`)).toBe(true);
    });
  });

  it('should return true for archive.is with a path', () => {
    expect(isArchiveUrl('https://archive.is/o/Ag5Vf/https://example.com/page')).toBe(true);
  });

  it('should return false for a non-archive URL like example.com', () => {
    expect(isArchiveUrl('https://example.com/foo')).toBe(false);
  });

  it('should return false for a non-archive URL like google.com', () => {
    expect(isArchiveUrl('http://google.com')).toBe(false);
  });

  it('should return false for an invalid URL string', () => {
    expect(isArchiveUrl('not a url')).toBe(false);
  });

  it('should return false for a URL with a typo in archive hostname', () => {
    expect(isArchiveUrl('https://archove.is/page')).toBe(false);
  });
  
  it('should return false for an empty string', () => {
    expect(isArchiveUrl('')).toBe(false);
  });

  it('should return false for a string that is only a protocol', () => {
    expect(isArchiveUrl('https://')).toBe(false);
  });
  
  it('should return false for a URL with a different TLD but similar name', () => {
    expect(isArchiveUrl('https://archive.is.notreal/page')).toBe(false);
  });

  it('should return false for a URL that is just a hostname similar to archive', () => {
    expect(isArchiveUrl('https://archive.islands/page')).toBe(false);
  });
});

describe('transformArchiveUrl', () => {
  let logger; // To hold the mocked logger instance

  beforeEach(() => {
    // Acquire the mocked logger instance and clear its methods
    logger = require('./logger');
    logger.warn.mockClear();
    logger.info.mockClear();
    logger.error.mockClear();
    logger.debug.mockClear();
  });

  it('should successfully transform a standard archive.is URL', () => {
    const result = transformArchiveUrl('https://archive.is/https://example.com/page');
    expect(result.status).toBe('success');
    expect(result.resultUrl).toBe('https://archive.today/TEXT/https://example.com/page');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("[transformArchiveUrl] Transformed 'https://archive.is/https://example.com/page' to 'https://archive.today/TEXT/https://example.com/page'"));
  });

  it('should successfully transform an archive.is URL with a timestamp/shortcode', () => {
    const result = transformArchiveUrl('https://archive.is/o/Ag5Vf/https://example.com/another');
    expect(result.status).toBe('success');
    expect(result.resultUrl).toBe('https://archive.today/TEXT/https://example.com/another');
  });
  
  it('should successfully transform an archive.ph URL with http embedded', () => {
    const result = transformArchiveUrl('https://archive.ph/http://example.com/some/path');
    expect(result.status).toBe('success');
    expect(result.resultUrl).toBe('https://archive.today/TEXT/http://example.com/some/path');
  });

  it('should handle path segments before the embedded URL correctly', () => {
    const result = transformArchiveUrl('https://archive.today/2024.01.01-120000/https://example.com/complex/path?query=true');
    expect(result.status).toBe('success');
    expect(result.resultUrl).toBe('https://archive.today/TEXT/https://example.com/complex/path?query=true');
  });
  
  it('should correctly re-add double slashes if http:/ was present', () => {
    // Simulate a URL where path splitting might result in "http:/example.com"
    const archiveUrl = 'https://archive.is/http:/example.com/my-page'; // This is technically malformed for real archive.is but tests the logic
    const parsedUrl = new URL(archiveUrl); // For the test, assume this parsing is what our function gets
    
    // Manually construct the path segments as if parsedUrl.pathname.split('/') would produce this
    const mockPathSegments = ['', 'http:', 'example.com', 'my-page'];
    
    // Mock new URL(archiveUrlString).pathname.split('/') to return our specific segments
    const originalURL = global.URL;
    global.URL = jest.fn((url) => {
      if (url === archiveUrl) {
        return {
          pathname: '/' + mockPathSegments.join('/'), // Reconstruct a plausible pathname
          hostname: new originalURL(url).hostname, // Keep original hostname logic
          protocol: new originalURL(url).protocol,
          search: new originalURL(url).search,
          hash: new originalURL(url).hash,
        };
      }
      return new originalURL(url); // Use real URL for other calls (like validating originalUrl)
    });
    
    const result = transformArchiveUrl(archiveUrl);
    expect(result.status).toBe('success');
    expect(result.resultUrl).toBe('https://archive.today/TEXT/http://example.com/my-page');
    global.URL = originalURL; // Restore original URL
  });


  it('should return untransformable_shortlink for a simple path like /onlyapath', () => {
    const shortlinkUrl = 'https://archive.is/onlyapath';
    const result = transformArchiveUrl(shortlinkUrl);
    expect(result.status).toBe('untransformable_shortlink');
    expect(result.message).toBe(`Archive link ${shortlinkUrl} appears to be a shortlink and cannot be directly converted to a text-only version. Please try accessing it in a browser first.`);
    expect(result.errorLog).toBe(`[transformArchiveUrl] Archive link ${shortlinkUrl} is a shortlink. No embedded URL found in path. Pathname: /onlyapath`);
  });

  it('should return error if the extracted embedded URL is invalid or path is unrecognized', () => {
    // Test case 1: Path without http(s) and multiple segments (not a simple shortlink)
    const complexNonHttpUrl = 'https://archive.is/prefix/invalid-url-that-is-not-a-url';
    const result1 = transformArchiveUrl(complexNonHttpUrl);
    expect(result1.status).toBe('error');
    expect(result1.message).toBe(`Sorry, I could not correctly process the archive link: ${complexNonHttpUrl}. The structure is unrecognized or does not contain an embedded URL.`);
    expect(result1.errorLog).toContain(`[transformArchiveUrl] Could not find an embedded URL in the path of archive link: ${complexNonHttpUrl}. Path: /prefix/invalid-url-that-is-not-a-url`);

    // Test case 2: Extracted embedded URL is invalid
    const archiveUrlWithInvalidEmbedded = 'https://archive.is/http:/malformed'; // "http:/malformed" is not a valid URL
    const result2 = transformArchiveUrl(archiveUrlWithInvalidEmbedded);
    expect(result2.status).toBe('error');
    expect(result2.message).toBe(`Sorry, I could not correctly process the archive link: ${archiveUrlWithInvalidEmbedded}. The embedded link appears invalid.`);
    expect(result2.errorLog).toContain(`[transformArchiveUrl] Failed to validate extracted original URL 'http:/malformed' from archive link: ${archiveUrlWithInvalidEmbedded}.`);
  });
  
  it('should return error if the archive URL itself is completely malformed (e.g., just protocol)', () => {
    const result = transformArchiveUrl('https://'); // This is not a valid URL
    expect(result.status).toBe('error');
    expect(result.message).toContain('appears to be malformed');
    expect(result.errorLog).toContain('[transformArchiveUrl] Error parsing the archive URL');
  });

  it('should return error for an empty string input', () => {
    const result = transformArchiveUrl('');
    expect(result.status).toBe('error');
    expect(result.message).toContain('appears to be malformed');
    expect(result.errorLog).toContain('Invalid URL'); // Error message from URL constructor
  });

  it('should identify a simple shortlink and return untransformable_shortlink status', () => {
    const shortlinkUrl = 'https://archive.is/vdNld';
    const result = transformArchiveUrl(shortlinkUrl);
    expect(result.status).toBe('untransformable_shortlink');
    expect(result.resultUrl).toBe(shortlinkUrl);
    expect(result.message).toContain('appears to be a shortlink and cannot be directly converted');
    expect(result.errorLog).toContain('is a shortlink. No embedded URL found in path');
  });

  it('should return error for a complex path without http(s) that is not a shortlink', () => {
    const complexPathUrl = 'https://archive.is/some/complex/path';
    const result = transformArchiveUrl(complexPathUrl);
    expect(result.status).toBe('error'); // Not a shortlink, and no embedded URL
    expect(result.message).toContain('The structure is unrecognized or does not contain an embedded URL.');
    expect(result.errorLog).toContain('Could not find an embedded URL');
  });

});

describe('processUrlForSummarization', () => {
  let mockMessage;
  let mockOpenAI;
  let mockAxios;
  let logger; // To hold the mocked logger instance
  const systemPrompt = "Test system prompt";

  beforeEach(() => {
    // Acquire the mocked logger instance and clear its methods
    logger = require('./logger');
    logger.warn.mockClear();
    logger.info.mockClear();
    logger.error.mockClear();
    logger.debug.mockClear();

    mockMessage = {
      channel: {
        send: jest.fn(),
      },
      reply: jest.fn(),
    };

    // Instantiate the mocked OpenAI. Its methods will be jest.fn() from the module mock.
    const OpenAI = require('openai'); // This gets our mocked constructor
    mockOpenAI = new OpenAI();      // This is now an instance of our mock

    // Clear mocks on the instance's methods for each test if needed
    // (already done by jest.fn() for each new instance, but can be explicit)
    mockOpenAI.chat.completions.create.mockClear();
    mockOpenAI.responses.create.mockClear();


    mockAxios = {
      get: jest.fn(),
    };
  });

  // Test Scenario 1: Successful archive fetch & summarization
  it('should successfully fetch and summarize content from a transformed archive URL', async () => {
    const archiveUrl = 'https://archive.is/https://example.com/success';
    const transformedTextUrl = 'https://archive.today/TEXT/https://example.com/success';
    const fetchedContent = 'Archived content here for success test';
    const summaryContent = 'Summary of success test';

    // isArchiveUrl is implicitly tested via transformArchiveUrl's behavior
    // transformArchiveUrl will be called, let it behave normally for this valid case.
    
    mockAxios.get.mockResolvedValueOnce({ data: fetchedContent });
    // Access the mock function from the instance created by the module mock
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: summaryContent } }],
    });
    
    // Set default method to completion
    const originalEnv = process.env;
    process.env = { ...originalEnv, OPENAI_METHOD: 'completion' };

    await processUrlForSummarization(archiveUrl, mockMessage, mockOpenAI, systemPrompt, mockAxios, logger);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Processing URL: ${archiveUrl}`));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Archive URL detected: ${archiveUrl}`));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[transformArchiveUrl] Transformed '${archiveUrl}' to '${transformedTextUrl}'`));
    expect(mockAxios.get).toHaveBeenCalledWith(transformedTextUrl);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Successfully fetched content from ${transformedTextUrl}`));
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: expect.stringContaining(fetchedContent) })
      ])
    }));
    expect(mockMessage.reply).toHaveBeenCalledWith({ content: `Summary: ${summaryContent}`, allowedMentions: { repliedUser: false } });
    process.env = originalEnv; // Restore original environment
  });

  // Test Scenario 2: Failed archive fetch
  it('should handle failure when fetching content from a transformed archive URL', async () => {
    const archiveUrl = 'https://archive.is/https://example.com/failfetch';
    const transformedTextUrl = 'https://archive.today/TEXT/https://example.com/failfetch';
    
    mockAxios.get.mockRejectedValueOnce(new Error('Network Error'));

    await processUrlForSummarization(archiveUrl, mockMessage, mockOpenAI, systemPrompt, mockAxios, logger);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Processing URL: ${archiveUrl}`));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[transformArchiveUrl] Transformed '${archiveUrl}' to '${transformedTextUrl}'`));
    expect(mockAxios.get).toHaveBeenCalledWith(transformedTextUrl);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Error fetching content from ${transformedTextUrl}: Network Error`));
    expect(mockMessage.channel.send).toHaveBeenCalledWith(expect.stringContaining(`Sorry, I could not retrieve the content from the archive link: ${archiveUrl}`));
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
  });

  // Test Scenario 3: Non-archive URL summarization
  it('should correctly summarize a non-archive URL', async () => {
    const normalUrl = 'https://example.com/normal';
    const summaryContent = 'Summary of normal URL';

    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: summaryContent } }],
    });
    
    const originalEnv = process.env;
    process.env = { ...originalEnv, OPENAI_METHOD: 'completion' };

    await processUrlForSummarization(normalUrl, mockMessage, mockOpenAI, systemPrompt, mockAxios, logger);
    
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Processing URL: ${normalUrl}`));
    expect(mockAxios.get).not.toHaveBeenCalled(); // Should not attempt to fetch from /TEXT/ URL
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: expect.stringContaining(normalUrl) })
      ])
    }));
    expect(mockMessage.reply).toHaveBeenCalledWith({ content: `Summary: ${summaryContent}`, allowedMentions: { repliedUser: false } });
    process.env = originalEnv;
  });

  // Test Scenario 4: Image URL skip
  it('should skip processing for image URLs', async () => {
    const imageUrl = 'https://example.com/image.png';
    await processUrlForSummarization(imageUrl, mockMessage, mockOpenAI, systemPrompt, mockAxios, logger);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Processing URL: ${imageUrl}`));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Skipping image URL: ${imageUrl}`));
    expect(mockAxios.get).not.toHaveBeenCalled();
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
    expect(mockMessage.reply).not.toHaveBeenCalled();
    expect(mockMessage.channel.send).not.toHaveBeenCalled();
  });
  
  // Test Scenario 5: GIF host skip
  it('should skip processing for GIF hosting URLs', async () => {
    const gifUrl = 'https://tenor.com/view/some.gif';
    await processUrlForSummarization(gifUrl, mockMessage, mockOpenAI, systemPrompt, mockAxios, logger);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Processing URL: ${gifUrl}`));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Skipping GIF hosting URL: ${gifUrl}`));
    expect(mockAxios.get).not.toHaveBeenCalled();
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
    expect(mockMessage.reply).not.toHaveBeenCalled();
    expect(mockMessage.channel.send).not.toHaveBeenCalled();
  });

  // Test Scenario 6: Transformation failure for an archive URL
  it('should handle failure when transformArchiveUrl returns an error', async () => {
    const malformedArchiveUrl = 'https://archive.is/malformedpath'; // This will cause transformArchiveUrl to return status: 'error'
    
    // transformArchiveUrl will be called internally. For this test, its actual error return is what we're testing.
    // No need to mock transformArchiveUrl itself, just ensure isArchiveUrl would identify it.
    
    await processUrlForSummarization(malformedArchiveUrl, mockMessage, mockOpenAI, systemPrompt, mockAxios, logger);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Processing URL: ${malformedArchiveUrl}`));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Archive URL detected: ${malformedArchiveUrl}`));
    // The error log from transformArchiveUrl (via processUrlForSummarization)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("[processUrlForSummarization] Original error log: [transformArchiveUrl] Could not find an embedded URL"));
    // The user-facing message from transformArchiveUrl (via processUrlForSummarization)
    expect(mockMessage.channel.send).toHaveBeenCalledWith(expect.stringContaining("The structure is unrecognized."));
    
    expect(mockAxios.get).not.toHaveBeenCalled();
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
  });

  // Test with OPENAI_METHOD = 'response'
  it('should use openai.responses.create when OPENAI_METHOD is "response"', async () => {
    const normalUrl = 'https://example.com/response-method';
    const summaryContent = 'Summary from response method';
    const originalEnv = process.env;
    process.env = { ...originalEnv, OPENAI_METHOD: 'response' };

    mockOpenAI.responses.create.mockResolvedValueOnce({ output_text: summaryContent });

    await processUrlForSummarization(normalUrl, mockMessage, mockOpenAI, systemPrompt, mockAxios, logger);

    expect(mockOpenAI.responses.create).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.stringContaining(normalUrl)
    }));
    expect(mockMessage.reply).toHaveBeenCalledWith({ content: `Summary: ${summaryContent}`, allowedMentions: { repliedUser: false } });
    
    process.env = originalEnv; // Restore original environment
  });
  
  it('should handle general errors during summarization gracefully', async () => {
    const url = 'https://example.com/general-error';
    mockOpenAI.chat.completions.create.mockRejectedValueOnce(new Error('Unexpected OpenAI error'));
    
    const originalEnv = process.env;
    process.env = { ...originalEnv, OPENAI_METHOD: 'completion' };

    await processUrlForSummarization(url, mockMessage, mockOpenAI, systemPrompt, mockAxios, logger);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(`[processUrlForSummarization] Error summarizing the article for URL ${url}: Unexpected OpenAI error`),
      expect.any(Error)
    );
    expect(mockMessage.channel.send).toHaveBeenCalledWith(expect.stringContaining(`An unexpected error occurred while trying to summarize ${url}.`));
    process.env = originalEnv;
  });

  it('should handle untransformable_shortlink status from transformArchiveUrl correctly', async () => {
    const shortlinkUrl = 'https://archive.is/xYz12'; // Example shortlink

    // transformArchiveUrl will be called internally by processUrlForSummarization.
    // isArchiveUrl(shortlinkUrl) will be true.
    // transformArchiveUrl(shortlinkUrl) will return status: 'untransformable_shortlink'.

    await processUrlForSummarization(shortlinkUrl, mockMessage, mockOpenAI, systemPrompt, mockAxios, logger);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Processing URL: ${shortlinkUrl}`));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`[processUrlForSummarization] Archive URL detected: ${shortlinkUrl}`));
    
    // Check for the log message from processUrlForSummarization when it handles 'untransformable_shortlink'
    const expectedLogMessage = `[processUrlForSummarization] [transformArchiveUrl] Archive link ${shortlinkUrl} is a shortlink. No embedded URL found in path. Pathname: /xYz12`;
    expect(logger.info).toHaveBeenCalledWith(expectedLogMessage);

    // Check that the specific user-facing message is sent
    const expectedUserMessage = `Archive link ${shortlinkUrl} appears to be a shortlink and cannot be directly converted to a text-only version. Please try accessing it in a browser first.`;
    expect(mockMessage.channel.send).toHaveBeenCalledWith(expectedUserMessage);

    // Ensure no further processing (like fetching or OpenAI calls) happens
    expect(mockAxios.get).not.toHaveBeenCalled();
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
    expect(mockOpenAI.responses.create).not.toHaveBeenCalled();
    expect(mockMessage.reply).not.toHaveBeenCalled();
  });
});
