import js from "@eslint/js";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";

// --- Project rules: layer boundaries and extensions.gnome.org review guidelines -------------------------

const SOURCES = ["extension.js", "prefs.js", "lib/**/*.js", "prefs/**/*.js"];
const SHELL_PROCESS = ["extension.js", "lib/**/*.js"];
const PREFS_PROCESS = ["prefs.js", "prefs/**/*.js"];

const noGtkInShell = {
    regex: "^gi://(Gtk|Gdk|Adw)$",
    message: "Gtk/Gdk/Adw inside the GNOME Shell process. Instant rejection on extensions.gnome.org. "
        + "Prefs only, thanks.",
};
const noGnome = (where) => [
    {
        regex: "^gi://",
        message: `${where} does not touch GNOME. Ever. `
            + "Inject a Shell adapter through the constructor instead of importing gi:// here.",
    },
    {
        regex: "^resource://",
        message: `${where} importing GNOME Shell resources? No. That is lib/shell's job.`,
    },
];
const noLayer = (layers, message) => ({ regex: `(^|/)(${layers.join("|")})/`, message });

// Regex patterns are case-insensitive by default, which would match resource:///org/gnome/Shell/Extensions.
const restrictedImports = (patterns) => ["error", { patterns: patterns.map((p) => ({ ...p, caseSensitive: true })) }];

const noTimeouts = [
    {
        object: "GLib",
        property: "timeout_add",
        message: "Arbitrary timeout. React to a signal or use a BEFORE_REDRAW later like a grown-up.",
    },
    {
        object: "GLib",
        property: "timeout_add_seconds",
        message: "Arbitrary timeout, now in seconds. Still no. Signals or laters.",
    },
];
const noDispose = [
    {
        property: "run_dispose",
        message: "run_dispose()? Reviewers will demand a very good comment. Destroy things properly instead.",
    },
];
const noSubprocess = [
    {
        object: "Gio",
        property: "Subprocess",
        message: "Spawning processes inside GNOME Shell. Absolutely not. If you must, do it in prefs.",
    },
];

const guidelineRules = {
    "no-restricted-globals": [
        "error",
        {
            name: "imports",
            message: "`imports.*` is the legacy module system (Lang, Mainloop, ByteArray...). Deprecated. "
                + "Use ES modules.",
        },
        { name: "setTimeout", message: "setTimeout. Seriously? React to a signal or use a BEFORE_REDRAW later." },
        { name: "setInterval", message: "setInterval. Polling GNOME Shell like it's 2009. Use signals." },
    ],
    "no-restricted-syntax": [
        "error",
        {
            selector: "CallExpression[optional=true]",
            message: "`?.()` on a call. Either the method exists (call it) or it doesn't (handle that explicitly). "
                + "Reviewers hate this one.",
        },
        {
            selector: "BinaryExpression[left.type='UnaryExpression'][left.operator='typeof'][right.value='function']",
            message: "`typeof x === 'function'` feature sniffing. "
                + "Target the supported GNOME versions and call the API like you mean it.",
        },
        {
            selector: "BinaryExpression[right.type='UnaryExpression'][right.operator='typeof'][left.value='function']",
            message: "Feature sniffing, Yoda style. Same verdict: call the API like you mean it.",
        },
    ],
    "no-console": [
        "error",
    ],
};

// ESLint has no core max-returns rule, so it lives here as a local plugin.
const projectPlugin = {
    rules: {
        "max-returns": {
            meta: {
                type: "suggestion",
                schema: [{ type: "integer", minimum: 0 }],
                messages: {
                    tooMany: "{{count}} return statements (max {{max}}). This function is a choose-your-own-adventure "
                        + "book. Split it or use a guard and one exit.",
                },
            },
            create(context) {
                const max = context.options[0] ?? 3;
                const stack = [];
                const enter = (node) => stack.push({ node, count: 0 });
                const exit = () => {
                    const { node, count } = stack.pop();
                    if (count > max) context.report({ node, messageId: "tooMany", data: { count, max } });
                };
                return {
                    ":function": enter,
                    ":function:exit": exit,
                    ReturnStatement() {
                        if (stack.length) stack[stack.length - 1].count++;
                    },
                };
            },
        },
    },
};

export default [
    js.configs.recommended,
    {
        ignores: ["coverage/**"]
    },
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
            "unused-imports": unusedImports,
            project: projectPlugin,
        },
        rules: {
            // Disable default no-unused-vars and use the plugin's one
            "no-unused-vars": "off",
            "unused-imports/no-unused-imports": "error",
            "unused-imports/no-unused-vars": [
                "error",
                { 
                    "vars": "all",
                    // Positional callbacks of GTK / Mutter signals: unused leading args are named _x
                    "args": "all",
                    "argsIgnorePattern": "^_",
                    "caughtErrors": "all"
                }
            ],
            "no-undef": "error",
            "no-empty": "error",
            "no-constant-condition": "error",
            "no-prototype-builtins": "warn",
            "no-useless-escape": "warn",
            "no-cond-assign": "warn",
            "no-func-assign": "warn",
            "no-import-assign": "warn",
            "no-inner-declarations": "warn",
            "no-unsafe-finally": "error",
            "no-unsafe-negation": "error",
            "no-dupe-keys": "error",
            "preserve-caught-error": "warn",
            "max-params": ["warn", 4],
            "project/max-returns": ["warn", 4],
            "max-len": ["warn", { "code": 120, "ignorePattern": "^(?=.*Logger\\.).{0,160}$" }],
            "eqeqeq": ["error", "always"],
            "no-shadow": "warn",
            "prefer-const": "warn",
            "no-var": "error"
        }
    },
    {
        files: SOURCES,
        rules: {
            ...guidelineRules,
            "no-restricted-properties": ["error", ...noTimeouts, ...noDispose],
        },
    },
    {
        files: ["lib/utils/logger.js"],
        rules: { "no-console": "off" },
    },
    {
        files: SHELL_PROCESS,
        rules: {
            "no-restricted-imports": restrictedImports([noGtkInShell]),
            "no-restricted-properties": ["error", ...noTimeouts, ...noDispose, ...noSubprocess],
        },
    },
    {
        files: ["lib/domain/**/*.js"],
        rules: {
            "no-restricted-imports": restrictedImports([
                ...noGnome("The domain"),
                noLayer(
                    ["app", "shell"],
                    "The domain does not know lib/app or lib/shell exist. "
                        + "Dependencies point inward, not wherever you feel like.",
                ),
            ]),
        },
    },
    {
        files: ["lib/app/**/*.js"],
        rules: {
            "no-restricted-imports": restrictedImports([
                ...noGnome("lib/app"),
                noLayer(
                    ["shell"],
                    "lib/app importing lib/shell? Backwards. Hand the Shell object in through the constructor.",
                ),
            ]),
        },
    },
    {
        files: ["lib/shell/**/*.js"],
        rules: {
            "no-restricted-imports": restrictedImports([
                noGtkInShell,
                noLayer(
                    ["app"],
                    "Adapters poking into lib/app? Wire the Engine up in extension.js and keep lib/shell dumb.",
                ),
            ]),
        },
    },
    {
        // Code both processes run that needs GSettings: Gio and GLib only, which exist in both
        files: ["lib/gio/**/*.js"],
        rules: {
            "no-restricted-imports": restrictedImports([
                {
                    regex: "^gi://(?!(Gio|GLib)$)",
                    message: "lib/gio runs in the Shell and in prefs. Gio and GLib only; the rest is one process's.",
                },
                {
                    regex: "^resource://",
                    message: "lib/gio importing GNOME Shell resources? Prefs cannot load them. lib/shell's job.",
                },
                noLayer(["app", "shell"], "lib/gio is shared with prefs, which may not reach lib/app or lib/shell."),
            ]),
        },
    },
    {
        files: ["lib/utils/**/*.js"],
        rules: {
            "no-restricted-imports": restrictedImports(noGnome("lib/utils (used by prefs too)")),
        },
    },
    {
        files: PREFS_PROCESS,
        rules: {
            "no-restricted-imports": restrictedImports([
                {
                    regex: "^gi://(Clutter|Meta|St|Shell)$",
                    message: "Clutter/Meta/St/Shell in prefs. Wrong process, it will blow up, "
                        + "and reviewers will reject it. Shell side only.",
                },
                {
                    regex: "^resource:///org/gnome/shell/",
                    message: "resource:///org/gnome/shell is Shell-process only. Prefs cannot load it. Nice try.",
                },
                noLayer(
                    ["lib/app", "lib/shell"],
                    "Prefs may import lib/domain and lib/utils. Leave the Engine and the Mutter adapters alone.",
                ),
            ]),
        },
    },
    {
        // GTK callbacks have fixed signatures; test helpers mirror Mutter's wide constructors.
        files: [...PREFS_PROCESS, "tests/**/*.js"],
        rules: { "max-params": "off" },
    },
    {
        files: ["tests/**/*.js"],
        rules: {
            "max-len": "off",
            "no-shadow": "off"
        }
    }
];
