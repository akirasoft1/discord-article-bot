// gRPC client for the Python agent sidecar.
//
// Polls the sidecar's Health endpoint on a fixed interval; isHealthy() answers
// whether the last successful health response was within unhealthyThresholdMs.
// chat() rejects immediately when unhealthy so callers can fall through to
// the existing direct-OpenAI path without paying the gRPC dial timeout.

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const logger = require('../logger');

class AgentClient {
  constructor({
    address,
    protoPath,
    healthIntervalMs = 5000,
    unhealthyThresholdMs = 30000,
    chatDeadlineMs = 600000,
    healthDeadlineMs = 2000,
  }) {
    this.address = address;
    this.unhealthyThresholdMs = unhealthyThresholdMs;
    this.chatDeadlineMs = chatDeadlineMs;
    this.healthDeadlineMs = healthDeadlineMs;
    this._lastHealthyAt = 0;
    this._closed = false;

    const packageDef = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(packageDef).discordbot.agent;
    this._stub = new proto.Agent(address, grpc.credentials.createInsecure());

    this._healthTimer = setInterval(() => this._healthCheck(), healthIntervalMs);
    if (this._healthTimer.unref) this._healthTimer.unref();
    this._healthCheck();
  }

  _healthCheck() {
    if (this._closed) return;
    const deadline = new Date(Date.now() + this.healthDeadlineMs);
    this._stub.Health({}, { deadline }, (err, resp) => {
      if (this._closed) return;
      if (!err && resp && resp.healthy) {
        this._lastHealthyAt = Date.now();
      }
    });
  }

  isHealthy() {
    return Date.now() - this._lastHealthyAt < this.unhealthyThresholdMs;
  }

  chat(req) {
    return new Promise((resolve, reject) => {
      if (!this.isHealthy()) {
        reject(new Error('sidecar unhealthy'));
        return;
      }
      const deadline = new Date(Date.now() + this.chatDeadlineMs);
      this._stub.Chat(
        {
          user_id: req.userId,
          user_tag: req.userTag,
          channel_id: req.channelId,
          guild_id: req.guildId,
          interaction_id: req.interactionId,
          user_message: req.userMessage,
          image_url: req.imageUrl || '',
        },
        { deadline },
        (err, resp) => {
          if (err) {
            logger.warn(`AgentClient.chat failed: ${err.message}`);
            return reject(err);
          }
          resolve({
            messageText: resp.message_text,
            summary: {
              executionCount: resp.summary ? resp.summary.execution_count || 0 : 0,
              anyFailed: resp.summary ? resp.summary.any_failed || false : false,
              executionIds: resp.summary ? resp.summary.execution_ids || [] : [],
            },
            fallbackOccurred: !!resp.fallback_occurred,
          });
        },
      );
    });
  }

  close() {
    this._closed = true;
    if (this._healthTimer) clearInterval(this._healthTimer);
    if (this._stub && typeof this._stub.close === 'function') {
      try {
        this._stub.close();
      } catch (e) {
        logger.debug(`AgentClient stub.close threw: ${e.message}`);
      }
    }
  }
}

module.exports = AgentClient;
