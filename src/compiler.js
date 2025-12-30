const vm = require('node:vm');

function tryLoadVelocity() {
  try {
    // velocityjs is an optional dependency. If it is not available in the
    // environment we silently fall back to the built-in renderer.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    return require('velocityjs');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      // Surface unexpected errors to avoid masking real issues.
      throw error;
    }
    return null;
  }
}

const velocityEngine = tryLoadVelocity();

const BUILT_INS = {
  Integer: Object.freeze({
    parseInt(value) {
      const parsed = Number.parseInt(String(value), 10);
      if (Number.isNaN(parsed)) {
        throw new Error(`Unable to parse integer from value: ${value}`);
      }
      return parsed;
    },
  }),
};

function normalizeValue(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : Math.trunc(value);
  }
  return value;
}

function coerceNumericLike(value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      return Number.isNaN(numeric) ? value : numeric;
    }
  }
  return value;
}

function createContext(userContext = {}) {
  const context = Object.create(null);
  for (const [key, helper] of Object.entries(BUILT_INS)) {
    context[key] = helper;
  }

  for (const [key, value] of Object.entries(userContext)) {
    if (Object.prototype.hasOwnProperty.call(BUILT_INS, key)) {
      continue;
    }
    context[key] = value;
  }

  return context;
}

function evaluateExpression(rawExpression, context) {
  const replaced = rawExpression.replace(/\$([A-Za-z_][\w]*)/g, (_, name) => `__resolve("${name}")`);
  const resolve = (name) => coerceNumericLike(context[name]);
  const script = new vm.Script(replaced, { displayErrors: true });
  return script.runInNewContext({
    __resolve: resolve,
    Math,
    Number,
    parseInt: Number.parseInt,
  });
}

function interpolate(text, context) {
  return text.replace(/\$([A-Za-z_][\w]*)/g, (_, name) => {
    const value = context[name];
    if (value === undefined || value === null) {
      return '';
    }
    return String(value);
  });
}

function readParenthesized(template, startIndex) {
  let depth = 0;
  for (let i = startIndex; i < template.length; i += 1) {
    const char = template[i];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return { content: template.slice(startIndex + 1, i), endIndex: i + 1 };
      }
    }
  }
  throw new Error(`Unterminated directive starting at index ${startIndex}`);
}

function tokenize(template) {
  const tokens = [];
  let cursor = 0;

  const pushText = (start, end) => {
    if (end > start) {
      tokens.push({ type: 'text', value: template.slice(start, end) });
    }
  };

  while (cursor < template.length) {
    const hashIndex = template.indexOf('#', cursor);
    if (hashIndex === -1) {
      pushText(cursor, template.length);
      break;
    }

    pushText(cursor, hashIndex);

    if (template.startsWith('#set(', hashIndex)) {
      const { content, endIndex } = readParenthesized(template, hashIndex + 4);
      tokens.push({ type: 'set', content });
      cursor = endIndex;
      continue;
    }

    if (template.startsWith('#if(', hashIndex)) {
      const { content, endIndex } = readParenthesized(template, hashIndex + 3);
      tokens.push({ type: 'if', content });
      cursor = endIndex;
      continue;
    }

    if (template.startsWith('#elseif(', hashIndex)) {
      const { content, endIndex } = readParenthesized(template, hashIndex + 7);
      tokens.push({ type: 'elseif', content });
      cursor = endIndex;
      continue;
    }

    if (template.startsWith('#else', hashIndex)) {
      tokens.push({ type: 'else' });
      cursor = hashIndex + 5;
      continue;
    }

    if (template.startsWith('#end', hashIndex)) {
      tokens.push({ type: 'end' });
      cursor = hashIndex + 4;
      continue;
    }

    tokens.push({ type: 'text', value: '#' });
    cursor = hashIndex + 1;
  }

  return tokens;
}

function isFrameActive(frameStack) {
  return frameStack.every((frame) => frame.active);
}

function render(template, userContext = {}) {
  const context = createContext(userContext);
  const tokens = tokenize(template);
  const frameStack = [];
  const output = [];

  const active = () => isFrameActive(frameStack);

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        if (active()) {
          output.push(interpolate(token.value, context));
        }
        break;
      case 'set': {
        if (!active()) {
          break;
        }
        const setMatch = token.content.match(/^\s*\$([A-Za-z_][\w]*)\s*=\s*(.+)$/);
        if (!setMatch) {
          throw new Error(`Unable to parse set directive: ${token.content}`);
        }
        const [, variableName, expression] = setMatch;
        if (!Object.prototype.hasOwnProperty.call(BUILT_INS, variableName)) {
          context[variableName] = normalizeValue(evaluateExpression(expression, context));
        }
        break;
      }
      case 'if': {
        const parentActive = active();
        const conditionMet = parentActive ? Boolean(evaluateExpression(token.content, context)) : false;
        frameStack.push({
          parentActive,
          active: conditionMet && parentActive,
          branchSatisfied: conditionMet && parentActive,
        });
        break;
      }
      case 'elseif': {
        if (frameStack.length === 0) {
          throw new Error('#elseif without matching #if');
        }
        const frame = frameStack[frameStack.length - 1];
        if (!frame.parentActive) {
          frame.active = false;
          break;
        }
        if (frame.branchSatisfied) {
          frame.active = false;
          break;
        }
        const conditionMet = Boolean(evaluateExpression(token.content, context));
        frame.active = conditionMet;
        frame.branchSatisfied = conditionMet;
        break;
      }
      case 'else': {
        if (frameStack.length === 0) {
          throw new Error('#else without matching #if');
        }
        const frame = frameStack[frameStack.length - 1];
        const shouldActivate = frame.parentActive && !frame.branchSatisfied;
        frame.active = shouldActivate;
        frame.branchSatisfied = frame.branchSatisfied || shouldActivate;
        break;
      }
      case 'end': {
        if (frameStack.length === 0) {
          throw new Error('#end without matching #if');
        }
        frameStack.pop();
        break;
      }
      default:
        throw new Error(`Unknown token type: ${token.type}`);
    }
  }

  if (frameStack.length > 0) {
    throw new Error('Unclosed #if block detected');
  }

  return output.join('');
}

function renderWithVelocity(template, userContext = {}) {
  if (!velocityEngine) {
    return null;
  }

  const context = createContext(userContext);
  return velocityEngine.render(template, context);
}

function renderTemplate(template, userContext = {}, options = {}) {
  if (options.preferVelocity) {
    const rendered = renderWithVelocity(template, userContext);
    if (rendered !== null && rendered !== undefined) {
      return rendered;
    }
  }
  return render(template, userContext);
}

module.exports = {
  render,
  renderTemplate,
  tokenize,
  evaluateExpression,
  interpolate,
  createContext,
};
