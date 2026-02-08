# Code Style & Conventions

## Naming
- Functions/variables: camelCase
- Types/interfaces: PascalCase
- CSS classes: kebab-case (prefixed with `csv-diff-`)

## Error Handling
- Do not swallow errors silently; use `console.warn` or `console.error`

## Module Design
- Keep each module focused on a single responsibility
- TypeScript strict mode is mandatory

## CSS
- Use GitHub CSS custom properties (e.g. `--borderColor-default`, `--diffBlob-addition-bgColor-line`) for theme compatibility
- CSS is imported in the content script JS entry point, not in manifest.json
