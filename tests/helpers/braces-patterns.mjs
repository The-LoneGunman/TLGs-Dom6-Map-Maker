// Deterministic compatibility corpus captured against unmodified braces 3.0.3.
// Keep this independent of both implementations so a changed fork cannot
// silently redefine the expected behavior.
export function bracesCompatibilityCases() {
  const patterns = [
    '', 'a', 'src/**/*.{js,ts,tsx}', '{a,b}', '{a,,b}', '{,a,}', '{a,a,b}',
    '{1..12}', '{01..10..2}', '{10..1..3}', '{a..f}', '{Z..V}',
    'src/{app,{pages,components}}/**/{index,route}.{ts,tsx}',
    'foo/{bar}/baz', 'a{}b', '{a,b', 'a,b}', '((a|b))/{x,y}',
    '${name}/{one,two}', '{a,${b,c}}', '\\{a,b\\}', '[{a,b}]/{c,d}',
    '"{a,b}"/{x,y}', "'{a,b}'/{x,y}", '`{a,b}`/{x,y}',
    '{x..y..z}', '{1..2,3}', '{..}', '{a...b}', 'a/(b/{c,d})',
    '{foo/bar,foo/baz}/**/*', '{α,β}/{north,south}',
  ];
  for (const prefix of ['src/', 'tests/', 'vendor/']) {
    for (const middle of ['{one,two}', '{1..4}', '{a,{b,c}}', '(foo|bar)']) {
      for (const suffix of ['.js', '/**/*.{ts,tsx}', '/{01..03}']) {
        patterns.push(prefix + middle + suffix);
      }
    }
  }
  for (const depth of [1, 2, 8, 32, 64, 127, 128]) {
    patterns.push('{'.repeat(depth) + 'a,b' + '}'.repeat(depth));
    patterns.push('('.repeat(depth) + 'a' + ')'.repeat(depth));
  }
  return patterns.flatMap(pattern => [
    {}, { escapeInvalid: true }, { keepEscaping: true, keepQuotes: true },
    { nodupes: true, noempty: true },
  ].map(options => ({ pattern, options })));
}

export function bracesCompatibilityResults(braces) {
  return bracesCompatibilityCases().map(({ pattern, options }) => ({
    pattern, options,
    compile: braces.compile(pattern, options),
    expand: braces.expand(pattern, options),
    stringify: braces.stringify(pattern, options),
    create: braces.create(pattern, options),
  }));
}
