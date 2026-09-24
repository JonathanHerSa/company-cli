import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import * as templates from './templates.js';
import { createRemoteRepo } from './github.js';
import { downloadOnlineSkill } from './skills.js';
import { resolveAllDockerVersions } from './docker.js';
import * as deploy from './deploy.js';

export interface GenerationResult {
  hubPath: string;
  createdRepos: { name: string; cloneUrl?: string; localPath: string }[];
  errors: string[];
  installedDependencies: string[];
}

export async function generateHubProject(
  opts: templates.ProjectOptions,
  token?: string,
  onProgress?: (message: string) => void
): Promise<GenerationResult> {
  const result: GenerationResult = {
    hubPath: '',
    createdRepos: [],
    errors: [],
    installedDependencies: []
  };

  const hubDirName = `${opts.projectName.toLowerCase()}_hub`;
  const hubPath = path.join(opts.targetDir, hubDirName);
  result.hubPath = hubPath;

  await fs.ensureDir(hubPath);

  // 0. Resolve Latest Docker Image Tags from Docker Hub API dynamically
  onProgress?.('Consultando versiones más recientes de imágenes Docker en Docker Hub...');
  const dockerVersions = await resolveAllDockerVersions();
  opts.dockerVersions = dockerVersions;

  // 1. Write Root Files (Hub root is purely a parent repo container with NO package.json)
  onProgress?.('Escribiendo archivos de configuración global del Hub...');
  await fs.writeFile(path.join(hubPath, 'AGENTS.md'), templates.getRootAgentsMd(opts));
  await fs.writeFile(path.join(hubPath, 'CLAUDE.md'), templates.getRootClaudeMd(opts));
  await fs.writeFile(path.join(hubPath, '.gitignore'), templates.getRootGitignore());
  await fs.writeFile(path.join(hubPath, '.prettierrc'), templates.getPrettierRc());
  await fs.writeFile(path.join(hubPath, '.prettierignore'), templates.getPrettierIgnore());
  await fs.writeFile(path.join(hubPath, '.editorconfig'), templates.getEditorConfig());
  await fs.writeFile(path.join(hubPath, 'compose.dev.yml'), templates.getComposeDevYml(opts));

  // Despliegue a Google Cloud Run + Cloud Build: definición del entorno (sin secretos) y guía. Ver src/deploy.ts.
  if (opts.cloudRun !== false) {
    onProgress?.('Escribiendo la definición de despliegue (deploy/staging.env y docs/deploy.md)...');
    await deploy.writeHubCloudRun(hubPath, opts);
  }

  // 2. Download and Install Hub-Level Skills (.agents/skills/) online
  onProgress?.('Descargando últimas versiones en línea de skills (graphify e impeccable)...');
  const hubSkillsDir = path.join(hubPath, '.agents', 'skills');
  await fs.ensureDir(hubSkillsDir);

  const graphifyDest = path.join(hubSkillsDir, 'graphify');
  const impeccableDest = path.join(hubSkillsDir, 'impeccable');

  await downloadOnlineSkill('graphify', graphifyDest);
  await downloadOnlineSkill('impeccable', impeccableDest);

  // Create graphify-out directory
  const graphifyDir = path.join(hubPath, 'graphify-out');
  await fs.ensureDir(graphifyDir);
  await fs.writeFile(
    path.join(graphifyDir, 'README.md'),
    `# Graphify Knowledge Graph\n\nEste directorio almacena el grafo de conocimiento del código generado por graphify.\nEjecuta \`graphify update .\` para actualizar el grafo tras modificar código.\n`
  );

  // Create .impeccable directory
  const impeccableDir = path.join(hubPath, '.impeccable');
  await fs.ensureDir(impeccableDir);
  await fs.writeFile(path.join(impeccableDir, 'design.json'), templates.getImpeccableDesignJson(opts));

  // Write Nginx dir
  const nginxDir = path.join(hubPath, 'nginx');
  await fs.ensureDir(nginxDir);
  await fs.writeFile(path.join(nginxDir, 'default.dev.conf'), templates.getNginxConf());

  // Initialize Root Git
  try {
    await execa('git', ['init'], { cwd: hubPath });
  } catch (err: any) {
    result.errors.push(`Git init root failed: ${err.message}`);
  }

  // Create GitHub Hub Repo if org/user is specified
  let hubRemoteUrl = '';
  if (opts.githubOrg) {
    onProgress?.(`Creando repositorio remoto ${opts.projectName.toLowerCase()}_hub en GitHub (${opts.githubOrg})...`);
    const hubRepoName = `${opts.projectName.toLowerCase()}_hub`;
    const res = await createRemoteRepo(opts.githubOrg, hubRepoName, token);
    if (res.success) {
      hubRemoteUrl = res.cloneUrl;
      result.createdRepos.push({ name: hubRepoName, cloneUrl: res.cloneUrl, localPath: hubPath });
      try {
        await execa('git', ['remote', 'add', 'origin', res.cloneUrl], { cwd: hubPath });
      } catch {}
    } else if (res.error) {
      result.errors.push(`Could not create GitHub repo ${hubRepoName}: ${res.error}`);
    }
  }

  // Gitmodules content building
  let gitmodulesContent = '';

  const hasMobile = opts.services.includes('mobile');

  // 3. Generate Sub-Projects with dynamic latest dependencies, locked Docker tags, standalone compose.dev.yml & .env/.env.template
  for (const service of opts.services) {
    const serviceFolderName = service === 'back' ? 'Back' : service === 'front' ? 'Front' : 'Mobile';
    const subRepoName = `${opts.projectName.toLowerCase()}_${service}`;
    const servicePath = path.join(hubPath, serviceFolderName);
    await fs.ensureDir(servicePath);

    let subRemoteUrl = '';
    if (opts.githubOrg) {
      onProgress?.(`Creando repositorio remoto ${subRepoName} en GitHub (${opts.githubOrg})...`);
      const res = await createRemoteRepo(opts.githubOrg, subRepoName, token);
      if (res.success) {
        subRemoteUrl = res.cloneUrl;
        result.createdRepos.push({ name: subRepoName, cloneUrl: res.cloneUrl, localPath: servicePath });
      } else if (res.error) {
        result.errors.push(`Could not create GitHub repo ${subRepoName}: ${res.error}`);
        subRemoteUrl = `git@github.com:${opts.githubOrg}/${subRepoName}.git`;
      }
    } else {
      subRemoteUrl = `git@github.com:company/${subRepoName}.git`;
    }

    gitmodulesContent += `[submodule "${serviceFolderName}"]\n\tpath = ${serviceFolderName}\n\turl = ${subRemoteUrl}\n`;

    // Service-specific files & Framework initialization
    if (service === 'back') {
      onProgress?.('Generando Backend (NestJS) con alias de importaciones (@/*) y tsconfig-paths...');
      // Sub-repo configs, standalone compose, .env & .gitignore
      await fs.writeFile(path.join(servicePath, '.gitignore'), templates.getBackGitignore());
      await fs.writeFile(path.join(servicePath, '.prettierrc'), templates.getPrettierRc());
      await fs.writeFile(path.join(servicePath, '.prettierignore'), templates.getPrettierIgnore());
      await fs.writeFile(path.join(servicePath, 'eslint.config.mjs'), templates.getBackEslintConfigMjs());
      await fs.writeFile(path.join(servicePath, '.editorconfig'), templates.getEditorConfig());

      // Standalone Docker Compose & Environment files
      await fs.writeFile(path.join(servicePath, 'compose.dev.yml'), templates.getBackStandaloneComposeYml(opts));
      await fs.writeFile(path.join(servicePath, '.env.template'), templates.getBackEnvTemplate(opts));
      await fs.writeFile(path.join(servicePath, '.env'), templates.getBackEnvTemplate(opts));

      await fs.writeFile(path.join(servicePath, 'AGENTS.md'), templates.getBackAgentsMd(opts));
      await fs.writeFile(path.join(servicePath, 'tsconfig.json'), templates.getNestTsConfig());
      await fs.writeFile(path.join(servicePath, 'tsconfig.build.json'), templates.getTsConfigBuild());
      await fs.writeFile(path.join(servicePath, 'nest-cli.json'), templates.getNestCliJson());
      
      // Base lista para producción: configuración validada, base de datos, health, plataforma (Pusher, push, client-config),
      // main.ts y módulo raíz; Dockerfile no root + entrypoint con migraciones; cloudbuild.yaml. Ver src/deploy.ts.
      onProgress?.('Generando la base del Backend (config validada, base de datos, health, Docker de producción)...');
      await deploy.writeBackBase(servicePath, opts);
      await deploy.writeBackDocker(servicePath, opts);
      if (opts.cloudRun !== false) await deploy.writeBackCloudBuild(servicePath, opts);

      const workflowsDir = path.join(servicePath, '.github', 'workflows');
      await fs.ensureDir(workflowsDir);
      await fs.writeFile(path.join(workflowsDir, 'ci.yml'), templates.getBackCiWorkflow());

      // NestJS dependencies including GCS, SMTP Mailer, Pusher, BullMQ, MFA and optional Firebase Admin
      const backDeps: Record<string, string> = {
        "@nestjs/common": "latest",
        "@nestjs/config": "latest",
        "@nestjs/core": "latest",
        "@nestjs/jwt": "latest",
        "@nestjs/passport": "latest",
        "@nestjs/platform-express": "latest",
        "@nestjs/swagger": "latest",
        "@scalar/nestjs-api-reference": "latest",
        "@nestjs/bullmq": "latest",
        "@nestjs-modules/mailer": "latest",
        "@google-cloud/storage": "latest",
        "nodemailer": "latest",
        "bullmq": "latest",
        "bcrypt": "latest",
        "otplib": "latest",
        "qrcode": "latest",
        "class-transformer": "latest",
        "class-validator": "latest",
        "dotenv": "latest",
        "helmet": "latest",
        "joi": "latest",
        "passport": "latest",
        "passport-jwt": "latest",
        "pusher": "latest",
        "reflect-metadata": "latest",
        "rxjs": "latest",
        "uuid": "latest"
      };

      if (hasMobile) {
        backDeps["firebase-admin"] = "latest";
      }

      Object.assign(backDeps, deploy.backExtraDeps(opts));

      if (opts.database === 'mongo' || opts.backendOrm === 'mongoose') {
        backDeps["@nestjs/mongoose"] = "latest";
        backDeps["mongoose"] = "latest";
      } else if (opts.backendOrm === 'typeorm') {
        backDeps["@nestjs/typeorm"] = "latest";
        backDeps["typeorm"] = "latest";
        if (opts.database === 'mysql') backDeps["mysql2"] = "latest";
        if (opts.database === 'postgres') backDeps["pg"] = "latest";
      } else if (opts.backendOrm === 'prisma') {
        backDeps["@prisma/client"] = "latest";
      } else if (opts.backendOrm === 'drizzle') {
        backDeps["drizzle-orm"] = "latest";
      }

      const backPackageJson = {
        name: `${opts.projectName.toLowerCase()}-back`,
        version: '1.0.0',
        scripts: {
          "build": "nest build",
          "start": "nest start",
          "start:dev": "nest start --watch",
          "lint": "eslint \"{src,apps,libs,test}/**/*.ts\"",
          "test:ci": "jest --coverage --ci",
          ...deploy.backMigrationScripts(opts)
        },
        dependencies: backDeps,
        devDependencies: {
          "@eslint/js": "latest",
          "@nestjs/cli": "latest",
          "@types/bcrypt": "latest",
          "@types/node": "latest",
          "@types/nodemailer": "latest",
          "@types/passport-jwt": "latest",
          "@types/qrcode": "latest",
          "@types/uuid": "latest",
          "eslint": "latest",
          "eslint-config-prettier": "latest",
          "eslint-plugin-prettier": "latest",
          "eslint-plugin-simple-import-sort": "latest",
          "eslint-plugin-unused-imports": "latest",
          "globals": "latest",
          "prettier": "latest",
          "tsconfig-paths": "latest",
          "ts-node": "latest",
          "typescript": "latest",
          "typescript-eslint": "latest"
        }
      };
      await fs.writeFile(path.join(servicePath, 'package.json'), JSON.stringify(backPackageJson, null, 2));

    } else if (service === 'front') {
      onProgress?.(`Generando Frontend (${opts.frontendFramework === 'next' ? 'Next.js' : 'Vue.js 3'}) con shadcn/ui, Tailwind CSS v4 y componentes completos...`);
      // Sub-repo configs & .gitignore
      await fs.writeFile(path.join(servicePath, '.gitignore'), templates.getFrontGitignore());
      await fs.writeFile(path.join(servicePath, '.prettierrc'), templates.getPrettierRc());
      await fs.writeFile(path.join(servicePath, '.prettierignore'), templates.getPrettierIgnore());
      await fs.writeFile(path.join(servicePath, 'eslint.config.mjs'), templates.getFrontEslintConfigMjs());
      await fs.writeFile(path.join(servicePath, 'postcss.config.mjs'), templates.getPostcssConfigMjs());
      await fs.writeFile(path.join(servicePath, 'components.json'), templates.getShadcnComponentsJson());
      await fs.writeFile(path.join(servicePath, '.editorconfig'), templates.getEditorConfig());

      // Standalone Docker Compose & Environment files
      await fs.writeFile(path.join(servicePath, 'compose.dev.yml'), templates.getFrontStandaloneComposeYml(opts));
      await fs.writeFile(path.join(servicePath, '.env.template'), templates.getFrontEnvTemplate(opts));
      await fs.writeFile(path.join(servicePath, '.env'), templates.getFrontEnvTemplate(opts));

      await fs.writeFile(path.join(servicePath, 'AGENTS.md'), templates.getFrontAgentsMd(opts));
      await deploy.writeFrontDocker(servicePath, opts);
      await deploy.writeFrontBase(servicePath, opts);
      if (opts.cloudRun !== false) await deploy.writeFrontCloudBuild(servicePath, opts);

      const workflowsDir = path.join(servicePath, '.github', 'workflows');
      await fs.ensureDir(workflowsDir);
      await fs.writeFile(path.join(workflowsDir, 'ci.yml'), templates.getFrontCiWorkflow());

      // Base Frontend dependencies + AmCharts5, Pusher JS, shadcn/ui utils & Google Fonts
      const frontDeps: Record<string, string> = {
        "@amcharts/amcharts5": "latest",
        "pusher-js": "latest",
        "lucide-react": "latest",
        "clsx": "latest",
        "tailwind-merge": "latest",
        "class-variance-authority": "latest",
        "cmdk": "latest",
        "sonner": "latest",
        "next-themes": "latest",
        "@fontsource/inter": "latest",
        "@fontsource/outfit": "latest",
        "@fontsource/jetbrains-mono": "latest"
      };

      if (opts.frontendFramework === 'next') {
        frontDeps["next"] = "latest";
        frontDeps["react"] = "latest";
        frontDeps["react-dom"] = "latest";

        await fs.writeFile(path.join(servicePath, 'tsconfig.json'), templates.getNextTsConfig());
        await fs.writeFile(path.join(servicePath, 'next.config.ts'), templates.getNextConfigTs());

        // `public/` debe existir: la imagen de producción (standalone) la copia y `COPY` falla si no está.
        await fs.ensureDir(path.join(servicePath, 'public'));
        await fs.writeFile(path.join(servicePath, 'public', '.gitkeep'), '');

        const libDir = path.join(servicePath, 'src', 'lib');
        await fs.ensureDir(libDir);
        await fs.writeFile(path.join(libDir, 'utils.ts'), templates.getLibUtilsTs());

        const componentsUiDir = path.join(servicePath, 'src', 'components', 'ui');
        await fs.ensureDir(componentsUiDir);

        const appDir = path.join(servicePath, 'src', 'app');
        await fs.ensureDir(appDir);
        await fs.writeFile(path.join(appDir, 'page.tsx'), templates.getNextPageTsx(opts));
        await fs.writeFile(path.join(appDir, 'layout.tsx'), templates.getNextLayoutTsx(opts));
        await fs.writeFile(path.join(appDir, 'globals.css'), templates.getNextGlobalsCss());
      } else {
        frontDeps["vue"] = "latest";

        await fs.writeFile(path.join(servicePath, 'vite.config.ts'), templates.getViteConfigTs());
        const srcDir = path.join(servicePath, 'src');
        await fs.ensureDir(srcDir);
        await fs.writeFile(path.join(srcDir, 'App.vue'), templates.getVueAppVue(opts));
        await fs.writeFile(path.join(srcDir, 'main.ts'), templates.getVueMainTs());
      }

      const frontPackageJson = {
        name: `${opts.projectName.toLowerCase()}-front`,
        version: '1.0.0',
        scripts: {
          "dev": opts.frontendFramework === 'next' ? "next dev --webpack" : "vite",
          "build": opts.frontendFramework === 'next' ? "next build" : "vite build",
          "lint": "eslint ."
        },
        dependencies: frontDeps,
        devDependencies: {
          "@tailwindcss/postcss": "latest",
          "eslint": "latest",
          "eslint-config-next": "latest",
          "eslint-plugin-unused-imports": "latest",
          "prettier": "latest",
          "prettier-plugin-tailwindcss": "latest",
          "tailwindcss": "latest",
          "typescript": "latest",
          "typescript-eslint": "latest"
        }
      };
      await fs.writeFile(path.join(servicePath, 'package.json'), JSON.stringify(frontPackageJson, null, 2));

    } else if (service === 'mobile') {
      onProgress?.('Generando Mobile (Flutter) con Firebase Messaging, Riverpod y Google Fonts...');
      await fs.writeFile(path.join(servicePath, '.gitignore'), templates.getMobileGitignore());
      await fs.writeFile(path.join(servicePath, 'analysis_options.yaml'), templates.getFlutterAnalysisOptions());
      await fs.writeFile(path.join(servicePath, 'AGENTS.md'), templates.getMobileAgentsMd());
      await fs.writeFile(path.join(servicePath, 'pubspec.yaml'), templates.getMobilePubspec(opts));
      
      // Environment files for Mobile
      await fs.writeFile(path.join(servicePath, '.env.template'), templates.getMobileEnvTemplate(opts));
      await fs.writeFile(path.join(servicePath, '.env'), templates.getMobileEnvTemplate(opts));

      const libDir = path.join(servicePath, 'lib');
      await fs.ensureDir(libDir);
      await fs.writeFile(
        path.join(libDir, 'main.dart'),
        `import 'package:flutter/material.dart';\nimport 'package:flutter_riverpod/flutter_riverpod.dart';\n\nvoid main() {\n  runApp(const ProviderScope(child: MyApp()));\n}\n\nclass MyApp extends StatelessWidget {\n  const MyApp({super.key});\n\n  @override\n  Widget build(BuildContext context) {\n    return MaterialApp(\n      title: '${opts.projectName}',\n      home: Scaffold(body: Center(child: Text('${opts.projectName} Mobile'))),\n    );\n  }\n}\n`
      );

      // Config de build (API_URL), client-config y README de push; plataformas nativas + preparación de Firebase.
      onProgress?.('Preparando Mobile (config de build, plataformas nativas y Firebase)...');
      result.errors.push(...(await deploy.writeMobileCloudRun(servicePath, opts, onProgress)));

      const workflowsDir = path.join(servicePath, '.github', 'workflows');
      await fs.ensureDir(workflowsDir);
      await fs.writeFile(path.join(workflowsDir, 'ci.yml'), `name: Mobile CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
      - run: flutter analyze
      - run: flutter test
`);
    }

    // Init sub git repo
    try {
      await execa('git', ['init'], { cwd: servicePath });
      if (subRemoteUrl) {
        await execa('git', ['remote', 'add', 'origin', subRemoteUrl], { cwd: servicePath });
      }
    } catch {}
  }

  // Write .gitmodules in Root
  if (gitmodulesContent) {
    await fs.writeFile(path.join(hubPath, '.gitmodules'), gitmodulesContent);
  }

  // 4. Run Dependency Installations inside Sub-Repos (npm install automatically resolves "latest" dist-tags)
  for (const service of opts.services) {
    const serviceFolderName = service === 'back' ? 'Back' : service === 'front' ? 'Front' : 'Mobile';
    const servicePath = path.join(hubPath, serviceFolderName);

    if (service === 'back' || service === 'front') {
      onProgress?.(`Instalando últimas versiones npm (@latest) en ${serviceFolderName}...`);
      try {
        await execa('npm', ['install'], { cwd: servicePath });
        result.installedDependencies.push(`${serviceFolderName} (@latest)`);
        if (service === 'back') {
          // Normaliza formato (prettier) y orden de imports del código generado para que `npm run lint` pase de fábrica.
          await execa('npx', ['eslint', '--fix', 'src/**/*.ts'], { cwd: servicePath, reject: false });
        }
      } catch (err: any) {
        result.errors.push(`npm install en ${serviceFolderName} falló: ${err.message}`);
      }
    } else if (service === 'mobile') {
      onProgress?.('Resolviendo últimas versiones de Flutter en pub.dev (flutter pub get)...');
      try {
        await execa('flutter', ['pub', 'get'], { cwd: servicePath });
        result.installedDependencies.push('Mobile (flutter pub get)');
      } catch {
        try {
          await execa('dart', ['pub', 'get'], { cwd: servicePath });
          result.installedDependencies.push('Mobile (dart pub get)');
        } catch (err: any) {
          result.errors.push(`Instalación de paquetes en Mobile falló: ${err.message}`);
        }
      }
    }
  }

  return result;
}
