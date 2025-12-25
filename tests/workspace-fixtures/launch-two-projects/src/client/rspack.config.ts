import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HtmlRspackPlugin } from '@rspack/plugin-html';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === 'production';

export default {
  mode: isProd ? 'production' : 'development',
  entry: {
    main: path.resolve(__dirname, './src/main.tsx'),
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.[tj]sx?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'builtin:swc-loader',
            options: {
              jsc: {
                parser: {
                  syntax: 'typescript',
                  tsx: true,
                },
                transform: {
                  react: {
                    runtime: 'automatic',
                    development: !isProd,
                  },
                },
              },
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new HtmlRspackPlugin({
      template: path.resolve(__dirname, './public/index.html'),
    }),
  ],
  devServer: {
    port: 3000,
    host: '127.0.0.1',
    historyApiFallback: true,
    hot: true,
  },
};

