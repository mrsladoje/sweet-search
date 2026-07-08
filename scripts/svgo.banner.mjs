// svgo config for assets/sweet-search-banner-pixelated.svg — the conservative
// "byte-identical render" variant used in a0274be. Numeric cleanups and
// path/transform conversion are disabled so no number — including SMIL
// animation values/keyTimes — is ever rounded; shape-rendering="crispEdges"
// snaps <rect> and path-rects differently, so convertShapeToPath stays off.
// Usage: npx svgo --config scripts/svgo.banner.mjs assets/sweet-search-banner-pixelated.svg
export default {
  multipass: true,
  js2svg: { pretty: false },
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          convertShapeToPath: false,
          removeHiddenElems: false,
          cleanupNumericValues: false,
          convertPathData: false,
          convertTransform: false,
          cleanupIds: false,
          removeUnknownsAndDefaults: false,
          collapseGroups: false,
          moveGroupAttrsToElems: false,
          moveElemsAttrsToGroup: false,
        },
      },
    },
  ],
};
