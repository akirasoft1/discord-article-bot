// utils/imageValidation.js
// Utilities for validating image attachments for OpenAI vision API

const axios = require('axios');
const logger = require('../logger');

// Supported image types for OpenAI vision
const SUPPORTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
];

const SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/**
 * Check if a MIME type is supported for vision
 * @param {string} mimeType - The MIME type to check
 * @returns {boolean}
 */
function isSupportedMimeType(mimeType) {
  if (!mimeType) return false;
  return SUPPORTED_MIME_TYPES.includes(mimeType.toLowerCase());
}

/**
 * Check if a file extension is supported for vision
 * @param {string} filename - The filename to check
 * @returns {boolean}
 */
function isSupportedExtension(filename) {
  if (!filename) return false;
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? SUPPORTED_EXTENSIONS.includes(ext) : false;
}

/**
 * Check if a GIF is animated by examining its header
 * Animated GIFs contain multiple image frames, indicated by the presence
 * of the Graphics Control Extension (0x21 0xF9) appearing multiple times
 * or the NETSCAPE2.0 application extension for looping
 *
 * @param {string} url - URL of the GIF to check
 * @returns {Promise<boolean>} True if the GIF is animated
 */
async function isAnimatedGif(url) {
  try {
    // Fetch first 5KB of the file - enough to detect animation markers
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'Range': 'bytes=0-5120'
      },
      timeout: 5000
    });

    const buffer = Buffer.from(response.data);

    // Check for GIF magic number
    const magic = buffer.toString('ascii', 0, 6);
    if (magic !== 'GIF87a' && magic !== 'GIF89a') {
      return false; // Not a GIF
    }

    // Look for NETSCAPE2.0 application extension (indicates looping animation)
    const netscape = buffer.indexOf('NETSCAPE2.0');
    if (netscape !== -1) {
      return true;
    }

    // Count Graphics Control Extension blocks (0x21 0xF9)
    // Multiple occurrences indicate multiple frames
    let graphicsControlCount = 0;
    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i] === 0x21 && buffer[i + 1] === 0xF9) {
        graphicsControlCount++;
        if (graphicsControlCount > 1) {
          return true; // Multiple frames = animated
        }
      }
    }

    return false;
  } catch (error) {
    logger.warn(`Failed to check if GIF is animated: ${error.message}`);
    // If we can't check, assume it might be animated and warn the user
    return null; // null indicates uncertainty
  }
}

/**
 * Validate an image attachment for OpenAI vision API
 * @param {Object} attachment - Discord attachment object
 * @returns {Promise<{valid: boolean, error?: string, warning?: string}>}
 */
async function validateImageAttachment(attachment) {
  const { name, contentType, url } = attachment;

  // Check MIME type first
  if (contentType && !isSupportedMimeType(contentType)) {
    return {
      valid: false,
      error: `Unsupported image type: \`${contentType}\`. Supported types: PNG, JPEG, WEBP, and non-animated GIF.`
    };
  }

  // Fallback to extension check if no content type
  if (!contentType && !isSupportedExtension(name)) {
    const ext = name?.match(/\.[^.]+$/)?.[0] || 'unknown';
    return {
      valid: false,
      error: `Unsupported file type: \`${ext}\`. Supported types: PNG, JPEG, WEBP, and non-animated GIF.`
    };
  }

  // Special handling for GIFs - check if animated
  const isGif = contentType?.toLowerCase() === 'image/gif' ||
                name?.toLowerCase().endsWith('.gif');

  if (isGif) {
    const animated = await isAnimatedGif(url);

    if (animated === true) {
      return {
        valid: false,
        error: 'Animated GIFs are not supported. Please use a static image (PNG, JPEG, WEBP, or non-animated GIF).'
      };
    }

    if (animated === null) {
      // Couldn't determine - proceed with warning
      return {
        valid: true,
        warning: 'Could not verify if GIF is animated. If the image fails to process, try using a PNG or JPEG instead.'
      };
    }
  }

  return { valid: true };
}

/**
 * Get a user-friendly list of supported formats
 * @returns {string}
 */
function getSupportedFormatsText() {
  return 'PNG, JPEG, WEBP, and non-animated GIF';
}

module.exports = {
  isSupportedMimeType,
  isSupportedExtension,
  isAnimatedGif,
  validateImageAttachment,
  getSupportedFormatsText,
  SUPPORTED_MIME_TYPES,
  SUPPORTED_EXTENSIONS
};
