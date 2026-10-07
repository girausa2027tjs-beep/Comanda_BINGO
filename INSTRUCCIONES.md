# Comandas · Gira USA Monkeys

App de pedidos tipo restaurante (vendedor + administrador) sobre la planilla
**PEDIDOS_BINGO**. Sitio estático para GitHub Pages + backend en Google Apps Script,
igual que la app del kiosco.

## 1. Backend (Apps Script)
1. Abre la planilla → **Extensiones → Apps Script**.
2. Pega todo `apps-script/Codigo.gs`.
3. En `CONFIG.ADMIN_IDS` escribe los `id_usuario` (hoja `usuario`) que serán
   administradores. Ej.: `ADMIN_IDS: [17, 40]`. Si queda vacío nadie puede entrar como Administrador.
4. Ejecuta una vez la función `probarConfiguracion` para autorizar permisos (revisa el registro).
5. **Implementar → Nueva implementación → Aplicación web**
   · Ejecutar como: **Yo** · Acceso: **Cualquier usuario**. Copia la URL que termina en `/exec`.
   Cada vez que cambies el código: *Implementar → Gestionar implementaciones → ✏️ Editar → Versión: Nueva versión → Implementar*.
   Así la URL `/exec` no cambia y no hay que tocar `config.js`.

## 2. Frontend
1. Pega la URL `/exec` en `assets/config.js` (`API_URL`).
2. Sube la carpeta a un repo y activa **GitHub Pages**.

## 3. Ingreso
Curso → alumno (Nombre + primer apellido) → quién vende (Alumno / Mamá / Papá) →
contraseña = **segundo apellido** (no importan mayúsculas ni tildes).

Cada pedido queda a nombre del **alumno + tipo de usuario** (columnas `usuario` y `tipo_usuario`).
El Alumno, su Mamá y su Papá entran con el mismo alumno, pero **cada uno ve y gestiona solo sus pedidos**.
El Administrador ve todos, por ejemplo "Vende: Daniela Alarcón (Mamá)".

## 4. Impresora SPRT POS 58 (botón "Impresora", solo Administrador)
- **Instalada en el equipo** (recomendado en PC con Windows): instala el driver, déjala como
  impresora predeterminada con papel de 58 mm. Para imprimir sin diálogo abre Chrome con
  `--kiosk-printing`.
- **USB directo / Puerto serie / Bluetooth**: Chrome o Edge; presiona *Conectar* y elige la impresora.
  Envía ESC/POS con el N° de pedido gigante, mesa y cliente en grande.
- Elige 58 u 80 mm según el rollo. Usa *Imprimir prueba* para verificar tildes y ñ.

## Reglas de estados
| Quién | Puede |
|---|---|
| Vendedor | Crear; editar todo (mesa, cliente, productos, pago) solo en **Creado**; pasar **En preparación → Entregado**; **Eliminar** solo en **Creado** o **En preparación** (queda como "Eliminado", no se borra la fila); un pedido **Entregado** no se puede eliminar. Ve solo sus pedidos, del más nuevo al más antiguo. |
| Administrador | Ve todos en orden cronológico con quién los creó; edita productos/cantidades en **Creado** o **En preparación**; **Creado → En preparación** + imprime; reimprime cualquiera. |

Cada cambio de estado agrega una fila en `pedido_estado` con fecha y hora.

## Velocidad
- **Ventas sin espera:** al presionar *Crear pedido* el formulario queda libre al instante y el pedido
  aparece en *Mis pedidos* como "Guardando…" hasta que el servidor lo confirma. Se pueden tomar varios
  pedidos seguidos. Si la red falla queda "Sin guardar" y se reintenta solo (nunca duplica).
- **Entregar / Eliminar** se ven al instante con "Guardando…"; si el servidor lo rechaza, vuelve atrás.
- **Memoria rápida (CacheService):** la lista de pedidos y las hojas `producto`, `estado`, `usuario`,
  `tipo_usuario` se guardan en memoria; las actualizaciones automáticas ya no leen la planilla.
  Cada escritura renueva la memoria. Si editas la planilla **a mano**, la función `onEdit` limpia la
  memoria al instante (funciona porque el script está dentro de la planilla). Para forzarlo, ejecuta
  `limpiarMemoria` desde el editor.
- **Botones "↻ Actualizar pedidos" y "↻ Actualizar productos"** (vendedor y administrador): vuelven a leer
  la planilla directamente, sin la memoria rápida. Úsalos si cambiaste algo y no aparece (por ejemplo,
  una edición hecha desde otra app o el celular, que no siempre dispara `onEdit`).
  Si un producto del pedido en curso se desactivó, se quita del carrito y se avisa.
  "Actualizar pedidos" también reintenta los pedidos que quedaron "Sin guardar".
- Cada respuesta trae `ms` (tiempo en el servidor); se ve en la consola del navegador (F12).
- Límite propio de Google: cada llamada a Apps Script tarda ~1–2 s aunque el servidor trabaje 0 ms
  (arranque + redirección). La primera llamada tras unos minutos sin uso es más lenta.

## Protecciones de datos
- Hojas y columnas por encabezado normalizado (se pueden reordenar columnas).
- `LockService`: un escritor a la vez → números correlativos sin repetir, sin filas pisadas.
- Anti-duplicado: crear, editar y cambiar estado llevan un id único. Si la respuesta de Google se pierde
  (404, sin señal, demora), la app reintenta sola hasta 4 veces con el mismo id y el servidor no vuelve a escribir.
- Anti-sobreescritura: cada pedido lleva una "versión"; si otra persona lo cambió, se rechaza y se recarga.
- Precios y totales se calculan en el servidor desde la hoja `producto` (acepta "$1.000" o 1000).
  Un producto ya en un pedido conserva su precio si luego cambia en la hoja.
- Productos con `Activo = FALSE` no se pueden agregar a pedidos nuevos.
- Fechas/horas se guardan como texto; textos que parten con `= + - @` se neutralizan.
- La contraseña nunca viaja de vuelta al navegador; la sesión es un token de 6 h.
