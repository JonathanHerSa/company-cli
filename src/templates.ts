import crypto from 'crypto';
import { ResolvedDockerVersions } from './docker.js';

export interface ProjectOptions {
  projectName: string;
  githubOrg: string;
  services: ('back' | 'front' | 'mobile')[];
  backendOrm: 'typeorm' | 'prisma' | 'drizzle' | 'mongoose';
  frontendFramework: 'next' | 'vue';
  database: 'mysql' | 'postgres' | 'mongo' | 'none';
  databasePort?: string;
  databasePassword?: string;
  targetDir: string;
  dockerVersions?: ResolvedDockerVersions;
  jwtSecret?: string;
  jwtRefreshSecret?: string;
  mfaEncryptionKey?: string;
}

export function generateRandomSecrets() {
  return {
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    jwtRefreshSecret: crypto.randomBytes(32).toString('hex'),
    mfaEncryptionKey: crypto.randomBytes(32).toString('hex')
  };
}

export function getRootAgentsMd(opts: ProjectOptions): string {
  return `# Reglas para Agentes de IA — ${opts.projectName}_hub

Este archivo define las reglas obligatorias e institucionales para cualquier agente de IA que trabaje en este monorepo.

## Idioma y Comunicación

- La comunicación con el usuario y toda la documentación Markdown debe ser **siempre en español**.
- El código fuente, nombres de variables, tipos y comentarios de código deben ser **siempre en inglés**.
- Los mensajes de commit de Git deben ser **siempre en inglés** respetando [Conventional Commits](https://www.conventionalcommits.org/) (\`feat:\`, \`fix:\`, \`refactor:\`, \`docs:\`, \`test:\`).

## graphify (Grafo de Conocimiento)

- Este proyecto mantiene un grafo de conocimiento en \`graphify-out/\`.
- Tras **cualquier modificación de código**, es obligatorio ejecutar \`graphify update .\` para mantener el grafo actualizado.
- Para preguntas sobre la arquitectura y flujo del código, usa \`graphify query "<pregunta>"\` cuando exista \`graphify-out/graph.json\`.

## Impeccable Design System (.impeccable)

- Las guías visuales y tokens de diseño del proyecto se encuentran en \`.impeccable/design.json\`.
- Todo componente de frontend debe alinearse con la paleta de colores, escalas tipográficas y espaciados de \`.impeccable/design.json\` utilizando **shadcn/ui** y **Tailwind CSS**.

## Estructura del Hub

${opts.services.map(s => `- \`${s.charAt(0).toUpperCase() + s.slice(1)}/\` — ${
  s === 'back' ? `Backend en NestJS + ${opts.backendOrm.toUpperCase()} (${opts.database.toUpperCase()})` :
  s === 'front' ? `Frontend en ${opts.frontendFramework === 'next' ? 'Next.js (App Router)' : 'Vue.js 3 (Vite)'} + shadcn/ui + Tailwind CSS` :
  'Aplicación móvil en Flutter (Riverpod + Firebase)'
}`).join('\n')}

Antes de trabajar en un subproyecto, revisa también su \`AGENTS.md\` específico.

## Reglas Transversales de Arquitectura

- **No God Objects:** Ningún archivo de servicio, controlador o componente debe superar ~500 líneas. Si un módulo maneja múltiples responsabilidades, divídelo en servicios o archivos especializados.
- **Cero \`any\` / \`dynamic\`:** Usa tipos explícitos de TypeScript en todo el código.
- **Tipografía Homologada:** Todas las aplicaciones Web y Mobile deben usar estrictamente **Google Fonts** (Inter para sans-serif, Outfit para headers, JetBrains Mono para código/monospaced).
- **Seguridad y MFA:** MFA / 2FA (TOTP via \`otplib\`) es **MANDATORIO** para el rol \`SuperAdmin\`; opcional para el resto de los roles.
- **Documentación de API:** Usa decoradores de Swagger (\`@nestjs/swagger\`) para tipar endpoints y modelos DTO, y visualízalos mediante **Scalar** (\`@scalar/nestjs-api-reference\`).
- **Almacenamiento de Archivos (GCS):** Soporte unificado para Google Cloud Storage (\`@google-cloud/storage\`) y fallback local (\`STORAGE_PROVIDER=gcs|local\`).
- **Correo Electrónico (SMTP):** Integración mediante \`@nestjs/mailer\` y \`nodemailer\`.
- **Notificaciones Push (Firebase FCM):** Integración backend mediante \`firebase-admin\` y móvil mediante \`firebase_messaging\`.
- **Sembrado de Datos Demo (\`SEED_DEMO_DATA\`):** El ejecutor de semillas (\`seeders\`) únicamente debe ejecutarse cuando \`NODE_ENV === 'development'\`. Prohibido correr seeders en entorno de producción.
- **Prohibición de Polling para Tiempo Real:** Prohibido usar \`setInterval\` o timers periódicos para refrescar datos. Toda sincronización en tiempo real se realiza mediante eventos (WebSockets / Pusher).
- **Mapeos en lugar de Control de Flujo Anidado:** Prohibido usar cadenas anidadas de \`if/else\` con más de 2 niveles de profundidad. Usa objetos/mapas de TypeScript (\`Record<string, T>\`), patrones Strategy o cadenas limpias de predicados.
- **Migraciones de Base de Datos Obligatorias:** Tras cualquier modificación de entidades o esquemas (en bases relacionales), es strictly obligatorio crear la migración correspondiente para garantizar entornos de staging/producción estables.
- **Transacciones en Escrituras:** Todas las operaciones de mutación (\`CREATE\`, \`UPDATE\`, \`DELETE\`) deben ejecutarse dentro de transacciones de base de datos.
- **Variables de Entorno Centralizadas:** Prohibido acceder a \`process.env\` directamente en la lógica de negocio; utiliza el archivo de configuración central tipado.

## Calidad Mínima Obligatoria

Antes de entregar cualquier cambio como terminado, ejecuta el CI local del subproyecto modificado:

\`\`\`bash
npm run lint
npx tsc --noEmit
npm run test:ci
npm run build
\`\`\`

Si el CI resulta en rojo, corrige las fallas antes de reportar la tarea como completada.
`;
}

export function getRootClaudeMd(opts: ProjectOptions): string {
  return `# Guía de Desarrollo — ${opts.projectName}_hub

## Comandos Principales

- **Levantar entorno local completo (Docker Compose):**
  \`\`\`bash
  docker compose -f compose.dev.yml up --build
  \`\`\`

- **Actualizar Grafo de Conocimiento (graphify):**
  \`\`\`bash
  graphify update .
  \`\`\`

- **Subproyectos disponibles:**
${opts.services.map(s => `  - \`cd ${s.charAt(0).toUpperCase() + s.slice(1)}\``).join('\n')}

## Convenciones de Desarrollo

- Respeta las reglas definidas en \`AGENTS.md\`.
- Revisa las guías de UI en \`.impeccable/design.json\`.
- Realiza commits atómicos utilizando Conventional Commits.
- Asegúrate de tener los servicios levantados vía Docker para pruebas integradas.
`;
}

export function getImpeccableDesignJson(opts: ProjectOptions): string {
  return JSON.stringify({
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    title: `Design System: ${opts.projectName}`,
    extensions: {
      colorMeta: {
        primary: {
          role: "primary",
          displayName: "Brand Primary",
          canonical: "#0f172a"
        },
        accent: {
          role: "accent",
          displayName: "Brand Accent",
          canonical: "#2563eb"
        }
      },
      typography: {
        fontSans: "Inter, sans-serif",
        fontHeading: "Outfit, sans-serif",
        fontMono: "JetBrains Mono, monospace"
      }
    }
  }, null, 2);
}

export function getRootGitignore(): string {
  return `# OS
.DS_Store
Thumbs.db

# Environment variables & local secrets
.env
.env.local
.env.production.local
*.local

# Logs and temp files
*.log
.tmp/
.temp/
`;
}

export function getBackGitignore(): string {
  return `# Dependencies
/node_modules

# Build outputs
/dist
/build

# Logs
logs
*.log

# OS & IDEs
.DS_Store
.vscode/*
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json

# Environment variables
.env
.env.development.local
.env.test.local
.env.production.local
.env.local

# Storage & credentials
storage-credentials.json
/uploads
/uploads/

# Coverage & cache
/coverage
*.tsbuildinfo
.ci-local/
`;
}

export function getFrontGitignore(): string {
  return `# Dependencies
/node_modules
/.pnp
.pnp.*

# Build outputs
/.next/
/out/
/dist
/build

# Logs
logs
*.log
npm-debug.log*

# OS & IDEs
.DS_Store
.vscode/*
!.vscode/settings.json

# Environment variables
.env
.env.local
.env.production.local

# Coverage & cache
/coverage
*.tsbuildinfo
.ci-local/
`;
}

export function getMobileGitignore(): string {
  return `# Flutter / Dart build outputs and dependencies
.dart_tool/
.flutter-plugins
.flutter-plugins-dependencies
.packages
build/
.pub/
.pub-cache/

# OS & IDEs
.DS_Store
.vscode/
.idea/

# Environment variables & credentials
.env
*.log
google-services.json
GoogleService-Info.plist
`;
}

// Sub-repo Environment Templates (.env and .env.template)
export function getBackEnvTemplate(opts: ProjectOptions): string {
  const dbPort = opts.databasePort || (opts.database === 'mysql' ? '3306' : opts.database === 'postgres' ? '5432' : opts.database === 'mongo' ? '27017' : '3000');
  const dbPassword = opts.databasePassword || 'devpassword';
  const secrets = generateRandomSecrets();
  const jwtSecret = opts.jwtSecret || secrets.jwtSecret;
  const jwtRefreshSecret = opts.jwtRefreshSecret || secrets.jwtRefreshSecret;
  const mfaKey = opts.mfaEncryptionKey || secrets.mfaEncryptionKey;

  const hasMobile = opts.services.includes('mobile');

  return `PORT=3000
API_PREFIX=api/v1
CORS_ORIGIN=http://localhost:3001

# Database
DB_HOST=localhost
DB_PORT=${dbPort}
DB_USERNAME=root
DB_PASSWORD=${dbPassword}
DB_DATABASE=${opts.projectName.toLowerCase()}_db
DB_SYNCHRONIZE=true
DB_MIGRATIONS_RUN=false
DB_POOL_SIZE=30

# JWT and Security (Autogenerados)
JWT_SECRET=${jwtSecret}
JWT_EXPIRES_IN=2h
JWT_REFRESH_SECRET=${jwtRefreshSecret}

# MFA (TOTP - AES-256 hex de 32 bytes autogenerada)
MFA_ENCRYPTION_KEY=${mfaKey}

# Mail (SMTP)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=${opts.projectName} <dev@company.com>

# Storage (GCS | local)
STORAGE_PROVIDER=local
GCS_PROJECT_ID=your-gcp-project-id
GCS_BUCKET_NAME=your-gcs-bucket
GCS_KEY_FILENAME=

# Demo Data Seed (Ejecutar ÚNICAMENTE en NODE_ENV=development)
SEED_DEMO_DATA=true

# Bootstrap SuperAdmin
BOOTSTRAP_SUPER_ADMIN_EMAIL=admin@company.com
BOOTSTRAP_SUPER_ADMIN_NAME=Super Admin
BOOTSTRAP_SUPER_ADMIN_PASSWORD=adminpassword123

# Realtime (Pusher)
PUSHER_APP_ID=
PUSHER_KEY=
PUSHER_SECRET=
PUSHER_CLUSTER=us2
${hasMobile ? `\n# Firebase Cloud Messaging (FCM Mobile Push)\nFIREBASE_PROJECT_ID=\nFIREBASE_CLIENT_EMAIL=\nFIREBASE_PRIVATE_KEY=\n` : ''}
# Redis & Queues (BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_PREFIX=dev:
`;
}

export function getFrontEnvTemplate(opts: ProjectOptions): string {
  return `# API
NEXT_PUBLIC_API_URL=/api
INTERNAL_API_URL=http://127.0.0.1:3000

# Realtime (Pusher)
NEXT_PUBLIC_PUSHER_KEY=
NEXT_PUBLIC_PUSHER_CLUSTER=us2

# SEO & Public Domain
NEXT_PUBLIC_SITE_URL=http://localhost:3001

# Google Maps (opcional)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
`;
}

export function getMobileEnvTemplate(opts: ProjectOptions): string {
  return `# API Target
API_BASE_URL=http://localhost:3000/api

# Pusher Realtime
PUSHER_KEY=
PUSHER_CLUSTER=us2
`;
}

export function getBackStandaloneComposeYml(opts: ProjectOptions): string {
  const versions = opts.dockerVersions || {
    mysql: '9.7',
    postgres: '18.2-alpine',
    mongo: '8.3',
    node: '22-alpine',
    redis: '7-alpine',
    nginx: '1.27-alpine'
  };

  const dbPort = opts.databasePort || (opts.database === 'mysql' ? '3306' : opts.database === 'postgres' ? '5432' : opts.database === 'mongo' ? '27017' : '3000');
  const dbPassword = opts.databasePassword || 'devpassword';

  let dbServiceSnippet = '';
  let dbDependsOnName = '';
  let dbVolumesSnippet = '';

  if (opts.database === 'mysql') {
    dbDependsOnName = 'mysql';
    dbVolumesSnippet = '  mysqldata:\n';
    dbServiceSnippet = `  mysql:
    image: mysql:${versions.mysql}
    environment:
      MYSQL_ROOT_PASSWORD: ${dbPassword}
      MYSQL_DATABASE: ${opts.projectName.toLowerCase()}_db
    command: --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci
    ports:
      - "${dbPort}:3306"
    volumes:
      - mysqldata:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-p${dbPassword}"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped`;
  } else if (opts.database === 'postgres') {
    dbDependsOnName = 'postgres';
    dbVolumesSnippet = '  postgresdata:\n';
    dbServiceSnippet = `  postgres:
    image: postgres:${versions.postgres}
    environment:
      POSTGRES_USER: root
      POSTGRES_PASSWORD: ${dbPassword}
      POSTGRES_DB: ${opts.projectName.toLowerCase()}_db
    ports:
      - "${dbPort}:5432"
    volumes:
      - postgresdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U root -d ${opts.projectName.toLowerCase()}_db"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped`;
  } else if (opts.database === 'mongo') {
    dbDependsOnName = 'mongo';
    dbVolumesSnippet = '  mongodata:\n';
    dbServiceSnippet = `  mongo:
    image: mongo:${versions.mongo}
    environment:
      MONGO_INITDB_ROOT_USERNAME: root
      MONGO_INITDB_ROOT_PASSWORD: ${dbPassword}
      MONGO_INITDB_DATABASE: ${opts.projectName.toLowerCase()}_db
    ports:
      - "${dbPort}:27017"
    volumes:
      - mongodata:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped`;
  }

  const backDbDepends = dbDependsOnName ? `      ${dbDependsOnName}:\n        condition: service_healthy\n` : '';

  return `name: ${opts.projectName.toLowerCase()}-back-dev

services:
  back:
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    env_file:
      - ./.env
    environment:
      PORT: 3000
      DB_HOST: ${dbDependsOnName || 'localhost'}
      DB_PORT: ${dbPort}
      DB_USERNAME: root
      DB_PASSWORD: ${dbPassword}
      DB_DATABASE: ${opts.projectName.toLowerCase()}_db
      REDIS_HOST: redis
      REDIS_PORT: 6379
    ports:
      - "3000:3000"
    volumes:
      - ./:/app
      - back_node_modules:/app/node_modules
    depends_on:
${backDbDepends}      redis:
        condition: service_healthy
    restart: unless-stopped

${dbServiceSnippet ? dbServiceSnippet + '\n\n' : ''}  redis:
    image: redis:${versions.redis}
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

volumes:
  back_node_modules:
${dbVolumesSnippet}  redisdata:
`;
}

export function getFrontStandaloneComposeYml(opts: ProjectOptions): string {
  return `name: ${opts.projectName.toLowerCase()}-front-dev

services:
  front:
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    env_file:
      - ./.env
    environment:
      NODE_ENV: development
      NEXT_PUBLIC_API_URL: http://127.0.0.1:3000/api
      INTERNAL_API_URL: http://127.0.0.1:3000
    ports:
      - "3001:3000"
    volumes:
      - ./:/app
      - front_node_modules:/app/node_modules
    command: npm run dev
    restart: unless-stopped

volumes:
  front_node_modules:
`;
}

export function getPrettierRc(): string {
  return JSON.stringify({
    printWidth: 120,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: true,
    quoteProps: "as-needed",
    trailingComma: "all",
    bracketSpacing: true,
    bracketSameLine: false,
    jsxSingleQuote: false,
    arrowParens: "always",
    endOfLine: "auto"
  }, null, 2);
}

export function getPrettierIgnore(): string {
  return `node_modules
dist
.next
build
coverage
graphify-out
*.min.js
*.min.css
.cache
package-lock.json
pnpm-lock.yaml
yarn.lock
`;
}

// Exact radar_hub Backend ESLint configuration (eslint.config.mjs)
export function getBackEslintConfigMjs(): string {
  return `import { createRequire } from 'node:module';

const require = createRequire(\`\${process.cwd()}/package.json\`);

const eslint = require('@eslint/js');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');
const globals = require('globals');
const tseslint = require('typescript-eslint');
const simpleImportSort = require('eslint-plugin-simple-import-sort');
const unusedImports = require('eslint-plugin-unused-imports');

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'check-docs.js', 'dist/**', 'node_modules/**', 'coverage/**', 'test/__mocks__/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    plugins: {
      'unused-imports': unusedImports,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^\\\\u0000'],
            ['^node:'],
            ['^@?\\\\w'],
            ['^src(/.*)?$'],
            ['^\\\\.\\\\.(?!/?$)', '^\\\\.\\\\./?$'],
            ['^\\\\./(?=.*/)(?!/?$)', '^\\\\.(?!/?$)', '^\\\\./?$'],
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
      'prefer-const': 'error',
      eqeqeq: 'error',
      yoda: 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-return-await': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variableLike',
          format: ['camelCase', 'PascalCase', 'snake_case', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        { selector: 'typeLike', format: ['PascalCase'] },
        {
          selector: 'property',
          format: ['camelCase', 'PascalCase', 'snake_case'],
          leadingUnderscore: 'allow',
          filter: { regex: '(@|\\\\/)', match: false },
        },
        {
          selector: 'classProperty',
          modifiers: ['static'],
          format: ['UPPER_CASE', 'camelCase', 'PascalCase'],
        },
      ],
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: [
      'test/**/*.ts',
      'scripts/**/*.ts',
      'src/scripts/**/*.ts',
      'src/database/**/*.ts',
      'src/modules/seed/**/*.ts',
      '**/*.spec.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/naming-convention': 'off',
      'no-console': 'off',
    },
  },
  eslintPluginPrettierRecommended,
);
`;
}

// Exact radar_hub Frontend ESLint configuration (eslint.config.mjs)
export function getFrontEslintConfigMjs(): string {
  return `import { createRequire } from 'node:module';

const require = createRequire(\`\${process.cwd()}/package.json\`);

const { defineConfig, globalIgnores } = require('eslint/config');
const nextVitals = require('eslint-config-next/core-web-vitals');
const nextTs = require('eslint-config-next/typescript');
const unusedImports = require('eslint-plugin-unused-imports');

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    name: 'app/files-to-lint',
    files: ['**/*.{js,jsx,ts,tsx}'],
  },
  globalIgnores([
    '.next/**',
    '.next-ci/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    '**/dist/**',
    '**/dist-ssr/**',
    '**/coverage/**',
    '**/*.log',
    'eslint.config.{js,ts,cjs,mjs}',
  ]),
  {
    name: 'app/unused-imports',
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      'unused-imports/no-unused-imports': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: ['objectLiteralProperty', 'typeProperty'],
          modifiers: ['requiresQuotes'],
          format: null,
        },
        {
          selector: 'variableLike',
          format: ['camelCase', 'PascalCase', 'snake_case', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'property',
          format: ['camelCase', 'PascalCase', 'snake_case', 'UPPER_CASE'],
          leadingUnderscore: 'allowDouble',
          trailingUnderscore: 'allowDouble',
        },
      ],
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
]);

export default eslintConfig;
`;
}

// Next.js config matching radar_hub
export function getNextConfigTs(): string {
  return `import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@base-ui/react"],
  allowedDevOrigins: ["127.0.0.1", "localhost", "127.0.0.1:3001", "localhost:3001"],
  turbopack: {
    root: __dirname === "/app" ? __dirname : path.resolve(__dirname, ".."),
  },
  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    const headersList = [
      {
        source: "/:path*.svg",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/:path*.pdf",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/portal",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/portal/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];

    if (!isDev) {
      headersList.push({
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      });
    }

    return headersList;
  },
};

export default nextConfig;
`;
}

// PostCSS config matching radar_hub
export function getPostcssConfigMjs(): string {
  return `const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
`;
}

// components.json matching radar_hub (shadcn/ui config)
export function getShadcnComponentsJson(): string {
  return JSON.stringify({
    "$schema": "https://ui.shadcn.com/schema.json",
    "style": "base-nova",
    "rsc": true,
    "tsx": true,
    "tailwind": {
      "config": "",
      "css": "src/app/globals.css",
      "baseColor": "neutral",
      "cssVariables": true,
      "prefix": ""
    },
    "iconLibrary": "lucide",
    "rtl": false,
    "aliases": {
      "components": "@/components",
      "utils": "@/lib/utils",
      "ui": "@/components/ui",
      "lib": "@/lib",
      "hooks": "@/hooks"
    },
    "menuColor": "default",
    "menuAccent": "subtle",
    "registries": {}
  }, null, 2);
}

// lib/utils.ts matching radar_hub
export function getLibUtilsTs(): string {
  return `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;
}

export function getFlutterAnalysisOptions(): string {
  return `include: package:flutter_lints/flutter.yaml

analyzer:
  exclude:
    - build/**

linter:
  rules:
    avoid_print: true
    prefer_single_quotes: true
    always_declare_return_types: true
    always_use_package_imports: true
    avoid_unnecessary_containers: true
    directives_ordering: true
    use_build_context_synchronously: true
    unawaited_futures: true
    cancel_subscriptions: true
    prefer_final_locals: true
`;
}

export function getEditorConfig(): string {
  return `root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
`;
}

export function getComposeDevYml(opts: ProjectOptions): string {
  const versions = opts.dockerVersions || {
    mysql: '9.7',
    postgres: '18.2-alpine',
    mongo: '8.3',
    node: '22-alpine',
    redis: '7-alpine',
    nginx: '1.27-alpine'
  };

  const dbPort = opts.databasePort || (opts.database === 'mysql' ? '3306' : opts.database === 'postgres' ? '5432' : opts.database === 'mongo' ? '27017' : '3000');
  const dbPassword = opts.databasePassword || 'devpassword';

  let dbServiceSnippet = '';
  let dbDependsOnName = '';
  let dbVolumesSnippet = '';

  if (opts.database === 'mysql') {
    dbDependsOnName = 'mysql';
    dbVolumesSnippet = '  mysqldata:\n';
    dbServiceSnippet = `  mysql:
    image: mysql:${versions.mysql}
    environment:
      MYSQL_ROOT_PASSWORD: ${dbPassword}
      MYSQL_DATABASE: ${opts.projectName.toLowerCase()}_db
    command: --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci
    ports:
      - "${dbPort}:3306"
    volumes:
      - mysqldata:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-p${dbPassword}"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped`;
  } else if (opts.database === 'postgres') {
    dbDependsOnName = 'postgres';
    dbVolumesSnippet = '  postgresdata:\n';
    dbServiceSnippet = `  postgres:
    image: postgres:${versions.postgres}
    environment:
      POSTGRES_USER: root
      POSTGRES_PASSWORD: ${dbPassword}
      POSTGRES_DB: ${opts.projectName.toLowerCase()}_db
    ports:
      - "${dbPort}:5432"
    volumes:
      - postgresdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U root -d ${opts.projectName.toLowerCase()}_db"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped`;
  } else if (opts.database === 'mongo') {
    dbDependsOnName = 'mongo';
    dbVolumesSnippet = '  mongodata:\n';
    dbServiceSnippet = `  mongo:
    image: mongo:${versions.mongo}
    environment:
      MONGO_INITDB_ROOT_USERNAME: root
      MONGO_INITDB_ROOT_PASSWORD: ${dbPassword}
      MONGO_INITDB_DATABASE: ${opts.projectName.toLowerCase()}_db
    ports:
      - "${dbPort}:27017"
    volumes:
      - mongodata:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped`;
  }

  const backDbDepends = dbDependsOnName ? `      ${dbDependsOnName}:\n        condition: service_healthy\n` : '';

  return `name: ${opts.projectName.toLowerCase()}-dev

services:
  nginx:
    image: nginx:${versions.nginx}
    ports:
      - "3001:80"
    volumes:
      - ./nginx/default.dev.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - front
      - back
    restart: unless-stopped

  front:
    build:
      context: ./Front
      dockerfile: Dockerfile
      target: development
    environment:
      NODE_ENV: development
      NEXT_PUBLIC_API_URL: /api
      INTERNAL_API_URL: http://back:3000
    volumes:
      - ./Front:/app
      - front_node_modules:/app/node_modules
    command: npm run dev
    depends_on:
      - back
    restart: unless-stopped

  back:
    build:
      context: ./Back
      dockerfile: Dockerfile
      target: development
    environment:
      PORT: 3000
      DB_HOST: ${dbDependsOnName || 'localhost'}
      DB_PORT: ${dbPort}
      DB_USERNAME: root
      DB_PASSWORD: ${dbPassword}
      DB_DATABASE: ${opts.projectName.toLowerCase()}_db
    ports:
      - "3000:3000"
    volumes:
      - ./Back:/app
      - back_node_modules:/app/node_modules
    command: npm run start:dev
    depends_on:
${backDbDepends}      redis:
        condition: service_healthy
    restart: unless-stopped

${dbServiceSnippet ? dbServiceSnippet + '\n\n' : ''}  redis:
    image: redis:${versions.redis}
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

volumes:
  back_node_modules:
  front_node_modules:
${dbVolumesSnippet}  redisdata:
`;
}

export function getNginxConf(): string {
  return `server {
    listen 80;

    location /api/ {
        proxy_pass http://back:3000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        proxy_pass http://front:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
}

export function getBackCiWorkflow(): string {
  return `name: Backend CI

on:
  pull_request:
  push:
    branches: [main, staging]

concurrency:
  group: ci-back-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  backend-test:
    name: Lint · Typecheck · Test · Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'
          cache: npm
      - run: npm ci
      - name: Lint
        run: npm run lint
      - name: Typecheck
        run: npx tsc --noEmit
      - name: Unit tests
        run: npm run test:ci || true
      - name: Build
        run: npm run build
`;
}

export function getFrontCiWorkflow(): string {
  return `name: Frontend CI

on:
  pull_request:
  push:
    branches: [main, staging]

concurrency:
  group: ci-front-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  frontend-test:
    name: Lint · Typecheck · Test · Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'
          cache: npm
      - run: npm ci
      - name: Lint
        run: npm run lint
      - name: Typecheck
        run: npx tsc --noEmit
      - name: Build
        run: npm run build
`;
}

export function getBackAgentsMd(opts: ProjectOptions): string {
  return `# AI Agent Rules (Backend NestJS + ${opts.backendOrm.toUpperCase()})

This file defines mandatory rules for AI agents working on the Backend service.

## Architecture & Security Rules

- Framework: **NestJS** (Modular Monolith)
- Database: **${opts.database.toUpperCase()}**
- ORM / ODM: **${opts.backendOrm.toUpperCase()}**
- Authentication: **JWT** (\`@nestjs/jwt\` + \`passport-jwt\`)
- MFA / 2FA Security: **MANDATORY for SuperAdmin role** (via \`otplib\`); optional for other roles.
- Documentation: Use **Swagger decorators** (\`@nestjs/swagger\`) on controllers/DTOs, and render via **Scalar API Reference** (\`@scalar/nestjs-api-reference\`).
- Storage: **Google Cloud Storage** (\`@google-cloud/storage\`) + local fallback.
- Mail: **SMTP** (\`@nestjs/mailer\` + \`nodemailer\`).
- Realtime: **Pusher** (\`pusher\`)
- Queues: **BullMQ** (\`@nestjs/bullmq\`) + **Redis**
- Demo Data Seeding: \`SEED_DEMO_DATA\` flag must strictly run ONLY when \`NODE_ENV === 'development'\`.
- Direct cross-domain module coupling is strictly forbidden.
- Avoid \`forwardRef\`; refactor module boundaries, orchestrators, or event emitters instead.
- All write operations (CREATE, UPDATE, DELETE) MUST run within a database transaction.
- Database Entities MUST inherit from \`BaseEntity\` (UUID v7 + \`deletedAt\` timestamp).
- Database migrations are MANDATORY for every entity/schema modification.
- Service Size Limit: Max ~500 lines per service file.

## Control Flow Rules

- Use \`RECORD_LOOKUP\` maps instead of Stringly-Typed \`if/else\` chains.
- Maximum \`if\` nesting depth is **2 levels**. Extract deeper branches to pure helper functions.

## Quality & Tests

- Always run \`npm run lint\` and \`npx tsc --noEmit\` before declaring a task finished.
- Ensure all environment variables are declared in \`src/config/envs.ts\`.
`;
}

export function getFrontAgentsMd(opts: ProjectOptions): string {
  return `# AI Agent Rules (Frontend ${opts.frontendFramework === 'next' ? 'Next.js' : 'Vue.js 3'})

This file defines mandatory rules for AI agents working on the Frontend service.

## Architecture Rules

- Framework: **${opts.frontendFramework === 'next' ? 'Next.js (App Router)' : 'Vue.js 3 + Vite'}**
- UI Design System: **shadcn/ui** components + **Lucide React** + **Tailwind CSS v4**.
- Design Tokens: Follow \`.impeccable/design.json\`.
- Typography Standard: Mandatory use of **Google Fonts** (\`Inter\` for main UI, \`Outfit\` for headers, \`JetBrains Mono\` for monospace/code).
- Charts & Visualization: **AmCharts 5** (\`@amcharts/amcharts5\`)
- Realtime: **Pusher JS** (\`pusher-js\`)
- Styling Utilities: \`clsx\`, \`tailwind-merge\`, \`class-variance-authority\`, \`sonner\`
- Do not make direct blocking HTTP requests inside UI rendering loops.
- Use explicit TypeScript interfaces for all component props and state models.
- Avoid inline \`any\` casting.

## Quality & Tests

- Run \`npm run lint\` and \`npx tsc --noEmit\` before delivering any code changes.
`;
}

export function getMobileAgentsMd(): string {
  return `# AI Agent Rules (Mobile Flutter)

This file defines mandatory rules for AI agents working on the Mobile Flutter app.

## Architecture Rules

- Framework: **Flutter / Dart**
- State Management: **Riverpod** (\`flutter_riverpod\`)
- Realtime: **Pusher Channels** (\`pusher_channels_flutter\`)
- Push Notifications: **Firebase Cloud Messaging** (\`firebase_messaging\` + \`flutter_local_notifications\`)
- Typography Standard: Mandatory use of **Google Fonts** (\`google_fonts\` package, e.g. Inter / Outfit).
- Local Storage & Security: **Hive** (\`hive_flutter\`) + **Flutter Secure Storage** (\`flutter_secure_storage\`)
- Clean Architecture (UI -> Logic -> Data Layer).
- Always enforce strict null safety.
- Run \`flutter analyze\` and \`flutter test\` before completing tasks.
`;
}

export function getBackDockerfile(opts?: ProjectOptions): string {
  const nodeTag = opts?.dockerVersions?.node || '22-alpine';
  return `FROM node:${nodeTag} AS development
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

FROM node:${nodeTag} AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:${nodeTag} AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
`;
}

export function getFrontDockerfile(opts?: ProjectOptions): string {
  const nodeTag = opts?.dockerVersions?.node || '22-alpine';
  const nginxTag = opts?.dockerVersions?.nginx || '1.27-alpine';
  return `FROM node:${nodeTag} AS development
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM node:${nodeTag} AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:${nginxTag} AS production
COPY --from=builder /app/out /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
}

export function getMobilePubspec(opts: ProjectOptions): string {
  return `name: mobile_${opts.projectName.toLowerCase()}
description: "Aplicación móvil oficial de ${opts.projectName}"
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ^3.12.0

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8
  flutter_riverpod: ^3.0.0
  google_fonts: ^8.1.0
  http: ^1.6.0
  flutter_svg: ^2.0.10
  hive: ^2.2.3
  hive_flutter: ^1.1.0
  flutter_secure_storage: ^10.3.1
  pusher_channels_flutter: ^2.6.0
  firebase_core: ^3.10.0
  firebase_messaging: ^15.2.0
  flutter_local_notifications: ^18.0.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^6.0.0

flutter:
  uses-material-design: true
`;
}

// Full NestJS Starter Source Templates
export function getNestMainTs(): string {
  return `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('API Reference')
    .setDescription('Institutional API Documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
    
  const document = SwaggerModule.createDocument(app, config);
  
  app.use(
    '/reference',
    apiReference({
      spec: { content: document },
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(\`Backend service running on port \${port}\`);
}
bootstrap();
`;
}

export function getNestAppModuleTs(): string {
  return `import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
`;
}

export function getTsConfigBuild(): string {
  return JSON.stringify({
    extends: "./tsconfig.json",
    exclude: ["node_modules", "test", "dist", "**/*spec.ts"]
  }, null, 2);
}

export function getNestTsConfig(): string {
  return JSON.stringify({
    compilerOptions: {
      module: "commonjs",
      declaration: true,
      removeComments: true,
      emitDecoratorMetadata: true,
      experimentalDecorators: true,
      allowSyntheticDefaultImports: true,
      target: "ES2021",
      sourceMap: true,
      outDir: "./dist",
      baseUrl: "./",
      incremental: true,
      skipLibCheck: true,
      strictNullChecks: false,
      noImplicitAny: false,
      strictBindCallApply: false,
      forceConsistentCasingInFileNames: false,
      noFallthroughCasesInSwitch: false,
      paths: {
        "@/*": ["src/*"]
      }
    }
  }, null, 2);
}

export function getNestCliJson(): string {
  return JSON.stringify({
    $schema: "https://json.schemastore.org/nest-cli",
    collection: "@nestjs/schematics",
    sourceRoot: "src",
    compilerOptions: {
      deleteOutDir: true
    }
  }, null, 2);
}

// Next.js App Router Starter Source Templates
export function getNextPageTsx(opts: ProjectOptions): string {
  return `export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-8">
      <h1 className="text-4xl font-bold font-heading mb-4">
        ${opts.projectName} — Frontend
      </h1>
      <p className="text-slate-400 max-w-md text-center mb-6 font-sans">
        Aplicación Frontend inicializada con Next.js (App Router), Tailwind CSS v4, shadcn/ui y Google Fonts.
      </p>
    </main>
  );
}
`;
}

export function getNextLayoutTsx(opts: ProjectOptions): string {
  return `import type { Metadata } from 'next';
import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';
import '@fontsource/outfit/700.css';
import '@fontsource/jetbrains-mono/400.css';
import './globals.css';

export const metadata: Metadata = {
  title: '${opts.projectName} — App',
  description: 'Frontend institucional para ${opts.projectName}',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="antialiased bg-background text-foreground">{children}</body>
    </html>
  );
}
`;
}

export function getNextGlobalsCss(): string {
  return `@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  color-scheme: dark;
  --font-radar-sans: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-radar-heading: Outfit, ui-sans-serif, system-ui, sans-serif;
  --font-radar-mono: "JetBrains Mono", monospace;
  --background: #0c0c0e;
  --foreground: #ffffff;
  --card: #141418;
  --card-foreground: #ffffff;
  --popover: #141418;
  --popover-foreground: #ffffff;
  --primary: #2563eb;
  --primary-foreground: #ffffff;
  --secondary: #1c1c22;
  --secondary-foreground: #ffffff;
  --muted: #141418;
  --muted-foreground: #8f9bb3;
  --accent: #2563eb;
  --accent-foreground: #ffffff;
  --destructive: #dc2626;
  --destructive-foreground: #ffffff;
  --border: rgba(255, 255, 255, 0.1);
  --input: rgba(255, 255, 255, 0.15);
  --ring: #2563eb;
  --radius: 0.5rem;
}

body {
  font-family: var(--font-radar-sans);
}
`;
}

export function getNextTsConfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: "ES2017",
      lib: ["dom", "dom.iterable", "esnext"],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: "esnext",
      moduleResolution: "bundler",
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: "preserve",
      incremental: true,
      plugins: [{ name: "next" }],
      paths: {
        "@/*": ["./src/*"]
      }
    },
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    exclude: ["node_modules"]
  }, null, 2);
}

// Vue 3 + Vite Starter Source Templates
export function getVueAppVue(opts: ProjectOptions): string {
  return `<template>
  <main className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-8">
    <h1 className="text-4xl font-bold font-heading mb-4">${opts.projectName} — Vue 3 App</h1>
    <p className="text-slate-400 max-w-md text-center mb-6 font-sans">
      Aplicación Frontend inicializada con Vue 3, Vite, Tailwind CSS y Google Fonts.
    </p>
  </main>
</template>

<script setup lang="ts">
</script>
`;
}

export function getVueMainTs(): string {
  return `import { createApp } from 'vue';
import App from './App.vue';
import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';
import '@fontsource/outfit/700.css';
import '@fontsource/jetbrains-mono/400.css';
import './style.css';

createApp(App).mount('#app');
`;
}

export function getViteConfigTs(): string {
  return `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
`;
}
