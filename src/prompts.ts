import { intro, outro, text, select, multiselect, confirm, spinner, isCancel, cancel } from '@clack/prompts';
import { checkGitHubStatus, getOrgsViaToken, GitHubStatus } from './github.js';
import { generateHubProject } from './generator.js';
import { ProjectOptions, generateRandomSecrets } from './templates.js';

export async function runCliPrompts(): Promise<void> {
  intro('🚀 Inicializador Institucional de Proyectos Hub (@t3zcadev/company-cli)');

  const s = spinner();
  s.start('Verificando credenciales y entorno de GitHub...');
  
  const ghStatus: GitHubStatus = await checkGitHubStatus();
  s.stop('Entorno verificado');

  let selectedOrg = '';
  let githubToken = '';

  if (ghStatus.hasGhCli && ghStatus.isAuthenticated) {
    const orgOptions = [];

    // Personal Account Option
    if (ghStatus.username) {
      orgOptions.push({
        value: ghStatus.username,
        label: `👤 Mi Cuenta Personal (${ghStatus.username})`,
        hint: 'Crear en tu perfil de GitHub'
      });
    }

    // Organization Options
    if (ghStatus.orgs.length > 0) {
      for (const o of ghStatus.orgs) {
        orgOptions.push({
          value: o.login,
          label: `🏢 Organización: ${o.login}`,
          hint: 'Crear en la Organización de GitHub'
        });
      }
    }

    orgOptions.push(
      { value: 'MANUAL', label: '✏️  [ Escribir otra organización/usuario manualmente ]' },
      { value: 'NONE', label: '💻 [ Ninguna / Generar solo localmente ]' }
    );

    const orgChoice = await select({
      message: '¿Dónde deseas crear los repositorios en GitHub?',
      options: orgOptions
    });

    if (isCancel(orgChoice)) {
      cancel('Operación cancelada.');
      process.exit(0);
    }

    if (orgChoice === 'MANUAL') {
      const manualOrg = await text({
        message: 'Ingresa el nombre exacto de la Organización o Usuario en GitHub:',
        placeholder: 'ej. Coorsamexico-Development o mi_usuario'
      });
      if (isCancel(manualOrg)) {
        cancel('Operación cancelada.');
        process.exit(0);
      }
      selectedOrg = String(manualOrg).trim();
    } else if (orgChoice !== 'NONE') {
      selectedOrg = String(orgChoice);
    }
  } else {
    const fallbackChoice = await select({
      message: 'No se detectó GitHub CLI (gh) autenticado. ¿Cómo deseas proceder?',
      options: [
        { value: 'TOKEN', label: 'Ingresar un Personal Access Token (PAT) de GitHub' },
        { value: 'MANUAL_ORG', label: 'Escribir el nombre del usuario/org (requiere gh o fallback local)' },
        { value: 'LOCAL', label: 'Generar solo la estructura local (offline)' }
      ]
    });

    if (isCancel(fallbackChoice)) {
      cancel('Operación cancelada.');
      process.exit(0);
    }

    if (fallbackChoice === 'TOKEN') {
      const tokenInput = await text({
        message: 'Ingresa tu Personal Access Token (PAT) de GitHub:',
        placeholder: 'ghp_...'
      });
      if (isCancel(tokenInput)) {
        cancel('Operación cancelada.');
        process.exit(0);
      }
      githubToken = String(tokenInput).trim();
      
      try {
        const { username, orgs } = await getOrgsViaToken(githubToken);
        const tokenOptions = [{ value: username, label: `👤 Mi Cuenta Personal (${username})` }];
        for (const o of orgs) {
          tokenOptions.push({ value: o.login, label: `🏢 Organización: ${o.login}` });
        }

        const tokenOrgChoice = await select({
          message: 'Selecciona la cuenta/organización en GitHub:',
          options: tokenOptions
        });
        if (!isCancel(tokenOrgChoice)) {
          selectedOrg = String(tokenOrgChoice);
        }
      } catch {
        // Continue with manual entry
      }
    } else if (fallbackChoice === 'MANUAL_ORG') {
      const orgInput = await text({
        message: 'Ingresa el nombre de la Organización o tu usuario:',
        placeholder: 'ej. Coorsamexico-Development'
      });
      if (!isCancel(orgInput)) {
        selectedOrg = String(orgInput).trim();
      }
    }
  }

  // 1. Project Name
  const projectNameInput = await text({
    message: 'Nombre base del proyecto:',
    placeholder: 'inventario',
    validate: (val) => {
      if (!val || val.trim().length === 0) return 'El nombre del proyecto es obligatorio.';
      if (!/^[a-zA-Z0-9_-]+$/.test(val)) return 'Solo se permiten letras, números, guiones y guiones bajos.';
    }
  });
  if (isCancel(projectNameInput)) {
    cancel('Operación cancelada.');
    process.exit(0);
  }
  const projectName = String(projectNameInput).trim();

  // 2. Services selection
  const servicesInput = await multiselect({
    message: 'Selecciona los servicios que incluirá este Hub:',
    options: [
      { value: 'back', label: 'Backend (NestJS)', hint: 'Recomendado' },
      { value: 'front', label: 'Frontend (Next.js / Vue.js)', hint: 'Recomendado' },
      { value: 'mobile', label: 'Mobile (Flutter + Riverpod)' }
    ],
    required: true
  });
  if (isCancel(servicesInput)) {
    cancel('Operación cancelada.');
    process.exit(0);
  }
  const services = servicesInput as ('back' | 'front' | 'mobile')[];

  // 3. Database Options & Local Development Configuration
  const dbChoice = await select({
    message: 'Selecciona la Base de Datos principal (Docker Compose):',
    options: [
      { value: 'mysql', label: 'MySQL (Predeterminado - Última versión LTS mysql:9.7)' },
      { value: 'postgres', label: 'PostgreSQL (postgres:alpine)' },
      { value: 'mongo', label: 'MongoDB (mongo:latest)' },
      { value: 'none', label: 'Sin base de datos' }
    ]
  });
  if (isCancel(dbChoice)) {
    cancel('Operación cancelada.');
    process.exit(0);
  }
  const database = dbChoice as 'mysql' | 'postgres' | 'mongo' | 'none';

  let databasePort = '3306';
  let databasePassword = 'devpassword';

  if (database !== 'none') {
    const standardPort = database === 'mysql' ? '3306' : database === 'postgres' ? '5432' : '27017';
    
    const portInput = await text({
      message: `Puerto local para la base de datos (${database.toUpperCase()}) en Docker (Estándar: ${standardPort}):`,
      initialValue: standardPort,
      validate: (val) => {
        if (!val || isNaN(Number(val))) return 'Debe ser un número de puerto válido.';
      }
    });
    if (isCancel(portInput)) {
      cancel('Operación cancelada.');
      process.exit(0);
    }
    databasePort = String(portInput).trim();

    const passInput = await text({
      message: 'Contraseña de desarrollo para la base de datos (puedes modificarla):',
      initialValue: 'devpassword',
      validate: (val) => {
        if (!val || val.trim().length === 0) return 'La contraseña no puede estar vacía.';
      }
    });
    if (isCancel(passInput)) {
      cancel('Operación cancelada.');
      process.exit(0);
    }
    databasePassword = String(passInput).trim();
  }

  // 4. Backend Options
  let backendOrm: 'typeorm' | 'prisma' | 'drizzle' | 'mongoose' = 'typeorm';
  if (services.includes('back')) {
    if (database === 'mongo') {
      backendOrm = 'mongoose';
    } else {
      const ormChoice = await select({
        message: '[Backend] Selecciona el ORM para NestJS:',
        options: [
          { value: 'typeorm', label: 'TypeORM (Estándar habitual)' },
          { value: 'prisma', label: 'Prisma ORM' },
          { value: 'drizzle', label: 'Drizzle ORM' }
        ]
      });
      if (isCancel(ormChoice)) {
        cancel('Operación cancelada.');
        process.exit(0);
      }
      backendOrm = ormChoice as 'typeorm' | 'prisma' | 'drizzle';
    }
  }

  // 5. Frontend Options
  let frontendFramework: 'next' | 'vue' = 'next';
  if (services.includes('front')) {
    const frontChoice = await select({
      message: '[Frontend] Selecciona el Framework:',
      options: [
        { value: 'next', label: 'Next.js (App Router)' },
        { value: 'vue', label: 'Vue.js 3 (Vite)' }
      ]
    });
    if (isCancel(frontChoice)) {
      cancel('Operación cancelada.');
      process.exit(0);
    }
    frontendFramework = frontChoice as 'next' | 'vue';
  }

  // 6. Despliegue en Google Cloud Run + Cloud Build (cloudbuild.yaml, entorno `deploy/`, guía). Los Dockerfiles de producción
  // y la base del Backend (config validada, health, migraciones) se generan siempre.
  let cloudRun = true;
  let gcpProjectId = '';
  let gcpRegion = 'us-central1';
  if (services.includes('back') || services.includes('front')) {
    const cloudRunChoice = await confirm({
      message: '¿Preparar el despliegue en Google Cloud Run + Cloud Build (cloudbuild.yaml y entorno deploy/staging.env)?',
      initialValue: true
    });
    if (isCancel(cloudRunChoice)) {
      cancel('Operación cancelada.');
      process.exit(0);
    }
    cloudRun = Boolean(cloudRunChoice);

    if (cloudRun) {
      const projectInput = await text({
        message: 'ID del proyecto de Google Cloud (puedes dejarlo vacío y editarlo después en deploy/staging.env):',
        placeholder: 'mi-proyecto-gcp',
        defaultValue: ''
      });
      if (isCancel(projectInput)) {
        cancel('Operación cancelada.');
        process.exit(0);
      }
      gcpProjectId = String(projectInput ?? '').trim();

      const regionInput = await text({
        message: 'Región de Cloud Run:',
        initialValue: 'us-central1',
        validate: (val) => {
          if (!val || !/^[a-z]+-[a-z]+\d+$/.test(val.trim())) return 'Formato de región inválido (ej. us-central1, europe-west1).';
        }
      });
      if (isCancel(regionInput)) {
        cancel('Operación cancelada.');
        process.exit(0);
      }
      gcpRegion = String(regionInput).trim();
    }
  }

  // Auto-generate random secrets for JWT & MFA
  const generatedSecrets = generateRandomSecrets();

  // Target directory
  const targetDir = process.cwd();

  const options: ProjectOptions = {
    projectName,
    githubOrg: selectedOrg,
    services,
    backendOrm,
    frontendFramework,
    database,
    databasePort,
    databasePassword,
    targetDir,
    jwtSecret: generatedSecrets.jwtSecret,
    jwtRefreshSecret: generatedSecrets.jwtRefreshSecret,
    mfaEncryptionKey: generatedSecrets.mfaEncryptionKey,
    cloudRun,
    gcpProjectId,
    gcpRegion
  };

  const genSpinner = spinner();
  genSpinner.start(`Generando proyecto Hub "${projectName}_hub"...`);

  const genResult = await generateHubProject(options, githubToken, (msg) => {
    genSpinner.message(msg);
  });

  genSpinner.stop(`¡Proyecto Hub "${projectName}_hub" generado e instalado con éxito!`);

  console.log('\n');
  console.log('📌 Resumen de creación:');
  console.log(`- Directorio Hub: ${genResult.hubPath}`);
  console.log(`- Destino GitHub: ${selectedOrg || 'Local (sin remoto)'}`);
  console.log(`- Base de Datos: ${database.toUpperCase()} (Puerto: ${databasePort}, Pass: ${databasePassword})`);
  console.log(`- Secretos Autogenerados: JWT Secret, JWT Refresh Secret y MFA Key (AES-256 Hex 64 chars)`);
  console.log(`- Servicios incluidos: ${services.join(', ')}`);
  console.log(`- Instalaciones completadas: ${genResult.installedDependencies.join(', ')}`);
  console.log(`- Skills instaladas (descargadas en línea): .agents/skills/graphify y .agents/skills/impeccable`);
  
  if (genResult.createdRepos.length > 0) {
    console.log('\n📦 Repositorios creados en GitHub:');
    for (const repo of genResult.createdRepos) {
      console.log(`  ✓ ${repo.name} -> ${repo.cloneUrl}`);
    }
  }

  if (genResult.errors.length > 0) {
    console.log('\n⚠️ Advertencias / Notas:');
    for (const err of genResult.errors) {
      console.log(`  - ${err}`);
    }
  }

  const hubFolder = `${projectName.toLowerCase()}_hub`;
  const deployStep = cloudRun
    ? `
5. Desplegar a Google Cloud Run (requiere el CLI global cloudrun-kit; ver docs/deploy.md):
   - Edita deploy/staging.env (todo lo que diga CAMBIAME)
   - cloudrun-kit bootstrap deploy/staging.env --dry-run   # simula, no modifica nada
   - cloudrun-kit bootstrap deploy/staging.env             # crea todo lo necesario en Google Cloud
`
    : '';

  outro(`✨ ¡Proyecto generado e instalado con éxito!

📌 Siguientes pasos (pídele a tu Agente de IA que ejecute estas inicializaciones):

1. Entrar al proyecto:
   cd ${hubFolder}

2. Solicitar al Agente de IA la inicialización del Sistema de Diseño:
   👉 "Agente, ejecuta /impeccable init para configurar el sistema de diseño del proyecto."

3. Solicitar al Agente de IA la construcción del Grafo de Conocimiento:
   👉 "Agente, ejecuta /graphify . para construir el grafo de conocimiento del repositorio."

4. Encender el entorno de desarrollo local con Docker:
   docker compose -f compose.dev.yml up -d --build
${deployStep}`);
}
