# Estadística de Supervisores

Planilla digital para que los supervisores de casino carguen la estadística de mesas
desde el celular, con totales automáticos, guardado en la nube y un panel de
administración para ver y exportar todo.

- **Sin build:** HTML + CSS + JavaScript puro.
- **Hosting:** GitHub Pages.
- **Base de datos:** Supabase (REST).

## Páginas

| Página | Para qué |
|---|---|
| `index.html` | Planilla del supervisor (mesas variables + totales en vivo) |
| `admin.html` | Panel del administrador (login + filtros + agregados + CSV) |

## Datos que se guardan

Cada **parte** registra: fecha, hora, sector, turno, legajo, la lista de mesas
(Nº, ganancia, pérdida, propina), los totales (capital y propina) y notas opcionales.

La cantidad de mesas es **variable**: se agregan y quitan filas.

## Seguridad

- Los supervisores (rol `anon`) **solo pueden insertar** partes.
- El administrador (usuario autenticado) es el único que **puede leer**.
- Los supervisores no tienen cuentan ni contraseña: se identifican por legajo.

## Puesta en marcha

### 1. Crear la tabla en Supabase

1. Entrá a tu proyecto de Supabase → **SQL Editor** → **New query**.
2. Pegá **todo** el contenido de [`schema.sql`](schema.sql) y ejecutalo (**Run**).

Si la tabla ya existía antes de la columna `activity_date`, ejecutá también
[`migrations/001-activity-date.sql`](migrations/001-activity-date.sql). Sin eso,
los INSERT fallan con `PGRST204` y los partes quedan en el buzón de salida.

### 2. Configurar la conexión

Editá [`config.js`](config.js) con la URL y la clave *publishable/anon* de tu
proyecto (Supabase → Project Settings → API). La clave anon es pública: puede
estar en el frontend.

### 3. Crear el usuario administrador

En Supabase → **Authentication** → **Users** → **Add user**, creá el email y la
contraseña del administrador. Con esos datos se entra a `admin.html`.

### 4. Publicar en GitHub Pages

```bash
git init
git add .
git commit -m "Estadística de Supervisores"
gh repo create estadistica-supervisores --public --source . --push
```

Luego: **Settings → Pages → Branch: `main` / root**.

## Archivos

```
index.html    Planilla del supervisor
admin.html    Panel de administración
styles.css    Estilos (claro/oscuro)
app.js        Lógica del supervisor (mesas, totales, guardado, cola offline)
admin.js      Lógica del panel (login, filtros, agregados, CSV)
config.js     Configuración de Supabase
supabase.js   Cliente REST mínimo
schema.sql    Tabla + políticas RLS
```

## Notas

- Si no hay conexión, los partes quedan en una cola local y se reintentan al
  reconectar, al volver a la pestaña y con backoff (el badge de la barra
  superior muestra los pendientes; se puede tocar para reintentar).
- Si un parte no se puede subir por un error del servidor (por ejemplo, falta
  una columna), queda marcado como "con error", se muestra el mensaje real y
  no se reintenta en loop.
- La planilla guarda un borrador local para no perder datos si se recarga la página.
