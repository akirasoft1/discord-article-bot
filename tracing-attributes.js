// tracing-attributes.js
// Centralized attribute names for OpenTelemetry spans
// Following semantic conventions where applicable

// Discord messaging attributes
const DISCORD = {
  USER_ID: 'discord.user.id',
  USER_TAG: 'discord.user.tag',
  CHANNEL_ID: 'discord.channel.id',
  CHANNEL_NAME: 'discord.channel.name',
  GUILD_ID: 'discord.guild.id',
  MESSAGE_ID: 'discord.message.id',
};

// GenAI semantic conventions (OpenTelemetry standard)
const GEN_AI = {
  SYSTEM: 'gen_ai.system',
  OPERATION_NAME: 'gen_ai.operation.name',
  REQUEST_MODEL: 'gen_ai.request.model',
  RESPONSE_ID: 'gen_ai.response.id',
  RESPONSE_MODEL: 'gen_ai.response.model',
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  USAGE_TOTAL_TOKENS: 'gen_ai.usage.total_tokens',
};

// Database attributes (following OpenTelemetry DB conventions)
const DB = {
  SYSTEM: 'db.system',
  NAME: 'db.name',
  OPERATION: 'db.operation',
  COLLECTION: 'db.collection',
  STATEMENT: 'db.statement',
  NAMESPACE: 'db.namespace',
  DOCUMENTS_AFFECTED: 'db.documents_affected',
  DOCUMENTS_RETURNED: 'db.documents_returned',
};

// Vector database attributes (Qdrant/Mem0)
const VECTOR_DB = {
  SYSTEM: 'vector_db.system',
  OPERATION: 'vector_db.operation',
  COLLECTION: 'vector_db.collection',
  TOP_K: 'vector_db.top_k',
  RESULTS_COUNT: 'vector_db.results_count',
  SCORE_THRESHOLD: 'vector_db.score_threshold',
  HAS_FILTER: 'vector_db.has_filter',
  EMBEDDING_MODEL: 'vector_db.embedding_model',
};

// Memory service attributes (Mem0)
const MEMORY = {
  OPERATION: 'memory.operation',
  USER_ID: 'memory.user_id',
  AGENT_ID: 'memory.agent_id',
  MEMORIES_COUNT: 'memory.memories_count',
  QUERY_LENGTH: 'memory.query_length',
};

// HTTP client attributes (for API calls)
const HTTP = {
  METHOD: 'http.method',
  URL: 'http.url',
  STATUS_CODE: 'http.status_code',
  RESPONSE_SIZE: 'http.response_content_length',
};

// Linkwarden-specific attributes
const LINKWARDEN = {
  OPERATION: 'linkwarden.operation',
  LINK_ID: 'linkwarden.link_id',
  LINK_URL: 'linkwarden.link_url',
  COLLECTION_ID: 'linkwarden.collection_id',
  CONTENT_FORMAT: 'linkwarden.content_format',
  CONTENT_LENGTH: 'linkwarden.content_length',
  LINKS_COUNT: 'linkwarden.links_count',
};

// Error attributes
const ERROR = {
  TYPE: 'error.type',
  MESSAGE: 'error.message',
  STACK: 'error.stack',
};

// Chat/conversation attributes
const CHAT = {
  PERSONALITY_ID: 'chat.personality.id',
  PERSONALITY_NAME: 'chat.personality.name',
  MODE: 'chat.mode',
  CONVERSATION_ID: 'chat.conversation.id',
  MESSAGE_COUNT: 'chat.conversation.message_count',
  HAS_IMAGE: 'chat.has_image',
  TOOLS_ENABLED: 'chat.tools_enabled',
};

// Reply handler attributes
const REPLY = {
  OPERATION: 'reply.operation',
  TYPE: 'reply.type',
  PERSONALITY_DETECTED: 'reply.personality_detected',
  IS_SUMMARIZATION: 'reply.is_summarization',
  CONVERSATION_STATUS: 'reply.conversation_status',
};

// Reaction handler attributes
const REACTION = {
  OPERATION: 'reaction.operation',
  EMOJI: 'reaction.emoji',
  URLS_FOUND: 'reaction.urls_found',
};

// Summarization attributes
const SUMMARIZATION = {
  ARTICLE_URL: 'summarization.article_url',
  CONTENT_LENGTH: 'summarization.content_length',
  IS_FOLLOW_UP: 'summarization.is_follow_up',
};

module.exports = {
  DISCORD,
  GEN_AI,
  DB,
  VECTOR_DB,
  MEMORY,
  HTTP,
  LINKWARDEN,
  ERROR,
  CHAT,
  REPLY,
  REACTION,
  SUMMARIZATION,
};
