/**
 * AI provider registry (scaffolding).
 *
 * This is intentionally minimal: providers are plugged in over time.
 * The task runner can record best-effort usage/cost data when provider reports it.
 */

const cursorAgentCli = require('./cursor-agent-cli');

module.exports = {
  cursorAgentCli,
  // placeholders:
  // cline: require('./cline'),
  // yandexGpt: require('./yandex-gpt'),
  // continue: require('./continue'),
  // roocode: require('./roocode'),
};

