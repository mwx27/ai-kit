// An error the CLI reports as one line on stderr, exiting with `code`: 64 for a usage error, 1 for
// anything else. Any other exception is a bug and keeps its stack trace.
export class AskRepoError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export const usageError = (message) => new AskRepoError(message, 64);
