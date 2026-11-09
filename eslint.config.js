// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // docs/ 里是设计稿和协议摘录，不是应用代码，别让它们的报错淹没真问题。
    ignores: ['dist/*', 'docs/*'],
  },
]);
