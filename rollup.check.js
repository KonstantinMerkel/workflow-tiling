export default {
    input: 'extension.js',
    external: [/^gi:\/\//, /^resource:\/\//],
    onwarn(warning, warn) {
        // Throw only on critical import/export errors
        if (warning.code === 'MISSING_EXPORT' || warning.code === 'UNRESOLVED_IMPORT') {
            throw new Error(warning.message);
        }
    }
};
