const { ValidationError } = require('./articleExtractor');

class ProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProviderError';
  }
}

function isDisplayableError(error) {
  if (!error) return false;
  if (error instanceof ProviderError) return true;
  if (ValidationError && error instanceof ValidationError) return true;
  return error.name === 'ValidationError' || error.name === 'ProviderError';
}

module.exports = { ProviderError, isDisplayableError };
