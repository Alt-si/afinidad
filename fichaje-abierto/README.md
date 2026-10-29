# Fichaje Abierto

Vitrina para jugadores de fútbol amateur: cada jugador carga su ficha (datos, posición, estadísticas, trayectoria, foto y videos) y los clubes buscan refuerzos filtrando por posición, provincia, pie hábil y disponibilidad.

## Estado actual: modo demo

Esta versión es un sitio estático (un solo `index.html`, sin servidor).

- Las fichas se guardan en el `localStorage` del navegador y las fotos y videos en IndexedDB.
- Por eso **los datos no se comparten entre personas ni dispositivos**: sirve para probar el flujo y el diseño.
- La barra amarilla de arriba permite cargar 3 jugadores de ejemplo y borrar todo.

## Probarlo en tu computadora

Abrí `index.html` en el navegador, o levantá un servidor local:

```bash
python3 -m http.server 8000
# y entrá a http://localhost:8000
```

## Publicarlo en Render (dentro del repo afinidad)

1. En Render: **New → Static Site**.
2. Elegí el repositorio `afinidad` y en **Root Directory** poné `fichaje-abierto`.
3. Build command: vacío. Publish directory: `./`.
4. Cada `git push` a la rama principal vuelve a publicar el sitio.

## Próximos pasos

- Base de datos compartida y almacenamiento de archivos (Supabase o Firebase).
- Otros deportes según la demanda: el código ya tiene un catálogo `SPORTS` en `index.html` (hoy solo fútbol); sumar uno es agregar sus posiciones, cualidades, categorías y estadísticas.
- Cuentas con rol **club** o **jugador** y **validación de email** obligatoria.
- Definir qué se puede hacer sin validar (por ejemplo, ver fichas sí; publicar o ver contactos, no).
