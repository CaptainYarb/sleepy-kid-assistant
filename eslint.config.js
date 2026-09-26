import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import globals from 'globals';

export default tseslint.config(
	{ ignores: ['dist/**', 'node_modules/**', 'py/.venv/**', 'dev-data/**'] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	...vue.configs['flat/recommended'],
	{
		files: ['**/*.vue'],
		languageOptions: { parserOptions: { parser: tseslint.parser } },
	},
	{
		languageOptions: { globals: { ...globals.node, ...globals.browser } },
		rules: {
			'vue/html-indent': ['error', 'tab'],
			'vue/max-attributes-per-line': 'off',
			'vue/singleline-html-element-content-newline': 'off',
			'vue/multi-word-component-names': 'off',
			indent: ['error', 'tab', { SwitchCase: 1 }],
			quotes: ['error', 'single', { avoidEscape: true }],
			semi: ['error', 'always'],
			'@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
		},
	},
	{
		files: ['**/*.vue'],
		rules: { indent: 'off' },
	},
);
