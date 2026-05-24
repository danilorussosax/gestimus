// ESLint flat config (formato richiesto da ESLint 9+).
//
// Strategia:
//   - TypeScript-eslint "strict-type-checked" come baseline rigorosa
//   - React Hooks rules (forza correttezza dei dependency array)
//   - React Refresh rules (compatibilità HMR Vite)
//   - Niente `eslint-config-react`: con React 18+ e JSX runtime automatico
//     molte regole legacy sono superflue e generano falsi positivi.
//
// Le regole più aggressive di "strict-type-checked" possono produrre
// rumore su codice esistente: ho disattivato manualmente quelle che a
// fronte di benefici marginali avrebbero richiesto ore di refactor in
// questa prima passata. Riattivarle gradualmente quando il codice viene
// toccato per altri motivi.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      '_legacy',
      'coverage',
      'tests/**',
      '**/*.config.{ts,js}',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  // strict-type-checked = recommended-type-checked + regole più severe.
  // Richiede `parserOptions.project` per accedere ai tipi a tempo di lint.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // ===== React Compiler rules (eslint-plugin-react-hooks v7) =====
      // Il plugin v7 attiva 5 regole che presuppongono l'uso del React
      // Compiler / pattern React 19 strict. Non adottiamo il Compiler:
      // queste regole producono falsi positivi su pattern legittimi e
      // ampiamente usati (es. react-hook-form `watch()`, setState dopo
      // fetch in useEffect). Riattivare se/quando il Compiler entra in
      // pipeline.
      'react-hooks/incompatible-library': 'off', // false-positive su react-hook-form watch()
      'react-hooks/set-state-in-effect': 'off', // pattern fetch-then-setState legittimo
      'react-hooks/static-components': 'off', // sub-view definite nel render (pattern legittimo senza Compiler)
      'react-hooks/use-memo': 'warn', // dep-list non-"simple": warn, non blocca
      'react-hooks/exhaustive-deps': 'warn', // dep-array: warn, non blocca
      'react-hooks/immutability': 'off', // gestita da TS readonly + convenzioni

      // ===== Port iniziale React: regole stilistiche a warn =====
      // Codebase migrata in blocco da vanilla-JS via agent: surfacing come
      // warning (lint gira con --max-warnings 9999) per pulizia incrementale,
      // coerente con l'approccio Cadenza ("riattivare quando si tocca il file").
      '@typescript-eslint/no-invalid-void-type': 'warn',
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',
      '@typescript-eslint/no-non-null-asserted-nullish-coalescing': 'warn',
      'react-hooks/purity': 'off', // useEffect è il posto per side-effects
      'react-hooks/preserve-manual-memoization': 'off', // useMemo/useCallback pattern manuali OK

      // ===== Allentamenti pragmatici =====
      // Il codice attuale usa pattern che strict-type-checked considera
      // problematici ma che sono comuni e leggibili. Documentiamo qui
      // perché vengono allentati.

      // Permettiamo `any` come escape hatch documentata: troppi false
      // positives su payload API loosely-typed e librerie senza .d.ts.
      // Quando si vuole forzare la typed-correctness, abilita 'error'.
      '@typescript-eslint/no-explicit-any': 'warn',

      // L'app usa tanti `unknown` parametri da fetch dinamici / serializers.
      // L'errore "no-unsafe-assignment/return/argument/member-access" è
      // tecnicamente corretto ma satura il segnale: warn invece di error.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',

      // `?? ''` dopo accessi a campi opzionali è esplicitamente desiderato:
      // strict-type-checked vorrebbe spostare il fallback nel tipo. Per
      // ora lasciamo lo stile attuale.
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/no-unnecessary-condition': 'warn',

      // Permette `_var` come prefisso per parametri intenzionalmente unused
      // (es. error handler che ignora err).
      // Port iniziale: unused vars/imports a warn (pulizia incrementale).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // i `restrict-template-expressions` con `${number}` è troppo zelante
      // per i nostri casi (es. `${user.id}` è spesso number).
      '@typescript-eslint/restrict-template-expressions': [
        'warn',
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],

      // Float promise: tipico in React (mutation.mutate() volutamente
      // fire-and-forget). 94 occorrenze nel codebase: warn invece di error.
      '@typescript-eslint/no-floating-promises': 'warn',

      // Async event handlers (onClick={async () => …}): React non aspetta
      // la promise comunque. Il tipo di onClick chiede void ma async ritorna
      // Promise. Pattern legittimo, downgrade a warn.
      '@typescript-eslint/no-misused-promises': [
        'warn',
        { checksVoidReturn: { attributes: false } },
      ],

      // `someVar!` (non-null assertion): usato dove TS non riesce a inferire
      // ma il programmatore sa per certo. Warn.
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // `() => doStuff()` quando doStuff ritorna void è leggibile e idiomatic.
      // strict-type-checked vorrebbe `() => { doStuff(); }`. Lascio passare.
      '@typescript-eslint/no-confusing-void-expression': ['warn', { ignoreArrowShorthand: true }],

      // Type assertion ridondante (es. `value as string` quando già è string).
      // Warn — utile saperlo ma non bloccare CI.
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',

      // `String()` o `Number()` su un valore già del tipo giusto. Cosmetico.
      '@typescript-eslint/no-unnecessary-type-conversion': 'warn',

      // Generic usato una sola volta nella signature: pignoleria di tipo,
      // non un bug. Warn.
      '@typescript-eslint/no-unnecessary-type-parameters': 'warn',

      // `${obj}` quando obj non ha toString custom: warn (il pattern è di
      // solito intenzionale per debug).
      '@typescript-eslint/no-base-to-string': 'warn',

      // `Cell` di recharts marcato deprecated nelle ultime versioni: warn,
      // gestibile in un PR dedicato.
      '@typescript-eslint/no-deprecated': 'warn',

      // Reject con stringa invece di Error: pattern legittimo per error
      // codes minimal. Warn.
      '@typescript-eslint/prefer-promise-reject-errors': 'warn',

      // `catch (e)` con `e: any` implicito: pignoleria, warn.
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'warn',
    },
  },
);
