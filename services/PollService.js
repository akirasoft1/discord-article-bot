// ===== services/PollService.js =====
const logger = require('../logger');

class PollService {
  constructor(openaiClient) {
    this.openaiClient = openaiClient;
  }

  async generatePoll(summary) {
    try {
      const pollPrompt = `Based on the following article summary, generate a simple yes/no poll question. The question should be concise and directly related to a key point or a debatable aspect of the summary. Do not include any introductory or concluding remarks, just the question.

Summary: """${summary}"""

Poll Question:`;

      const response = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: pollPrompt }],
        max_tokens: 100,
        temperature: 0.7,
      });

      const pollQuestion = response.choices[0].message.content.trim();
      return pollQuestion;
    } catch (error) {
      logger.error('Failed to generate poll question:', error);
      return null;
    }
  }

  async createDiscordPoll(channel, question) {
    try {
      // Discord.js v14+ has built-in poll creation
      // This is a simplified example, actual implementation might vary based on Discord.js version
      const pollMessage = await channel.send({
        content: `**Poll:** ${question}`,
        components: [
          {
            type: 1, // ActionRow
            components: [
              {
                type: 2, // Button
                style: 3, // Success
                label: 'Yes',
                custom_id: 'poll_yes',
              },
              {
                type: 2, // Button
                style: 4, // Danger
                label: 'No',
                custom_id: 'poll_no',
              },
            ],
          },
        ],
      });

      logger.info(`Created poll in channel ${channel.id}: ${question}`);
      return pollMessage;
    } catch (error) {
      logger.error('Failed to create Discord poll:', error);
      return null;
    }
  }

  async generateDiscussionQuestions(summary) {
    try {
      const discussionPrompt = `Based on the following article summary, generate 3-5 thought-provoking discussion questions. Each question should encourage deeper analysis or debate about the article's content. Present them as a numbered list.

Summary: """${summary}"""

Discussion Questions:`;

      const response = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: discussionPrompt }],
        max_tokens: 200,
        temperature: 0.8,
      });

      const questions = response.choices[0].message.content.trim();
      return questions;
    } catch (error) {
      logger.error('Failed to generate discussion questions:', error);
      return null;
    }
  }
}

module.exports = PollService;
