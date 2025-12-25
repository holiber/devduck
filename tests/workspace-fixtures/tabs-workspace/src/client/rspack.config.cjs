const path = require('node:path');
const { defineConfig } = require('@rspack/cli');

const HtmlPluginMod = require('@rspack/plugin-html');
const HtmlPlugin = HtmlPluginMod.default ?? HtmlPluginMod;

const ReactRefreshPluginMod = require('@rspack/plugin-react-refresh');
const ReactRefreshPlugin = ReactRefreshPluginMod.default ?? ReactRefreshPluginMod;

module.exports = defineConfig((_env, argv) => {
  const isDev = argv.mode !== 'production';

  return {
    mode: isDev ? 'development' : 'production',
    entry: {
      main: path.resolve(__dirname, 'src/main.tsx')
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isDev ? '[name].js' : '[name].[contenthash].js',
      clean: true
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js']
    },
    module: {
      rules: [
        {
          test: /\.[jt]sx?$/,
          exclude: /node_modules/,
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'typescript', tsx: true },
              transform: {
                react: {
                  runtime: 'automatic',
                  refresh: isDev
                }
              }
            }
          }
        }
      ]
    },
    plugins: [new HtmlPlugin({ template: path.resolve(__dirname, 'public/index.html') }), isDev ? new ReactRefreshPlugin() : null].filter(
      Boolean
    ),
    devServer: {
      host: '127.0.0.1',
      historyApiFallback: true
    }
  };
});

