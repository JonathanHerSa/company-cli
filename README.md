# 🚀 @t3zcadev/company-cli

> **Inicializador Institucional de Proyectos Hub** con arquitectura multi-repo, soporte para Docker, pipelines CI/CD automatizados y reglas de IA generativas.

Desarrollado y mantenido por **[T3zcaDev](https://github.com/JonathanHerSa)**.

---

## ⚡ Instalación y Uso

Tienes dos formas principales de utilizar la herramienta:

### 1. 📌 Instalación Global (Recomendado para uso frecuente)
Para instalar la herramienta de forma permanente en tu sistema y poder usar el comando directo en cualquier terminal:

```bash
npm install -g @t3zcadev/company-cli
```

Una vez instalado, puedes ejecutar el comando directo desde cualquier carpeta:

```bash
t3zcadev-cli
# o también:
create-hub-app
# o:
company-cli
```

---

### 2. ⚡ Ejecución Instantánea sin Instalación (`npx`)
Si prefieres no instalar nada en tu sistema y siempre usar la versión más reciente:

```bash
npx @t3zcadev/company-cli
```

---

### 3. 🛠️ Instalación desde Repositorio Privado (Colaboradores / Git)
Si aún no se ha publicado en NPM o prefieres instalar desde el repositorio de Git:

```bash
git clone https://github.com/JonathanHerSa/company-cli.git
cd company-cli
npm install
npm install -g .
```

---

## ✨ Características Principales

- 🏗️ **Arquitectura Hub Multi-Repo**: Estructura proyectos escalables separando servicios backend y apps frontend.
- 🐳 **Docker & Docker Compose integrados**: Generación automática de contenedores optimizados para desarrollo y producción.
- 🔄 **Pipelines CI/CD**: Automatización con GitHub Actions lista para producción.
- 🤖 **Reglas de IA Generativas**: Integración de contextos y prompt rules para asistentes IA (GitHub Copilot, Cursor, Antigravity, ChatGPT).
- 🎨 **Stack Tecnológico Soportado**:
  - **Backend**: NestJS
  - **Frontend Web**: Next.js / Vue.js
  - **Mobile**: Flutter

---

## 🛠️ Desarrollo Local

Si deseas contribuir o modificar el CLI:

```bash
# 1. Clonar el repositorio
git clone https://github.com/JonathanHerSa/company-cli.git

# 2. Instalar dependencias
npm install

# 3. Compilar TypeScript
npm run build

# 4. Probar localmente
npm run dev

# 5. Enlazar comando ejecutable en tu máquina
npm link
```

---

## 👤 Autor

**T3zcaDev**
- GitHub: [@JonathanHerSa](https://github.com/JonathanHerSa)

---

## 📄 Licencia

Este proyecto está bajo la Licencia **MIT**.
