# Sistema de gestión de carnicería · prueba pública

Prototipo inicial de gestión interna de **Carnes Santa Elena**. Este repositorio comparte una muestra funcional para revisar la interfaz y la estructura; por privacidad de la empresa no contiene sus datos, credenciales, correos, base de datos ni la aplicación empresarial completa.

> **Importante:** GitHub Pages publica una demostración de frontend, no el servidor privado. Los usuarios de prueba, permisos y registros se simulan en el navegador y se guardan en su `localStorage`. No uses datos personales, información empresarial ni contraseñas reutilizadas. Esta demo no brinda autenticación ni control de acceso seguro.

## 1. Problema que aborda

En una carnicería, las tareas de caja, catálogo, conteo de existencias, administración de trabajadores y preparación de nómina pueden quedar repartidas entre papel y hojas de cálculo. Eso dificulta encontrar productos, mantener un saldo de inventario consistente, controlar quién accede a cada tarea y revisar los cálculos de pago.

Este prototipo explora una interfaz centralizada para organizar esas operaciones cotidianas. El objetivo del repositorio es mostrar una prueba inicial de concepto, no representar una instalación empresarial lista para producción.

## 2. Tecnologías

| Área | Tecnología en este proyecto |
| --- | --- |
| Interfaz | HTML5, CSS y JavaScript nativo |
| Aplicación local | Node.js 22.13+ y Express |
| Persistencia de la aplicación local | SQLite integrado en Node (`node:sqlite`) |
| Sesiones y controles del servidor | `express-session`, `bcryptjs`, `helmet` y tokens CSRF |
| Comprobantes | PDFKit |
| Pruebas | Node.js Test Runner (`node --test`) |
| Publicación de la demo | GitHub Pages y GitHub Actions |

**C#, .NET, SQL Server y Python no forman parte de esta versión.** La demo de Pages no necesita Node.js ni base de datos: usa únicamente archivos estáticos y almacenamiento del navegador.

## 3. Arquitectura y funcionalidades

La aplicación local consta de una SPA sin framework, un servidor Express que valida las operaciones, y una base SQLite local. Los permisos se comprueban en el servidor en cada petición. La carpeta `public/` contiene la interfaz; `src/` contiene el esquema y migración de SQLite, reglas de dominio, políticas RBAC, rutas de administración y generación de recibos; `tests/` contiene pruebas automatizadas.

La versión demostrativa que se publica en Pages reutiliza la interfaz, pero `public/demo-api.js` reemplaza la API del servidor por un adaptador didáctico de navegador. Sus datos ficticios se persisten en `localStorage` del equipo y navegador del visitante. No se envían a una base de datos ni a la empresa.

Módulos visibles:

- **Caja y vueltos:** suma denominaciones, calcula el recibido y el cambio; muestra el espacio reservado para una futura integración con tickets de balanza.
- **Productos:** alta, edición con código inmutable, búsqueda y eliminación.
- **Inventarios:** acumula conteos sobre la base guardada y permite consolidar un ciclo.
- **Trabajadores:** alta, edición, eliminación y validación de teléfono y correo duplicados en la demo.
- **Nómina:** calcula el pago quincenal, permite ajustar extras, bonos y débitos y muestra comprobantes de muestra. El envío del entorno público está simulado y **no manda correos**.
- **Usuarios (Administrador):** altas y cambios de rol, estado y permisos por módulo; los Operadores ven los módulos asignados en la navegación.

## 4. Capturas

Vista de acceso y demostración:

![Pantalla de inicio de sesión de la demo Carnes Santa Elena](docs/screenshots/login.svg)

Vista principal:

![Panel de gestión con caja y vueltos](docs/screenshots/cash.svg)

Las imágenes son ilustraciones de referencia del diseño; abre la demo para interactuar con la interfaz y sus datos de muestra.

## 5. Probar la demo publicada

Después de publicar el repositorio, abre:

`https://<tu-usuario>.github.io/sistema-gestion-carniceria/`

Credenciales iniciales de demostración:

| Rol | Usuario | Contraseña |
| --- | --- | --- |
| Administrador | `admin` | `DemoCarnes2026` |
| Operador | `operador` | `DemoOperador2026` |

La demo se inicia con datos ficticios. El Administrador puede crear cuentas de prueba desde **Usuarios**. Para volver a los datos iniciales, usa **Restablecer datos de demostración** en el login. Este reinicio borra solo los datos de la demo en el navegador actual. Los datos no se comparten entre visitantes ni dispositivos.

Las credenciales están publicadas deliberadamente para probar la interfaz; no son secretas. El login y RBAC de Pages son simulaciones client-side, manipulables por el visitante y no apropiadas para proteger ningún recurso.

## 6. Publicar en GitHub Pages

1. Crea un repositorio público llamado `sistema-gestion-carniceria` y sube el código fuente.
2. No subas `.env`, `data/` ni `node_modules/`. El `.gitignore` los excluye. La base local puede contener datos privados aunque esta copia de muestra esté sanitizada.
3. En GitHub, abre **Settings → Actions → General → Workflow permissions** y permite los permisos requeridos por los workflows.
4. No necesitas habilitar Pages manualmente: el workflow `.github/workflows/pages.yml` lo activa con **GitHub Actions** durante el primer despliegue.
5. Sube la rama `main`. El workflow `.github/workflows/pages.yml` publica el `index.html` estático y la carpeta `public/`.
6. Espera a que termine el workflow **Publish public demo to GitHub Pages** y abre la URL indicada en el entorno `github-pages` del workflow.

La raíz del repositorio incluye `index.html` para que GitHub Pages tenga una entrada directa. No requiere configurar Node.js en el hospedaje.

## 7. Ejecutar la aplicación local completa

Requiere Node.js 22.13 o posterior.

```powershell
npm install
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Completa `.env` con el valor generado como `SESSION_SECRET` y define `ADMIN_USERNAME` y una contraseña de administrador de al menos 12 caracteres. Luego ejecuta:

```powershell
npm start
```

Abre `http://localhost:3000`. La aplicación local conserva sus datos en `data/carnes-santa-elena.sqlite`. Para enviar correos reales de nómina se requieren credenciales SMTP; sin ellas no debe asumirse que hubo un envío. Nunca publiques `.env` ni la base de datos.

Para inspeccionar la demo estática en un servidor local sencillo, desde la raíz del proyecto:

```powershell
python -m http.server 8000
```

Abre `http://localhost:8000/?demo=1`. También se puede probar con `npm start` en `http://localhost:3000/?demo=1`; ese modo usa el mismo adaptador local de navegador y no modifica la base SQLite del servidor.

## Pruebas

```powershell
npm test
```

## Alcance y privacidad

Este repositorio es una muestra parcial de un desarrollo inicial. No incluye el sistema empresarial completo ni información real de la compañía. La aplicación local y la demo de Pages son entornos distintos: Pages es estático y no puede alojar este backend Express, SQLite, sesiones seguras ni el servicio SMTP. Para producción haría falta un servidor de aplicación privado, controles operativos, gestión de secretos y una política de privacidad adecuada.
