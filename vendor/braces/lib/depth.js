'use strict';

// Atlas local fix for GHSA-vfj7-8cjw-p6xm. Count brace AND parenthesis
// containers, not characters or leaf tokens. Options cannot raise this cap.
const MAX_DEPTH = 128;

const assertDepth = depth => {
  if (depth > MAX_DEPTH) {
    const error = new SyntaxError(`Brace pattern nesting exceeds the supported limit (${MAX_DEPTH})`);
    error.code = 'ERR_BRACES_DEPTH';
    throw error;
  }
};

module.exports = { MAX_DEPTH, assertDepth };
