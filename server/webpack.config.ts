import CopyPlugin from "copy-webpack-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";
import * as path from "path";
import TerserPlugin from "terser-webpack-plugin";
import * as webpack from "webpack";

// Basic Webpack config for TypeScript, based on
// https://webpack.js.org/guides/typescript/ .
const config: webpack.Configuration = {
  // mode and devtool are overridden by `npm run build` for production mode.
  mode: "development",
  devtool: "eval-source-map",
  entry: "./src/site/main.ts",
  output: {
    filename: "[name].bundle.js",
    path: path.resolve(__dirname, "build"),
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.js$/,
        enforce: "pre",
        use: ["source-map-loader"],
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  plugins: [
    // Use src/site/index.html as the entry point.
    new HtmlWebpackPlugin({
      template: "./src/site/index.html",
    }),
    new CopyPlugin({
      // We include a favicon to prevent 404 logs.
      patterns: [{ from: "src/site/favicon.ico", to: "[name][ext]" }],
    }),
  ],
  optimization: {
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            passes: 2,
          },
          // Exported CPU profiles don't seem to work with source maps
          // (https://stackoverflow.com/q/72958526);
          // instead, don't minify class/function names.
          keep_classnames: true,
          keep_fnames: true,
        },
      }),
    ],
  },
  // Bundler setup required by Automerge, from
  // https://www.npmjs.com/package/@automerge/automerge
  experiments: { asyncWebAssembly: true },
};

export default config;
