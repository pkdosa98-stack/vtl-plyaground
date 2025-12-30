const assert = require('node:assert');
const test = require('node:test');
const Module = require('node:module');
const path = require('node:path');

const { render, renderTemplate, createContext, evaluateExpression } = require('../src/compiler');

test('Integer.parseInt remains available even when template tries to reset it', () => {
  const ctx = createContext({ Integer: 'should be ignored' });
  assert.strictEqual(typeof ctx.Integer.parseInt, 'function');
});

test('renders password age example template', () => {
  const template = `
#set($Integer = 0)
#set($result = "Idle")
#if($pswLastChangedTime == "")
$result
#else
#set($nowYear = $Integer.parseInt($nowTime) / 10000)
#set($nowMonth = ($Integer.parseInt($nowTime) % 10000) / 100)
#set($nowDay = $Integer.parseInt($nowTime) % 100)
#set($pswYear = $Integer.parseInt($pswLastChangedTime) / 10000)
#set($pswMonth = ($Integer.parseInt($pswLastChangedTime) % 10000) / 100)
#set($pswDay = $Integer.parseInt($pswLastChangedTime) % 100)
#set($nowDays = ($nowYear * 365) + ($nowMonth * 30) + $nowDay)
#set($pswDays = ($pswYear * 365) + ($pswMonth * 30) + $pswDay)
#set($diffInDays = ($nowDays - $pswDays))
$diffInDays
#if($diffInDays == 21)
#set($result = 21)
#elseif($diffInDays == 12)
#set($result = 12)
#elseif($diffInDays >= 1 && $diffInDays <= 11)
#set($result = $diffInDays)
#else
#set($result = "Idle")
#end
#end
$result
`;

  const output = render(template, {
    pswLastChangedTime: '251221',
    nowTime: '251229',
  }).trim();

  const numbers = output
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  assert.deepStrictEqual(numbers, ['8', '8']);
});

test('falls back to Idle when no last changed date is provided', () => {
  const template = `
#set($Integer = 0)
#set($result = "Idle")
#if($pswLastChangedTime == "")
$result
#else
#set($result = "Changed")
#end
$result`;

  const output = render(template, { pswLastChangedTime: '' }).trim();
  assert.strictEqual(output.replace(/\s+/g, ''), 'IdleIdle');
});

test('integer math truncates divisions during assignment', () => {
  const template = `
#set($Integer = 0)
#set($value = 10 / 3)
$value
`;

  const output = render(template, {}).trim();
  assert.strictEqual(output, '3');
});

test('evaluateExpression resolves variables', () => {
  const context = createContext({ value: 2 });
  const result = evaluateExpression('$value + 3', context);
  assert.strictEqual(result, 5);
});

test('renderTemplate falls back to custom renderer when velocityjs is unavailable', () => {
  const template = `
#set($value = 2 + 2)
$value
`;
  const output = renderTemplate(template, {}, { preferVelocity: true }).trim();
  assert.strictEqual(output, '4');
});

test('renderTemplate gracefully falls back when velocityjs throws during render', () => {
  const template = `
#set($value = 1 + 1)
$value
`;

  const originalLoad = Module._load;
  const stubVelocity = {
    render() {
      throw new Error('velocity failure');
    },
  };

  Module._load = function patched(request, parent, isMain) {
    if (request === 'velocityjs') {
      return stubVelocity;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const compilerPath = path.resolve(__dirname, '../src/compiler.js');
  delete require.cache[compilerPath];
  // Re-require to pick up the stubbed velocityjs.
  // eslint-disable-next-line global-require
  const freshCompiler = require('../src/compiler');

  try {
    const output = freshCompiler.renderTemplate(template, {}, { preferVelocity: true }).trim();
    assert.strictEqual(output, '2');
  } finally {
    Module._load = originalLoad;
    delete require.cache[compilerPath];
  }
});

test('renders indented template with spaces after directives', () => {
  const template = `
#set($Integer = 0)
#set($result = "Idle") 
#if ($pswLastChangedTime == "")
$result
#else
  #set($nowYear = $Integer.parseInt($nowTime) / 10000)
  #set($nowMonth = ($Integer.parseInt($nowTime) % 10000) / 100)
  #set($nowDay = $Integer.parseInt($nowTime) % 100)
  #set($pswYear = $Integer.parseInt($pswLastChangedTime) / 10000)
  #set($pswMonth = ($Integer.parseInt($pswLastChangedTime) % 10000) / 100)
  #set($pswDay = $Integer.parseInt($pswLastChangedTime) % 100)
  #set($nowDays = ($nowYear * 365) + ($nowMonth * 30) + $nowDay)
$nowDays
  #set($pswDays = ($pswYear * 365) + ($pswMonth * 30) + $pswDay)
  #set($diffInDays = ($nowDays - $pswDays))
$diffInDays
  #if ($diffInDays == 21)
    #set($result = 21)
  #elseif ($diffInDays == 12)
    #set($result = 12)
  #elseif ($diffInDays >= 1 && $diffInDays <= 11)
    #set($result = $diffInDays)
  #else
    #set($result = "Idle")
  #end
  $result
#end`;

  const output = render(template, {
    pswLastChangedTime: '251221',
    nowTime: '251229',
  }).trim();

  const cleaned = output.split(/\s+/).filter(Boolean);
  assert.deepStrictEqual(cleaned, ['9514', '8', '8']);
});
