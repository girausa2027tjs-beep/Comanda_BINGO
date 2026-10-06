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
   Cada vez que cambies el código: *Implementar → Gestionar implementaciones → Editar → Nueva versión*.

## 2. Frontend
1. Pega la URL `/exec` en `assets/config.js` (`API_URL`).
2. Sube la carpeta a un repo y activa **GitHub Pages**.

## 3. Ingreso
Curso → alumno (Nombre + primer apellido) → quién vende (Alumno / Mamá / Papá) →
contraseña = **segundo apellido** (no importan mayúsculas ni tildes).

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
| Vendedor | Crear; editar todo (mesa, cliente, productos, pago) solo en **Creado**; pasar **En preparación → Entregado**; **Eliminar** en cualquier estado (queda como "Eliminado", no se borra la fila). Ve solo sus pedidos, del más nuevo al más antiguo. |
| Administrador | Ve todos en orden cronológico con quién los creó; edita productos/cantidades en **Creado** o **En preparación**; **Creado → En preparación** + imprime; reimprime cualquiera. |

Cada cambio de estado agrega una fila en `pedido_estado` con fecha y hora.

## Protecciones de datos
- Hojas y columnas por encabezado normalizado (se pueden reordenar columnas).
- `LockService`: un escritor a la vez → números correlativos sin repetir, sin filas pisadas.
- Anti-duplicado: cada envío lleva un id único; doble clic o reintento devuelve el mismo pedido.
- Anti-sobreescritura: cada pedido lleva una "versión"; si otra persona lo cambió, se rechaza y se recarga.
- Precios y totales se calculan en el servidor desde la hoja `producto` (acepta "$1.000" o 1000).
  Un producto ya en un pedido conserva su precio si luego cambia en la hoja.
- Productos con `Activo = FALSE` no se pueden agregar a pedidos nuevos.
- Fechas/horas se guardan como texto; textos que parten con `= + - @` se neutralizan.
- La contraseña nunca viaja de vuelta al navegador; la sesión es un token de 6 h.
