// ===== services/CostService.js =====
const logger = require('../logger');

class CostService {
  constructor() {
    // GPT-4.1 mini pricing
    this.pricing = {
      input: 0.40 / 1_000_000,      // $0.40 per 1M tokens
      cachedInput: 0.10 / 1_000_000, // $0.10 per 1M cached tokens
      output: 1.60 / 1_000_000       // $1.60 per 1M tokens
    };

    // Track cumulative costs
    this.cumulative = {
      input: 0,
      output: 0,
      total: 0,
      requests: 0
    };
  }

  calculateCosts(tokenUsage) {
    const { input_tokens, output_tokens, input_tokens_details } = tokenUsage;
    const cachedTokens = input_tokens_details?.cached_tokens || 0;
    const regularInputTokens = input_tokens - cachedTokens;
    
    const inputCost = (regularInputTokens * this.pricing.input) + (cachedTokens * this.pricing.cachedInput);
    const outputCost = output_tokens * this.pricing.output;
    const totalCost = inputCost + outputCost;
    
    return {
      input: inputCost,
      output: outputCost,
      total: totalCost,
      cached: cachedTokens,
      regular: regularInputTokens
    };
  }

  formatCost(cost) {
    if (cost < 0.01) {
      return `${(cost * 100).toFixed(4)}¢`;
    }
    return `$${cost.toFixed(4)}`;
  }

  formatCostBreakdown(costs) {
    return {
      input: this.formatCost(costs.input),
      output: this.formatCost(costs.output),
      total: this.formatCost(costs.total)
    };
  }

  updateCumulative(costs) {
    this.cumulative.input += costs.input;
    this.cumulative.output += costs.output;
    this.cumulative.total += costs.total;
    this.cumulative.requests += 1;

    // Log cumulative costs every 10 requests or if total exceeds $1
    if (this.cumulative.requests % 10 === 0 || this.cumulative.total >= 1) {
      this.logCumulative();
    }
  }

  logCostBreakdown(costs, tokenCounts) {
    logger.info(
      `Cost breakdown - Input: ${this.formatCost(costs.input)} ` +
      `(${tokenCounts.regular} regular + ${tokenCounts.cached} cached), ` +
      `Output: ${this.formatCost(costs.output)}, ` +
      `Total: ${this.formatCost(costs.total)}`
    );
  }

  logCumulative() {
    logger.info(
      `Cumulative costs (${this.cumulative.requests} requests) - ` +
      `Input: ${this.formatCost(this.cumulative.input)}, ` +
      `Output: ${this.formatCost(this.cumulative.output)}, ` +
      `Total: ${this.formatCost(this.cumulative.total)}`
    );
  }
}

module.exports = CostService;