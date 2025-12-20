# Analytics Dashboard Implementation Plan

## Overview

A lightweight analytics dashboard served from the existing Express health server, providing real-time metrics visualization for bot usage, costs, and engagement.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Discord Article Bot                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Express Server (port 8080)                  │   │
│  │  ├── /healthz          (existing)                       │   │
│  │  ├── /readyz           (existing)                       │   │
│  │  ├── /analytics        (new - HTML dashboard)           │   │
│  │  └── /api/analytics/*  (new - JSON endpoints)           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│              ┌───────────────┴───────────────┐                 │
│              ▼                               ▼                 │
│  ┌─────────────────────┐         ┌─────────────────────┐      │
│  │      MongoDB        │         │       Qdrant        │      │
│  │  - token_usage      │         │  - discord_memories │      │
│  │  - chat_convos      │         │  - channel_convos   │      │
│  │  - image_gens       │         └─────────────────────┘      │
│  └─────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Analytics Service

### File: `services/AnalyticsService.js`

```javascript
// services/AnalyticsService.js
// Aggregates analytics data from MongoDB and Qdrant

const logger = require('../logger');

// OpenAI Pricing (as of Dec 2024) - Update these as needed
const TOKEN_PRICING = {
  'gpt-5.1': { input: 0.002, output: 0.008 },      // per 1K tokens
  'gpt-5-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
  'default': { input: 0.001, output: 0.004 }
};

class AnalyticsService {
  constructor(mongoService, qdrantClient = null) {
    this.mongo = mongoService;
    this.qdrant = qdrantClient;
  }

  // ==================== TOKEN CONSUMPTION ====================

  /**
   * Get token consumption aggregated by time period
   * @param {string} period - 'daily', 'weekly', or 'monthly'
   * @param {number} lookbackDays - How far back to query (default: 30)
   * @returns {Array} Time series data
   */
  async getTokenConsumption(period = 'daily', lookbackDays = 30) {
    const db = this.mongo.db;
    const collection = db.collection('token_usage');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    // Date grouping format based on period
    const dateFormat = {
      daily: '%Y-%m-%d',
      weekly: '%Y-W%V',      // ISO week
      monthly: '%Y-%m'
    }[period] || '%Y-%m-%d';

    const pipeline = [
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: {
            period: { $dateToString: { format: dateFormat, date: '$timestamp' } },
            model: '$model'
          },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          requestCount: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.period',
          byModel: {
            $push: {
              model: '$_id.model',
              inputTokens: '$inputTokens',
              outputTokens: '$outputTokens',
              totalTokens: '$totalTokens',
              requestCount: '$requestCount'
            }
          },
          totalInputTokens: { $sum: '$inputTokens' },
          totalOutputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          totalRequests: { $sum: '$requestCount' }
        }
      },
      { $sort: { _id: 1 } }
    ];

    const results = await collection.aggregate(pipeline).toArray();

    // Calculate costs for each period
    return results.map(r => ({
      period: r._id,
      inputTokens: r.totalInputTokens,
      outputTokens: r.totalOutputTokens,
      totalTokens: r.totalTokens,
      requestCount: r.totalRequests,
      cost: this._calculateCost(r.byModel),
      byModel: r.byModel
    }));
  }

  /**
   * Calculate cost from token usage by model
   * @private
   */
  _calculateCost(byModel) {
    let totalCost = 0;
    for (const entry of byModel) {
      const pricing = TOKEN_PRICING[entry.model] || TOKEN_PRICING.default;
      totalCost += (entry.inputTokens / 1000) * pricing.input;
      totalCost += (entry.outputTokens / 1000) * pricing.output;
    }
    return Math.round(totalCost * 10000) / 10000; // Round to 4 decimals
  }

  // ==================== BURN RATE & PROJECTIONS ====================

  /**
   * Calculate daily burn rate and monthly projection
   * @param {number} lookbackDays - Days to analyze for burn rate (default: 7)
   * @returns {Object} Burn rate and projection data
   */
  async getBurnRateAndProjection(lookbackDays = 7) {
    const db = this.mongo.db;
    const collection = db.collection('token_usage');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    const pipeline = [
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            model: '$model'
          },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          byModel: {
            $push: {
              model: '$_id.model',
              inputTokens: '$inputTokens',
              outputTokens: '$outputTokens'
            }
          }
        }
      }
    ];

    const dailyData = await collection.aggregate(pipeline).toArray();

    // Calculate daily costs
    const dailyCosts = dailyData.map(d => ({
      date: d._id,
      cost: this._calculateCost(d.byModel)
    }));

    // Calculate averages
    const totalCost = dailyCosts.reduce((sum, d) => sum + d.cost, 0);
    const daysWithData = dailyCosts.length || 1;
    const avgDailyCost = totalCost / daysWithData;

    // Get total tokens for burn rate
    const tokenStats = await collection.aggregate([
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: '$totalTokens' },
          totalRequests: { $sum: 1 }
        }
      }
    ]).toArray();

    const avgDailyTokens = (tokenStats[0]?.totalTokens || 0) / daysWithData;
    const avgDailyRequests = (tokenStats[0]?.totalRequests || 0) / daysWithData;

    return {
      lookbackDays,
      daysWithData,
      dailyBurnRate: {
        tokens: Math.round(avgDailyTokens),
        cost: Math.round(avgDailyCost * 10000) / 10000,
        requests: Math.round(avgDailyRequests * 10) / 10
      },
      monthlyProjection: {
        tokens: Math.round(avgDailyTokens * 30),
        cost: Math.round(avgDailyCost * 30 * 100) / 100,
        requests: Math.round(avgDailyRequests * 30)
      },
      dailyBreakdown: dailyCosts.sort((a, b) => a.date.localeCompare(b.date))
    };
  }

  // ==================== TOP CONSUMERS ====================

  /**
   * Get top token consumers (users)
   * @param {number} limit - Number of users to return (default: 10)
   * @param {number} lookbackDays - Days to analyze (default: 30)
   * @returns {Array} Top users with usage stats
   */
  async getTopConsumers(limit = 10, lookbackDays = 30) {
    const db = this.mongo.db;
    const collection = db.collection('token_usage');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    const pipeline = [
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: '$userId',
          username: { $last: '$username' },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          requestCount: { $sum: 1 },
          models: { $addToSet: '$model' },
          commands: { $addToSet: '$commandType' },
          lastActive: { $max: '$timestamp' }
        }
      },
      { $sort: { totalTokens: -1 } },
      { $limit: limit }
    ];

    const results = await collection.aggregate(pipeline).toArray();

    // Calculate costs per user
    return results.map(r => ({
      userId: r._id,
      username: r.username,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      requestCount: r.requestCount,
      estimatedCost: this._estimateCostForUser(r),
      modelsUsed: r.models,
      commandsUsed: r.commands,
      lastActive: r.lastActive
    }));
  }

  /**
   * Estimate cost for a user (simplified - assumes default model)
   * @private
   */
  _estimateCostForUser(userData) {
    const pricing = TOKEN_PRICING.default;
    const cost = (userData.inputTokens / 1000) * pricing.input +
                 (userData.outputTokens / 1000) * pricing.output;
    return Math.round(cost * 10000) / 10000;
  }

  // ==================== FACTS LEARNED PER USER ====================

  /**
   * Get memory/facts count per user from Qdrant
   * @param {number} limit - Number of users to return (default: 20)
   * @returns {Array} Users with fact counts
   */
  async getFactsPerUser(limit = 20) {
    if (!this.qdrant) {
      return [];
    }

    try {
      // Scroll through discord_memories and count by userId
      const userFacts = {};
      let offset = null;
      let iterations = 0;
      const maxIterations = 100; // Safety limit

      while (iterations < maxIterations) {
        const batch = await this.qdrant.scroll('discord_memories', {
          limit: 100,
          offset,
          with_payload: ['userId', 'data', 'createdAt']
        });

        for (const point of batch.points) {
          const userId = point.payload.userId;
          if (!userFacts[userId]) {
            userFacts[userId] = {
              userId,
              factCount: 0,
              facts: [],
              lastUpdated: null
            };
          }
          userFacts[userId].factCount++;
          userFacts[userId].facts.push(point.payload.data);

          const createdAt = new Date(point.payload.createdAt);
          if (!userFacts[userId].lastUpdated || createdAt > userFacts[userId].lastUpdated) {
            userFacts[userId].lastUpdated = createdAt;
          }
        }

        offset = batch.next_page_offset;
        if (!offset) break;
        iterations++;
      }

      // Sort by fact count and limit
      return Object.values(userFacts)
        .sort((a, b) => b.factCount - a.factCount)
        .slice(0, limit)
        .map(u => ({
          userId: u.userId,
          factCount: u.factCount,
          sampleFacts: u.facts.slice(0, 5), // Return up to 5 sample facts
          lastUpdated: u.lastUpdated
        }));

    } catch (error) {
      logger.error(`Error getting facts per user: ${error.message}`);
      return [];
    }
  }

  // ==================== MESSAGE VOLUME PER CHANNEL ====================

  /**
   * Get message volume per tracked channel
   * @param {number} lookbackDays - Days to analyze (default: 30)
   * @returns {Array} Channels with message counts
   */
  async getMessageVolumePerChannel(lookbackDays = 30) {
    if (!this.qdrant) {
      return [];
    }

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - lookbackDays);

      const channelVolume = {};
      let offset = null;
      let iterations = 0;
      const maxIterations = 500; // Higher limit for message volume

      while (iterations < maxIterations) {
        const batch = await this.qdrant.scroll('channel_conversations', {
          limit: 100,
          offset,
          with_payload: ['channelId', 'guildId', 'authorName', 'timestamp']
        });

        for (const point of batch.points) {
          const timestamp = new Date(point.payload.timestamp);
          if (timestamp < startDate) continue;

          const channelId = point.payload.channelId;
          if (!channelVolume[channelId]) {
            channelVolume[channelId] = {
              channelId,
              guildId: point.payload.guildId,
              messageCount: 0,
              uniqueAuthors: new Set(),
              firstMessage: timestamp,
              lastMessage: timestamp
            };
          }

          channelVolume[channelId].messageCount++;
          channelVolume[channelId].uniqueAuthors.add(point.payload.authorName);

          if (timestamp < channelVolume[channelId].firstMessage) {
            channelVolume[channelId].firstMessage = timestamp;
          }
          if (timestamp > channelVolume[channelId].lastMessage) {
            channelVolume[channelId].lastMessage = timestamp;
          }
        }

        offset = batch.next_page_offset;
        if (!offset) break;
        iterations++;
      }

      // Also get config from MongoDB for channel names
      const db = this.mongo.db;
      const configs = await db.collection('channel_tracking_config')
        .find({ enabled: true })
        .toArray();

      const configMap = {};
      for (const config of configs) {
        configMap[config.channelId] = config;
      }

      // Convert to array and add metadata
      return Object.values(channelVolume)
        .map(c => ({
          channelId: c.channelId,
          guildId: c.guildId,
          messageCount: c.messageCount,
          uniqueAuthors: c.uniqueAuthors.size,
          authors: Array.from(c.uniqueAuthors),
          dateRange: {
            from: c.firstMessage,
            to: c.lastMessage
          },
          isTracked: !!configMap[c.channelId],
          trackedSince: configMap[c.channelId]?.enabledAt || null
        }))
        .sort((a, b) => b.messageCount - a.messageCount);

    } catch (error) {
      logger.error(`Error getting message volume: ${error.message}`);
      return [];
    }
  }

  // ==================== SUMMARY DASHBOARD DATA ====================

  /**
   * Get all dashboard data in a single call
   * @returns {Object} Complete dashboard data
   */
  async getDashboardSummary() {
    const [
      dailyConsumption,
      weeklyConsumption,
      monthlyConsumption,
      burnRate,
      topConsumers,
      factsPerUser,
      channelVolume
    ] = await Promise.all([
      this.getTokenConsumption('daily', 30),
      this.getTokenConsumption('weekly', 90),
      this.getTokenConsumption('monthly', 365),
      this.getBurnRateAndProjection(7),
      this.getTopConsumers(10, 30),
      this.getFactsPerUser(15),
      this.getMessageVolumePerChannel(30)
    ]);

    // Calculate totals
    const totalTokens = dailyConsumption.reduce((sum, d) => sum + d.totalTokens, 0);
    const totalCost = dailyConsumption.reduce((sum, d) => sum + d.cost, 0);
    const totalRequests = dailyConsumption.reduce((sum, d) => sum + d.requestCount, 0);

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        last30Days: {
          totalTokens,
          totalCost: Math.round(totalCost * 100) / 100,
          totalRequests,
          uniqueUsers: topConsumers.length
        },
        burnRate: burnRate.dailyBurnRate,
        monthlyProjection: burnRate.monthlyProjection
      },
      tokenConsumption: {
        daily: dailyConsumption,
        weekly: weeklyConsumption,
        monthly: monthlyConsumption
      },
      topConsumers,
      factsPerUser,
      channelVolume,
      pricing: TOKEN_PRICING
    };
  }
}

module.exports = AnalyticsService;
```

---

## Phase 2: API Endpoints

### File: `routes/analytics.js`

```javascript
// routes/analytics.js
// Express routes for analytics API

const express = require('express');
const router = express.Router();

module.exports = function(analyticsService) {

  // Full dashboard data
  router.get('/dashboard', async (req, res) => {
    try {
      const data = await analyticsService.getDashboardSummary();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Token consumption by period
  router.get('/tokens/:period', async (req, res) => {
    try {
      const period = req.params.period; // daily, weekly, monthly
      const lookback = parseInt(req.query.days) || 30;
      const data = await analyticsService.getTokenConsumption(period, lookback);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Burn rate and projections
  router.get('/burn-rate', async (req, res) => {
    try {
      const lookback = parseInt(req.query.days) || 7;
      const data = await analyticsService.getBurnRateAndProjection(lookback);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Top consumers
  router.get('/top-consumers', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 10;
      const lookback = parseInt(req.query.days) || 30;
      const data = await analyticsService.getTopConsumers(limit, lookback);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Facts per user
  router.get('/facts-per-user', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const data = await analyticsService.getFactsPerUser(limit);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Channel message volume
  router.get('/channel-volume', async (req, res) => {
    try {
      const lookback = parseInt(req.query.days) || 30;
      const data = await analyticsService.getMessageVolumePerChannel(lookback);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
```

---

## Phase 3: HTML Dashboard

### File: `public/analytics.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discord Bot Analytics</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --bg-primary: #1a1a2e;
      --bg-secondary: #16213e;
      --bg-card: #0f3460;
      --text-primary: #eee;
      --text-secondary: #aaa;
      --accent: #e94560;
      --accent-green: #4ade80;
      --accent-blue: #60a5fa;
      --accent-yellow: #fbbf24;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      padding: 20px;
    }

    .container { max-width: 1400px; margin: 0 auto; }

    h1 {
      text-align: center;
      margin-bottom: 10px;
      color: var(--accent);
    }

    .subtitle {
      text-align: center;
      color: var(--text-secondary);
      margin-bottom: 30px;
      font-size: 0.9em;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .card h2 {
      font-size: 1em;
      color: var(--text-secondary);
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .stat-value {
      font-size: 2.5em;
      font-weight: bold;
      color: var(--text-primary);
    }

    .stat-unit {
      font-size: 0.9em;
      color: var(--text-secondary);
    }

    .stat-change {
      font-size: 0.85em;
      margin-top: 5px;
    }

    .stat-change.positive { color: var(--accent-green); }
    .stat-change.negative { color: var(--accent); }

    .chart-container {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }

    .chart-container h2 {
      margin-bottom: 15px;
      color: var(--text-secondary);
    }

    .chart-wrapper {
      height: 300px;
      position: relative;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }

    th {
      color: var(--text-secondary);
      font-weight: 500;
      text-transform: uppercase;
      font-size: 0.75em;
      letter-spacing: 1px;
    }

    tr:hover { background: rgba(255,255,255,0.05); }

    .refresh-btn {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: var(--accent);
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1em;
    }

    .refresh-btn:hover { opacity: 0.9; }

    .loading {
      text-align: center;
      padding: 40px;
      color: var(--text-secondary);
    }

    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    @media (max-width: 900px) {
      .two-col { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Discord Bot Analytics</h1>
    <p class="subtitle">Last updated: <span id="lastUpdated">Loading...</span></p>

    <!-- Summary Cards -->
    <div class="grid" id="summaryCards">
      <div class="card">
        <h2>Monthly Token Burn</h2>
        <div class="stat-value" id="monthlyTokens">-</div>
        <div class="stat-unit">tokens (30 days)</div>
      </div>
      <div class="card">
        <h2>Estimated Cost (30d)</h2>
        <div class="stat-value" id="monthlyCost">-</div>
        <div class="stat-unit">USD</div>
      </div>
      <div class="card">
        <h2>Daily Burn Rate</h2>
        <div class="stat-value" id="dailyBurn">-</div>
        <div class="stat-unit">tokens/day</div>
      </div>
      <div class="card">
        <h2>Projected Monthly Cost</h2>
        <div class="stat-value" id="projectedCost">-</div>
        <div class="stat-unit">USD/month</div>
      </div>
    </div>

    <!-- Token Consumption Chart -->
    <div class="chart-container">
      <h2>Daily Token Consumption (Last 30 Days)</h2>
      <div class="chart-wrapper">
        <canvas id="tokenChart"></canvas>
      </div>
    </div>

    <!-- Two Column Layout -->
    <div class="two-col">
      <!-- Top Consumers -->
      <div class="chart-container">
        <h2>Top Token Consumers</h2>
        <table id="consumersTable">
          <thead>
            <tr>
              <th>User</th>
              <th>Tokens</th>
              <th>Requests</th>
              <th>Est. Cost</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>

      <!-- Facts Per User -->
      <div class="chart-container">
        <h2>Facts Learned Per User</h2>
        <table id="factsTable">
          <thead>
            <tr>
              <th>User ID</th>
              <th>Facts</th>
              <th>Sample Fact</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <!-- Channel Volume -->
    <div class="chart-container">
      <h2>Message Volume by Channel</h2>
      <table id="channelTable">
        <thead>
          <tr>
            <th>Channel ID</th>
            <th>Messages</th>
            <th>Unique Authors</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  </div>

  <button class="refresh-btn" onclick="loadData()">Refresh</button>

  <script>
    let tokenChart = null;

    function formatNumber(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return n.toString();
    }

    function formatCurrency(n) {
      return '$' + n.toFixed(2);
    }

    async function loadData() {
      try {
        const response = await fetch('/api/analytics/dashboard');
        const data = await response.json();

        // Update timestamp
        document.getElementById('lastUpdated').textContent =
          new Date(data.generatedAt).toLocaleString();

        // Update summary cards
        document.getElementById('monthlyTokens').textContent =
          formatNumber(data.summary.last30Days.totalTokens);
        document.getElementById('monthlyCost').textContent =
          formatCurrency(data.summary.last30Days.totalCost);
        document.getElementById('dailyBurn').textContent =
          formatNumber(data.summary.burnRate.tokens);
        document.getElementById('projectedCost').textContent =
          formatCurrency(data.summary.monthlyProjection.cost);

        // Update token chart
        updateTokenChart(data.tokenConsumption.daily);

        // Update tables
        updateConsumersTable(data.topConsumers);
        updateFactsTable(data.factsPerUser);
        updateChannelTable(data.channelVolume);

      } catch (error) {
        console.error('Failed to load data:', error);
        alert('Failed to load analytics data');
      }
    }

    function updateTokenChart(dailyData) {
      const ctx = document.getElementById('tokenChart').getContext('2d');

      const labels = dailyData.map(d => d.period);
      const tokens = dailyData.map(d => d.totalTokens);
      const costs = dailyData.map(d => d.cost);

      if (tokenChart) {
        tokenChart.destroy();
      }

      tokenChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Tokens',
              data: tokens,
              backgroundColor: 'rgba(96, 165, 250, 0.8)',
              yAxisID: 'y'
            },
            {
              label: 'Cost ($)',
              data: costs,
              type: 'line',
              borderColor: '#e94560',
              backgroundColor: 'transparent',
              yAxisID: 'y1',
              tension: 0.3
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          scales: {
            y: {
              type: 'linear',
              position: 'left',
              title: { display: true, text: 'Tokens', color: '#aaa' },
              ticks: { color: '#aaa' },
              grid: { color: 'rgba(255,255,255,0.1)' }
            },
            y1: {
              type: 'linear',
              position: 'right',
              title: { display: true, text: 'Cost ($)', color: '#aaa' },
              ticks: { color: '#aaa' },
              grid: { display: false }
            },
            x: {
              ticks: { color: '#aaa' },
              grid: { color: 'rgba(255,255,255,0.1)' }
            }
          },
          plugins: {
            legend: {
              labels: { color: '#eee' }
            }
          }
        }
      });
    }

    function updateConsumersTable(consumers) {
      const tbody = document.querySelector('#consumersTable tbody');
      tbody.innerHTML = consumers.map(c => `
        <tr>
          <td>${c.username}</td>
          <td>${formatNumber(c.totalTokens)}</td>
          <td>${c.requestCount}</td>
          <td>${formatCurrency(c.estimatedCost)}</td>
        </tr>
      `).join('');
    }

    function updateFactsTable(facts) {
      const tbody = document.querySelector('#factsTable tbody');
      tbody.innerHTML = facts.map(f => `
        <tr>
          <td>${f.userId.substring(0, 20)}...</td>
          <td>${f.factCount}</td>
          <td title="${f.sampleFacts[0] || 'N/A'}">${
            (f.sampleFacts[0] || 'N/A').substring(0, 40)
          }...</td>
        </tr>
      `).join('');
    }

    function updateChannelTable(channels) {
      const tbody = document.querySelector('#channelTable tbody');
      tbody.innerHTML = channels.slice(0, 10).map(c => `
        <tr>
          <td>${c.channelId}</td>
          <td>${c.messageCount}</td>
          <td>${c.uniqueAuthors}</td>
          <td>${c.isTracked ? '✓ Tracked' : '—'}</td>
        </tr>
      `).join('');
    }

    // Load data on page load
    loadData();

    // Auto-refresh every 5 minutes
    setInterval(loadData, 5 * 60 * 1000);
  </script>
</body>
</html>
```

---

## Phase 4: Integration into Bot

### Modify: `bot.js` (health server section)

```javascript
// In bot.js - Add to the health server setup section

const express = require('express');
const path = require('path');
const AnalyticsService = require('./services/AnalyticsService');
const analyticsRoutes = require('./routes/analytics');

// ... existing bot setup code ...

// Create analytics service
const analyticsService = new AnalyticsService(
  this.mongoService,
  this.qdrantClient  // Pass Qdrant client if available
);

// Set up Express app for health checks and analytics
const app = express();

// Serve static files
app.use('/public', express.static(path.join(__dirname, 'public')));

// Health check endpoints (existing)
app.get('/healthz', (req, res) => res.status(200).send('OK'));
app.get('/readyz', (req, res) => {
  if (this.isReady) {
    res.status(200).send('Ready');
  } else {
    res.status(503).send('Not Ready');
  }
});

// Analytics endpoints
app.use('/api/analytics', analyticsRoutes(analyticsService));

// Serve dashboard HTML
app.get('/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

// Start server
const PORT = process.env.HEALTH_PORT || 8080;
app.listen(PORT, () => {
  logger.info(`Health and analytics server listening on port ${PORT}`);
});
```

---

## Phase 5: Security Considerations

### Option A: Basic Auth (Simple)

```javascript
// middleware/auth.js
const basicAuth = require('express-basic-auth');

const analyticsAuth = basicAuth({
  users: {
    [process.env.ANALYTICS_USER || 'admin']: process.env.ANALYTICS_PASS || 'changeme'
  },
  challenge: true,
  realm: 'Analytics Dashboard'
});

// In bot.js
app.use('/analytics', analyticsAuth);
app.use('/api/analytics', analyticsAuth);
```

### Option B: Discord OAuth (More Secure)

```javascript
// Only allow specific Discord user IDs
const ALLOWED_USER_IDS = process.env.BOT_ADMIN_USER_IDS?.split(',') || [];

// Use Discord OAuth2 flow to verify user
// Implementation would require passport-discord or similar
```

### Option C: IP Whitelist (For Internal Use)

```javascript
// Only allow from specific IPs (e.g., VPN, internal network)
const allowedIPs = ['10.0.0.0/8', '192.168.0.0/16'];

app.use('/analytics', (req, res, next) => {
  const clientIP = req.ip;
  // Check if IP is in allowed range
  // ...
});
```

---

## File Structure

```
discord-article-bot/
├── services/
│   └── AnalyticsService.js      # NEW - Analytics data aggregation
├── routes/
│   └── analytics.js             # NEW - API endpoints
├── public/
│   └── analytics.html           # NEW - Dashboard HTML
├── middleware/
│   └── auth.js                  # NEW - Authentication (optional)
└── bot.js                       # MODIFY - Add Express routes
```

---

## Environment Variables

Add to `k8s/overlays/deployed/configmap.yaml`:

```yaml
# Analytics Dashboard
ANALYTICS_ENABLED: "true"
ANALYTICS_CACHE_TTL: "60"  # Cache results for 60 seconds
```

Add to secrets (if using basic auth):

```yaml
ANALYTICS_USER: "admin"
ANALYTICS_PASS: "your-secure-password"
```

---

## Token Pricing Reference

Update `TOKEN_PRICING` in AnalyticsService.js when prices change:

| Model | Input (per 1K) | Output (per 1K) |
|-------|----------------|-----------------|
| gpt-4o | $0.0025 | $0.01 |
| gpt-4o-mini | $0.00015 | $0.0006 |
| gpt-4.1-mini | $0.0004 | $0.0016 |
| gpt-5-mini | $0.00015 | $0.0006 |

---

## Testing Plan

### Unit Tests

```javascript
// __tests__/services/AnalyticsService.test.js

describe('AnalyticsService', () => {
  describe('getTokenConsumption', () => {
    it('should aggregate daily token usage');
    it('should aggregate weekly token usage');
    it('should calculate costs correctly');
  });

  describe('getBurnRateAndProjection', () => {
    it('should calculate average daily burn rate');
    it('should project monthly costs');
  });

  describe('getTopConsumers', () => {
    it('should return users sorted by token usage');
    it('should limit results correctly');
  });

  describe('_calculateCost', () => {
    it('should use correct pricing for each model');
    it('should fall back to default pricing');
  });
});
```

### Integration Tests

```javascript
// __tests__/routes/analytics.test.js

describe('Analytics API', () => {
  describe('GET /api/analytics/dashboard', () => {
    it('should return complete dashboard data');
    it('should handle database errors gracefully');
  });

  describe('GET /api/analytics/tokens/:period', () => {
    it('should accept daily/weekly/monthly period');
    it('should respect lookback query param');
  });
});
```

---

## Deployment Steps

1. **Create new files**:
   - `services/AnalyticsService.js`
   - `routes/analytics.js`
   - `public/analytics.html`

2. **Modify bot.js** to add Express routes

3. **Add dependencies** (if not already present):
   ```bash
   npm install express-basic-auth  # If using basic auth
   ```

4. **Update ConfigMap** with analytics settings

5. **Build and deploy**:
   ```bash
   npm test
   docker build -t mvilliger/discord-article-bot:<version> .
   docker push mvilliger/discord-article-bot:<version>
   kubectl set image deployment/discord-article-bot bot=mvilliger/discord-article-bot:<version> -n discord-article-bot
   ```

6. **Access dashboard** at:
   - Internal: `http://discord-article-bot:8080/analytics`
   - Via port-forward: `kubectl port-forward deployment/discord-article-bot 8080:8080 -n discord-article-bot`
   - Then browse to: `http://localhost:8080/analytics`

---

## Future Enhancements

1. **Caching Layer**: Add Redis caching for expensive aggregations
2. **Real-time Updates**: WebSocket for live dashboard updates
3. **Alerting**: Slack/Discord notifications when thresholds exceeded
4. **Export**: CSV/PDF export of reports
5. **Date Range Picker**: Custom date range selection in UI
6. **Comparison View**: Compare current period vs previous
7. **Per-Command Analytics**: Break down by command type
8. **Dynatrace Integration**: Push metrics to Dynatrace for alerting
