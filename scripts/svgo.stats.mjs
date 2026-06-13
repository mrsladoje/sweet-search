// svgo config for assets/code-retrieval-stats.svg — keeps rendering byte-identical.
// convertShapeToPath is disabled because shape-rendering="crispEdges" snaps <rect>
// and path-rects differently in some rasterizers, which would shift pixel edges.
export default {
  multipass: true,
  js2svg: { pretty: false },
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          removeViewBox: false,
          convertShapeToPath: false,
          removeHiddenElems: false,
        },
      },
    },
  ],
};
