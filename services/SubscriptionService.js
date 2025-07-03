// ===== services/SubscriptionService.js =====
const logger = require('../logger');

class SubscriptionService {
  constructor(mongoService) {
    this.mongoService = mongoService;
  }

  async subscribe(userId, topic) {
    if (!topic) {
      return { success: false, message: 'Please provide a topic to subscribe to.' };
    }
    await this.mongoService.subscribeUserToTopic(userId, topic.toLowerCase());
    return { success: true, message: `You have subscribed to the topic: **${topic}**` };
  }

  async unsubscribe(userId, topic) {
    if (!topic) {
      return { success: false, message: 'Please provide a topic to unsubscribe from.' };
    }
    await this.mongoService.unsubscribeUserFromTopic(userId, topic.toLowerCase());
    return { success: true, message: `You have unsubscribed from the topic: **${topic}**` };
  }

  async listSubscriptions(userId) {
    const topics = await this.mongoService.getUserSubscriptions(userId);
    if (topics.length === 0) {
      return { success: true, message: 'You are not subscribed to any topics.' };
    }
    return { success: true, message: `Your subscriptions: ${topics.map(t => `**${t}**`).join(', ')}` };
  }
}

module.exports = SubscriptionService;
