// Build-time adapter: the web host ships one optimized bundle, while source
// generators and explicit on-chain resource boundaries remain canonical.
export function createKeelBrowserBundlePlugin({ aliases = {}, transforms = [] } = {}) {
  const names = Object.keys(aliases);
  if (names.some(name => typeof aliases[name] !== 'string' || !aliases[name])) throw new TypeError('Bundle aliases need module IDs');
  if (transforms.some(plugin => !plugin?.name || typeof plugin.setup !== 'function')) throw new TypeError('Bundle transforms need esbuild plugins');
  return { name: 'keel-browser-bundle', setup(build) {
    build.onResolve({ filter: /.*/ }, async args => {
      if (args.pluginData?.keelBrowserAlias || !Object.hasOwn(aliases, args.path)) return;
      return build.resolve(aliases[args.path], { resolveDir: args.resolveDir, kind: args.kind,
        pluginData: { ...args.pluginData, keelBrowserAlias: true } });
    });
    for (const plugin of transforms) plugin.setup(build);
  } };
}
