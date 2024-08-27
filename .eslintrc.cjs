/* eslint-env node */
module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    extends: [
        '@voicenter-team/ts'
    ],
    ignorePatterns: [
        'src/helpers/webrtcmetrics/',
        'docs'
    ],
    rules: {
        'space-before-blocks': 'off'
    },
    env: {
        es2021: true,
        browser: true,
        node: true
    }
}
