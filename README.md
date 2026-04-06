# SOLGYM Backend — API REST

## Stack
- **Node.js + Express** — servidor
- **MySQL** — base de datos
- **Prisma** — ORM y migraciones
- **JWT + bcrypt** — autenticación

---

## 1. Requisitos previos
- Node.js 18+
- MySQL corriendo (MySQL Workbench)
- Crear la base de datos en MySQL Workbench:
  ```sql
  CREATE DATABASE solgym CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  ```

---

## 2. Instalación

```bash
# Clonar / copiar el proyecto y entrar
cd solgym-backend

# Instalar dependencias
npm install

# Copiar variables de entorno
cp .env.example .env
```

Edita `.env` con tus datos:
```env
DATABASE_URL="mysql://root:TU_CONTRASEÑA@localhost:3306/solgym"
JWT_SECRET="cambia_esto_por_algo_largo_y_seguro"
```

---

## 3. Base de datos

```bash
# Crear las tablas en MySQL
npm run db:push

# Cargar datos de prueba
npm run db:seed
```

Con `npm run db:push` Prisma lee el `schema.prisma` y crea todas las tablas automáticamente en tu MySQL.

Para ver la BD visualmente desde Node:
```bash
npm run db:studio   # abre http://localhost:5555
```

---

## 4. Ejecutar

```bash
npm run dev   # desarrollo con auto-reload
npm start     # producción
```

El servidor corre en `http://localhost:3001`

---

## 5. Credenciales de prueba (seed)

| Rol         | Email                | Contraseña  |
|-------------|----------------------|-------------|
| Super Admin | super@solgym.com     | super1234   |
| Admin       | admin@solgym.com     | admin1234   |
| Entrenador  | coach1@solgym.com    | coach1234   |

---

## 6. Endpoints disponibles

### Auth
| Método | Ruta                        | Descripción             |
|--------|-----------------------------|-------------------------|
| POST   | /api/auth/login             | Iniciar sesión          |
| GET    | /api/auth/me                | Perfil del usuario      |
| PUT    | /api/auth/change-password   | Cambiar contraseña      |

### Miembros
| Método | Ruta              | Descripción             |
|--------|-------------------|-------------------------|
| GET    | /api/members      | Listar miembros         |
| GET    | /api/members/:id  | Detalle de miembro      |
| POST   | /api/members      | Crear miembro           |
| PUT    | /api/members/:id  | Editar miembro          |
| DELETE | /api/members/:id  | Desactivar miembro      |

### Asistencia
| Método | Ruta                    | Descripción             |
|--------|-------------------------|-------------------------|
| GET    | /api/attendance         | Historial               |
| GET    | /api/attendance/today   | Asistencias de hoy      |
| GET    | /api/attendance/stats   | Estadísticas semanales  |
| POST   | /api/attendance         | Registrar asistencia    |

### Métricas corporales
| Método | Ruta                    | Descripción             |
|--------|-------------------------|-------------------------|
| GET    | /api/metrics/:memberId  | Historial de métricas   |
| POST   | /api/metrics            | Guardar registro (calcula IMC automáticamente) |

### Rutinas
| Método | Ruta                                  | Descripción             |
|--------|---------------------------------------|-------------------------|
| GET    | /api/routines/:memberId               | Rutina completa         |
| POST   | /api/routines/:memberId/day/:day      | Guardar día de rutina   |
| GET    | /api/routines/public/:memberId        | Vista pública (QR)      |

### Nutrición
| Método | Ruta                                         | Descripción       |
|--------|----------------------------------------------|-------------------|
| GET    | /api/nutrition/:memberId                     | Plan completo     |
| POST   | /api/nutrition/:memberId/day/:day/meal/:meal | Guardar comida    |
| GET    | /api/nutrition/public/:memberId              | Vista pública (QR)|

### Boletas
| Método | Ruta                   | Descripción             |
|--------|------------------------|-------------------------|
| GET    | /api/receipts          | Listar boletas          |
| POST   | /api/receipts          | Emitir boleta           |
| PUT    | /api/receipts/:id/annul| Anular boleta           |
| GET    | /api/receipts/stats    | Estadísticas            |

### Perfiles del sistema
| Método | Ruta               | Descripción             |
|--------|--------------------|-------------------------|
| GET    | /api/profiles      | Listar usuarios sistema |
| POST   | /api/profiles      | Crear usuario sistema   |
| PUT    | /api/profiles/:id  | Editar usuario          |
| DELETE | /api/profiles/:id  | Desactivar usuario      |

### Planes
| Método | Ruta           | Descripción             |
|--------|----------------|-------------------------|
| GET    | /api/plans     | Listar planes           |
| POST   | /api/plans     | Crear plan              |
| PUT    | /api/plans/:id | Editar plan             |
