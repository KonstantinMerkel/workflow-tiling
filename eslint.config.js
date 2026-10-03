import js from "@eslint/js";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
                globalThis: "readonly",
                log: "readonly",
                logError: "readonly",
                print: "readonly",
                printerr: "readonly",
                ARGV: "readonly"
            }
        },
        plugins: {
            "unused-imports": unusedImports
        },
        rules: {
            // Disable default no-unused-vars and use the plugin's one
            "no-unused-vars": "off",
            "unused-imports/no-unused-imports": "error",
            "unused-imports/no-unused-vars": [
                "error",
                { 
                    "vars": "all",
                    "args": "none",
                    "caughtErrors": "none"
                }
            ],
            // Downgrade other recommended rules to warning so we can list them
            // without failing the lint completely (except for unused vars)
            "no-undef": "warn",
            "no-empty": "warn",
            "no-constant-condition": "warn",
            "no-prototype-builtins": "warn",
            "no-useless-escape": "warn",
            "no-cond-assign": "warn",
            "no-func-assign": "warn",
            "no-import-assign": "warn",
            "no-inner-declarations": "warn",
            "no-unsafe-finally": "warn",
            "no-unsafe-negation": "warn",
            "no-dupe-keys": "warn",
            "preserve-caught-error": "warn"
        }
    }
];
